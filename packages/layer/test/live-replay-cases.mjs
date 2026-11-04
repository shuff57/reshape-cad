// Case bookkeeping for the three child-per-case group replays (booleans, revolve-groove,
// fillet-chamfer), whose parent writes one row per case into OUT/cases/<id>.json.
//
//   node test/live-replay-cases.mjs remaining IDS.json CASES_DIR    # ids not yet on disk (comma)
//   node test/live-replay-cases.mjs summary CASES_DIR OUT.json      # rebuild the phase summary
//
// IDs.json is the `--ids-out` list the replay writes (a JSON array). The summary is rebuilt from
// the row files, so a phase that took several attempts (each cut by its wall timeout) ends with one
// honest result instead of only the last chunk's. Counters follow the parent scripts: cases is
// same + differ; exclusions, front-door skips, hangs and built-wrong rows are counted separately.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [mode, a, b] = process.argv.slice(2);
const fileFor = (dir, id) => {
  const raw = path.join(dir, `${id}.json`);
  if (existsSync(raw)) return raw;
  // rg and fc sanitize ids for the filename; bool does not.
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(dir, `${safe}.json`);
};

if (mode === 'remaining') {
  const ids = JSON.parse(readFileSync(a, 'utf8'));
  const dir = b;
  const left = [];
  for (const id of ids) if (!existsSync(fileFor(dir, id))) left.push(id);
  process.stdout.write(left.join(','));
  process.exit(0);
}

if (mode === 'summary') {
  const dir = a;
  const out = b;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const rows = [];
  for (const f of files) {
    try { rows.push(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))); } catch { /* a half-written file at the cut */ }
  }
  let same = 0, differ = 0, excluded = 0, skipped = 0, hang = 0, wrong = 0, missing = 0, retried = 0;
  for (const r of rows) {
    if (r.retried) retried++;
    if (r.missingMeasure) { missing++; continue; }
    if (r.same === true) same++;
    else if (r.same === false) differ++;
    else if (r.excluded) excluded++;
    else if (r.skipped) skipped++;
    else if (r.hang || r.crashed) hang++;
    if (r.score?.builtWrong) wrong++;
  }
  const summary = {
    pkg: null,
    cases: same + differ,
    same,
    differ,
    flakyRetried: retried,
    noDoc: skipped,
    excluded,
    skippedLarge: 0,
    hangOrCrash: hang,
    builtWrong: wrong,
    missingMeasure: missing,
    rebuiltFromCases: dir,
    rows,
    partial: process.argv.includes('--partial'),
  };
  writeFileSync(out, JSON.stringify(summary, null, 1));
  const bad = differ || hang || wrong;
  console.log(`RESULT status=${bad ? 'FAIL' : 'PASS'} cases=${summary.cases} same=${same} differ=${differ} hang=${hang} builtWrong=${wrong}${missing ? ` missingMeasure=${missing}` : ''}`);
  process.exit(bad ? 1 : 0);
}

console.error('usage: live-replay-cases.mjs remaining IDS.json CASES_DIR | summary CASES_DIR OUT.json');
process.exit(2);
