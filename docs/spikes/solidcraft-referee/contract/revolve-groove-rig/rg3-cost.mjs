#!/usr/bin/env node
// Cost driver: runs each case of a cases module in its OWN child process (rg3-cost-child.mjs) with a wall-clock kill, truck only, and appends one record per case.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> RG_OFF=G8 systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun rg3-cost.mjs --cases=./cases-r3-cost.mjs --out=<file.json> [--timeout=120] [--only=id,id|prefix*] [--tr=g0] [--resume=1]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const mod = await import(pathToFileURL(path.resolve(HERE, arg('cases'))).href);
const cases = mod.cases;
const out = path.resolve(arg('out', 'rg3-cost.json'));
const timeout = Number(arg('timeout', 120)) * 1000;
const only = arg('only').split(',').filter(Boolean);
const match = (id) => !only.length || only.some((o) => (o.endsWith('*') ? id.startsWith(o.slice(0, -1)) : id === o));
const results = arg('resume') && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
const done = new Set(results.map((r) => r.id));
for (const c of cases) {
  if (!match(c.id) || done.has(c.id)) continue;
  const tmp = `${out}.${process.pid}.tmp`;
  const t0 = Date.now();
  const p = Bun.spawnSync(['bun', path.join(HERE, 'rg3-cost-child.mjs'), `--src=${c.src}`, `--tr=${arg('tr', 'g0')}`, `--out=${tmp}`], { env: process.env, timeout, killSignal: 'SIGKILL', stdout: 'pipe', stderr: 'pipe' });
  const wall = Date.now() - t0;
  let rec;
  if (existsSync(tmp)) { rec = JSON.parse(readFileSync(tmp, 'utf8')); try { Bun.spawnSync(['rm', '-f', tmp]); } catch { /* */ } }
  else rec = { status: wall >= timeout - 500 ? 'TIMEOUT' : 'CRASH', timeoutS: timeout / 1000, stderr: String(p.stderr ?? '').slice(0, 300) };
  rec = { id: c.id, src: c.src, tag: c.tag ?? null, wallS: +(wall / 1000).toFixed(1), ...rec };
  results.push(rec);
  writeFileSync(out, JSON.stringify(results, null, 1));
  console.log(c.id.padEnd(46), String(rec.status).padEnd(8), rec.cpuMs != null ? `cpu ${(rec.cpuMs / 1000).toFixed(1)}s` : '', `wall ${rec.wallS}s`, rec.cost ? `${rec.cost.tool}${rec.cost.partial ? '/partial' : '/full'} curved=${rec.cost.curved} reach=${rec.cost.reachesWall}` : '', rec.refusal ? '| ' + String(rec.refusal).replace(/^[a-z0-9]+ \(\w+\): /, '').slice(0, 70) : '');
}
