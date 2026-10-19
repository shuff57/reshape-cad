// Direct probe, no translator in the loop: the bounding box truck MEASURES for the symmetric curved parts of the mirror tie row.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun pm-tie-probe.mjs > pm-tie-probe.json
// A tie is exact in the model (lo = -hi); the measured planar ends differ by ~1e-15 and the curved ends by ~1e-4, so `Math.abs(lo) <= Math.abs(hi)` on measured numbers is a coin flip.
import { createRequire } from 'node:module';
const sc = createRequire(import.meta.url)(process.env.SOLIDCRAFT_REFEREE_PKG + '/solidcraft_referee.js');
const run = (c) => JSON.parse(sc.run(JSON.stringify({ commands: c })));
const out = {};
const cyl = (name, r, h) => ({ command: 'solid.cylinder', params: { radius: r, height: h, base: [0, 0, -h / 2], axis: 'Z', body_name: name } });
for (const [id, cmds] of Object.entries({
  'cylinder(10,10)': [cyl('b', 5, 10)],
  'cylinder(100,20)': [cyl('b', 50, 20)],
  'cylinder(10,10) at z=-0.0001': [{ command: 'solid.cylinder', params: { radius: 5, height: 10, base: [0, 0, -5.0001], axis: 'Z', body_name: 'b' } }],
})) {
  const r = run(cmds); const b = r.measure.bodies[0].bbox;
  out[id] = { min: b.min, max: b.max, zLoAbsMinusHiAbs: Math.abs(b.min[2]) - Math.abs(b.max[2]), xLoAbsMinusHiAbs: Math.abs(b.min[0]) - Math.abs(b.max[0]), yLoAbsMinusHiAbs: Math.abs(b.min[1]) - Math.abs(b.max[1]) };
}
console.log(JSON.stringify(out, null, 1));
