// Direct SolidCraft experiments for the shell-draft group (no translator in the loop).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/shell-draft-experiments.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const run = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { error: 'TRAP ' + e.message } }; } };
const sum = (r) => (r.ok ? r.measure.bodies.map((b) => ({ name: b.name, vol: b.volume_mm3, faces: b.faces, bbox: [...b.bbox.min, ...b.bbox.max] })) : r.failed);
const C = [15, -7, 3], S = [40, 30, 12];
const box = (size = S, c = C) => ({ command: 'solid.box', params: { length: size[0], width: size[1], height: size[2], center: c, body_name: 'B' } });
const out = {};

// E1: thick-wall shell, open top. Is anything reported when the cavity has zero or negative depth?
for (const t of [11.9, 12, 12.5, 13, 14.9, 15, 16]) {
  out[`shell wall ${t} open top (40x30x12)`] = sum(run([box(), { command: 'solid.shell', params: { faces: [[C[0], C[1], C[2] + 6]], thickness: t, body: 'B' } }]));
}
for (const t of [14.9, 15, 15.5]) {
  out[`shell wall ${t} open top (40x30x50)`] = sum(run([box([40, 30, 50]), { command: 'solid.shell', params: { faces: [[C[0], C[1], C[2] + 25]], thickness: t, body: 'B' } }]));
}
// E2: multi-face draft in ONE solid.draft call = what a whole-body draft would map to (four side faces, pull z, neutral n)
const sides = (c = C, s = S) => [[c[0] + s[0] / 2, c[1], c[2]], [c[0] - s[0] / 2, c[1], c[2]], [c[0], c[1] + s[1] / 2, c[2]], [c[0], c[1] - s[1] / 2, c[2]]];
const wholeAnalytic = (deg, n) => { const k = Math.tan(deg * Math.PI / 180); const a = C[2] - 6 - n, b = C[2] + 6 - n; return 40 * 30 * 12 - 2 * k * 70 * (b * b - a * a) / 2 + 4 * k * k * (b ** 3 - a ** 3) / 3; };
for (const [deg, n] of [[5, 0], [5, -3], [5, 3], [-5, 0], [20, 0]]) {
  const r = sum(run([box(), { command: 'solid.draft', params: { faces: sides(), angle: deg, neutral: { origin: [0, 0, n], normal: [0, 0, 1] }, pull: [0, 0, 1], body: 'B' } }]));
  out[`draft 4 sides in one call ${deg}deg neutral ${n}`] = { got: r, closedFormVolume: wholeAnalytic(deg, n), rel: Array.isArray(r) ? Math.abs(r[0].vol - wholeAnalytic(deg, n)) / wholeAnalytic(deg, n) : null };
}
// E3: large angle that makes the tilted face cross the opposite face (right face, neutral 0, 40 wide box z -3..9)
const clip = (deg) => { // exact volume of the half-space intersection, width w(z)=40-k z, depth 30, z in [-3, min(9, 40/k)]
  const k = Math.tan(deg * Math.PI / 180); const sgn = Math.sign(k); const kk = Math.abs(k);
  const w = (z) => 40 - sgn * kk * z; // sigma=-1 convention: narrows as z grows for positive angle
  let z0 = -3, z1 = 9;
  if (sgn > 0) z1 = Math.min(9, 40 / kk); else z0 = Math.max(-3, -40 / kk);
  return 30 * (40 * (z1 - z0) - sgn * kk * (z1 * z1 - z0 * z0) / 2);
};
for (const deg of [60, 70, 74, 76, 80, 85, 89, -80, -89]) {
  const r = sum(run([box(), { command: 'solid.draft', params: { faces: [[35, -7, 3]], angle: deg, neutral: { origin: [0, 0, 0], normal: [0, 0, 1] }, pull: [0, 0, 1], body: 'B' } }]));
  out[`draft right ${deg}deg neutral 0`] = { got: r, exactClipVolume: clip(deg), rel: Array.isArray(r) ? Math.abs(r[0].vol - clip(deg)) / clip(deg) : null };
}
// E4: concave (reflex) edges, direct engine calls with a hand-picked point ON the open face, so the pick cannot be the reason for a result.
//   closed forms: rectilinear polygon inset area A - wP + c w^2 - r (pi/4) w^2 (c convex, r reflex vertices), V = A h - A_in (h - w)
{
  const inset = (pts, w) => { let A = 0, Pm = 0, c = 0, r = 0; const n = pts.length; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], d = pts[(i + 2) % n]; A += a[0] * b[1] - b[0] * a[1]; Pm += Math.hypot(b[0] - a[0], b[1] - a[1]); const cr = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]); if (cr > 0) c++; else r++; } A = Math.abs(A) / 2; return { A, Ain: A - w * Pm + c * w * w - r * Math.PI / 4 * w * w }; };
  const L = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];
  const sk = (pts, h) => [{ command: 'sketch.create', params: { name: 'S', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: pts, closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: h, sketch: 'S', operation: 'new', body_name: 'B' } }];
  for (const w of [1, 2]) {
    const { A, Ain } = inset(L, w);
    const r = sum(run([...sk(L, 10), { command: 'solid.shell', params: { faces: [[2, 2, 10]], thickness: w, body: 'B' } }]));
    const exact = A * 10 - Ain * (10 - w);
    out[`E4 L-extrude 40x40 arm 10 high 10, open top wall ${w}`] = { got: r, closedForm: exact, rel: Array.isArray(r) ? Math.abs(r[0].vol - exact) / exact : null };
  }
  const notch = [[-20, -20], [-5, -20], [-5, -15], [5, -15], [5, -20], [20, -20], [20, 20], [-20, 20]];
  { const w = 2; const { A, Ain } = inset(notch, w); const exact = A * 20 - Ain * (20 - w);
    const r = sum(run([...sk(notch, 20).map((c) => (c.command === 'sketch.create' ? { ...c, params: { ...c.params, plane: { origin: [0, 0, -10], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } } : c)), { command: 'solid.shell', params: { faces: [[-15, 0, 10]], thickness: w, body: 'B' } }]));
    out['E4 notch 40x40x20 (10 wide, 5 deep), open top wall 2'] = { got: r, closedForm: exact, rel: Array.isArray(r) ? Math.abs(r[0].vol - exact) / exact : null }; }
}
// E5: draft the curved side of a cylinder (point ON the surface), closed form = frustum
{
  const R = 12, H = 30, k = Math.tan(5 * Math.PI / 180);
  for (const sgn of [1, -1]) {
    const r = sum(run([{ command: 'solid.cylinder', params: { radius: R, height: H, base: [0, 0, -15], axis: 'Z', body_name: 'B' } }, { command: 'solid.draft', params: { faces: [[R, 0, 0]], angle: 5 * sgn, neutral: { origin: [0, 0, 0], normal: [0, 0, 1] }, pull: [0, 0, 1], body: 'B' } }]));
    const fr = (s) => Math.PI / (3 * s * k) * (((R + s * k * 15) ** 3) - ((R - s * k * 15) ** 3));
    out[`E5 cylinder side draft ${5 * sgn}deg, point on the surface`] = { got: r, frustumClosedForm: Math.max(fr(1), fr(-1)) === fr(sgn) ? fr(sgn) : fr(-sgn), either: [fr(1), fr(-1)] };
  }
}
// E6: what a naive WHOLE-shape mapping would send: ONE solid.draft call with several faces of a NON-BOX part, and the same faces one call after another.
//     extrusion from z=0, neutral 0, every face drafted INTO the part (positive angle with the engine's convention). The sections closed form says which fit.
{
  const sk2 = (pts, h) => [{ command: 'sketch.create', params: { name: 'S', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: pts, closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: h, sketch: 'S', operation: 'new', body_name: 'B' } }];
  const shapes = {
    'L arm15 (critic outline) h20': { pts: [[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]], h: 20, faces: [[0, 15, 10], [20, 0, 10], [40, 7.5, 10], [7.5, 30, 10]] },
    'L arm10 h10': { pts: [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]], h: 10, faces: [[0, 20, 5], [20, 0, 5], [40, 5, 5], [5, 40, 5]] },
    'T shoulder10 stem10 h20': { pts: [[0, 10], [10, 10], [10, 0], [30, 0], [30, 10], [40, 10], [40, 20], [0, 20]], h: 20, faces: [[0, 15, 10], [20, 0, 10], [40, 15, 10], [20, 20, 10]] },
  };
  for (const [name, sh] of Object.entries(shapes)) {
    const base = sum(run(sk2(sh.pts, sh.h)))[0].vol;
    const row = {};
    for (const deg of [10, 22, 40, 45, 60, 80]) {
      const one = sum(run([...sk2(sh.pts, sh.h), { command: 'solid.draft', params: { faces: sh.faces, angle: deg, neutral: { origin: [0, 0, 0], normal: [0, 0, 1] }, pull: [0, 0, 1], body: 'B' } }]));
      const seq = sum(run([...sk2(sh.pts, sh.h), ...sh.faces.map((p) => ({ command: 'solid.draft', params: { faces: [p], angle: deg, neutral: { origin: [0, 0, 0], normal: [0, 0, 1] }, pull: [0, 0, 1], body: 'B' } }))]));
      row[`${deg} deg`] = { oneCallFourFaces: Array.isArray(one) ? one.map((b) => `${b.vol.toFixed(1)} (${b.faces} faces)`).join(' ') : one.error ?? one, fourCallsOneFaceEach: Array.isArray(seq) ? seq.map((b) => `${b.vol.toFixed(1)} (${b.faces} faces)`).join(' ') : (seq.error ?? JSON.stringify(seq)).slice(0, 110) };
    }
    out[`E6 ${name}, undrafted ${base}`] = row;
  }
}
console.log(JSON.stringify(out, null, 1));
