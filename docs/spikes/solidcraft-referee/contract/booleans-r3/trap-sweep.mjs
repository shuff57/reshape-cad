#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Raw SolidCraft: the one REAL wasm trap found by trap-hunt.mjs was keep() of two equal cylinders offset by 1e-7 mm. How wide is the class?
// Pairs of EQUAL round shapes (cylinder, sphere) and equal boxes, offset by eps along x, for join / cut / keep. Each probe in a child process (hard timeout). Prints one line per probe:
// ok(volume, bodies) | refused(text) | TRAP(text) | HANG. Also: does the SAME instance still build a box after the trap?
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r3/trap-sweep.mjs [--out=booleans-r3/trap-sweep.json]
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
const comb = (target, tools, operation) => ({ command: 'solid.combine', params: { target, tools, operation } });
const EPS = [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
const OPS = { join: 'join', cut: 'cut', keep: 'intersect' };
const MAKE = {
  'cylinder': (e) => [cyl('a', 5, 10), cyl('t', 5, 10, [e, 0, 0])],
  'sphere': (e) => [sph('a', 8), sph('t', 8, [e, 0, 0])],
  'box': (e) => [box('a', 10, 10, 10), box('t', 10, 10, 10, [e, 0, 0])],
  'cylinder-in-box': (e) => [box('a', 10, 10, 10), cyl('t', 5 + e, 10, [0, 0, -5])],
};
const probes = [];
for (const [k, mk] of Object.entries(MAKE)) for (const e of EPS) for (const [on, o] of Object.entries(OPS)) probes.push({ id: `${k}-${on}-${e}`, cmds: [...mk(e), comb('a', ['t'], o)] });
const one = (id) => {
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const run = (c) => JSON.parse(sc.run(JSON.stringify({ commands: c })));
  const p = probes.find((x) => x.id === id); const out = { id }; const t0 = Date.now();
  try { const r = run(p.cmds); out.result = r.ok ? { ok: true, bodies: r.measure.bodies.map((b) => [b.name, +b.volume_mm3.toPrecision(9), b.faces]) } : { ok: false, error: String(r.failed?.error ?? r.error).slice(0, 160) }; }
  catch (e) { out.trap = String(e.message).slice(0, 120); try { const r = run([box('z', 2, 3, 4)]); out.after = r.ok ? 'box ok' : 'box NOT ok'; } catch (e2) { out.after = 'THREW ' + String(e2.message).slice(0, 80); } }
  out.ms = Date.now() - t0; console.log('@@ONE@@' + JSON.stringify(out));
};
if (arg('one')) { one(arg('one')); process.exit(0); }
const rows = [];
for (const p of probes) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--one=${p.id}`], { encoding: 'utf8', timeout: 60000, env: process.env, maxBuffer: 1 << 26 });
  const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@ONE@@')).pop();
  const row = line ? JSON.parse(line.slice(7)) : { id: p.id, hang: true };
  rows.push(row);
  console.log(p.id.padEnd(30), row.trap ? `TRAP after:${row.after}` : row.hang ? 'HANG' : row.result?.ok ? `ok ${JSON.stringify(row.result.bodies)} ${row.ms}ms` : `refused ${row.result?.error}`);
}
writeFileSync(path.resolve(arg('out', path.join(HERE, 'trap-sweep.json'))), JSON.stringify(rows, null, 1));
