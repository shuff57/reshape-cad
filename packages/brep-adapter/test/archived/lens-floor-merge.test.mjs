// Two blind round pockets that overlap leave their common floor in coplanar pieces (a lens and two crescents). One flat floor
// is ONE face: FreeCAD 26.3rc1 gives 9 faces for two copies and 11 for three, where the kernel gave 11 and 13.
// The merge needs the outer loop of a loop of two arcs, which has no area from its chords.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function measure(d, st, depth, count) {
  const r = runScript(`const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,20],[0,20]]); const plate = extrude(s1, 10); const p1 = sketch('top', 10); p1.circle(${d}, { at: [10, 10] }); const pk = pocket(p1, plate, ${depth}); linearPattern(pk, { count: ${count}, step: ${st} });`);
  assert.deepEqual(r.errors, []);
  const j = JSON.stringify(r.doc);
  assert.deepEqual(JSON.parse(brep.build_doc_json(j)).refusals, {});
  return JSON.parse(brep.measure_doc(j)).shapes[r.doc.features.at(-1).id];
}

// reference values measured in FreeCAD 26.3rc1 (volume, faces)
const cases = [
  [12, 8, 4, 2, 11194.34074232971, 9],
  [10, 6, 4, 2, 11461.14051288236, 9],
  [12, 8, 10, 2, 9985.851855824278, 8],
  [12, 8, 4, 3, 10841.07082677635, 11],
];
for (const [d, st, depth, count, vol, faces] of cases) {
  test(`overlapping blind circles d${d} step ${st} depth ${depth} x${count} match FreeCAD`, () => {
    const m = measure(d, st, depth, count);
    assert.ok(Math.abs(m.volume - vol) / vol < 1e-6, `${m.volume} vs ${vol}`);
    assert.equal(m.faces, faces);
  });
}
