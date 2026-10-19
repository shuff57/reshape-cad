// round 4: the rows the critic found missing. turn-then-mirror, hole on a cone after move/turn, face-count deltas of holes in prism / cylinder through move and turn,
// and what keep() shows when the parts do not meet. Per shown shape: live OCCT (or its exception), brep-rs, guard translator, shipped phase0 translator.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r4-misc.mjs [--only=id,id]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { runCase, runScript, mt, solveDoc, brep, runSC, f } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
import { translateDoc as shipped } from '../../phase0/translate.mjs';
const REPO = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', '..');
const arc = await import(pathToFileURL(path.join(REPO, 'packages/sketch/dist/sketch-arc.js')).href);
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const C = {
  // turn then mirror
  'mir-turn30-frontback': `const a = box(30, 20, 10);\nturn(a, [0, 0, 30]);\nmirror(a, 'front-back');`,
  'mir-turn30-leftright': `const a = box(30, 20, 10, { at: [20, 0, 0] });\nturn(a, [0, 0, 30]);\nmirror(a, 'left-right');`,
  'mir-hole-turn-mirror': `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nturn(a, [0, 0, 30]);\nmirror(a, 'front-back');`,
  'mir-turn90-frontback (flat face on the plane)': `const a = box(30, 20, 10);\nturn(a, [0, 0, 90]);\nmirror(a, 'front-back');`,
  'mir-control-mirror-then-turn': `const a = box(30, 20, 10);\nconst m = mirror(a, 'front-back');\nturn(m, [0, 0, 30]);`,
  'mir-control-move-then-mirror': `const a = box(30, 20, 10);\nmove(a, [0, 5, 0]);\nmirror(a, 'front-back');`,
  // hole in a cone
  'cone-hole': `const a = cone(14, 18);\nhole(a, { across: 3 });`,
  'cone-move-hole': `const a = cone(14, 18);\nmove(a, [5, 5, 5]);\nhole(a, { across: 3 });`,
  'cone-turn-hole': `const a = cone(14, 18);\nturn(a, [0, 30, 0]);\nhole(a, { across: 3 });`,
  'cone-hole-move': `const a = cone(14, 18);\nhole(a, { across: 3 });\nmove(a, [5, 5, 5]);`,
  'cone-hole-turn': `const a = cone(14, 18);\nhole(a, { across: 3 });\nturn(a, [0, 30, 0]);`,
  // face-count deltas
  'prism8-hole': `const a = prism(8, 30, 12);\nhole(a, { across: 5 });`,
  'prism8-hole-move': `const a = prism(8, 30, 12);\nhole(a, { across: 5 });\nmove(a, [10, 5, 3]);`,
  'prism8-hole-turn': `const a = prism(8, 30, 12);\nhole(a, { across: 5 });\nturn(a, [20, 30, 40]);`,
  'prism6-hole-move': `const a = prism(6, 30, 12);\nhole(a, { across: 5 });\nmove(a, [10, 5, 3]);`,
  'prism5-hole-turn': `const a = prism(5, 30, 12);\nhole(a, { across: 5 });\nturn(a, [20, 30, 40]);`,
  'cyl-hole': `const a = cylinder(30, 12);\nhole(a, { across: 5 });`,
  'cyl-hole-move': `const a = cylinder(30, 12);\nhole(a, { across: 5 });\nmove(a, [10, 5, 3]);`,
  'cyl-hole-turn': `const a = cylinder(30, 12);\nhole(a, { across: 5 });\nturn(a, [20, 30, 40]);`,
  'cyl-offaxis-hole-turn': `const a = cylinder(30, 12);\nhole(a, { across: 5, at: [6, 3] });\nturn(a, [20, 30, 40]);`,
  // keep / cut with no overlap
  'keep-disjoint': `const a = box(10, 10, 10);\nconst b = box(10, 10, 10, { at: [40, 0, 0] });\nkeep(a, b);`,
  'keep-disjoint-by-move': `const a = box(10, 10, 10);\nconst b = box(10, 10, 10, { at: [5, 0, 0] });\nmove(b, [60, 0, 0]);\nkeep(a, b);`,
  'keep-disjoint-by-turn': `const a = box(40, 4, 4);\nconst b = box(40, 4, 4, { at: [0, 8, 0] });\nturn(b, [0, 0, 90]);\nkeep(a, b);`,
  'cut-disjoint': `const a = box(10, 10, 10);\nconst b = box(10, 10, 10, { at: [40, 0, 0] });\ncut(a, b);`,
  'keep-overlap (control)': `const a = box(10, 10, 10);\nconst b = box(10, 10, 10, { at: [5, 0, 0] });\nkeep(a, b);`,
  'keep-touching-face': `const a = box(10, 10, 10);\nconst b = box(10, 10, 10, { at: [10, 0, 0] });\nkeep(a, b);`,
};
const out = [];
for (const [name, script] of Object.entries(C)) {
  if (only.length && !only.includes(name)) continue;
  const r0 = runScript(script);
  if (r0.errors.length) { console.log(name, 'SCRIPT ERROR', r0.errors[0].message); out.push({ name, script, scriptErrors: r0.errors.map((e) => e.message) }); continue; }
  const ids = mt.topLevel(r0.doc).map((x) => x.id).filter((id) => { const ft = r0.doc.features.find((x) => x.id === id); return ft.kind !== 'sketch' && ft.kind !== 'datum'; });
  const id = ids[ids.length - 1];
  const row = { name, script, shown: ids, last: id };
  let g; let s;
  try { g = runCase({ script, ids, translateFn: guard }); s = runCase({ script, ids, translateFn: shipped }); } catch (e) {
    // OCCT threw: take truck + brep-rs without it
    row.occtException = String(e.message ?? e).slice(0, 200);
    const doc = solveDoc(r0.doc);
    const resolveAt = (prefix, nm) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(nm))); } catch { return null; } };
    const tg = guard(doc, { arc, mt, runSC, resolveAt }); const ts = shipped(doc, { arc, mt, runSC, resolveAt });
    let bj; try { bj = JSON.parse(brep.measure_doc(JSON.stringify(r0.doc))); } catch (e2) { bj = { error: e2.message }; }
    const pick = (t) => { const x = t.features.find((q) => q.id === id); return x?.status === 'built' ? { built: true, volume: x.measure.volume, faces: x.measure.faces, bodies: x.measure.bodies.length } : { refused: x?.refusal ?? 'not built' }; };
    row.guard = pick(tg); row.shipped = pick(ts); row.brep = bj.shapes?.[id] ? { volume: bj.shapes[id].volume, faces: bj.shapes[id].faces } : { refused: bj.refusals?.[id] ?? bj.error ?? 'none' };
    console.log(name.padEnd(46), 'OCCT-EXCEPTION', row.occtException.slice(0, 80), '| brep', JSON.stringify(row.brep).slice(0, 120), '| guard', JSON.stringify(row.guard).slice(0, 160), '| shipped', JSON.stringify(row.shipped).slice(0, 160));
    out.push(row); continue;
  }
  const mk = (r, nm) => { const t = r.truck[id]; return t.refused ? { verdict: 'REFUSED', refused: t.refused } : { verdict: verdict(r, id), dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom, faces: t.faces, occtFaces: t.occtFaces, faceTypes: t.faceTypes, occtTypes: t.occtTypes, faceKeys: t.faceKeys, volume: t.volume, bodies: t.bodies?.length }; };
  row.occt = g.occt[id] ? { volume: g.occt[id].volume, faces: g.occt[id].faces, types: g.occt[id].types } : { refusal: g.occtRefusals[id] ?? 'no shape' };
  row.brep = g.brep[id]; row.guard = mk(g); row.shipped = mk(s);
  row.guardFeatures = g.truckFeatures.map((x) => `${x.id}:${x.status}`).join(' ');
  out.push(row);
  const d = (x) => (x.verdict === 'REFUSED' ? `REFUSED "${x.refused}"` : `${x.verdict} dVol ${f(x.dVol)} dCom ${f(x.dCom)} faces ${x.faces}/${x.occtFaces}${x.faceKeys && Object.values(x.faceKeys).some((v) => v !== 'equal') ? ' ' + JSON.stringify(x.faceKeys) : ''}`);
  console.log(name.padEnd(46), 'OCCT', row.occt.refusal ? 'REFUSED ' + row.occt.refusal : row.occt.volume.toFixed(2), '| brep', row.brep.refused ? 'REFUSED ' + String(row.brep.refused).slice(0, 60) : `dVol ${f(row.brep.dVol)} faces ${row.brep.faces}`, '| guard', d(row.guard), '| shipped', d(row.shipped));
}
writeFileSync('r4-misc-results.json', JSON.stringify(out, null, 1));
