// Joins the round-1 measurements (71 script cases, blend-loft.measure-results.json) with the guard verdict for the same script text.
//   bun contract/blend-loft.r1-guard.mjs   (no wasm needed; reads packages/*/dist)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { guardedRun } = await import(pathToFileURL(path.join(HERE, 'blend-loft.guarded-run.mjs')).href);
const { parallelShifts, ccwLoop } = await import(pathToFileURL(path.join(HERE, 'blend-loft.guard.mjs')).href);
// independent closed form of a ruled loft of corresponding straight polygons (divergence theorem, Gauss 3x3 per side patch)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const GP = [[0.5 - Math.sqrt(0.15), 5 / 18], [0.5, 8 / 18], [0.5 + Math.sqrt(0.15), 5 / 18]];
function ruledVolume3D(P, Q) {
  const n = P.length; let side = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n;
    for (const [s, ws] of GP) for (const [t, wt] of GP) { const r = lerp3(lerp3(P[i], P[j], s), lerp3(Q[i], Q[j], s), t); const rs = lerp3(sub(P[j], P[i]), sub(Q[j], Q[i]), t); const rt = sub(lerp3(Q[i], Q[j], s), lerp3(P[i], P[j], s)); side += ws * wt * dot(r, cross(rs, rt)); } }
  const cap = (R) => { let a = 0; for (let k = 1; k < R.length - 1; k++) a += dot(R[0], cross(sub(R[k], R[0]), sub(R[k + 1], R[0]))) / 2; return a; };
  return Math.abs((side + cap(Q) - cap(P)) / 3);
}
const geometricClosedForm = (doc) => { // exact volume of the loft when the guard found one unique parallel matching, else undefined
  const f = doc.features.find((x) => x.kind === 'blend'); if (!f || f.targets.length !== 2) return undefined;
  const sk = f.targets.map((t) => doc.features.find((x) => x.id === t));
  if (sk.some((s) => s.shape === 'circle')) return undefined;
  const o = sk.map((s) => arc.outlineOf(s)); if (o.some((x) => !x.ok || Object.values(x.bulges ?? {}).some(Boolean))) return undefined;
  if (o[0].points.length !== o[1].points.length) return undefined;
  const P = ccwLoop(o[0].points); const Q = ccwLoop(o[1].points); const ps = parallelShifts(P, Q); if (ps.length !== 1) return undefined;
  const n = P.length; const Qs = Q.map((_, i) => Q[(i + ps[0]) % n]); const h = Math.abs((sk[1].offset ?? 0) - (sk[0].offset ?? 0));
  return ruledVolume3D(P.map(([x, y]) => [x, y, 0]), Qs.map(([x, y]) => [x, y, h]));
};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const R1 = JSON.parse(readFileSync(path.join(HERE, 'blend-loft.measure-results.json'), 'utf8'));
const rows = [];
for (const r of R1) {
  if (r.noBlend) { rows.push({ id: r.id, noBlend: true, scriptErrors: r.scriptErrors }); continue; }
  const g = guardedRun(r.src, { runScript, solveDoc, arc });
  const v = [...g.verdicts.values()][0] ?? null;
  const dTO = r.D?.truckVsOcct?.vol; const dTA = r.D?.truckVsAnalytic; const dOA = r.D?.occtVsAnalytic;
  const curved = r.faces !== undefined ? false : /circle|round|arc/.test(r.src);
  const bar = /circle|round|arc|slot|geom/.test(r.src) ? 3e-4 : 1e-9;
  const truckBuilt = r.truck?.volume !== undefined; const occtBuilt = r.occt?.volume !== undefined;
  // truth: exact = truck built, OCCT built, truck within bar of OCCT (and of the closed form when the case has one)
  // the round-1 'analytic' of a few shifted-start cases was the INDEX-pairing closed form, which OCCT and truck do not follow (round 3): the geometric closed form replaces it
  const geo = geometricClosedForm(g.doc);
  const dTG = geo !== undefined && truckBuilt ? rel(r.truck.volume, geo) : undefined; const dOG = geo !== undefined && occtBuilt ? rel(r.occt.volume, geo) : undefined;
  const exact = truckBuilt && occtBuilt && dTO <= bar && (geo !== undefined ? dTG <= bar && dOG <= bar : (dTA === undefined || r.analytic?.shifts || dTA <= bar));
  rows.push({ id: r.id, group: r.group, guard: v?.code ?? null, sentence: v?.sentence ?? null, truckBuilt, occtBuilt, dTO, dTA, dTG, dOG, geo, bar, exact, truckRefusal: r.truck?.refused ?? null });
}
const real = rows.filter((x) => !x.noBlend);
const pass = real.filter((x) => !x.guard);
const falsePass = pass.filter((x) => x.truckBuilt && !x.exact);
const passNoOracle = pass.filter((x) => !x.truckBuilt || !x.occtBuilt);
const overRef = real.filter((x) => x.guard && x.exact);
const refWrong = real.filter((x) => x.guard && x.truckBuilt && !x.exact);
const refNoBuild = real.filter((x) => x.guard && !x.truckBuilt);
const summary = { cases: R1.length, withBlend: real.length, scriptHalted: rows.length - real.length, guardPass: pass.length, guardPassExact: pass.filter((x) => x.exact).length, FALSE_PASS: falsePass.map((x) => x.id), passWithoutOracle: passNoOracle.map((x) => x.id), refusedWhichWouldBeWrong: refWrong.length, refusedButExact_overRefusal: overRef.map((x) => `${x.id}[${x.guard}]`), refusedWhereTruckRefusedToo: refNoBuild.length };
console.log(JSON.stringify(summary, null, 1));
for (const x of real) console.log(`${x.id.padEnd(48)} guard=${(x.guard ?? 'PASS').padEnd(10)} truckBuilt=${x.truckBuilt} exact=${x.exact} dT/O=${x.dTO?.toExponential?.(1)} dT/An=${x.dTA?.toExponential?.(1)}`);
writeFileSync(path.join(HERE, 'blend-loft.r1-guard.json'), JSON.stringify({ summary, rows }, null, 1));
