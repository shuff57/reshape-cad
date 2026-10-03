// Words with no options object used to ignore a surplus argument silently.
// Each now names it in a plain error; a valid call is unchanged, and aliases
// (one implementation, SPEC-S2) behave identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const SK = "const s = sketch('top'); s.rect(10, 8);";
const SK2 = "const s = sketch('top'); s.rect(10, 8); const s2 = sketch('top'); s2.rect(6, 4);";
const PROF = "const s = sketch('front'); s.rect(10, 8);";
const BOX = 'const b = box(40, 40, 20);';

// [word shown in the error, setup, call forms (valid call without closing paren), expected arity text, ordinal]
const CASES = [
  ['groove', PROF + BOX, ['groove(s, b, 90'], 'a sketch, a shape and an angle', 'fourth'],
  ['pocket', SK + BOX, ['pocket(s, b, 5'], 'a sketch, a shape and a depth', 'fourth'],
  ['sketch', '', ["sketch('top', 10", "sketch('front', 0"], 'a plane and an optional offset', 'third'],
  ['pull', SK, ['pull(s, 30', 'extrude(s, 30'], 'a sketch and a height', 'third'],
  ['spin', PROF, ['spin(s, 180', 'revolve(s, 180'], 'a sketch and an angle', 'third'],
  ['blend', SK2, ['blend(s, s2, 20', 'loft(s, s2, 20'], 'two sketches and a gap', 'fourth'],
  ['round', BOX, ['round(b, 3', 'fillet(b, 3'], 'a shape or edge and a size', 'third'],
  ['mirror', BOX, ["mirror(b, 'left-right'"], 'a shape and a direction word', 'third'],
  ['turn', BOX, ['turn(b, [0, 0, 45]'], 'a shape and a list of angles', 'third'],
];

for (const [word, setup, forms, takes, ordinal] of CASES) {
  for (const form of forms) {
    test(`${form}) builds, and one extra argument is named`, () => {
      const ok = runScript(`${setup} ${form});`);
      assert.deepEqual(ok.errors, [], `${form}) should be valid`);
      const bad = runScript(`${setup} ${form}, 'zzz');`);
      assert.equal(bad.errors.length, 1);
      const msg = bad.errors[0].message ?? String(bad.errors[0]);
      const nth = ordinal;
      assert.ok(msg.includes(`${word}() takes ${takes}; the ${nth} argument (the text "zzz") was ignored.`), msg);
    });
  }
}

test('an object as the extra argument is refused too', () => {
  const r = runScript(`${SK} extrude(s, 30, { at: [10, 0, 0] });`);
  assert.match(r.errors[0].message, /pull\(\) takes a sketch and a height; the third argument \(a \{ \} object\) was ignored\. To move the result, use move/);
});

test('fillet on an edge reference still builds with two arguments', () => {
  const r = runScript(`${BOX} fillet(b.edge('top', 'front'), 2);`);
  assert.deepEqual(r.errors, []);
});

test('the extra-argument check runs before any other refusal', () => {
  const r = runScript(`${BOX} mirror(b, 'sideways', 1);`);
  assert.match(r.errors[0].message, /mirror\(\) takes a shape and a direction word; the third argument/);
});
