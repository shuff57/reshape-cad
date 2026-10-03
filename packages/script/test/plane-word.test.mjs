// Stage 2 of SPEC-datum-family: the plane() word. Pure helper, no feature;
// named planes stay on their named path (no cross product, no `frame`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, VOCABULARY } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const sk = (r) => r.doc.features.find((f) => f.kind === 'sketch');
const run = (c) => { const r = runScript(c); assert.deepEqual(r.errors, [], JSON.stringify(r.errors)); return r; };
const errOf = (c) => runScript(c).errors.map((e) => e.message).join(' | ');

test('plane is in VOCABULARY', () => assert.ok(VOCABULARY.includes('plane')));

test("sketch(plane('top',10)) doc deep-equals sketch('top',10), and both emit the same text", () => {
  const a = run("sketch('top', 10).rect(40, 25)");
  const b = run("sketch(plane('top', 10)).rect(40, 25)");
  assert.deepEqual(b.doc, a.doc);
  assert.equal(sk(b).frame, undefined);
  assert.equal(sk(b).plane, 'xy');
  assert.equal(sk(b).offset, 10);
  const t = toScript(b.doc);
  assert.equal(t, toScript(a.doc));
  assert.match(t, /sketch\('top', 10\)/);
  assert.doesNotMatch(t, /plane\(/);
  assert.equal(toScript(run(t).doc), t); // D6 fixpoint
});

test("every named word: sketch(plane(w)) === sketch(w)", () => {
  for (const w of ['top', 'front', 'side']) {
    assert.deepEqual(run(`sketch(plane('${w}')).rect(4, 4)`).doc, run(`sketch('${w}').rect(4, 4)`).doc);
  }
});

test('a literal frame goes through plane() to the same frame sketch({...}) writes', () => {
  const f = "{ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }";
  const a = run(`sketch(${f}).rect(4, 4)`);
  const b = run(`sketch(plane(${f})).rect(4, 4)`);
  assert.deepEqual(b.doc, a.doc);
  assert.deepEqual(sk(b).frame, { origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] });
  const t = toScript(b.doc);
  assert.doesNotMatch(t, /plane\(/);
  assert.equal(toScript(run(t).doc), t);
});

test('a plane value can be reused by two sketches', () => {
  const r = run("const p = plane('top', 3)\nsketch(p).rect(2, 2)\nsketch(p).rect(3, 3)");
  const s = r.doc.features.filter((f) => f.kind === 'sketch');
  assert.equal(s.length, 2);
  assert.ok(s.every((f) => f.plane === 'xy' && f.offset === 3));
});

test('bad inputs are plain script errors', () => {
  assert.match(errOf("plane('floor')"), /plane\(\) needs a plane word/);
  assert.match(errOf('plane()'), /plane\(\) needs a plane word/);
  assert.match(errOf('plane({ origin: [0,0,0], u: [2,0,0], v: [0,1,0] })'), /plane\(\)'s u has to be a unit-length/);
  assert.match(errOf('plane({ origin: [0,0,0], u: [1,0,0], v: [1,0,0] })'), /right angles/);
  assert.match(errOf('plane({ origin: [0,0,0], u: [1,0,0] })'), /plane\(\{ \.\.\. \}\) needs origin, u and v.*missing v/);
  assert.match(errOf('plane({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }, 5)'), /takes no offset/);
  assert.match(errOf("plane('top', 'high')"), /offset/);
  assert.match(errOf("sketch(plane('top'), 5)"), /takes no offset/);
});

test('plane() alone adds no feature', () => {
  const r = run("plane('top', 10)\nplane({ origin: [0,0,1], u: [1,0,0], v: [0,1,0] })");
  assert.deepEqual(r.doc.features, []);
  assert.deepEqual(r.doc, runScript('').doc);
});
