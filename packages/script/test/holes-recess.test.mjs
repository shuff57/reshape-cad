// 2026-10-01 (Track A slice A1): the language could not reach a recess the kernel
// has cut since 37c6091 (counterbore) and 8abd28f (countersink).
//
// The model fields have existed the whole time -- model-types.ts:530 and :539 --
// and the kernel has cut both. Nothing in reSHape Script could ASK for them, so a
// student had a capability the surface could not reach. A0 fixed the same class of
// gap for `deep`: one end of the round trip had the option and the other did not.
//
// The split of responsibility here is deliberate and is pinned below, because it is
// easy to get backwards in either direction: the script validates what is
// nonsensical regardless of geometry, and genuine geometric degeneracy must reach
// the kernel so it comes back as a refusal sentence. A script error would tell the
// student they typed something malformed, when they asked for something impossible.
//
// This file pins the LANGUAGE half. The build half is already refereed by closed
// forms in brep-rs's own pins (`counterbore_cuts_the_analytic_volume`,
// `counterbore_variants_are_exact`), so it is not re-proved here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const BOX = 'const b = box(40, 40, 20)';
const hole = (r) => r.doc.features.find((f) => f.kind === 'hole');

test('counterbore parses onto the model fields', () => {
  const r = runScript(`${BOX}\nhole(b, { across: 6, counterbore: { across: 12, deep: 6 } })`);
  assert.deepEqual(r.errors, [], `unexpected: ${JSON.stringify(r.errors)}`);
  assert.deepEqual(hole(r).counterbore, { diameter: 12, depth: 6 });
  assert.equal(hole(r).countersink, undefined, 'only the requested recess is set');
});

test('countersink parses onto the model fields', () => {
  const r = runScript(`${BOX}\nhole(b, { across: 6, countersink: { across: 12, angle: 90 } })`);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(hole(r).countersink, { diameter: 12, angleDeg: 90 });
  assert.equal(hole(r).counterbore, undefined);
});

test('holes() takes the recesses too', () => {
  const r = runScript(`${BOX}\nholes(b, { across: 6, apart: [20, 20], counterbore: { across: 12, deep: 6 } })`);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(hole(r).counterbore, { diameter: 12, depth: 6 });
});

test('a recess survives toScript -> runScript', () => {
  // The half that was missing in A0 and that any round-trip feature must have:
  // if the emitter drops the recess, the hole comes back plain and nothing says so.
  for (const src of [
    `${BOX}\nhole(b, { across: 6, counterbore: { across: 12, deep: 6 } })`,
    `${BOX}\nhole(b, { across: 6, countersink: { across: 12, angle: 90 } })`,
  ]) {
    const first = runScript(src);
    assert.deepEqual(first.errors, []);
    const text = toScript(first.doc);
    assert.match(text, /counterbore|countersink/, `regenerated text lost the recess:\n${text}`);

    const second = runScript(text);
    assert.deepEqual(second.errors, [], `regenerated script must re-run: ${JSON.stringify(second.errors)}`);
    assert.deepEqual(
      { ...hole(first).counterbore, ...hole(first).countersink },
      { ...hole(second).counterbore, ...hole(second).countersink },
      `recess changed across the round trip:\n${text}`,
    );
  }
});

test('a hole takes a counterbore OR a countersink, never both', () => {
  // One mouth, one shape -- the model says so, so the script must not build a doc
  // that contradicts it.
  const r = runScript(`${BOX}\nhole(b, { across: 6, counterbore: { across: 12, deep: 6 }, countersink: { across: 14, angle: 90 } })`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /counterbore OR a countersink, not both/);
});

test('the countersink angle is an INCLUDED cone angle, so 90 is the widest', () => {
  const ok = runScript(`${BOX}\nhole(b, { across: 6, countersink: { across: 12, angle: 90 } })`);
  assert.deepEqual(ok.errors, [], '90 is the usual choice and must be accepted');
  const bad = runScript(`${BOX}\nhole(b, { across: 6, countersink: { across: 12, angle: 120 } })`);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /INCLUDED cone angle/);
});

test('recess dimensions must be positive, like every other size', () => {
  for (const bad of [
    `${BOX}\nhole(b, { across: 6, counterbore: { across: 12, deep: -2 } })`,
    `${BOX}\nhole(b, { across: 6, counterbore: { across: -12, deep: 6 } })`,
    `${BOX}\nhole(b, { across: 6, countersink: { across: 12, angle: -90 } })`,
  ]) {
    const r = runScript(bad);
    assert.equal(r.errors.length, 1, `expected a script error for: ${bad}`);
    assert.match(r.errors[0].message, /positive number/);
  }
});

test('a recess that cannot fit is NOT a script error -- it must reach the kernel', () => {
  // The half of the split that is easy to get wrong. A counterbore wider than its
  // bore is geometrically impossible, not syntactically wrong, so the script must
  // accept it and let the kernel refuse it with its own sentence. If this ever
  // becomes a script error, a student is told they mistyped when the truth is the
  // shape does not exist.
  const r = runScript(`${BOX}\nhole(b, { across: 6, counterbore: { across: 40, deep: 6 } })`);
  assert.deepEqual(r.errors, [], 'a too-wide counterbore is a kernel refusal, not a script error');
  assert.deepEqual(hole(r).counterbore, { diameter: 40, depth: 6 }, 'it must reach the model intact so the kernel can judge it');
});

test('the recess option objects have their own allow-lists', () => {
  // Nested options go through their own readOptions, so a typo inside
  // counterbore: {} is refused rather than silently ignored.
  const r = runScript(`${BOX}\nhole(b, { across: 6, counterbore: { across: 12, deep: 6, bogus: 1 } })`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /has no option called "bogus"/);

  const missing = runScript(`${BOX}\nhole(b, { across: 6, counterbore: { across: 12 } })`);
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0].message, /counterbore needs \{ deep/);
});

test('an unknown recess name is still refused, and the message names the real ones', () => {
  const r = runScript(`${BOX}\nhole(b, { across: 6, counterdrill: { across: 12 } })`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /has no option called "counterdrill"/);
  assert.match(r.errors[0].message, /counterbore/, 'the refusal should enumerate counterbore as accepted');
});
