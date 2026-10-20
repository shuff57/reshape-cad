#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Summarises the guarded run of the seeded random primitive pairs (bool-fuzz-gen.mjs, seeds 7 11 13) and pairs / triples (bool-fuzz-gen-r3.mjs, seed 17) into booleans-r3/fuzz-summary.json.
// A "survivor" is a pair the guard let through to SolidCraft. Survivors must be PASS (matches OCCT within the bars); a survivor that HANGS past the harness limit is a GUARD MISS (the Worker
// budget would catch it, at the cost of the full budget); a survivor that builds something different from OCCT is a silent WRONG; a survivor the kernel itself refuses is fine (the
// student sees the K9 sentence).
//   (round 5 copy of bool-fuzz-summary-r3.mjs: reads booleans-r4/fuzz-guarded (seed 23) and booleans-r4/fuzz-guarded-old (seeds 7 11 13 17, re-run under the round-5 guard) -> booleans-r4/fuzz-summary.json)
//   bun contract/bool-fuzz-summary-r4.mjs [--dir=fuzz-guarded] [--limit=60]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './bool-classify-lib.mjs';
import * as GD from './booleans.guard.mjs';
import { CASES } from './boolean-cases.mjs';
await import('./boolean-cases-r2.mjs');
await import('./boolean-cases-r3.mjs');
await import('./boolean-cases-r4.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const dirs = arg('dir', 'fuzz-guarded,fuzz-guarded-old').split(',').map((d) => path.join(HERE, 'booleans-r4', d, 'cases'));
const rows = dirs.flatMap((dir) => { try { return readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))); } catch { return []; } }).sort((a, b) => a.id.localeCompare(b.id));
const codeOf = (s) => { if (/^The two shapes overlap by less than/.test(s)) return 'sliver'; for (const [k, fn] of Object.entries(GD.SENTENCES)) for (const op of ['union', 'subtract', 'intersect']) if (k !== 'skipped' && fn(op) === s) return k; return s?.startsWith('This step was skipped') ? 'skipped' : '?'; };
const buckets = { guardRefused: {}, kernelRefused: 0, pass: 0, wrong: [], hang: [], discounted: [], slowInBudget: [], other: [] };
const bucketOf = {};   // id -> 'guard' | 'kernel' | 'pass' | 'wrong' | 'hang' | 'slow' | 'discounted'
// a survivor the harness gave up on (60 s for the WHOLE translated document, every prefix re-run) is re-timed with time-sc.mjs (one sc.run of the final command list); under the 45 s budget it is slow, not a hang
const timed = new Map();
for (const f of readdirSync(path.join(HERE, 'booleans-r3')).filter((x) => /^timing-fz.*\.json$/.test(x))) for (const t of JSON.parse(readFileSync(path.join(HERE, 'booleans-r3', f), 'utf8'))) timed.set(t.id, t);
// causes of a survivor that disagrees with OCCT; a case in DISCOUNT is not a SolidCraft fault (the ORACLE is off) and is reported but not counted
const DISCOUNT = { 'fz23-050-sph-box-sub': "OCCT's bbox y min is -14 but the true minimum is -sqrt(14^2 - 5^2) = -13.0767 (the ball r14 minus the box x -7..13, y -16..4, z -5..5: the lowest remaining point lies on the box's z=+-5 plane); SolidCraft's -13.0767 is right to 1e-6, so the oracle bbox is loose (a closed-form second measure; volume d 9.3e-5, area d 5.0e-5)", 'fz7-067-box-sph-sub': "OCCT's bbox (y min -18.86) lies OUTSIDE the 30 mm box that contains the result (y -15), so the oracle bbox is loose and SolidCraft's -15 is right; volume d 1.2e-4, area d 3.7e-6" };
// oracle sanity: the result of a cut or keep lies inside an axis-aligned box target, so an OCCT bbox that sticks out of that box is the oracle's looseness, not SolidCraft's fault
const oracleLooserThanTarget = (r) => {
  const fz = CASES.find((x) => x.id === r.id).features; const a = fz[0]; const op = fz.at(-1).op;
  if (a.kind !== 'box' || (a.rotate && a.rotate.some((v) => Math.abs(v / 90 - Math.round(v / 90)) > 1e-9)) || (op !== 'subtract' && op !== 'intersect')) return false;
  const quarter = (a.rotate ?? [0, 0, 0]).filter((v) => Math.round(v / 90) % 2 !== 0).length > 0;
  let size = a.size; if (quarter) return false;   // turned by 90 degrees: skip (not needed for the cases seen)
  const lo = a.center.map((c, i) => c - size[i] / 2); const hi = a.center.map((c, i) => c + size[i] / 2);
  const b = r.occt.bbox; const t = r.truck;
  const outside = [0, 1, 2].some((i) => b[i] < lo[i] - 1e-6 || b[i + 3] > hi[i] + 1e-6);
  return outside && t.dVol <= t.tol && (t.dArea ?? 0) <= t.tol && t.dCom <= (t.curved ? 3e-5 : 1e-6);
};
const NOTES = { 'fz13-052-cyl-cyl-int': 'CLOSED FORM (lens area of the two discs, integrated: 22.99076 x 20 = 459.81526) equals OCCT 459.81526; SolidCraft 459.67533 is 3.04e-4 short', 'fz17-023-con-sph-sub': 'the whole result is a 0.84 mm3 shell of the cone under the ball; the absolute volume error is 0.0004 mm3', 'fz23-087-sph-box-uni': 'geometry agrees (volume 1.3e-4, bbox 6e-6, area 4e-5); only the face census differs: a planar face is split in two' };
const causeOf = (r, c) => {
  if (NOTES[r.id]) return NOTES[r.id] + '; ' + causeOf0(r, c);
  return causeOf0(r, c);
};
const causeOf0 = (r, c) => {
  const t = r.truck; const o = r.occt;
  if (c.flags?.includes('translator drops split-off bodies') || (r.occt.solids > (r.truck?.bodies ?? 1) && r.truck?.dVol > 0.1)) return `split result: OCCT ${o.solids} solids, the translator reports only the target's piece (same class as the split-cut rows)`;
  if (t && o && t.dVol > t.tol && t.dBbox <= t.tol && (t.dArea ?? 0) <= t.tol) return `volume-only miss on a small curved remainder: dVol ${t.dVol.toExponential(1)} against the ${t.tol} bar (result volume ${o.volume.toFixed(2)})`;
  if (t && o && t.dBbox > t.tol && t.dVol <= t.tol) return `bbox-only miss on a curved result: dBbox ${t.dBbox.toExponential(1)} against the ${t.tol} bar (volume d ${t.dVol.toExponential(1)}, area d ${(t.dArea ?? 0).toExponential(1)})`;
  if (t && o && Math.max(t.dVol, t.dBbox) < 2 * t.tol) return `marginal miss of the ${t.tol} curved bar: dVol ${t.dVol.toExponential(1)}, dBbox ${t.dBbox.toExponential(1)}, dArea ${(t.dArea ?? 0).toExponential(1)}`;
  return 'see the numbers';
};
const lines = [];
for (const r of rows) {
  const c = classify(r);
  const fz = CASES.find((x) => x.id === r.id).features;
  const kinds = fz.slice(0, -1).map((f) => `${f.kind}${f.rotate ? '@' + f.rotate.join('/') : ''}${f.center?.some((v) => v) ? '+' + f.center.join(',') : ''}`).join(' & ') + ' ' + fz.at(-1).op;
  if (c.status === 'refused') {
    const k = codeOf(c.sentence);
    if (['curvedKernel', 'generic', 'trap', 'keepNothingKernel'].includes(k)) { bucketOf[r.id] = 'kernel'; buckets.kernelRefused++; lines.push(`${r.id}: survivor, refused by the kernel -> ${k} (${kinds})`); }
    else { bucketOf[r.id] = 'guard'; buckets.guardRefused[k] = (buckets.guardRefused[k] ?? 0) + 1; lines.push(`${r.id}: guard ${k} (${kinds})`); }
  } else if (c.status === 'supported') { bucketOf[r.id] = 'pass'; buckets.pass++; lines.push(`${r.id}: survivor PASS (${kinds}) ${r.summary?.slice(0, 90) ?? ''}`); }
  else if (c.status === 'unsupported' && timed.get(r.id)?.result === 'done' && timed.get(r.id).scRunMs < 45000) { bucketOf[r.id] = 'slow'; buckets.slowInBudget.push(r.id); lines.push(`${r.id}: survivor SLOW, not a hang (${kinds}): the harness limit expired on the replayed document, one sc.run of the final command list takes ${(timed.get(r.id).scRunMs / 1000).toFixed(1)} s, result ${timed.get(r.id).bodies} (not compared with OCCT)`); }
  else if (c.status === 'unsupported') { bucketOf[r.id] = 'hang'; buckets.hang.push(r.id); lines.push(`${r.id}: survivor HANG/CRASH (${r.outcome} at ${r.lastStage}) ${kinds}`); }
  else if (DISCOUNT[r.id] || oracleLooserThanTarget(r)) { bucketOf[r.id] = 'discounted'; buckets.discounted.push(r.id); lines.push(`${r.id}: survivor DISCOUNTED, oracle artifact (${kinds}) ${DISCOUNT[r.id] ?? `OCCT's bbox ${r.occt.bbox.map((v) => +v.toFixed(3))} sticks out of the axis-aligned box target that contains the result, so the oracle bbox is loose; truck bbox ${r.truck.bbox.map((v) => +v.toFixed(3))}; volume d ${r.truck.dVol.toExponential(1)}, area d ${(r.truck.dArea ?? 0).toExponential(1)}`}`); }
  else { bucketOf[r.id] = 'wrong'; buckets.wrong.push(r.id); lines.push(`${r.id}: survivor WRONG (${kinds}) cause: ${causeOf(r, c)}. ${r.summary?.slice(0, 150) ?? ''}`); }
}
const seeds = [...new Set(rows.map((r) => r.id.split('-')[0].slice(2)))];
const total = rows.length; const guardRefused = Object.values(buckets.guardRefused).reduce((a, b) => a + b, 0);
const status = buckets.wrong.length ? 'wrong' : buckets.hang.length ? 'unsupported' : 'refused';
const perSeed = seeds.map((sd) => { const ids = rows.filter((r) => r.id.startsWith(`fz${sd}-`)).map((r) => r.id); const cnt = (k) => ids.filter((i) => bucketOf[i] === k).length; return `seed ${sd}: ${ids.length} cases, guard ${cnt('guard')}, kernel ${cnt('kernel')}, pass ${cnt('pass')}, slow ${cnt('slow')}, discounted ${cnt('discounted')}, wrong ${cnt('wrong')}, hang ${cnt('hang')}`; });
const evidence = `${total} seeded random primitive pairs and triples (seeds 7, 11, 13 and 17 re-run under the round-5 guard (the guard of round 4 plus the plain relative bar); seed 23 is new in round 4: pairs AND triples, with cone, prism and wedge, axis-aligned / 45 degrees / [30,20,10]), each through the guarded path (BOOL_TR=guarded BOOL_FAST=1, 150 s harness limit for seed 23 and 60 s for the re-run seeds 7 11 13 17; BOOL_FAST translates first so a case the guard refuses costs no oracle run). ${perSeed.join('; ')}. TOTAL: refused by the guard ${guardRefused} ${JSON.stringify(buckets.guardRefused)}; survivors: ${buckets.pass} built and matched OCCT within the bars, ${buckets.kernelRefused} refused by the kernel (student sees the generic or trap sentence), ${buckets.wrong.length} built something different from OCCT${buckets.wrong.length ? ' (' + buckets.wrong.join(', ') + ')' : ''}${buckets.discounted.length ? `, ${buckets.discounted.length} more disagreed only because the oracle itself is off (${buckets.discounted.join(', ')}; not counted)` : ''}, ${buckets.slowInBudget.length} hit the harness limit but are slow, not hung (one sc.run under the 45 s budget: ${buckets.slowInBudget.join(', ') || 'none'}), ${buckets.hang.length} had no result within the limit${buckets.hang.length ? ' (GUARD MISSES: ' + buckets.hang.join(', ') + ')' : ''}.${status === 'refused' ? ' No survivor was wrong or hung, so within this sample the guard let nothing slow or wrong through; a sample, not a proof.' : ''}\nCommand: bun docs/spikes/solidcraft-referee/contract/bool-fuzz-gen.mjs --seed=7 --n=90 (and 11, 13); bun .../bool-fuzz-gen-r3.mjs --seed=17 --n=120; bun .../bool-fuzz-gen-r4.mjs --seed=23 --n=150; BOOL_FAST=1 SOLIDCRAFT_REFEREE_PKG=<pkg> booleans-r4/run-r4.sh guarded <fuzz ids> 150 <abs>/booleans-r4/fuzz-guarded (seed 23) or fuzz-guarded-old (the others); survivors the harness cut off are re-timed with time-sc.mjs --out=booleans-r3/timing-fz-r3.json; bun docs/spikes/solidcraft-referee/contract/bool-fuzz-summary-r4.mjs\nPer case:\n${lines.map((l) => '  ' + l).join('\n')}`;
writeFileSync(path.join(HERE, 'booleans-r4', 'fuzz-summary.json'), JSON.stringify({ status, sentence: GD.SENTENCES.curvedKernel('subtract'), total, buckets, evidence }, null, 1));
console.log(status, total, JSON.stringify(buckets).slice(0, 400));
