// Merge two or more summaries of the same group replay into one, so a phase that was cut by its
// wall timeout can resume with `--only=<ids not yet in the rows>` instead of starting over.
//
//   node test/merge-live-replay.mjs OUT.json FIRST.json SECOND.json ...
//
// The inputs are the group summaries (patterns-mirror, booleans, revolve-groove, fillet-chamfer):
// rows are concatenated in order, counters are summed, `partial` is cleared. Case ids must not
// repeat across inputs (a resumed run passes only the ids missing from the first part). The
// unified summary has array counters and is not merged here.
import { readFileSync, writeFileSync } from 'node:fs';

const [out, ...ins] = process.argv.slice(2);
if (!out || ins.length < 1) {
  console.error('usage: node merge-live-replay.mjs OUT.json FIRST.json SECOND.json [...]');
  process.exit(2);
}

const parts = ins.map((f) => {
  try {
    return { file: f, json: JSON.parse(readFileSync(f, 'utf8')) };
  } catch (e) {
    console.error(`cannot read ${f}: ${e.message}`);
    process.exit(2);
  }
});

const seen = new Set();
const rows = [];
for (const { file, json } of parts) {
  if (!Array.isArray(json.rows)) {
    console.error(`${file}: no rows array (is this a unified summary? those are not merged here)`);
    process.exit(2);
  }
  for (const r of json.rows) {
    if (r && r.id !== undefined) {
      if (seen.has(r.id)) {
        console.error(`${file}: duplicate case id ${r.id}; a resumed run must pass only the missing ids`);
        process.exit(2);
      }
      seen.add(r.id);
    }
    rows.push(r);
  }
}

const sum = (k) => parts.reduce((n, p) => n + (typeof p.json[k] === 'number' ? p.json[k] : 0), 0);
const flaky = sum('flakyRetried') + sum('flaky');
const merged = {
  pkg: parts[0].json.pkg ?? null,
  // Every group summary defines cases as the runs that produced a same/differ row (skips, exclusions
  // and hangs are counted separately), and the partial writer omits the field. Recompute, do not sum.
  same: sum('same'),
  differ: sum('differ'),
  flakyRetried: flaky,
  noDoc: sum('noDoc'),
  excluded: sum('excluded'),
  skippedLarge: sum('skippedLarge'),
  hangOrCrash: sum('hangOrCrash'),
  builtWrong: sum('builtWrong'),
  wallS: sum('wallS'),
  mergedFrom: parts.map((p) => p.file),
  partial: false,
  rows,
};
merged.cases = merged.same + merged.differ;

writeFileSync(out, JSON.stringify(merged, null, 1));
console.log(`merged ${parts.length} part(s), ${rows.length} rows, cases=${merged.cases}, same=${merged.same}, differ=${merged.differ}, hang=${merged.hangOrCrash}, builtWrong=${merged.builtWrong}`);
process.exit(merged.differ || merged.hangOrCrash || merged.builtWrong ? 1 : 0);
