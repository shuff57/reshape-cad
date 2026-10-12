// "=plate_t" typed into a Length field that already follows another parameter: pure core.
// The field must bind to plate_t with plate_t's own value, rewriting no parameter, and a name that is not a
// parameter is refused in a sentence. Imports from ../dist; build first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindSlot, paramValueOf, readPaneBinding } from '../dist/model/pad-props-core.js';

const P = (name, value, slots) => ({ name, caption: name, value, min: 0, max: 100, step: 1, slots });
const base = () => [P('wall', 5, ['pull1_height']), P('plate_t', 9, ['pull2_height'])];
const byName = (r, n) => r.params.find((p) => p.name === n);

test('binding to another parameter takes its value and rewrites nobody', () => {
  const live = new Map([['pull1_height', 5], ['pull2_height', 9]]);
  const r = bindSlot(base(), 'pull1_height', 'plate_t', 5, live);
  assert.equal(r.value, 9);
  assert.equal(byName(r, 'plate_t').value, 9);
  assert.deepEqual(byName(r, 'plate_t').slots, ['pull2_height', 'pull1_height']);
  assert.equal(byName(r, 'wall').value, 5);
  assert.deepEqual(byName(r, 'wall').slots, []);
});

test('a slider drag (document ahead of the parameter) wins over the stale copy', () => {
  const live = new Map([['pull1_height', 5], ['pull2_height', 15]]);
  const r = bindSlot(base(), 'pull1_height', 'plate_t', 5, live);
  assert.equal(r.value, 15);
  assert.equal(byName(r, 'plate_t').value, 9, 'its own number is not rewritten by a bind');
});

test('a repeated or stale bind to the same name is idempotent, never a write', () => {
  const live = new Map([['pull1_height', 9], ['pull2_height', 9]]);
  const once = bindSlot(base(), 'pull1_height', 'plate_t', 5, live);
  const twice = bindSlot(once.params, 'pull1_height', 'plate_t', 5 /* the stale field value */, live);
  assert.equal(twice.value, 9);
  assert.equal(byName(twice, 'plate_t').value, 9);
});

test('typing a number into a field that follows its parameter moves the parameter (follow)', () => {
  const live = new Map([['pull1_height', 5]]);
  const r = bindSlot(base(), 'pull1_height', 'wall', 12, live, 'follow');
  assert.equal(r.value, 12);
  assert.equal(byName(r, 'wall').value, 12);
  assert.equal(byName(r, 'plate_t').value, 9);
});

test('freeing a field leaves every parameter value as it was', () => {
  const r = bindSlot(base(), 'pull1_height', null, 12, new Map());
  assert.equal(r.value, 12);
  assert.equal(r.params.some((p) => p.name === 'wall'), false, 'no field left: not declared dead');
  assert.equal(byName(r, 'plate_t').value, 9);
});

test('the input list is never mutated', () => {
  const b = base();
  const snap = JSON.stringify(b);
  bindSlot(b, 'pull1_height', 'plate_t', 5, new Map());
  assert.equal(JSON.stringify(b), snap);
});

test('paramValueOf reads the live slot, else the parameter, else nothing', () => {
  assert.equal(paramValueOf(base(), 'plate_t', new Map([['pull2_height', 15]])), 15);
  assert.equal(paramValueOf(base(), 'plate_t', new Map()), 9);
  assert.equal(paramValueOf(base(), 'nope', new Map()), undefined);
});

test('the pane reads =name, =12 and refuses an unknown name in a sentence', () => {
  const known = ['wall', 'plate_t'];
  const ids = ['sk1', 'pull1'];
  assert.deepEqual(readPaneBinding('=plate_t', known, ids), { kind: 'param', name: 'plate_t' });
  assert.deepEqual(readPaneBinding('=12', known, ids), { kind: 'number', value: 12 });
  const bad = readPaneBinding('=plate_x', known, ids);
  assert.equal(bad.kind, 'error');
  assert.match(bad.why, /plate_x is not a parameter of this model/);
  assert.match(bad.why, /wall, plate_t/);
  assert.equal(readPaneBinding('=pull1', known, ids).kind, 'error');
  assert.equal(readPaneBinding('=', known, ids).kind, 'error');
});
