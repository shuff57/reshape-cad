#!/usr/bin/env node
// Merge the per-case json files of an rg3-batch.sh output dir into one array file; ids without a json (killed at the timeout) become {id, timeout:true}.
//   bun rg3-merge.mjs <outdir> <merged.json> [<id list file>]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
const [dir, out, idsFile] = process.argv.slice(2);
const ids = idsFile ? readFileSync(idsFile, 'utf8').split(/\s+/).filter(Boolean) : readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const rows = [];
for (const id of ids) { const f = path.join(dir, `${id}.json`); if (existsSync(f)) rows.push(...JSON.parse(readFileSync(f, 'utf8'))); else rows.push({ id, timeout: true }); }
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`${rows.length} rows, ${rows.filter((r) => r.timeout).length} timed out`);
