#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Time of ONE sc.run of a case's final command list (the list the guarded translator accepted, saved as `commands` in booleans-r3/guarded/cases/<id>.json),
// repeated REPEATS times, each in a fresh child process (fresh wasm instance, no warm cache): cpu seconds (process.cpuUsage) and wall seconds, with the load average at the start of each repeat.
// The box is shared (24 cores, load average 5 to 50 from other jobs), and cpu time itself rises with load (SMT and cache contention), so the row reports the MINIMUM over the repeats next to the load it was taken at.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r3/latency.mjs --ids=id,id,.. [--repeats=3] [--out=booleans-r3/latency.json]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
if (arg('one')) {
  const cmds = JSON.parse(readFileSync(arg('one'), 'utf8'));
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const c0 = process.cpuUsage(); const w0 = Date.now();
  const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
  const c1 = process.cpuUsage(c0);
  console.log('@@LAT@@' + JSON.stringify({ ok: r.ok, wallMs: Date.now() - w0, cpuMs: Math.round((c1.user + c1.system) / 1000) }));
  process.exit(0);
}
const ids = arg('ids', '').split(',').filter(Boolean); const repeats = Number(arg('repeats', 3));
const out = existsSync(path.join(HERE, 'latency.json')) ? JSON.parse(readFileSync(path.join(HERE, 'latency.json'), 'utf8')) : {};
for (const id of ids) {
  const f = path.join(HERE, 'guarded', 'cases', `${id}.json`);
  const row = JSON.parse(readFileSync(f, 'utf8'));
  if (!row.commands?.length) { console.log(id, 'no commands'); continue; }
  const tmp = path.join(os.tmpdir(), `lat-${process.pid}-${id}.json`); writeFileSync(tmp, JSON.stringify(row.commands));
  const reps = [];
  for (let i = 0; i < repeats; i++) {
    const load1 = +os.loadavg()[0].toFixed(1);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--one=${tmp}`], { encoding: 'utf8', timeout: 150000, env: process.env, maxBuffer: 1 << 26 });
    const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@LAT@@')).pop();
    reps.push(line ? { ...JSON.parse(line.slice(7)), load1 } : { timeout: true, load1 });
  }
  const done = reps.filter((r) => r.ok);
  const best = done.sort((a, b) => a.cpuMs - b.cpuMs)[0];
  out[id] = { repeats: reps, best: best ?? null };
  console.log(id.padEnd(32), best ? `best cpu ${(best.cpuMs / 1000).toFixed(2)} s, wall ${(best.wallMs / 1000).toFixed(2)} s, load ${best.load1}   (all cpu: ${reps.map((r) => r.cpuMs ?? 'T').join(' ')})` : 'NO RESULT');
}
writeFileSync(path.resolve(arg('out', path.join(HERE, 'latency.json'))), JSON.stringify(out, null, 1));
