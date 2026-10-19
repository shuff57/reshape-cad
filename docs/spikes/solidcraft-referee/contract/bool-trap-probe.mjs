#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Raw SolidCraft: hunt for the wasm trap "Unreachable code should not be executed" on torus booleans, and measure whether the SAME wasm
// instance still works after a trap (is it poisoned?). No translator in the loop. Each probe is one child process with a hard timeout.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/bool-trap-probe.mjs [--timeout=60] [--out=booleans-r2/trap-probe.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRaw } from './bool-raw.mjs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TO = Number(arg('timeout', 60));
const tor = (n, R, r, c) => ({ command: 'solid.torus', params: { major: R, minor: r, center: c, body_name: n } });
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const cyl = (n, r, h, base) => ({ command: 'solid.cylinder', params: { radius: r, height: h, base, axis: 'Z', body_name: n } });
const sph = (n, r, c) => ({ command: 'solid.sphere', params: { radius: r, center: c, body_name: n } });
const comb = (operation, target = 'a', tools = ['t']) => ({ command: 'solid.combine', params: { target, tools, operation } });
const P = [
  ['box-bottom-face-tangent-to-tube-top (join)', [tor('a', 14, 4, [0, 0, 0]), box('t', 10, 10, 10, [14, 0, 9]), comb('join')]],
  ['box-top-face-tangent-to-tube-bottom (join)', [tor('a', 14, 4, [0, 0, 0]), box('t', 10, 10, 10, [14, 0, -9]), comb('join')]],
  ['box-side-face-tangent-inner-equator (join)', [tor('a', 14, 4, [0, 0, 0]), box('t', 10, 10, 40, [5, 0, 0]), comb('join')]],
  ['torus-torus-shift10 (join)', [tor('a', 14, 4, [0, 0, 0]), tor('t', 14, 4, [10, 0, 0]), comb('join')]],
  ['torus-torus-identical (join)', [tor('a', 14, 4, [0, 0, 0]), tor('t', 14, 4, [0, 0, 0]), comb('join')]],
  ['torus-torus-coaxial-stacked-tangent (join)', [tor('a', 14, 4, [0, 0, 0]), tor('t', 14, 4, [0, 0, 8]), comb('join')]],
  ['torus-sphere-r4-on-centreline (join)', [tor('a', 14, 4, [0, 0, 0]), sph('t', 4, [14, 0, 0]), comb('join')]],
  ['torus-cylinder-tangent-outer (join)', [tor('a', 14, 4, [0, 0, 0]), cyl('t', 18, 4, [0, 0, -2]), comb('join')]],
  ['box-minus-near-horn-torus R5.2 r5 (cut)', [box('a', 40, 40, 40, [0, 0, 0]), tor('t', 5.2, 5, [0, 0, 0]), comb('cut')]],
  ['box-keep-near-horn-torus R5.2 r5 (intersect)', [box('a', 40, 40, 40, [0, 0, 0]), tor('t', 5.2, 5, [0, 0, 0]), comb('intersect')]],
  ['box-minus-torus-R14r4-tangent-to-box-face (cut)', [box('a', 36, 40, 40, [0, 0, 0]), tor('t', 14, 4, [0, 0, 0]), comb('cut')]],
  ['torus-minus-box-face-tangent-top (cut)', [tor('a', 14, 4, [0, 0, 0]), box('t', 60, 60, 20, [0, 0, 14]), comb('cut')]],
];
const out = [];
for (const [name, cmds] of P) {
  const r = runRaw(cmds, { timeoutS: TO });
  const row = { probe: name, ok: r.ok, trap: !!r.trap, hang: !!r.hang, ms: r.ms ?? null, wallS: r.wallS, error: r.error ?? r.failed?.error ?? r.note, volume: r.ok ? r.bodies.map((b) => `${b.name}=${b.volume.toFixed(3)} shells=${b.shells}`).join(' ') : undefined };
  out.push(row); console.log(JSON.stringify(row).slice(0, 330));
}
writeFileSync(path.resolve(arg('out', path.join(HERE, 'booleans-r2', 'trap-probe.json'))), JSON.stringify(out, null, 1));
