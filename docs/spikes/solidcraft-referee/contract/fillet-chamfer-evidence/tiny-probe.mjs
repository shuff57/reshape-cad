// Raw truck probe: where does "size must be positive" start applying to a POSITIVE size? Box 40x30x20, one top/front edge (and the whole box via the corner option).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun tiny-probe.mjs > tiny-probe.txt
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const box = { command: 'solid.box', params: { length: 40, width: 30, height: 20, center: [0, 0, 0], body_name: 'b' } };
for (const cmd of ['solid.fillet', 'solid.chamfer']) for (const d of [0, 1e-9, 1e-7, 1e-6, 3e-6, 1e-5, 1e-4, 1e-3, 1e-2]) {
  const r = JSON.parse(sc.run(JSON.stringify({ commands: [box, { command: cmd, params: { edges: [[0, -15, 10]], ...(cmd === 'solid.fillet' ? { radius: d } : { distance: d }), body: 'b' } }] })));
  console.log(cmd, 'size', d, r.ok ? `BUILT volume ${r.measure.bodies[0].volume_mm3} faces ${r.measure.bodies[0].faces}` : `REFUSED ${r.failed?.error}`);
}
