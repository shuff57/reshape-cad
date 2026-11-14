// below-the-cap.mjs <dir of solidcraft_referee.js>: is there material below the bottom cap (z = -8) of `r24 cyl R12 h16 bore 10 y2.25 z-4.25`?
// The family's one row that is not RIGHT: a cylinder r 12, z -8 to 8, a bore r 5 along x at y 2.25, z -4.25, which breaks out through the bottom cap.
// The volume is right (2.4e-5 from OCCT) and the measured box ends at z = -8.0091. Asked of the engine directly, raw commands, each run from empty.
import { createRequire } from 'node:module'; import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.argv[2], 'solidcraft_referee.js'));
const run = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, trap: String(e.message) }; } };
const base = [{ command: 'solid.cylinder', params: { radius: 12, height: 16, base: [0, 0, -8], axis: 'Z', body_name: 'b_c1' } },
  { command: 'solid.cylinder', params: { radius: 5, height: 68, base: [-34, 2.25, -4.25], axis: 'X', operation: 'cut', targets: ['b_c1'] } }];
const show = (what, r) => console.log(what.padEnd(58), r.ok ? r.measure.bodies.map((b) => `volume ${b.volume_mm3} z ${b.bbox.min[2]} to ${b.bbox.max[2]}`).join(' ; ') : JSON.stringify(r).slice(0, 200));
show('the part', run(base));
for (const [what, z1] of [['cut away everything below z = -8', -8], ['cut away everything below z = -8.004', -8.004], ['control: cut away below z = -7.9', -7.9], ['control: cut away below z = -7', -7]])
  show(what, run([...base, { command: 'solid.box', params: { length: 60, width: 60, height: 3, center: [0, 0, z1 - 1.5], body_name: 'slab' } }, { command: 'solid.combine', params: { target: 'b_c1', tools: ['slab'], operation: 'cut' } }]));
