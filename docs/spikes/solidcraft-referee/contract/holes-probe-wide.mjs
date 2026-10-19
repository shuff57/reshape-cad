#!/usr/bin/env node
// Direct solidcraft runs (no translator) of the bores that are as wide as, or wider than, the part. Prints every body the engine holds and
// its kernel shell count: a body with shells > 1 is several disjoint pieces fused into one body name (the translator reports it as ONE solid).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/holes-probe-wide.mjs --out=<dir>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runSC, OUT } from './holes-base.mjs';
const rows = [];
const run = (name, w, d, h, cx, cy, dia) => {
  const r = runSC([
    { command: 'solid.box', params: { length: w, width: d, height: h, center: [w / 2, d / 2, h / 2], body_name: 'P' } },
    { command: 'solid.cylinder', params: { radius: dia / 2, height: h + 2, base: [cx, cy, -1], axis: 'Z', operation: 'cut', targets: ['P'] } }]);
  if (!r.ok) { rows.push({ name, refused: JSON.stringify(r.failed).slice(0, 300) }); console.log(name, 'REFUSED'); return; }
  const bodies = r.measure.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces, kernel: b.kernel }));
  rows.push({ name, bodies });
  console.log(name.padEnd(36), bodies.map((b) => `${b.name} V=${b.volume.toFixed(3)} faces=${b.faces} kernel(f/e/shells)=${b.kernel.faces}/${b.kernel.edges}/${b.kernel.shells}`).join(' || '));
};
run('plate 40x30x10, 10 across at x=35 (tangent to x=40 along a line)', 40, 30, 10, 35, 15, 10);
run('plate, 9.99 across at x=35 (control)', 40, 30, 10, 35, 15, 9.99);
run('plate, 30 across (tangent to both long sides)', 40, 30, 10, 20, 15, 30);
run('plate, 29.99 across (control)', 40, 30, 10, 20, 15, 29.99);
run('plate, 31 across (splits)', 40, 30, 10, 20, 15, 31);
run('box 40x40x20, 40 across (tangent to all four sides)', 40, 40, 20, 20, 20, 40);
run('box, 39.99 across (control)', 40, 40, 20, 20, 20, 39.99);
run('box, 41 across (four corner pieces)', 40, 40, 20, 20, 20, 41);
writeFileSync(path.join(OUT, 'holes-probe-wide.json'), JSON.stringify(rows, null, 1));
