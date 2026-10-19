#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group). A slanted ROUND tool (solid.loft of two copies of a circle S apart, used as a cut or a join) can
// HANG or TRAP the pinned truck once it crosses a face of the other body; it builds while it ends inside. Each probe runs in a child process with a
// 60 s limit, because a hang cannot be caught in-process (timings depend on the machine load; the measured ones were taken at load average ~25). translate-ep.mjs refuses these before the kernel sees them (cases sc-* in extrude-pocket-cases-r2.mjs).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-hang.mjs > contract/extrude-pocket-hang.txt
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);
const child = process.argv.find((a) => a.startsWith('--child='));
const sk = (name, origin, shapes) => [{ command: 'sketch.create', params: { name, plane: { origin, x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, ...shapes, { command: 'sketch.finish', params: {} }];
const plate = [...sk('p', [0, 0, 0], [{ command: 'sketch.line', params: { points: [[0, 0], [40, 0], [40, 30], [0, 30]], closed: true } }]), { command: 'solid.extrude', params: { sketch: 'p', distance: 10, operation: 'new', body_name: 'plate' } }];
const circ = { command: 'sketch.circle.center', params: { center: [14, 15], radius: 3 } };
// S = the slant (1,0,-1) scaled so that its z travel is `depth`
const slant = (z0, depth, dir) => { const sx = dir[0] / Math.abs(dir[2]) * depth; return [[0, 0, z0], [sx, 0, z0 + Math.sign(dir[2]) * depth]]; };
function cmds(kind, depth, dir) {
  const [a, b] = slant(10, depth, dir);
  const body = kind === 'cut' ? { operation: 'cut', targets: ['plate'] } : { operation: 'join', targets: ['plate'] };
  return [...plate, ...sk('a', a, [circ]), ...sk('b', b, [circ]), { command: 'solid.loft', params: { sections: [{ sketch: 'a' }, { sketch: 'b' }], ...body } }];
}
if (child) {
  const [kind, depth, dx, dz] = child.slice(8).split(',');
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds(kind, +depth, [+dx, 0, +dz]) })));
  console.log(r.ok ? `built ${r.measure.bodies.reduce((s, x) => s + x.volume_mm3, 0).toFixed(4)}` : `refused ${JSON.stringify(r.failed).slice(0, 120)}`);
  process.exit(0);
}
for (const [kind, depth, dx, dz, what] of [
  ['cut', 5, 1, -1, 'slanted d6 bore, 5 deep, ends inside the 10 mm plate'], ['cut', 10, 1, -1, 'slanted bore, 10 deep: ends flush with the bottom face'], ['cut', 10.01, 1, -1, 'slanted bore, 10.01 deep: crosses the bottom face by 0.01'],
  ['cut', 11, 1, -1, 'slanted bore, 11 deep: crosses the bottom face'], ['cut', 15, 1, -1, 'slanted bore, 15 deep'], ['join', 12, 1, -1, 'join(plate, slanted circle pull 12 long that runs down into the plate)'], ['join', 5, 1, 1, 'join(plate, slanted circle pull 5 long leaving the plate upward)'],
]) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [here, `--child=${kind},${depth},${dx},${dz}`], { timeout: 60000, encoding: 'utf8', env: process.env });
  const out = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM' ? 'HUNG: killed after 60 s' : (r.stdout.trim() || `exit ${r.status} ${r.stderr.slice(0, 100)}`);
  console.log(`${what.padEnd(88)} ${out}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
