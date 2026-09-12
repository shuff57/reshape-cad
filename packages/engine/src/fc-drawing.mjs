// engine/bridge/fc-drawing.mjs
//
// TechDraw command layer on top of the bridge core (fc-session.mjs), a
// sibling to fc-commands.mjs/fc-sketch.mjs. Unlike those two (one Python
// snippet per primitive/constraint), this is ONE compound command --
// build a page + template + auto-projection group, splice each view's own
// SVG fragment onto an app-supplied sheet template, and write the result --
// because there is no page-level export call to build up to incrementally
// (see docs/specs/SPEC-techdraw-export.md's "central question" section for
// the measured proof: page.exportToSvg does not exist, TechDrawGui is not
// built into this kernel at all).
//
// emit.exportDrawing(opts)  -- pure Python emitter, opts in, snippet out.
// attachDrawingCommands     -- binds session.exportDrawing(opts), which
//                              returns the raw {ok, reason, scale, views,
//                              bbox} JSON (no throw here -- the CALLER
//                              (FreeCadEngineAdapter.exportDrawing) decides
//                              what a refusal means, same split
//                              session.bore()/session.fillet() use one layer
//                              up from THEIR own emitters).

const pyStr = (s) => JSON.stringify(String(s));
const pyNum = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`${what}: expected a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
};
const pyBool = (v) => (v ? 'True' : 'False');
const pyNone = (v, what) => (v === null || v === undefined ? 'None' : pyNum(v, what));
const pyStrList = (arr) => `[${arr.map(pyStr).join(', ')}]`;

const OUT_PATH = '/tmp/reshape_out.json';

// Front/Top/Right/Left/Rear/Bottom/FrontTopRight -- DrawProjGroup's own
// addProjection() label vocabulary (measured against the real kernel, see
// the spec's own verification table). 'iso' maps to 'FrontTopRight' --
// DrawProjGroup has no bare "isometric" projection of its own.
const LABEL = {
  front: 'Front', top: 'Top', right: 'Right', left: 'Left',
  rear: 'Rear', bottom: 'Bottom', iso: 'FrontTopRight',
};

export const emit = {
  // opts: { objName, sheetPath, outPath, views, projection, scale,
  //         hiddenLines, area: [x0,y0,x1,y1], titleblock: [tbX, tbY] }
  //
  // Returns Python that ALWAYS writes exactly one JSON object to OUT_PATH:
  // {ok, reason, scale, views, bbox}. Never raises on an expected refusal
  // (no solid, empty output, doesn't fit any scale step) -- only a genuine
  // kernel-internal error escapes as a non-zero rc, same "wrapStatus"-style
  // discipline fc-commands.mjs uses, done here as a `def run(): ... return`
  // wrapper instead (multiple early-exit refusal points read far more
  // clearly as `return res` than as fc-commands.mjs's own nested-if/`raise`
  // shape, which was built for single-refusal DressUp features, not a
  // multi-stage compose-and-retry pipeline like this one).
  exportDrawing(opts) {
    const {
      objName, sheetPath, outPath, views, projection,
      scale, hiddenLines, area, titleblock,
    } = opts;
    if (!Array.isArray(views) || views.length === 0) {
      throw new TypeError('exportDrawing: views must be a non-empty array');
    }
    for (const v of views) {
      if (!(v in LABEL)) throw new TypeError(`exportDrawing: unknown view '${v}'`);
    }
    if (!Array.isArray(area) || area.length !== 4) {
      throw new TypeError('exportDrawing: area must be [x0,y0,x1,y1]');
    }
    if (!Array.isArray(titleblock) || titleblock.length !== 2) {
      throw new TypeError('exportDrawing: titleblock must be [x,y]');
    }

    const [x0, y0, x1, y1] = area.map((n, i) => pyNum(n, `area[${i}]`));
    const [tbX, tbY] = titleblock.map((n, i) => pyNum(n, `titleblock[${i}]`));
    const projPy = projection === 'first-angle' ? 'First angle' : 'Third angle';
    const scalePy = pyNone(scale, 'scale');
    const projLabelsPy = pyStrList(views.map((v) => LABEL[v]));
    const viewKindsPy = pyStrList(views);

    return (
      'import json, re\n' +
      'import FreeCAD as App\n' +
      'import TechDraw\n' +
      `OBJ_NAME = ${pyStr(objName)}\n` +
      `SHEET_PATH = ${pyStr(sheetPath)}\n` +
      `OUT_SVG = ${pyStr(outPath)}\n` +
      `PROJECTION = ${pyStr(projPy)}\n` +
      `SCALE = ${scalePy}\n` +
      `HIDDEN_LINES = ${pyBool(hiddenLines)}\n` +
      `PROJ_LABELS = ${projLabelsPy}\n` +
      `VIEW_KINDS = ${viewKindsPy}\n` +
      `FRAME = (${x0}, ${y0}, ${x1}, ${y1})\n` +
      `TB_X, TB_Y = ${tbX}, ${tbY}\n` +
      'NUM = r"-?\\d+\\.?\\d*(?:[eE]-?\\d+)?"\n' +
      // Command-aware bbox extractor. An 'A' (elliptical arc) path command
      // is rx,ry,x-rotation,large-arc-flag,sweep-flag,x,y -- only the LAST
      // 2 of those 7 numbers are a real coordinate. A naive "every number
      // in the d string is an alternating (x,y) pair" reader (the obvious
      // first draft) folds rx/ry/rotation/flags in as bogus points --
      // MEASURED against this exact kernel on the golden-case fixture
      // below: it inflates the isometric view's own local max-x from
      // 35.3553 to 180 (the arc's own x-axis-rotation value, degrees,
      // misread as a coordinate), which propagates into a composed bbox of
      // x-max 408.86 instead of the correct 264.21. A `<circle cx cy r>`
      // element (emitted instead of a `<path>` when a hole is viewed
      // straight down its own axis, e.g. this fixture's Top view) is
      // handled too -- a naive `d="..."` reader misses it entirely, which
      // costs nothing on THIS fixture (the hole sits well inside the box's
      // own footprint) but would silently under-measure a feature that
      // pokes past the outline in a different model.
      'def _extent(frag):\n' +
      '    xs, ys = [], []\n' +
      '    for d in re.findall(r\'d="([^"]+)"\', frag):\n' +
      '        for cmd, rest in re.findall(r"([MLAC])\\s*([^MLACZ]*)", d):\n' +
      '            nums = [float(n) for n in re.findall(NUM, rest)]\n' +
      '            if cmd in ("M", "L", "C"):\n' +
      '                for i in range(0, len(nums) - 1, 2):\n' +
      '                    xs.append(nums[i]); ys.append(nums[i + 1])\n' +
      '            elif cmd == "A":\n' +
      '                for i in range(0, len(nums) - 6, 7):\n' +
      '                    xs.append(nums[i + 5]); ys.append(nums[i + 6])\n' +
      '    for cx, cy, r in re.findall(r\'<circle[^>]*cx\\s*=\\s*"([^"]+)"[^>]*cy\\s*=\\s*"([^"]+)"[^>]*r\\s*=\\s*"([^"]+)"\', frag):\n' +
      '        cx, cy, r = float(cx), float(cy), float(r)\n' +
      '        xs += [cx - r, cx + r]; ys += [cy - r, cy + r]\n' +
      '    return (min(xs), max(xs), min(ys), max(ys)) if xs else None\n' +
      'def _q(v):\n' +
      '    return v.Value if hasattr(v, "Value") else float(v)\n' +
      'def run():\n' +
      '    doc = App.ActiveDocument\n' +
      '    res = {"ok": False, "reason": None, "scale": None, "views": [], "bbox": None}\n' +
      '    src = doc.getObject(OBJ_NAME)\n' +
      '    if src is None or getattr(src, "Shape", None) is None or src.Shape.isNull() or len(src.Shape.Faces) == 0:\n' +
      '        res["reason"] = "no solid to project"\n' +
      '        return res\n' +
      '    page = doc.addObject("TechDraw::DrawPage", "ReshapePage")\n' +
      '    tmpl = doc.addObject("TechDraw::DrawSVGTemplate", "ReshapeTemplate")\n' +
      '    tmpl.Template = SHEET_PATH\n' +
      '    page.Template = tmpl\n' +
      '    page.ProjectionType = PROJECTION\n' +
      '    doc.recompute()\n' +
      '    grp = doc.addObject("TechDraw::DrawProjGroup", "ReshapeGroup")\n' +
      '    page.addView(grp)\n' +
      '    grp.Source = [src]\n' +
      '    grp.ProjectionType = "Default"\n' +
      '    for lbl in PROJ_LABELS:\n' +
      '        grp.addProjection(lbl)\n' +
      '    grp.Anchor.Direction = App.Vector(0, -1, 0)\n' +
      '    if SCALE is None:\n' +
      '        grp.ScaleType = "Automatic"\n' +
      '    else:\n' +
      '        grp.ScaleType = "Custom"; grp.Scale = SCALE\n' +
      '    for it in grp.Views:\n' +
      '        if it.Type != "FrontTopRight":\n' +
      '            it.HardHidden = HIDDEN_LINES\n' +
      '    doc.recompute()\n' +
      '    def cleanup():\n' +
      '        for o in (grp, tmpl, page):\n' +
      '            try:\n' +
      '                doc.removeObject(o.Name)\n' +
      '            except Exception:\n' +
      '                pass\n' +
      '        doc.recompute()\n' +
      '    stale = [it.Name for it in grp.Views if "Up-to-date" not in it.State]\n' +
      '    if stale:\n' +
      '        res["reason"] = "views not recomputed: " + ", ".join(stale)\n' +
      '        cleanup()\n' +
      '        return res\n' +
      '    def compose_once():\n' +
      '        gx, gy = _q(grp.X), _q(grp.Y)\n' +
      '        page_h = float(page.PageHeight)\n' +
      '        frags = []\n' +
      '        minx = miny = 1e9; maxx = maxy = -1e9\n' +
      '        for it in grp.Views:\n' +
      '            frag = TechDraw.viewPartAsSvg(it)\n' +
      '            if not frag:\n' +
      '                continue\n' +
      // Ids restart at "1" per view (MEASURED: a single view's own hidden-
      // line group can even repeat an id WITHIN itself), so strip rather
      // than rename -- composing more than one view with ids intact
      // collides on the very first duplicate.
      '            frag = re.sub(r\'\\s+id=\\s*"[^"]*"\', "", frag)\n' +
      '            if HIDDEN_LINES:\n' +
      '                frag = frag.replace(\'stroke-width="0.35"\', \'stroke-width="0.35" stroke-dasharray="2,1"\')\n' +
      '            ox, oy = gx + _q(it.X), page_h - (gy + _q(it.Y))\n' +
      '            ex = _extent(frag)\n' +
      '            if ex:\n' +
      '                minx = min(minx, ox + ex[0]); maxx = max(maxx, ox + ex[1])\n' +
      '                miny = min(miny, oy + ex[2]); maxy = max(maxy, oy + ex[3])\n' +
      '            frags.append((it.Name, it.Type, ox, oy, frag))\n' +
      '        return frags, minx, miny, maxx, maxy\n' +
      // Autoscale (ScaleType='Automatic') sizes to the PAGE, not the frame
      // minus titleblock, so it can still overflow the usable drawing
      // area -- step scale down and re-measure until it fits, or give up.
      // A caller-REQUESTED scale is never silently overridden this way:
      // one attempt only, refuse cleanly if it does not fit.
      '    scale_steps = [1.0, 0.5, 0.2, 0.1, 0.05]\n' +
      '    fx0, fy0, fx1, fy1 = FRAME\n' +
      '    frags = minx = miny = maxx = maxy = None\n' +
      '    fy1_eff = fy1\n' +
      '    fit = False\n' +
      '    attempt = 0\n' +
      '    while attempt < len(scale_steps):\n' +
      '        if attempt > 0 or SCALE is not None:\n' +
      '            grp.ScaleType = "Custom"\n' +
      '            grp.Scale = SCALE if SCALE is not None else scale_steps[attempt]\n' +
      '            doc.recompute()\n' +
      '        frags, minx, miny, maxx, maxy = compose_once()\n' +
      '        if not frags:\n' +
      '            break\n' +
      // grp.X/grp.Y is the group's own ANCHOR point, not the block's
      // centre -- MEASURED: at page centre (148.5, 105) on the golden
      // fixture, the raw (pre-recentre) block sits at x 118.50..264.21,
      // overrunning a 297mm sheet whose usable frame ends at 287 -- the
      // right-hand views would sit ON the titleblock if this were trusted
      // as-is. Recentre explicitly; this is a correctness bug if skipped,
      // not a cosmetic one.
      '        would_hit_tb = maxx > TB_X and maxy > TB_Y\n' +
      '        fy1_eff = TB_Y if would_hit_tb else fy1\n' +
      '        fit = (maxx - minx) <= (fx1 - fx0) and (maxy - miny) <= (fy1_eff - fy0)\n' +
      '        if fit or SCALE is not None:\n' +
      '            break\n' +
      '        attempt += 1\n' +
      '    if not frags:\n' +
      '        res["reason"] = "the projected views produced no visible geometry"\n' +
      '        cleanup()\n' +
      '        return res\n' +
      '    if not fit:\n' +
      '        res["reason"] = (\n' +
      '            "the drawing does not fit the sheet at the requested scale -- try a smaller scale or a larger sheet"\n' +
      '            if SCALE is not None else\n' +
      '            "the drawing does not fit the sheet even at 1:20 -- use a larger sheet"\n' +
      '        )\n' +
      '        cleanup()\n' +
      '        return res\n' +
      '    dx = (fx0 + fx1) / 2.0 - (minx + maxx) / 2.0\n' +
      '    dy = (fy0 + fy1_eff) / 2.0 - (miny + maxy) / 2.0\n' +
      '    sheet = open(SHEET_PATH, encoding="utf8").read().rstrip()\n' +
      '    body = "".join(\'<g transform="translate(%.4f,%.4f)">\\n%s</g>\\n\' % (ox + dx, oy + dy, f) for (_n, _t, ox, oy, f) in frags)\n' +
      '    with open(OUT_SVG, "w", encoding="utf8") as fh:\n' +
      '        fh.write(sheet[:sheet.rfind("</svg>")] + body + "</svg>\\n")\n' +
      '    res.update(\n' +
      '        ok=True,\n' +
      '        scale=float(grp.Scale),\n' +
      '        views=[{"name": n, "type": t} for (n, t, _x, _y, _f) in frags],\n' +
      '        bbox=[minx + dx, miny + dy, maxx + dx, maxy + dy],\n' +
      '    )\n' +
      '    cleanup()\n' +
      '    return res\n' +
      '_res = run()\n' +
      `open(${pyStr(OUT_PATH)}, "w").write(json.dumps(_res))\n`
    );
  },
};

export function attachDrawingCommands(session) {
  if (!session || typeof session.read !== 'function') {
    throw new Error('attachDrawingCommands: need a session with read() (see fc-session.mjs)');
  }
  // No throw-on-refusal here, deliberately: exportDrawing can fail for
  // ordinary, expected reasons (no solid yet, doesn't fit any scale step)
  // that the ADAPTER turns into a specific user-facing message -- same
  // split as session.bore()/session.fillet() one layer up from their own
  // emitters, just without this layer's own throw, since the caller needs
  // `reason` verbatim, not a generic "X failed".
  session.exportDrawing = (opts) => session.read(emit.exportDrawing(opts));
  return session;
}
