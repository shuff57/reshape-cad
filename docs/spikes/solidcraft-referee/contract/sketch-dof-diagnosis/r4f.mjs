// ROUND 4 section F: reference (driving:false) and inactive (active:false) rules in a rows-and-rules sketch, raw vs guard, STOCK pkg.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/sketch-dof-diagnosis/r4f.mjs   (writes r4f.json)
import { writeFileSync } from 'node:fs';
import * as R from './r4-lib.mjs';
import { guardedSoup, rawBuild, plainProblems } from './soup-guard2.mjs';

const { e2, H } = R;
const geoms = R.rect(0, 0, 30, 20);
const base = [...R.shape(), { k: 'lock', a: 1, aEnd: 'a' }, R.len(1, 30), R.len(2, 20)];
const want = 30 * 20 * H;
const cases = [
  ['control: no extra rule', []],
  ['reference length(3) = 30 (equal to what the others fix)', [{ ...R.len(3, 30), driving: false }]],
  ['reference length(3) = 99 (a value the sketch can NOT have; a reference only measures)', [{ ...R.len(3, 99), driving: false }]],
  ['reference distanceX(1a,1b) = -5 (wrong sign and size, reference)', [{ k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: -5, driving: false }]],
  ['inactive length(3) = 99 (active:false)', [{ ...R.len(3, 99), active: false }]],
  ['inactive horizontal(2) (active:false; would collapse the part if it were on)', [{ k: 'horizontal', a: 2, active: false }]],
  ['driving length(3) = 99 (control: this one must conflict)', [R.len(3, 99)]],
];
const out = { want, rows: [] };
for (const [name, extra] of cases) {
  const rules = [...base, ...extra];
  const raw = rawBuild(geoms, rules); const g = guardedSoup(geoms, rules);
  const row = { case: name, raw: raw.status === 'built' ? { status: 'built', volume: e2(raw.volume), relErr: e2(Math.abs(raw.volume - want) / want) } : { status: raw.status, error: (raw.error ?? raw.sentence)?.slice(0, 150) },
    guard: { outcome: g.outcome, stage: g.stage, volume: g.measure && e2(g.measure.volume), relErr: g.measure && e2(Math.abs(g.measure.volume - want) / want), sentence: g.sentence ?? null, problems: g.sentence ? plainProblems(g.sentence) : null } };
  out.rows.push(row); console.log('F', JSON.stringify(row));
}
writeFileSync(new URL('./r4f.json', import.meta.url), JSON.stringify(out, null, 1));
