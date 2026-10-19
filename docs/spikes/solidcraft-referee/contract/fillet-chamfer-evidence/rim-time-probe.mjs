// Raw truck wall time of ONE rim fillet / chamfer of cylinder R15 H20 at sizes 2, 14, 14.9 (the critic's 8 s / 18 s / 30 s). SOLIDCRAFT_REFEREE_PKG=<pkg> bun rim-time-probe.mjs > rim-time-probe.txt
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
for (const cmd of ['solid.fillet', 'solid.chamfer']) for (const d of [2, 14, 14.9]) {
  const cmds = [{ command: 'solid.cylinder', params: { base: [0, 0, -10], axis: [0, 0, 1], radius: 15, height: 20, body_name: 'c' } }, { command: cmd, params: { edges: [[15, 0, 10]], ...(cmd === 'solid.fillet' ? { radius: d } : { distance: d }), body: 'c' } }];
  const t0 = Date.now(); const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); const ms = Date.now() - t0;
  console.log(`${cmd.slice(6)} d${d} on R15 H20: ${r.ok ? `volume ${r.measure.bodies[0].volume_mm3.toFixed(4)}` : 'REFUSED ' + r.failed?.error}; ${ms} ms; load average ${os.loadavg().map((x) => x.toFixed(1)).join('/')}`);
}
