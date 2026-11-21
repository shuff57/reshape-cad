// Plan B step 2, the live measurement: native solid.hole with its position on the BOTTOM face of a box, with no direction and with direction +z, for a
// counterbore and a countersink, blind and through, against the volume worked out by hand and the centre of mass's side (material leaves the bottom: z up).
// Box 40 x 30 x 20 about the origin (z -10..10), bore 6 across, 8 deep where blind.
//   SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg flock ~/.cache/solidcraft-0.30.1-rig/rig.lock node measure-recess-bottom.mjs
import { createRequire } from 'node:module';
const sc = createRequire(import.meta.url)((process.env.SOLIDCRAFT_REFEREE_PKG ?? process.env.HOME + '/.cache/solidcraft-0.30.1-rig/sc-referee-pkg') + '/solidcraft_referee.js');
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const PI = Math.PI;
const box = { command: 'solid.box', params: { length: 40, width: 30, height: 20, center: [0, 0, 0], body_name: 'B' } };
// by hand: a counterbore 10 across, 3 deep, on a 6 bore 8 deep (blind) / 20 (through); a 90-degree countersink 12 across (cone 3 deep) on the same bore
const cbBlind = 24000 - PI * (25 * 3 + 9 * 5), cbThrough = 24000 - PI * (25 * 3 + 9 * 17);
const coneVol = (R, r, h) => PI * h * (R * R + R * r + r * r) / 3; // frustum 12 -> 6 across over (6-3) = 3 deep at 90 degrees
const csBlind = 24000 - coneVol(6, 3, 3) - PI * 9 * 5, csThrough = 24000 - coneVol(6, 3, 3) - PI * 9 * 17;
const cases = [
  ['counterbore, blind', { type: 'counterbore', cb_diameter: 10, cb_depth: 3, depth: 8 }, cbBlind],
  ['counterbore, through', { type: 'counterbore', cb_diameter: 10, cb_depth: 3 }, cbThrough],
  ['countersink, blind', { type: 'countersink', cs_diameter: 12, cs_angle: '90 deg', depth: 8 }, csBlind],
  ['countersink, through', { type: 'countersink', cs_diameter: 12, cs_angle: '90 deg' }, csThrough],
];
for (const [name, p, want] of cases) for (const dir of [null, [0, 0, 1]]) {
  const params = { position: [5, 3, -10], diameter: 6, body: 'B', ...p, ...(dir ? { direction: dir } : {}) };
  const r = run([box, { command: 'solid.hole', params }]);
  if (!r.ok) { console.log(`${name.padEnd(22)} ${dir ? 'dir +z' : 'no dir'}  FAILED ${JSON.stringify(r.failed).slice(0, 160)}`); continue; }
  const b = r.measure.bodies.find((x) => x.name === 'B');
  console.log(`${name.padEnd(22)} ${dir ? 'dir +z' : 'no dir'}  vol=${b.volume_mm3.toFixed(4)} want=${want.toFixed(4)} rel=${(Math.abs(b.volume_mm3 - want) / want).toExponential(1)} comZ=${b.center_of_mass[2].toFixed(4)} faces=${b.faces} bbox=${JSON.stringify(b.bbox)}`);
}
