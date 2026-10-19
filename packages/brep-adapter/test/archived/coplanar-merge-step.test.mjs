// W4: a part whose coplanar faces the boolean merged still exports to STEP and reads back valid in OpenCascade at the
// same volume. The last script is the one that found a defect: four discs of one pattern, the first and third
// TANGENT, the neck between them covered by a copy: merging the cap's pieces made an outline touching itself (a pinched
// wire, STEP read-back invalid), so the merge declines there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRoundTrip, okRead } from './step-readback-lib.mjs';

const c = (w, d, h, x, y, z) => `cuboid(${w}, ${d}, ${h}, { at: [${x}, ${y}, ${z}] })`;
const scripts = {
  'corner notch': `const s = subtract(${c(40, 40, 20, 0, 0, 10)}, ${c(20, 20, 20, -20, -20, 20)})`,
  'L bracket': `const s = union(${c(40, 10, 20, 20, 5, 10)}, ${c(10, 40, 20, 5, 20, 10)})`,
  'two cubes side by side': `const s = union(${c(20, 20, 20, 10, 10, 10)}, ${c(20, 20, 20, 30, 10, 10)})`,
  'overlapping slabs (a plus)': `const s = union(${c(60, 20, 10, 0, 0, 5)}, ${c(20, 60, 10, 0, 0, 5)})`,
  'overlapping copies in a repeat': 'let v = box(30.82, 46.27, 42.45, { at: [-8.18, -3.55, 8.58] })\nrepeat(v, { count: 3, step: [24.51, -5.78, 0] })',
  'a mirrored cylinder repeated (tangent discs, pinched outline)':
    'let v = cylinder(32.19, 13.7, { at: [0, 0, 0] })\nv = mirror(v, \'front-back\')\nrepeat(v, { count: 2, step: [18.19, -8.81, 0] })',
  'two overlapping cylinders': 'let v = cylinder(30, 10, { at: [0, 0, 0] })\nrepeat(v, { count: 2, step: [20, 0, 0] })',
};

for (const [name, code] of Object.entries(scripts)) {
  test(`STEP reads back valid: ${name}`, () => {
    const r = stepRoundTrip(code);
    assert.ok(!r.scriptError && !r.buildRefused && !r.refused, JSON.stringify(r.scriptError ?? r.buildRefused ?? r.refused));
    assert.ok(okRead(r, 1e-7), `read back: ${JSON.stringify({ got: r.got, dv: r.dv, db: r.db })}`);
  });
}
