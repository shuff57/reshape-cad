// SPIKE, referee only. Round 3: product-equivalent cost of a pocket pattern. One bare solidcraft session runs the command list the script
// lowering implies for repeat(pocket,{count:N}): plate + N circle sketches + N cut extrudes (overlapping slot, step 3, d2 circles, blind 4).
// The per-feature translator replays the accepted commands for EVERY feature (quadratic); this script shows what one session costs.
// usage: SOLIDCRAFT_REFEREE_PKG=... bun pm3-time-bare.mjs [N,N,...]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const Ns = (process.argv[2] ?? '10,20,40,60,100,200').split(',').map(Number);
const list = (n) => {
  const cmds = [
    { command: 'sketch.create', params: { name: 'pl', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } },
    { command: 'sketch.line', params: { points: [[0, 0], [n * 3 + 10, 0], [n * 3 + 10, 30], [0, 30]], closed: true } },
    { command: 'sketch.finish', params: {} },
    { command: 'solid.extrude', params: { distance: 10, sketch: 'pl', operation: 'new', body_name: 'plate' } },
  ];
  for (let i = 0; i < n; i++) cmds.push(
    { command: 'sketch.create', params: { name: `c${i}`, plane: { origin: [0, 0, 10], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } },
    { command: 'sketch.circle.center', params: { center: [5 + 3 * i, 15], diameter: 2 } },
    { command: 'sketch.finish', params: {} },
    { command: 'solid.extrude', params: { distance: 4, direction: 'negative', sketch: `c${i}`, operation: 'cut', targets: ['plate'] } });
  return cmds;
};
const child = path.join(HERE, 'pm-sc-child.mjs');
for (const n of Ns) {
  const t0 = Date.now();
  const p = spawnSync(process.execPath, [child], { input: JSON.stringify({ commands: list(n) }), encoding: 'utf8', timeout: 900000, killSignal: 'SIGKILL', maxBuffer: 1 << 30, env: process.env });
  const ms = Date.now() - t0;
  if (p.error || p.status !== 0) { console.log(`pocket count ${n}: no result in ${ms} ms (${p.error?.code ?? 'exit ' + p.status})`); continue; }
  const r = JSON.parse(p.stdout);
  console.log(`pocket count ${n}: ${r.ok ? `ok, volume ${r.measure.bodies[0].volume_mm3.toFixed(3)}, faces ${r.measure.bodies[0].faces}` : 'FAILED ' + JSON.stringify(r.failed)} in ${ms} ms (${(n * 3 + 10) * 300 - 0} mm3 plate-ish)`);
}
