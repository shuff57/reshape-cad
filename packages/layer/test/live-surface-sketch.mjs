// Live check of surface sketches on the real kernel (not part of `npm test`).
//
//   SOLIDCRAFT_TOPOLOGY_PKG=<dir with solidcraft_referee_p2.js>  (default: the 0.40.0-rc.2 rig's topology wrapper)
//   node test/live-surface-sketch.mjs [--only=<substring>] [--timeout=<s>]
//
// Each case: build the part, plan the surface sketch with the layer (pure), run part + plan on the kernel in a fresh
// Worker (terminated at the time limit), and check the result against the layer's own prediction, which comes from
// closed forms and quadrature, never from the kernel:
//   cut / raise  -> the body's volume change (inspect.measure) equals the predicted change; one closed body is left;
//   imprint      -> every new edge lies on the predicted outline, the outline is covered, nothing else was marked.
// A planned refusal is a pass when the case expects one. Results go to test/evidence/live-surface-sketch-<tag>.json.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSurfaceSketch, verifySurfaceSketch, shapes, fitHeight, surfaceRefusal } from '../dist/surface-sketch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = process.env.SOLIDCRAFT_TOPOLOGY_PKG ?? path.join(process.env.HOME, '.cache/solidcraft-0.40.0-rc.2-rig/sc-referee-pkg-topology');
const TAG = process.env.RIG_TAG ?? '0.40.0-rc.2';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=')[1];
const ONLY = arg('only', '');
const TIMEOUT_S = Number(arg('timeout', '300'));

function runKernel(cmds, timeoutS = TIMEOUT_S) {
  return new Promise((resolve) => {
    const w = new Worker(path.join(here, 'live-surface-sketch-worker.mjs'), { workerData: { pkg: PKG } });
    const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, timedOut: true, error: `TIME LIMIT ${timeoutS} s` }); }, timeoutS * 1000);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e) }); });
    w.postMessage(cmds);
  });
}
const failedOf = (r) => r.results.find((x) => !x.ok);
const bodyOf = (r, name) => r.measure?.out?.bodies?.find((b) => b.name === name);
const lastOut = (r, command) => r.results.filter((x) => x.command === command && x.ok).pop()?.out;

// ------------------------------------------------------------------ parts
const rad = (d) => (d * Math.PI) / 180;
const CYL_BASE = [{ command: 'solid.cylinder', params: { radius: 20, height: 40, body_name: 'c' } }];
const CYL = { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 20, extent: [0, 40] };
const CYL_PL = { anchor: [25, 0, 20], xDir: [0, 1, 0] };
const SPH_BASE = [{ command: 'solid.sphere', params: { radius: 30, body_name: 'b' } }];
const SPH = { kind: 'sphere', center: [0, 0, 0], radius: 30 };
const SPH_PL = { anchor: [0, 0, 40], xDir: [1, 0, 0] };

// a non-uniform wavy top: lofted through sections whose waves change in amplitude, length and phase
const WH = (x, y) => 20 + 2 * Math.sin(x / 6) + 1.5 * Math.sin(y / 5 + x / 11) + 0.8 * Math.cos((x * y) / 150);
const WAVY_BASE = (() => {
  const ys = [-20, -12, -4, 4, 12, 20], cmds = [];
  ys.forEach((y, k) => {
    cmds.push({ command: 'sketch.create', params: { name: `w${k}`, plane: { origin: [0, y, 0], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } });
    cmds.push({ command: 'sketch.line', params: { points: [[-20, WH(-20, y)], [-20, 0], [20, 0], [20, WH(20, y)]] } });
    cmds.push({ command: 'sketch.spline.fit_point', params: { points: Array.from({ length: 11 }, (_, i) => { const x = 20 - 4 * i; return [x, WH(x, y)]; }) } });
    cmds.push({ command: 'sketch.finish', params: {} });
  });
  cmds.push({ command: 'solid.loft', params: { sections: ys.map((_, k) => ({ sketch: `w${k}` })), body_name: 'w' } });
  return cmds;
})();

/** Corner part: a prism along y (y in [-20, 20]) whose cross-section has face A on z = 0 (x <= 0, material below) and
 *  face B leaving the edge (the y axis) at interior angle `deg` -- outside corner (convex) or inside corner (concave). */
function cornerPart(deg, convex) {
  const p = rad(deg);
  const mB = convex ? [-Math.cos(p), -Math.sin(p)] : [-Math.cos(p), Math.sin(p)];
  const nB = convex ? [Math.sin(p), -Math.cos(p)] : [-Math.sin(p), -Math.cos(p)];
  const B = [30 * mB[0], 30 * mB[1]];
  const poly = convex
    ? [[0, 0], [-30, 0], [-30, -40], ...(B[1] > -40 ? [[B[0], -40]] : []), B]
    : [[-30, 0], [0, 0], B, [B[0] - 15 * nB[0], B[1] - 15 * nB[1]], [Math.max(B[0] - 15 * nB[0], 1), -20], [-30, -20]];
  const base = [
    { command: 'sketch.create', params: { name: 'kp', plane: { origin: [0, 20, 0], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
    { command: 'sketch.line', params: { points: poly, closed: true } },
    { command: 'sketch.finish', params: {} },
    { command: 'solid.extrude', params: { sketch: 'kp', distance: 40, operation: 'new', body_name: 'k' } },
  ];
  const target = {
    kind: 'corner', edgePoint: [0, 0, 0], edgeDir: [0, 1, 0], normalA: [0, 0, 1], normalB: [nB[0], 0, nB[1]],
    pointB: [15 * mB[0], 0, 15 * mB[1]], extentA: { along: [-20, 20], away: 30 }, extentB: { along: [-20, 20], away: 30 },
  };
  return { base, target, placement: { anchor: [-8, 0, 0], xDir: [1, 0, 0] } };
}

// ------------------------------------------------------------------ cases
const turned = (deg) => ({ ...CYL_PL, xDir: [0, Math.cos(rad(deg)), Math.sin(rad(deg))] });
const CASES = [
  { name: 'cylinder cut along view, rectangle 16 x 10, 1.5 deep', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.rect(-8, -5, 8, 5)], op: { op: 'cut', depth: 1.5 } },
  { name: 'cylinder cut along view, rectangle turned 30 deg (helical sides)', base: CYL_BASE, body: 'c', target: CYL, placement: turned(30), loops: [shapes.rect(-8, -4, 8, 4)], op: { op: 'cut', depth: 1 } },
  { name: 'cylinder cut square to the surface, rectangle 16 x 10, 1.5 deep', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.rect(-8, -5, 8, 5)], op: { op: 'cut', depth: 1.5, floor: 'normal' } },
  { name: 'cylinder raise along view, slot 12 long r 3, 1 high', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.slot([0, 0], 12, 3)], op: { op: 'raise', height: 1 } },
  { name: 'cylinder raise square to the surface, circle r 5, 1 high', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.circle([0, 0], 5)], op: { op: 'raise', height: 1, floor: 'normal' } },
  { name: 'cylinder cut, plate with a ring (circle inside a rectangle)', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.rect(-9, -6, 9, 6), shapes.circle([0, 0], 3)], op: { op: 'cut', depth: 1 } },
  { name: 'cylinder mark a circle r 5', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.circle([0, 0], 5)], op: { op: 'imprint' } },
  { name: 'cylinder mark an ellipse 7 x 4', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.ellipse([0, 0], 7, 4)], op: { op: 'imprint' } },
  { name: 'cylinder mark a slot 10 long r 3 (pieces meet smoothly)', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.slot([0, 0], 10, 3)], op: { op: 'imprint' } },
  { name: 'cylinder REFUSE: wraps 172 deg round', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.rect(-30, -3, 30, 3)], op: { op: 'cut', depth: 1 }, expect: 'refused' },
  { name: 'cylinder REFUSE: marking a rectangle', base: CYL_BASE, body: 'c', target: CYL, placement: CYL_PL, loops: [shapes.rect(-4, -3, 4, 3)], op: { op: 'imprint' }, expect: 'refused' },

  { name: 'sphere cut along view, circle r 4, 1 deep', base: SPH_BASE, body: 'b', target: SPH, placement: SPH_PL, loops: [shapes.circle([0, 0], 4)], op: { op: 'cut', depth: 1 } },
  { name: 'sphere raise square to the surface, circle r 5, 1 high', base: SPH_BASE, body: 'b', target: SPH, placement: SPH_PL, loops: [shapes.circle([0, 0], 5)], op: { op: 'raise', height: 1, floor: 'normal' } },
  { name: 'sphere cut square to the surface, rectangle 6 x 4, 0.8 deep', base: SPH_BASE, body: 'b', target: SPH, placement: SPH_PL, loops: [shapes.rect(-3, -2, 3, 2)], op: { op: 'cut', depth: 0.8, floor: 'normal' } },
  { name: 'sphere raise along view, slot 6 long r 1.5 (stretch < 1%)', base: SPH_BASE, body: 'b', target: SPH, placement: SPH_PL, loops: [shapes.slot([0, 0], 6, 1.5)], op: { op: 'raise', height: 0.8 } },
  { name: 'sphere mark a circle r 5', base: SPH_BASE, body: 'b', target: SPH, placement: SPH_PL, loops: [shapes.circle([0, 0], 5)], op: { op: 'imprint' } },
  { name: 'sphere REFUSE: circle r 12 stretches 2.6%', base: SPH_BASE, body: 'b', target: SPH, placement: SPH_PL, loops: [shapes.circle([0, 0], 12)], op: { op: 'cut', depth: 1 }, expect: 'refused' },

  { name: 'wavy cut along view, circle r 6, 1 deep', base: WAVY_BASE, body: 'w', wavy: true, placement: { anchor: [2, -1, 20], xDir: [1, 0, 0] }, loops: [shapes.circle([0, 0], 6)], op: { op: 'cut', depth: 1 } },
  { name: 'wavy raise along view, slot 10 long r 2.5, 1 high', base: WAVY_BASE, body: 'w', wavy: true, placement: { anchor: [-3, 4, 20], xDir: [0.8, 0.6, 0] }, loops: [shapes.slot([0, 0], 10, 2.5)], op: { op: 'raise', height: 1 } },
  { name: 'wavy cut along view, rectangle 9 x 6 turned 20 deg, 0.8 deep', base: WAVY_BASE, body: 'w', wavy: true, placement: { anchor: [1, 1, 20], xDir: [Math.cos(rad(20)), Math.sin(rad(20)), 0] }, loops: [shapes.rect(-4.5, -3, 4.5, 3)], op: { op: 'cut', depth: 0.8 } },
  { name: 'wavy REFUSE: rectangle 14 x 8 stretches 2% on the waves', base: WAVY_BASE, body: 'w', wavy: true, placement: { anchor: [1, 1, 20], xDir: [Math.cos(rad(20)), Math.sin(rad(20)), 0] }, loops: [shapes.rect(-7, -4, 7, 4)], op: { op: 'cut', depth: 0.8 }, expect: 'refused' },
  { name: 'wavy rectangle 14 x 8 with 3% stretch allowed', base: WAVY_BASE, body: 'w', wavy: true, placement: { anchor: [1, 1, 20], xDir: [Math.cos(rad(20)), Math.sin(rad(20)), 0] }, loops: [shapes.rect(-7, -4, 7, 4)], op: { op: 'cut', depth: 0.8 }, maxStretch: 0.03 },
  { name: 'wavy REFUSE: runs off the face', base: WAVY_BASE, body: 'w', wavy: true, placement: { anchor: [14, 0, 20], xDir: [1, 0, 0] }, loops: [shapes.circle([0, 0], 8)], op: { op: 'cut', depth: 1 }, expect: 'refused' },
];
for (const deg of [45, 60, 90, 120, 150]) {
  const k = cornerPart(deg, true);
  CASES.push({ name: `outside corner ${deg} deg: cut a circle r 5 across the edge, 1 deep`, base: k.base, body: 'k', target: k.target, placement: k.placement, loops: [shapes.circle([8, 0], 5)], op: { op: 'cut', depth: 1 } });
  if (deg === 90 || deg === 120) CASES.push({ name: `outside corner ${deg} deg: raise a rectangle 12 x 8 across the edge, 1 high`, base: k.base, body: 'k', target: k.target, placement: k.placement, loops: [shapes.rect(2, -4, 14, 4)], op: { op: 'raise', height: 1 } });
}
for (const deg of [90, 120, 150]) {
  const k = cornerPart(deg, false);
  CASES.push({ name: `inside corner ${deg} deg: cut a circle r 5 across the edge, 1 deep`, base: k.base, body: 'k', target: k.target, placement: k.placement, loops: [shapes.circle([8, 0], 5)], op: { op: 'cut', depth: 1 } });
  if (deg === 120) CASES.push({ name: `inside corner ${deg} deg: raise a slot across the edge, 1 high`, base: k.base, body: 'k', target: k.target, placement: k.placement, loops: [shapes.slot([8, 0], 8, 2.5)], op: { op: 'raise', height: 1 } });
}
{
  const k = cornerPart(90, true);
  CASES.push({ name: 'outside corner 90 deg: mark a circle r 3 on one face', base: k.base, body: 'k', target: k.target, placement: k.placement, loops: [shapes.circle([0, 0], 3)], op: { op: 'imprint' } });
  const s = cornerPart(30, true);
  CASES.push({ name: 'outside corner 30 deg REFUSE: too sharp for one view', base: s.base, body: 'k', target: s.target, placement: s.placement, loops: [shapes.circle([8, 0], 5)], op: { op: 'cut', depth: 1 }, expect: 'refused' });
}

// ------------------------------------------------------------------ run
async function wavyTarget(c) {
  // measure the kernel's own face: model.faces, then iso-curves on every face of the wavy top. Fit to one sampling
  // (30 curves each way per face) and check the fit against a second, different one (17 each way) held out from it.
  const r0 = await runKernel([...c.base, { command: 'model.faces', params: { body: c.body } }]);
  if (!r0.ok || failedOf(r0.r)) return { error: r0.error ?? failedOf(r0.r).error };
  const top = lastOut(r0.r, 'model.faces').faces.filter((f) => !f.plane_normal && f.centroid[2] > 10);
  const sample = async (count) => {
    const r = await runKernel([...c.base, ...top.map((f) => ({ command: 'inspect.isocurve', params: { faces: [f.point], count } }))]);
    if (!r.ok || failedOf(r.r)) throw new Error(r.error ?? failedOf(r.r).error);
    return r.r.results.filter((x) => x.command === 'inspect.isocurve').flatMap((x) => x.out.curves.flat());
  };
  let pts, held;
  try { pts = await sample(30); held = await sample(17); } catch (e) { return { error: e.message }; }
  const fit = fitHeight(pts, { origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0] }, 1);
  let holdout = 0;
  for (const p of held) if (p[0] >= fit.bounds.x[0] && p[0] <= fit.bounds.x[1] && p[1] >= fit.bounds.y[0] && p[1] <= fit.bounds.y[1]) holdout = Math.max(holdout, Math.abs(p[2] - 20 - fit.height(p[0], p[1]).z));
  const b = fit.bounds;
  return {
    target: { kind: 'graph', origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0], height: fit.height, bounds: { x: [b.x[0] + 0.5, b.x[1] - 0.5], y: [b.y[0] + 0.5, b.y[1] - 0.5] } },
    fit: { maxResidual: Math.max(fit.maxResidual, holdout), fitResidual: fit.maxResidual, holdoutResidual: holdout, rmsResidual: fit.rmsResidual, samples: fit.samples, heldOut: held.length, faces: top.length },
  };
}

const results = [];
for (const c of CASES) {
  if (ONLY && !c.name.includes(ONLY)) continue;
  const row = { name: c.name, expect: c.expect ?? 'built' };
  const t0 = Date.now();
  let target = c.target;
  if (c.wavy) {
    const w = await wavyTarget(c);
    if (w.error) { row.outcome = 'ERROR'; row.error = `measuring the face: ${w.error}`; results.push(row); console.log('ERROR', c.name, row.error); continue; }
    target = w.target; row.fit = w.fit;
  }
  const plan = planSurfaceSketch({ body: c.body, target, placement: c.placement, loops: c.loops, op: c.op, id: 'surface1', maxStretch: c.maxStretch, fit: row.fit ? { maxResidual: row.fit.maxResidual } : undefined });
  if (!plan.ok) {
    row.outcome = 'refused'; row.sentence = plan.refusal; row.pass = row.expect === 'refused';
  } else if (row.expect === 'refused') {
    row.outcome = 'planned'; row.pass = false;
  } else {
    const P = plan.prediction;
    row.prediction = { volumeDelta: P.volumeDelta, surfaceArea: P.surfaceArea, stretch: P.stretch, tiltDeg: P.tiltDeg, normalDepth: P.normalDepth, outlineLength: P.curves.reduce((s, q) => s + q.length, 0) };
    row.commands = plan.commands.length;
    const probe = c.op.op === 'imprint' ? [{ command: 'model.edges', params: { body: c.body } }] : [];
    const before = await runKernel([...c.base, ...probe]);
    const after = await runKernel([...c.base, ...plan.commands, ...probe]);
    row.kernelMs = after.ms;
    const bad = !after.ok ? { command: '(run)', error: after.error } : failedOf(after.r);
    if (!before.ok || failedOf(before.r)) { row.outcome = 'ERROR'; row.error = 'the base part did not build'; }
    else if (bad) {
      // an honest refusal by the kernel: the student sees the layer's sentence; the raw error is kept as evidence
      row.outcome = 'kernel-refused'; row.sentence = surfaceRefusal('surface1', c.op.op, 'kernel');
      row.kernelError = `${bad.command}: ${String(bad.error).slice(0, 300)}`; row.timedOut = !!after.timedOut; row.pass = false;
    }
    else {
      const vb = bodyOf(before.r, c.body), va = bodyOf(after.r, c.body);
      const v = verifySurfaceSketch({
        prediction: P,
        volumeBefore: vb?.volume_mm3, volumeAfter: va?.volume_mm3,
        edgesBefore: lastOut(before.r, 'model.edges')?.edges, edgesAfter: lastOut(after.r, 'model.edges')?.edges,
      });
      row.measured = v.measured;
      row.bodies = after.r.measure.out.bodies.map((b) => b.name);
      row.closed = !!va?.closed;
      const oneBody = row.bodies.length === 1 && row.closed;
      row.outcome = v.ok && oneBody ? 'built' : 'WRONG';
      if (!v.ok) row.reason = v.reason;
      else if (!oneBody) row.reason = `left bodies ${row.bodies.join(', ')}, closed=${row.closed}`;
      row.pass = row.outcome === 'built';
    }
  }
  row.ms = Date.now() - t0;
  results.push(row);
  const err = row.measured?.relError;
  console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.outcome.padEnd(8)} ${c.name}${err !== undefined ? `  rel ${err.toExponential(2)}` : ''}${row.reason ? `  -- ${row.reason}` : ''}${row.sentence ? `  -- ${row.sentence}` : ''}${row.kernelError ? `  [${row.kernelError.slice(0, 140)}]` : ''}  (${(row.ms / 1000).toFixed(1)} s)`);
}
const out = path.join(here, 'evidence', `live-surface-sketch-${TAG}${ONLY ? '-partial' : ''}.json`);
fs.writeFileSync(out, JSON.stringify({ rig: PKG, tag: TAG, date: new Date().toISOString(), results }, null, 1) + '\n');
const pass = results.filter((r) => r.pass).length, wrong = results.filter((r) => r.outcome === 'WRONG').length;
const kr = results.filter((r) => r.outcome === 'kernel-refused').length;
console.log(`\n${pass} of ${results.length} pass; ${kr} refused by the kernel (honest, shown with the layer's sentence); ${wrong} built a part that does not match the prediction. -> ${path.relative(process.cwd(), out)}`);
process.exitCode = wrong ? 2 : pass === results.length ? 0 : 1;
