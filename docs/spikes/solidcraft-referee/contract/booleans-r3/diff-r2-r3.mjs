#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Case-by-case difference between the round-2 guarded run (booleans-r2/guarded) and the round-3 guarded run (booleans-r3/guarded):
// every case whose classified status or refusal sentence changed. A change that is not explained by a round-3 fix is a regression.
//   bun contract/booleans-r3/diff-r2-r3.mjs > booleans-r3/diff-r2-r3.txt
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../bool-classify-lib.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.join(HERE, '..');
const load = (d) => { const m = new Map(); const dir = path.join(d, 'cases'); if (existsSync(dir)) for (const f of readdirSync(dir)) { const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); m.set(r.id, r); } return m; };
const a = load(path.join(ROOT, 'booleans-r2', 'guarded')); const b = load(path.join(HERE, 'guarded'));
let n = 0, same = 0;
for (const [id, rb] of b) {
  const ra = a.get(id); if (!ra) continue;
  const ca = classify(ra); const cb = classify(rb);
  if (ca.status === cb.status && (ca.sentence ?? '') === (cb.sentence ?? '')) { same++; continue; }
  n++;
  console.log(`${id}: ${ca.status}${ca.sentence ? ` "${ca.sentence.slice(0, 90)}"` : ''}  ->  ${cb.status}${cb.sentence ? ` "${cb.sentence.slice(0, 90)}"` : ''}`);
}
console.log(`\n${same} cases unchanged, ${n} changed (of ${[...b.keys()].filter((id) => a.has(id)).length} present in both)`);
