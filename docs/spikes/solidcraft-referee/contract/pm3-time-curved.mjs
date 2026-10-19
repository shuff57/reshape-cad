// SPIKE, referee only. Round 3: what ONE bare solidcraft session costs for the repeat shapes the critic timed (pattern + join, no oracle, no replay),
// each in its own process killed at 300 s. The per-feature translator pays this more than once (it replays the accepted commands for every feature),
// so these are the floor of a student's wait, not the rig's wall time.
// usage: SOLIDCRAFT_REFEREE_PKG=... bun pm3-time-curved.mjs > pm3-time-curved.txt
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const child = path.join(HERE, 'pm-sc-child.mjs');
const sph = { command: 'solid.sphere', params: { radius: 5, center: [0, 0, 0], body_name: 'a' } };
const cone = [
  { command: 'sketch.create', params: { name: 'k', plane: { origin: [0, 0, -10], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
  { command: 'sketch.line', params: { points: [[0, 0], [5, 0], [0, 20]], closed: true } }, { command: 'sketch.finish', params: {} },
  { command: 'solid.revolve', params: { axis: 'y', sketch: 'k', operation: 'new', body_name: 'a' } }];
const box = { command: 'solid.box', params: { length: 4, width: 4, height: 4, center: [0, 0, 0], body_name: 'a' } };
const lin = (n, step, dir = [1, 0, 0]) => [{ command: 'solid.pattern.rectangular', params: { bodies: ['a'], dir1: dir, count1: n, spacing1: step } },
  { command: 'solid.combine', params: { target: 'a', tools: Array.from({ length: n - 1 }, (_, i) => `a (${i + 2})`), operation: 'join' } }];
const T = [
  ['sphere d10 x2 step 8', [sph, ...lin(2, 8)]], ['sphere d10 x2 step 7.5', [sph, ...lin(2, 7.5)]], ['sphere d10 x2 step 7', [sph, ...lin(2, 7)]], ['sphere d10 x2 step 6', [sph, ...lin(2, 6)]],
  ['sphere d10 x3 step 8', [sph, ...lin(3, 8)]], ['sphere d10 x2 step 12 (apart)', [sph, ...lin(2, 12)]],
  ['cone d10 h20 x2 step 8', [...cone, ...lin(2, 8)]], ['cone d10 h20 x2 step 6', [...cone, ...lin(2, 6)]], ['cone d10 h20 x2 step 3 (join fails)', [...cone, ...lin(2, 3)]], ['cone d10 h20 x3 step 6 (join fails)', [...cone, ...lin(3, 6)]],
  ['box 4 x200 step 3', [box, ...lin(200, 3)]], ['box 4 x1000 step 3', [box, ...lin(1000, 3)]],
];
for (const [name, cmds] of T) {
  const t0 = Date.now();
  const p = spawnSync(process.execPath, [child], { input: JSON.stringify({ commands: cmds }), encoding: 'utf8', timeout: 300000, killSignal: 'SIGKILL', maxBuffer: 1 << 30, env: process.env });
  const ms = Date.now() - t0;
  if (p.error || p.status !== 0) { console.log(`${name.padEnd(40)} no result in ${(ms / 1000).toFixed(1)} s (killed at the 300 s cap)`); continue; }
  const r = JSON.parse(p.stdout);
  console.log(`${name.padEnd(40)} ${(ms / 1000).toFixed(1).padStart(6)} s  ${r.ok ? 'ok volume ' + r.measure.bodies.map((b) => b.volume_mm3.toFixed(3)).join('+') : 'FAILED ' + (r.failed?.error ?? '').slice(0, 70)}`);
}
