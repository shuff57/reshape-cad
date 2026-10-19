#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Summarises the guarded run of the seeded random primitive pairs (bool-fuzz-gen.mjs) into booleans-r2/fuzz-summary.json.
// A "survivor" is a pair the guard let through to SolidCraft. Survivors must be PASS (matches OCCT within the bars); a survivor that HANGS past the harness limit is a GUARD MISS (the Worker
// budget would catch it, at the cost of the full budget); a survivor that builds something different from OCCT is a silent WRONG; a survivor the kernel itself refuses is fine (the
// student sees the K9 sentence).
//   bun contract/bool-fuzz-summary.mjs [--dir=fuzz-guarded] [--limit=60]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './bool-classify-lib.mjs';
import * as GD from './booleans.guard.mjs';
import { CASES } from './boolean-cases.mjs';
await import('./boolean-cases-r2.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const dir = path.join(HERE, 'booleans-r2', arg('dir', 'fuzz-guarded'), 'cases');
const rows = readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id));
const codeOf = (s) => { for (const [k, fn] of Object.entries(GD.SENTENCES)) for (const op of ['union', 'subtract', 'intersect']) if (k !== 'skipped' && fn(op) === s) return k; return s?.startsWith('This step was skipped') ? 'skipped' : '?'; };
const buckets = { guardRefused: {}, kernelRefused: 0, pass: 0, wrong: [], hang: [], discounted: [], slowInBudget: [], other: [] };
// a survivor the harness gave up on (60 s for the WHOLE translated document, every prefix re-run) is re-timed with time-sc.mjs (one sc.run of the final command list); under the 45 s budget it is slow, not a hang
const timed = new Map();
for (const f of readdirSync(path.join(HERE, 'booleans-r2')).filter((x) => /^timing-fz.*\.json$/.test(x))) for (const t of JSON.parse(readFileSync(path.join(HERE, 'booleans-r2', f), 'utf8'))) timed.set(t.id, t);
// causes of a survivor that disagrees with OCCT; a case in DISCOUNT is not a SolidCraft fault (the ORACLE is off) and is reported but not counted
const DISCOUNT = { 'fz7-067-box-sph-sub': "OCCT's bbox (y min -18.86) lies OUTSIDE the 30 mm box that contains the result (y -15), so the oracle bbox is loose and SolidCraft's -15 is right; volume d 1.2e-4, area d 3.7e-6" };
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
const causeOf = (r, c) => {
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
  const kinds = fz.slice(0, 2).map((f) => `${f.kind}${f.rotate ? '@' + f.rotate.join('/') : ''}${f.center?.some((v) => v) ? '+' + f.center.join(',') : ''}`).join(' & ') + ' ' + fz.at(-1).op;
  if (c.status === 'refused') {
    const k = codeOf(c.sentence);
    if (k === 'curvedKernel' || k === 'generic') { buckets.kernelRefused++; lines.push(`${r.id}: survivor, refused by the kernel -> ${k} (${kinds})`); }
    else { buckets.guardRefused[k] = (buckets.guardRefused[k] ?? 0) + 1; lines.push(`${r.id}: guard ${k} (${kinds})`); }
  } else if (c.status === 'supported') { buckets.pass++; lines.push(`${r.id}: survivor PASS (${kinds}) ${r.summary?.slice(0, 90) ?? ''}`); }
  else if (c.status === 'unsupported' && timed.get(r.id)?.result === 'done' && timed.get(r.id).scRunMs < 45000) { buckets.slowInBudget.push(r.id); lines.push(`${r.id}: survivor SLOW, not a hang (${kinds}): the harness limit expired on the replayed document, one sc.run of the final command list takes ${(timed.get(r.id).scRunMs / 1000).toFixed(1)} s, result ${timed.get(r.id).bodies} (not compared with OCCT)`); }
  else if (c.status === 'unsupported') { buckets.hang.push(r.id); lines.push(`${r.id}: survivor HANG/CRASH (${r.outcome} at ${r.lastStage}) ${kinds}`); }
  else if (DISCOUNT[r.id] || oracleLooserThanTarget(r)) { buckets.discounted.push(r.id); lines.push(`${r.id}: survivor DISCOUNTED, oracle artifact (${kinds}) ${DISCOUNT[r.id] ?? `OCCT's bbox ${r.occt.bbox.map((v) => +v.toFixed(3))} sticks out of the axis-aligned box target that contains the result, so the oracle bbox is loose; truck bbox ${r.truck.bbox.map((v) => +v.toFixed(3))}; volume d ${r.truck.dVol.toExponential(1)}, area d ${(r.truck.dArea ?? 0).toExponential(1)}`}`); }
  else { buckets.wrong.push(r.id); lines.push(`${r.id}: survivor WRONG (${kinds}) cause: ${causeOf(r, c)}. ${r.summary?.slice(0, 150) ?? ''}`); }
}
const seeds = [...new Set(rows.map((r) => r.id.split('-')[0].slice(2)))];
const total = rows.length; const guardRefused = Object.values(buckets.guardRefused).reduce((a, b) => a + b, 0);
const status = buckets.wrong.length ? 'wrong' : buckets.hang.length ? 'unsupported' : 'refused';
const evidence = `${total} seeded random pairs (bool-fuzz-gen.mjs, seeds ${seeds.join(' and ')}; seed 7 FOUND the sphere/cylinder hang (rule G2c was added) and was re-run; seed 11 FOUND that the torus-in-a-box exception trusted the bounding box of a box turned by 45 degrees (the exception now needs an axis-aligned box) and its affected cases were re-run; seed 13 was generated after the last guard change and is the held-out sample), each through the guarded path (BOOL_TR=guarded, ${arg('limit', 60)} s harness limit): refused by the guard ${guardRefused} ${JSON.stringify(buckets.guardRefused)}; survivors: ${buckets.pass} built and matched OCCT within the bars, ${buckets.kernelRefused} refused by the kernel (student sees the generic curved-kernel sentence), ${buckets.wrong.length} built something different from OCCT${buckets.wrong.length ? ' (' + buckets.wrong.join(', ') + ')' : ''}${buckets.discounted.length ? `, ${buckets.discounted.length} more disagreed only because the oracle itself is off (${buckets.discounted.join(', ')}; not counted)` : ''}, ${buckets.slowInBudget.length} hit the harness limit but are slow, not hung (one sc.run under the 45 s budget: ${buckets.slowInBudget.join(', ') || 'none'}), ${buckets.hang.length} had no result within the limit${buckets.hang.length ? ' (GUARD MISSES: ' + buckets.hang.join(', ') + ')' : ''}.${status === 'refused' ? ' No survivor was wrong or hung, so within this sample the guard let nothing slow or wrong through; a sample, not a proof.' : ''}\nCommand: bun docs/spikes/solidcraft-referee/contract/bool-fuzz-gen.mjs --seed=7 --n=90; bun .../bool-fuzz-gen.mjs --seed=11 --n=90; bun .../bool-fuzz-gen.mjs --seed=13 --n=90; BOOL_TR=guarded SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/run-booleans.mjs --all --only=<fuzz ids> --timeout=${arg('limit', 60)} --out=booleans-r2/fuzz-guarded; bun docs/spikes/solidcraft-referee/contract/bool-fuzz-summary.mjs\nPer case:\n${lines.map((l) => '  ' + l).join('\n')}`;
writeFileSync(path.join(HERE, 'booleans-r2', 'fuzz-summary.json'), JSON.stringify({ status, sentence: GD.SENTENCES.curvedKernel('subtract'), total, buckets, evidence }, null, 1));
console.log(status, total, JSON.stringify(buckets).slice(0, 400));
