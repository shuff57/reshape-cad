#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Summarises the guarded run of the seeded random primitive pairs (bool-fuzz-gen.mjs, seeds 7 11 13) and pairs / triples (bool-fuzz-gen-r3.mjs, seed 17) into booleans-r3/fuzz-summary.json.
// A "survivor" is a pair the guard let through to SolidCraft. Survivors must be PASS (matches OCCT within the bars); a survivor that HANGS past the harness limit is a GUARD MISS (the Worker
// budget would catch it, at the cost of the full budget); a survivor that builds something different from OCCT is a silent WRONG; a survivor the kernel itself refuses is fine (the
// student sees the K9 sentence).
//   (fix round 2 copy of bool-fuzz-summary-r4.mjs: reads booleans-r6/fuzz-guarded (all five seeds, replayed under the round-6 guard) -> booleans-r6/fuzz-summary.json. The OCCT-artifact discount of round 5 (a bbox argument) is replaced by `proveOracleLoose`: a CLOSED-FORM bounding box of the result;
//    a case is discounted only when the proof holds, OCCT's box differs from it by more than the bar and SolidCraft's box equals it within the bar.)
//   bun contract/bool-fuzz-summary-r6.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './bool-classify-lib.mjs';
import * as GD from './booleans.guard.mjs';
import { CASES } from './boolean-cases.mjs';
await import('./boolean-cases-r2.mjs');
await import('./boolean-cases-r3.mjs');
await import('./boolean-cases-r4.mjs');
await import('./boolean-cases-r5.mjs');
await import('./boolean-cases-r6.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const dirs = arg('dir', 'fuzz-guarded').split(',').map((d) => path.join(HERE, 'booleans-r6', d, 'cases'));
const rows = dirs.flatMap((dir) => { try { return readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))); } catch { return []; } }).sort((a, b) => a.id.localeCompare(b.id));
const codeOf = (s) => { if (/^The two shapes overlap by less than/.test(s)) return 'sliver'; for (const [k, fn] of Object.entries(GD.SENTENCES)) for (const op of ['union', 'subtract', 'intersect']) if (k !== 'skipped' && fn(op) === s) return k; return s?.startsWith('This step was skipped') ? 'skipped' : '?'; };
const buckets = { guardRefused: {}, kernelRefused: 0, pass: 0, wrong: [], hang: [], discounted: [], slowInBudget: [], other: [] };
const bucketOf = {};   // id -> 'guard' | 'kernel' | 'pass' | 'wrong' | 'hang' | 'slow' | 'discounted'
// a survivor the harness gave up on (60 s for the WHOLE translated document, every prefix re-run) is re-timed with time-sc.mjs (one sc.run of the final command list); under the 45 s budget it is slow, not a hang
const timed = new Map();
for (const f of readdirSync(path.join(HERE, 'booleans-r3')).filter((x) => /^timing-fz.*\.json$/.test(x))) for (const t of JSON.parse(readFileSync(path.join(HERE, 'booleans-r3', f), 'utf8'))) timed.set(t.id, t);
// causes of a survivor that disagrees with OCCT; a case in DISCOUNT is not a SolidCraft fault (the ORACLE is off) and is reported but not counted
// CLOSED-FORM bounding box of (axis-aligned box minus ball) and (ball minus axis-aligned box) -> {box:[6], text} or null. Both are exact geometry, independent of both kernels.
//   box minus ball: a face of the box stays (so the box's own extent is the true extent) unless all four of its corners lie inside the ball (then no proof is attempted).
//   ball minus box: along axis i the ball's slice at coordinate c is a disc of radius sqrt(R^2 - c^2) around the ball's axis; the slice is gone exactly when that disc lies inside the box's cross-section rectangle, i.e. when its centre is inside the rectangle and the radius is not above the distance to the nearest side.
const trueBbox = (fz) => {
  const [a, b] = fz; const lo = (x) => x.center.map((c, i) => c - x.size[i] / 2); const hi = (x) => x.center.map((c, i) => c + x.size[i] / 2);
  const plainBox = (x) => x.kind === 'box' && !x.rotate;
  if (plainBox(a) && b.kind === 'sphere') {
    const L = lo(a); const H = hi(a); const inBall = (p) => Math.hypot(p[0] - b.center[0], p[1] - b.center[1], p[2] - b.center[2]) <= b.radius;
    for (let ax = 0; ax < 3; ax++) for (const side of [L, H]) {
      const [u, v] = [0, 1, 2].filter((i) => i !== ax); const corners = [[L[u], L[v]], [L[u], H[v]], [H[u], L[v]], [H[u], H[v]]].map(([p, q]) => { const pt = [0, 0, 0]; pt[ax] = side[ax]; pt[u] = p; pt[v] = q; return pt; });
      if (corners.every(inBall)) return null;
    }
    return { box: [...L, ...H], text: `the true box of (box minus ball) is the box itself ${[...L, ...H].join(', ')}: no face of the box lies wholly inside the ball (a corner of each is outside it)` };
  }
  if (a.kind === 'sphere' && plainBox(b)) {
    const L = lo(b); const H = hi(b); const R = a.radius; const out = [];
    for (let ax = 0; ax < 3; ax++) {
      const [u, v] = [0, 1, 2].filter((i) => i !== ax);
      const rect = { lo: [L[u] - a.center[u], L[v] - a.center[v]], hi: [H[u] - a.center[u], H[v] - a.center[v]] };
      const gone = (c) => { const x = a.center[ax] + c; if (x < L[ax] || x > H[ax]) return false; const rho = Math.sqrt(Math.max(0, R * R - c * c)); const inside = 0 >= rect.lo[0] && 0 <= rect.hi[0] && 0 >= rect.lo[1] && 0 <= rect.hi[1]; if (!inside) return false; return rho <= Math.min(-rect.lo[0], rect.hi[0], -rect.lo[1], rect.hi[1]); };
      const ext = (dir) => { if (!gone(dir * R * (1 - 1e-12))) return dir * R; let nearGone = 0, far = dir * R; /* bisection between the extreme (gone) and 0 (not gone, unless gone everywhere) */ if (gone(0)) return NaN; let g = dir * R, n = 0; for (let k = 0; k < 200; k++) { const mid = (g + n) / 2; if (gone(mid)) g = mid; else n = mid; } return n; };
      out[ax] = a.center[ax] + ext(-1); out[ax + 3] = a.center[ax] + ext(1);
    }
    if (out.some((v) => !Number.isFinite(v))) return null;
    return { box: out, text: `the true box of (ball minus box) from the slice argument: ${out.map((v) => +v.toFixed(4)).join(', ')}` };
  }
  return null;
};
const proveOracleLoose = (r) => {
  const fz = CASES.find((x) => x.id === r.id).features; if (fz.length !== 3 || fz.at(-1).op !== 'subtract') return null;
  const t = r.truck; const o = r.occt; if (!(t.dVol <= t.tol && (t.dArea ?? 0) <= t.tol && t.dCom <= (t.curved ? 3e-5 : 1e-6))) return null;   // only a pure bbox disagreement
  const tb = trueBbox(fz); if (!tb) return null; const rel = (x, y) => Math.abs(x - y) / Math.max(Math.abs(y), 1);
  const dS = Math.max(...tb.box.map((v, i) => rel(t.bbox[i], v))); const dO = Math.max(...tb.box.map((v, i) => rel(o.bbox[i], v)));
  if (dS > t.tol || dO <= t.tol) return null;
  return `${tb.text}; SolidCraft's box is ${dS.toExponential(1)} from it (inside the ${t.tol} bar), OCCT's is ${dO.toExponential(1)} from it (outside), so the OCCT bounding box is the loose one; volume d ${t.dVol.toExponential(1)}, area d ${(t.dArea ?? 0).toExponential(1)}, centre of mass d ${t.dCom.toExponential(1)}`;
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
  else if (proveOracleLoose(r)) { bucketOf[r.id] = 'discounted'; buckets.discounted.push(r.id); lines.push(`${r.id}: survivor DISCOUNTED, oracle bbox proven loose by a closed form (${kinds}): ${proveOracleLoose(r)}`); }
  else { bucketOf[r.id] = 'wrong'; buckets.wrong.push(r.id); lines.push(`${r.id}: survivor WRONG (${kinds}) cause: ${causeOf(r, c)}. ${r.summary?.slice(0, 150) ?? ''}`); }
}
const seeds = [...new Set(rows.map((r) => r.id.split('-')[0].slice(2)))];
const total = rows.length; const guardRefused = Object.values(buckets.guardRefused).reduce((a, b) => a + b, 0);
const status = buckets.wrong.length ? 'wrong' : buckets.hang.length ? 'unsupported' : 'refused';
const perSeed = seeds.map((sd) => { const ids = rows.filter((r) => r.id.startsWith(`fz${sd}-`)).map((r) => r.id); const cnt = (k) => ids.filter((i) => bucketOf[i] === k).length; return `seed ${sd}: ${ids.length} cases, guard ${cnt('guard')}, kernel ${cnt('kernel')}, pass ${cnt('pass')}, slow ${cnt('slow')}, discounted ${cnt('discounted')}, wrong ${cnt('wrong')}, hang ${cnt('hang')}`; });
const evidence = `${total} seeded random primitive pairs and triples (seeds 7, 11, 13, 17 and 23, ALL five replayed in fix round 2 under the round-6 guard (G3 cylinder rule, G7 two tangent sides, G19 box containment, G20 lens, G21 thin remainder); seeds 17 and 23 are pairs AND triples, with cone, prism and wedge, axis-aligned / 45 degrees / [30,20,10]), each through the guarded path (BOOL_TR=guarded BOOL_FAST=1, 150 s harness limit; BOOL_FAST translates first so a case the guard refuses costs no oracle run). ${perSeed.join('; ')}. TOTAL: refused by the guard ${guardRefused} ${JSON.stringify(buckets.guardRefused)}; survivors: ${buckets.pass} built and matched OCCT within the bars, ${buckets.kernelRefused} refused by the kernel (student sees the generic or trap sentence), ${buckets.wrong.length} built something different from OCCT${buckets.wrong.length ? ' (' + buckets.wrong.join(', ') + ')' : ''}${buckets.discounted.length ? `, ${buckets.discounted.length} more disagreed with OCCT only in the bounding box, where a CLOSED-FORM box shows OCCT's is the loose one and SolidCraft's is right (${buckets.discounted.join(', ')}; each proof is on its case line)` : ''}, ${buckets.slowInBudget.length} hit the harness limit but are slow, not hung (one sc.run under the 45 s budget: ${buckets.slowInBudget.join(', ') || 'none'}), ${buckets.hang.length} had no result within the limit${buckets.hang.length ? ' (GUARD MISSES: ' + buckets.hang.join(', ') + ')' : ''}.${status === 'refused' ? ' No survivor was wrong or hung, so within this sample the guard let nothing slow or wrong through; a sample, not a proof.' : ''}\nCommand: bun docs/spikes/solidcraft-referee/contract/bool-fuzz-gen.mjs --seed=7 --n=90 (and 11, 13); bun .../bool-fuzz-gen-r3.mjs --seed=17 --n=120; bun .../bool-fuzz-gen-r4.mjs --seed=23 --n=150; BOOL_FAST=1 SOLIDCRAFT_REFEREE_PKG=<pkg> booleans-r6/run-r6.sh guarded <fuzz ids> 150 <abs>/booleans-r6/fuzz-guarded (all seeds; booleans-r6/replay-all.sh does the whole replay); survivors the harness cut off are re-timed with time-sc.mjs --out=booleans-r3/timing-fz-r3.json; bun docs/spikes/solidcraft-referee/contract/bool-fuzz-summary-r6.mjs\nPer case:\n${lines.map((l) => '  ' + l).join('\n')}`;
writeFileSync(path.join(HERE, 'booleans-r6', 'fuzz-summary.json'), JSON.stringify({ status, sentence: GD.SENTENCES.curvedKernel('subtract'), total, buckets, evidence }, null, 1));
console.log(status, total, JSON.stringify(buckets).slice(0, 400));
