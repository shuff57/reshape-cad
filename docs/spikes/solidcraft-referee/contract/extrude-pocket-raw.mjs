#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 4. RAW SolidCraft with NO translator and NO guard: hand-written command lists sent straight to
// sc.run, compared with a closed form. This is what the kernel does when nothing sits in front of it: the rows with status "wrong" in extrude-pocket.json
// ("RAW SOLIDCRAFT, no guard") quote these lines.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-raw.mjs > extrude-pocket-raw.txt
import { createRequire } from 'node:module';
import path from 'node:path';
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const run = (cmds) => { const t = Date.now(); try { const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); r.ms = Date.now() - t; return r; } catch (e) { return { ok: false, failed: { error: `WASM TRAP ${e.message}` }, ms: Date.now() - t }; } };
const plane = (z = 0) => ({ origin: [0, 0, z], x_dir: [1, 0, 0], y_dir: [0, 1, 0] });
const poly = (pts) => ({ command: 'sketch.line', params: { points: pts, closed: true } });
const circ = (c, r) => ({ command: 'sketch.circle.center', params: { center: c, radius: r, connect: false } });
const sketch = (name, z, ...items) => [{ command: 'sketch.create', params: { name, plane: plane(z) } }, ...items, { command: 'sketch.finish', params: {} }];
const sq = (cx, cy, w, h) => poly([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]]);
const ex = (sk, params) => ({ command: 'solid.extrude', params: { sketch: sk, operation: 'new', body_name: 'b', ...params } });
const summ = (r) => (r.ok ? { bodies: r.measure.bodies.length, vol: r.measure.bodies.reduce((a, b) => a + b.volume_mm3, 0), faces: r.measure.bodies.reduce((a, b) => a + b.faces, 0), bbox: r.measure.bodies.length ? [0, 1, 2].map((i) => Math.min(...r.measure.bodies.map((b) => b.bbox.min[i]))).concat([0, 1, 2].map((i) => Math.max(...r.measure.bodies.map((b) => b.bbox.max[i])))) : null } : { err: String(r.failed?.error ?? r.error ?? '').slice(0, 120) });
const f = (x, n = 4) => (typeof x === 'number' ? +x.toFixed(n) : x);
const out = (s) => console.log(s);
const PL = (h) => [...sketch('p', 0, poly([[0, 0], [40, 0], [40, 30], [0, 30]])), ex('p', { distance: h })];

out(`# raw SolidCraft, no translator, no guard (${new Date().toISOString().slice(0, 10)}). Each line: case | raw result | exact answer | verdict`);
// 1. a loop standing inside another: the default is ALL profiles, so the hole is filled
{
  const s = summ(run([...sketch('s', 0, sq(0, 0, 40, 40), circ([0, 0], 8)), ex('s', { distance: 10 })]));
  const exact = (1600 - Math.PI * 64) * 10;
  out(`soup-hole | 40 x 40 plate with a d16 hole pulled 10: raw ${f(s.vol)} mm3, ${s.bodies} body | exact ${f(exact)} | ${Math.abs(s.vol - exact) / exact > 1e-3 ? 'WRONG (hole filled)' : 'ok'}`);
}
{
  const s = summ(run([...sketch('s', 0, sq(0, 0, 60, 60), sq(0, 0, 40, 40), sq(0, 0, 20, 20)), ex('s', { distance: 15 })]));
  const exact = (3600 - 1600 + 400) * 15;
  out(`soup-nested3 | three nested squares 60 / 40 / 20 pulled 15: raw ${f(s.vol)} mm3, ${s.bodies} body | exact ${f(exact)} | ${Math.abs(s.vol - exact) / exact > 1e-3 ? 'WRONG (holes filled)' : 'ok'}`);
}
// 2. a taper that folds: truck builds something
for (const [w, h, d, deg] of [[20, 12, 10, -45], [40, 30, 40, -30], [20, 12, 10, -60], [20, 12, 10, -85]]) {
  const s = summ(run([...sketch('s', 0, sq(0, 0, w, h)), ex('s', { distance: d, taper: deg })]));
  const half = Math.min(w, h) / 2;
  const foldsAt = half / Math.abs(Math.tan((deg * Math.PI) / 180));
  out(`taper-fold | rect ${w} x ${h}, height ${d}, taper ${deg}: raw ${s.err ? `error "${s.err}"` : `${f(s.vol)} mm3 (${s.faces} faces)`} | the short walls meet at height ${f(foldsAt, 2)} < ${d}, so there is NO solid | ${s.err ? 'refused by the kernel' : 'WRONG (a folded outline built)'}`);
}
// 3. an array direction: silently read as "positive"; the slanted sweep never happens
{
  const s = summ(run([...sketch('s', 0, sq(0, 0, 10, 10)), ex('s', { distance: 10, direction: [1, 0, 1] })]));
  out(`direction-array | 10 x 10 square, direction [1,0,1], length 10: raw bbox ${s.bbox ? JSON.stringify(s.bbox.map((v) => f(v, 3))) : s.err} | an oblique sweep reaches x=${5 + 10}; raw max x is ${s.bbox ? f(s.bbox[3], 3) : '-'} | ${s.bbox && s.bbox[3] < 6 ? 'WRONG (plain prism, direction ignored)' : 'ok'}`);
}
// 4. a thin wall left by a pocket: the boolean drops it
for (const g of [1e-4, 1e-3, 0.01, 0.1, 0.12, 0.15, 0.3, 1]) {
  const w = 20 - g;
  const s = summ(run([...PL(10), ...sketch('c', 10, sq(g + w / 2, 15, w, 20)), { command: 'solid.extrude', params: { sketch: 'c', operation: 'cut', targets: ['b'], distance: 5, direction: 'negative' } }]));
  const exact = 12000 - w * 100;
  out(`wall | pocket 20 x 20 x 5 leaving a wall of ${g} mm at the plate edge: raw ${f(s.vol, 5)} mm3, ${s.faces} faces | exact ${f(exact, 5)}, 11 faces | ${Math.abs(s.vol - exact) > 1e-9 * 12000 || s.faces !== 11 ? `WRONG (off by ${(s.vol - exact).toExponential(1)}, ${s.faces} faces)` : 'ok'}`);
}
// 5. flat outline: the critic reported "ok with zero bodies"; every variant tried here is REFUSED by the kernel (raw text, not a plain sentence)
for (const [name, pts] of [['3 collinear points', [[0, 0], [5, 0], [10, 0]]], ['4 collinear points', [[2, 2], [8, 2], [14, 2], [6, 2]]]]) {
  for (const op of ['new', 'join']) {
    const params = op === 'new' ? { sketch: 'f', operation: 'new', body_name: 'padb', distance: 5 } : { sketch: 'f', operation: 'join', targets: ['b'], distance: 5 };
    const r = run([...PL(10), ...sketch('f', 10, poly(pts)), { command: 'solid.extrude', params }]);
    out(`flat | pad (operation ${op}) on ${name}: raw ok=${r.ok}, bodies ${r.ok ? r.measure.bodies.length : '-'}${r.ok ? '' : ` error "${String(r.failed?.error).slice(0, 100)}"`} | there is no area to pull | ${r.ok ? 'WRONG (success reported, nothing built)' : 'kernel refuses in raw text'}`);
  }
}
{
  const items = [[[0, 0], [5, 0]], [[5, 0], [10, 0]], [[10, 0], [0, 0]]].map((l, i) => ({ command: 'sketch.line', params: { points: l, ids: [`g${i + 1}`], connect: false } }));
  const cons = [['g1.end', 'g2.start'], ['g2.end', 'g3.start'], ['g3.end', 'g1.start']].map(([a, b]) => ({ command: 'sketch.constraint.coincident', params: { a, b } }));
  const r = run([...PL(10), ...sketch('f', 10, ...items, ...cons), { command: 'solid.extrude', params: { sketch: 'f', operation: 'new', body_name: 'padb', distance: 5 } }]);
  out(`flat | pad on 3 collinear lines drawn as rows with coincident rules: raw ok=${r.ok}, bodies ${r.ok ? r.measure.bodies.length : '-'}${r.ok ? '' : ` error "${String(r.failed?.error).slice(0, 100)}"`} | there is no area to pull | ${r.ok ? 'WRONG (success reported, nothing built)' : 'kernel refuses in raw text'}`);
}
// 6. a loft of a holed profile drops the hole (the way a slanted pull is built)
{
  const a = sketch('a', 0, sq(0, 0, 40, 30), circ([0, 0], 5));
  const b = sketch('b', 10, sq(10, 0, 40, 30), circ([10, 0], 5));
  const r = run([...a, ...b, { command: 'solid.loft', params: { sections: [{ sketch: 'a' }, { sketch: 'b' }], operation: 'new', body_name: 'b' } }]);
  const s = summ(r);
  const exact = (1200 - Math.PI * 25) * 10;
  out(`loft-hole | slanted pull (loft) of a 40 x 30 plate with a d10 hole, 10 along [1,0,1]: raw ${s.err ?? `${f(s.vol)} mm3`} | exact ${f(exact)} | ${s.vol && Math.abs(s.vol - exact) / exact > 1e-3 ? 'WRONG (hole dropped)' : 'ok'}`);
}
