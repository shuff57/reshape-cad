// blend-loft ROUND 5: is the ~1e-7 bbox disagreement between OCCT and truck specific to a loft? Measures the bbox of the same kind of solid built five ways, OCCT (BRepBndLib.AddOptimal, as phase0 uses)
// and truck, against the exact extent.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.r5-bbox.mjs [--out=<file.json>]
import { writeFileSync } from 'node:fs';
import { runScript, solveDoc, occtMeasure, truckMeasure } from './blend-loft.live-lib.mjs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const E = (x) => (typeof x === 'number' ? x.toExponential(2) : String(x));
const via = (src) => { const r = runScript(src); return { doc: solveDoc({ version: 1, features: r.doc.features }), last: r.doc.features[r.doc.features.length - 1].id, errors: r.errors.map((e) => e.message) }; };
const cases = [
  ['cuboid(40,30,10)', 'cuboid(40, 30, 10);', null],
  ['pull rect 40x30 by 10', "const a = sketch('top'); a.rect(40, 30); pull(a, 10);", [-20, -15, 0, 20, 15, 10]],
  ['pull polygon L by 10', "const a = sketch('top'); a.polygon([[0,0],[40,0],[40,10],[10,10],[10,30],[0,30]]); pull(a, 10);", [0, 0, 0, 40, 30, 10]],
  ['pull circle d40 by 10', "const a = sketch('top'); a.circle(40); pull(a, 10);", [-20, -20, 0, 20, 20, 10]],
  ['loft rect 40x30 -> rect 20x15 gap 10', "const a = sketch('top'); a.rect(40, 30); const b = sketch('top'); b.rect(20, 15); loft(a, b, 10);", [-20, -15, 0, 20, 15, 10]],
  ['loft rect 40x40 -> rect 10x10 gap 30', "const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); loft(a, b, 30);", [-20, -20, 0, 20, 20, 30]],
  ['loft circle d40 -> circle d20 gap 30', "const a = sketch('top'); a.circle(40); const b = sketch('top'); b.circle(20); loft(a, b, 30);", [-20, -20, 0, 20, 20, 30]],
];
const rows = [];
for (const [label, src, exact] of cases) {
  const s = via(src); if (s.errors.length) { console.log(label, 'SCRIPT ERROR', s.errors); continue; }
  const o = occtMeasure(s.doc, s.last); let t; try { t = truckMeasure(s.doc, s.last); } catch (e) { t = { refused: e.message }; }
  const ref = exact ?? o.bbox; // for the cuboid the exact extent is read from the symmetric truck box
  const pad = (b) => (b && exact ? Math.max(...b.map((v, i) => Math.abs(v - exact[i]))) : null);
  const row = { label, occtBbox: o.bbox, truckBbox: t.bbox, exactExtent: exact, occtPad: pad(o.bbox), truckPad: pad(t.bbox), occtMinusTruck: o.bbox && t.bbox ? Math.max(...o.bbox.map((v, i) => Math.abs(v - t.bbox[i]))) : null, ref };
  rows.push(row);
  console.log(`${label.padEnd(40)} OCCT-vs-exact ${E(row.occtPad)} truck-vs-exact ${E(row.truckPad)} OCCT-vs-truck ${E(row.occtMinusTruck)}`);
}
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
