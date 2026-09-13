// 2026-09-13 fix: the 37 VOCABULARY words used to be `new Function(...)`
// PARAMETER names, so `const box = ...` (or let/class) was a hard
// SyntaxError -- "Identifier 'box' has already been declared" -- for the
// single most natural variable name a student would reach for. Switched to
// a `with(scope)` binding (see reshape-script.ts's "run it" section for the
// full reasoning) so a declared local of any tool's name correctly shadows
// it. This file locks in that fix and its two known remaining edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, VOCABULARY } from '../dist/reshape-script.js';

test('a differently-named const shadowing a tool word builds and runs fine', () => {
  const r = runScript("const myBox = box(40, 40, 20)");
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.length, 1);
  assert.equal(r.doc.features[0].kind, 'box');
});

test('let/const/class declared with a tool NAME no longer throws a SyntaxError', () => {
  for (const decl of ['let ring = 5;', 'const hollow = 5;', 'class hole {}']) {
    const r = runScript(`${decl}\nconst b = box(10, 10, 10)`);
    assert.deepEqual(r.errors, [], `${decl} should not error`);
    assert.equal(r.doc.features.length, 1);
  }
});

test('a plain, unshadowed script still runs every vocabulary word unaffected', () => {
  const r = runScript("const b = box(40, 40, 20)\nhole(b, { across: 6 })");
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.length, 2);
});

test('bare assignment to a tool word (no declaring keyword) is refused, not silently applied', () => {
  const r = runScript("box = 5");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /"box" is already a reSHape tool here/);
});

test('the same refusal fires for var (which used to silently "work" and break every later call)', () => {
  const r = runScript("var box = 5\nconst c = box(1, 1, 1)");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /"box" is already a reSHape tool here/);
});

test('reusing the SAME name for both the tool and its own result still fails (JS TDZ, not fixable) but with a specific message', () => {
  const r = runScript("const box = box(40, 40, 20)");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /can't build box\(\) into a variable named "box"/);
  assert.match(r.errors[0].message, /myBox/);
});

test('the TDZ rewrite only fires for an actual vocabulary word, not an unrelated self-reference bug', () => {
  const r = runScript("const totallyUnrelated = totallyUnrelated + 1");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /Cannot access 'totallyUnrelated' before initialization/);
});

test('every VOCABULARY word can be locally shadowed by name without throwing a SyntaxError', () => {
  // Just the declaration, unused afterward -- calling box() would legitimately
  // fail when word === 'box' itself (it's now a local number, not the tool),
  // which is expected shadowing behavior, not the bug this file guards
  // against. The thing under test is purely "does this parse and run at all".
  for (const word of VOCABULARY) {
    const r = runScript(`const ${word} = 1`);
    assert.deepEqual(r.errors, [], `shadowing "${word}" should not error: ${JSON.stringify(r.errors)}`);
  }
});
