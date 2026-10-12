// A countersink's angle is its INCLUDED cone angle, and real countersinks run past 90:
// 100 and 120 degrees are standard, and FreeCAD's Hole takes anything under 180. Closed
// form: the cone is a frustum from radius across/2 down to the bore's radius, over
// depth (across/2 - bore/2) / tan(angle/2), cut from a plate, so
//   V = plate - pi*bore^2*t/4 ... (bore) - frustum above the bore.
// The FreeCAD numbers were read from freecadcmd (PartDesign::Hole, Flat drill point,
// 40 x 30 x 10 plate, 5 hole, countersink 14):
//   120 -> 11656.732710647666 (8 faces), 150 -> 11735.465694778006, 170 -> 11781.387305999597,
//   179 -> 11801.429741787673 (all 8 faces).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

const PLATE = 'const b = cuboid(40, 30, 10, { at: [20, 15, 5] });';

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  const m = JSON.parse(brep.measure_doc(j));
  return { refusals, s: m.shapes[r.doc.features.at(-1).id], j };
}
const exact = (angle, across = 14, bore = 5, t = 10) => {
  const R = across / 2, r = bore / 2;
  const dp = (R - r) / Math.tan((angle / 2) * Math.PI / 180);
  return 40 * 30 * t - Math.PI * r * r * t - (Math.PI * dp / 3) * (R * R + R * r + r * r - 3 * r * r);
};
const FREECAD = { 120: 11656.732710647666, 150: 11735.465694778006, 170: 11781.387305999597, 179: 11801.429741787673 };

for (const angle of [100, 120, 150, 170, 179]) {
  test(`a countersink of ${angle} degrees included builds to its closed form`, () => {
    const { refusals, s, j } = build(`${PLATE}\nhole(b, { across: 5, countersink: { across: 14, angle: ${angle} } })`);
    assert.deepEqual(refusals, {});
    const want = exact(angle);
    assert.ok(Math.abs(s.volume - want) <= 1e-9 * want, `${s.volume} vs closed form ${want}`);
    if (FREECAD[angle] !== undefined) {
      assert.ok(Math.abs(s.volume - FREECAD[angle]) <= 1e-9 * want, `${s.volume} vs FreeCAD ${FREECAD[angle]}`);
    }
    assert.equal(s.faces, 8);
    const step = JSON.parse(brep.export_step(j, JSON.parse(j).features.at(-1).id));
    assert.equal(step.error, undefined);
  });
}

test('nonsense countersink angles still refuse in the script', () => {
  for (const a of [0, -90, 180, 181, 270, 'NaN']) {
    const r = runScript(`${PLATE}\nhole(b, { across: 5, countersink: { across: 14, angle: ${a} } })`);
    assert.equal(r.errors.length, 1, `angle ${a}`);
  }
});

test('a flat cone whose mouth reaches the plate edge refuses in a sentence, never a wrong solid', () => {
  // A 150 degree cone across 40 mm on a 30 mm wide plate runs off the plate; across 30 touches both edges.
  for (const across of [30, 40]) {
    const { refusals, s } = build(`${PLATE}\nhole(b, { across: 5, countersink: { across: ${across}, angle: 150 } })`);
    const sentence = refusals.hole1;
    assert.equal(typeof sentence, 'string', `across ${across} must be refused`);
    assert.ok(sentence.length > 20 && !/\n/.test(sentence));
    assert.equal(s, undefined, 'no solid is built for a refused hole');
  }
});
