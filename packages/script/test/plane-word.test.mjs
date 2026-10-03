// SPEC-datum-family Stages 2+3: the plane() word creates a `datum` feature; a
// sketch on it also carries the placement itself. Named planes stay on their
// named path (no cross product, no `frame`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, VOCABULARY } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const sk = (r) => r.doc.features.find((f) => f.kind === 'sketch');
const run = (c) => { const r = runScript(c); assert.deepEqual(r.errors, [], JSON.stringify(r.errors)); return r; };
const errOf = (c) => runScript(c).errors.map((e) => e.message).join(' | ');

test('plane is in VOCABULARY', () => assert.ok(VOCABULARY.includes('plane')));

const stripDatum = (f) => { const { onDatum, ...rest } = f; return rest; };
const datum = (r) => r.doc.features.filter((f) => f.kind === 'datum');

test("sketch(plane('top',10)): a datum row + a sketch with the SAME placement as sketch('top',10)", () => {
  const a = run("sketch('top', 10).rect(40, 25)");
  const b = run("sketch(plane('top', 10)).rect(40, 25)");
  assert.equal(b.doc.features.length, 2);
  assert.deepEqual(datum(b), [{ id: 'pl1', kind: 'datum', type: 'plane', plane: 'xy', offset: 10 }]);
  assert.equal(sk(b).onDatum, 'pl1');
  assert.deepEqual(stripDatum(sk(b)), sk(a)); // named path: no frame, plane xy, offset 10
  assert.equal(sk(b).frame, undefined);
  assert.equal(sk(b).plane, 'xy');
  assert.equal(sk(b).offset, 10);
  const t = toScript(b.doc);
  assert.match(t, /const pl1 = plane\('top', 10\)\nconst sk1 = sketch\(pl1\)/);
  assert.equal(toScript(run(t).doc), t); // D6 fixpoint
  assert.deepEqual(run(t).doc, b.doc);
});

test("every named word: sketch(plane(w)) places the sketch exactly like sketch(w)", () => {
  for (const w of ['top', 'front', 'side']) {
    const a = run(`sketch('${w}').rect(4, 4)`);
    const b = run(`sketch(plane('${w}')).rect(4, 4)`);
    assert.deepEqual(stripDatum(sk(b)), sk(a));
    assert.equal(datum(b).length, 1);
  }
});

test('a literal frame goes through plane() to the same frame sketch({...}) writes', () => {
  const f = "{ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }";
  const a = run(`sketch(${f}).rect(4, 4)`);
  const b = run(`sketch(plane(${f})).rect(4, 4)`);
  assert.deepEqual(stripDatum(sk(b)), sk(a));
  assert.deepEqual(sk(b).frame, { origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] });
  assert.deepEqual(datum(b)[0].frame, sk(b).frame);
  const t = toScript(b.doc);
  assert.match(t, /const pl1 = plane\(\{ origin: \[0, 0, 10\], u: \[1, 0, 0\], v: \[0, 1, 0\] \}\)\nconst sk1 = sketch\(pl1\)/);
  assert.equal(toScript(run(t).doc), t);
});

test('a plane value can be reused by two sketches: ONE datum, two sketches on it', () => {
  const r = run("const p = plane('top', 3)\nsketch(p).rect(2, 2)\nsketch(p).rect(3, 3)");
  const s = r.doc.features.filter((f) => f.kind === 'sketch');
  assert.equal(s.length, 2);
  assert.equal(datum(r).length, 1);
  assert.ok(s.every((f) => f.plane === 'xy' && f.offset === 3 && f.onDatum === 'pl1'));
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

test('plane() alone adds a datum row (and nothing else); an unused datum still emits its statement', () => {
  const r = run("plane('top', 10)\nplane({ origin: [0,0,1], u: [1,0,0], v: [0,1,0] })");
  assert.deepEqual(r.doc.features.map((f) => [f.id, f.kind]), [['pl1', 'datum'], ['pl2', 'datum']]);
  const t = toScript(r.doc);
  assert.match(t, /const pl1 = plane\('top', 10\)/);
  assert.match(t, /const pl2 = plane\(\{ origin: \[0, 0, 1\]/);
  assert.equal(toScript(run(t).doc), t);
  assert.deepEqual(run(t).doc, r.doc);
});
