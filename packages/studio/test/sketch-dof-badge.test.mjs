// The sketch canvas's DoF badge reads the kernel's own diagnosis (brep-rs sketch/diagnose.rs), so it must say
// what the rank says: a free line 4, a free arc 5 (its ends lie on its circle), a slot 6, a dimensioned rectangle 2;
// and a sketch whose rules cannot all hold must never read "N free to move" or "Fully constrained".
// Real wasm via initSync, the same convention as solve-rows.test.mjs. Imports from ../dist; build first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { SketchSession2D } = await import('@shuff57/reshape-kernel/sketch-session');
const { buildSlotRows } = await import('@shuff57/reshape-sketch/sketch-slot');
const { dofBadge } = await import('../dist/model/sketch-canvas-core.js');

const session = new SketchSession2D();
session.loadFromBytes(brep);
function badgeOf(geoms, rules) {
  assert.equal(session.open(geoms, rules), null);
  session.solve();
  return { d: session.diagnose(), badge: dofBadge(session.diagnose()) };
}
const L = (id, a, b) => ({ k: 'line', id, a, b });

test('dofBadge: the four states', () => {
  assert.deepEqual(dofBadge(null), { cls: '', text: '' });
  assert.deepEqual(dofBadge({ dof: 3, bucket: 'consistent' }), { cls: 'sk-dof-warn', text: '3 free to move' });
  assert.deepEqual(dofBadge({ dof: 2, bucket: 'redundant' }), { cls: 'sk-dof-warn', text: '2 free to move' });
  assert.deepEqual(dofBadge({ dof: 0, bucket: 'consistent' }), { cls: 'sk-dof-ok', text: 'Fully constrained ✓' });
  assert.equal(dofBadge({ dof: 4, bucket: 'conflicting' }).cls, 'sk-dof-bad');
});

test('dofBadge: rules that cannot all hold are red, whatever the dof says (it used to read "Fully constrained")', () => {
  for (const dof of [0, 1, 6]) {
    const b = dofBadge({ dof, bucket: 'globallyInfeasible' });
    assert.equal(b.cls, 'sk-dof-bad');
    assert.match(b.text, /cannot all hold/);
  }
  assert.equal(dofBadge({ dof: 0, bucket: 'error' }).cls, 'sk-dof-bad');
});

test('the badge a free line, a free arc and a slot show: 4, 5 and 6 free to move', () => {
  assert.equal(badgeOf([L(1, [0, 0], [10, 0])], []).badge.text, '4 free to move');
  const arc = { k: 'arc', id: 1, c: [0, 0], r: 5, a: [5, 0], b: [0, 5], sense: 'ccw' };
  assert.equal(badgeOf([arc], []).badge.text, '5 free to move');
  const slot = buildSlotRows([0, 0], [30, 0], 5, 1);
  assert.equal(badgeOf(slot.geoms, slot.rules).badge.text, '6 free to move');
});

test('a dimensioned rectangle reads 2 free to move, and 0 once it is pinned', () => {
  const geoms = [L(1, [0, 0], [40, 0]), L(2, [40, 0], [40, 30]), L(3, [40, 30], [0, 30]), L(4, [0, 30], [0, 0])];
  const weld = [1, 2, 3, 4].map((i) => ({ k: 'coincident', a: i, aEnd: 'b', b: (i % 4) + 1, bEnd: 'a' }));
  const rect = [...weld, { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 },
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }, { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 30 }];
  assert.equal(badgeOf(geoms, rect).badge.text, '2 free to move');
  const pinned = [...rect, { k: 'lock', a: 1, aEnd: 'a' }];
  assert.equal(badgeOf(geoms, pinned).badge.text, 'Fully constrained ✓');
});

test('a chord longer than the circle it sits in shows the red badge, not a count', () => {
  const g = [{ k: 'arc', id: 1, c: [0, 0], r: 5, a: [5, 0], b: [-5, 0], sense: 'ccw' }, L(2, [-5, 0], [5, 0])];
  const r = [
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 1, bEnd: 'a' },
    { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 12 }, { k: 'radius', a: 1, value: 5 }, { k: 'lock', a: 1 },
  ];
  const { d, badge } = badgeOf(g, r);
  assert.notEqual(d.bucket, 'consistent');
  assert.equal(badge.cls, 'sk-dof-bad', JSON.stringify(d));
});

test('a half disc whose closing line is a little under the diameter solves (the solver used to stall and call it conflicting)', () => {
  const g = [{ k: 'arc', id: 1, c: [0, 0], r: 5, a: [5, 0], b: [-5, 0], sense: 'ccw' }, L(2, [-5, 0], [5, 0])];
  for (const len of [9.999, 9.5, 8]) {
    const r = [
      { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 1, bEnd: 'a' },
      { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: len }, { k: 'radius', a: 1, value: 5 }, { k: 'lock', a: 1 },
    ];
    assert.equal(session.open(g, r), null);
    assert.equal(session.solve(), true, `len ${len}: ${session.lastError()}`);
    const { d, badge } = badgeOf(g, r);
    assert.equal(d.bucket, 'consistent', `len ${len}: ${JSON.stringify(d)}`);
    assert.notEqual(badge.cls, 'sk-dof-bad');
  }
});
