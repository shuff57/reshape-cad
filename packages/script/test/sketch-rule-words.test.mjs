// SPEC P1g §4 — the four Point-rules words (distX/distY/symmetric/angle),
// ModelDoc-side. Import from the built output the same way a browser or
// studio import would resolve it (dist/ is produced by
// `npm run build --workspaces`, which the self-check runs first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

/** One sketch holding exactly the rule the call describes. */
function constraintsOf(src) {
  const r = runScript(src);
  assert.deepEqual(r.errors, [], `script should run clean, got: ${JSON.stringify(r.errors)}`);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  assert.ok(sk, 'a sketch feature exists');
  return sk.constraints;
}

test('1: distX(1, 3, 12) stores {kind:distanceX, a:0, b:2, value:12} — 1-based in, 0-based stored', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distX(1, 3, 12)"),
    [{ kind: 'distanceX', a: 0, b: 2, value: 12 }],
  );
});

test('2: distX(3, 1, 12) normalises to the same rule', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distX(3, 1, 12)"),
    [{ kind: 'distanceX', a: 0, b: 2, value: 12 }],
  );
});

test('2b: distY stores kind distanceY the same way', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distY(3, 1, 12)"),
    [{ kind: 'distanceY', a: 0, b: 2, value: 12 }],
  );
});

test('3: symmetric(3, 1, 2) stores a:0, b:2, center:1 — a/b normalised, center untouched', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.symmetric(3, 1, 2)"),
    [{ kind: 'symmetric', a: 0, b: 2, center: 1 }],
  );
});

test('3b: a center LOWER than both endpoints is kept exactly as given', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.symmetric(4, 2, 1)"),
    [{ kind: 'symmetric', a: 1, b: 3, center: 0 }],
  );
});

test('4: angle(4, 2, 30) stores {edge:1, other:3, degrees:30}', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.angle(4, 2, 30)"),
    [{ kind: 'angle', edge: 1, other: 3, degrees: 30 }],
  );
});

test('5: negative values survive all three numeric methods (-5, -5, -30)', () => {
  const src = "const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]])";
  assert.deepEqual(
    constraintsOf(`${src}; sk1.distX(1, 3, -5)`),
    [{ kind: 'distanceX', a: 0, b: 2, value: -5 }],
  );
  assert.deepEqual(
    constraintsOf(`${src}; sk1.distY(1, 3, -5)`),
    [{ kind: 'distanceY', a: 0, b: 2, value: -5 }],
  );
  assert.deepEqual(
    constraintsOf(`${src}; sk1.angle(4, 2, -30)`),
    [{ kind: 'angle', edge: 1, other: 3, degrees: -30 }],
  );
});

test('6: distX(2, 2, 5) throws naming DIFFERENT corners; symmetric(1, 3, 1) throws naming a THIRD corner', () => {
  // runScript() catches student-program throws into errors[] -- the
  // assertion is on the reported message, not on a rethrown exception.
  const r1 = runScript("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distX(2, 2, 5)");
  assert.equal(r1.errors.length, 1);
  assert.match(r1.errors[0].message, /DIFFERENT corners/);

  const r2 = runScript("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.symmetric(1, 3, 1)");
  assert.equal(r2.errors.length, 1);
  assert.match(r2.errors[0].message, /THIRD corner/);
});

test('7: an out-of-range corner is refused by wholeIndex (throw asserted, wording not pinned)', () => {
  const r = runScript("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distX(1, 9, 5)");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /distX/);
});

test('8: ROUND TRIP — a doc carrying all four rule kinds survives toScript -> runScript whole', () => {
  const src =
    "const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]);\n" +
    'sk1.distX(1, 3, 12); sk1.distY(2, 4, 5); sk1.symmetric(3, 1, 2); sk1.angle(4, 2, 30)';
  const first = runScript(src);
  assert.deepEqual(first.errors, [], JSON.stringify(first.errors));
  const original = first.doc.features.find((f) => f.kind === 'sketch');
  assert.equal(original.constraints.length, 4, 'all four rules made it past settle()');

  const text = toScript(first.doc);
  assert.ok(text.includes('.distX(1, 3, 12)'), `emitted source should carry the rules, got:\n${text}`);
  const second = runScript(text);
  assert.deepEqual(second.errors, [], JSON.stringify(second.errors));
  const rebuilt = second.doc.features.find((f) => f.kind === 'sketch');
  // Deep-equal the rules, INCLUDING ids: a sketch rule never introduces a
  // binding, so the sketch's own id must come back identical, and the whole
  // feature list must match row for row.
  assert.deepEqual(rebuilt.constraints, original.constraints);
  assert.equal(rebuilt.id, original.id);
  assert.deepEqual(second.doc.features.map((f) => f.id), first.doc.features.map((f) => f.id));
});