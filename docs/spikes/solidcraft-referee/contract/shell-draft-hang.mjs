#!/usr/bin/env node
// SPIKE, referee only (contract / shell-draft group). TIME HAZARD: SolidCraft solid.shell (hollow, open top) on a box with a BLIND hole whose floor is
// within about one wall of the outer bottom does not return in a usable time. Measured (shell-draft-hang.txt, CPU seconds of the child process): floor
// 2.1 above the outer bottom 3.5 s and builds; 2.0 above 39 to 41 s then refuses; 1.5 above 127 to 146 s then refuses; 1.0 above 79 to 124 s then refuses;
// the refusals carry raw engine text ("boolean Cut: ... no result"). In a 110 s window under machine load that is NO result and NO refusal, which is how a
// critic saw a hang; it terminates in every probe here, with a 150 s limit.
// A hang cannot be caught in-process, so every probe is a child process with a time limit (the pattern of extrude-pocket-hang.mjs). Today the hazard is
// unreachable from the contract only because G-BLIND refuses every hollow whose history has a blind hole; the page must also run the engine under a time
// budget (a worker it can terminate).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/shell-draft-hang.mjs > contract/shell-draft-hang.txt
// Box 40x30x20 centred on the origin, hole r 4 along z at [8,5] or [0,0] from the top, `deep` D, wall 2, open top. Floor-to-bottom distance = 20 - D.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);
const child = process.argv.find((a) => a.startsWith('--child='));
const cmds = (D, wall, hx, hy) => [
  { command: 'solid.box', params: { length: 40, width: 30, height: 20, center: [0, 0, 0], body_name: 'b' } },
  { command: 'solid.cylinder', params: { radius: 4, height: D, base: [hx, hy, 10 - D], axis: 'Z', operation: 'cut', targets: ['b'] } },
  { command: 'solid.shell', params: { faces: [[-15, -10, 10]], thickness: wall, body: 'b' } },
];
if (child) {
  const [D, wall, hx, hy] = child.slice(8).split(',').map(Number);
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds(D, wall, hx, hy) })));
  const cpu = process.cpuUsage(); const cpuS = ((cpu.user + cpu.system) / 1e6).toFixed(1);
  console.log((r.ok ? `built ${r.measure.bodies.reduce((s, x) => s + x.volume_mm3, 0).toFixed(4)} faces ${r.measure.bodies.reduce((s, x) => s + x.faces, 0)}` : `refused "${String(r.failed?.error).slice(0, 90)}"`) + ` [cpu ${cpuS} s]`);
  process.exit(0);
}
const LIMIT = 150000;
console.log(`# hollow open:top, wall 2, 40x30x20 box with a blind d8 hole; each probe in its own process, wall-clock limit ${LIMIT / 1000} s; machine load average at start ${(await import('node:os')).loadavg()[0].toFixed(1)}`);
for (const [hx, hy] of [[8, 5], [0, 0]]) for (const D of [17.9, 18, 18.5, 19]) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [here, `--child=${D},2,${hx},${hy}`], { timeout: LIMIT, killSignal: 'SIGKILL', encoding: 'utf8', env: process.env });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const out = r.error?.code === 'ETIMEDOUT' || r.signal ? `HUNG: killed after ${LIMIT / 1000} s, no result, no refusal` : (r.stdout.trim() || `exit ${r.status} ${r.stderr.slice(0, 120)}`);
  console.log(`depth ${String(D).padEnd(5)} hole at [${hx},${hy}] (floor ${(20 - D).toFixed(1)} above the outer bottom)  ${out}  (${dt} s wall)`);
}
