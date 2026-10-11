// Sum the per-shard summaries written by step-sweep-all.sh: node step-sweep-sum.mjs OUTDIR
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const by = {}; const reasons = {};
for (const f of readdirSync(dir).filter((x) => x.startsWith('sum-'))) {
  const t = readFileSync(path.join(dir, f), 'utf8').trim();
  if (!t) continue;
  const j = JSON.parse(t);
  const k = j.family;
  const a = (by[k] ??= { built: 0, curved: 0, ok: 0, wrong: 0, refused: 0, buildRefused: 0, scriptError: 0 });
  for (const x of Object.keys(a)) a[x] += j[x];
  for (const [r, n] of Object.entries(j.refusalReasons)) reasons[r] = (reasons[r] ?? 0) + n;
}
console.table(by);
console.log(reasons);
