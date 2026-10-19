// A circle written as a geom row is ONE cylinder wall, the way sk.circle() is: a ring of two geom circles has 4 faces and a plate with a
// round geom hole has 7 (FreeCAD 26.3rc1), where the kernel gave 6 and 8 with each wall in two half-cylinders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function measure(src) {
  const r = runScript(src);
  assert.deepEqual(r.errors, []);
  const j = JSON.stringify(r.doc);
  assert.deepEqual(JSON.parse(brep.build_doc_json(j)).refusals, {});
  const id = r.doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(j)).shapes[id];
  const mesh = JSON.parse(brep.mesh_feature(j, id, 0.01));
  const edges = new Map();
  const key = (i) => [0, 1, 2].map((k) => Math.round(mesh.positions[i * 3 + k] * 1e5)).join(',');
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(mesh.indices[t + e]), b = key(mesh.indices[t + (e + 1) % 3]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  return { m, closed: [...edges.values()].every((n) => n === 2) };
}

// reference values measured in FreeCAD 26.3rc1 (volume, faces, bbox)
const cases = [
  ['ring of two geom circles', "const sk = sketch('top'); sk.geom([{ k: 'circle', id: 1, c: [0, 0], r: 20 }, { k: 'circle', id: 2, c: [0, 0], r: 10 }]); extrude(sk, 15);",
    14137.16694, 4, [-20, -20, 0, 20, 20, 15]],
  ['plate with a round geom hole',
    "const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [40, 0] }, { k: 'line', id: 2, a: [40, 0], b: [40, 30] }, { k: 'line', id: 3, a: [40, 30], b: [0, 30] }, { k: 'line', id: 4, a: [0, 30], b: [0, 0] }, { k: 'circle', id: 5, c: [12, 15], r: 5 }]); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }]); extrude(sk, 12);",
    13457.5222, 7, [0, 0, 0, 40, 30, 12]],
];
for (const [name, src, vol, faces, bbox] of cases) {
  test(`${name}: one wall per circle, FreeCAD's volume, bbox and face count, closed mesh`, () => {
    const { m, closed } = measure(src);
    assert.ok(Math.abs(m.volume - vol) / vol < 1e-6, `${m.volume} vs ${vol}`);
    assert.equal(m.faces, faces);
    const got = [...m.bbox[0], ...m.bbox[1]];
    bbox.forEach((x, i) => assert.ok(Math.abs(x - got[i]) < 1e-6, `bbox ${got}`));
    assert.ok(closed, 'mesh has an unpaired edge');
  });
}
