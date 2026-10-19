// Round 4: how far do SolidCraft's tessellation-derived numbers sit from OCCT's, measured in units of the CURVED OPERAND, not of the result?
// For every recorded case that built something with a curved face (guarded runs of rounds 3, fuzz seeds 7/11/13/17), print
//   dV/Vscale with Vscale = max(V_occt, A_occt * Rc / 3)     (the tessellation error of a curved patch grows with the patch area times the radius, not with the volume left over)
//   dB/Rc             (absolute bbox miss over the largest curved radius)
// Rc = largest radius among the cylinder / sphere / cone / torus (ring + tube) / rounded-box features of the case; falls back to half the largest bbox extent of the OCCT result.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES } from '../boolean-cases.mjs';
await import('../boolean-cases-r2.mjs'); await import('../boolean-cases-r3.mjs'); await import('../boolean-cases-r4.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url)); const REPO = path.join(HERE, '..', '..', '..', '..', '..');
const { runScript } = await import(pathToFileURL(path.join(REPO, 'packages/script/dist/reshape-script.js')).href);
const dirs = process.argv.slice(2);
const featsOf = new Map();
for (const c of CASES) { try { featsOf.set(c.id, c.script !== undefined ? runScript(c.script).doc.features : c.features); } catch { /* skip */ } }
const radiusOf = (f) => (f.kind === 'cylinder' || f.kind === 'sphere' || f.kind === 'cone' ? f.radius : f.kind === 'torus' ? f.ringRadius + f.tubeRadius : f.round ? f.round : 0);
const rows = [];
for (const d of dirs) for (const f of readdirSync(path.join(HERE, '..', d, 'cases'))) {
  const r = JSON.parse(readFileSync(path.join(HERE, '..', d, 'cases', f), 'utf8'));
  if (!r.truck || !r.occt || !r.truck.bbox || r.truck.refused) continue;
  const feats = featsOf.get(r.id) ?? r.features ?? [];
  let Rc = Math.max(0, ...feats.map(radiusOf));
  const ext = Math.max(...[0, 1, 2].map((i) => r.occt.bbox[i + 3] - r.occt.bbox[i]));
  if (!Rc && r.truck.curved) Rc = ext / 2;
  if (!r.truck.curved) continue;
  const V = r.occt.volume; const A = r.occt.area; const Vs = Math.max(V, A * Rc / 3);
  const dVabs = Math.abs(r.truck.volume - V); const dB = Math.max(...r.truck.bbox.map((v, i) => Math.abs(v - r.occt.bbox[i])));
  const dA = r.truck.area == null ? 0 : Math.abs(r.truck.area - A);
  rows.push({ id: r.id, outcome: r.outcome, Rc, V, A, dV_rel_result: dVabs / Math.max(V, 1), dV_over_Vscale: dVabs / Vs, dB_over_Rc: dB / Math.max(Rc, 1), dB_abs: dB, dA_over_A: dA / A, oldTol: r.truck.tol });
}
rows.sort((a, b) => b.dV_over_Vscale - a.dV_over_Vscale);
const q = (k, p) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
console.log('curved cases', rows.length);
for (const k of ['dV_rel_result', 'dV_over_Vscale', 'dB_over_Rc', 'dA_over_A']) console.log(k.padEnd(18), 'median', q(k, 0.5).toExponential(1), 'p90', q(k, 0.9).toExponential(1), 'p99', q(k, 0.99).toExponential(1), 'max', q(k, 0.9999).toExponential(1));
console.log('top by dV/Vscale:'); for (const r of rows.slice(0, 8)) console.log(' ', r.id.padEnd(34), r.outcome, 'dV/Vs', r.dV_over_Vscale.toExponential(1), 'dV/V', r.dV_rel_result.toExponential(1), 'dB/Rc', r.dB_over_Rc.toExponential(1), 'V', r.V.toFixed(2));
const byB = [...rows].sort((a, b) => b.dB_over_Rc - a.dB_over_Rc); console.log('top by dB/Rc:'); for (const r of byB.slice(0, 8)) console.log(' ', r.id.padEnd(34), r.outcome, 'dB/Rc', r.dB_over_Rc.toExponential(1), 'dB abs', r.dB_abs.toExponential(1), 'dV/Vs', r.dV_over_Vscale.toExponential(1));
writeFileSync(path.join(HERE, 'tol-stats.json'), JSON.stringify(rows));
