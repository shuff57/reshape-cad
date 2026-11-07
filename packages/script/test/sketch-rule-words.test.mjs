// SPEC P1g §4 — the four Point-rules words (distX/distY/symmetric/angle),
// ModelDoc-side. Import from the built output the same way a browser or
// studio import would resolve it (dist/ is produced by
// `npm run build --workspaces`, which the self-check runs first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { solveDoc } from '../dist/model-codegen.js';

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

// Contract sketch-dof-diagnosis#11 (owner-approved language fix): the call is read in the order it is WRITTEN, as reshape-docs.ts
// says ("distX(1, 3, -12) asks for corner 3 to sit 12 mm to the LEFT of corner 1"). distX(3, 1, 12) puts corner 1 12 mm to the
// right of corner 3, i.e. x3 - x1 = -12, so it is stored as the 1 -> 3 rule of -12. Until this fix it was stored as +12, the mirror.
test('2: distX(3, 1, 12) is stored as the documented rule: corners normalised, value negated (x3 - x1 = -12)', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distX(3, 1, 12)"),
    [{ kind: 'distanceX', a: 0, b: 2, value: -12 }],
  );
});

test('2b: distY(3, 1, 12) is stored the same way (y3 - y1 = -12)', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distY(3, 1, 12)"),
    [{ kind: 'distanceY', a: 0, b: 2, value: -12 }],
  );
});

test('2c: a reversed 0 is stored as 0, not -0', () => {
  const [c] = constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.distX(3, 1, 0)");
  assert.ok(Object.is(c.value, 0), `got ${Object.is(c.value, -0) ? '-0' : c.value}`);
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

test('4: angle(4, 2, 30) (the turn from edge 4 to edge 2) stores {edge:1, other:3, degrees:-30}, the turn from edge 2 to edge 4', () => {
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.angle(4, 2, 30)"),
    [{ kind: 'angle', edge: 1, other: 3, degrees: -30 }],
  );
  assert.deepEqual(
    constraintsOf("const sk1 = sketch('top'); sk1.polygon([[0,0],[10,0],[10,8],[0,8],[4,4]]); sk1.angle(2, 4, 30)"),
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
  // a descending call negates (#11): angle(4, 2, -30) is the turn of +30 from edge 2 to edge 4
  assert.deepEqual(
    constraintsOf(`${src}; sk1.angle(4, 2, -30)`),
    [{ kind: 'angle', edge: 1, other: 3, degrees: 30 }],
  );
  assert.deepEqual(
    constraintsOf(`${src}; sk1.angle(2, 4, -30)`),
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
    // angle(2, 4, 30) is the rule this test wrote as angle(4, 2, 30) before #11 (edge 1, other 3, +30). Under the documented
    // reading angle(4, 2, 30) is the -30 turn, which this five-corner outline cannot hold with the symmetric rule (the settle
    // drops it), so the fixture now spells the same stored rule in ascending order; descending calls are test 12.
    'sk1.distX(1, 3, 12); sk1.distY(2, 4, 5); sk1.symmetric(3, 1, 2); sk1.angle(2, 4, 30)';
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
// ---- #11: the documented geometry, in both corner orders, after the solve every built doc goes through (solveDoc) ----
const solvedPoints = (src) => {
  const r = runScript(src);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  return solveDoc(r.doc).features.find((f) => f.kind === 'sketch').points;
};
const near = (got, want, what, tol = 1e-6) => assert.ok(Math.abs(got - want) < tol, `${what}: got ${got}, want ${want}`);
/** the signed turn, in degrees, from edge e to edge o (1-based), the solver's own measure (sketch-solve.ts angle residual) */
const turnDeg = (p, e, o) => {
  const d = (k) => { const a = p[k - 1], b = p[k % p.length]; return [b[0] - a[0], b[1] - a[1]]; };
  const [ax, ay] = d(e), [bx, by] = d(o);
  return (Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI;
};

test('9: distX in both orders gives the documented geometry: distX(a, b, v) puts corner b v across from corner a', () => {
  const rect = "const sk1 = sketch('top'); sk1.rect(40, 30); ";
  for (const [call, a, b, v] of [['distX(1, 3, 12)', 1, 3, 12], ['distX(3, 1, -12)', 3, 1, -12], ['distX(2, 4, -25)', 2, 4, -25], ['distX(4, 2, 25)', 4, 2, 25]]) {
    const p = solvedPoints(`${rect}sk1.${call}; extrude(sk1, 10)`);
    near(p[b - 1][0] - p[a - 1][0], v, call);
  }
  // the two spellings of one shape solve to the same points
  assert.deepEqual(solvedPoints(`${rect}sk1.distX(3, 1, -12)`), solvedPoints(`${rect}sk1.distX(1, 3, 12)`));
});

test('10: distY in both orders gives the documented geometry: distY(a, b, v) puts corner b v up from corner a', () => {
  const rect = "const sk1 = sketch('top'); sk1.rect(40, 30); ";
  for (const [call, a, b, v] of [['distY(1, 3, 10)', 1, 3, 10], ['distY(3, 1, -10)', 3, 1, -10], ['distY(4, 2, -18)', 4, 2, -18]]) {
    const p = solvedPoints(`${rect}sk1.${call}; extrude(sk1, 10)`);
    near(p[b - 1][1] - p[a - 1][1], v, call);
  }
  assert.deepEqual(solvedPoints(`${rect}sk1.distY(3, 1, -10)`), solvedPoints(`${rect}sk1.distY(1, 3, 10)`));
});

test('11: angle in both orders gives the documented geometry: angle(e, o, d) is the turn d from edge e to edge o', () => {
  // a triangle with edge 1 held level and long; the turn from edge 1 to edge 2 is about 117 degrees as drawn
  const tri = "const sk1 = sketch('top'); sk1.polygon([[0,0],[40,0],[12,26]]); sk1.across(1); sk1.length(1, 40); sk1.pin(1); ";
  for (const [call, e, o, d] of [['angle(1, 2, 120)', 1, 2, 120], ['angle(2, 1, -120)', 2, 1, -120], ['angle(2, 1, 240)', 2, 1, -120], ['angle(1, 3, -135)', 1, 3, -135], ['angle(3, 1, 135)', 3, 1, 135]]) {
    const p = solvedPoints(`${tri}sk1.${call}; extrude(sk1, 10)`);
    const t = turnDeg(p, e, o);
    near(((t - d + 540) % 360) - 180, 0, `${call}: turn from edge ${e} to edge ${o} is ${t}`, 1e-4); // the TS solver holds an angle to ~1e-5 degrees
  }
  // reversed is a sign flip, which is the same rule as 360 minus it (the solver compares turns modulo 360)
  assert.deepEqual(solvedPoints(`${tri}sk1.angle(2, 1, -120)`), solvedPoints(`${tri}sk1.angle(1, 2, 120)`));
  const p240 = solvedPoints(`${tri}sk1.angle(2, 1, 240)`), p120 = solvedPoints(`${tri}sk1.angle(1, 2, 120)`);
  p240.forEach((q, k) => { near(q[0], p120[k][0], `corner ${k + 1} x`, 1e-6); near(q[1], p120[k][1], `corner ${k + 1} y`, 1e-6); });
});

test('12: ROUND TRIP of descending calls: literals come back in the stored order with the sign, a param() comes back as written', () => {
  // one rule per sketch, so the settle (addConstraintSettling) has nothing to drop
  const shape = "sketch('top'); sk.polygon([[0,0],[40,0],[40,30],[0,30]])"; // polygon: no rules of its own (rect() carries across/up)
  const three = (x, y, a) => [`const sk1 = ${shape.replace('sk.', 'sk1.')}; sk1.${x}`, `const sk2 = ${shape.replace('sk.', 'sk2.')}; sk2.${y}`, `const sk3 = ${shape.replace('sk.', 'sk3.')}; sk3.${a}`].join(';\n');
  const rulesOf = (r) => r.doc.features.filter((f) => f.kind === 'sketch').map((f) => f.constraints);
  const first = runScript(three('distX(3, 1, 12)', 'distY(4, 2, 5)', 'angle(4, 2, 30)'));
  assert.deepEqual(first.errors, [], JSON.stringify(first.errors));
  assert.deepEqual(rulesOf(first), [
    [{ kind: 'distanceX', a: 0, b: 2, value: -12 }], [{ kind: 'distanceY', a: 1, b: 3, value: -5 }], [{ kind: 'angle', edge: 1, other: 3, degrees: -30 }],
  ]);
  const text = toScript(first.doc);
  for (const call of ['sk1.distX(1, 3, -12)', 'sk2.distY(2, 4, -5)', 'sk3.angle(2, 4, -30)']) assert.ok(text.includes(call), `expected ${call} in:\n${text}`);
  const second = runScript(text);
  assert.deepEqual(second.errors, [], JSON.stringify(second.errors));
  assert.deepEqual(rulesOf(second), rulesOf(first));

  const psrc = "const w = param('w', 12); const h = param('h', 5); const t = param('t', 30);\n" + three('distX(3, 1, w)', 'distY(2, 4, h)', 'angle(4, 2, t)');
  const p1 = runScript(psrc);
  assert.deepEqual(p1.errors, [], JSON.stringify(p1.errors));
  assert.deepEqual(rulesOf(p1), [
    [{ kind: 'distanceX', a: 0, b: 2, value: -12 }], [{ kind: 'distanceY', a: 1, b: 3, value: 5 }], [{ kind: 'angle', edge: 1, other: 3, degrees: -30 }],
  ]);
  const ptext = toScript(p1.doc, p1.namedParams);
  for (const call of ['sk1.distX(3, 1, w)', 'sk2.distY(2, 4, h)', 'sk3.angle(4, 2, t)']) assert.ok(ptext.includes(call), `expected ${call} in:\n${ptext}`);
  const p2 = runScript(ptext);
  assert.deepEqual(p2.errors, [], JSON.stringify(p2.errors));
  assert.deepEqual(rulesOf(p2), rulesOf(p1));
  assert.deepEqual(p2.namedParams.map((p) => [p.name, p.value, p.slots]), p1.namedParams.map((p) => [p.name, p.value, p.slots]));
  // the param still drives the rule: a new value for w lands where the script put it
  const p3 = runScript(ptext.replace("param('w', 12", "param('w', 20"));
  assert.deepEqual(p3.errors, [], JSON.stringify(p3.errors));
  assert.equal(rulesOf(p3)[0][0].value, -20);
});
