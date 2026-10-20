// Round 6 A. The G-HOLLOW false-refusal probe (critic: cylinder(20,30) hollow wall 9.9 was refused as "wall has to be under 10").
// Walls at fractions of the collapse limit min(depth, narrowest lateral / 2) on boxes and cylinders (open top), thin curved cavities included.
// Truth: closed form (feasible iff t < limit). Page = guards off, guarded = G-HOLLOW as in r3-guard.mjs. OCCT is the second oracle for feasible cases.
//   HOME=<dir holding .cache/solidcraft-bridge/target-native/release/solidcraft-cli> bun r6a-hollow-thin.mjs --out=<file>
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { guardedTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r6a-hollow-thin.json';
const rows = [];
const FR = [0.5, 0.9, 0.99, 0.999, 1.0, 1.001, 1.1];
async function one(kind, label, src, limit, t, closedV) {
  const r = L.fromScript(src); if (r.errors.length) { rows.push({ kind, label, scriptError: r.errors[0].message }); return; }
  const feasible = t < limit - 1e-9;
  const id = L.lastSolid(r.doc);
  const page = await guardedTranslate(r.doc, { guards: false, plain: false }); const pf = page.features.find((f) => f.id === id);
  const g = await guardedTranslate(r.doc); const gf = g.features.find((f) => f.id === id);
  let occt = null; if (feasible) { try { const ref = L.references(r.doc); occt = ref.occt?.volume ?? null; } catch { occt = null; } }
  const o = { kind, label, t, limit, feasible, closedV, page: { status: pf.status, V: pf.measure?.volume, faces: pf.measure?.faces }, guarded: { status: gf.status, sentence: gf.refusal, V: gf.measure?.volume }, occtV: occt };
  o.verdict = gf.status === 'refused' ? (feasible ? 'OVER-REFUSAL' : 'REFUSED-OK') : !feasible ? 'SILENT-WRONG' : 'BUILT';
  if (o.verdict === 'BUILT') { const tol = kind === 'cyl' ? 3e-4 : 1e-9; o.dClosed = Math.abs(gf.measure.volume - closedV) / closedV; o.exact = o.dClosed <= tol; }
  rows.push(o);
  console.log(o.verdict, label, 'page', pf.status, pf.measure?.volume?.toFixed?.(3), 'guarded', gf.status, gf.measure?.volume?.toFixed?.(3), 'closed', closedV?.toFixed?.(3) ?? '-');
}
for (const [dia, h] of [[20, 30], [24, 20], [24, 3], [5, 30], [40, 8], [10, 100]]) for (const f of FR) {
  const limit = Math.min(h, dia / 2); const t = +(limit * f).toPrecision(6);
  const R = dia / 2; const V = Math.PI * (R * R * h - (R - t) ** 2 * (h - t));
  await one('cyl', `cylinder(${dia},${h}) open top wall ${t} (${f} of limit ${limit})`, `const c=cylinder(${dia},${h})\nhollow(c,{wall:${t},open:'top'})`, limit, t, t < limit ? V : null);
}
for (const [w, d, h] of [[40, 30, 20], [40, 30, 3], [10, 10, 30]]) for (const f of FR) {
  const limit = Math.min(h, Math.min(w, d) / 2); const t = +(limit * f).toPrecision(6);
  const V = w * d * h - (w - 2 * t) * (d - 2 * t) * (h - t);
  await one('box', `box(${w},${d},${h}) open top wall ${t} (${f} of limit ${limit})`, `const b=box(${w},${d},${h})\nhollow(b,{wall:${t},open:'top'})`, limit, t, t < limit ? V : null);
}
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const c = {}; for (const r of rows) c[r.kind + ' ' + r.verdict] = (c[r.kind + ' ' + r.verdict] ?? 0) + 1;
console.log(JSON.stringify(c), 'built-not-exact', rows.filter((r) => r.exact === false).length);
