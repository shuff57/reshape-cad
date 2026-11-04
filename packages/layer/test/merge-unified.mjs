// Bookkeeping for the unified replay, whose summary is one `rows` array plus counters.
//
//   node test/merge-unified.mjs skip  SUMMARY.json SKIP.json
//   node test/merge-unified.mjs merge OUT.json BASE.json PART.json [--partial]
//   node test/merge-unified.mjs final SUMMARY.json
//
// `skip` writes the {corpus,id} pairs already in a summary, for the replay's --skip=.
// `merge` concatenates the rows of a base and a new attempt (the attempt was run with that skip
// list, so the two are disjoint), sums the counters the rows cannot carry, and refuses a duplicate
// pair. `final` rewrites one summary with partial:false.
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, a, b, ...rest] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

if (mode === 'skip') {
  const j = read(a);
  const pairs = (j.rows ?? []).map((r) => ({ corpus: r.corpus, id: r.id }));
  writeFileSync(b, JSON.stringify(pairs));
  console.log(`${pairs.length} completed pair(s)`);
  process.exit(0);
}

if (mode === 'final') {
  const j = read(a);
  j.partial = false;
  writeFileSync(a, JSON.stringify(j, null, 1));
  console.log(`final: docs=${j.docs} differ=${(j.differ ?? []).length} violated=${(j.unifiedBuiltWhereASetRefused ?? []).length}`);
  process.exit(0);
}

if (mode === 'merge') {
  const out = a;
  const parts = [b, ...rest.filter((x) => x !== '--partial')].map(read);
  const partial = rest.includes('--partial');
  const seen = new Set();
  const rows = [];
  for (const p of parts) {
    for (const r of p.rows ?? []) {
      const key = `${r.corpus}\u0000${r.id}`;
      if (seen.has(key)) {
        console.error(`duplicate case in the merge: ${r.corpus} / ${r.id}`);
        process.exit(2);
      }
      seen.add(key);
      rows.push(r);
    }
  }
  const sum = (k) => parts.reduce((n, p) => n + (Number(p[k]) || 0), 0);
  const cat = (k) => parts.flatMap((p) => p[k] ?? []);
  const merged = {
    partial,
    pkg: parts[0]?.pkg ?? null,
    docs: sum('docs'),
    inDomain: sum('inDomain'),
    equal: sum('equal'),
    equalAfterRerun: sum('equalAfterRerun'),
    differ: cat('differ'),
    acceptedException: cat('acceptedException'),
    mixed: sum('mixed'),
    binding: sum('binding'),
    unifiedBuiltWhereASetRefused: cat('unifiedBuiltWhereASetRefused'),
    literalBuiltWhereASetRefused: sum('literalBuiltWhereASetRefused'),
    combinedBuilt: sum('combinedBuilt'),
    threw: sum('threw'),
    mergedFrom: parts.map((p) => p.pkg).filter(Boolean),
    rows,
  };
  writeFileSync(out, JSON.stringify(merged, null, 1));
  console.log(`merged ${parts.length} part(s), ${rows.length} rows, docs=${merged.docs}, differ=${merged.differ.length}, violated=${merged.unifiedBuiltWhereASetRefused.length}, partial=${partial}`);
  process.exit(0);
}

console.error('usage: merge-unified.mjs skip SUMMARY OUT | merge OUT BASE PART [--partial] | final SUMMARY');
process.exit(2);
