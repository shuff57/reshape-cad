// repeat(shape, { ..., whole: true }) (owner decision 2026-11-12, second pilot Q1): repeat the PART with its holes and pockets. Without it a repeat of a shape whose
// last step is a hole (or a pocket) repeats that hole, and with a step wider than the part the script stopped with an error that named "brep-rs" and "FreeCAD".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const run = (src) => runScript(src);
const kinds = (r) => r.doc.features.map((f) => f.kind);
const DRILLED = `const b = box(30, 20, 10); hole(b, { across: 6 });`;

test('without whole: a repeat after a hole repeats the hole, and a step wider than the part is a plain-worded error that says how to repeat the part', () => {
  const row = run(`const b = box(60, 20, 10); hole(b, { across: 6, at: [-20, 0] }); linearPattern(b, { count: 3, step: [20, 0, 0] });`);
  assert.deepEqual(row.errors, []); assert.deepEqual(kinds(row), ['box', 'hole', 'hole', 'hole']);
  const wide = run(`${DRILLED} linearPattern(b, { count: 3, step: [40, 0, 0] });`);
  assert.equal(wide.errors.length, 1);
  assert.equal(wide.errors[0].message, 'repeat() of a hole drills a copy of the hole at each place, and copy 2 of the hole reaches the edge of the part, which is not supported yet. Drill the extra holes yourself, one hole(...) each. To repeat the whole part instead, add whole: true.');
});

test('no error of the repeat and mirror family names a tool any more', () => {
  const cases = [
    `${DRILLED} linearPattern(b, { count: 3, step: [40, 0, 0] });`,
    `const b = box(60, 20, 10); hole(b, { across: 6 }); linearPattern(b, { count: 3, step: [4, 0, 0] });`,
    `const s = sphere(20); hole(s, { across: 4 }); linearPattern(s, { count: 2, step: [3, 0, 0] });`,
    `const b = box(40, 30, 10); const sk = sketch('top', 5); sk.rect(6, 6); pocket(sk, b, 3); linearPattern(b, { count: 2, step: [30, 0, 0] });`,
    `const b = box(40, 30, 10); const sk = sketch('top', 5); sk.rect(6, 6); pocket(sk, b, 3); linearPattern(b, { count: 2, step: [4, 0, 0] });`,
  ];
  let errors = 0;
  for (const c of cases) { const r = run(c); for (const e of r.errors) { errors++; assert.doesNotMatch(String(e.message), /brep-rs|FreeCAD|OCCT/, c); } }
  assert.ok(errors >= 3, `the cases reach the errors (${errors})`);
});

test('whole: true repeats the part: one pattern step on the drilled (or pocketed) part, no extra holes', () => {
  const lin = run(`${DRILLED} linearPattern(b, { count: 3, step: [40, 0, 0], whole: true });`);
  assert.deepEqual(lin.errors, []); assert.deepEqual(kinds(lin), ['box', 'hole', 'pattern']);
  const p = lin.doc.features.at(-1);
  assert.equal(p.target, 'hole1'); assert.equal(p.mode, 'linear'); assert.equal(p.count, 3); assert.deepEqual(p.step, [40, 0, 0]);
  const rep = run(`${DRILLED} repeat(b, { count: 2, step: 50, whole: true });`);
  assert.deepEqual(kinds(rep), ['box', 'hole', 'pattern']);
  const pol = run(`const b = box(30, 20, 10, { at: [50, 0, 0] }); hole(b, { across: 6 }); polarPattern(b, { count: 4, axis: 'z', whole: true });`);
  assert.deepEqual(pol.errors, []); assert.deepEqual(kinds(pol), ['box', 'hole', 'pattern']); assert.equal(pol.doc.features.at(-1).mode, 'circular');
  const pk = run(`const b = box(40, 30, 10); const sk = sketch('top', 5); sk.rect(6, 6); pocket(sk, b, 3); linearPattern(b, { count: 2, step: [50, 0, 0], whole: true });`);
  assert.deepEqual(pk.errors, []); assert.deepEqual(kinds(pk), ['box', 'sketch', 'pocket', 'pattern']); assert.equal(pk.doc.features.at(-1).target, 'pocket1');
  // whole: false, or left out, is the repeat of the hole as before; on a plain shape the option changes nothing
  assert.deepEqual(kinds(run(`const b = box(60, 20, 10); hole(b, { across: 6, at: [-20, 0] }); linearPattern(b, { count: 3, step: [20, 0, 0], whole: false });`)), ['box', 'hole', 'hole', 'hole']);
  assert.deepEqual(run(`const b = box(30, 20, 10); linearPattern(b, { count: 3, step: [40, 0, 0], whole: true });`).doc, run(`const b = box(30, 20, 10); linearPattern(b, { count: 3, step: [40, 0, 0] });`).doc);
});

test('round trip: a repeat of a drilled part is written with whole: true and comes back as the same doc', () => {
  for (const src of [`${DRILLED} linearPattern(b, { count: 3, step: [40, 0, 0], whole: true });`,
    `const b = box(30, 20, 10, { at: [50, 0, 0] }); hole(b, { across: 6 }); polarPattern(b, { count: 4, axis: 'z', whole: true });`,
    `const b = box(40, 30, 10); const sk = sketch('top', 5); sk.rect(6, 6); pocket(sk, b, 3); linearPattern(b, { count: 2, step: [50, 0, 0], whole: true });`]) {
    const a = run(src); assert.deepEqual(a.errors, []);
    const text = toScript(a.doc);
    assert.match(text, /whole: true/, text);
    const b = run(text); assert.deepEqual(b.errors, [], text);
    assert.deepEqual(b.doc, a.doc, text);
  }
  // a repeat of a plain shape is written as before
  assert.doesNotMatch(toScript(run(`const b = box(30, 20, 10); linearPattern(b, { count: 3, step: [40, 0, 0] });`).doc), /whole/);
});
