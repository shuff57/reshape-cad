// W3: one corner count everywhere the student sees one. The Rules panel, .pin(), .distX() and the docs number corners from 1;
// .round() and .chamfer() used to take a 0-based number (and the trim note repeated it), so ".round(1, 5)" rounded the SECOND
// corner while ".pin(1)" pinned the first. They now count from 1, the document still stores 0-based, the emitter writes 1-based,
// and a corner number that is not a whole number from 1 to the corner count stops the script with a sentence instead of
// being ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { sections } from '../dist/reshape-docs.js';

const sketchOf = (src) => {
  const r = runScript(src);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  return { r, sk: r.doc.features.find((f) => f.kind === 'sketch') };
};

test('.round(1, r) and .chamfer(1, d) act on the FIRST corner, like .pin(1); the document stores it from 0', () => {
  const { sk } = sketchOf("const s = sketch('top')\ns.rect(30, 20)\ns.round(1, 3)\ns.chamfer(4, 2)");
  assert.deepEqual(sk.rounds, { 0: 3 });
  assert.deepEqual(sk.chamfers, { 3: 2 });
  const pin = sketchOf("const s = sketch('top')\ns.rect(30, 20)\ns.pin(1)").sk;
  assert.equal(pin.constraints.at(-1).corner, 0, 'pin(1) is the same corner as round(1)');
});

test('a corner number of 0, past the last corner, or not whole stops with a sentence that says the range', () => {
  for (const call of ['round(0, 3)', 'round(5, 3)', 'round(2.5, 3)', 'chamfer(0, 2)', 'chamfer(5, 2)', 'chamfer(-1, 2)']) {
    const r = runScript(`const s = sketch('top')\ns.rect(30, 20)\ns.${call}`);
    assert.equal(r.errors.length, 1, call);
    assert.match(r.errors[0].message, /corner has to be a whole number from 1 to 4 \(corner 1 is the first corner\) -- you gave it/, call);
  }
});

test('the trim note uses the same numbers the call used', () => {
  const r = runScript("const s = sketch('top')\ns.rect(30, 20)\ns.round(2, 99)\ns.chamfer(4, 99)");
  assert.deepEqual([...r.warnings].sort(), [
    '.chamfer(4, 99) is more than corner 4 has room for, so it was made 20 instead.',
    '.round(2, 99) is more than corner 2 has room for, so it was made 10 instead.',
  ]);
});

test('the emitter writes corners from 1, and a script survives write -> run unchanged', () => {
  const first = sketchOf("const s = sketch('top')\ns.rect(30, 20)\ns.round(1, 3)\ns.round(3, 2)\ns.chamfer(4, 2)").r;
  const text = toScript(first.doc);
  assert.match(text, /\.round\(1, 3\)/);
  assert.match(text, /\.round\(3, 2\)/);
  assert.match(text, /\.chamfer\(4, 2\)/);
  assert.doesNotMatch(text, /\.round\(0,|\.chamfer\(0,/);
  const again = sketchOf(text);
  const a = first.doc.features.find((f) => f.kind === 'sketch'), b = again.sk;
  assert.deepEqual(b.rounds, a.rounds);
  assert.deepEqual(b.chamfers, a.chamfers);
});

test('the docs say corners count from 1 and give a round example that runs', () => {
  const pages = sections.flatMap((s) => s.pages ?? []);
  const page = pages.find((p) => p.title === 'round and chamfer: soften a corner');
  assert.ok(page, 'the round and chamfer page exists');
  assert.match(page.body, /Corners are numbered from 1/);
  const { sk } = sketchOf(page.code);
  assert.deepEqual(sk.rounds, { 0: 4 });
  assert.deepEqual(sk.chamfers, { 2: 3 });
});
