#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Raw SolidCraft, no translator: try to provoke a REAL wasm trap (a RuntimeError thrown out of sc.run) so that the "trap" row can be measured
// instead of designed: (a) is it catchable, (b) does the SAME wasm instance still work afterwards (a poisoned instance would need a fresh Worker), (c) what the error text is.
// Round 2 could not reproduce the trap the critic saw on torus booleans, so this tries other ways: absurd numbers, NaN-like input, huge counts (allocation failure aborts a wasm module),
// deep nesting, and bad names, each in a CHILD process (hard timeout) so a hang or an out-of-memory kill cannot take the harness down.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r3/trap-hunt.mjs [--out=booleans-r3/trap-hunt.json]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const box = (n, l, w, h, c = [0, 0, 0]) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const cyl = (n, r, h, base = [0, 0, 0]) => ({ command: 'solid.cylinder', params: { radius: r, height: h, base, axis: 'Z', body_name: n } });
const sph = (n, r, c = [0, 0, 0]) => ({ command: 'solid.sphere', params: { radius: r, center: c, body_name: n } });
const comb = (target, tools, operation, extra = {}) => ({ command: 'solid.combine', params: { target, tools, operation, ...extra } });
const PROBES = {
  'huge-box-cut': [box('a', 1e300, 1e300, 1e300), box('t', 1e-300, 1, 1), comb('a', ['t'], 'cut')],
  'huge-sphere-cut-sphere': [sph('a', 1e12), sph('t', 1e12, [1, 0, 0]), comb('a', ['t'], 'cut')],
  'tiny-sphere-cut-sphere': [sph('a', 1e-9), sph('t', 1e-9, [1e-10, 0, 0]), comb('a', ['t'], 'cut')],
  'nan-radius': [{ command: 'solid.sphere', params: { radius: 'NaN', center: [0, 0, 0], body_name: 'a' } }],
  'null-center': [{ command: 'solid.sphere', params: { radius: 5, center: [null, 0, 0], body_name: 'a' } }],
  'negative-box': [box('a', -5, 5, 5), box('t', 5, 5, 5), comb('a', ['t'], 'cut')],
  'pattern-2e6': [box('a', 1, 1, 1), { command: 'solid.pattern.rectangular', params: { bodies: ['a'], dir1: [1, 0, 0], count1: 2000000, spacing1: 2 } }],
  'pattern-4e4-cut': [box('a', 100, 100, 100), cyl('t', 1, 200, [0, 0, -100]), { command: 'solid.pattern.rectangular', params: { bodies: ['t'], dir1: [1, 0, 0], count1: 40000, spacing1: 0.002 } }, comb('a', ['t'], 'cut')],
  'combine-unknown-tool': [box('a', 5, 5, 5), comb('a', ['nope'], 'cut')],
  'combine-self': [box('a', 5, 5, 5), comb('a', ['a'], 'join')],
  'combine-empty-tools': [box('a', 5, 5, 5), comb('a', [], 'join')],
  'sphere-cut-sphere-same': [sph('a', 10), sph('t', 10), comb('a', ['t'], 'cut')],
  'sphere-join-sphere-same-r': [sph('a', 10), sph('t', 10, [1e-9, 0, 0]), comb('a', ['t'], 'join')],
  'cyl-cut-cyl-same': [cyl('a', 5, 10), cyl('t', 5, 10), comb('a', ['t'], 'cut')],
  'cyl-keep-cyl-offset-eps': [cyl('a', 5, 10), cyl('t', 5, 10, [1e-7, 0, 0]), comb('a', ['t'], 'intersect')],
};
const one = (name) => {
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
  const t0 = Date.now(); const out = { name };
  try { const r = run(PROBES[name]); out.result = r.ok ? { ok: true, bodies: r.measure.bodies.map((b) => [b.name, +b.volume_mm3.toPrecision(8)]) } : { ok: false, error: String(r.failed?.error ?? r.error).slice(0, 200) }; }
  catch (e) { out.threw = { type: e.constructor.name, message: String(e.message).slice(0, 200), isRuntimeError: e instanceof WebAssembly.RuntimeError }; }
  out.ms = Date.now() - t0;
  // the SAME instance afterwards: does a plain box still build?
  try { const r = run([box('z', 2, 3, 4)]); out.afterOnSameInstance = r.ok ? `ok volume ${r.measure.bodies[0].volume_mm3}` : `NOT ok: ${JSON.stringify(r.failed ?? r.error).slice(0, 150)}`; }
  catch (e) { out.afterOnSameInstance = `THREW ${e.constructor.name}: ${String(e.message).slice(0, 150)}`; }
  console.log('@@ONE@@' + JSON.stringify(out));
};
if (arg('one')) { one(arg('one')); process.exit(0); }
const rows = [];
for (const name of Object.keys(PROBES)) {
  const r = spawnSync('systemd-run', ['--user', '--scope', '-q', '-p', 'MemoryMax=16G', '-p', 'MemorySwapMax=0', 'env', `SOLIDCRAFT_REFEREE_PKG=${process.env.SOLIDCRAFT_REFEREE_PKG}`, process.execPath, fileURLToPath(import.meta.url), `--one=${name}`], { encoding: 'utf8', timeout: 90000, maxBuffer: 1 << 26 });
  const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@ONE@@')).pop();
  const row = line ? JSON.parse(line.slice(7)) : { name, noResult: true, signal: r.signal, status: r.status, stderr: (r.stderr ?? '').slice(-300) };
  rows.push(row);
  console.log(name.padEnd(28), JSON.stringify(row).slice(0, 330));
}
writeFileSync(path.resolve(arg('out', path.join(HERE, 'trap-hunt.json'))), JSON.stringify(rows, null, 1));
