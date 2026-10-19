// SPIKE, referee only. ROUND 4: rebuilds ../../fillet-chamfer.json. Inputs: fillet-chamfer.round3.json + fc4-results-*.json + fc4-results-pairfuzz.json + fc4-results-seq-limit.json + fc-sentences-all.json + live-check-results.json.
//   bun live/fc4-make-rows.mjs      (asserts: every refused row has ONE plain sentence, no empty evidence, status vocabulary, counts)
import { writeFileSync } from 'node:fs';
import { rows, OUT, prevFile, recs, scored, SA, LC, PF, SL, count } from './fc4-rows-lib.mjs';
await import('./fc4-rows-w.mjs');
await import('./fc4-rows-e.mjs');
await import('./fc4-rows-g.mjs');
await import('./fc4-rows-x.mjs');
const { buildNotes } = await import('./fc4-notes.mjs');
const counts = {}; for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
for (const r of rows) {
  if (!['supported', 'refused', 'unsupported', 'wrong'].includes(r.status)) throw new Error('bad status ' + r.status);
  if (!r.evidence || r.evidence.length < 40) throw new Error('thin evidence: ' + r.feature);
  if (/undefined|NaN|\(no record/.test(r.evidence)) console.log('WARNING placeholder in evidence of:', r.feature.slice(0, 90), (r.evidence.match(/.{40}(undefined|NaN|\(no record).{40}/) ?? [''])[0]);
}
const out = { group: 'fillet-chamfer', rig: { ...prevFile.rig, round: 4, counts, live: 'live contract path: forked pane translator (grouping + guard + sentences) on the pane wasm via window.__host.bridge, oracles live OCCT / brep-rs / closed forms' }, notes: buildNotes({ counts, rows }), rows };
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT, rows.length, 'rows', JSON.stringify(counts));
