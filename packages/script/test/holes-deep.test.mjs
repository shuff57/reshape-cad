// 2026-10-01 (I-10, Track A slice A0): `holes()` accepted every option except the
// one it emitted.
//
// toScript has always emitted `deep:` for a blind holes() row
// (reshape-script-gen.ts, `optText(bindings, f.id, 'depth', 'deep', ...)`), and
// the interpreter body has always read `extra.deep` to set the depth. Only the
// readOptions ALLOW-LIST omitted it, so the round trip was broken in exactly one
// direction: a script containing `deep:` was refused on re-run with
// `holes has no option called "deep"`. One token closes it, and these tests are
// what stop it reopening.
//
// The plan's bar (brep-fix-plan.md:634-636) is that `holes(b, { across: 6,
// apart: [20,20], deep: 8 })` sets `depth === 8` and that
// `toScript(runScript(src))` round-trips. The depth assertion is the load-bearing
// one: a round-trip text test alone would pass even if `deep` were parsed and
// then ignored, which is the shape of bug that reaches a student as a hole of the
// wrong depth and no error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

test('holes() accepts deep and sets the hole depth from it', () => {
  const r = runScript('const b = box(40, 40, 20)\nholes(b, { across: 6, apart: [20, 20], deep: 8 })');
  assert.deepEqual(r.errors, [], `deep: should be accepted: ${JSON.stringify(r.errors)}`);
  const hole = r.doc.features.find((f) => f.kind === 'hole');
  assert.ok(hole, 'a hole feature was pushed');
  assert.equal(hole.depth, 8, `depth should be 8, got ${hole.depth}`);
});

test('holes() without deep still runs and still defaults its depth', () => {
  const r = runScript('const b = box(40, 40, 20)\nholes(b, { across: 6, apart: [20, 20] })');
  assert.deepEqual(r.errors, []);
  const hole = r.doc.features.find((f) => f.kind === 'hole');
  assert.ok(hole);
  // The default path (through the target's extent) must be untouched by this change.
  assert.equal(typeof hole.depth, 'number');
  assert.ok(hole.depth > 0, `default depth should be positive, got ${hole.depth}`);
});

test('deep survives toScript -> runScript, which is the direction that was broken', () => {
  const src = 'const b = box(40, 40, 20)\nholes(b, { across: 6, apart: [20, 20], deep: 8 })';
  const first = runScript(src);
  assert.deepEqual(first.errors, []);

  const text = toScript(first.doc);
  assert.match(text, /deep:\s*8/, `regenerated script should carry deep: 8, got:\n${text}`);

  // Re-run the REGENERATED text. This is the step that used to throw
  // `holes has no option called "deep"`.
  const second = runScript(text);
  assert.deepEqual(second.errors, [], `regenerated script should re-run: ${JSON.stringify(second.errors)}`);
  const hole = second.doc.features.find((f) => f.kind === 'hole');
  assert.ok(hole, 'the re-run hole feature exists');
  assert.equal(hole.depth, 8, `depth must survive the round trip, got ${hole.depth}`);
});

test('readOptions still refuses an unknown option, and now names deep', () => {
  // The refusal contract that governs this allow-list. Pinned because the plan
  // (brep-fix-plan.md:630-631) records that these sentences were asserted by no
  // test anywhere, so an allow-list edit could have widened it silently.
  const r = runScript('const b = box(40, 40, 20)\nholes(b, { across: 6, apart: [20, 20], bogus: 1 })');
  assert.equal(r.errors.length, 1, `an unknown option must be refused: ${JSON.stringify(r.errors)}`);
  assert.match(r.errors[0].message, /has no option called "bogus"/);
  // The message enumerates what IS accepted, so it must list `deep` now.
  assert.match(r.errors[0].message, /deep/,
    `the refusal should enumerate deep as accepted: ${r.errors[0].message}`);
});

test('readOptions refuses a non-object extras argument with its own sentence', () => {
  // The other branch of readOptions, previously unpinned.
  const r = runScript('const b = box(40, 40, 20)\nholes(b, 5)');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /extras go in a \{ \} object at the end/);
});

test('deep must be positive, like every other numeric option', () => {
  // Positivity is a script-level check. Genuine geometric degeneracy (a recess
  // deeper than its bore) stays a kernel refusal; that split is the plan's, and
  // this test only pins the half that belongs here.
  const r = runScript('const b = box(40, 40, 20)\nholes(b, { across: 6, apart: [20, 20], deep: -3 })');
  assert.equal(r.errors.length, 1, `a negative deep must be refused: ${JSON.stringify(r.errors)}`);
});
