// Pad and pocket direction options in the language and in the round trip: the words the task panel writes
// ({ reversed, midplane, length2, through }) must run, survive toScript(), and refuse nonsense in a sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { generatedParams } from '../dist/model-codegen.js';
import { handlesFor } from '../dist/model-handles.js';

const HEAD = `const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] });
const plate = extrude(s1, 10);
`;
const feat = (r, kind) => r.doc.features.filter((f) => f.kind === kind);

test('pull takes midplane, reversed and length2 and stores them on the feature', () => {
  const r = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6, { midplane: true });`);
  assert.deepEqual(r.errors, []);
  assert.equal(feat(r, 'extrude')[0].midplane, true);
  const r2 = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6, { reversed: true, length2: 2 });`);
  assert.deepEqual(r2.errors, []);
  assert.equal(feat(r2, 'extrude')[0].reversed, true);
  assert.equal(feat(r2, 'extrude')[0].length2, 2);
});

test('toScript writes the options only when set, and the text runs back to the same doc', () => {
  const src = `const s = sketch('top'); s.rect(10, 10); extrude(s, 6, { reversed: true, length2: 2 });`;
  const r = runScript(src);
  const text = toScript(r.doc);
  assert.match(text, /extrude\(sk1, 6, \{ reversed: true, length2: 2 \}\)/);
  const again = runScript(text);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(feat(again, 'extrude')[0], feat(r, 'extrude')[0]);
  assert.match(toScript(runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6);`).doc), /extrude\(sk1, 6\)\n/);
});

test('a pocket keeps through, reversed and midplane through the round trip', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.rect(8, 8, { at: [20, 15] }); pocket(s2, plate, 3, { through: true, midplane: true });`);
  assert.deepEqual(r.errors, []);
  const pk = feat(r, 'pocket')[0];
  assert.equal(pk.through, true);
  assert.equal(pk.midplane, true);
  const again = runScript(toScript(r.doc));
  assert.deepEqual(again.errors, []);
  assert.deepEqual(feat(again, 'pocket')[0], pk);
});

test('midplane and length2 together, a non-boolean flag and a bad length are refused in a sentence', () => {
  for (const [opts, re] of [
    ['{ midplane: true, length2: 3 }', /not both/],
    ['{ reversed: 1 }', /true or false/],
    ['{ length2: -2 }', /positive number/],
    ['{ depth: 2 }', /was ignored/],
  ]) {
    const r = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6, ${opts});`);
    assert.equal(r.errors.length, 1, opts);
    assert.match(r.errors[0].message, re);
  }
});

test('the drag handle follows a symmetric or reversed pad', () => {
  const mk = (opts) => runScript(`const s = sketch('top'); s.rect(10, 10, { at: [0, 0] }); extrude(s, 10${opts});`).doc;
  const at = (doc) => handlesFor(doc.features.find((f) => f.kind === 'extrude'), doc)[0];
  assert.deepEqual(at(mk('')).origin, [0, 0, 10]);
  const mid = at(mk(', { midplane: true }'));
  assert.deepEqual(mid.origin, [0, 0, 5]);
  assert.equal(mid.scale, 2);
  assert.deepEqual(at(mk(', { reversed: true }')).origin, [0, 0, -10]);
});

test('named walls of a pocket with a direction option are refused, not silently dropped', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.rect(8, 8, { at: [20, 15] });
const part = pocket(s2, plate, 3, { midplane: true });
round(part.edge('top', part.wall(s2, 0)), 1);`);
  assert.ok(r.errors.some((e) => /direction option/.test(e.message)), JSON.stringify(r.errors));
});

test('generatedParams still names the length slot of a reversed pad', () => {
  const r = runScript(`const s = sketch('top'); s.rect(10, 10); extrude(s, 6, { reversed: true });`);
  assert.ok(generatedParams(r.doc).some((p) => p.name === 'pull1_height' && p.value === 6));
});
