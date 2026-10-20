// SPIKE, referee only (docs/spikes/solidcraft-referee/phase0). Not an engine, not an EngineAdapter, not in npm test.
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
// Picks: solidcraft picks faces/edges by a 3D point. For `between`/`swept`/`cap`/`carried` names the point comes from
// brep-rs `resolve` (ctx.resolve) -- so every named pick DEPENDS ON brep-rs. That is recorded, not hidden.

// PATCHES (contract translator, round 2). ctx.patches is a Set of these names; pm-run.mjs builds it from PM_TR / PM_OFF:
//   PM_TR=asis        -> empty set = the phase0 translator exactly as committed in ../phase0/translate.mjs (plus the student-sentence layer, which is cosmetic)
//   default (PM_TR=pm) -> all of them;  PM_OFF=plane,fresh  switches single patches off (negative controls)
//   reversed : a pocket with reversed:true pushes WITH the sweep (phase0 ignored the flag: silent wrong solid)
//   fresh    : bodies a command creates that the plan did not name ('b (2)' after a mirror/pattern of several bodies) are measured too
//   plane    : the mirror plane comes from an ANALYTIC bounding box built from the ModelDoc (tessellation-free) and is accepted only
//              when truck's measured box agrees within tolerance; otherwise measured box, refused if the part is curved
//   count1   : pattern count 1 is the identity (no command)
//   torus    : a torus in a pattern/mirror is refused unless every copy is provably clear of the others (truck hangs on touching tori)
//   contact  : copies of a repeat/repeatAround that meet only along an edge or at a point are refused (they would not be one solid)
//              (round 3: the "volume = sum" test of the joined pair now has the curved tolerance 3e-4, so tangent cylinders, whose joined
//              volume is tessellation-derived and differs from the sum by ~5e-5, are refused like edge-touching boxes)
// PATCHES (round 3, critic findings). Each is OFF in the AS-IS run (PM_TR=asis) and ON by default:
//   contact3 : the contact guard's pair test uses the curved volume tolerance 3e-4 for curved pairs (round 2: 1e-6, which missed tangent cylinders),
//              and curved copies with deeply overlapping boxes get a NUDGE test (push 2e-3 mm together; touching copies fuse into one shell)
//   disjoint : the fallback variant of a pattern (the copies left as separate bodies when solid.combine join fails) is accepted ONLY when every
//              pair of copies is provably apart (bbox gap > 1e-3 along some axis). Otherwise the pattern is REFUSED. Without this a failed join of
//              overlapping curved copies returned N bodies whose volumes are SUMMED (cone x2 step 3: +31%, spun washer x3: +72%), no sentence.
//   subgap   : planar copies separated by a gap in (1e-8, 1e-3] mm are refused (truck closes a gap <= 1e-5 into one fused bar, OCCT keeps it).
//   budget   : (round 4: the limit is a SAFETY NET, 600 s per run and 3600 s per model, and make-rows asserts no case reaches it, so a status never depends on the clock; the text below is the round-3 wording) every solidcraft run has a time limit (ctx.budgetMs, default 30000 ms of NEW work; the replay of what was already accepted gets
//              2x its own measured time on top). ctx.runSC(cmds,{budgetMs}) must kill the run and return {ok:false,timedOut:true}; the feature is
//              then REFUSED with a sentence and no other variant is tried. pm-run.mjs runs each solidcraft call in a child process for this.
//   mircontact: a mirror of a single-shell PLANAR part must meet its reflection in a FACE (overlap-growth test, see the code); edge/point contact is refused
//   fused    : a mirror of ONE body that comes back as several bodies (copy left unfused beside the original) is refused
//   (budget, whole model): ctx.docBudgetMs, default 300000 ms. Once a model has spent that long, every remaining step is refused with a sentence.
//   spinbox  : analytic bounding box of a full-turn spin (revolve) of a straight-edged outline, so mirror can place its plane without the
//              tessellated box
//   snap     : (round 4) copies shifted by almost nothing are refused. solid.combine join drops a sliver thinner than about 0.3% of the part (measured:
//              box 10 lost its extra layer up to a shift of 0.0275 mm, a 40x40x10 plate up to 0.032 mm in z, a 100x2x2 bar up to 0.01 mm in x), silently, and
//              the volume is wrong by exactly shift x face area. The guard refuses when 0 < shift <= 1.5% of the part's smallest bbox extent (a 5x margin over
//              the measured edge): linear pattern = |step|, circular pattern = the largest bbox-corner travel between neighbouring copies, pocket/hole =
//              a cut whose tool box is the same size as an earlier cut on the same body and sits that close to it (this is how repeat(pocket) arrives).
//   taper    : pull(..., {taper}) is mapped (solid.extrude {taper}) with the same fold guard as the extrude-pocket group, so a mirror/pattern of a
//              tapered pull can be measured
//   sliver   : (round 5) two planar copies within 0.02 mm of each other on every axis (bounding boxes) that are nearly aligned along some axis (|gap| in (1e-8, 5e-4] mm: a sliver
//              overlap or sliver gap) are refused. The fuzz found the join mis-fusing such pairs by a relative 1e-9 .. 4e-7 without an error; both thresholds were chosen AFTER seeing that
//              fuzz and are re-checked on fresh seeds.
import { outlineSize, taperFold } from './outline-guard.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The time limit needs a session that can be killed: the wasm call is synchronous, so it runs in pm-sc-child.mjs (needs SOLIDCRAFT_REFEREE_PKG).
// The translator spawns it itself, so the limit does not depend on the caller's runSC.
const SC_CHILD = fileURLToPath(new URL('./pm-sc-child.mjs', import.meta.url));
function runChild(cmds, budgetMs) {
  const p = spawnSync(process.execPath, [SC_CHILD], { input: JSON.stringify({ commands: cmds }), timeout: budgetMs, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 1 << 30, env: process.env });
  if ((p.error && p.error.code === 'ETIMEDOUT') || p.signal === 'SIGKILL' || p.status === null) return { ok: false, timedOut: true };
  try { return JSON.parse(p.stdout); } catch { return { ok: false, failed: { command: '(child)', error: `WASM TRAP: child exit ${p.status} ${String(p.stderr).slice(0, 200)}` } }; }
}
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

const refuse = (sentence, student) => ({ refusal: sentence, student });
// Round-3 patches are ON for any non-empty patch set that does not carry the marker '__explicit', so a harness that still passes the round-2
// list ['reversed','fresh','plane','count1','torus','contact'] (the critic's truck-child.mjs does) gets the round-3 guards too. pm-run.mjs adds
// '__explicit' to its set, which makes every patch name mean exactly itself (PM_OFF=disjoint,... negative controls; PM_TR=r2 = the round-2 set).
const R3_PATCHES = new Set(['mircontact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'snap', 'sliver']);
const hasP = (ctx, n) => { const p = ctx.patches; if (!p) return false; if (p.has(n)) return true; return R3_PATCHES.has(n) && p.size > 0 && !p.has('__explicit'); };
const CALL = { shell: 'hollow', extrude: 'pull', revolve: 'spin', blend: 'loft' };
const fname = (f) => (f.kind === 'pattern' ? (f.mode === 'circular' ? 'repeatAround' : 'repeat') : f.kind === 'combine' ? (f.op === 'union' ? 'join' : f.op === 'subtract' ? 'subtract' : 'common') : f.kind === 'fillet' ? (f.style === 'chamfer' ? 'bevel' : 'round') : (CALL[f.kind] ?? f.kind));

/**
 * The sentence a student sees for a refused feature: plain, one sentence, about THEIR call, no feature ids, no engine names, no
 * kernel text. `raw` is the translator/engine reason (kept in `refusal` for diagnostics). Unknown engine text falls to the last
 * entry, which is still one plain sentence but says less.
 */
export function studentSentence(f, raw) {
  const n = fname(f);
  const mm = (v) => String(+Number(v).toPrecision(2));
  let m;
  if (/TIME BUDGET: whole model/.test(raw)) { m = /exceeded (\d+) ms/.exec(raw); return `${n}(): checking the whole model was stopped after ${m ? Math.round(+m[1] / 60000) : 60} minutes without finishing, so this step and every step after it were left out -- use fewer steps or fewer copies.`; }
  if (/TIME BUDGET/.test(raw)) { m = /exceeded (\d+) ms/.exec(raw); return `${n}(): building this was stopped after ${m ? Math.round(+m[1] / 1000) : 600} seconds without finishing, so it was left out -- use fewer copies, space them apart, or use flat-sided shapes.`; }
  if (/pattern count must be/.test(raw)) return `${n}(): a pattern can have at most 1000 copies, and this one asks for ${f.count} -- use a count of 1000 or fewer.`;
  if (/near-coincident copies/.test(raw)) { m = /shifted by only ([\d.e+-]+) mm \(([\d.e+-]+) mm is the smallest safe shift/.exec(raw); return `${n}(): the copies are shifted by only ${m ? m[1] : 'a hair'} mm, so each one lies almost exactly on the one before and the thin layer between them would be lost -- shift them by more than ${m ? m[2] : 'a few hundredths of'} mm, or by a whole part size.`; }
  if (/near-coincident cut/.test(raw)) { m = /by only ([\d.e+-]+) mm from an earlier cut of the same size \(([\d.e+-]+) mm is the smallest safe shift/.exec(raw); return `${n}(): this cut lies only ${m ? m[1] : 'a hair'} mm from an earlier cut of the same size, so the thin sliver between the two would be lost -- move it by more than ${m ? m[2] : 'a few hundredths of'} mm, or leave it out.`; }
  if (/mirror copy not fused/.test(raw) || (f.kind === 'mirror' && /boolean Union: the operation failed/.test(raw))) return `mirror(): the mirrored copy touches the original but the two could not be fused into one solid -- mirror in another direction, or build the part with pull() instead of spin().`;
  if (/sub-resolution gap/.test(raw)) { m = /apart by ([\d.e+-]+) mm/.exec(raw); return `${n}(): the copies would be only ${m ? m[1] : 'a hair'} mm apart, a gap too small to keep apart reliably -- make the gap larger than 0.001 mm, or let the copies touch exactly.`; }
  if (/sub-resolution overlap/.test(raw)) { m = /by only ([\d.e+-]+) mm/.exec(raw); return `${n}(): the copies overlap by only ${m ? m[1] : 'a hair'} mm, too little to fuse them reliably -- overlap them by more than 0.0005 mm (a visible overlap is better), or leave a clear gap.`; }
  if (/copies overlap or touch.*curved/.test(raw)) return `${n}(): these copies overlap or touch, and their curved faces cannot be fused into one solid yet -- space the copies so they clear each other, or build the shape from flat faces.`;
  if (/copies overlap or touch/.test(raw)) return `${n}(): these copies overlap or touch and could not be fused into one solid -- space the copies so they clear each other by a visible gap, or overlap them clearly.`;
  if (/mirror contact is not a face/.test(raw)) return `mirror(): on that side the part meets the mirror plane only along a line or at a point (its nearest side is curved, pointed or edge-on), so the copy cannot be fused to it -- mirror in a direction where the part has a flat face, or turn the part so a flat face points that way (a sphere has no flat face to turn).`;
  if (/lumps: shell boundaries intersect or touch/.test(raw)) {
    if (f.kind === 'mirror') return `mirror(): on that side the part meets the mirror plane only along a line or at a point (its nearest side is curved, pointed or edge-on), so the copy cannot be fused to it -- mirror in a direction where the part has a flat face, or turn the part so a flat face points that way (a sphere has no flat face to turn).`;
    return `${n}(): two of the copies would meet only along an edge or at a point, so the result would not be one solid -- overlap them along a face or leave a gap.`;
  }
  if (/join cannot preserve the original faces|boolean Union: the operation failed|exact fallback for where the bodies meet/.test(raw)) return `${n}(): these two shapes touch only along a line or at a point (or are exactly tangent), so they cannot be fused into one solid -- overlap them a little or leave a gap.`;
  if (/angle semantics|less than 360 degrees is not mapped/.test(raw)) return `${n}(): a turn other than one full 360 degrees is not available for a whole shape yet -- leave the angle out for a full turn, or repeat a pocket or hole, which does accept an angle.`;
  if (/zero step/.test(raw)) return `${n}(): the step is [0, 0, 0], so every copy would land exactly on the original -- give a step such as [30, 0, 0].`;
  if (/counterbore and countersink are not mapped/.test(raw)) return `hole(): a hole with a counterbore or countersink cannot be drilled yet, so it cannot be repeated either -- drill a plain hole instead.`;
  if (f.kind === 'shell' && /faces. must be a list of points|solid\.shell/.test(raw)) return `hollow(): a hollow with no open side cannot be built here, so it cannot be repeated or mirrored either -- give the hollow an open side, for example hollow(shape, { wall: 3, open: 'top' }).`;
  if (/torus/.test(raw) && /clear of/.test(raw)) return `${n}(): copies of a ring that touch or overlap cannot be fused reliably yet -- space the copies so the rings do not meet.`;
  if (/only along an edge or at a point/.test(raw)) return `${n}(): two of the copies would meet only along an edge or at a point, so the result would not be one solid -- overlap them along a face or leave a gap.`;
  if (/analytic|cannot tell exactly where the part ends/.test(raw)) return `${n}(): it cannot be told exactly where this curved part ends in that direction, so the mirror plane cannot be placed -- mirror a part made of flat faces, or build the other half yourself.`;
  if ((m = /the (\w+) option is not mapped/.exec(raw))) return `${n}(): the ${m[1]} option is not built yet -- leave ${m[1]} out.`;
  if (/taper closes the profile|fold over itself/.test(raw)) return `${n}(): the taper makes the outline fold over itself before the end of the pull, so nothing is built -- use a smaller taper or a shorter pull.`;
  if (/not a single body|needs a single/.test(raw)) return `${n}(): this works on one shape at a time, and what it was given is several separate shapes -- join them first.`;
  if (f.kind === 'draft' && /solid\.draft|drafting faces/.test(raw)) return `draft(): a draft can only be put on a face that is parallel to the pull direction (the top face of a box is not) -- leave the draft out, or draft a side face.`;
  if (/sum check/.test(raw)) return `${n}(): the copies are apart, but the volume of the result does not add up to the volume of the copies, so it cannot be trusted -- move the copies clearly apart or clearly together, or line their faces up exactly.`;
  if (/no measured bounding box/.test(raw)) return `${n}(): there is no built shape to ${n} -- an earlier step did not produce one.`;
  return `${n}(): this could not be built reliably, so it was left out -- change the shape or its numbers a little and try again.`;
}
// rootCause: a refusal that points at an earlier refused feature keeps that feature's sentence


/** Sketch outline -> sketch.* commands (inside an open sketch). Returns {cmds} or {refusal}. */
function profileCmds(sk, ctx) {
  if (sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0) {
    return refuse(`sketch ${sk.id} is drawn as rows and rules (a soup), which this translator does not map yet`);
  }
  const o = ctx.arc.outlineOf(sk);
  if (!o.ok) return refuse(`sketch ${sk.id} has no usable outline (${(o.notes ?? []).join('; ') || 'outlineOf refused it'})`);
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

function inSketch(sk, ctx, st, { revolve = false } = {}) {
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


// ---- patch 'snap' (round 4) ---------------------------------------------------------------------------------------
// solid.combine join drops a layer thinner than about 0.3% of the part when one copy lies almost exactly on another. MEASURED (snap-probe.mjs,
// two copies, truck vs closed-form union volume): box 10 loses its extra layer up to a shift of 0.0275 mm (0.003 is right), a 40x40x10 plate up to 0.032 in z and
// 0.05 in x, a 100x2x2 bar up to 0.01 in x and 0.005 in y, a 100x100x1 slab up to 0.003 in z, a unit cube up to 0.00275; a diagonal shift [d,d,d] up to d = 0.001 x size.
// In every case the result is ONE solid with volume = the original, no error. The guard refuses 0 < shift <= SNAP_REL x the part's smallest bbox extent.
export const SNAP_REL = 0.015;
export const SLIVER_MM = 5e-4; // round 5, see the 'sliver' guard in the pattern block
const minExtent = (lo, hi) => { const e = [0, 1, 2].map((i) => hi[i] - lo[i]).filter((v) => v > 1e-9); return e.length ? Math.min(...e) : 0; };
const fmtMm = (v) => String(+Number(v).toPrecision(2));
/** World box of the tool a pocket or hole sweeps (for the near-coincident cut check). */
function toolBoxOf(f, st, ctx) {
  if (f.kind === 'pocket') {
    const sk = st.sketches[f.target]; if (!sk) return null;
    const fr = frameOf(sk, ctx.mt); const o = ctx.arc.outlineOf(sk); if (!o.ok) return null;
    const W = (p) => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1]);
    let pts;
    if (sk.shape === 'circle') { const [a, b] = o.points; const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2; pts = [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] - r, c[1] + r], [c[0] + r, c[1] + r]].map(W); }
    else pts = o.points.map(W);
    const nl = Math.hypot(...fr.n) || 1; const sgn = f.reversed ? 1 : -1;
    const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    for (const q of pts) for (const t of [0, sgn * f.depth]) for (let i = 0; i < 3; i++) { const v = q[i] + (fr.n[i] / nl) * t; lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); }
    return { lo, hi };
  }
  if (f.kind === 'hole') {
    const m = st.measure[f.target]; if (!m) return null;
    const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const centers = f.corners ? [[-f.corners.dx, -f.corners.dy], [f.corners.dx, -f.corners.dy], [-f.corners.dx, f.corners.dy], [f.corners.dx, f.corners.dy]] : [[0, 0]];
    const ai = { x: 0, y: 1, z: 2 }[f.axis ?? 'z']; const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    for (const [ox, oy] of centers) {
      const c = [bc[0] + f.center[0] + (f.corners ? ox : 0), bc[1] + f.center[1] + (f.corners ? oy : 0), bc[2] + f.center[2]];
      for (let i = 0; i < 3; i++) { const h = i === ai ? f.depth / 2 : f.diameter / 2; lo[i] = Math.min(lo[i], c[i] - h); hi[i] = Math.max(hi[i], c[i] + h); }
    }
    return { lo, hi };
  }
  return null;
}
/** Near-coincident cut: a tool box of the same size as an earlier one on the same body, sitting 0 < d <= SNAP_REL x smallest extent from it. */
function snapCut(tb, prior) {
  const ext = [0, 1, 2].map((i) => tb.hi[i] - tb.lo[i]); const mn = minExtent(tb.lo, tb.hi); if (!(mn > 0)) return null;
  const tau = SNAP_REL * mn;
  for (const pb of prior ?? []) {
    if (!ext.every((e, i) => Math.abs(e - (pb.hi[i] - pb.lo[i])) <= tau)) continue;
    const d = Math.hypot(...[0, 1, 2].map((i) => (tb.lo[i] + tb.hi[i]) / 2 - (pb.lo[i] + pb.hi[i]) / 2));
    if (d > 1e-9 && d <= tau) return { d, tau };
  }
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
    if (st.refused[id]) return `${f.id} (${f.kind}): its ${role} ${id} was refused (${st.refused[id]})`;
    if (st.stale[id]) return `${f.id} (${f.kind}): its ${role} ${id} was already changed in place by ${st.stale[id]}, and a solidcraft command list has no second copy of it`;
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
      const canTaper = hasP(ctx, 'taper') && f.taper && !(f.midplane || f.length2 || f.reversed || f.direction || f.alongNormal) && f.height > 0 && Math.abs(f.taper) <= 89.9;
      for (const k of ['midplane', 'length2', 'reversed', 'taper', 'direction', 'alongNormal']) {
        if (f[k] && !(k === 'taper' && canTaper)) return refuse(`${f.id} (extrude): the ${k} option is not mapped in phase 0 (only a plain one-sided extrude along the sketch normal is)`);
      }
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (extrude): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id} (extrude): ${s.refusal}`);
      const ex = { distance: f.height, sketch: s.name, operation: 'new', body_name: name };
      if (canTaper) {
        // PM PATCH 'taper' (same mapping and fold guard as the extrude-pocket group): positive taper grows the profile
        const o = ctx.arc.outlineOf(sk);
        if (!o.ok) return refuse(`${f.id} (extrude): sketch ${sk.id} has no usable outline`);
        const oo = { ...o, shape: sk.shape };
        const size = outlineSize(oo, ctx.arc);
        const fold = taperFold(oo, ctx.arc, f.height * Math.tan((f.taper * Math.PI) / 180), sk.shape === 'circle' ? size.minRadius : null);
        if (fold) return refuse(`${f.id} (extrude): a taper of ${f.taper} degrees over ${f.height} mm makes the outline fold over itself (the taper closes the profile)`);
        ex.taper = f.taper;
      }
      return { variants: [[...s.cmds, { command: 'solid.extrude', params: ex }]], produces: [name], consumes: [] };
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
      const sk = st.sketches[f.target];
      const bs = needBody(f.into);
      if (!sk || !bs || bs.length !== 1) return refuse(`${f.id} (pocket): needs a sketch and a single body`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id} (pocket): ${s.refusal}`);
      // pocket pushes OPPOSITE the sweep direction (occt-build: h = -depth * dir), i.e. direction negative on a u x v frame
      // PM PATCH: phase0 ignored f.reversed here (a SILENT WRONG SOLID: the cut ran the unreversed way). With ctx.mapReversed the
      // reversed pocket pushes WITH the sweep (u x v), i.e. direction 'positive'; without it, a reversed pocket is left as phase0 had it.
      const dir = f.reversed && ctx.mapReversed ? 'positive' : 'negative';
      return { variants: [[...s.cmds, { command: 'solid.extrude', params: { distance: f.depth, direction: dir, sketch: s.name, operation: 'cut', targets: bs } }]], produces: bs, consumes: [f.into], toolBox: toolBoxOf(f, st, ctx) };
    }
    case 'blend': {
      const ds = f.targets.map((t) => dep(t, 'sketch')).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (blend): needs two or more sketches`);
      const cmds = []; const names = [];
      for (const t of f.targets) {
        const sk = st.sketches[t];
        if (!sk) return refuse(`${f.id} (blend): ${t} is not a sketch`);
        const s = inSketch(sk, ctx, st);
        if (s.refusal) return refuse(`${f.id} (blend): ${s.refusal}`);
        cmds.push(...s.cmds); names.push(s.name);
      }
      cmds.push({ command: 'solid.loft', params: { sections: names.map((n) => ({ sketch: n })), operation: 'new', body_name: name } });
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case 'combine': {
      const ds = f.targets.map((t) => dep(t)).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (combine): needs two or more targets`);
      const all = f.targets.map((t) => needBody(t));
      if (all.some((b) => !b || b.length !== 1)) return refuse(`${f.id} (combine): every target must be a single body`);
      const op = f.op === 'union' ? 'join' : f.op === 'subtract' ? 'cut' : 'intersect';
      const names = all.map((b) => b[0]);
      return {
        variants: [[{ command: 'solid.combine', params: { target: names[0], tools: names.slice(1), operation: op } }]],
        produces: [names[0]], consumes: f.targets,
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
      let lo = m.bbox[axis]; let hi = m.bbox[axis + 3];
      let how = 'measured';
      if (hasP(ctx, 'plane')) {
        // analytic box from the ModelDoc, accepted only if truck's measured box agrees (guards a wrong algebra)
        const a = st.abox[f.target];
        const ext = Math.max(...[0, 1, 2].map((i) => m.bbox[i + 3] - m.bbox[i]), 1);
        const tol = 1e-3 + 1e-4 * ext;
        if (a && [0, 1, 2].every((i) => Math.abs(a.lo[i] - m.bbox[i]) <= tol && Math.abs(a.hi[i] - m.bbox[i + 3]) <= tol)) { lo = a.lo[axis]; hi = a.hi[axis]; how = 'analytic'; }
        else if (m.curved) return refuse(`${f.id} (mirror): cannot tell exactly where the part ends along the mirror direction (no analytic box, curved faces) -- truck's box is tessellation-derived`);
        else if (Math.abs(Math.abs(lo) - Math.abs(hi)) <= 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))) { hi = -lo; how = 'measured-planar-tie'; }
      }
      const at = Math.abs(lo) <= Math.abs(hi) ? lo : hi; // occt-build: through the part's nearer face on this axis
      const origin = [0, 0, 0]; origin[axis] = at;
      const normal = [0, 0, 0]; normal[axis] = 1;
      return { variants: [[{ command: 'solid.mirror', params: { bodies: bs, plane: { origin, normal }, combine: true } }]], produces: bs, consumes: [f.target], mirrorAt: { axis, at, how } };
    }
    case 'pattern': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (pattern): needs a single target body`);
      if (f.count < 2) {
        if (hasP(ctx, 'count1')) return { variants: [[]], produces: bs, consumes: [f.target], identity: true };
        return refuse(`${f.id} (pattern): a count under 2 is the original alone; not mapped`);
      }
      if (hasP(ctx, 'snap')) {
        const tm = st.measure[f.target];
        if (tm) {
          const mn = minExtent(tm.bbox.slice(0, 3), tm.bbox.slice(3)); const tau = SNAP_REL * mn;
          let disp = 0;
          if (f.mode === 'circular') {
            const ai = { x: 0, y: 1, z: 2 }[f.axis ?? 'z']; const th = (2 * Math.PI) / f.count;
            for (const cx of [0, 3]) for (const cy of [1, 4]) for (const cz of [2, 5]) {
              const c = [tm.bbox[cx], tm.bbox[cy], tm.bbox[cz]]; const rho = Math.hypot(...c.filter((_, i) => i !== ai));
              disp = Math.max(disp, 2 * rho * Math.sin(th / 2));
            }
          } else disp = len(f.step ?? [0, 0, 0]);
          if (mn > 0 && disp > 0 && disp <= tau) return refuse(`${f.id} (pattern): near-coincident copies: consecutive copies are shifted by only ${fmtMm(disp)} mm (${fmtMm(tau)} mm is the smallest safe shift: ${SNAP_REL * 100}% of the part's smallest size ${fmtMm(mn)} mm), so solid.combine join would drop the thin layer between them and report the original's volume`);
        }
      }
      const copies = [bs[0], ...Array.from({ length: f.count - 1 }, (_, i) => `${bs[0]} (${i + 2})`)];
      let pat;
      if (f.mode === 'circular') {
        const tot = f.totalAngle ?? 360;
        if (tot !== 360 && !ctx.mapPartialAngle) return refuse(`${f.id} (pattern): a circular pattern over less than 360 degrees is not mapped (solidcraft's angle semantics were not verified)`);
        pat = { command: 'solid.pattern.circular', params: { bodies: bs, axis: AXN[f.axis ?? 'z'], count: f.count } };
        // PM PATCH (contract spike): with ctx.mapPartialAngle the angle is passed through, to MEASURE solidcraft's semantics.
        //   true       -> angle as given (solidcraft spaces a partial turn by angle/(count-1): the FreeCAD rule)
        //   'modeldoc' -> angle*(count-1)/count, so solidcraft's angle/(count-1) comes out as the ModelDoc/OCCT/brep-rs rule angle/count
        if (tot !== 360) pat.params.angle = `${ctx.mapPartialAngle === 'modeldoc' ? tot * (f.count - 1) / f.count : tot} deg`;
      } else {
        const s = f.step ?? [0, 0, 0];
        if (isZero3(s)) return refuse(`${f.id} (pattern): a zero step puts every copy on the original`);
        const L = len(s);
        pat = { command: 'solid.pattern.rectangular', params: { bodies: bs, dir1: s.map((v) => v / L), count1: f.count, spacing1: L } };
      }
      // OCCT fuses the instances. Try to join them; if solidcraft cannot (disjoint copies), keep them as separate bodies.
      const join = { command: 'solid.combine', params: { target: copies[0], tools: copies.slice(1), operation: 'join' } };
      return { variants: [[pat, join], [pat]], produces: copies, consumes: [f.target], copiesOf: bs[0] };
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
      return { variants: [cmds], produces: bs, consumes: [f.target], toolBox: toolBoxOf(f, st, ctx) };
    }
    case 'shell': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (shell): needs a single target body`);
      if (!f.open) return { variants: [[{ command: 'solid.shell', params: { thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target] };
      const r = ctx.resolve(f.open);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (shell): the opened face could not be resolved to a point (brep-rs resolve gave ${r ? r.kind : 'nothing'})`);
      return { variants: [[{ command: 'solid.shell', params: { faces: [r.centroid], thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve' };
    }
    case 'fillet': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (fillet): needs a single target body`);
      const r = ctx.resolve(f.edge);
      if (!r || r.kind !== 'edge') return refuse(`${f.id} (fillet): the edge could not be resolved to a point (brep-rs resolve gave ${r ? r.kind : 'nothing'})`);
      const c = r.centroid;
      // A closed circle's centroid is its centre, which is not on the edge: also try one radius out along each world axis.
      const cands = [c];
      if (r.length > 0) { const rad = r.length / (2 * Math.PI); for (const a of ['x', 'y', 'z']) cands.push(add(c, AX[a].map((v) => v * rad))); }
      const mk = (p) => (f.style === 'chamfer'
        ? { command: 'solid.chamfer', params: { edges: [p], distance: f.size, body: bs[0] } }
        : { command: 'solid.fillet', params: { edges: [p], radius: f.size, body: bs[0] } });
      return { variants: cands.map((p) => [mk(p)]), produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve' };
    }
    case 'draft': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.whole || !f.face) return refuse(`${f.id} (draft): a whole-body draft is not mapped (needs a face pick per face)`);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (draft): needs a single target body`);
      const r = ctx.resolve(f.face);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (draft): the face could not be resolved to a point`);
      const ax = AX[f.pull ?? 'z'];
      return {
        variants: [[{ command: 'solid.draft', params: { faces: [r.centroid], angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }]],
        produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve',
      };
    }
    default:
      return refuse(`${f.id}: feature kind '${f.kind}' is not in the ModelDoc vocabulary this translator knows`);
  }
}

// ---- analytic bounding boxes (patch 'plane') ---------------------------------------------------------------------
// Built from the ModelDoc only, never from truck's tessellated measure. null = unknown (the caller falls back to the measured box).
const rot90Half = (h, angles) => {
  const v = [...h];
  for (let a = 0; a < 3; a++) {
    const ang = angles?.[a] ?? 0;
    if (!ang) continue;
    const k = ang / 90;
    if (!Number.isInteger(k)) return null;
    if (((k % 2) + 2) % 2 === 1) { const i = (a + 1) % 3; const j = (a + 2) % 3; [v[i], v[j]] = [v[j], v[i]]; }
  }
  return v;
};
const unionBox = (bs) => (bs.some((b) => !b) ? null : { lo: [0, 1, 2].map((i) => Math.min(...bs.map((b) => b.lo[i]))), hi: [0, 1, 2].map((i) => Math.max(...bs.map((b) => b.hi[i]))) });
const shiftBox = (b, t) => (b ? { lo: b.lo.map((v, i) => v + t[i]), hi: b.hi.map((v, i) => v + t[i]) } : null);
export function analyticBox(f, st, ctx, plan) {
  const c = f.center ?? [0, 0, 0];
  switch (f.kind) {
    case 'box': case 'cylinder': case 'sphere': case 'cone': case 'torus': {
      const h = f.kind === 'box' ? f.size.map((v) => v / 2)
        : f.kind === 'cylinder' || f.kind === 'cone' ? [f.radius, f.radius, f.height / 2]
          : f.kind === 'sphere' ? [f.radius, f.radius, f.radius]
            : [f.ringRadius + f.tubeRadius, f.ringRadius + f.tubeRadius, f.tubeRadius];
      const r = isZero3(f.rotate) ? h : rot90Half(h, f.rotate);
      return r ? { lo: c.map((v, i) => v - r[i]), hi: c.map((v, i) => v + r[i]) } : null;
    }
    case 'prism': case 'wedge': {
      if (!isZero3(f.rotate)) return null;
      const poly = f.kind === 'prism'
        ? (() => { const n = Math.max(3, Math.min(12, Math.round(f.sides))); return Array.from({ length: n }, (_, i) => [f.radius * Math.cos(2 * Math.PI * i / n), f.radius * Math.sin(2 * Math.PI * i / n)]); })()
        : [[-f.width / 2, -f.depth / 2], [f.width / 2, -f.depth / 2], [-f.width / 2, f.depth / 2]];
      const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
      return { lo: [c[0] + Math.min(...xs), c[1] + Math.min(...ys), c[2] - f.height / 2], hi: [c[0] + Math.max(...xs), c[1] + Math.max(...ys), c[2] + f.height / 2] };
    }
    case 'extrude': {
      if (f.taper) return null; // a taper leans the walls: the base outline's box is not the part's box
      const sk = st.sketches[f.target];
      if (!sk) return null;
      const fr = frameOf(sk, ctx.mt);
      const o = ctx.arc.outlineOf(sk);
      if (!o.ok) return null;
      const W = (p) => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1]);
      const sweep = (pts3, half) => {
        const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
        for (const q of pts3) for (const t of [0, f.height]) for (let i = 0; i < 3; i++) { const v = q[i] + fr.n[i] * t; lo[i] = Math.min(lo[i], v - half[i]); hi[i] = Math.max(hi[i], v + half[i]); }
        return { lo, hi };
      };
      if (sk.shape === 'circle') {
        const [a, b] = o.points; const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
        const nl = Math.hypot(...fr.n);
        return sweep([W([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])], fr.n.map((v) => r * Math.sqrt(Math.max(0, 1 - (v / nl) ** 2))));
      }
      if (Object.values(o.bulges ?? {}).some((g) => g)) return null; // arcs: bbox of the chords is not the bbox of the arcs
      return sweep(o.points.map(W), [0, 0, 0]);
    }
    case 'revolve': {
      // PM PATCH 'spinbox': a full turn of a straight-edged outline about the frame's normal through the frame origin. Axial extent = the outline's
      // extent along n, radial extent = the largest |u| of any vertex (a chord's distance to the axis is largest at a vertex). Axis-aligned frames only.
      if (!hasP(ctx, 'spinbox') || f.angle !== 360) return null;
      const sk = st.sketches[f.target];
      if (!sk) return null;
      const fr = frameOf(sk, ctx.mt);
      const ai = fr.n.findIndex((c) => Math.abs(Math.abs(c) - 1) < 1e-12);
      if (ai < 0 || fr.n.filter((c) => Math.abs(c) > 1e-12).length !== 1) return null;
      const o = ctx.arc.outlineOf(sk);
      if (!o.ok || sk.shape === 'circle' || Object.values(o.bulges ?? {}).some((g) => g)) return null;
      const us = o.points.map((p) => p[0]); const vs = o.points.map((p) => p[1]);
      const R = Math.max(...us.map(Math.abs));
      const ax = [fr.origin[ai] + fr.n[ai] * Math.min(...vs), fr.origin[ai] + fr.n[ai] * Math.max(...vs)].sort((a, b) => a - b);
      const lo = [0, 1, 2].map((i) => (i === ai ? ax[0] : fr.origin[i] - R)); const hi = [0, 1, 2].map((i) => (i === ai ? ax[1] : fr.origin[i] + R));
      return { lo, hi };
    }
    case 'combine': {
      const bx = f.targets.map((t) => st.abox[t] ?? null);
      return f.op === 'union' ? unionBox(bx) : f.op === 'subtract' ? bx[0] : null;
    }
    case 'hole': return st.abox[f.target] ?? null;
    case 'pocket': case 'groove': return st.abox[f.into] ?? null;
    case 'move': return f.copy ? null : shiftBox(st.abox[f.target] ?? null, f.offset);
    case 'rotate': {
      const b = st.abox[f.target];
      if (!b) return null;
      const r = rot90Half([0, 1, 2].map((i) => (b.hi[i] - b.lo[i]) / 2), f.angles);
      if (!r) return null;
      const m = [0, 1, 2].map((i) => (b.hi[i] + b.lo[i]) / 2);
      return { lo: m.map((v, i) => v - r[i]), hi: m.map((v, i) => v + r[i]) };
    }
    case 'mirror': {
      const b = st.abox[f.target]; const at = plan.mirrorAt;
      if (!b || !at) return null;
      const lo = [...b.lo]; const hi = [...b.hi];
      lo[at.axis] = 2 * at.at - b.hi[at.axis]; hi[at.axis] = 2 * at.at - b.lo[at.axis];
      return unionBox([b, { lo, hi }]);
    }
    case 'pattern': {
      const b = st.abox[f.target];
      if (!b) return null;
      if (f.count < 2) return b;
      if (f.mode === 'circular') return null;
      const s = f.step ?? [0, 0, 0];
      return unionBox(Array.from({ length: f.count }, (_, i) => shiftBox(b, s.map((v) => v * i))));
    }
    default: return null;
  }
}

/** Do two boxes touch or overlap (gap <= tol on every axis)? Returns the per-axis gaps. */
const boxGap = (a, b) => [0, 1, 2].map((i) => Math.max(a.bbox[i] - b.bbox[i + 3], b.bbox[i] - a.bbox[i + 3]));

/** Aggregate the named bodies of a successful run into one measure (sum volume/faces, union bbox). */
function aggregate(res, names) {
  const bs = res.measure.bodies.filter((b) => names.includes(b.name));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  return {
    volume: bs.reduce((s, b) => s + b.volume_mm3, 0),
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    shells: bs.reduce((s, b) => s + b.kernel.shells, 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / bs.reduce((a, b) => a + b.volume_mm3, 0)),
    bodies: bs.map((b) => b.name),
  };
}

/**
 * Translate and execute a ModelDoc feature by feature.
 * ctx: { arc, mt, runSC(cmds)->parsed result, resolveAt(prefixFeatures, nameJson)->{kind,centroid,length|area}|null }
 * Returns { features: [{id, kind, status: 'built'|'refused'|'noop', commands, refusal?, measure?, pickedFrom?}], commands }.
 */
export function translateDoc(doc, ctx) {
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, refusedStudent: {}, sketches: {}, measure: {}, abox: {}, torus: {}, rootOf: {}, accMs: 0, counter: 0 };
  const accepted = [];
  const out = [];
  const P = (n) => hasP(ctx, n);
  const docT0 = Date.now();
  const DOC_BUDGET = ctx.docBudgetMs ?? 3600000; // round 4: a SAFETY NET against a hang, not a status criterion (no case of the suite reaches it; make-rows asserts that). This translator replays the accepted commands for every feature, so a long chain costs quadratic time in the RIG; a product that keeps one session open has no such cost
  doc.features.forEach((f, idx) => {
    const prefix = doc.features.slice(0, idx);
    const fctx = { ...ctx, resolve: (name) => ctx.resolveAt(prefix, name), mapReversed: ctx.mapReversed || P('reversed') };
    const note = (o) => out.push({ id: f.id, kind: f.kind, ...o });
    const rootStudent = (raw) => {
      const m = /its (?:target|sketch|solid) (\S+) was refused/.exec(raw);
      if (m && st.refusedStudent[m[1]]) {
        // round 3: a dependent names the call it needs and the ROOT cause, instead of repeating the root's sentence under the wrong call
        const dep = st.rootOf[headRoot(m[1])] ?? st.rootOf[m[1]];
        if (dep) { st.rootOf[f.id] = dep; return `${fname(f)}(): it needs ${dep.call}() to be built first, and that was refused: ${dep.reason}`; }
        return st.refusedStudent[m[1]];
      }
      if (/was already changed in place/.test(raw)) return `${fname(f)}(): the shape it works on was already used up by an earlier step, so it cannot be used a second time.`;
      return studentSentence(f, raw);
    };
    const headRoot = (id) => { const seen = new Set(); let h = id; while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
    const refusedNote = (raw, student, commands) => {
      const sentence = student ?? rootStudent(raw);
      st.refused[f.id] = raw; st.refusedStudent[f.id] = sentence;
      if (!st.rootOf[f.id]) st.rootOf[f.id] = { call: fname(f), reason: sentence.replace(/^[\w]+\(\): /, '') };
      return note({ status: 'refused', refusal: raw, student: sentence, commands });
    };
    if (P('budget') && Date.now() - docT0 > DOC_BUDGET && f.kind !== 'sketch' && f.kind !== 'datum') {
      return refusedNote(`${f.id} (${f.kind}): TIME BUDGET: whole model exceeded ${DOC_BUDGET} ms before this step`, undefined, []);
    }
    if (f.kind === 'sketch') st.sketches[f.id] = f;
    let plan;
    try { plan = planFeature(f, st, fctx); } catch (e) { plan = refuse(`${f.id} (${f.kind}): translator error: ${e.message}`); }
    if (plan.refusal) return refusedNote(plan.refusal, plan.student, []);
    if (plan.noop) return note({ status: 'noop', commands: [] });
    if (P('snap') && plan.toolBox && plan.produces?.[0]) {
      const hit = snapCut(plan.toolBox, st.tools?.[plan.produces[0]]);
      if (hit) return refusedNote(`${f.id} (${f.kind}): near-coincident cut: this cut lies by only ${fmtMm(hit.d)} mm from an earlier cut of the same size (${fmtMm(hit.tau)} mm is the smallest safe shift: ${SNAP_REL * 100}% of the tool's smallest size), so the thin sliver between the two would be dropped`, undefined, []);
    }
    // ---- torus guard (patch 'torus'): truck did not return from a pattern of touching tori in 150 s (measured), and a
    // mirror always lands the copy ON the original (it reflects through the part's own extreme), so a torus mirror always touches.
    if (P('torus') && (f.kind === 'pattern' || f.kind === 'mirror') && !plan.identity) {
      const tm = st.measure[f.target];
      if (tm && st.torus[f.target]) { // truck reports a torus face as type 'other', so lineage from the ModelDoc is used, not face_types
        let clear = false;
        const bb = tm.bbox;
        if (f.kind === 'pattern' && f.mode !== 'circular') {
          const s0 = f.step ?? [0, 0, 0];
          // every pair of copies separated by more than 1e-3 along some axis (copy i vs i+1 is the closest pair for a straight step)
          clear = [0, 1, 2].some((a) => Math.abs(s0[a]) > (bb[a + 3] - bb[a]) + 1e-3);
        } else if (f.kind === 'pattern') {
          const ax = { x: 0, y: 1, z: 2 }[f.axis ?? 'z'];
          const mid = [0, 1, 2].map((i) => (bb[i] + bb[i + 3]) / 2);
          const rad = Math.hypot(...mid.filter((_, i) => i !== ax));
          const bsr = Math.hypot(...[0, 1, 2].map((i) => (bb[i + 3] - bb[i]) / 2));
          const spacing = (2 * Math.PI) / f.count; // full turn; partial turns are not mapped
          clear = (f.totalAngle ?? 360) === 360 && 2 * rad * Math.sin(spacing / 2) > 2 * bsr + 1e-3;
        }
        if (!clear) return refusedNote(`${f.id} (${f.kind}): a torus is in the shape and its copies are not provably clear of each other (truck does not return on touching tori)`, f.kind === 'mirror' ? 'mirror(): a mirrored ring always meets its original along a circle, so the two would not become one solid -- build the second ring yourself with move() and leave a clear gap.' : `${fname(f)}(): rings that touch or overlap cannot be fused reliably yet -- space the copies so the rings do not meet.`, []);
      }
    }
    let lastErr = null;
    let firstJoinErr = null;
    // ---- time limit (patch 'budget'): NEW work gets ctx.budgetMs (default 30 s); replaying what is already accepted gets 2x the time it took
    // when it was accepted (plus 1 s), so one slow feature does not make every later feature time out on its replay.
    const B = ctx.budgetMs ?? 600000; // round 4: safety net (10 min per solidcraft run), no longer a status criterion; the slowest case of the suite is ~150 s under load 50 to 100
    const callSC = (cmds) => {
      const t0 = Date.now();
      const opts = P('budget') ? { budgetMs: B + 2 * st.accMs + 1000 } : undefined;
      let r;
      try { r = opts && !ctx.inProcess ? runChild(cmds, opts.budgetMs) : ctx.runSC(cmds, opts); } catch (e) { r = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
      r.wallMs = Date.now() - t0;
      if (r.timedOut) r = { ...r, ok: false, failed: { command: '(budget)', error: `TIME BUDGET: exceeded ${B} ms` } };
      return r;
    };
    for (const [vi, variant] of plan.variants.entries()) {
      const res = callSC([...accepted, ...variant]);
      if (!res.ok) {
        lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown');
        if (res.timedOut) return refusedNote(`${f.id} (${f.kind}): ${lastErr}`, undefined, variant); // no other variant: the fallback would be as slow or worse
        if (vi === 0 && plan.copiesOf) firstJoinErr = lastErr;
        continue;
      }
      // PM PATCH ('fresh'): bodies the command created that the plan did not name (a mirror or pattern of several bodies
      // leaves the copies as 'b (2)', 'b (3)' ...); phase0 measured only the planned names and so under-reported them.
      const known = st.known ?? new Set();
      const fresh = (ctx.trackFresh || P('fresh')) ? res.measure.bodies.map((b) => b.name).filter((n) => !known.has(n) && !plan.produces.includes(n)) : [];
      const m = aggregate(res, [...plan.produces, ...fresh]);
      if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }
      // ---- fused guard (patch 'fused'): a mirror is defined as copy + fuse. When ONE body goes in and several come out, solid.mirror combine:true
      // reported success but left the copy as a separate body touching the original (measured: a spun washer mirrored across a flat end).
      // Volume and bbox still agree with the oracles there, which is why a volume gate cannot see it.
      if (P('fused') && f.kind === 'mirror' && st.measure[f.target]?.shells === 1 && m.shells > 1) {
        return refusedNote(`${f.id} (mirror): mirror copy not fused: solid.mirror combine:true returned ${m.bodies.length} body(ies) with ${m.shells} shells for one input body of 1 shell (${m.bodies.join(', ')})`, undefined, variant);
      }
      // ---- mirror contact guard (patch 'mircontact'): is the contact between the part and its reflection a FACE? solid.mirror sometimes fuses a pair that
      // touches only along an edge or at a point without an error (a tapered pull mirrored across its top rim: 1 shell, volume = 2V). For PLANAR parts
      // (exact volumes) the plane is shifted towards the part by d/2, so the copy overlaps the part by d, for d = 1e-2 and 1e-3: the overlap volume
      // (2V - fused volume) grows like d when the contact is a face, like d^2 for an edge, d^3 for a point. Exponent k = log10(ov1/ov2) > 1.5 refuses.
      if (P('mircontact') && f.kind === 'mirror' && plan.mirrorAt && !m.curved && st.measure[f.target]?.shells === 1 && st.measure[f.target]?.volume > 0) {
        const V0 = st.measure[f.target].volume; const bb = st.measure[f.target].bbox; const ax = plan.mirrorAt.axis;
        const side = (bb[ax] + bb[ax + 3]) / 2 > plan.mirrorAt.at ? 1 : -1;
        const ovAt = (d) => {
          const cmd = variant[0]; const o = [...cmd.params.plane.origin]; o[ax] += side * d / 2;
          const r = callSC([...accepted, { ...cmd, params: { ...cmd.params, plane: { ...cmd.params.plane, origin: o } } }]);
          if (r.timedOut) return { timedOut: r };
          if (!r.ok) return null;
          const mm = aggregate(r, [...plan.produces, ...r.measure.bodies.map((b) => b.name).filter((n) => !known.has(n))]);
          return mm ? 2 * V0 - mm.volume : null;
        };
        const o1 = ovAt(1e-2); if (o1?.timedOut) return refusedNote(`${f.id} (${f.kind}): ${o1.timedOut.failed.error}`, undefined, variant);
        const o2 = ovAt(1e-3); if (o2?.timedOut) return refusedNote(`${f.id} (${f.kind}): ${o2.timedOut.failed.error}`, undefined, variant);
        if (o1 != null && o2 != null) {
          const k = o2 > 0 && o1 > 0 ? Math.log10(o1 / o2) : Infinity;
          if (!(o1 > 1e-9 * V0) || k > 1.5) return refusedNote(`${f.id} (mirror): mirror contact is not a face: the overlap of the copy pushed in by 1e-2 and 1e-3 mm is ${o1.toExponential(2)} and ${o2.toExponential(2)} mm3 (growth exponent ${Number.isFinite(k) ? k.toFixed(2) : 'inf'}; a face contact grows like 1, an edge like 2, a point like 3)`, undefined, variant);
        }
      }
      // ---- fallback guard (patch 'disjoint'): the unjoined variant is only an answer when the copies are PROVABLY apart.
      if (P('disjoint') && plan.copiesOf && vi > 0) {
        const cps = res.measure.bodies.filter((b) => plan.produces.includes(b.name));
        const bbx = (b) => ({ bbox: [...b.bbox.min, ...b.bbox.max] });
        let wa = 0; let wb = 0;
        // the closest pair is the one with the SMALLEST max-axis gap
        let closest = Infinity;
        for (let a = 0; a < cps.length; a++) for (let b = a + 1; b < cps.length; b++) {
          const g = Math.max(...boxGap(bbx(cps[a]), bbx(cps[b])));
          if (g < closest) { closest = g; wa = a; wb = b; }
        }
        if (cps.length > 1 && !(closest > 1e-3)) {
          const curved = m.curved;
          const depth = -closest;
          const sub = !curved && depth > 0 && depth <= 1e-5;
          const why = sub
            ? `sub-resolution overlap: copies ${wa + 1} and ${wb + 1} overlap by only ${depth.toExponential(1)} mm and solid.combine could not join them (${firstJoinErr})`
            : `copies overlap or touch${curved ? ' (curved faces)' : ''}: copies ${wa + 1} and ${wb + 1} have bbox gap ${closest.toExponential(1)} and solid.combine could not join them (${firstJoinErr}); leaving them as ${cps.length} separate bodies would add their volumes`;
          return refusedNote(`${f.id} (pattern): ${why}`, undefined, variant);
        }
      }
      // ---- contact guard (patch 'contact'): copies of a repeat/repeatAround that meet only along an edge or at a point.
      // Only looked at when the result has MORE shells than the bounding-box graph of the copies has connected components
      // (so a point contact that sits inside a third copy, rl-diag-overlap, is not flagged); then each exactly-touching pair
      // is joined on its own and flagged when the join keeps 2 shells with volume = sum, or truck refuses the join outright.
      if ((P('contact') || P('subgap')) && f.kind === 'pattern' && !plan.identity) {
        const sep = callSC([...accepted, variant[0]]);
        if (sep.timedOut) return refusedNote(`${f.id} (${f.kind}): ${sep.failed.error}`, undefined, variant);
        const cps = sep.ok ? sep.measure.bodies.filter((b) => plan.produces.includes(b.name)) : [];
        const TOLC = 1e-3;
        const bb = (b) => ({ bbox: [...b.bbox.min, ...b.bbox.max] });
        const isCurved = (b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane');
        const par = cps.map((_, i2) => i2);
        const fnd = (i2) => (par[i2] === i2 ? i2 : (par[i2] = fnd(par[i2])));
        const cand = [];
        const nudge = [];
        for (let a = 0; a < cps.length; a++) for (let b = a + 1; b < cps.length; b++) {
          const gap = boxGap(bb(cps[a]), bb(cps[b]));
          // ---- sliver guard (patch 'sliver', round 5): two PLANAR copies whose bounding boxes overlap or touch (every gap <= 1e-8 mm) and that overlap by a sliver along some axis:
          // 1e-8 < depth <= SLIVER_MM. The round-4 fuzz (pm-snap-fuzz.mjs, closed-form union volume) found truck's join mis-fusing such pairs by a relative 1e-9 .. 4e-7 with no
          // error, also when the copies only touch along a face and overlap by a sliver on a third axis. SLIVER_MM was chosen AFTER seeing that data (wrong solids at depths 1e-6 and
          // 1e-4 mm, none at 1e-3 and above) and is re-checked on fresh seeds (--mode=sliver). Pairs that are APART (gap > 1e-3) are covered by the sum check below.
          if (P('sliver') && !isCurved(cps[a]) && !isCurved(cps[b]) && gap.every((g) => g <= 1e-8)) {
            const depth = Math.min(...gap.filter((g) => g < -1e-8).map((g) => -g));
            if (depth <= SLIVER_MM) {
              return refusedNote(`${f.id} (pattern): sub-resolution overlap: copies ${a + 1} and ${b + 1} overlap by only ${depth.toExponential(1)} mm along one direction (bbox overlap), below the ${SLIVER_MM} mm solid.combine join fuses exactly`, undefined, variant);
            }
          }
          if (!gap.every((g) => g <= TOLC)) continue;
          par[fnd(a)] = fnd(b);
          // ---- gap guard (patch 'subgap'): planar copies almost touching. truck closes a gap <= 1e-5 into one fused bar (OCCT keeps it), so the
          // result silently differs from the oracle; the tessellated box of a curved copy cannot resolve 3e-4, so curved pairs are not judged here.
          const gmax = Math.max(...gap);
          if (P('subgap') && !isCurved(cps[a]) && !isCurved(cps[b]) && gmax > 1e-8) {
            return refusedNote(`${f.id} (pattern): sub-resolution gap: copies ${a + 1} and ${b + 1} are apart by ${gmax.toExponential(1)} mm (bbox gap), below the 1e-3 mm the kernel can keep apart`, undefined, variant);
          }
          if (gap.some((g) => Math.abs(g) <= TOLC)) cand.push([a, b, gap, isCurved(cps[a]) || isCurved(cps[b])]);
          else if (isCurved(cps[a]) || isCurved(cps[b])) nudge.push([a, b, gap]); // boxes overlap deeply: only a nudge test can tell tangent from apart
        }
        const K = new Set(cps.map((_, i2) => fnd(i2))).size;
        const S = res.measure.bodies.filter((b) => [...plan.produces, ...fresh].includes(b.name)).reduce((t, b) => t + b.kernel.shells, 0);
        if (P('contact') && S > K) {
          for (const [a, b, gap, curvedPair] of cand) {
            const two = callSC([...accepted, variant[0], { command: 'solid.combine', params: { target: cps[a].name, tools: [cps[b].name], operation: 'join' } }]);
            if (two.timedOut) return refusedNote(`${f.id} (${f.kind}): ${two.failed.error}`, undefined, variant);
            const tb = two.ok ? two.measure.bodies.find((x) => x.name === cps[a].name) : null;
            const gs = gap.map((g) => g.toExponential(1)).join(',');
            if (!two.ok && /join cannot preserve the original faces/.test(two.failed?.error ?? '')) {
              return refusedNote(`${f.id} (pattern): copies ${a + 1} and ${b + 1} meet only along an edge or at a point (bbox gap ${gs}; solid.combine: ${two.failed.error})`, undefined, variant);
            }
            // round 3: curved copies get the curved volume tolerance (3e-4): a joined pair of tangent cylinders is 5e-5 off the sum of its parts
            const volTol = (curvedPair && P('contact3') ? 3e-4 : 1e-6) * tb?.volume_mm3;
            if (tb && tb.kernel.shells >= 2 && Math.abs(tb.volume_mm3 - cps[a].volume_mm3 - cps[b].volume_mm3) <= volTol) {
              return refusedNote(`${f.id} (pattern): copies ${a + 1} and ${b + 1} meet only along an edge or at a point (bbox gap ${gs}; joined pair keeps ${tb.kernel.shells} shells, volume = sum${curvedPair ? ' within the curved tolerance' : ''}; whole result ${S} shells vs ${K} bbox-connected groups)`, undefined, variant);
            }
          }
          // round 3 NUDGE TEST (curved pairs with deeply overlapping boxes, e.g. cylinders tangent along a line and stepped diagonally): push copy b 2e-3 mm
          // towards copy a along the line of their centres of mass and join. Tangent copies now overlap and fuse into ONE shell; copies that are really
          // apart stay two shells. Boxes of planar copies are exact, so planar pairs never need this.
          for (const [a, b, gap] of (P('contact3') ? nudge : [])) {
            const ca = cps[a].center_of_mass; const cb = cps[b].center_of_mass;
            const d = [0, 1, 2].map((i) => ca[i] - cb[i]); const L = Math.hypot(...d);
            if (!(L > 1e-9)) continue;
            const t = d.map((v) => (v / L) * 2e-3);
            const nu = callSC([...accepted, variant[0], { command: 'solid.move', params: { bodies: [cps[b].name], translate: t } }, { command: 'solid.combine', params: { target: cps[a].name, tools: [cps[b].name], operation: 'join' } }]);
            if (nu.timedOut) return refusedNote(`${f.id} (${f.kind}): ${nu.failed.error}`, undefined, variant);
            const nb = nu.ok ? nu.measure.bodies.find((x) => x.name === cps[a].name) : null;
            if (nb && nb.kernel.shells === 1) {
              return refusedNote(`${f.id} (pattern): copies ${a + 1} and ${b + 1} meet only along an edge or at a point (curved copies with overlapping boxes, bbox gap ${gap.map((g) => g.toExponential(1)).join(',')}; pushed 2e-3 mm together they fuse into one shell, so they were touching; whole result ${S} shells vs ${K} bbox-connected groups)`, undefined, variant);
            }
          }
        }
        // ---- sum check (patch 'sliver', round 5): when EVERY pair of planar copies is provably apart (bbox gap > 1e-3 mm) the union volume is exactly the sum of the copies' own
        // volumes (measured separately, before any join: `sep`), so the result must equal that sum. The round-5 fuzz (--mode=aligned: copies 1e-3 .. 0.4 mm apart along one axis and
        // overlapping by slivers along the other two) found truck's join returning a volume off by a relative 1e-8 .. 7e-6 without an error in about 1 trial in 8; this independent measure catches them.
        if (P('sliver') && cps.length > 1 && cps.every((b) => !isCurved(b))) {
          let allApart = true;
          for (let a2 = 0; a2 < cps.length && allApart; a2++) for (let b2 = a2 + 1; b2 < cps.length; b2++) { if (!(Math.max(...boxGap(bb(cps[a2]), bb(cps[b2]))) > TOLC)) { allApart = false; break; } }
          const sumV = cps.reduce((t2, b3) => t2 + b3.volume_mm3, 0);
          if (allApart && Math.abs(m.volume - sumV) > 1e-9 * sumV) {
            return refusedNote(`${f.id} (pattern): sum check: the ${cps.length} copies are all apart (bbox gap above 1e-3 mm) so the result must be the sum of their volumes ${sumV.toPrecision(12)}, but solid.combine join returned ${m.volume.toPrecision(12)} (relative difference ${(Math.abs(m.volume - sumV) / sumV).toExponential(1)})`, undefined, variant);
          }
        }
      }
      accepted.push(...variant);
      st.tools = st.tools ?? {};
      if (plan.toolBox && plan.produces?.[0]) (st.tools[plan.produces[0]] ??= []).push(plan.toolBox);
      else for (const b of plan.produces ?? []) delete st.tools[b];
      st.accMs = res.wallMs ?? 0;
      st.known = new Set(res.measure.bodies.map((b) => b.name));
      st.bodies[f.id] = m.bodies;
      st.measure[f.id] = m;
      st.abox[f.id] = P('plane') ? analyticBox(f, st, fctx, plan) : null;
      st.torus[f.id] = f.kind === 'torus' || [f.target, f.into, ...(f.targets ?? [])].some((t) => t && st.torus[t]);
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? f.target : f.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
      }
      return note({ status: 'built', commands: variant, measure: m, pickedFrom: plan.pickedFrom, variantsTried: plan.variants.indexOf(variant) + 1, pick: (variant.find((c) => c.params.edges || c.params.faces)?.params) ?? null, mirrorAt: plan.mirrorAt, wallMs: res.wallMs });
    }
    return refusedNote(`${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`, undefined, plan.variants[0]);
  });
  return { features: out, commands: accepted };
}
