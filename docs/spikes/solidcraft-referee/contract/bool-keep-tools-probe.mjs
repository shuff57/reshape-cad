#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Raw SolidCraft, no translator: does solid.combine keep_tools:true keep a tool alive so a second combine can use it again?
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/bool-keep-tools-probe.mjs > booleans-r2/keep-tools-probe.txt
import { runRaw } from './bool-raw.mjs';
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const cyl = (n, r, h, base) => ({ command: 'solid.cylinder', params: { radius: r, height: h, base, axis: 'Z', body_name: n } });
const show = (t, r) => console.log(t.padEnd(34), JSON.stringify(r.ok ? { ms: r.ms, bodies: r.bodies.map((b) => [b.name, +b.volume.toFixed(3), b.faces, b.shells]) } : r).slice(0, 300));
const expected = 40 * 40 * 10 - Math.PI * 36 * 10;
console.log(`expected plate volume after a r6 bore: ${expected.toFixed(3)}`);
show('cut with keep_tools:true', runRaw([box('p1', 40, 40, 10, [0, 0, 0]), box('p2', 40, 40, 10, [60, 0, 0]), cyl('t', 6, 30, [0, 0, -15]), { command: 'solid.combine', params: { target: 'p1', tools: ['t'], operation: 'cut', keep_tools: true } }]));
show('keep_tools, move tool, 2nd cut', runRaw([box('p1', 40, 40, 10, [0, 0, 0]), box('p2', 40, 40, 10, [60, 0, 0]), cyl('t', 6, 30, [0, 0, -15]), { command: 'solid.combine', params: { target: 'p1', tools: ['t'], operation: 'cut', keep_tools: true } }, { command: 'solid.move', params: { bodies: ['t'], translate: [60, 0, 0] } }, { command: 'solid.combine', params: { target: 'p2', tools: ['t'], operation: 'cut' } }]));
show('WITHOUT keep_tools, 2nd cut', runRaw([box('p1', 40, 40, 10, [0, 0, 0]), box('p2', 40, 40, 10, [60, 0, 0]), cyl('t', 6, 30, [0, 0, -15]), { command: 'solid.combine', params: { target: 'p1', tools: ['t'], operation: 'cut' } }, { command: 'solid.move', params: { bodies: ['t'], translate: [60, 0, 0] } }, { command: 'solid.combine', params: { target: 'p2', tools: ['t'], operation: 'cut' } }]));
