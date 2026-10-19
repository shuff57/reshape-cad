// SPIKE, referee only. Round 4 (critic): does ONE solid.draft call with every side-face point do a whole-shape draft, and does it agree with an
// independent closed form? Direct engine calls, no translator in the loop.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/shell-draft-r2-whole-probe.mjs
import * as B from './holes-base.mjs';
import * as P from './shell-draft-polytope.mjs';
const { runSC, rel } = B;
const SIGMA = -1; // fixed by the runner from brep-rs (shell-draft-runs.json sigma)
const out = [];
const meas = (r) => (r.ok ? r.measure.bodies.map((b) => ({ vol: b.volume_mm3, faces: b.faces, bbox: [...b.bbox.min, ...b.bbox.max], com: b.center_of_mass })) : r.failed);
const draftCmd = (pts, deg, neutral, pull = [0, 0, 1]) => ({ command: 'solid.draft', params: { faces: pts, angle: deg, neutral: { origin: pull.map((v) => v * neutral), normal: pull }, pull, body: 'B' } });
const show = (label, got, ref) => {
  const g = Array.isArray(got) ? got[0] : got;
  const row = { label, got: g, ref, dVol: g?.vol !== undefined && ref?.volume !== undefined ? rel(g.vol, ref.volume) : null };
  out.push(row);
  console.log(label.padEnd(58), g?.vol !== undefined ? `vol ${g.vol.toFixed(6)} faces ${g.faces}` : JSON.stringify(g).slice(0, 160), ref?.volume !== undefined ? `ref ${ref.volume.toFixed(6)} dVol ${row.dVol.toExponential(1)} refFaces ${ref.faces ?? '-'}` : '');
};
const draftAll = (planes, pullIdx, neutral, deg) => planes.map((p, i) => (Math.abs(p.n[pullIdx]) > 1e-9 ? p : P.draftPlane(p, 'xyz'[pullIdx], neutral, deg, SIGMA)));

// box 40x30x12 at [15,-7,3]
const C = [15, -7, 3], S = [40, 30, 12];
const sidesZ = (c, s) => [[c[0] + s[0] / 2, c[1], c[2]], [c[0] - s[0] / 2, c[1], c[2]], [c[0], c[1] + s[1] / 2, c[2]], [c[0], c[1] - s[1] / 2, c[2]]];
const boxCmd = { command: 'solid.box', params: { length: S[0], width: S[1], height: S[2], center: C, body_name: 'B' } };
const boxPl = P.translatePlanes(P.boxPlanes(S.map((s) => -s / 2), S.map((s) => s / 2)), C);
for (const [deg, n] of [[5, 0], [5, -3], [5, 3], [-5, 0], [20, 0], [60, -3], [78, -3], [-60, 3]]) {
  const q = draftAll(boxPl, 2, n, deg); const ref = P.measure(q); const base = P.measure(boxPl);
  show(`box whole ${deg}deg n${n}${ref.faces !== base.faces ? ' (closed form: faces vanish)' : ''}`, meas(runSC([boxCmd, draftCmd(sidesZ(C, S), deg, n)])), ref);
}
// pull along x: faces whose normal is not x (4 of them), neutral n
{
  const q = draftAll(boxPl, 0, 0, 8); const ref = P.measure(q);
  const pts = [[C[0], C[1] + 15, C[2]], [C[0], C[1] - 15, C[2]], [C[0], C[1], C[2] + 6], [C[0], C[1], C[2] - 6]];
  show('box whole pull x 8deg n0', meas(runSC([boxCmd, draftCmd(pts, 8, 0, [1, 0, 0])])), ref);
}
// hex prism R15 h20 at the origin
{
  const pl = P.prismPlanes(6, 15, 20);
  const pts = Array.from({ length: 6 }, (_, i) => { const a = 2 * Math.PI * (i + 0.5) / 6; const ap = 15 * Math.cos(Math.PI / 6); return [ap * Math.cos(a), ap * Math.sin(a), 0]; });
  const cmds = [{ command: 'sketch.create', params: { name: 'S', plane: { origin: [0, 0, -10], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: Array.from({ length: 6 }, (_, i) => [15 * Math.cos(2 * Math.PI * i / 6), 15 * Math.sin(2 * Math.PI * i / 6)]), closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: 20, sketch: 'S', operation: 'new', body_name: 'B' } }];
  for (const [deg, n] of [[5, 0], [5, -10], [-8, 0], [30, 10]]) show(`hex prism whole ${deg}deg n${n}`, meas(runSC([...cmds, draftCmd(pts, deg, n)])), P.measure(draftAll(pl, 2, n, deg)));
}
// wedge 30x20x15 (triangle (-w/2,-d/2),(w/2,-d/2),(-w/2,d/2))
{
  const pl = P.wedgePlanes(30, 20, 15);
  const tri = [[-15, -10], [15, -10], [-15, 10]];
  const mids = tri.map((p, i) => { const q = tri[(i + 1) % 3]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0]; });
  const cmds = [{ command: 'sketch.create', params: { name: 'S', plane: { origin: [0, 0, -7.5], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: tri, closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: 15, sketch: 'S', operation: 'new', body_name: 'B' } }];
  for (const [deg, n] of [[5, 0], [5, -7.5], [-5, 0], [20, 0]]) show(`wedge whole ${deg}deg n${n}`, meas(runSC([...cmds, draftCmd(mids, deg, n)])), P.measure(draftAll(pl, 2, n, deg)));
}
// L extrude (non-convex): oracle = mitre offset of the polygon per z, integrated (area is exactly quadratic in z while no edge vanishes)
{
  const Lp = [[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]];
  const H = 20;
  const cmds = [{ command: 'sketch.create', params: { name: 'S', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: Lp, closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: H, sketch: 'S', operation: 'new', body_name: 'B' } }];
  const mids = Lp.map((p, i) => { const q = Lp[(i + 1) % Lp.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, H / 2]; });
  for (const [deg, n] of [[3, 0], [5, 0], [-5, 0], [10, 0], [5, 10]]) {
    const ref = offsetVolume(Lp, 0, H, n, deg);
    show(`L extrude whole ${deg}deg n${n}${ref.vanish ? ' (closed form: edge vanishes)' : ''}`, meas(runSC([...cmds, draftCmd(mids, deg, n)])), ref);
  }
}
// cylinder R12 h30, frustum closed form
{
  const R = 12, H = 30; const k = (deg) => Math.tan(deg * Math.PI / 180);
  const frustum = (deg, n) => { const t = SIGMA * k(deg); const r = (z) => R + t * (z - n); const a = -H / 2, b = H / 2; return Math.abs(t) < 1e-12 ? Math.PI * R * R * H : Math.PI / (3 * t) * (r(b) ** 3 - r(a) ** 3); };
  for (const [deg, n] of [[5, 0], [-5, 0], [5, -15], [20, 5]]) {
    const cmds = [{ command: 'solid.cylinder', params: { radius: R, height: H, base: [0, 0, -15], axis: 'Z', body_name: 'B' } }, draftCmd([[R, 0, 0]], deg, n)];
    show(`cylinder whole ${deg}deg n${n}`, meas(runSC(cmds)), { volume: frustum(deg, n) });
  }
}
// cone and sphere: the engine itself
{
  const cone = [{ command: 'sketch.create', params: { name: 'K', plane: { origin: [0, 0, -15], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } }, { command: 'sketch.line', params: { points: [[0, 0], [15, 0], [0, 30]], closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.revolve', params: { axis: 'y', sketch: 'K', operation: 'new', body_name: 'B' } }];
  show('cone sloped side point, 5deg', meas(runSC([...cone, draftCmd([[7.5, 0, 0]], 5, 0)])), null);
  show('sphere point, 5deg', meas(runSC([{ command: 'solid.sphere', params: { radius: 15, center: [0, 0, 0], body_name: 'B' } }, draftCmd([[15, 0, 0]], 5, 0)])), null);
}

/** mitre offset of a simple polygon moved by out(z) = SIGMA tan(deg)(z-n) along each edge's outward normal; area is quadratic in z -> Simpson is exact */
function offsetArea(poly, d) {
  const n = poly.length; const sg = Math.sign(poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0));
  const lines = poly.map((p, i) => { const q = poly[(i + 1) % n]; const e = [q[0] - p[0], q[1] - p[1]]; const l = Math.hypot(...e); const nn = [sg * e[1] / l, -sg * e[0] / l]; return { n: nn, c: nn[0] * p[0] + nn[1] * p[1] + d, dir: [e[0] / l, e[1] / l], len: l }; });
  const vs = []; let ok = true;
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i]; const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
    vs.push([(a.c * b.n[1] - b.c * a.n[1]) / det, (a.n[0] * b.c - b.n[0] * a.c) / det]);
  }
  for (let i = 0; i < n; i++) { const p = vs[i], q = vs[(i + 1) % n]; const l = lines[i]; if ((q[0] - p[0]) * l.dir[0] + (q[1] - p[1]) * l.dir[1] <= 1e-9) ok = false; }
  let A = 0; for (let i = 0; i < n; i++) A += vs[i][0] * vs[(i + 1) % n][1] - vs[(i + 1) % n][0] * vs[i][1];
  return { area: Math.abs(A) / 2, ok };
}
function offsetVolume(poly, z0, z1, n, deg) {
  const t = SIGMA * Math.tan(deg * Math.PI / 180);
  const a = offsetArea(poly, t * (z0 - n)), m = offsetArea(poly, t * ((z0 + z1) / 2 - n)), b = offsetArea(poly, t * (z1 - n));
  // also check the quarter points so an edge that vanishes and returns is seen
  const ok = [a, m, b, offsetArea(poly, t * (z0 + (z1 - z0) / 4 - n)), offsetArea(poly, t * (z0 + 3 * (z1 - z0) / 4 - n))].every((r) => r.ok);
  return { volume: (z1 - z0) / 6 * (a.area + 4 * m.area + b.area), vanish: !ok };
}
