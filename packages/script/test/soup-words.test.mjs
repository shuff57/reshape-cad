// SPEC-sketcher2 §2 — the soup-word REDs, ModelDoc-side. Import from the
// built output the same way a browser or studio import would resolve it
// (dist/ is produced by the tsc build chain, which the self-check runs
// first). Every test here is RED until the soup words land.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

/** One soup sketch holding exactly the rows the call describes. */
function soupOf(src) {
  const r = runScript(src);
  assert.deepEqual(r.errors, [], `script should run clean, got: ${JSON.stringify(r.errors)}`);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  assert.ok(sk, 'a sketch feature exists');
  return sk;
}

// 1. geom_stores_rows_dense_ids — §2.1: sketch-local, DENSE, 1-BASED,
//    id == index + 1 in the geom() array.
test('1: geom() stores rows with dense 1-based ids matching array index+1', () => {
  const sk = soupOf(
    "const s1 = sketch('top'); s1.geom([{ k:'line', id:1, a:[0,0], b:[40,0] }, { k:'line', id:2, a:[40,0], b:[40,30] }])",
  );
  assert.deepEqual(sk.geom, [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
    { k: 'line', id: 2, a: [40, 0], b: [40, 30] },
  ]);
});

// 2. geom_refuses_id_position_mismatch — §2.1: the explicit id is a
//    redundancy the parser VALIDATES and REFUSES on mismatch; §6.3: refused,
//    not silently renumbered.
test('2: geom() refuses a row whose explicit id disagrees with its array position', () => {
  const r = runScript(
    "const s1 = sketch('top'); s1.geom([{ k:'line', id:2, a:[0,0], b:[40,0] }])",
  );
  assert.equal(r.errors.length, 1, 'expected exactly one refusal');
  assert.match(
    r.errors[0].message,
    /id 2 .*position 1|id .*does not match/i,
    `refusal should name the id/position mismatch, got: ${r.errors[0].message}`,
  );
});

// 3. rules_accept_all_16_kinds_17_forms — §2.5: every constraint kind is
//    accepted with the exact arg shape the spec spells.
test('3: rules() accepts all 16 kinds / 17 forms with their spec arg shapes', () => {
  const sk = soupOf(
    "const s1 = sketch('top'); s1.geom([" +
      "{ k:'point', id:1, p:[0,0] }," +
      "{ k:'line', id:2, a:[0,0], b:[40,0] }," +
      "{ k:'line', id:3, a:[40,0], b:[40,30] }," +
      "{ k:'circle', id:4, c:[20,20], r:5 }," +
      "{ k:'arc', id:5, c:[0,0], r:10, a:[10,0], b:[0,10], sense:'ccw' }," +
      ']); s1.rules([' +
      "{ k:'coincident', a:2, aEnd:'b', b:3, bEnd:'a' }," +
      "{ k:'pointOnObject', a:2, aEnd:'a', b:4 }," +
      "{ k:'horizontal', a:2 }," +
      "{ k:'vertical', a:3 }," +
      '{ k:\'parallel\', a:2, b:3 },' +
      '{ k:\'perpendicular\', a:2, b:3 },' +
      "{ k:'tangent', a:2, b:4 }," + // simple form (no aEnd/bEnd)
      "{ k:'tangent', a:2, aEnd:'b', b:5, bEnd:'a' }," + // endpoint form
      '{ k:\'equal\', a:2, b:3 },' + // line/line = lengths
      '{ k:\'equal\', a:4, b:5 },' + // circle/circle = radii (arc carries r)
      "{ k:'symmetric', a:2, aEnd:'a', b:2, bEnd:'b', c:1 }," + // 3-point form
      "{ k:'symmetric', a:2, aEnd:'a', b:3, bEnd:'a', c:-2 }," + // about-a-line form (c is a line)
      "{ k:'distance', a:2, aEnd:'a', b:3, bEnd:'a', value:10 }," +
      "{ k:'distanceX', a:2, aEnd:'a', b:3, bEnd:'a', value:12 }," +
      "{ k:'distanceY', a:2, aEnd:'a', b:3, bEnd:'b', value:8 }," +
      "{ k:'radius', a:4, value:5 }," +
      "{ k:'diameter', a:4, value:10 }," +
      "{ k:'angle', a:2, b:3, value:90, quadrant:1 }," +
      "{ k:'lock', a:2, aEnd:'a' }," +
      '])',
  );
  const rules = sk.rules;
  assert.ok(Array.isArray(rules), 'rules stored as an array');
  // 17 forms across 16 kinds: tangent twice (simple + endpoint) and
  // symmetric twice (3-point + about-a-line), everything else once.
  const kinds = rules.map((c) => c.k);
  for (const k of [
    'coincident', 'pointOnObject', 'horizontal', 'vertical', 'parallel',
    'perpendicular', 'tangent', 'equal', 'symmetric', 'distance', 'distanceX',
    'distanceY', 'radius', 'diameter', 'angle', 'lock',
  ]) {
    assert.ok(kinds.includes(k), `kind ${k} accepted, got: ${JSON.stringify(kinds)}`);
  }
  assert.equal(rules.length, 19, '18 forms (16 kinds, tangent x2 + symmetric x2) plus a second equal pairing (line/line AND circle/circle) = 19 rows');
  // Spot-check the shapes the spec spells verbatim (§2.5).
  assert.deepEqual(rules.find((c) => c.k === 'coincident'), { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' });
  assert.deepEqual(rules.find((c) => c.k === 'radius'), { k: 'radius', a: 4, value: 5 });
  assert.deepEqual(rules.filter((c) => c.k === 'tangent')[0], { k: 'tangent', a: 2, b: 4 });
  assert.deepEqual(rules.filter((c) => c.k === 'tangent')[1], { k: 'tangent', a: 2, aEnd: 'b', b: 5, bEnd: 'a' });
});

// 4. rules_refuses_mixed_equal — §2.5: equal between a line and a circle is
//    REFUSE with a sentence (O18), never a silent length-vs-radius compare.
test('4: rules() refuses equal between a line and a circle with the O18 sentence', () => {
  const r = runScript(
    "const s1 = sketch('top'); s1.geom([" +
      "{ k:'line', id:1, a:[0,0], b:[40,0] }," +
      "{ k:'circle', id:2, c:[20,20], r:5 }," +
      "]); s1.rules([{ k:'equal', a:1, b:2 }])",
  );
  assert.equal(r.errors.length, 1, 'expected exactly one refusal');
  assert.match(
    r.errors[0].message,
    /equal/i,
    `refusal should name equal, got: ${r.errors[0].message}`,
  );
  assert.match(
    r.errors[0].message,
    /line|circle/i,
    `refusal should name the geometry kinds, got: ${r.errors[0].message}`,
  );
});

// 5. rules_refuses_line_c_pointpos — §2.2: a line exposes 'a' and 'b' only;
//    point ref 'c' (centre) on a line is refused.
test('5: rules() refuses point ref c on a line', () => {
  const r = runScript(
    "const s1 = sketch('top'); s1.geom([{ k:'line', id:1, a:[0,0], b:[40,0] }]);" +
      " s1.rules([{ k:'lock', a:1, aEnd:'c' }])",
  );
  assert.equal(r.errors.length, 1, 'expected exactly one refusal');
  assert.match(
    r.errors[0].message,
    /'c'|centre|center/i,
    `refusal should name the bad point ref, got: ${r.errors[0].message}`,
  );
});

// 6. param_binds_radius_value_slot — §2.4 + §6.2: r MUST be a variable,
//    because param('holeR', 5) needs a slot to bind to; the binding lands in
//    the rule's value slot, keyed pname(featureId, slot) like every other
//    panel row (D8).
test('6: param(holeR, 5) feeding a radius rule binds by slot, doc stays numeric', () => {
  const r = runScript(
    "const holeR = param('holeR', 5);" +
      "const s1 = sketch('top'); s1.geom([{ k:'circle', id:1, c:[20,20], r:holeR }]);" +
     " s1.rules([{ k:'radius', a:1, value:holeR }])",
  );
  assert.deepEqual(r.errors, [], `script should run clean, got: ${JSON.stringify(r.errors)}`);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  assert.ok(sk, 'a sketch feature exists');
  const radiusRule = (sk.rules ?? []).find((c) => c.k === 'radius');
  assert.ok(radiusRule, 'a radius rule exists');
  // THE DOC STAYS NUMERIC. Every other feature (a cuboid's width, a ring's
  // across) stores the resolved number and re-binds by slot key at emit time
  // (numText) -- the mechanism §6.2 actually argues for. Storing the NAME
  // here made the doc lie about its own types (both fields are number): the
  // kernel refused the build ("needs a positive radius r"), the emitter wrote
  // r:NaN, and applyParam's slider no-op'd on typeof !== 'number'. Measured
  // 2026-09-18, all three.
  assert.equal(
    radiusRule.value,
    5,
    `value slot should hold the resolved number, got: ${JSON.stringify(radiusRule.value)}`,
  );
  const circle = (sk.geoms ?? []).find((g) => g.k === 'circle');
  assert.ok(circle, 'a circle row exists');
  assert.equal(circle.r, 5, `the circle's radius must be numeric too, got: ${JSON.stringify(circle.r)}`);
  // And the panel-facing slot key exists, keyed pname(featureId, slot) like
  // every other dimension (D8), so the Dimensions panel can find it.
  const slotKey = r.params.find((p) => p.name === `${sk.id}_rule0-value`);
  assert.ok(slotKey, `a param row keyed ${sk.id}_rule0-value exists, got: ${JSON.stringify(r.params.map((p) => p.name))}`);
  assert.equal(slotKey.value, 5);
});

// 7: applyParam writes a rule-value slot back into rules[i].value (D8) --
//    the Dimensions panel's write path for soup sketches. RED first: the
//    slot was generated but applyParam had no soup arm, so the edit was a
//    silent no-op.
//    the Dimensions panel's write path for soup sketches. RED first: the
//    slot was generated but applyParam had no soup arm, so the edit was a
//    silent no-op.
test('7: applyParam ruleN-value writes rules[i].value', async () => {
  const { applyParam } = await import('../dist/model-codegen.js');
  const sk = soupOf(
    "const s1 = sketch('top'); s1.geom([{ k:'line', id:1, a:[0,0], b:[40,0] }])" +
      ".rules([{ k:'distance', a:1, aEnd:'a', b:1, bEnd:'b', value:40 }])",
  );
  const doc = { features: [sk] };
  const next = applyParam(doc, `${sk.id}_rule0-value`, 55);
  const f = next.features.find((x) => x.id === sk.id);
  assert.equal(f.rules[0].value, 55, 'the rule value took the new number');
});
