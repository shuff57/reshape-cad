#!/usr/bin/env node
// Merge the per-case result files of an rg-batch.sh output directory into one array: bun rg-merge.mjs <dir> <out.json>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [dir, out] = process.argv.slice(2);
const all = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) all.push(...JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
writeFileSync(out, JSON.stringify(all, null, 1));
console.log(all.length, 'cases ->', out);
