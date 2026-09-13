# `exportDrawing()` — TechDraw app-level bridge on the FreeCAD engine

Consolidated from `oracle-techdraw-bridge-design`'s investigation (2026-09-12), measured
against the `fc-kernel-techdraw-full` Docker image (the full, unstripped `kernel-build-final`
stage — needed for `App.getResourceDir()` to find TechDraw's bundled templates). This is
genuinely greenfield: nothing in `packages/` references TechDraw, drawing sheets, or SVG/PDF
export before this. Implementation-ready.

## The central question, answered

Does headless SVG/PDF export work from App-layer Python alone, with no GUI (`TechDrawGui` is
not built into this kernel)?

| Candidate | Result |
|---|---|
| `page.exportToSvg(path)` | Does not exist — `AttributeError` on `DrawPage` |
| `import TechDrawGui` | `ModuleNotFoundError` — GUI layer genuinely not built |
| **`TechDraw.viewPartAsSvg(view)`** | **WORKS** — returns a real HLR `<g>`+`<path>` SVG fragment, App-layer, per view |
| `TechDraw.writeDXFPage(page, path)` | WORKS — writes a full-sheet DXF, including dimensions |
| `TechDraw.writeDXFView(view, path)` | WORKS |
| Any App-layer **PDF** writer | **None exists.** PDF generation is `QPrinter`, GUI-only |

**Answer: yes, but not through one export call.** There's no page-level SVG writer — instead
the app composes the sheet itself from per-view SVG fragments. This is arguably the better
outcome anyway: the app controls its own titleblock and styling instead of inheriting
FreeCAD's own GUI chrome.

```
ModelDoc ──build()──▶ live FreeCAD session (already exists today)
                              │
                              ▼
              TechDraw::DrawPage + DrawSVGTemplate (sheet size)
                              │
                              ▼
                  TechDraw::DrawProjGroup ──addProjection('Front'|'Top'|
                              │              'Right'|'FrontTopRight')
                         doc.recompute()     → HLR runs, State Up-to-date
                              │
                              ▼
        per view: TechDraw.viewPartAsSvg(item) ──▶ "<g …><path d=…/></g>"
                              │                     (mm, Y-down, view-local)
                              ▼
      app composes: sheet template + <g transform="translate(x,y)">frag</g>
                              │
                              ▼
              /tmp/drawing.svg ──Module.FS.readFile──▶ Uint8Array
```

`TechDraw::DrawProjGroup` (the "auto-generate the standard views" object) is fully usable
headlessly — all four `addProjection()` calls succeeded, all items recomputed `Up-to-date`,
`AutoDistribute` placed them at 15mm spacing, both projection angles (`'First angle'`/
`'Third angle'`, exact enum strings) work.

**Scope: SVG output only, no automatic dimensioning.** No App-layer PDF writer exists at all
on this kernel — a caller wanting PDF converts the SVG browser-side, that's not this seam's
job. Automatic GD&T dimensioning is a much bigger, fuzzier problem than this feature should
try to solve in v1; the projected views themselves (front/top/right/iso on a titled sheet)
are the actual deliverable.

## Browser prerequisite — RESOLVED 2026-09-12

**`engine/build/g5-artifacts/` was rebuilt from `kernel-artifacts-browser` and now has TechDraw
compiled in.** New artifacts: `FreeCADCmd.wasm` 63,622,106 bytes (up from 53,334,897),
`FreeCADCmd.js` 293,897 bytes (up from 181,513) — the old ones are kept at
`engine/build/g5-artifacts-backup-2026-09-06/` for rollback. `engine/build/` is gitignored, so
this deploy is not a git commit.

Verified live in a real headless-browser tab (not just Node), via `engine/play/index.html` +
`serve.mjs` against `/kernel-browser/`: `import TechDraw` succeeds, a `TechDraw::DrawPage` +
`DrawSVGTemplate` + `DrawViewPart` recomputes, and `TechDraw.viewPartAsSvg(view)` returns a
real SVG fragment (`svg_len=308`) — `window.crossOriginIsolated` was `true` throughout. One
non-fatal warning appeared repeatedly: `Line Group File:
/freecad/share/Mod/TechDraw/LineGroup/LineGroup.csv is not readable` — the browser's preloaded
MEMFS data pack (`engine/play/freecad-data.data`) was built for the old Part/Sketcher/Material-
only kernel and doesn't include TechDraw's `Mod/TechDraw/Resources` tree. It didn't block
`viewPartAsSvg`, but if a future feature needs line-group/line-style resources, that data pack
needs rebuilding too — not attempted here, flagged for whoever touches this next.

The below was the original (now-superseded) prerequisite note, kept for history: every
measurement in this spec had run only against the Docker/Node kernel
(`fc-kernel-techdraw-full`), and `kernel-artifacts-browser` had never been rebuilt with
`BUILD_TECHDRAW=ON` — meaning `exportDrawing()` would have passed every test and then silently
done nothing in the real app. That gap is now closed.

## Interface addition

```ts
// packages/kernel/src/engine-adapter.ts

export type DrawingView = 'front' | 'top' | 'right' | 'left' | 'rear' | 'bottom' | 'iso';

export interface DrawingOptions {
  /** Sheet size. Default 'A4-landscape' (297x210mm). */
  sheet?: 'A4-landscape' | 'A3-landscape' | 'USLetter-landscape';
  /** Default ['front','top','right','iso']. */
  views?: DrawingView[];
  /** Default 'third-angle'. */
  projection?: 'first-angle' | 'third-angle';
  /** Omit for automatic (fit to sheet). */
  scale?: number;
  /** Dashed hidden-line rendering on the orthographic views. Default true. */
  hiddenLines?: boolean;
  /** Titleblock text. Default: the doc's own name. */
  title?: string;
}

/** Render `doc` as a real 2D engineering drawing -- a standard multi-view
 *  projection on a titled sheet -- and return SVG bytes, the same "adapter
 *  returns bytes, caller owns the Blob/download" split saveDocument() and
 *  packages/studio's mesh exporters already follow.
 *
 *  SVG, not PDF, deliberately: this kernel has NO App-layer PDF writer at
 *  all (verified -- TechDrawGui, which owns every QPrinter/QSvgGenerator
 *  path, is not built into the headless kernel). A caller wanting PDF
 *  converts the SVG browser-side; that is not this seam's job.
 *
 *  OcctEngineAdapter throws -- OCCT has no TechDraw concept at all, the
 *  same real "not supported on this engine" condition saveDocument() and
 *  openDocument() already established. Gate the UI on getEngineMode(). */
exportDrawing(doc: ModelDoc, opts?: DrawingOptions): Uint8Array;
```

`doc: ModelDoc` (not "whatever the session last built") matches `saveDocument(doc)` exactly
— which calls `this.build(doc)` first, so the output provably matches the argument handed in,
not stale session state.

## Layer split — who does what

```
FreeCadEngineAdapter.exportDrawing(doc, opts)      packages/kernel/
   │  1. this.build(doc)                            (rebuild, same as saveDocument)
   │  2. pick tip solid objName from build.shapes
   │  3. substitute titleblock text in JS
   │  4. Module.FS.writeFile('/tmp/reshape-sheet.svg', template)
   │
   ├──▶ session.exportDrawing({...})               packages/engine/fc-drawing.mjs
   │       emits Python ──▶ freecad_run_python()    (new file, attached like
   │         · DrawPage + DrawSVGTemplate            fc-commands.mjs)
   │         · DrawProjGroup + addProjection xN
   │         · doc.recompute()
   │         · TechDraw.viewPartAsSvg() per item
   │         · compose + write /tmp/drawing.svg
   │         · write JSON summary to OUT_PATH
   │       ◀── read() returns {scale, views, bbox, ok}
   │
   └──▶ Module.FS.readFile('/tmp/drawing.svg') ──▶ Uint8Array
```

The app owns the sheet and the titleblock; the kernel owns only the projected geometry. This
split is forced by two measured facts (no page-level SVG writer; `EditableTexts` substitution
never reaches `PageResult` — see below) but is also the split you'd want anyway: the app
controls its own styling instead of inheriting FreeCAD's.

## 1. `FreeCadEngineAdapter.exportDrawing()`

```ts
exportDrawing(doc: ModelDoc, opts: DrawingOptions = {}): Uint8Array {
  const session = this.requireSession();

  // (a) Rebuild, exactly as saveDocument() does -- guarantees the drawing
  //     matches the `doc` the caller handed in, not whatever the session
  //     last built.
  const build = this.build(doc);

  // (b) The tip solid is the LAST entry with kind === 'solid'. Same rule
  //     mesh()'s own _active_solid() uses in Python; passing the name
  //     explicitly is more honest than re-deriving it kernel-side.
  let objName: string | null = null;
  for (const v of build.shapes.values()) {
    const e = v as FcBuiltFeature;
    if (e.kind === 'solid') objName = e.objName;
  }
  if (!objName) {
    throw new Error(
      'exportDrawing: nothing to draw -- this model has no solid yet. ' +
      'A sketch on its own projects no edges; pad or extrude it into a solid first.'
    );
  }

  // (c) Sheet: the app's own template string, titleblock filled in HERE.
  //     Kernel-side substitution does NOT work (measured: EditableTexts is
  //     stored and read back correctly but PageResult comes out byte-identical
  //     with the placeholder intact -- the substitution lives in the GUI item).
  const sheet = SHEETS[opts.sheet ?? 'A4-landscape'];
  // CORRECTED: ModelDoc has no document-level `name` field (it's just
  // {version, features}) -- default to the tip solid's own Feature.name,
  // falling back to 'UNTITLED'.
  const svgTemplate = fillTitleBlock(sheet.template, {
    title: opts.title ?? tipFeature?.name ?? 'UNTITLED',
    scale: opts.scale ? formatScale(opts.scale) : '',   // filled in after autoscale
    date: new Date().toISOString().slice(0, 10),
  });
  session.Module.FS.writeFile(SHEET_PATH, new TextEncoder().encode(svgTemplate));

  // (d) Clear the target FIRST -- exportStl's own guard. Without it a failed
  //     export silently returns the PREVIOUS run's file and the user
  //     downloads a stale drawing with no symptom at all.
  try { session.Module.FS.unlink(OUT_SVG); } catch { /* first run */ }

  // (e) Kernel side.
  const info = session.exportDrawing({
    objName,
    sheetPath: SHEET_PATH,
    outPath: OUT_SVG,
    views: opts.views ?? ['front', 'top', 'right', 'iso'],
    projection: opts.projection ?? 'third-angle',
    scale: opts.scale ?? null,
    hiddenLines: opts.hiddenLines ?? true,
    area: sheet.drawingArea,          // [x0,y0,x1,y1] mm, titleblock excluded
  });

  if (!info.ok) throw new Error(`exportDrawing: ${info.reason}`);

  // (f) Read the bytes back -- saveDocument/exportStl's exact pattern.
  //     Module.FS.readFile throws an Emscripten ErrnoError with NO .message;
  //     letting it escape crashes studio.js's guard() (which does
  //     e.message.split(...)) and the user sees NOTHING -- no log line, no
  //     download, no error. exportStl already hit this and translates it
  //     (fc-session.mjs:231-237); do the same.
  let bytes: Uint8Array;
  try { bytes = session.Module.FS.readFile(OUT_SVG); }
  catch {
    throw new Error(
      'exportDrawing: the kernel wrote no SVG. Only a solid projects edges -- ' +
      'a sketch or a bare wire draws nothing. Pad it into a solid first.'
    );
  }
  if (!bytes.length) throw new Error('exportDrawing: produced an empty SVG (0 bytes)');
  return bytes;
}
```

Fill in a `{{SCALE}}` token in the returned bytes with `info.scale` if `opts.scale` was
omitted (autoscale) — see the sheet-template note below on why this substitution happens on
the JS side, once, after the kernel returns, rather than round-tripping again.

## 2. `packages/engine/fc-drawing.mjs` — the emitter

New file, `attachDrawingCommands(session)`, attached the same way `fc-commands.mjs`/
`fc-sketch.mjs` are. One `session.read()` call; the Python writes the SVG to `outPath` and a
JSON summary to `OUT_PATH`, so JS gets structured refusals instead of scraping stdout.

```python
import json, os, re
import FreeCAD as App
import TechDraw

LABEL = {'front':'Front','top':'Top','right':'Right','left':'Left',
         'rear':'Rear','bottom':'Bottom','iso':'FrontTopRight'}

doc = App.ActiveDocument
src = doc.getObject(OBJ_NAME)
res = {'ok': False, 'reason': None, 'views': [], 'scale': None}

if src is None or getattr(src,'Shape',None) is None or src.Shape.isNull() \
        or len(src.Shape.Faces) == 0:
    res['reason'] = 'no solid to project'
else:
    page = doc.addObject('TechDraw::DrawPage','ReshapePage')
    tmpl = doc.addObject('TechDraw::DrawSVGTemplate','ReshapeTemplate')
    tmpl.Template = SHEET_PATH          # app-supplied; NOT the resource dir
    page.Template = tmpl
    # exact enum: ['First angle', 'Third angle'] -- lowercase 'angle'
    page.ProjectionType = 'Third angle' if PROJECTION=='third-angle' else 'First angle'
    doc.recompute()

    grp = doc.addObject('TechDraw::DrawProjGroup','ReshapeGroup')
    page.addView(grp)
    grp.Source = [src]                  # MUST precede addProjection()
    grp.ProjectionType = 'Default'      # inherit the page's
    for v in VIEWS:
        grp.addProjection(LABEL[v])
    grp.Anchor.Direction = App.Vector(0,-1,0)     # front = looking along -Y
    if SCALE is None: grp.ScaleType = 'Automatic'
    else:             grp.ScaleType = 'Custom'; grp.Scale = SCALE
    for it in grp.Views:
        if it.Type != 'FrontTopRight':
            it.HardHidden = HIDDEN_LINES
    doc.recompute()

    stale = [it.Name for it in grp.Views if 'Up-to-date' not in it.State]
    if stale: res['reason'] = 'views not recomputed: ' + ', '.join(stale)
```

Composition — this is where every trap lives:

```python
def q(v): return v.Value if hasattr(v,'Value') else float(v)

def extent(frag):
    # CORRECTED (2026-09-12, found by track3-export-drawing): the naive
    # version below -- re-grouping every number in `d="..."` into alternating
    # (x,y) pairs -- is right for M/L but WRONG for an elliptical arc:
    # `A rx,ry,x-axis-rotation,large-arc-flag,sweep-flag,x,y` is 7 numbers,
    # only the LAST 2 are a coordinate. Measured directly: this fixture's
    # own isometric view emits `A8 4.6188 180 0 1 -15.0711 -14.2887` for the
    # hole's rendered arc, and the naive pairing treats `180` (the arc's own
    # x-axis-rotation, degrees) as an x-coordinate -- inflating the composed
    # pre-recentre bbox's max-x from the correct 264.21 to 408.86. A real
    # command-aware tokenizer is required (split by M/L/A/C, take only the
    # trailing coordinate pair off an A's 7 numbers). ALSO: TechDraw emits a
    # bare `<circle cx cy r>` (not a `<path>`) when a hole is viewed straight
    # down its own axis -- a d="..."-only reader misses it entirely; handle
    # <circle> elements too.
    xs, ys = [], []
    for d in re.findall(r'd="([^"]+)"', frag):
        t = re.findall(r'-?\d+\.?\d*(?:[eE]-?\d+)?', d)
        for i in range(0, len(t)-1, 2):
            xs.append(float(t[i])); ys.append(float(t[i+1]))
    return (min(xs),max(xs),min(ys),max(ys)) if xs else None

PAGE_H = float(page.PageHeight)         # plain float; view X/Y are Quantities
gx, gy = q(grp.X), q(grp.Y)
frags = []; minx=miny=1e9; maxx=maxy=-1e9

for it in grp.Views:
    frag = TechDraw.viewPartAsSvg(it)
    if not frag:                        # returns '' and raises NOTHING -- an
        continue                        # empty Source silently yields no fragment
    frag = re.sub(r'\s+id=\s*"[^"]*"', '', frag)   # ids restart at "1" per view --
                                                     # must be stripped/renamed or
                                                     # composing multiple views
                                                     # collides on duplicate ids
    if HIDDEN_LINES:   # 2nd <g> is the hidden group: 0.35 wide, NO dasharray by
                        # default -- measured: HardHidden=True gives exactly 2
                        # <g> elements, widths 0.7 then 0.35, NEITHER dashed
        frag = frag.replace('stroke-width="0.35"',
                            'stroke-width="0.35" stroke-dasharray="2,1"')
    # Page coords are Y-UP from sheet bottom-left; SVG is Y-down.
    # Fragment is ALREADY Y-down -> no flip needed on the fragment itself.
    # Item X/Y are GROUP-relative, so add the group's own anchor position.
    ox, oy = gx + q(it.X), PAGE_H - (gy + q(it.Y))
    ex = extent(frag)
    if ex:
        minx=min(minx,ox+ex[0]); maxx=max(maxx,ox+ex[1])
        miny=min(miny,oy+ex[2]); maxy=max(maxy,oy+ex[3])
    frags.append((it.Name, it.Type, ox, oy, frag))

# grp.X/Y is the ANCHOR, not the block centre. MEASURED: a group placed at
# page centre (148.5,105) on the golden-case fixture below put the block at
# x 118.50..264.21 -- overrunning a 297mm sheet whose frame ends at 287, i.e.
# the right-hand views sit ON the titleblock. This is a correctness bug if
# skipped, not cosmetic: recentre explicitly, don't trust grp.X/Y alone.
fx0,fy0,fx1,fy1 = FRAME                       # inner frame, SVG coords
if (minx+maxx)/2 + (maxx-minx)/2 > TB_X and \
   (miny+maxy)/2 + (maxy-miny)/2 > TB_Y:      # would hit the titleblock
    fy1 = TB_Y
dx = (fx0+fx1)/2.0 - (minx+maxx)/2.0
dy = (fy0+fy1)/2.0 - (miny+maxy)/2.0

# Before composing, CLAMP: if the block doesn't fit the frame, step scale
# down (1 -> 1:2 -> 1:5 -> 1:10 -> 1:20), recompute, and re-measure. Autoscale
# (grp.ScaleType='Automatic') sizes to the PAGE, not the frame minus
# titleblock, so it can still overflow the usable drawing area.
# if maxx-minx > fx1-fx0 or maxy-miny > fy1-fy0: <step down, recompute, retry>

sheet = open(SHEET_PATH, encoding='utf8').read().rstrip()
body  = ''.join('<g transform="translate(%.4f,%.4f)">\n%s</g>\n' % (ox+dx, oy+dy, f)
                for (_n,_t,ox,oy,f) in frags)
open(OUT_SVG,'w',encoding='utf8').write(
    sheet[:sheet.rfind('</svg>')] + body + '</svg>\n')

for o in (grp, tmpl, page):     # leave the session as found -- tree() shows all
    doc.removeObject(o.Name)
doc.recompute()

res.update(ok=True, scale=float(grp.Scale),
           views=[{'name':n,'type':t} for (n,t,_x,_y,_f) in frags],
           bbox=[minx+dx, miny+dy, maxx+dx, maxy+dy])
open(OUT_JSON,'w').write(json.dumps(res))
```

**Cleanup matters**: the `DrawProjGroup`/`DrawSVGTemplate`/`DrawPage` objects are removed
after composing, so `tree()` shows the document unchanged after an export — a leaked
`ReshapePage` would otherwise show up in the user's own feature tree with no other symptom.

## 3. `SHEETS` / `fillTitleBlock` — three non-obvious points

- **Skip `freecad:editable` entirely.** Measured: the kernel stores/reads `EditableTexts`
  correctly, but `PageResult` comes back byte-identical with the placeholder intact —
  substitution lives in the GUI item, not the App layer. Use `{{TOKEN}}` markers and
  substitute in JS *before* `Module.FS.writeFile` — the kernel never sees a token.
- **Leave `{{SCALE}}` unsubstituted when `opts.scale` is omitted.** It survives into the
  composed output; JS replaces it once with `info.scale` on the returned bytes. No second
  kernel round-trip needed.
- **Every template must carry real `width`/`height` attributes** (page size is read from
  them — omit and you get a zero-size page with silently broken placement) and end in a
  literal `</svg>` (the composer splices at the last occurrence). Escape `<>&` in every
  substituted value.

Sizes: A4-landscape 297×210mm, A3-landscape 420×297mm, USLetter-landscape 279.4×215.9mm;
10mm margin; titleblock 120×30mm bottom-right (160×36mm on A3).

## Verification (for a critic, against the real kernel)

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "<repo>/engine/scripts:/host-scripts:ro" \
  -e SMOKE_PY_FILE=/host-scripts/<probe>.py fc-kernel-techdraw-full \
  node --experimental-wasm-exnref /host-scripts/smoke.mjs /work/build/bin/FreeCADCmd.js /tmp/out
```

| Claim | Measured |
|---|---|
| `page.exportToSvg` | `AttributeError` — does not exist |
| `import TechDrawGui` | `ModuleNotFoundError` |
| `Page.ProjectionType` enum | `['First angle','Third angle']` |
| `ScaleType` enum | `['Page','Automatic','Custom']` |
| `HardHidden=True` | exactly 2 `<g>`, widths `0.7` then `0.35`, neither dashed by default |
| empty `Source` | `viewPartAsSvg` → `''`, no exception |
| `PageResult` after `setEditFieldContent` | unchanged, placeholder survives (confirms the kernel-side-substitution rejection above) |
| `import TechDraw`, `Mod/TechDraw` resource dir absent | succeeds (statically linked C++, no runtime resource dependency for the module itself) |
| `writeDXFPage` | writes a real file, contains `DIMENSION` entities |

**Golden case** (60×40×25 box minus r8 hole at (20,20), A4 landscape, third angle,
`ScaleType='Automatic'`, views Front/Top/Right/FrontTopRight):

| Quantity | Value |
|---|---|
| `grp.Scale` | `1.0` |
| `grp.X` / `grp.Y` | `148.5mm` / `105.0mm` (page centre) |
| bbox before recentring | `x 118.50..264.21, y 16.26..117.50` |
| bbox after recentring (probe's conservative area rule) | `x 15.64..161.36, y 54.38..155.62` |

The pre-recentre bbox (`118.50..264.21`) is a stable golden number, since it depends only on
the kernel's own placement — pin it directly. **The post-recentre `dx`/`dy` are NOT stable**
(they depend on exactly which titleblock-avoidance rule ships) — a critic should assert the
*invariant* instead: every path coordinate, after its `translate`, lies inside the sheet's
inner frame, and the block's centre sits within ~1mm of the chosen drawing area's centre. The
overrun on the pre-recentre bbox (`264.21` against a 287mm frame edge on a 297mm sheet) is
itself the proof that `grp.X`/`grp.Y` is an anchor, not a block centre — skipping the
recentring step entirely would ship a drawing with the right-hand views sitting on the
titleblock, passing a naive "did it produce bytes" check.

Two easy-to-skip items, worth keeping:
- **Run the whole suite a second time with `Mod/TechDraw` hardlinked out of
  `FREECAD_MOD_SRC`** — the only automated guard against "works in Node, dies in the
  browser" resource-path assumptions, one extra Docker invocation.
- **Assert `tree()` is unchanged after an export** — easy to forget, and a leaked
  `ReshapePage` shows up in the user's own feature tree with no other symptom.

And the standing prerequisite from the top of this doc, not a test but will invalidate every
browser-level test until done: **rebuild `kernel-artifacts-browser` and redeploy
`engine/build/g5-artifacts/`.**
