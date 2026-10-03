// W-5 step 1: sketch({ origin, u, v }). Normal = u x v (right-handed). A frame
// that is non-unit, skewed or zero is a plain error -- never normalised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const sk = (r) => r.doc.features.find((f) => f.kind === 'sketch');

test('a frame object lands on the sketch feature', () => {
  const r = runScript("sketch({ origin: [1, 2, 3], u: [1, 0, 0], v: [0, 0, 1] }).rect(30, 20)");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(sk(r).frame, { origin: [1, 2, 3], u: [1, 0, 0], v: [0, 0, 1] });
});

test('toScript emits the frame back (not a named plane) and reaches a fixpoint', () => {
  const r = runScript("pull(sketch({ origin: [5, 6, 7], u: [1, 0, 0], v: [0, 0, 1] }).rect(30, 20), 10)");
  const t = toScript(r.doc);
  assert.match(t, /sketch\(\{ origin: \[5, 6, 7\], u: \[1, 0, 0\], v: \[0, 0, 1\] \}\)/);
  assert.doesNotMatch(t, /sketch\('/);
  const r2 = runScript(t);
  assert.deepEqual(r2.errors, []);
  assert.deepEqual(sk(r2).frame, sk(r).frame);
  assert.equal(toScript(r2.doc), t);
});

test('named planes still emit unchanged', () => {
  assert.match(toScript(runScript("sketch('front', 4).rect(10, 10)").doc), /sketch\('front', 4\)/);
});

test('invalid frames are plain errors', () => {
  const bad = {
    'non-unit u': "sketch({ origin: [0,0,0], u: [2,0,0], v: [0,1,0] })",
    'zero v': "sketch({ origin: [0,0,0], u: [1,0,0], v: [0,0,0] })",
    'skewed': "sketch({ origin: [0,0,0], u: [1,0,0], v: [0.6,0.8,0] })",
    'missing v': "sketch({ origin: [0,0,0], u: [1,0,0] })",
    'NaN': "sketch({ origin: [0,0,NaN], u: [1,0,0], v: [0,1,0] })",
    'short vector': "sketch({ origin: [0,0], u: [1,0,0], v: [0,1,0] })",
    'unknown key': "sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0], w: 1 })",
    'with offset': "sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }, 5)",
  };
  for (const [name, code] of Object.entries(bad)) {
    const r = runScript(code);
    assert.equal(r.errors.length, 1, name);
    assert.ok(r.errors[0].message.length > 10, name);
  }
});
