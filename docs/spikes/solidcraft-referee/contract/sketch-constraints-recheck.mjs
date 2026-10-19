// Round 4 of group 'sketch-constraints': appends the fresh re-measurement (sketch-constraints-r4/out) to the round-3 rows.
//   bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/build-rows.mjs      # rebuilds the round-3 rows from the committed raw data (asserts every status)
//   bun docs/spikes/solidcraft-referee/contract/sketch-constraints-recheck.mjs            # then this: adds the "RE-CHECK r4" evidence and the top-level provenance
// Statuses are NOT changed here. A status is derived by build-rows.mjs from the guarded-route data of round 3; this script only adds what the
// post-reboot rig could re-measure (the shipped, unguarded route against closed form, live brep-rs and live OCCT) and checks that none of it contradicts a status.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const HERE = import.meta.dir;
const F = path.join(HERE, 'sketch-constraints.json');
const R4 = path.join(HERE, 'sketch-constraints-r4/out');
const doc = JSON.parse(readFileSync(F, 'utf8'));
const sweep = JSON.parse(readFileSync(path.join(R4, 'shipped-sweep.json'), 'utf8'));
const xchk = JSON.parse(readFileSync(path.join(R4, 'stored-xcheck.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(path.join(R4, 'remeasure.json'), 'utf8'));
const MARK = ' || RE-CHECK r4:';
const ex = (x) => (typeof x === 'number' ? x.toExponential(1) : String(x));

const casesFor = (feature) => sweep.filter((r) => (r.feats ?? []).some((f) => feature === f || feature.startsWith(f + ' ') || feature.startsWith(f + ':') || (f.startsWith('axis-ref') && feature.startsWith('axis-ref'))));
const tallyOf = (cases, mode) => {
  const t = {}; let n = 0;
  for (const c of cases) { const s = c.starts?.[mode]; if (!s) continue; n += s.n; for (const [k, v] of Object.entries(s.tally)) t[k] = (t[k] ?? 0) + v; }
  return { n, t };
};
const fmtTally = ({ n, t }) => (n ? `${n} runs: ` + Object.entries(t).sort().map(([k, v]) => `${v} ${k.replace('BUILT-', 'built-').replace('REFUSED', 'refused').toLowerCase()}`).join(', ') : 'none');

const log = [];
let touched = 0;
for (const row of doc.rows) {
  row.evidence = String(row.evidence).split(MARK)[0];
  const cases = casesFor(row.feature).filter((c) => c.starts && !c.hang);
  if (!cases.length) continue;
  const built = xchk.filter((x) => cases.some((c) => c.id === x.id) && x.sc?.dClosed !== undefined);
  const wrongStored = cases.filter((c) => (c.starts.stored?.tally?.['BUILT-WRONG-VOLUME'] ?? 0) > 0).map((c) => c.id);
  const st = tallyOf(cases, 'stored'), r35 = tallyOf(cases, 'rough3.5'), r15 = tallyOf(cases, 'rough15');
  const nums = built.length
    ? ` Stored build vs closed form worst ${ex(Math.max(...built.map((x) => x.sc.dClosed)))}${built.some((x) => typeof x.brep?.dVsSc === 'number') ? `, vs live brep-rs worst ${ex(Math.max(...built.filter((x) => typeof x.brep?.dVsSc === 'number').map((x) => x.brep.dVsSc)))} (${built.filter((x) => typeof x.brep?.dVsSc === 'number').length} of ${built.length} referee-able)` : ', brep-rs cannot build any of them'}${built.some((x) => typeof x.occt?.dVsSc === 'number') ? `, vs live OCCT worst ${ex(Math.max(...built.filter((x) => typeof x.occt?.dVsSc === 'number').map((x) => x.occt.dVsSc)))} (${built.filter((x) => typeof x.occt?.dVsSc === 'number').length} referee-able)` : ', OCCT cannot referee them'}; curved bar 3e-4, planar 1e-9.`
    : '';
  row.evidence += `${MARK} shipped UNGUARDED route only (phase0 wrapper, no @sketch dump), ${cases.length} case(s) carry this feature [${cases.map((c) => c.id).join(', ')}]; stored start: ${fmtTally(st)}; 40 starts at 3.5% of the diagonal: ${fmtTally(r35)}; 40 starts at 15%: ${fmtTally(r15)}.${nums}${wrongStored.length ? ` Unguarded stored start builds a WRONG volume for: ${wrongStored.join(', ')} (the shipped default extrudes every profile, so the hole is not subtracted; this row's status holds only on the route that includes the contract even-odd profile selector, see the evenOddProfiles row).` : ''} The guarded route could not be re-run (see top-level recheck).`;
  touched++;
  log.push([row.feature, row.status, cases.length]);
}

// sanity: nothing fresh may contradict a status. A "supported" row whose cases build a wrong volume on the STORED start unguarded is fine only if the row
// is about the guard/selector; list them so the report can name them.
const contradictions = [];
for (const row of doc.rows) {
  if (row.status !== 'supported') continue;
  const cases = casesFor(row.feature).filter((c) => c.starts && !c.hang);
  const wrong = cases.filter((c) => (c.starts.stored?.tally?.['BUILT-WRONG-VOLUME'] ?? 0) > 0);
  if (wrong.length) contradictions.push({ row: row.feature, cases: wrong.map((c) => c.id) });
}

const fx = { total: fixtures.length, byVerdict: {} };
for (const r of fixtures) { const k = r.refused ? 'REFUSED' : r.verdict; fx.byVerdict[k] = (fx.byVerdict[k] ?? 0) + 1; }
doc.round = 4;
doc.generatedAt = new Date().toISOString();
doc.recheck = {
  date: '2026-10-18',
  why: 'A machine reboot (uptime 2 min at 10:09) emptied /tmp: the scratchpad rig (sc-referee-pkg, shadow root) and the wrapper2 pkg the round-3 chain needs (SOLIDCRAFT_REFEREE_PKG2) no longer exist. The task said not to rebuild the wasm, so nothing was rebuilt.',
  whatWasRerun: [
    'build-rows.mjs of round 3: rebuilt this file from the committed raw data (docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/out/*.json); the row-level assertions (status derived from data, one-sentence refusal lint) all passed; only generatedAt differed from the committed file.',
    `sketch-constraints-r4/remeasure-fixtures.mjs: ${fx.total} runs (the phase2 own-* and gauntlet sketch fixtures x stored / 3.5% / 15% start) through the shipped mapper -> SolidCraft (demo/pkg = the phase0 wrapper, initSync under Bun) -> volume / bbox / faces against closed form, live brep-rs and live OCCT: ${JSON.stringify(fx.byVerdict)}`,
    `sketch-constraints-r4/shipped-sweep.mjs + orchestrate.mjs: ${sweep.length} cases of the round-3 case table (reSHape Script text -> runScript -> shipped mapper -> SolidCraft) x stored + 40 starts at 3.5% + 40 at 15% (one child process per case, killed at 420 s), scored against closed form`,
    'sketch-constraints-r4/stored-xcheck.mjs: the stored start of every buildable case against closed form, live brep-rs (script -> solveDoc -> build) and live OCCT (building the brep-rs-solved geometry)',
  ],
  whatWasNotRerun: 'The GUARDED route (guard.mjs ladder, branch check, even-odd profile selector, plain sentences) needs the solved-point readout of the wrapper2 pkg, which the phase0 wrapper cannot give. Every status that depends on the guard (all "supported" soup rows, the sentences, the param drags, the legacy route B rows, the DoF row) therefore rests on the round-3 data committed earlier today (2026-10-18 05:16 to 05:44 PDT, wrapper2 pkg built from the same fe3717f source), not on a run in this session. To re-run: rebuild phase2/wrapper2 (about 2.5 minutes) and run sketch-constraints-r3/run-all.sh.',
  agreement: 'No fresh number contradicts a round-3 status. Where the unguarded route builds a wrong volume the fresh run reproduces the round-3 "wrong" rows: nested loops (hole not subtracted: plate-with-hole 8.5e-2, circle-circle internal 6.4e-1, SolidCraft 6 faces vs brep-rs 7), and silent other-branch builds on rough starts (hexagon, slots, ovals, signed distanceX); the guarded route that refuses them is the part not re-run.',
  rigNotes: [
    'sketch-constraints-r4/pkg2shim/solidcraft_referee_p2.js emulates wrapper2 command results by replaying prefixes on the phase0 wrapper; its @sketch result is always {error:"no evaluated sketch"}, so any code that needs solved points (ladderSketch, classify, docProfileIndices) cannot run on it.',
    'Under this rig the shipped profile selection (docProfileIndices) is also unavailable, so multi-profile sketches are extruded with every profile: those cases show the known "extrudes every profile" wrong build, and are not evidence about the contract selector.',
    'The first full sweep in one process ran past 10 minutes because 80 rough-start extrusions of circles take about 0.3 to 0.7 s each; it was not a hang. circle-circle-internal 81 of 81 runs built the wrong volume in 61 s.',
  ],
  unguardedContradictions: contradictions,
};
if (!String(doc.rig).includes("ROUND 4 NOTE")) doc.rig = `${doc.rig} || ROUND 4 NOTE: the wrapper2 pkg above no longer exists (reboot). Round-4 re-measurements use the phase0 wrapper (docs/spikes/solidcraft-referee/demo/pkg, same referee crate without the sketch dump) through sketch-constraints-r4/pkg2shim; see "recheck".`;
writeFileSync(F, JSON.stringify(doc, null, 1) + '\n');
console.log(`rows ${doc.rows.length}, rows with fresh evidence ${touched}`);
console.log(JSON.stringify(fx));
console.log('supported rows whose unguarded stored start builds a wrong volume:', JSON.stringify(contradictions));
