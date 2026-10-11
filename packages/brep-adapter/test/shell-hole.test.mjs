// A cut through a SHELL RESULT must measure exactly (closed forms). Before the
// hole_wire handedness fix, hole(shell(b)) measured 10849.31 for an exact
// 11150.90 with refusals empty: the inner void's reversed faces took a hole
// wire that wound the same way as their outer loop, so the area was added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function measure(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const doc = JSON.stringify(r.doc);
  const last = r.doc.features.at(-1).id;
  const refusals = JSON.parse(brep.build_doc_json(doc)).refusals ?? {};
  return { v: JSON.parse(brep.measure_doc(doc)).shapes[last]?.volume, refusals };
}
const C = "const b = cuboid(40, 40, 20); const s = shell(b, { wall: 2 }); ";
const O = "const b = cuboid(40, 40, 20); const s = shell(b, { wall: 2, open: 'top' }); ";
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);
const pi = Math.PI;

test('through hole in a closed shell removes the two walls only', () => {
  const r = measure(C + 'hole(s, { across: 6 })');
  assert.deepEqual(r.refusals, {});
  near(r.v, 11264 - 36 * pi, 'closed d6');
});
test('four holes, counterbore and countersink through a closed shell', () => {
  near(measure(C + 'holes(s, { across: 6, apart: [20, 20] })').v, 11264 - 144 * pi, 'holes');
  near(measure(C + 'hole(s, { across: 6, counterbore: { across: 12, deep: 3 } })').v, 11264 - 90 * pi, 'cbore');
  near(measure(C + 'hole(s, { across: 6, countersink: { across: 12, angle: 90 } })').v,
    11264 - (2 / 3 * 76 + 18) * pi, 'csink');
});
test('hole through an open-top shell removes the floor bore only', () => {
  near(measure(O + 'hole(s, { across: 6 })').v, 8672 - 18 * pi, 'open d6');
});
test('a pocket into a shell is exact or refused, never wrong', () => {
  const r = measure(C + "const k = sketch('top', 10); k.rect(10, 10); pocket(k, s, 5)");
  if (Object.keys(r.refusals).length === 0) near(r.v, 11264 - 200, 'pocket');
  const o = measure(O + "const k = sketch('top', 10); k.rect(10, 10); pocket(k, s, 5)");
  near(o.v, 8672, 'pocket in the void');
});
