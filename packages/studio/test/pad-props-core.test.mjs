// pad-props-core.ts: the pure half of the Pad property view. Imports from ../dist; build first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  padPropertyGroups, applyPadProp, formatQuantity, parseQuantity, formatNumber,
} from '../dist/model/pad-props-core.js';

const doc = (features) => ({ version: 1, features });
const sk = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [10, 0], [10, 10], [0, 10]] };
const pad = { id: 'pull1', kind: 'extrude', target: 'sk1', height: 8 };
const d = doc([sk, pad]);
const ctx = { label: 'Pad', suppressed: false, boundTo: () => undefined };
const names = (gs) => gs.map((g) => g.name);
const row = (gs, key) => gs.flatMap((g) => g.rows.flatMap((r) => [r, ...(r.children ?? [])])).find((r) => r.key === key);

test('a pad shows FreeCAD\'s groups in order, Side2 only when two sided', () => {
  assert.deepEqual(names(padPropertyGroups(d, pad, ctx)), ['Base', 'Pad', 'Part Design', 'Side1']);
  const two = { ...pad, length2: 3 };
  assert.deepEqual(names(padPropertyGroups(d, two, ctx)), ['Base', 'Pad', 'Part Design', 'Side1', 'Side2']);
  const g = padPropertyGroups(d, pad, ctx);
  assert.deepEqual(g[1].rows.map((r) => r.label), ['Side Type', 'Use Custom Vector', 'Direction', 'Reference Axis', 'Along Sketch Normal']);
  assert.deepEqual(g[3].rows.map((r) => r.label), ['Type', 'Length', 'Up To Face', 'Up To Shape', 'Offset', 'Taper Angle']);
});

test('the length row carries the value, its unit and the parameter it follows', () => {
  const free = row(padPropertyGroups(d, pad, ctx), 'length');
  assert.equal(free.cell.value, 8);
  assert.equal(free.cell.bound, undefined);
  const bound = row(padPropertyGroups(d, pad, { ...ctx, boundTo: (s) => (s === 'pull1_height' ? 'thickness' : undefined) }), 'length');
  assert.equal(bound.cell.bound, 'thickness');
  assert.equal(formatQuantity(8, 'length'), '8.00 mm');
  assert.equal(formatQuantity(0, 'angle'), '0.00 °');
});

test('formatNumber keeps real digits and parseQuantity converts units', () => {
  assert.equal(formatNumber(8.125), '8.125');
  assert.equal(formatNumber(1 / 3), '0.3333');
  assert.deepEqual(parseQuantity('12', 'length'), { ok: true, value: 12 });
  assert.deepEqual(parseQuantity('2 cm', 'length'), { ok: true, value: 20 });
  assert.deepEqual(parseQuantity('0.5in', 'length'), { ok: true, value: 12.7 });
  assert.deepEqual(parseQuantity('1,5', 'length'), { ok: true, value: 1.5 });
  assert.deepEqual(parseQuantity('45 deg', 'angle'), { ok: true, value: 45 });
  assert.equal(parseQuantity('3 deg', 'length').ok, false);
  assert.equal(parseQuantity('3 mm', 'angle').ok, false);
  assert.equal(parseQuantity('abc', 'length').ok, false);
  assert.equal(parseQuantity('', 'length').ok, false);
});

test('editing a length, side type, taper and direction writes the feature or says why not', () => {
  assert.equal(applyPadProp(d, pad, 'length', 12).feature.height, 12);
  assert.equal(applyPadProp(d, pad, 'length', 0).ok, false);
  assert.equal(applyPadProp(d, pad, 'side', 'symmetric').feature.midplane, true);
  const two = applyPadProp(d, pad, 'side', 'two').feature;
  assert.ok(two.length2 > 0);
  assert.equal(applyPadProp(d, pad, 'taper', 5).feature.taper, 5);
  assert.equal(applyPadProp(d, pad, 'taper', 95).ok, false);
  const custom = applyPadProp(d, pad, 'custom', true).feature;
  assert.deepEqual(custom.direction, [0, 0, 1]);
  assert.deepEqual(applyPadProp(d, custom, 'dirX', 1).feature.direction, [1, 0, 1]);
  assert.equal(applyPadProp(d, pad, 'dirX', 1).ok, false);
  assert.equal(applyPadProp(d, pad, 'label', 'x').ok, false);
});

test('Type: To last resolves to a length, Up to face hands over to the task panel', () => {
  const box = { id: 'b1', kind: 'box', size: [60, 40, 10], center: [0, 0, 0] };
  const sk2 = { ...sk, offset: -20 };
  const d2 = doc([box, sk2, pad]);
  const last = applyPadProp(d2, pad, 'type', 'toLast');
  assert.equal(last.ok, true);
  assert.ok(last.feature.height > 0);
  assert.equal(applyPadProp(d, pad, 'type', 'upToFace').ok, 'open');
  assert.equal(applyPadProp(d, pad, 'type', 'twoLengths').feature.length2 > 0, true);
});
