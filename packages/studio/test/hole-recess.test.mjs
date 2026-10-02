// 2026-10-01 (Track A slice A2, second half): the Build toolbar's way to give a
// hole a recess.
//
// The logic lives in src/model/hole-recess.ts because ModelEditor.tsx is a
// component with no test harness -- test/marking-menu.test.mjs:227 records that
// and works around it by grepping the source. So the decision is pure and
// testable here, and ModelEditor calls it as a thin arrow. This matches the
// studio rule that pure modules stay pure so node --test can import them from
// ../dist, and the ContextActions rule that each verb IS the closure the ribbon
// calls, with no second implementation of any verb.
//
// Slice A1 made the recesses expressible in the language and 59d054b made them
// visible and editable once they EXIST. What is tested here is creating them
// without typing script, which is how a student working in the Build toolbar
// actually works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whyCannotRecess, recessDefaults, withRecess } from '../dist/model/hole-recess.js';

const hole = (extra = {}) => ({
  kind: 'hole', id: 'h1', axis: 'z', center: [0, 0, 0], diameter: 6, depth: 22, ...extra,
});

test('only a hole can take a recess', () => {
  assert.equal(whyCannotRecess(hole()), null);
  assert.match(whyCannotRecess({ kind: 'box' }), /pick a hole/i);
  assert.match(whyCannotRecess(null), /pick a hole/i);
});

test('a recess defaults to twice the bore, the convention every measured case here uses', () => {
  // d6 bore with a d12 recess is the spec's example, the parity fixtures' shape
  // and the countersink spike's. A default that disagreed with them would make
  // the button produce a shape unlike any the course has measured.
  assert.equal(recessDefaults(hole(), 'counterbore').diameter, 12);
  assert.equal(recessDefaults(hole(), 'countersink').diameter, 12);
  assert.equal(recessDefaults(hole(), 'countersink').angleDeg, 90, '90 is the usual included angle');
});

test('a default counterbore always leaves bore behind it', () => {
  // The button must not greet a student with a refusal. A counterbore deeper
  // than the bore is degenerate, which by the A1 split is a KERNEL refusal, so a
  // default that refused would be a bad first experience for a click.
  for (const depth of [0.5, 1, 6, 12, 40, 1000]) {
    const d = recessDefaults(hole({ depth }), 'counterbore').depth;
    assert.ok(d < depth || depth <= 0.5, `depth ${depth} produced a counterbore of ${d}`);
    assert.ok(d > 0, `depth ${depth} produced a non-positive ${d}`);
  }
});

test('setting a recess writes it onto the hole', () => {
  const h = withRecess(hole(), 'counterbore');
  assert.deepEqual(h.counterbore, { diameter: 12, depth: 6 });
  assert.equal(h.countersink, undefined);
  assert.equal(h.diameter, 6, 'the bore is untouched');
  assert.equal(h.id, 'h1');
});

test('switching kind removes the other one, because the model says they are exclusive', () => {
  // Leaving both set produces a doc the kernel refuses, so this is not cosmetic:
  // it is the difference between a button that works and one that errors.
  const cb = withRecess(hole(), 'counterbore');
  const cs = withRecess(cb, 'countersink');
  assert.equal(cs.counterbore, undefined, 'the counterbore must be gone');
  assert.deepEqual(cs.countersink, { diameter: 12, angleDeg: 90 });
});

test('clicking the same kind again takes the recess off', () => {
  // The only remove path the Build toolbar would otherwise have. Without it a
  // student who mis-clicks has no way back short of editing the script.
  const on = withRecess(hole(), 'counterbore');
  const off = withRecess(on, 'counterbore');
  assert.equal(off.counterbore, undefined);

  assert.equal('counterbore' in off, false, 'the key must be gone, not set to undefined');
});

test('toggling one kind never disturbs the other hole fields', () => {
  const src = hole({ corners: { dx: 2, dy: 2 } });
  const after = withRecess(src, 'countersink');
  assert.deepEqual(after.corners, { dx: 2, dy: 2 });
  assert.equal(after.depth, 22);
  assert.equal(after.axis, 'z');
  assert.deepEqual(after.center, [0, 0, 0]);
});

test('the module never touches the input feature', () => {
  const src = hole();
  withRecess(src, 'counterbore');
  assert.equal(src.counterbore, undefined, 'the source doc must not be mutated in place');
});

// --- wiring ------------------------------------------------------------------
// The pure module is tested above, but a tested module nobody calls is the
// exact failure this slice exists to close (A2's first half shipped slots for a
// feature nothing could create). ModelEditor and ReshapeStudio are components
// with no harness, so their wiring is asserted the way test/marking-menu.test.mjs
// does it: by reading the source. This is a structural assertion, not a
// behavioural one, and it says so.
import fs from 'node:fs';

const readSrc = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('ModelEditor imports the pure module rather than reimplementing it', () => {
  const src = readSrc('../src/model/ModelEditor.tsx');
  assert.match(src, /from '\.\/hole-recess\.js'/, 'the verb must call the tested module');
  assert.match(src, /withRecess\(x, kind\)/, 'and it must actually apply it');
  // A second implementation is the drift this arrangement exists to prevent.
  assert.equal(src.split('withRecess(').length - 1, 1, 'withRecess must be called exactly once');
});

test('the recess verb is declared and registered on every path that dispatches verbs', () => {
  const src = readSrc('../src/model/ModelEditor.tsx');
  // Three places need it: the exported ContextActions (the context bar's
  // contract), verbsRef's TYPE, and each of the two literal verb lists
  // (verbsRef.current and registerContextActions) -- the last two share
  // identical text, so a count of 2 is the expectation, not a coincidence.
  assert.equal(src.split('recess: (kind: RecessKind) => void;').length - 1, 2,
    'the verb must be in ContextActions and in verbsRef\'s type');
  assert.equal(src.split('recess: (kind: RecessKind) => recess(kind),').length - 1, 2,
    'the verb must be registered in verbsRef.current and in registerContextActions');
});

test('the context bar offers a recess on a hole, and it reflects the current state', () => {
  const src = readSrc('../src/ReshapeStudio.tsx');
  assert.match(src, /ctxFeature\.kind === 'hole'/, 'a hole needs its own branch');
  assert.match(src, /ctxActionsRef\.current\?\.recess\('counterbore'\)/);
  assert.match(src, /ctxActionsRef\.current\?\.recess\('countersink'\)/);
  // The label must track state, because the same click removes it again.
  assert.match(src, /Remove Counterbore/, 'the button must not claim to add one that is already there');
});
