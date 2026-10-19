// Negative controls for the two draft guards on the steep/non-convex cases: which guard catches which wrong draft.
//   run the runner three times on the steep groups (output dirs A, B, C), then:
//   bun shell-draft-negctl.mjs <both.partial.json> <sweep-only.partial.json (SD_OFF=G-REACH)> <reach-only.partial.json (SD_OFF=G-SWEEP)>  > shell-draft-negctl.json
import { readFileSync } from 'node:fs';
const load = (p) => Object.fromEntries(JSON.parse(readFileSync(p, 'utf8')).rows.map((r) => [r.id, r]));
const [both, sweepOnly, reachOnly] = process.argv.slice(2).map(load);
const out = { cases: 0, noFit: 0, fit: 0, noFitCaught: { both: 0, sweepOnly: 0, reachOnly: 0, either: 0, neither: [] }, fitRefusedBy: { sweepOnly: [], reachOnly: [], both: [] }, builtWrongWithBothOn: [] };
for (const id of Object.keys(both)) {
  const b = both[id]; if (!b.closed) continue;
  out.cases++;
  const refused = (x) => !!x.guard?.refused;
  if (b.closed.vanish) {
    out.noFit++;
    const s = refused(sweepOnly[id]), r = refused(reachOnly[id]);
    if (s) out.noFitCaught.sweepOnly++; if (r) out.noFitCaught.reachOnly++; if (s && r) out.noFitCaught.both++;
    if (s || r) out.noFitCaught.either++; else out.noFitCaught.neither.push(id);
    if (!refused(b)) out.builtWrongWithBothOn.push(id);
  } else {
    out.fit++;
    const s = refused(sweepOnly[id]), r = refused(reachOnly[id]);
    if (s) out.fitRefusedBy.sweepOnly.push(id); if (r) out.fitRefusedBy.reachOnly.push(id); if (s && r) out.fitRefusedBy.both.push(id);
  }
}
const miss = (m, label) => Object.keys(m).filter((id) => both[id]?.closed?.vanish && !m[id].guard?.refused);
out.sweepAloneMisses = miss(sweepOnly); out.reachAloneMisses = miss(reachOnly);
console.log(JSON.stringify(out, null, 1));
