#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Does a wasm trap poison the SolidCraft instance? The crate is built panic=abort, so any Rust panic surfaces as a wasm trap
// ("RuntimeError: unreachable"). The torus trap the critic saw could not be reproduced here (bool-trap-probe.json: 12 torus probes, no trap), so this script hunts for ANY input
// that traps, in one process, and then calls the SAME instance again with a plain box.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/bool-trap-instance.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const run = (commands) => { const t0 = Date.now(); try { const r = JSON.parse(sc.run(JSON.stringify({ commands }))); return { kind: r.ok ? 'ok' : 'refused', ms: Date.now() - t0, text: r.ok ? r.measure.bodies.map((b) => `${b.name}=${b.volume_mm3.toFixed(3)}`).join(' ') : String(r.failed?.error).slice(0, 110) }; } catch (e) { return { kind: 'TRAP', ms: Date.now() - t0, text: String(e.message).slice(0, 110) }; } };
const BOX = [{ command: 'solid.box', params: { length: 10, width: 10, height: 10, center: [0, 0, 0], body_name: 'ok' } }];
const bx = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const comb = (operation) => ({ command: 'solid.combine', params: { target: 'a', tools: ['t'], operation } });
const tries = [
  ['box 1e300', [bx('a', 1e300, 1e300, 1e300, [0, 0, 0])]],
  ['box tiny 1e-300', [bx('a', 1e-300, 1e-300, 1e-300, [0, 0, 0])]],
  ['box NaN via null', [bx('a', null, 10, 10, [0, 0, 0])]],
  ['sphere r 1e200', [{ command: 'solid.sphere', params: { radius: 1e200, center: [0, 0, 0], body_name: 'a' } }]],
  ['cut with huge tool', [bx('a', 10, 10, 10, [0, 0, 0]), bx('t', 1e12, 1e12, 1e12, [0, 0, 0]), comb('cut')]],
  ['join far apart 1e15', [bx('a', 10, 10, 10, [0, 0, 0]), bx('t', 10, 10, 10, [1e15, 0, 0]), comb('join')]],
  ['combine unknown body', [bx('a', 10, 10, 10, [0, 0, 0]), comb('join')]],
  ['torus minor tiny', [{ command: 'solid.torus', params: { major: 14, minor: 1e-9, center: [0, 0, 0], body_name: 'a' } }]],
  ['torus major huge', [{ command: 'solid.torus', params: { major: 1e9, minor: 1, center: [0, 0, 0], body_name: 'a' } }]],
  ['cylinder 0 height', [{ command: 'solid.cylinder', params: { radius: 5, height: 0, base: [0, 0, 0], axis: 'Z', body_name: 'a' } }]],
];
const out = [];
for (const [name, cmds] of tries) { const r = run(cmds); const after = run(BOX); out.push({ input: name, ...r, sameInstanceAfter: after }); console.log(name.padEnd(24), r.kind.padEnd(8), r.text.slice(0, 70).padEnd(72), '| same instance next box:', after.kind, after.text); }
writeFileSync(path.join(HERE, 'booleans-r2', 'trap-instance.json'), JSON.stringify(out, null, 1));
