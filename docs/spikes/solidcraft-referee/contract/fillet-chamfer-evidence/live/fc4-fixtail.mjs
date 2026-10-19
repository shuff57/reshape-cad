// SPIKE, referee only. Older result files hold an OCCT simultaneous number even for documents where other features FOLLOW the blends (shell, move, turn, draft, hole): that number covers only the blends, so it is not a truth for
// the whole document. Marks rec.oracle.occtSim.notTail = true for those records (fc4-score.mjs then falls back to OCCT sequential / brep-rs on the full document).
//   bun live/fc4-fixtail.mjs ../fc4-results-regress.json [...]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runViaBundle } from '../../../phase7/bundle-run.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
for (const f of process.argv.slice(2).filter((a) => a.endsWith('.json'))) {
  const file = path.resolve(HERE, f); const recs = JSON.parse(readFileSync(file, 'utf8')); let n = 0;
  for (const rec of recs) {
    if (rec.tailOnlyBlends !== undefined && !(rec.oracle?.occtSim && rec.oracle.occtSim.notTail === undefined && rec.tailOnlyBlends === false)) continue;
    let feats = null;
    try { feats = rec.script && !rec.script.startsWith('[') ? runViaBundle(rec.script).doc.features : rec.script ? JSON.parse(rec.script) : null; } catch { /* leave */ }
    if (!feats) continue;
    const i = feats.findIndex((x) => x.kind === 'fillet');
    const tail = i >= 0 && feats.slice(i).every((x) => x.kind === 'fillet');
    rec.tailOnlyBlends = tail;
    if (!tail && rec.oracle?.occtSim && !rec.oracle.occtSim.notTail) { rec.oracle.occtSim = { notTail: true, was: rec.oracle.occtSim }; n++; }
  }
  writeFileSync(file, JSON.stringify(recs, null, 1)); console.log(f, 'occtSim withdrawn on', n, 'records (blends not at the end of the document)');
}
