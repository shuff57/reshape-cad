// SPIKE, referee only. Adds rec.base ({volume, faces, bbox} of the part BEFORE the first blend, live OCCT) to result files written by an older fc4-run.mjs, so that fc4-score.mjs can apply its
// oracle-free invariant (a blend never moves the bounding box of the part it is applied to).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun live/fc4-addbase.mjs ../fc4-results-a.json [...]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runViaBundle } from '../../../phase7/bundle-run.mjs';
import { occtBase, occtMeasure, firstBlend } from './fc-oracle.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
for (const f of process.argv.slice(2).filter((a) => a.endsWith('.json'))) {
  const file = path.resolve(HERE, f); const recs = JSON.parse(readFileSync(file, 'utf8')); let n = 0;
  for (const rec of recs) {
    if (rec.base || !rec.script || rec.scriptError) continue;
    try { const { doc, errors } = runViaBundle(rec.script); if (errors.length || firstBlend(doc) < 0) continue; const m = occtMeasure(occtBase(doc).shape); rec.base = { volume: m.volume, faces: m.faces, bbox: m.bbox }; n++; } catch (e) { rec.base = { error: String(e.message).slice(0, 80) }; }
  }
  writeFileSync(file, JSON.stringify(recs, null, 1)); console.log(f, 'base added to', n);
}
