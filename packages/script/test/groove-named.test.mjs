// A groove is a cut, and the emitter names it on the same rule as a pocket (reshape-script-gen.ts, namedLater): declared
// with `const` exactly when a later step names the grooved part as its body (`target`, `into` or `targets`). It used to be
// emitted bare, so a pocket (or hole, or join) on a grooved part was saved naming `groove1`, a variable the text never made,
// and the saved script could not be reopened. The kernel half (the same solid before and after) is in
// packages/brep-adapter/test/mirror-cut-frame.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const HEAD = `const b = box(40, 40, 20);
const sk = sketch('front'); sk.polygon([[0, 15], [8, 15], [8, 22], [0, 22]]);
`;

/** run, save, reopen: the reopened doc must be the same doc, with no error */
function trip(src) {
  const a = runScript(src);
  assert.deepEqual(a.errors.map((e) => String(e.message ?? e)), [], src);
  const text = toScript(a.doc);
  const b = runScript(text);
  assert.deepEqual(b.errors.map((e) => String(e.message ?? e)), [], text);
  assert.deepEqual(b.doc.features, a.doc.features, text);
  return text;
}

test('a pocket cut into a groove: the groove is declared, and the saved text reopens to the same doc', () => {
  const text = trip(HEAD + `const g = groove(sk, b, 180);
const c = sketch('top', 10); c.rect(6, 6, { at: [-10, -10] });
pocket(c, g, 4)`);
  assert.match(text, /^const groove1 = groove\(sk1, box1, 180\)$/m);
  assert.match(text, /^pocket\(sk2, groove1, 4\)$/m);
});

test('a hole and a join on a grooved part also name it', () => {
  trip(HEAD + `const g = groove(sk, b, 180);
hole(g, { across: 4 })`);
  const text = trip(HEAD + `const g = groove(sk, b, 180);
const c2 = cuboid(10, 10, 10, { at: [0, 0, 15] });
union(g, c2)`);
  assert.match(text, /^const groove1 = groove\(/m);
});

test('a groove nothing later works on keeps its text: no declaration', () => {
  const text = trip(HEAD + 'groove(sk, b, 180)');
  assert.match(text, /^groove\(sk1, box1, 180\)$/m);
  assert.doesNotMatch(text, /const groove1/);
});
