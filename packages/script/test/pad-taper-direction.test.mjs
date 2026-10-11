// Taper angle and custom direction on pull() / pocket(): the language, the round trip, and the refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const feat = (r, kind) => r.doc.features.filter((f) => f.kind === kind);

test('pull takes taper, direction and alongNormal and stores them', () => {
  const r = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6, { taper: 5, });`);
  assert.deepEqual(r.errors, []);
  assert.equal(feat(r, 'extrude')[0].taper, 5);
  const r2 = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6, { direction: [1, 0, 1], alongNormal: false });`);
  assert.deepEqual(r2.errors, []);
  assert.deepEqual(feat(r2, 'extrude')[0].direction, [1, 0, 1]);
  assert.equal(feat(r2, 'extrude')[0].alongNormal, false);
});

test('the options survive toScript and run back to the same feature, for a pad and a pocket', () => {
  const src = `const s = sketch('top'); s.rect(40, 30, { at: [20, 15] });
const plate = extrude(s, 10, { taper: -3 });
const s2 = sketch('top', 10); s2.rect(8, 8, { at: [20, 15] });
pocket(s2, plate, 3, { direction: [0, 1, -1] });`;
  const r = runScript(src);
  assert.deepEqual(r.errors, []);
  const again = runScript(toScript(r.doc));
  assert.deepEqual(again.errors, []);
  assert.deepEqual(feat(again, 'extrude')[0], feat(r, 'extrude')[0]);
  assert.deepEqual(feat(again, 'pocket')[0], feat(r, 'pocket')[0]);
  assert.match(toScript(r.doc), /taper: -3/);
  assert.match(toScript(r.doc), /direction: \[0, 1, -1\]/);
});

test('a plain pad does not gain the words', () => {
  const r = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6);`);
  assert.doesNotMatch(toScript(r.doc), /taper|direction|alongNormal/);
});

test('nonsense is refused in a sentence', () => {
  for (const [opts, re] of [
    ['{ taper: 120 }', /between -90 and 90/],
    ['{ taper: "x" }', /taper/],
    ['{ direction: [0, 0, 0] }', /points nowhere/],
    ['{ direction: [1, 2] }', /three numbers/],
    ['{ alongNormal: false }', /only matters with a direction/],
  ]) {
    const r = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6, ${opts});`);
    assert.ok(r.errors.length > 0, opts);
    assert.match(String(r.errors[0].message ?? r.errors[0]), re, opts);
  }
});
