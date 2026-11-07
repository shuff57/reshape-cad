// Showcase designs for surface sketches, to look at in SolidCraft itself (not part of `npm test`).
//
//   SOLIDCRAFT_TOPOLOGY_PKG=<rig topology wrapper dir>   (default: the 0.40.0-rc.2 rig)
//   SOLIDCRAFT_CLI=<solidcraft-cli of the same version>   (writes the .solidcraft files and snapshots)
//   node test/showcase-surface-sketch.mjs <out-dir>
//
// Each design carries several surface-sketch features. Every feature is planned by the layer, run on the kernel after
// the ones before it, and checked against the layer's own prediction exactly as the live test does; a feature that
// is refused (by the layer or the kernel) or does not match is left out and listed. What is left is saved as
// <name>.json (the command script) and, with SOLIDCRAFT_CLI, as <name>.solidcraft plus an iso snapshot <name>.png.
import { Worker } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSurfaceSketch, verifySurfaceSketch, shapes, fitHeight, surfaceRefusal } from '../dist/surface-sketch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = process.env.SOLIDCRAFT_TOPOLOGY_PKG ?? path.join(process.env.HOME, '.cache/solidcraft-0.40.0-rc.2-rig/sc-referee-pkg-topology');
const CLI = process.env.SOLIDCRAFT_CLI;
const OUT = path.resolve(process.argv[2] ?? 'surface-sketch-showcase');
fs.mkdirSync(OUT, { recursive: true });

function runKernel(cmds, timeoutS = 300) {
  return new Promise((resolve) => {
    const w = new Worker(path.join(here, 'live-surface-sketch-worker.mjs'), { workerData: { pkg: PKG } });
    const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, error: `TIME LIMIT ${timeoutS} s` }); }, timeoutS * 1000);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e) }); });
    w.postMessage(cmds);
  });
}
const failedOf = (r) => r.results.find((x) => !x.ok);

/** The same commands on the official build (native CLI): {ok, results, measure} or {ok: false, error}. */
let cliN = 0;
function runCli(cmds) {
  const tmp = path.join(OUT, `.cli-${process.pid}-${cliN++}.json`), out = `${tmp}.out`;
  fs.writeFileSync(tmp, JSON.stringify({ commands: [...cmds, { command: 'inspect.measure', params: {} }] }));
  try {
    execFileSync(CLI, ['run', tmp, '--results', '--json-out', out, '--quiet'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 900e3 });
    const results = JSON.parse(fs.readFileSync(out, 'utf8'));
    return { ok: true, results, measure: results[results.length - 1] };
  } catch (e) {
    return { ok: false, error: String(e.stderr ?? e.message).split('\n').slice(0, 3).join(' ') };
  } finally { fs.rmSync(tmp, { force: true }); fs.rmSync(out, { force: true }); }
}
const lastOut = (r, command) => r.results.filter((x) => x.command === command && x.ok).pop()?.out;
const rad = (d) => (d * Math.PI) / 180;
const at = (deg, r, z) => [r * Math.cos(rad(deg)), r * Math.sin(rad(deg)), z];

// ------------------------------------------------------------------ parts and features
const CYL = { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 20, extent: [0, 40] };
const SPH = { kind: 'sphere', center: [0, 0, 0], radius: 30 };
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

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

function cornerPart(name, ox, deg, convex) {
  const p = rad(deg);
  const mB = convex ? [-Math.cos(p), -Math.sin(p)] : [-Math.cos(p), Math.sin(p)];
  const nB = convex ? [Math.sin(p), -Math.cos(p)] : [-Math.sin(p), -Math.cos(p)];
  const B = [30 * mB[0], 30 * mB[1]];
  const poly = convex
    ? [[0, 0], [-30, 0], [-30, -40], ...(B[1] > -40 ? [[B[0], -40]] : []), B]
    : [[-30, 0], [0, 0], B, [B[0] - 15 * nB[0], B[1] - 15 * nB[1]], [Math.max(B[0] - 15 * nB[0], 1), -20], [-30, -20]];
  return {
    base: [
      { command: 'sketch.create', params: { name: `${name}_p`, plane: { origin: [ox, 20, 0], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
      { command: 'sketch.line', params: { points: poly, closed: true } },
      { command: 'sketch.finish', params: {} },
      { command: 'solid.extrude', params: { sketch: `${name}_p`, distance: 40, operation: 'new', body_name: name } },
    ],
    target: { kind: 'corner', edgePoint: [ox, 0, 0], edgeDir: [0, 1, 0], normalA: [0, 0, 1], normalB: [nB[0], 0, nB[1]], pointB: [ox + 15 * mB[0], 0, 15 * mB[1]], extentA: { along: [-20, 20], away: 30 }, extentB: { along: [-20, 20], away: 30 } },
    placement: { anchor: [ox - 8, 0, 0], xDir: [1, 0, 0] },
  };
}

const DESIGNS = [
  {
    name: 'surface-sketch-cylinder',
    base: [{ command: 'solid.cylinder', params: { radius: 20, height: 40, body_name: 'c' } }],
    features: [
      { what: 'cut 1 mm along the view: rectangle 16 x 8 turned 30 deg (helical sides)', body: 'c', target: CYL, placement: { anchor: at(0, 25, 20), xDir: [0, Math.cos(rad(30)), Math.sin(rad(30))] }, loops: [shapes.rect(-8, -4, 8, 4)], op: { op: 'cut', depth: 1 } },
      { what: 'raise 1 mm square to the surface: slot 12 long r 3, up the axis', body: 'c', target: CYL, placement: { anchor: at(120, 25, 20), xDir: [0, 0, 1] }, loops: [shapes.slot([0, 0], 12, 3)], op: { op: 'raise', height: 1, floor: 'normal' } },
      { what: 'mark: circle r 5', body: 'c', target: CYL, placement: { anchor: at(240, 25, 20), xDir: [0, 0, 1] }, loops: [shapes.circle([0, 0], 5)], op: { op: 'imprint' } },
      { what: 'cut 1.2 mm square to the surface: rectangle 14 x 5 round the wall', body: 'c', target: CYL, placement: { anchor: at(0, 25, 5.5), xDir: at(90, 1, 0) }, loops: [shapes.rect(-7, -2.5, 7, 2.5)], op: { op: 'cut', depth: 1.2, floor: 'normal' } },
    ],
  },
  {
    name: 'surface-sketch-sphere',
    base: [{ command: 'solid.sphere', params: { radius: 30, body_name: 'b' } }],
    features: [
      { what: 'cut 1 mm along the view: circle r 4 on top', body: 'b', target: SPH, placement: { anchor: [0, 0, 40], xDir: [1, 0, 0] }, loops: [shapes.circle([0, 0], 4)], op: { op: 'cut', depth: 1 } },
      { what: 'raise 0.8 mm square to the surface: slot 6 long r 1.5', body: 'b', target: SPH, placement: { anchor: unit([1, 0, 0.3]).map((v) => v * 40), xDir: [0, 1, 0] }, loops: [shapes.slot([0, 0], 6, 1.5)], op: { op: 'raise', height: 0.8, floor: 'normal' } },
      { what: 'cut 0.8 mm square to the surface: rectangle 6 x 4', body: 'b', target: SPH, placement: { anchor: unit([-1, 0.4, 0.5]).map((v) => v * 40), xDir: [0, 0, 1] }, loops: [shapes.rect(-3, -2, 3, 2)], op: { op: 'cut', depth: 0.8, floor: 'normal' } },
      { what: 'mark: circle r 5', body: 'b', target: SPH, placement: { anchor: unit([0, -1, -1]).map((v) => v * 40), xDir: [1, 0, 0] }, loops: [shapes.circle([0, 0], 5)], op: { op: 'imprint' } },
    ],
  },
  {
    name: 'surface-sketch-wavy',
    base: WAVY_BASE,
    wavy: 'w',
    features: [
      { what: 'cut 1 mm along the view: circle r 4', body: 'w', placement: { anchor: [-9, -9, 20], xDir: [1, 0, 0] }, loops: [shapes.circle([0, 0], 4)], op: { op: 'cut', depth: 1 } },
      { what: 'raise 1 mm along the view: slot 8 long r 2', body: 'w', placement: { anchor: [8, 8, 20], xDir: [1, 0, 0] }, loops: [shapes.slot([0, 0], 8, 2)], op: { op: 'raise', height: 1 } },
      { what: 'cut 0.8 mm along the view: rectangle 7 x 5 turned 20 deg', body: 'w', placement: { anchor: [-8, 9, 20], xDir: [Math.cos(rad(20)), Math.sin(rad(20)), 0] }, loops: [shapes.rect(-3.5, -2.5, 3.5, 2.5)], op: { op: 'cut', depth: 0.8 } },
      { what: 'cut 1 mm along the view: slot 9 long r 2.5 across the middle', body: 'w', placement: { anchor: [2, -1, 20], xDir: [0.8, 0.6, 0] }, loops: [shapes.slot([0, 0], 9, 2.5)], op: { op: 'cut', depth: 1 } },
      { what: 'raise 1 mm along the view: circle r 4', body: 'w', placement: { anchor: [9, -8, 20], xDir: [1, 0, 0] }, loops: [shapes.circle([0, 0], 4)], op: { op: 'raise', height: 1 } },
    ],
  },
  (() => {
    const parts = [[60, true], [90, true], [120, true], [150, true], [90, false], [120, false]].map(([deg, convex], i) => ({ deg, convex, ...cornerPart(`k${i + 1}`, i * 90, deg, convex), name: `k${i + 1}` }));
    return {
      name: 'surface-sketch-corners',
      base: parts.flatMap((p) => p.base),
      features: parts.flatMap((p) => [
        { what: `${p.convex ? 'outside' : 'inside'} ${p.deg} deg (${p.name}): cut 1 mm, circle r 5 across the edge`, body: p.name, target: p.target, placement: { ...p.placement, anchor: [p.placement.anchor[0], -9, 0] }, loops: [shapes.circle([8, 0], 5)], op: { op: 'cut', depth: 1 } },
        { what: `${p.convex ? 'outside' : 'inside'} ${p.deg} deg (${p.name}): raise 1 mm, rectangle 12 x 8 across the edge`, body: p.name, target: p.target, placement: { ...p.placement, anchor: [p.placement.anchor[0], 6, 0] }, loops: [shapes.rect(2, -4, 14, 4)], op: { op: 'raise', height: 1 } },
      ]),
    };
  })(),
];

async function wavyTarget(base, body) {
  const r0 = await runKernel([...base, { command: 'model.faces', params: { body } }]);
  const top = lastOut(r0.r, 'model.faces').faces.filter((f) => !f.plane_normal && f.centroid[2] > 10);
  const sample = async (count) => {
    const r = await runKernel([...base, ...top.map((f) => ({ command: 'inspect.isocurve', params: { faces: [f.point], count } }))]);
    return r.r.results.filter((x) => x.command === 'inspect.isocurve').flatMap((x) => x.out.curves.flat());
  };
  const pts = await sample(30), held = await sample(17);
  const fit = fitHeight(pts, { origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0] }, 1);
  let holdout = 0;
  for (const p of held) if (p[0] >= fit.bounds.x[0] && p[0] <= fit.bounds.x[1] && p[1] >= fit.bounds.y[0] && p[1] <= fit.bounds.y[1]) holdout = Math.max(holdout, Math.abs(p[2] - 20 - fit.height(p[0], p[1]).z));
  const b = fit.bounds;
  return { target: { kind: 'graph', origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0], height: fit.height, bounds: { x: [b.x[0] + 0.5, b.x[1] - 0.5], y: [b.y[0] + 0.5, b.y[1] - 0.5] } }, maxResidual: Math.max(fit.maxResidual, holdout) };
}

const report = [];
for (const d of DESIGNS.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  console.log(`\n== ${d.name}`);
  let cmds = d.base.slice();
  const wavy = d.wavy ? await wavyTarget(d.base, d.wavy) : null;
  const kept = [];
  for (const [k, f] of d.features.entries()) {
    const id = `surface${k + 1}`;
    const plan = planSurfaceSketch({ body: f.body, target: wavy ? wavy.target : f.target, placement: f.placement, loops: f.loops, op: f.op, id, fit: wavy ? { maxResidual: wavy.maxResidual } : undefined });
    if (!plan.ok) { console.log(`  REFUSED  ${f.what} -- ${plan.refusal}`); report.push({ design: d.name, feature: f.what, outcome: 'refused by the layer', sentence: plan.refusal }); continue; }
    const probe = f.op.op === 'imprint' ? [{ command: 'model.edges', params: { body: f.body } }] : [];
    const before = await runKernel([...cmds, ...probe]);
    const after = await runKernel([...cmds, ...plan.commands, ...probe]);
    const bad = !after.ok ? { error: after.error } : failedOf(after.r);
    if (bad) { const s = surfaceRefusal(id, f.op.op, 'kernel'); console.log(`  REFUSED  ${f.what} -- ${s}\n           [rig kernel: ${String(bad.error).replace(/\n/g, ' ').slice(0, 160)}]`); report.push({ design: d.name, feature: f.what, outcome: 'refused by the kernel', sentence: s, kernelError: String(bad.error).slice(0, 300) }); continue; }
    const vb = before.r.measure.out.bodies.find((b) => b.name === f.body), va = after.r.measure.out.bodies.find((b) => b.name === f.body);
    const v = verifySurfaceSketch({ prediction: plan.prediction, volumeBefore: vb?.volume_mm3, volumeAfter: va?.volume_mm3, edgesBefore: lastOut(before.r, 'model.edges')?.edges, edgesAfter: lastOut(after.r, 'model.edges')?.edges });
    const extra = after.r.measure.out.bodies.length !== before.r.measure.out.bodies.length;
    if (!v.ok || extra || !va?.closed) {
      const s = surfaceRefusal(id, f.op.op, 'mismatch');
      console.log(`  REFUSED  ${f.what} -- ${s} (${v.ok ? 'extra bodies or open' : v.reason})`);
      report.push({ design: d.name, feature: f.what, outcome: 'refused by the check', sentence: s, measured: v.measured });
      continue;
    }
    // the official build must build it too, and to the same prediction
    if (CLI) {
      const cb = runCli([...cmds, ...probe]), ca = runCli([...cmds, ...plan.commands, ...probe]);
      const vol = (r) => r.measure?.bodies?.find((b) => b.name === f.body)?.volume_mm3;
      const edges = (r) => r.results?.filter((x) => x && x.edges && x.body === f.body).pop()?.edges;
      const cv = ca.ok && cb.ok ? verifySurfaceSketch({ prediction: plan.prediction, volumeBefore: vol(cb), volumeAfter: vol(ca), edgesBefore: edges(cb), edgesAfter: edges(ca) }) : null;
      if (!cv || !cv.ok) {
        const s = surfaceRefusal(id, f.op.op, cv ? 'mismatch' : 'kernel');
        console.log(`  REFUSED  ${f.what} -- ${s}\n           [built on the rig kernel, but the official rc.2 CLI ${cv ? 'did not match: ' + cv.reason : 'refused: ' + (ca.error ?? cb.error).slice(0, 200)}]`);
        report.push({ design: d.name, feature: f.what, outcome: 'rig built it, official CLI did not', sentence: s, cliError: ca.error ?? cb.error, cliMeasured: cv?.measured });
        continue;
      }
    }
    cmds = cmds.concat(plan.commands);
    kept.push(f.what);
    const m = v.measured;
    console.log(`  BUILT    ${f.what}${m.relError !== undefined ? `  (volume ${m.volumeDelta.toFixed(4)} mm3, predicted ${m.predicted.toFixed(4)}, rel ${m.relError.toExponential(1)})` : `  (${m.markedEdges} edges on the outline, ${m.markedLength.toFixed(3)} of ${m.predictedLength.toFixed(3)} mm)`}`);
    report.push({ design: d.name, feature: f.what, outcome: 'built', measured: m, notes: plan.notes });
  }
  const js = path.join(OUT, `${d.name}.json`);
  fs.writeFileSync(js, JSON.stringify({ commands: cmds }) + '\n');
  if (CLI) {
    const sc = path.join(OUT, `${d.name}.solidcraft`), png = path.join(OUT, `${d.name}.png`);
    execFileSync(CLI, ['run', js, '--save', sc, '--quiet'], { stdio: 'inherit', timeout: 900e3 });
    execFileSync(CLI, ['snapshot', js, '--out', png, '--width', '1400', '--height', '1000', '--view', 'iso'], { stdio: 'inherit', timeout: 900e3 });
    console.log(`  saved ${sc}\n  snapshot ${png}`);
  }
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
