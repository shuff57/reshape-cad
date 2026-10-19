// CONTRACT COPY (extrude-pocket group) of phase7/pane/lib/translate-p4.mjs. ONLY the 'extrude' and 'pocket' cases of planFeature differ (they map
// the pull/pocket options); everything else is the phase 7 translator untouched. See extrude-pocket-measure.mjs and extrude-pocket.json.
// (original header follows)
// SPIKE, referee only. PHASE 4 COPY of ../../phase3/host/translate-p3.mjs. Differences from it, and only these:
//   1. a shell's open face, a fillet/chamfer's edge and a draft's face are NOT looked up in brep-rs. translateDoc asks
//      resolve-names.mjs, which reads solidcraft's own topology (bridge `topology` snapshot of the feature's own shape) and
//      returns a pick point or a plain refusal sentence; planFeature turns a refusal into the feature's refusal;
//   2. translateDoc remembers how many accepted commands each built feature needed (st.accLen), so a name can be read
//      from the shape solidcraft held right after the feature it names was built;
//   3. a built feature record carries the resolution evidence (candidate counts, persistent names, cross-checks).
// planFeature's per-kind logic is otherwise untouched. Not an engine, not an EngineAdapter, not in npm test.

//
// ModelDoc -> solidcraft command JSON, executed PER FEATURE on fresh sessions (prefix 1..k).
//
// Refusal contract (AGENTS.md): a feature that cannot be mapped, or that solidcraft refuses, is refused in a plain
// sentence alongside whatever DID build; a feature that depends on a refused or already-consumed feature is refused
// with a pointer to it. Nothing here falls back to another engine.
//
// ModelDoc semantics were read off packages/brep-adapter/src/occt-build.ts (the same file the parity gate trusts):
//   - a sketch lies in (u, v); an extrude sweeps along u x v (xy +Z, xz -Y, yz +X); a revolve lays the outline in
//     (u, n) and spins about n through the frame origin; a pocket/groove cuts against / around the same frame.
//   - primitives are built centred at the origin, rotated about the ORIGIN, then translated by `center`.
//   - a hole is a cylinder cut, centred on target-bbox-centre + center, `depth` long, along `axis`.
//   - a mirror reflects through the part's nearer bbox face on the plane's axis and fuses with the original.
//
// Picks: solidcraft picks faces/edges by a 3D point. In phase 0-3 the point for a `between`/`swept`/`cap`/`carried` name came
// from brep-rs `resolve`. PHASE 4: it comes from solidcraft's own topology (resolve-names.mjs); brep-rs is not used at run time.

const FEATURE_KINDS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge', 'sketch', 'datum', 'extrude', 'combine',
  'blend', 'revolve', 'groove', 'pocket', 'mirror', 'pattern', 'hole', 'shell', 'move', 'rotate', 'fillet', 'draft'];
export { FEATURE_KINDS };

const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXN = { x: 'X', y: 'Y', z: 'Z' };
const add = (a, b) => a.map((v, i) => v + b[i]);
const len = (a) => Math.hypot(...a);
const isZero3 = (v) => !v || (v[0] === 0 && v[1] === 0 && v[2] === 0);
const bname = (id) => `b_${id}`;

/** named-plane frame, identical to model-types.ts NAMED_PLANE_FRAMES / sketchFrameOf (copied, with a check in run-phase0). */
const NAMED = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};
function frameOf(s, mt) {
  if (mt && mt.sketchFrameOf) return mt.sketchFrameOf(s);
  if (s.frame) {
    const { origin, u, v } = s.frame;
    return { origin, u, v, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
  }
  const a = NAMED[s.plane ?? 'xy'] ?? NAMED.xy;
  const o = s.offset ?? 0;
  return { origin: a.n.map((c) => c * o), ...a };
}

import { evenOddPicks, soupLoops } from './soup-regions.mjs';
import { selfTouch, taperFold, taperFoldLoops, outlineSize, sampleOutline, MIN_LEN, MIN_ROUND, GAP } from './outline-guard.mjs';
import { mapSketch } from '../phase7/pane/lib/sketch-map.mjs';
import { resolveName, pickPoint } from '../phase7/pane/lib/resolve-names.mjs';
const refuse = (sentence) => ({ refusal: sentence });

/**
 * ROUND 3. A polygon that repeats a point (the same corner twice in a row, or the first point again at the end) is the same outline without
 * the repeat: the library's outlineOf() refuses it ("two corners on top of each other"), which round 2 passed on as an unusable outline although
 * brep-rs builds it. Repeats are dropped when the sketch is a plain polygon (no rules, no legacy bulges); `rounds` and `chamfers` follow
 * their corner. Anything else is left to the refusal sentence below.
 */
function cleanSketch(sk) {
  if (!sk || isSoup(sk) || sk.shape === 'circle' || !Array.isArray(sk.points) || sk.points.length < 3) return sk;
  if ((sk.constraints && sk.constraints.length) || (sk.bulges && Object.keys(sk.bulges).length)) return sk;
  const P = sk.points;
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-9;
  const keep = []; const map = [];
  for (let i = 0; i < P.length; i++) {
    if (keep.length && same(P[i], P[keep[keep.length - 1]])) { map.push(keep.length - 1); continue; }
    keep.push(i); map.push(keep.length - 1);
  }
  while (keep.length > 1 && same(P[keep[keep.length - 1]], P[keep[0]])) { keep.pop(); for (let i = 0; i < map.length; i++) if (map[i] === keep.length) map[i] = 0; }
  if (keep.length === P.length) return sk;
  const remap = (rec) => {
    if (!rec || !Object.keys(rec).length) return rec;
    const out = {};
    for (const [k, v] of Object.entries(rec)) { const j = map[Number(k)]; if (j !== undefined && !(j in out)) out[j] = v; }
    return out;
  };
  const c = { ...sk, points: keep.map((i) => P[i]) };
  if (sk.rounds) c.rounds = remap(sk.rounds);
  if (sk.chamfers) c.chamfers = remap(sk.chamfers);
  return c;
}
/** Why outlineOf() gave nothing, in a sentence a student can act on (never the library's own text, which is about an edit). */
function noOutlineSentence(sk, o) {
  const pts = (o && o.points) || sk.points || [];
  if (pts.length) {
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const h = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    if (w <= 1e-9 || h <= 1e-9) return `the outline of sketch ${sk.id} is flat: it is 0 mm ${w <= 1e-9 ? 'wide' : 'tall'}, so it has no area to pull; give it a size in both directions`;
  }
  return `sketch ${sk.id} has two corners on the very same spot, so one of its sides has no length and the outline is not a shape; move the corners apart or delete the extra one`;
}

/** Sketch outline -> sketch.* commands (inside an open sketch). Returns {cmds} or {refusal}. */
const isSoup = (sk) => sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function profileCmds(sk, ctx) {
  if (isSoup(sk)) return refuse(`sketch ${sk.id} is drawn as rows and rules (a soup); it is mapped by inSketch, not here`);
  const o = ctx.arc.outlineOf(sk);
  if (!o.ok) return refuse(noOutlineSentence(sk, o));
  if (sk.shape === 'circle') {
    const [a, b] = o.points;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { cmds: [{ command: 'sketch.circle.center', params: { center: c, diameter: Math.hypot(b[0] - a[0], b[1] - a[1]) } }] };
  }
  const pts = o.points;
  const bulges = o.bulges ?? {};
  if (!Object.values(bulges).some((g) => g)) {
    return { cmds: [{ command: 'sketch.line', params: { points: pts.map((p) => [p[0], p[1]]), closed: true } }] };
  }
  const cmds = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const g = bulges[i];
    if (!g) { cmds.push({ command: 'sketch.line', params: { points: [a, b] } }); continue; }
    // same arc construction as occt-build.ts sketchWire: a point on the arc halfway round
    const { center, radius, startAngle, endAngle } = ctx.arc.arcFromBulge(a, b, g);
    let sweep = endAngle - startAngle;
    if (g > 0 && sweep < 0) sweep += Math.PI * 2;
    if (g < 0 && sweep > 0) sweep -= Math.PI * 2;
    const mid = startAngle + sweep / 2;
    cmds.push({ command: 'sketch.arc.three_point', params: { start: a, end: b, through: [center[0] + radius * Math.cos(mid), center[1] + radius * Math.sin(mid)] } });
  }
  return { cmds };
}

function inSketch(sk, ctx, st, { revolve = false, allowSoup = true } = {}) {
  if (isSoup(sk)) {
    if (revolve || !allowSoup) return refuse(`sketch ${sk.id} is a constrained sketch (rows and rules); this demo maps those for extrude and pocket only, not for revolve, groove or blend`);
    const name = `sk_${sk.id}_${st.counter++}`;
    const m = mapSketch(sk, { name });
    if (!m.ok) return refuse(`sketch ${sk.id} cannot be handed to solidcraft's solver: ${m.refusals.map((r) => `rule ${r.rule + 1}${r.kind ? ` (${r.kind})` : ''}: ${r.sentence}`).join('; ')}`);
    if (ctx.soups) ctx.soups[name] = { sketchId: sk.id, geoms: sk.geoms, rules: sk.rules ?? [], names: m.names, notes: m.notes ?? [], ruleMap: m.ruleMap };
    return { name, soup: true, cmds: [...m.commands, { command: 'sketch.finish', params: {} }] };
  }
  const fr = frameOf(sk, ctx.mt);
  const prof = profileCmds(sk, ctx);
  if (prof.refusal) return prof;
  const name = `sk_${sk.id}_${st.counter++}`;
  return {
    name,
    cmds: [
      { command: 'sketch.create', params: { name, plane: { origin: fr.origin, x_dir: fr.u, y_dir: revolve ? fr.n : fr.v } } },
      ...prof.cmds,
      { command: 'sketch.finish', params: {} },
    ],
  };
}

const rotCmds = (name, rotate) => {
  const out = [];
  if (isZero3(rotate)) return out;
  ['x', 'y', 'z'].forEach((a, i) => { if (rotate[i]) out.push({ command: 'solid.move', params: { bodies: [name], axis: AX[a], angle: rotate[i] } }); });
  return out;
};
const moveCmd = (name, t) => ({ command: 'solid.move', params: { bodies: [name], translate: t } });

/** Edge points for a primitive's whole-shape `round`: box = 12 edge midpoints, cylinder = the two rim circles. */
function roundPoints(f, base) {
  if (f.kind === 'box') {
    const [w, d, h] = f.size.map((v) => v / 2);
    const c = base;
    const p = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0], c[1] + sy * d, c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0] + sx * w, c[1], c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.push([c[0] + sx * w, c[1] + sy * d, c[2]]);
    return p;
  }
  return [[base[0] + f.radius, base[1], base[2] + f.height / 2], [base[0] + f.radius, base[1], base[2] - f.height / 2]];
}


// ---- pull / pocket option mapping (CONTRACT, extrude-pocket group) -------------------------------------------------------------
// Semantics are the ModelDoc ones, read off archive/brep-rs/src/wasm.rs (extrude arm ~1880, pocket arm ~1985, slanted_prism ~852) and
// pinned against live OCCT, brep-rs and analytic values by extrude-pocket-measure.mjs. Along the sketch normal n = u x v:
//   pull:   sgn = (reversed ? -1 : 1) * sign(height); the solid spans sgn*[-back, span-back]   (span = |h| + length2, back = length2;
//           midplane: span = |h|, back = |h|/2)
//   pocket: the tool spans sgn*[back-span, back]  (sgn also carries sign(depth)); through = down to the far end of the part, no second length
//   slant (direction, not parallel to n): sweep S = dhat * mag * sgn, mag = span/|dhat.n| (alongNormal) or span; the profile starts at -S*back/span.
// solidcraft (pinned fe3717f) has solid.extrude {distance, distance2, direction positive|negative, taper, through_all} but NO oblique direction
// (an array `direction` is silently read as "positive"; this mapping never passes one), so a slanted pull is a ruled loft of two copies of the outline.
const SIGN = (x) => (x < 0 ? -1 : 1);
const fmtMm = (x) => String(+Number(x).toPrecision(3));
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const TAPER_LIMIT = 89.9;
const MAX_SHAPES = 24; // ROUND 4: most shapes (loops) in one pull/pocket sketch. 24 round holes were measured to build (extrude-pocket-timing.txt); above that nothing was measured and one sc.run cannot be interrupted, so it is refused

/** Validate and normalise the options of one pull/pocket into {up, down, through, taper, slant}. Refusal = a plain sentence. */
function optionPlan(kind, f, sk, ctx, bboxOfTarget = null) {
  const len0 = kind === 'pull' ? f.height : f.depth;
  const L = Math.abs(len0);
  const noun = kind === 'pull' ? 'pull' : 'pocket';
  if (!(L > 0) && !f.through) return { refusal: kind === 'pull' ? 'the pull height is 0, so there is nothing to pull' : 'the pocket depth is 0, so there is nothing to cut' };
  if (L < MIN_LEN && !f.through) return { refusal: `the ${kind === 'pull' ? 'pull height' : 'pocket depth'} ${fmtMm(L)} mm is under ${MIN_LEN} mm, which is too small to build; make it at least ${MIN_LEN} mm` };
  const mid = !!f.midplane;
  const l2 = mid || !(f.length2 > 0) ? 0 : f.length2;
  if (l2 > 0 && l2 < MIN_LEN) return { refusal: `length2 ${fmtMm(l2)} mm is under ${MIN_LEN} mm, which is too small to build; make it at least ${MIN_LEN} mm` };
  const taper = f.taper ?? 0;
  if (Math.abs(taper) > TAPER_LIMIT) return { refusal: `a taper of ${taper} degrees cannot be built: a taper leans the walls by at most ${TAPER_LIMIT} degrees either way` };
  const fr = frameOf(sk, ctx.mt);
  const n = cross3(fr.u, fr.v);
  const nl = Math.hypot(...n);
  const nn = n.map((c) => c / nl);
  let dir = f.direction ?? null;
  let flip = false;
  let slant = null;
  if (dir) {
    const dl = Math.hypot(...dir);
    const dh = dir.map((c) => c / dl);
    const c = dot3(dh, nn);
    const parallel = Math.hypot(...cross3(dh, nn)) <= 1e-9;
    const eff = kind === 'pull' ? c : -c; // a pocket's tool is the pull swept the other way
    if (parallel) { flip = eff < 0; dir = null; } else {
      if (Math.abs(c) < 1e-6) return { refusal: 'the direction lies in the sketch plane, so it never leaves the profile; pick a direction that points out of the plane' };
      slant = { dh, c, alongNormal: f.alongNormal !== false };
    }
  }
  const sgn0 = (f.reversed ? -1 : 1) * (flip ? -1 : 1) * SIGN(len0);
  const through = kind === 'pocket' && !!f.through;
  // through-all together with midplane cuts the whole part both ways (brep-rs and FreeCAD agree, measured). Together with length2 the
  // second length has no meaning (the cut already runs to the end of the part), and brep-rs drops it without a word: refuse instead.
  if (through && l2 > 0) return { refusal: 'through together with length2 is not built, because it could mean two different cuts (the cut ignoring length2, or the cut also reaching length2 on the other side of the sketch); use through alone, or length2 without through' };
  if (taper !== 0 && slant) return { refusal: `a taper and a direction together are not built yet: use one or the other` };
  if (taper !== 0 && (mid || l2 > 0)) return { refusal: `a taper together with ${mid ? 'midplane' : 'length2'} is not built yet: use one of them, or set the taper to 0` };
  const span = mid ? L : L + l2;
  const back = mid ? L / 2 : l2;
  // extents along +n (up) and -n (down) for the straight case. pull: sgn*[-back, span-back]; pocket: sgn*[back-span, back]
  let up; let down;
  if (kind === 'pull') { if (sgn0 > 0) { up = span - back; down = back; } else { up = back; down = span - back; } }
  else if (sgn0 > 0) { up = back; down = span - back; } else { up = span - back; down = back; }
  // how far a through-all cut has to reach: from the sketch plane to the farthest corner of the target's box, along the travel direction
  let reach = null;
  if (through) {
    if (!bboxOfTarget) return { refusal: 'a through-all pocket needs the part it cuts, and it was not measured' };
    const o = fr.origin;
    const lo = bboxOfTarget.slice(0, 3); const hi = bboxOfTarget.slice(3);
    let mx = -Infinity; let mn = Infinity;
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) { const t = dot3([x - o[0], y - o[1], z - o[2]], nn); mx = Math.max(mx, t); mn = Math.min(mn, t); }
    reach = { maxN: mx, minN: mn };
  }
  return { kind, noun, L, span, back, taper, slant, through, mid, sgn: sgn0, up, down, nn, fr, reach };
}

function sheetCmds(name, origin, fr, prof) {
  return [{ command: 'sketch.create', params: { name, plane: { origin, x_dir: fr.u, y_dir: fr.v } } }, ...prof, { command: 'sketch.finish', params: {} }];
}

/** Guards on the outline itself (bow-tie, tiny outline, folded taper). Returns a plain sentence or null. */
function outlineGuards(o, s, sk, ctx) {
  if (s.soup) return null; // the soup path has its own checks (soup-regions.mjs)
  const out = ctx.arc.outlineOf(sk);
  if (!out.ok) return null;
  const oo = { ...out, shape: sk.shape };
  const size = outlineSize(oo, ctx.arc);
  if (size.w <= 1e-9 || size.h <= 1e-9) return sk.shape === 'circle' ? 'the circle has a diameter of 0 mm, so it has no area to pull; give it a diameter' : `the outline is flat: it is 0 mm ${size.w <= 1e-9 ? 'wide' : 'tall'}, so it has no area to pull; give it a size in both directions`;
  if (size.w < MIN_LEN || size.h < MIN_LEN) return `the outline is ${fmtMm(Math.min(size.w, size.h))} mm across, under ${MIN_LEN} mm, which is too small to build; draw it larger`;
  if (hasCurve(sk, ctx) && Math.min(size.w, size.h) < MIN_ROUND) return `the round outline is ${fmtMm(Math.min(size.w, size.h))} mm across, under ${MIN_ROUND} mm, which is too small to build; draw it larger`;
  const bad = selfTouch(oo, ctx.arc);
  if (bad === 'cross') return 'two edges of the outline cross each other, so it does not enclose one area; redraw it without crossing';
  if (bad === 'touch') return 'two parts of the outline touch each other, so it does not enclose one clean area; pull them apart';
  if (o.taper) {
    // wall travel at the far end of the sweep: positive taper = the walls lean outward
    const reach = o.through ? Math.max(0, o.reach ? (o.sgn > 0 ? -o.reach.minN : o.reach.maxN) : 0) : o.span;
    const d = reach * Math.tan((o.taper * Math.PI) / 180);
    const circleR = sk.shape === 'circle' ? size.minRadius : null;
    const fold = taperFold(oo, ctx.arc, d, circleR);
    if (fold) return `a taper of ${o.taper} degrees over ${+reach.toFixed(3)} mm makes the outline fold over itself (its walls would cross before the end), so nothing is built; use a smaller taper or a shorter length`;
  }
  return null;
}

/** The same cut as a finite tool: a through-all cut becomes a tool long enough to cover the whole part (only used to measure what the cut removes). */
function finiteTool(o) {
  if (!o.through) return o;
  const trav = o.sgn > 0 ? -o.reach.minN : o.reach.maxN; // how far the tool has to travel along its direction to clear the part
  if (o.mid) {
    const a = Math.max(o.reach.maxN, 0) + 1; const b = Math.max(-o.reach.minN, 0) + 1;
    const m = Math.max(a, b);
    return { ...o, through: false, up: m, down: m, span: 2 * m, back: m, slant: o.slant && { ...o.slant, alongNormal: true } };
  }
  const ext = Math.max(trav, 0) + 1;
  return { ...o, through: false, up: o.sgn > 0 ? 0 : ext, down: o.sgn > 0 ? ext : 0, span: ext, back: 0, slant: o.slant && { ...o.slant, alongNormal: true } };
}

/** The solidcraft commands for one planned pull/pocket. body = {operation, body_name|targets}. */
function emitSweep(o, s, sk, ctx, st, body, only) {
  const g = outlineGuards(o, s, sk, ctx);
  if (g) return { refusal: g };
  if (o.slant) {
    // A slanted sweep: loft two copies of the outline, `S` apart (solidcraft has no oblique extrude). One classic outline (straight, round or
    // with arcs); a sketch drawn as rows and rules is refused (brep-rs refuses the same ones).
    if (s.soup) return { refusal: 'a direction is only built for one plain outline; this sketch has holes or several shapes, so draw one outline or drop the direction' };
    const { dh, c, alongNormal } = o.slant;
    let span = o.span; let back = o.back;
    if (o.through) {
      // cut to the far end of the part along the slanted travel; the tool's n-extent has to cover the whole box on that side
      const tn = (o.sgn > 0 ? 1 : -1) * SIGN(c); // travel along +n when positive
      const need = tn > 0 ? o.reach.maxN : -o.reach.minN;
      const needBack = tn > 0 ? -o.reach.minN : o.reach.maxN;
      if (!o.mid && !(need > 0)) return { refusal: 'it does not touch the part, so it cuts nothing; move the sketch onto the part or change the direction' };
      const m = Math.max(need, o.mid ? needBack : 0, 0) + 1;
      span = o.mid ? 2 * m : m; back = o.mid ? m : 0;
      const mag = span / Math.abs(c);
      const S = dh.map((x) => x * mag * o.sgn);
      const k = back / span;
      const p0 = o.fr.origin.map((x, i) => x - S[i] * k);
      const p1 = p0.map((x, i) => x + S[i]);
      const section = (origin, name) => s.cmds.map((cmd) => (cmd.command === 'sketch.create' ? { ...cmd, params: { ...cmd.params, name, plane: { ...cmd.params.plane, origin } } } : cmd));
      const a = `sk_${sk.id}_${st.counter++}a`; const b = `sk_${sk.id}_${st.counter++}b`;
      return { cmds: [...section(p0, a), ...section(p1, b), { command: 'solid.loft', params: { sections: [{ sketch: a }, { sketch: b }], ...body } }] };
    }
    const mag = span / (alongNormal ? Math.abs(c) : 1);
    const S = dh.map((x) => x * mag * o.sgn);
    const k = back / span;
    const p0 = o.fr.origin.map((x, i) => x - S[i] * k);
    const p1 = p0.map((x, i) => x + S[i]);
    const section = (origin, name) => s.cmds.map((cmd) => (cmd.command === 'sketch.create' ? { ...cmd, params: { ...cmd.params, name, plane: { ...cmd.params.plane, origin } } } : cmd));
    const a = `sk_${sk.id}_${st.counter++}a`; const b = `sk_${sk.id}_${st.counter++}b`;
    return { cmds: [...section(p0, a), ...section(p1, b), { command: 'solid.loft', params: { sections: [{ sketch: a }, { sketch: b }], ...body } }] };
  }
  const ex = { sketch: s.name, ...body };
  let ntool = 1;
  if (s.soup) {
    // solidcraft's default is ALL profiles, so a loop standing inside another fills its hole again. Even-odd: pick the material regions.
    const eo = evenOddPicks(sk);
    if (eo.sentence) return { refusal: eo.sentence };
    if (eo.loops > MAX_SHAPES) return { refusal: `this sketch has ${eo.loops} separate shapes, more than the ${MAX_SHAPES} that one ${o.noun ?? 'pull'} is built with (SolidCraft needs about a second for each and cannot be interrupted); split them over two ${o.noun ?? 'pull'}s` };
    if (o.taper) {
      // ROUND 4: a taper on holes / several shapes is built (measured against the closed form and live OCCT) as long as no wall folds, no hole closes and no two
      // shapes grow into each other before the end of the sweep; taperFoldLoops walks the offset of every loop in 64 steps and refuses otherwise.
      const reachT = o.through ? Math.max(0, o.reach ? (o.sgn > 0 ? -o.reach.minN : o.reach.maxN) : 0) : o.span;
      const dT = reachT * Math.tan((o.taper * Math.PI) / 180);
      const foldT = taperFoldLoops(eo.polys.map((poly, i) => ({ poly, depth: eo.depths[i] })), dT);
      if (foldT) return { refusal: `a taper of ${o.taper} degrees over ${+reachT.toFixed(3)} mm ${foldT.why === 'loops' ? 'makes two shapes of the sketch (or a hole and its outline) run into each other' : 'makes an outline fold over itself or a hole close up'} before the end, so nothing is built; use a smaller taper or a shorter length` };
    }
    if (eo.loops > 1) { ex.profiles = (only === undefined ? eo.picks : [eo.picks[only]]).map((p) => ({ point: p })); ntool = eo.picks.length; } // `only` = build just that region (ROUND 4: the consistency check runs one scratch session per region, each holding ONE region, not all of them)
  }
  if (o.taper) ex.taper = o.taper;
  if (o.through) {
    ex.through_all = true;
    ex.direction = o.mid ? 'symmetric' : (o.sgn > 0 ? 'negative' : 'positive');
    return { cmds: [...s.cmds, { command: 'solid.extrude', params: ex }], ntool };
  }
  if (o.up > 0 && o.down > 0) { ex.distance = o.up; ex.distance2 = o.down; }
  else if (o.down > 0) { ex.distance = o.down; ex.direction = 'negative'; }
  else ex.distance = o.up;
  return { cmds: [...s.cmds, { command: 'solid.extrude', params: ex }], ntool };
}

// ---- extents in the sketch frame (u, v, n), for the two guards that look at where a tool sits against the part ---------------------------------
const NEAR_FLUSH = 1e-4; // mm: a tool face this close to a part face, but not on it, is a wall/sliver below what truck keeps apart
const FLUSH_NOISE = 1e-9;
// ROUND 3: the bounding box truck reports for a part with a curved cut is not exact: a slanted bore in a plate made the plate's top 10.000013883 where
// the plane is at 10 (a straight bore or a through hole: exact; a cylinder: 2e-4 SMALL). A pocket starting on that top face then looked "1.4e-5 short of
// a face" and was refused. On a curved part a gap under this floor is bounding-box noise, not a sliver (measured: 1.4e-5 on the elliptic bore).
const CURVED_BBOX_SLOP = 3e-5;
/** bbox of the sketch profile in (u, v): [u0, v0, u1, v1], or null */
function profileBox(sk, ctx) {
  if (isSoup(sk)) {
    const got = soupLoops(sk);
    if (!got.loops) return null;
    const pts = got.loops.flatMap((l) => l.poly);
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }
  const out = ctx.arc.outlineOf(sk);
  if (!out.ok) return null;
  if (sk.shape === 'circle') { const [a, b] = out.points; const cx = (a[0] + b[0]) / 2; const cy = (a[1] + b[1]) / 2; const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2; return [cx - r, cy - r, cx + r, cy + r]; }
  const { pts } = sampleOutline({ ...out, shape: sk.shape }, ctx.arc);
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
const hasCurve = (sk, ctx) => {
  if (isSoup(sk)) return (sk.geoms ?? []).some((g) => !g.construction && (g.k === 'circle' || g.k === 'arc'));
  if (sk.shape === 'circle') return true;
  const out = ctx.arc.outlineOf(sk);
  return !!out.ok && Object.values(out.bulges ?? {}).some((g) => g);
};
/** extent of the tool [lo, hi] along u, v and n of the frame, and of a box along the same axes */
function frameExtents(o, sk, ctx) {
  const box = profileBox(sk, ctx);
  if (!box) return null;
  const fr = o.fr; const nn = o.nn;
  const along = (a, p) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
  const n0 = along(nn, fr.origin);
  let sU = 0; let sV = 0; let sN = 0; let nLo; let nHi;
  const span = o.span; const back = o.back;
  if (o.slant) {
    const mag = span / (o.slant.alongNormal ? Math.abs(o.slant.c) : 1);
    const S = o.slant.dh.map((x) => x * mag * o.sgn);
    sU = along(fr.u, S); sV = along(fr.v, S); sN = along(nn, S);
    const k = back / span;
    const q0 = -sN * k; const q1 = q0 + sN;
    nLo = n0 + Math.min(q0, q1); nHi = n0 + Math.max(q0, q1);
    const shift = -k;
    return { u: [box[0] + Math.min(sU * shift, sU * (shift + 1)), box[2] + Math.max(sU * shift, sU * (shift + 1))], v: [box[1] + Math.min(sV * shift, sV * (shift + 1)), box[3] + Math.max(sV * shift, sV * (shift + 1))], n: [nLo, nHi], mouthSide: o.sgn * SIGN(o.slant.c) };
  }
  // straight: pull spans sgn*[-back, span-back]; pocket spans sgn*[back-span, back] along n
  if (o.taper) return null; // the wall travels with the taper; the consistency check covers it
  const pad = 0;
  const lo = o.kind === 'pull' ? (o.sgn > 0 ? -back : -(span - back)) : (o.sgn > 0 ? back - span : -back);
  const hi = o.kind === 'pull' ? (o.sgn > 0 ? span - back : back) : (o.sgn > 0 ? back : span - back);
  return { u: [box[0] - pad, box[2] + pad], v: [box[1] - pad, box[3] + pad], n: o.through ? [-1e300, 1e300] : [n0 + lo, n0 + hi], mouthSide: 0 };
}
function bboxInFrame(bb, o) {
  const fr = o.fr; const nn = o.nn;
  const ext = (a) => { const v = []; for (const x of [bb[0], bb[3]]) for (const y of [bb[1], bb[4]]) for (const z of [bb[2], bb[5]]) v.push(a[0] * x + a[1] * y + a[2] * z); return [Math.min(...v), Math.max(...v)]; };
  return { u: ext(fr.u), v: ext(fr.v), n: ext(nn) };
}
/** 0 < gap <= NEAR_FLUSH between a tool face and a part face on the same axis (tool face inside the part), else null */
function nearFlush(tool, part, floor = FLUSH_NOISE) {
  for (const ax of ['u', 'v', 'n']) {
    for (const [t, p, sideIn] of [[tool[ax][0], part[ax][0], (t, p) => t - p], [tool[ax][1], part[ax][1], (t, p) => p - t]]) {
      const gap = sideIn(t, p);
      if (gap > floor && gap <= NEAR_FLUSH * (1 + 1e-9)) return { axis: ax, gap };
    }
  }
  return null;
}

// ---- after-the-build checks (the kernel built something; is it the solid the student asked for?) -------------------------------------
// Each plan may carry `verify(m, env)` (async): m = the measure of the bodies the feature produced, env = { accepted, runSC } (the accepted command
// list so far, to re-run in a SCRATCH session). A string back = a refusal sentence, the variant is not accepted. Four checks, all measured necessary:
//   touches nothing / seals a void  (brep-rs refuses both; truck builds them silently)
//   cut consistency                 (truck silently DROPS a wall or sliver thinner than ~0.3% of the part's size in a cut or a join)
//   curved accuracy                 (truck's volume of a curved solid comes from a tessellation whose error grows with part size / radius)
const CURVE_ERR = [[35, 2.0e-4], [40, 2.5e-4], [45, 3.1e-4], [75, 5e-4], [100, 6e-4], [150, 9e-4], [300, 2e-3], [1000, 5e-2], [Infinity, 0.6]]; // measured, see extrude-pocket.json
const curveErr = (x) => CURVE_ERR.find(([lim]) => x <= lim)[1];
// and an absolute floor: below ~1 mm the tessellation chord tolerance stops shrinking (about 1e-4 mm), so the error depends on the diameter D alone (measured, ratio 1..30 identical)
const ABS_ERR = [[0.005, 3e-2], [0.01, 1.4e-2], [0.02, 7.3e-3], [0.05, 2.4e-3], [0.1, 1.9e-3], [0.2, 6e-4], [0.3, 4.6e-4], [0.5, 2.6e-4], [Infinity, 0]];
const absErr = (D) => ABS_ERR.find(([lim]) => D <= lim)[1];
const CURVED_BAR = 3e-4;
const vol1 = (res, name) => (res.ok ? res.measure.bodies.filter((b) => isPiece(b.name, [name])).reduce((a, b) => a + b.volume_mm3, 0) : null);

/** Smallest radius drawn in a sketch (circle, arc, rounded corner), or Infinity. */
function minRadiusOf(sk, ctx) {
  if (isSoup(sk)) return (sk.geoms ?? []).filter((g) => !g.construction && (g.k === 'circle' || g.k === 'arc')).reduce((r, g) => Math.min(r, g.r ?? Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1])), Infinity);
  const out = ctx.arc.outlineOf(sk);
  if (!out.ok) return Infinity;
  return outlineSize({ ...out, shape: sk.shape }, ctx.arc).minRadius ?? Infinity;
}
/** The relative volume error truck can make on the curved part of this feature; null when it stays under the curved bar. */
function curvedAccuracy(f, m, sk, ctx, curvedVolume) {
  const r = minRadiusOf(sk, ctx);
  if (!Number.isFinite(r) || !(r > 0)) return null;
  const diag = Math.hypot(m.bbox[3] - m.bbox[0], m.bbox[4] - m.bbox[1], m.bbox[5] - m.bbox[2]);
  const x = diag / (2 * r);
  const bound = (Math.max(curveErr(x), absErr(2 * r)) * curvedVolume) / Math.max(m.volume, 1e-300);
  if (!(bound > CURVED_BAR)) return null;
  const what = f.kind === 'extrude' ? 'pull' : 'pocket';
  const tiny = absErr(2 * r) >= curveErr(x);
  const why = tiny ? `the smallest round shape in this ${what} is only ${fmtMm(2 * r)} mm across` : `the part is about ${Math.round(x)} times wider than the smallest round shape in this ${what}`;
  return `${f.id}: ${why}, and SolidCraft would report its volume and mass up to ${(bound * 100).toPrecision(2)}% wrong, so it is refused instead of showing a wrong part; make the round shape larger or the part smaller`;
}

/** A pull: only the curved-accuracy check. */
async function verifyPull(f, m, sk, ctx) { return curvedAccuracy(f, m, sk, ctx, m.volume); }

const total = (res) => res.measure.bodies.reduce((a, b) => a + b.volume_mm3, 0);
const exact = (res, name) => res.measure.bodies.find((b) => b.name === name)?.volume_mm3 ?? 0;

/** A pocket: it must change the part, must not seal a void, and the volume that went must be the volume the tool removes. */
async function verifyPocket(f, m, before, sk, ctx, env, tool) {
  if (!before) return null;
  const sameVol = Math.abs(m.volume - before.volume) <= 1e-9 * Math.max(before.volume, 1);
  if (sameVol && m.faces === before.faces) return `${f.id} does not touch the part, so it cuts nothing; move the sketch onto the part, or change the depth or direction`;
  // one more shell than one more body = a void: a cavity closed off inside the part
  if (m.shells - before.shells > m.bodies.length - before.bodies.length) return `${f.id} would leave a sealed cavity inside the part instead of opening onto a face; start the sketch on a face of the part, or cut deeper`;
  // a tool face a hair short of a part face leaves a wall truck may snap away (the intersect below snaps the same way under ~1e-5): refuse it outright
  if (tool.extents && before.bbox) {
    const nf = nearFlush(tool.extents, bboxInFrame(before.bbox, tool.opt), before.curved ? CURVED_BBOX_SLOP : FLUSH_NOISE);
    if (nf) return `${f.id}: the cut stops ${+nf.gap.toPrecision(2)} mm short of a face of the part, closer than the ${NEAR_FLUSH} mm this app can check reliably (SolidCraft can silently lose a sliver that thin), so it is refused; make the cut reach the face, or leave at least 0.001 mm`;
  }
  // consistency: V_before - V_after must equal what the tool removes, measured separately as (tool INTERSECT piece), one scratch session per piece.
  // The scene before the cut is cached by the translator (env.scene); solidcraft names the pieces of a multi-region tool "t", "t (2)", ...
  const sceneTotal = env.scene.reduce((a, b) => a + b.vol, 0);
  const sceneExact = (n) => env.scene.find((b) => b.name === n)?.vol ?? 0;
  let removed = 0; let inconclusive = false;
  for (const piece of tool.pieces) {
    const t = `tmp_tool_${f.id}`;
    const made = tool.build({ operation: 'new', body_name: t });
    if (made.refusal) { inconclusive = true; continue; }
    const nTool = made.ntool ?? 1;
    // one scratch session per (piece, tool region): solidcraft's intersect with SEVERAL tools is not "each one": measured, a target and two tools that
    // each overlap it only partly gives an EMPTY result. ROUND 4: each session builds ONLY its own region (round 3 built all N regions in every one of the N
    // sessions: 12 round holes took 78 s); the tool body that was built is then named t and is not part of the part, so its volume is taken out.
    for (let rg = 0; rg < nTool; rg++) {
      const one = nTool > 1 ? tool.build({ operation: 'new', body_name: t }, rg) : made;
      if (one.refusal) { inconclusive = true; continue; }
      const r2 = await env.runSC([...env.accepted, ...one.cmds, { command: 'solid.combine', params: { target: piece, tools: [t], operation: 'intersect' } }]);
      if (!r2.ok) { inconclusive = true; continue; }
      const leftover = r2.measure.bodies.filter((b) => b.name === t).reduce((a, b) => a + b.volume_mm3, 0);
      removed += total(r2) - leftover - (sceneTotal - sceneExact(piece));
    }
  }
  const curvedPart = m.curved || before.curved;
  const tol = curvedPart ? CURVED_BAR * Math.max(before.volume, 1) : 1e-9 * Math.max(before.volume, 1);
  const dev = m.volume - (before.volume - removed);
  env.checks.push({ check: 'cut-consistency', removedByTool: removed, devMm3: dev, tolMm3: tol, inconclusive });
  if (!inconclusive && Math.abs(dev) > tol) return `${f.id}: the cut and the volume the sketch should remove do not add up (${Math.abs(dev) < 0.01 ? dev.toExponential(1) : +dev.toFixed(3)} mm3 apart); a wall or sliver thinner than about 0.3% of the part's size is the usual cause, so it is refused rather than losing it silently; leave a thicker wall or cut in one go`;
  return curvedAccuracy(f, m, sk, ctx, Math.max(removed, 0));
}

// ---- ROUND 3: a join whose parts only touch along a line or at a point ----------------------------------------------------------------
// brep-rs: "the two shapes only touch along a line or at a point, so they would not be one solid; overlap them a little". Truck either refuses
// ("join cannot preserve the original faces; check for zero-thickness edge contact", raw text) or builds ONE body with TWO shells (a gap of 1 mm
// builds the very same thing: 1 body, 2 shells, 24 edges), so neither the kernel's answer nor its shell count tells touching from apart.
// The decision is geometric and exact for blocks (volume == box volume, the usual base and pad): look at the gap between the two boxes on
// each axis; touching on two or three axes at once (and nowhere apart) is a line or a point. For parts that are not blocks the boxes only bound
// the contact, so the rule is conservative: boxes that touch on one face plane or more, with no shell merged by the join, are refused too.
const TOUCH_EPS = 1e-6; // mm: a gap this small counts as touching (truck's own tolerance is about 1e-6)
export const JOIN_TOUCH_SENTENCE = (id) => `${id}: the parts of this join only touch along a line or at a point (or stop just short of each other), so they would not be one solid; overlap them a little, share a whole face, or keep them clearly apart`;
const isBlock = (b) => { const v = (b.bbox[3] - b.bbox[0]) * (b.bbox[4] - b.bbox[1]) * (b.bbox[5] - b.bbox[2]); return Math.abs(v - b.vol) <= 1e-9 * Math.max(v, 1); };
/** 'apart' | 'overlap' | 'face' | 'line-point' by the gaps between two boxes on x, y, z (a gap <= TOUCH_EPS is touching, a negative one overlap) */
export function boxContact(a, b) {
  let touch = 0;
  for (let k = 0; k < 3; k++) {
    const gap = Math.max(a[k], b[k]) - Math.min(a[k + 3], b[k + 3]);
    if (gap > TOUCH_EPS) return 'apart';
    if (gap >= -TOUCH_EPS) touch++;
  }
  return touch === 0 ? 'overlap' : touch === 1 ? 'face' : 'line-point';
}
/** pairs of join operands that only touch at an edge or a point: [{a, b, how}], blocks decided exactly before the kernel runs */
function blockTouches(names, scene) {
  const out = [];
  const ent = names.map((n) => scene.find((x) => x.name === n)).filter(Boolean);
  for (let i = 0; i < ent.length; i++) for (let j = i + 1; j < ent.length; j++) {
    const c = boxContact(ent[i].bbox, ent[j].bbox);
    if (c === 'line-point' && isBlock(ent[i]) && isBlock(ent[j])) out.push({ a: ent[i].name, b: ent[j].name, how: 'blocks touching on 2+ axes' });
  }
  return out;
}
/** after the build: parts that are not blocks, boxes touching/overlapping, and the join merged no shell */
function curvedTouches(names, scene, m) {
  const ent = names.map((n) => scene.find((x) => x.name === n)).filter(Boolean);
  const sum = ent.reduce((a, e) => a + e.shells, 0);
  if (m.shells < sum) return []; // a shell merged: some pair shares a surface
  const out = [];
  for (let i = 0; i < ent.length; i++) for (let j = i + 1; j < ent.length; j++) {
    if (isBlock(ent[i]) && isBlock(ent[j])) continue;
    const c = boxContact(ent[i].bbox, ent[j].bbox);
    if (c === 'face' || c === 'line-point') out.push({ a: ent[i].name, b: ent[j].name, how: `boxes ${c}, no shell merged (${m.shells} of ${sum})` });
  }
  return out;
}

/**
 * A join: V(A union B ...) must equal what inclusion-exclusion gives: union = op0 + (op1 minus op0) + (op2 minus (op0 + op1)) + ...,
 * each "minus" measured in its own scratch session (a cut consumes its tools, hence the bookkeeping on what was consumed).
 * Catches a thin protrusion or sliver the union drops.
 */
async function verifyUnion(f, m, ops, env) {
  const ct = curvedTouches(ops, env.scene, m);
  env.checks.push({ check: 'join-contact', blockPairsTouching: 0, otherPairsSuspect: ct.length });
  if (ct.length) return JOIN_TOUCH_SENTENCE(f.id);
  const sceneTotal = env.scene.reduce((a, b) => a + b.vol, 0);
  const sceneExact = (n) => env.scene.find((b) => b.name === n)?.vol ?? 0;
  const bb = (n) => env.scene.find((b) => b.name === n)?.bbox;
  for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) {
    const a = bb(ops[i]); const b = bb(ops[j]);
    if (!a || !b) continue;
    // ROUND 4: the steps a join drops are not a fixed size, they scale with the part: measured (extrude-pocket-floor-sweep.txt, tprobe in RIG.md) a 40 x 30 x 10 plate
    // loses a boss step up to 0.03-0.05 mm and a 400 x 300 x 100 plate up to 0.3-0.5 mm (about 4e-4 of the size), and the cut-based consistency check below only sees
    // the ones above about 1.7e-5 of the size (the intersect-based estimate drops them too), so everything up to 2.5e-5 of the union's diagonal is refused outright.
    const diag = Math.hypot(Math.max(a[3], b[3]) - Math.min(a[0], b[0]), Math.max(a[4], b[4]) - Math.min(a[1], b[1]), Math.max(a[5], b[5]) - Math.min(a[2], b[2]));
    const near = Math.max(NEAR_FLUSH, 2.5e-5 * diag);
    // two faces a hair apart on the same side, between boxes that overlap along the other axes: a step truck may snap flat
    for (let ax = 0; ax < 3; ax++) for (const k of [0, 3]) {
      const gap = Math.abs(a[ax + k] - b[ax + k]);
      const overlapOthers = [0, 1, 2].filter((q) => q !== ax).every((q) => Math.min(a[q + 3], b[q + 3]) - Math.max(a[q], b[q]) > 1e-6);
      if (overlapOthers && gap > FLUSH_NOISE && gap <= near * (1 + 1e-9)) return `${f.id}: two faces of the joined parts are ${+gap.toPrecision(2)} mm apart, closer than the ${+near.toPrecision(2)} mm this app can check reliably on a part this size (SolidCraft can silently lose a step that thin), so it is refused; make them flush or at least ${+(near * 1.5).toPrecision(2)} mm apart`;
    }
  }
  let expected = sceneExact(ops[0]);
  let inconclusive = false;
  for (let i = 1; i < ops.length; i++) {
    const r = await env.runSC([...env.accepted, { command: 'solid.combine', params: { target: ops[i], tools: ops.slice(0, i), operation: 'cut' } }]);
    if (!r.ok) { inconclusive = true; continue; }
    const consumed = ops.slice(0, i + 1).reduce((a, n) => a + sceneExact(n), 0);
    expected += total(r) - (sceneTotal - consumed);
  }
  const tol = (m.curved ? CURVED_BAR : 1e-9) * Math.max(m.volume, 1);
  const dev = m.volume - expected;
  env.checks.push({ check: 'join-consistency', expectedMm3: expected, devMm3: dev, tolMm3: tol, inconclusive });
  if (!inconclusive && Math.abs(dev) > tol) return `${f.id}: the joined part and the sum of its pieces do not add up (${Math.abs(dev) < 0.01 ? dev.toExponential(1) : +dev.toFixed(3)} mm3 apart); a sliver or thin step of about 0.1 mm or less is the usual cause, so it is refused rather than losing it silently; make the overlap or the step thicker`;
  return null;
}

/** Plan one feature. Returns {refusal} | {variants:[cmds...], produces:[names], consumes:[ids]} | {noop:true}. */
export function planFeature(f, st, ctx) {
  const name = bname(f.id);
  const needBody = (id) => {
    const bs = st.bodies[headOf(id)];
    return bs && bs.length ? bs : null;
  };
  // occt-build advanceHead: a hole / pocket / groove leaves its target's id pointing at the NEWEST cut, so a second bore
  // on the same target stacks on the first instead of starting over.
  const headOf = (id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
  const dep = (id, role = 'target') => {
    id = headOf(id);
    const lbl = f.kind === 'extrude' || f.kind === 'pocket' || f.kind === 'combine' ? f.id : `${f.id} (${f.kind})`;
    if (st.refused[id]) return `${lbl}: its ${role} ${id} was refused, so there is nothing to build on (${String(st.refused[id]).replace(/^[^:]*: /, '')})`;
    if (st.stale[id]) return `${lbl}: its ${role} ${id} was already used up by ${st.stale[id]}, so it cannot be used again; use the result of ${st.stale[id]} instead`;
    return null;
  };
  switch (f.kind) {
    case 'box': case 'cylinder': case 'sphere': case 'torus': case 'cone': case 'prism': case 'wedge': {
      const rot = !isZero3(f.rotate);
      const c = f.center ?? [0, 0, 0];
      const at = rot ? [0, 0, 0] : c; // rotation is about the ORIGIN, so a rotated primitive is built at the origin first
      let cmds = [];
      if (f.kind === 'box') {
        cmds.push({ command: 'solid.box', params: { length: f.size[0], width: f.size[1], height: f.size[2], center: at, body_name: name } });
      } else if (f.kind === 'cylinder') {
        cmds.push({ command: 'solid.cylinder', params: { radius: f.radius, height: f.height, base: [at[0], at[1], at[2] - f.height / 2], axis: 'Z', body_name: name } });
      } else if (f.kind === 'sphere') {
        cmds.push({ command: 'solid.sphere', params: { radius: f.radius, center: at, body_name: name } });
      } else if (f.kind === 'torus') {
        cmds.push({ command: 'solid.torus', params: { major: f.ringRadius, minor: f.tubeRadius, center: at, body_name: name } });
      } else if (f.kind === 'cone') {
        // no solid.cone: spin the right triangle (0,0)-(r,0)-(0,h) about the sketch y axis, as occt-build coneOf does
        const nm = `sk_${f.id}_${st.counter++}`;
        cmds.push(
          { command: 'sketch.create', params: { name: nm, plane: { origin: [at[0], at[1], at[2] - f.height / 2], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
          { command: 'sketch.line', params: { points: [[0, 0], [f.radius, 0], [0, f.height]], closed: true } },
          { command: 'sketch.finish', params: {} },
          { command: 'solid.revolve', params: { axis: 'y', sketch: nm, operation: 'new', body_name: name } },
        );
      } else {
        const poly = f.kind === 'prism'
          ? (() => { const n = Math.max(3, Math.min(12, Math.round(f.sides))); return Array.from({ length: n }, (_, i) => [f.radius * Math.cos(2 * Math.PI * i / n), f.radius * Math.sin(2 * Math.PI * i / n)]); })()
          : [[-f.width / 2, -f.depth / 2], [f.width / 2, -f.depth / 2], [-f.width / 2, f.depth / 2]];
        const nm = `sk_${f.id}_${st.counter++}`;
        cmds.push(
          { command: 'sketch.create', params: { name: nm, plane: { origin: [at[0], at[1], at[2] - f.height / 2], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } },
          { command: 'sketch.line', params: { points: poly, closed: true } },
          { command: 'sketch.finish', params: {} },
          { command: 'solid.extrude', params: { distance: f.height, sketch: nm, operation: 'new', body_name: name } },
        );
      }
      if (f.round) {
        if (f.kind !== 'box' && f.kind !== 'cylinder') return refuse(`${f.id} (${f.kind}): a whole-shape round is only mapped for box and cylinder`);
        const pts = roundPoints(f, at);
        cmds.push(f.roundStyle === 'chamfer'
          ? { command: 'solid.chamfer', params: { edges: pts, distance: f.round, body: name } }
          : { command: 'solid.fillet', params: { edges: pts, radius: f.round, body: name } });
      }
      if (rot) { cmds.push(...rotCmds(name, f.rotate)); if (!isZero3(c)) cmds.push(moveCmd(name, c)); }
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case 'datum':
      return { noop: true };
    case 'sketch':
      return { noop: true, stage: true };
    case 'extrude': {
      const d = dep(f.target, 'sketch');
      if (d) return refuse(d);
      const sk = cleanSketch(st.sketches[f.target]);
      if (!sk) return refuse(`${f.id}: ${f.target} is not a sketch`);
      const opt = optionPlan('pull', f, sk, ctx);
      if (opt.refusal) return refuse(`${f.id}: ${opt.refusal}`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id}: ${s.refusal}`);
      const body = { operation: 'new', body_name: name };
      const built = emitSweep(opt, s, sk, ctx, st, body);
      if (built.refusal) return refuse(`${f.id}: ${built.refusal}`);
      return { variants: [[...built.cmds]], produces: [name], consumes: [], flagCurvedSlant: !!(opt.slant && hasCurve(sk, ctx)), verify: (m) => verifyPull(f, m, sk, ctx) };
    }
    case 'revolve': case 'groove': {
      const d = dep(f.target, 'sketch') || (f.kind === 'groove' ? dep(f.into, 'solid') : null);
      if (d) return refuse(d);
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (${f.kind}): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st, { revolve: true });
      if (s.refusal) return refuse(`${f.id} (${f.kind}): ${s.refusal}`);
      const params = { axis: 'y', sketch: s.name };
      if (f.angle !== 360) params.angle = -f.angle;
      if (f.kind === 'revolve') return { variants: [[...s.cmds, { command: 'solid.revolve', params: { ...params, operation: 'new', body_name: name } }]], produces: [name], consumes: [] };
      const bs = needBody(f.into);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (groove): ${f.into} is not a single body`);
      return { variants: [[...s.cmds, { command: 'solid.revolve', params: { ...params, operation: 'cut', targets: bs } }]], produces: bs, consumes: [f.into] };
    }
    case 'pocket': {
      const d = dep(f.target, 'sketch') || dep(f.into, 'solid');
      if (d) return refuse(d);
      const sk = cleanSketch(st.sketches[f.target]);
      const bs = needBody(f.into);
      if (!sk || !bs) return refuse(`${f.id}: needs a sketch and a part to cut`);
      const before = st.measure[headOf(f.into)];
      const opt = optionPlan('pocket', f, sk, ctx, before?.bbox ?? null);
      if (opt.refusal) return refuse(`${f.id}: ${opt.refusal}`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id}: ${s.refusal}`);
      // A slanted tool with a round shape that crosses a face of the part is slower (12-21 s against 4-12 s), did not finish in 25 s in one join, or
      // TRAPS the pinned truck (measured: slanted d6 circle, 11 deep through a 10 mm plate: wasm trap). It builds quickly when it ends inside the part. So: no round slanted tool that
      // leaves the part's box, no cut into a body made from one.
      if (bs.some((b) => st.curvedSlant.has(b))) return refuse(`${f.id}: the part it cuts was made from a slanted round pull, and cutting into one can freeze or crash SolidCraft, so it is not built yet; cut before slanting, or draw the slanted pull with straight sides`);
      // ROUND 3: the bounding-box test below does not see an earlier hole, pocket or step INSIDE the box. A slanted round tool that crosses one passed it and
      // took minutes (measured: plate 60 x 60 x 10 with a d20 through hole + a d6 slanted bore running into the hole wall: 188 s; into an earlier pocket: 48 s).
      // So a slanted round cut is only built into a plain block (every piece has the volume of its own bounding box): nothing inside the part for it to cross.
      if (opt.slant && hasCurve(sk, ctx) && !ctx.unguardedSlant) { // ctx.unguardedSlant: measuring only (extrude-pocket-slant-timing.mjs)
        const piece = bs.map((b) => st.scene.find((x) => x.name === b));
        if (piece.some((x) => !x || !isBlock(x))) return refuse(`${f.id}: a slanted cut with a round shape is only built into a plain block (no holes, pockets or steps in it), because SolidCraft can take minutes or freeze when it has to cut around them; this part is not one, so cut the slanted hole first, or cut straight down`);
      }
      if (opt.slant && hasCurve(sk, ctx) && before?.bbox) {
        const te = frameExtents(opt, sk, ctx); const pe = bboxInFrame(before.bbox, opt);
        if (!te) return refuse(`${f.id}: the outline of this slanted cut could not be measured`);
        const eps = 1e-6; const out = [];
        for (const ax of ['u', 'v']) if (te[ax][0] < pe[ax][0] - eps || te[ax][1] > pe[ax][1] + eps) out.push(ax);
        if (opt.through) out.push('n');
        else { const far = te.n; const travelPos = opt.sgn * SIGN(opt.slant.c) > 0; if (travelPos ? far[1] > pe.n[1] + eps : far[0] < pe.n[0] - eps) out.push('n'); }
        if (out.length) return refuse(`${f.id}: a slanted cut with a round shape is only built when it ends inside the part; this one runs out through the ${opt.through ? 'far side' : 'side or far end'} of the part, which can freeze or crash SolidCraft; shorten the depth, cut straight down, or draw it with straight sides`);
      }
      const built = emitSweep(opt, s, sk, ctx, st, { operation: 'cut', targets: bs });
      if (built.refusal) return refuse(`${f.id}: ${built.refusal}`);
      // the tool as a separate finite body (for the consistency check): a through-all cut becomes a tool long enough to cover the whole part
      const toolOf = finiteTool(opt);
      const tool = { pieces: bs, build: (body, only) => emitSweep(toolOf, s, sk, ctx, st, body, only) };
      tool.extents = frameExtents(opt, sk, ctx); tool.opt = opt;
      return { variants: [[...built.cmds]], produces: bs, consumes: [f.into], verify: (m, env) => verifyPocket(f, m, before, sk, ctx, env, tool) };
    }
    case 'blend': {
      const ds = f.targets.map((t) => dep(t, 'sketch')).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (blend): needs two or more sketches`);
      const cmds = []; const names = [];
      for (const t of f.targets) {
        const sk = st.sketches[t];
        if (!sk) return refuse(`${f.id} (blend): ${t} is not a sketch`);
        const s = inSketch(sk, ctx, st, { allowSoup: false });
        if (s.refusal) return refuse(`${f.id} (blend): ${s.refusal}`);
        cmds.push(...s.cmds); names.push(s.name);
      }
      cmds.push({ command: 'solid.loft', params: { sections: names.map((n) => ({ sketch: n })), operation: 'new', body_name: name } });
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case 'combine': {
      const ds = f.targets.map((t) => dep(t)).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id}: a join, subtract or intersect needs two or more parts`);
      const all = f.targets.map((t) => needBody(t));
      if (all.some((b) => !b || b.length === 0)) return refuse(`${f.id}: one of its parts has nothing built, so there is nothing to combine`);
      const op = f.op === 'union' ? 'join' : f.op === 'subtract' ? 'cut' : 'intersect';
      // a target can be several pieces (a pull of two separate shapes, a part a cut split in two). A join takes every piece of every target;
      // a subtract or intersect of pieces is not mapped (which piece is "the" target is not defined).
      if (op !== 'join' && all.some((b) => b.length !== 1)) return refuse(`${f.id}: a ${f.op === 'subtract' ? 'subtract' : 'intersect'} is not built yet when one of its parts is ${all.find((b) => b.length !== 1).length} separate pieces; make every part one piece`);
      const flat = all.flat();
      if (op === 'join' && flat.some((n) => st.curvedSlant.has(n))) {
        // a slanted round pull that overlaps another operand's box would have to be cut against its faces: hangs or traps (see the pocket case)
        const sc = new Map(st.scene.map((b) => [b.name, b.bbox]));
        const vol = (a, b) => [0, 1, 2].reduce((v, i) => v * Math.max(0, Math.min(a[i + 3], b[i + 3]) - Math.max(a[i], b[i]) - 1e-6), 1);
        for (const n of flat.filter((x) => st.curvedSlant.has(x))) for (const m2 of flat) if (m2 !== n && sc.get(n) && sc.get(m2) && vol(sc.get(n), sc.get(m2)) > 0) return refuse(`${f.id} a slanted round pull that runs into the other part cannot be joined yet (it can freeze or crash SolidCraft); join it where it only touches, or pull it with straight sides`);
      }
      if (op === 'join') {
        const bt = blockTouches(flat, st.scene);
        if (bt.length) return refuse(JOIN_TOUCH_SENTENCE(f.id));
      }
      return {
        variants: [[{ command: 'solid.combine', params: { target: flat[0], tools: flat.slice(1), operation: op } }]],
        produces: flat, consumes: f.targets,
        verify: op === 'join' ? (m, env) => verifyUnion(f, m, flat, env) : undefined,
      };
    }
    case 'move': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.copy) return refuse(`${f.id} (move): a copying move is not mapped (solidcraft names the copy itself, and phase 0 does not track it)`);
      const bs = needBody(f.target);
      return { variants: [[{ command: 'solid.move', params: { bodies: bs, translate: f.offset } }]], produces: bs, consumes: [f.target] };
    }
    case 'rotate': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!m) return refuse(`${f.id} (rotate): no measured bounding box for ${f.target}`);
      const c = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cmds = [];
      if (!isZero3(c)) cmds.push({ command: 'solid.move', params: { bodies: bs, translate: c.map((v) => -v) } });
      ['x', 'y', 'z'].forEach((a, i) => { if (f.angles[i]) cmds.push({ command: 'solid.move', params: { bodies: bs, axis: AX[a], angle: f.angles[i] } }); });
      if (!isZero3(c)) cmds.push({ command: 'solid.move', params: { bodies: bs, translate: c } });
      return { variants: [cmds], produces: bs, consumes: [f.target] };
    }
    case 'mirror': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!m) return refuse(`${f.id} (mirror): no measured bounding box for ${f.target}`);
      const axis = f.plane === 'yz' ? 0 : f.plane === 'xz' ? 1 : 2;
      const lo = m.bbox[axis]; const hi = m.bbox[axis + 3];
      const at = Math.abs(lo) <= Math.abs(hi) ? lo : hi; // occt-build: through the part's nearer face on this axis
      const origin = [0, 0, 0]; origin[axis] = at;
      const normal = [0, 0, 0]; normal[axis] = 1;
      return { variants: [[{ command: 'solid.mirror', params: { bodies: bs, plane: { origin, normal }, combine: true } }]], produces: bs, consumes: [f.target] };
    }
    case 'pattern': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (pattern): needs a single target body`);
      if (f.count < 2) return refuse(`${f.id} (pattern): a count under 2 is the original alone; not mapped`);
      const copies = [bs[0], ...Array.from({ length: f.count - 1 }, (_, i) => `${bs[0]} (${i + 2})`)];
      let pat;
      if (f.mode === 'circular') {
        if ((f.totalAngle ?? 360) !== 360) return refuse(`${f.id} (pattern): a circular pattern over less than 360 degrees is not mapped (solidcraft's angle semantics were not verified)`);
        pat = { command: 'solid.pattern.circular', params: { bodies: bs, axis: AXN[f.axis ?? 'z'], count: f.count } };
      } else {
        const s = f.step ?? [0, 0, 0];
        if (isZero3(s)) return refuse(`${f.id} (pattern): a zero step puts every copy on the original`);
        const L = len(s);
        pat = { command: 'solid.pattern.rectangular', params: { bodies: bs, dir1: s.map((v) => v / L), count1: f.count, spacing1: L } };
      }
      // OCCT fuses the instances. Try to join them; if solidcraft cannot (disjoint copies), keep them as separate bodies.
      const join = { command: 'solid.combine', params: { target: copies[0], tools: copies.slice(1), operation: 'join' } };
      return { variants: [[pat, join], [pat]], produces: copies, consumes: [f.target] };
    }
    case 'hole': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.counterbore || f.countersink) return refuse(`${f.id} (hole): counterbore and countersink are not mapped in phase 0`);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!bs || bs.length !== 1 || !m) return refuse(`${f.id} (hole): needs a single measured target body`);
      const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cx = bc[0] + f.center[0]; const cy = bc[1] + f.center[1]; const cz = bc[2] + f.center[2];
      const centers = f.corners
        ? [[cx - f.corners.dx, cy - f.corners.dy, cz], [cx + f.corners.dx, cy - f.corners.dy, cz], [cx - f.corners.dx, cy + f.corners.dy, cz], [cx + f.corners.dx, cy + f.corners.dy, cz]]
        : [[cx, cy, cz]];
      const dir = AX[f.axis ?? 'z'];
      const cmds = centers.map((c) => ({
        command: 'solid.cylinder',
        params: { radius: f.diameter / 2, height: f.depth, base: c.map((v, i) => v - dir[i] * f.depth / 2), axis: AXN[f.axis ?? 'z'], operation: 'cut', targets: bs },
      }));
      return { variants: [cmds], produces: bs, consumes: [f.target] };
    }
    case 'shell': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (shell): needs a single target body`);
      if (!f.open) return refuse(`${f.id} (shell): this spike's shell needs a face to remove; a closed hollow box is not mapped`);
      const r = ctx.resolve(f.open);
      if (r && r.ok === false) return refuse(`${f.id} (shell): ${r.sentence}`);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (shell): the opened face could not be resolved to a single face (${r ? `it names ${r.kind}` : 'no resolution'})`);
      return { variants: [[{ command: 'solid.shell', params: { faces: [r.point], thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target], pickedFrom: 'solidcraft topology (browser)', evidence: r.evidence };
    }
    case 'fillet': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (fillet): needs a single target body`);
      const r = ctx.resolve(f.edge);
      if (r && r.ok === false) return refuse(`${f.id} (${f.kind}): ${r.sentence}`);
      if (!r || r.kind !== 'edge') return refuse(`${f.id} (fillet): the edge could not be resolved to a single edge (${r ? `it names ${r.kind}` : 'no resolution'})`);
      // phase 4: the resolved point is ON the edge (solidcraft's own edge midpoint), so there is exactly one candidate.
      const cands = [r.point];
      const mk = (p) => (f.style === 'chamfer'
        ? { command: 'solid.chamfer', params: { edges: [p], distance: f.size, body: bs[0] } }
        : { command: 'solid.fillet', params: { edges: [p], radius: f.size, body: bs[0] } });
      return { variants: cands.map((p) => [mk(p)]), produces: bs, consumes: [f.target], pickedFrom: 'solidcraft topology (browser)', evidence: r.evidence };
    }
    case 'draft': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.whole || !f.face) return refuse(`${f.id} (draft): a whole-body draft is not mapped (needs a face pick per face)`);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (draft): needs a single target body`);
      const r = ctx.resolve(f.face);
      if (r && r.ok === false) return refuse(`${f.id} (draft): ${r.sentence}`);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (draft): the face could not be resolved to a single face (${r ? `it names ${r.kind}` : 'no resolution'})`);
      const ax = AX[f.pull ?? 'z'];
      return {
        variants: [[{ command: 'solid.draft', params: { faces: [r.point], angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }]],
        produces: bs, consumes: [f.target], pickedFrom: 'solidcraft topology (browser)', evidence: r.evidence,
      };
    }
    default:
      return refuse(`${f.id}: feature kind '${f.kind}' is not in the ModelDoc vocabulary this translator knows`);
  }
}

/** A body belongs to a feature when it is one of the names it produced or a piece solidcraft split off one of them ("name (2)"). */
const isPiece = (bodyName, names) => names.some((n) => bodyName === n || (bodyName.startsWith(`${n} (`) && /^ \(\d+\)$/.test(bodyName.slice(n.length))));

/** Aggregate the named bodies (and their split-off pieces) of a successful run into one measure (sum volume/faces, union bbox). */
function aggregate(res, names) {
  const bs = res.measure.bodies.filter((b) => isPiece(b.name, names));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  return {
    volume: bs.reduce((s, b) => s + b.volume_mm3, 0),
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    shells: bs.reduce((s, b) => s + (b.kernel.shells ?? 1), 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / bs.reduce((a, b) => a + b.volume_mm3, 0)),
    bodies: bs.map((b) => b.name),
  };
}

/**
 * The name was resolved on the own shape of the feature it names; the pick lands on the TARGET body as it is now. Redo, ON THE
 * TARGET: the candidate count (every face coplanar with the named plane, or every edge matching), solidcraft's own pick-hit
 * test and the choice of an interior point. More than one candidate, or no safe point, is a refusal with the count.
 */
async function confirmOnTarget(rr, { st, accepted, ctx, targetId }) {
  if (!rr.ok || rr.kind === 'faceset') return rr;
  const headId = (id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
  const tb = st.bodies[headId(targetId)];
  const nm = rr.evidence.name;
  if (!tb || tb.length !== 1) return { ok: false, sentence: `${nm} resolved on ${rr.shape.featureId}, but the target ${targetId} is ${tb ? tb.length : 0} bodies; a pick is made on a single body, so nothing is picked` };
  let cur;
  try { cur = await ctx.topologyOf(accepted); } catch (e) { cur = { ok: false, error: e.message }; }
  const body = cur.ok && cur.topology ? cur.topology.bodies.find((b) => b.name === tb[0]) : null;
  if (!body || body.error) return { ok: false, sentence: `${nm} resolved, but solidcraft returned no topology for the target ${tb[0]}; nothing is picked` };
  let sc = 1;
  for (const e of body.edges) for (const q of [e.start, e.mid, e.end]) for (const v of q) sc = Math.max(sc, Math.abs(v));
  for (const x of body.faces) for (const v of x.centroid) sc = Math.max(sc, Math.abs(v));
  const tol = 1e-6 * sc * 10;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (rr.kind === 'edge') {
    const per = rr.edges.map((e) => body.edges.filter((q) => dist(q.mid, e.mid) <= tol && Math.abs(q.length - e.length) <= tol));
    const miss = per.filter((m) => m.length === 0).length;
    if (miss) return { ok: false, sentence: `${nm} resolves to ${rr.evidence.engineEdges.join(', ')} on ${rr.shape.featureId}, but ${miss === rr.edges.length ? 'that edge is' : 'part of that edge is'} no longer present whole on ${tb[0]} (an operation after ${rr.shape.featureId} changed or removed it); nothing is picked` };
    if (per.some((m) => m.length > 1)) return { ok: false, sentence: `${nm} matches more than one edge on ${tb[0]} (${per.flat().map((q) => q.name).join(', ')}); nothing is picked` };
    rr.evidence.target = { body: tb[0], candidates: rr.edges.length, edges: per.flat().map((q) => q.name), point: rr.point };
    return rr;
  }
  if (!rr.plane) return { ok: false, sentence: `${nm} resolves to a curved face; a pick of a curved face on the target is not resolved in the browser demo` };
  const { n, d } = rr.plane;
  // same geometric plane. The OPPOSITE orientation counts only when the name's shape is not the target itself (a subtracted
  // tool's wall is a wall of the cavity with its normal flipped); on the target's own shape a face on the far side of a
  // slab with the opposite normal (the bottom of the part) is a different face.
  const allowFlip = rr.shape.featureId !== targetId && rr.shape.featureId !== headId(targetId);
  const on = body.faces.filter((x) => x.plane_normal && Math.abs(dot(x.centroid, n) - d) <= tol
    && (dot(x.plane_normal, n) >= 1 - 1e-6 || (allowFlip && dot(x.plane_normal, n) <= -1 + 1e-6)));
  if (on.length === 0) return { ok: false, sentence: `${nm} resolves on ${rr.shape.featureId}, but no face of ${tb[0]} lies on that plane any more; nothing is picked` };
  if (on.length > 1) return { ok: false, sentence: `${nm} matches ${on.length} faces on ${tb[0]} (${on.map((x) => x.name).join(', ')}; all on the named plane); a name must pick exactly one, so nothing is picked` };
  const p = pickPoint(on[0], Math.max(tol, 1e-4));
  if (!p.ok) return { ok: false, sentence: `${nm} resolves to ${on[0].name} on ${tb[0]} but there is no safe pick point: ${p.why}` };
  rr.point = p.point;
  rr.evidence.pickPoint = `target ${tb[0]}: ${p.source}`;
  rr.evidence.target = { body: tb[0], candidates: 1, face: on[0].name, faceIndex: on[0].index, point: p.point, pickSource: p.source, centroidHit: on[0].centroid_hit ?? null, innerHit: on[0].inner_hit ?? null };
  return rr;
}

/** The name-resolution environment: how to read the own shape of a feature that was built (see resolve-names.mjs). */
function makeEnv(st, accepted, prefix, ctx, shapeCache) {
  return {
    features: prefix,
    sketchFrame: (sk) => frameOf(sk, ctx.mt),
    outline: (sk) => ctx.arc.outlineOf(sk),
    shapeOf: async (fid) => {
      if (st.accLen[fid] === undefined) return { ok: false, sentence: `feature ${fid} was not built (it is a sketch, was refused, or comes later), so there is no shape of it to read the name from` };
      const bodies = st.bodies[fid];
      if (!bodies || bodies.length !== 1) return { ok: false, sentence: `feature ${fid} produced ${bodies ? bodies.length : 0} bodies; a name is resolved on a single body` };
      if (!shapeCache.has(fid)) {
        const cmds = accepted.slice(0, st.accLen[fid]);
        let r;
        try { r = await ctx.topologyOf(cmds); } catch (e) { r = { ok: false, error: e.message }; }
        shapeCache.set(fid, { cmds, r });
      }
      const { cmds, r } = shapeCache.get(fid);
      if (!r.ok || !r.topology) return { ok: false, sentence: `solidcraft could not report the topology of ${fid} (${r.error ?? r.rejected ?? (r.failed && r.failed.error) ?? 'no topology in the reply'})` };
      if (r.topology.truncated) return { ok: false, sentence: `the topology of ${fid} is larger than the bridge's snapshot limit; not resolved` };
      const body = r.topology.bodies.find((b) => b.name === bodies[0]);
      if (!body || body.error) return { ok: false, sentence: `solidcraft returned no topology for body ${bodies[0]}${body?.error ? ' (' + body.error + ')' : ''}` };
      let k = -1;
      cmds.forEach((c, i) => { if (c.params?.body_name === bodies[0] && /^solid\.(box|cylinder|extrude|revolve|loft|sphere|torus)$/.test(c.command)) k = i; });
      const featureNumber = k >= 0 ? (r.results?.[k]?.feature ?? null) : null;
      return { ok: true, bodyName: bodies[0], featureId: fid, featureNumber, faces: body.faces, edges: body.edges };
    },
  };
}

/**
 * What a student reads when solidcraft itself refuses a feature the mapping let through. Raw kernel text ("solid.extrude: boolean Cut: the
 * operation failed: no result; ...") is never shown; it stays in the note's `failed` field for the evidence.
 */
export function plainKernelSentence(f, raw) {
  const what = f.kind === 'extrude' ? 'pull' : f.kind === 'pocket' ? 'pocket' : f.kind === 'combine' ? (f.op === 'union' ? 'join' : f.op === 'subtract' ? 'subtract' : 'intersect') : f.kind === 'fillet' ? 'round' : f.kind;
  const r = String(raw ?? '');
  // ROUND 3: a join (pad) the kernel refuses because its parts only touch, and the other raw boolean failures
  if (f.kind === 'combine' && /join cannot preserve the original faces|zero-thickness edge contact/.test(r)) return JOIN_TOUCH_SENTENCE(f.id);
  if (/profile loop is not closed/.test(r)) return `${f.id}: the outline does not close: two ends that should meet are a hair apart (less than 0.00001 mm); add a coincident rule between them or make them meet exactly`;
  if (f.kind === 'combine') return `${f.id}: this ${what} cannot be built from these parts (the solid it makes does not close up cleanly), so nothing is combined; change the sizes or positions so the parts overlap by a clear amount`;
  if (/taper closes the profile/.test(r)) return `${f.id}: the taper makes the outline fold over itself or close up before the end of the ${what}, so nothing is built; use a smaller taper or a shorter length`;
  if (/extrude distance is zero/.test(r)) return `${f.id}: the length is too small to build; make it at least ${MIN_LEN} mm`;
  if (/attach a plane to a wire/.test(r)) return `${f.id}: the outline is too small or too thin to build; draw it larger`;
  if (/through all needs a body/.test(r)) return `${f.id}: there is no part to cut through`;
  if (f.kind === 'extrude' || f.kind === 'pocket') return `${f.id}: this ${what} cannot be built from the sketch as drawn (the solid it makes does not close up cleanly), so nothing is ${what === 'pull' ? 'added' : 'cut'}; change the sketch, the length or the options`;
  // every other kind: a plain sentence, never the kernel's text (it stays in the note's `failed` field)
  return `${f.id}: this ${what} cannot be built as drawn (the solid it makes does not close up cleanly); change its sizes, positions or options`;
}

/**
 * Translate and execute a ModelDoc feature by feature.
 * ctx: { arc, mt, runSC(cmds)->parsed result, resolveAt(prefixFeatures, nameJson)->{kind,centroid,length|area}|null }
 * Returns { features: [{id, kind, status: 'built'|'refused'|'noop', commands, refusal?, measure?, pickedFrom?}], commands }.
 */
export async function translateDoc(doc, ctx) {
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {}, scene: [], curvedSlant: new Set() };
  const shapeCache = new Map();
  const accepted = [];
  const out = [];
  for (let idx = 0; idx < doc.features.length; idx++) {
    const f = doc.features[idx];
    const prefix = doc.features.slice(0, idx);
    const resolved = new Map();
    const fctx = { ...ctx, resolve: (name) => resolved.get(name) ?? null };
    // phase 4: resolve the one name this feature needs, from solidcraft's own topology, before planning it.
    const nameField = f.kind === 'shell' ? 'open' : f.kind === 'fillet' ? 'edge' : f.kind === 'draft' ? 'face' : null;
    if (nameField && f[nameField] && typeof f[nameField] === 'object' && ctx.topologyOf) {
      const env = makeEnv(st, accepted, prefix, ctx, shapeCache);
      let rr = await resolveName(f[nameField], env, nameField === 'edge' ? 'edge' : 'face');
      rr = await confirmOnTarget(rr, { st, accepted, ctx, targetId: f.target });
      if (rr.ok && rr.kind === 'faceset') resolved.set(f[nameField], { ok: false, sentence: `${rr.evidence.name} is ${rr.faces.length} faces in solidcraft (${rr.evidence.engineFaces.join(', ')}; a cylinder's wall is split at its seam); a face pick of it would choose one half silently, so nothing is picked` });
      else resolved.set(f[nameField], rr);
    }
    const note = (o) => out.push({ id: f.id, kind: f.kind, ...o });
    if (f.kind === 'sketch') st.sketches[f.id] = f;
    let plan;
    let internal = null;
    try { plan = planFeature(f, st, fctx); } catch (e) { internal = String(e && e.message); plan = refuse(`${f.id}: this ${f.kind === 'extrude' ? 'pull' : f.kind} could not be mapped for the solid kernel as written; simplify it or change its options`); }
    if (plan.refusal) { st.refused[f.id] = plan.refusal; note({ status: 'refused', refusal: plan.refusal, commands: [], ...(internal ? { internalError: internal } : {}) }); continue; }
    if (plan.noop) { note({ status: 'noop', commands: [] }); continue; }
    let lastErr = null;
    let lastFail = null;
    let verifyRefusal = null;
    const checks = [];
    let built = false;
    for (const variant of plan.variants) {
      let res;
      try { res = await ctx.runSC([...accepted, ...variant]); } catch (e) { res = { ok: false, failed: { error: `bridge error: ${e.message}` } }; }
      if (!res.ok) { lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.rejected ?? res.error ?? 'unknown'); lastFail = res; continue; }
      const m = aggregate(res, plan.produces);
      if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }
      const bad = plan.verify && !ctx.skipVerify ? await plan.verify(m, { accepted: accepted.slice(), variant, runSC: ctx.runSC, checks, scene: st.scene }) : null;
      if (bad) { verifyRefusal = bad; lastErr = null; continue; }
      accepted.push(...variant);
      if (plan.flagCurvedSlant) for (const b of m.bodies) st.curvedSlant.add(b);
      st.scene = res.measure.bodies.map((b) => ({ name: b.name, vol: b.volume_mm3, bbox: [...b.bbox.min, ...b.bbox.max], shells: b.kernel?.shells ?? 1 }));
      st.accLen[f.id] = accepted.length;
      st.bodies[f.id] = m.bodies;
      st.measure[f.id] = m;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? f.target : f.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
      }
      note({ status: 'built', checks, commands: variant, measure: m, pickedFrom: plan.pickedFrom, evidence: plan.evidence ?? null, pick: (variant.find((c) => c.params.edges || c.params.faces)?.params) ?? null, variantsTried: plan.variants.indexOf(variant) + 1 });
      built = true;
      break;
    }
    if (built) continue;
    const sentence = verifyRefusal ?? plainKernelSentence(f, lastErr);
    st.refused[f.id] = sentence;
    note({ status: 'refused', refusal: sentence, commands: plan.variants[0], failed: lastFail?.failed ?? null, sketchAtFailure: lastFail?.sketch_at_failure ?? null });
  }
  return { features: out, commands: accepted, _state: { st, accepted, shapeCache } };
}

/** Resolve one name against the shapes a finished translateDoc left behind (used by verify-picks; same code path). */
export async function resolveAfter(tr, doc, name, ctx, want, targetId = null, beforeId = null) {
  const { st, accepted: all, shapeCache } = tr._state;
  // the target as it stood BEFORE the feature that uses the name (after it, a rounded edge is gone by construction)
  let accepted = all;
  if (beforeId) {
    const i = doc.features.findIndex((x) => x.id === beforeId);
    let len = 0;
    for (let k = 0; k < i; k++) if (st.accLen[doc.features[k].id] !== undefined) len = Math.max(len, st.accLen[doc.features[k].id]);
    accepted = all.slice(0, len);
  }
  const rr = await resolveName(name, makeEnv(st, accepted, doc.features, ctx, shapeCache), want);
  return targetId ? confirmOnTarget(rr, { st, accepted, ctx, targetId }) : rr;
}
