// A chamfer of one edge cuts only the lump that owns it. On a mirrored part (two lumps that touch)
// the cutting wedge also reached the neighbour and shaved it (perm#4771s2 of the wrong-solid sweep).
// Exact: the wedge removes 6.9^2/2 x 50.39 = 1199.5 from the part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

test('chamfer on a mirrored, turned box removes exactly the wedge of its own lump', () => {
  const code = `let v = box(38.15, 50.39, 42.62, { at: [0, 0, 0] });
turn(v, [30, 30, 30]);
v = mirror(v, "front-back");
const plain = v;
bevel(v.edge("top", "left"), 6.9)`;
  const r = runScript(code);
  assert.deepEqual(r.errors, []);
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(r.doc)));
  assert.deepEqual(out.refusals, {});
  const ids = r.doc.features.map((f) => f.id);
  const vol = (id) => JSON.parse(brep.measure_doc(JSON.stringify(r.doc))).shapes[id].volume;
  const before = vol(ids.at(-2));
  const after = vol(ids.at(-1));
  assert.ok(Math.abs(before - after - (6.9 * 6.9 / 2) * 50.39) < 1e-3, `removed ${before - after}`);
});

// An edge that runs on across the mirror plane is ONE edge to the student (OCCT chamfers it whole) but two
// collinear edges to brep-rs, one per lump. Chamfering only the owner's half is a wrong solid (599.5 where
// OCCT, and the whole edge, give 599): it must refuse in a sentence, or cut both halves exactly.
test('chamfer of an edge continuing across a mirror plane is refused or exact, never half-cut', () => {
  const code = `let v = box(1, 30, 10, { at: [1, 1, 1] })
v = mirror(v, 'left-right')
bevel(v.edge('bottom', 'front'), 1)`;
  const r = runScript(code);
  assert.deepEqual(r.errors, []);
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(r.doc)));
  const ids = r.doc.features.map((f) => f.id);
  const last = ids.at(-1);
  if (out.refusals?.[last]) {
    assert.match(String(out.refusals[last]), /chamfer/);
    return;
  }
  const vol = JSON.parse(brep.measure_doc(JSON.stringify({ ...r.doc, measure: last }))).shapes[last].volume;
  assert.ok(Math.abs(vol - 599) < 1e-6, `volume ${vol}`);
});
