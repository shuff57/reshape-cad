// S4i (3): a chamfer of an edge that runs on, collinear, across the mirror plane of a mirrored part (or across the
// contact of touching pattern copies). To the student that is ONE edge; to brep-rs it is one edge per lump. S4a made
// it refuse (half-cutting it was a wrong solid: 599.5 where the whole edge gives 599). Now the wedge is cut from EVERY
// lump that owns a piece of the edge, exactly: V = V0 - wedge area x edge length, and OCCT agrees.
// Anything that is not a clean continuation (the same line shared with the next lump's OTHER edge, different faces,
// an oblique end) still refuses in a sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, assertWatertight, assertOcct, assertStep } from './s4i-harness.mjs';

const MIR = (w, axis, edge, size, at = '[4, 1, 1]') => `let v = box(${w}, 30, 10, { at: ${at} })\nv = mirror(v, '${axis}')\nbevel(v.edge('${edge[0]}', '${edge[1]}'), ${size})`;
const REP = (count, edge, size) => `const v = box(8, 30, 10)\nrepeat(v, { count: ${count}, step: [8, 0, 0] })\nbevel(v.edge('${edge[0]}', '${edge[1]}'), ${size})`;
const w = (s) => (s * s) / 2; // wedge area of a 90 degree edge

// [name, script, expected volume]
const ACROSS = [
  ['thin slabs, size 1 (the sweep case: 599, not 599.5)', MIR(1, 'left-right', ['bottom', 'front'], 1, '[1, 1, 1]'), 600 - w(1) * 2],
  ['thin slabs, size 0.4 bottom front', MIR(1, 'left-right', ['bottom', 'front'], 0.4, '[1, 1, 1]'), 600 - w(0.4) * 2],
  ['thin slabs, size 0.4 top back', MIR(1, 'left-right', ['top', 'back'], 0.4, '[1, 1, 1]'), 600 - w(0.4) * 2],
  ['8-wide, left-right, bottom front, size 2', MIR(8, 'left-right', ['bottom', 'front'], 2), 4800 - w(2) * 16],
  ['8-wide, left-right, bottom front, size 3.9', MIR(8, 'left-right', ['bottom', 'front'], 3.9), 4800 - w(3.9) * 16],
  ['8-wide, left-right, bottom front, size 4', MIR(8, 'left-right', ['bottom', 'front'], 4), 4800 - w(4) * 16],
  ['front-back mirror, top left (edge along y)', MIR(8, 'front-back', ['top', 'left'], 2), 4800 - w(2) * 60],
  ['top-bottom mirror, left front (edge along z)', MIR(8, 'top-bottom', ['left', 'front'], 2), 4800 - w(2) * 20],
  ['two touching copies of a box (repeat), bottom front', REP(2, ['bottom', 'front'], 2), 4800 - w(2) * 16],
  ['three touching copies, top front (one edge, three lumps)', REP(3, ['top', 'front'], 2), 7200 - w(2) * 24],
];
for (const [name, code, want] of ACROSS) {
  test(`chamfer across the mirror/contact: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {}, name);
    assert.ok(Math.abs(m.volume - want) <= 1e-9 * want, `${m.volume} vs ${want}`);
  });
}

test('the edge that does not cross the mirror plane is still cut once (no continuation, owner only)', () => {
  const m = mine(MIR(8, 'left-right', ['top', 'right'], 2));
  assert.deepEqual(m.refusals, {});
  assert.ok(Math.abs(m.volume - (4800 - w(2) * 30)) < 1e-9 * 4800, `${m.volume}`);
});

test('an edge that lies on the same line as the next lump\'s OTHER edge still refuses, in a sentence', () => {
  // top-left of the right-hand lump is the very line the left-hand lump calls top-right: not a continuation.
  const m = mine(MIR(8, 'left-right', ['top', 'left'], 2));
  assert.match(m.refusals[m.id] ?? '', /carries on across the mirror or pattern plane/);
  const r = mine(REP(3, ['top', 'right'], 2));
  assert.match(r.refusals[r.id] ?? '', /carries on across/);
});

test('a size that fits both lumps is exact up to the faces\' reach; one that does not refuses, never half-cuts', () => {
  const ok = mine(MIR(8, 'left-right', ['bottom', 'front'], 9));
  assert.deepEqual(ok.refusals, {});
  assert.ok(Math.abs(ok.volume - (4800 - w(9) * 16)) < 1e-9 * 4800, `${ok.volume}`);
  const m = mine(MIR(8, 'left-right', ['bottom', 'front'], 10));
  assert.match(m.refusals[m.id] ?? '', /would not fit its edge/);
  assert.equal(m.volume, 4800, 'the part is shown without the chamfer');
});

// ---- the referee ------------------------------------------------------------------------------------------------
for (const [name, code] of ACROSS) {
  test(`OCCT agrees on volume and bbox: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {});
    assertOcct(m, name);
  });
}

for (const [name, code] of [ACROSS[0], ACROSS[3], ACROSS[6], ACROSS[8], ACROSS[9]]) {
  test(`mesh watertight at 0.05 and 0.5: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {});
    assertWatertight(m, [1e-6, 1e-6], true);
  });
}

for (const [name, code] of [ACROSS[3], ACROSS[7], ACROSS[8]]) {
  test(`STEP round trip: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {});
    // two lumps: the read-back counts one solid per lump
    const f = JSON.parse(brepExport(m));
    assert.ok(f.step, JSON.stringify(f).slice(0, 200));
    const back = readBack(f.step);
    assert.ok(Math.abs(back.volume - m.volume) < 1e-6 * m.volume, `${back.volume} vs ${m.volume}`);
    assert.equal(back.valid, true);
  });
}

import { brep, readStep } from './s4i-harness.mjs';
function brepExport(m) {
  return brep.export_step(m.json, m.id);
}
function readBack(step) {
  return readStep(step);
}
