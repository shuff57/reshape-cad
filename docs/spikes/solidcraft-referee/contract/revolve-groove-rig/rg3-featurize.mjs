#!/usr/bin/env node
// Features-only pass over a case list: runs the guard on every groove WITHOUT computing the cut (see rg3-lib featuresOnly) and prints/writes the cost features.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg3-featurize.mjs [--cases=./rg-cases.mjs (default: the built-in 328-case list)] --out=<file.json>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { init } from './rg3-lib.mjs';
import { REPO } from './rg3-lib.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const L = await init({});
let cases;
if (arg('cases')) cases = (await import(pathToFileURL(path.resolve(HERE, arg('cases'))).href)).cases;
else {
  const RG = path.join(REPO, 'docs', 'replica', 'freecad', 'gauntlet');
  const { VARIANTS } = await import(pathToFileURL(path.join(RG, 'variants/defs.mjs')).href);
  const { allCases } = await import('./rg-cases.mjs');
  cases = allCases(RG, VARIANTS);
}
const out = [];
for (const c of cases) {
  if (!/groove\(/.test(c.src)) continue;
  const r = await L.run(c.src, { featuresOnly: true });
  if (r.scriptErrors) { out.push({ id: c.id, scriptErrors: r.scriptErrors }); continue; }
  const gs = r.features.filter((f) => f.kind === 'groove');
  out.push({ id: c.id, grooves: gs.map((f) => ({ id: f.id, status: f.status, cost: f.guard?.cost ?? null, refusal: f.refusal ?? null })) });
}
if (arg('out')) writeFileSync(arg('out'), JSON.stringify(out, null, 1)); else console.log(JSON.stringify(out));
console.error(`${out.length} groove cases featurized`);
