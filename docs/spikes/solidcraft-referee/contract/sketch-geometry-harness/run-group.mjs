// usage: bun run-group.mjs <cases-module> [--only=substr] [--out=file.json]
import { writeFileSync } from 'node:fs';
import { measureCase, brief } from './sg-core.mjs';
const mod = await import(new URL(process.argv[2], import.meta.url).href);
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only');
const out = arg('out') || process.argv[2].replace(/\.mjs$/, '.json');
const rows = [];
for (const c of mod.cases) {
  if (only && !c.id.includes(only)) continue;
  let r;
  try {
    r = c.custom ? await c.custom() : await measureCase(c);
    r.id ??= c.id; r.feature ??= c.feature;
  } catch (e) { r = { id: c.id, feature: c.feature, outcome: 'HARNESS-ERROR', error: String(e.stack ?? e).split('\n').slice(0, 4).join(' | ') }; }
  rows.push(r);
  console.error(r.custom ? `${r.id}: ${JSON.stringify(r.summary ?? r.outcome).slice(0, 500)}` : brief(r).slice(0, 700));
}
writeFileSync(out, JSON.stringify(rows, null, 1));
console.error('wrote', out, rows.length);
