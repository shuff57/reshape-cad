// mkdrop.mjs <full run dir> <out dir> <corpus>...: from a sweep of the cases as written (hr-<corpus>.jsonl), the DROP_FILE that cuts each case down to
// the steps that were built: { case id: [ids of the steps that were not built] }. Run the sweep again with DROP_FILE and POP_SKETCHES=1 to score what
// each case builds. A case that hung or crashed has no entry (and is skipped by the second run); one that builds nothing is counted.
import fs from 'node:fs';
const [FULL, OUT, ...CS] = process.argv.slice(2);
for (const c of CS) {
  const out = {}; let empty = 0, none = 0;
  for (const l of fs.readFileSync(`${FULL}/hr-${c}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); if (!r.feats) { none++; continue; }
    const gone = r.feats.filter((f) => f.status === 'refused').map((f) => f.id);
    out[r.id] = gone; if (!r.feats.some((f) => f.status !== 'refused' && f.kind !== 'sketch')) empty++;
  }
  fs.writeFileSync(`${OUT}/drop-${c}.json`, JSON.stringify(out));
  console.log(`${c}: ${Object.keys(out).length} cases, ${empty} build nothing, ${none} without a result (hang or crash)`);
}
