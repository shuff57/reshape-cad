// Verdict for one live-replay summary. Used by run-live-replays.sh; prints one line and exits
// 0 pass, 1 findings, 2 incomplete/unreadable.
//
// The summaries have two shapes: the group replays (patterns-mirror, booleans, revolve-groove,
// fillet-chamfer) count `differ`, `hangOrCrash` and `builtWrong`; the unified replay lists
// `differ` and `unifiedBuiltWhereASetRefused` arrays. A partial file (written every 10 docs) is
// never a verdict.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.log('RESULT status=NO-SUMMARY cases=0 same=0 differ=0 hang=0 builtWrong=0');
  process.exit(2);
}

let j;
try {
  j = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.log(`RESULT status=NO-SUMMARY cases=0 same=0 differ=0 hang=0 builtWrong=0 error=${e.message.replace(/\s+/g, ' ')}`);
  process.exit(2);
}

if (j.partial === true) {
  console.log(`RESULT status=INCOMPLETE cases=${j.cases ?? 0} same=${j.same ?? 0} differ=${j.differ ?? 0} hang=0 builtWrong=0`);
  process.exit(2);
}

const differ = Array.isArray(j.differ) ? j.differ.length : (j.differ ?? 0);
const violated = Array.isArray(j.unifiedBuiltWhereASetRefused) ? j.unifiedBuiltWhereASetRefused.length : 0;
const hang = j.hangOrCrash ?? 0;
const builtWrong = j.builtWrong ?? 0;
const cases = j.cases ?? j.docs ?? 0;
const same = j.same ?? j.equal ?? 0;

const fail = differ > 0 || violated > 0 || hang > 0 || builtWrong > 0;
const status = fail ? 'FAIL' : 'PASS';
const extra = violated ? ` unifiedViolations=${violated}` : '';
console.log(`RESULT status=${status} cases=${cases} same=${same} differ=${differ} hang=${hang} builtWrong=${builtWrong}${extra}`);
process.exit(fail ? 1 : 0);
