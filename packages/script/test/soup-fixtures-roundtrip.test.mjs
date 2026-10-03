// PLAN-scripting-layers.md S-2 / Matrix C: the soup round trip over REALISTIC
// fixtures, and one fixture per geom kind and per rule kind. Companion to
// soup-roundtrip.test.mjs (emitter unit REDs); that file is not edited.
//
// Per fixture: runScript(emit(doc)) has no errors; the D6 fixpoint holds
// (toScript(parsed.doc, parsed.namedParams) === toScript(doc), same call shape
// as soup-roundtrip.test.mjs test 3); the rebuilt geoms deep-equal the
// originals (SPEC-sketcher2 §6.3 basin selector), and so do the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const sketchDoc = (geoms, rules = [], extra = {}) => ({
  version: 1,
  features: [{ id: 'sk1', kind: 'sketch', plane: 'top', offset: 0, geoms, rules, ...extra }],
});

/** Run the emitted text; return parsed result + its sketch. */
function roundTrip(doc, label) {
  const first = toScript(doc);
  const parsed = runScript(first);
  assert.deepEqual(parsed.errors, [], `${label}: emitted script should run clean:\n${first}\n${JSON.stringify(parsed.errors)}`);
  const sk = parsed.doc.features.find((f) => f.kind === 'sketch');
  assert.ok(sk?.geoms?.length, `${label}: parse lost the soup rows`);
  const second = toScript(parsed.doc, parsed.namedParams);
  assert.equal(second, first, `${label}: D6 fixpoint broken:\n--- first ---\n${first}\n--- second ---\n${second}`);
  assert.deepEqual(sk.geoms, doc.features[0].geoms, `${label}: rebuilt geoms differ (basin selector, §6.3)`);
  assert.deepEqual(sk.geom, doc.features[0].geoms, `${label}: sk.geom and sk.geoms drifted`);
  assert.deepEqual(sk.rules ?? [], doc.features[0].rules ?? [], `${label}: rebuilt rules differ`);
  return { first, parsed, sk };
}

// --- UI slot: row literal from slotRows (packages/studio/src/model/sketch-canvas-core.ts:818),
// centres (0,0) and (40,0), rPoint (0,10) -> r=10, baseId 1. perp = (0,1) so
// arc1a=[0,10] arc1b=[0,-10] arc2a=[40,-10] arc2b=[40,10]. cw arcs, ends
// reversed (a = the -perp end), line+arc junctions each coincident + tangent.
// (Matches slotRows lines 855-870 and rules 872-882.) Obround area is 11141.592654 per :841 comment.
export const UI_SLOT_GEOMS = [
  { k: 'arc', id: 1, c: [0, 0], r: 10, a: [0, -10], b: [0, 10], sense: 'cw' },
  { k: 'arc', id: 2, c: [40, 0], r: 10, a: [40, 10], b: [40, -10], sense: 'cw' },
  { k: 'line', id: 3, a: [0, 10], b: [40, 10] },
  { k: 'line', id: 4, a: [40, -10], b: [0, -10] },
];
export const UI_SLOT_RULES = [
  { k: 'coincident', a: 3, aEnd: 'a', b: 1, bEnd: 'b' },
  { k: 'tangent', a: 3, aEnd: 'a', b: 1, bEnd: 'b' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'tangent', a: 3, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'a', b: 2, bEnd: 'b' },
  { k: 'tangent', a: 4, aEnd: 'a', b: 2, bEnd: 'b' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'tangent', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  // equal radii (the plan's fixture list); slotRows itself shares r by construction.
  { k: 'equal', a: 1, b: 2 },
];

const RECT_LINES = [
  { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
  { k: 'line', id: 2, a: [40, 0], b: [40, 25] },
  { k: 'line', id: 3, a: [40, 25], b: [0, 25] },
  { k: 'line', id: 4, a: [0, 25], b: [0, 0] },
];
const RECT_RULES = [
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'horizontal', a: 1 },
  { k: 'vertical', a: 2 },
  { k: 'horizontal', a: 3 },
  { k: 'vertical', a: 4 },
];

export const FIXTURES = {
  'ui slot (slotRows, centres 0 and 40, r=10)': sketchDoc(UI_SLOT_GEOMS, UI_SLOT_RULES),
  'slot, centres (-20,0),(20,0), r=5': sketchDoc(
    [
      { k: 'arc', id: 1, c: [-20, 0], r: 5, a: [-20, -5], b: [-20, 5], sense: 'cw' },
      { k: 'arc', id: 2, c: [20, 0], r: 5, a: [20, 5], b: [20, -5], sense: 'cw' },
      { k: 'line', id: 3, a: [-20, 5], b: [20, 5] },
      { k: 'line', id: 4, a: [20, -5], b: [-20, -5] },
    ],
    UI_SLOT_RULES,
  ),
  'washer (outline + inner circle hole)': sketchDoc(
    [...RECT_LINES, { k: 'circle', id: 5, c: [20, 12.5], r: 5 }],
    RECT_RULES.slice(0, 6),
  ),
  'construction line': sketchDoc(
    [...RECT_LINES, { k: 'line', id: 5, a: [0, 0], b: [40, 25], construction: true }],
    RECT_RULES,
  ),
  'rectangle from 4 lines + coincident/horizontal/vertical': sketchDoc(RECT_LINES, RECT_RULES),
  'circle with a radius rule': sketchDoc(
    [{ k: 'circle', id: 1, c: [0, 0], r: 12 }],
    [{ k: 'radius', a: 1, value: 12 }],
  ),
};

for (const [name, doc] of Object.entries(FIXTURES)) {
  test(`fixture: ${name} runs clean, holds D6 fixpoint, rows deep-equal`, () => {
    roundTrip(doc, name);
  });
}

test('construction flag survives emit -> run (PLAN: UNVERIFIED -> measured here)', () => {
  const { first, sk } = roundTrip(FIXTURES['construction line'], 'construction line');
  assert.match(first, /construction:\s*true/, `emitter dropped the construction flag:\n${first}`);
  assert.equal(sk.geoms.find((g) => g.id === 5).construction, true);
  assert.equal(sk.geoms.find((g) => g.id === 1).construction, undefined);
});

// --- param() fixtures, written as script text (what a student types) ---------
test('KNOWN DEFECT (g${id}r slot not in generatedParams, model-codegen.ts:~117-130): circle whose radius is param() keeps its name, round-trips', () => {
  const src = [
    "const r = param('holeR', 7, { min: 1, max: 50, step: 1 })",
    "const s1 = sketch('top')",
    "s1.geom([{ k:'circle', id:1, c:[0,0], r:r }])",
  ].join('\n');
  const a = runScript(src);
  assert.deepEqual(a.errors, [], JSON.stringify(a.errors));
  assert.equal(a.doc.features.find((f) => f.kind === 'sketch').geoms[0].r, 7);
  const first = toScript(a.doc, a.namedParams);
  assert.match(first, /param\('holeR', 7/, `param declaration lost:\n${first}`);
  assert.match(first, /k:\s*'circle'[^]*?r:\s*holeR/, `circle radius lost its param name:\n${first}`);
  const b = runScript(first);
  assert.deepEqual(b.errors, [], JSON.stringify(b.errors));
  assert.equal(toScript(b.doc, b.namedParams), first, 'D6 fixpoint broken for param circle radius');
  assert.deepEqual(b.doc.features.find((f) => f.kind === 'sketch').geoms, a.doc.features.find((f) => f.kind === 'sketch').geoms);
});

test('fixture: circle with a radius rule bound to param() keeps its name', () => {
  const src = [
    "const r = param('rad', 12, { min: 1, max: 50, step: 1 })",
    "const s1 = sketch('top')",
    "s1.geom([{ k:'circle', id:1, c:[0,0], r:12 }])",
    "s1.rules([{ k:'radius', a:1, value:r }])",
  ].join('\n');
  const a = runScript(src);
  assert.deepEqual(a.errors, [], JSON.stringify(a.errors));
  const first = toScript(a.doc, a.namedParams);
  assert.match(first, /param\('rad', 12/);
  assert.match(first, /k:\s*'radius'[^]*?value:\s*rad\b/);
  const b = runScript(first);
  assert.deepEqual(b.errors, [], JSON.stringify(b.errors));
  assert.equal(toScript(b.doc, b.namedParams), first);
});

// --- MATRIX C: one fixture per geom kind -------------------------------------
const GEOM_KIND_FIXTURES = {
  point: [{ k: 'point', id: 1, p: [3, 4] }],
  line: [{ k: 'line', id: 1, a: [0, 0], b: [10, 5] }],
  circle: [{ k: 'circle', id: 1, c: [1, 2], r: 3 }],
  arc: [{ k: 'arc', id: 1, c: [0, 0], r: 10, a: [10, 0], b: [0, 10], sense: 'ccw' }],
};
for (const [kind, geoms] of Object.entries(GEOM_KIND_FIXTURES)) {
  test(`matrix C geom ${kind}: runs, round-trips`, () => {
    roundTrip(sketchDoc(geoms), `geom ${kind}`);
  });
}

// --- MATRIX C: one fixture per rule kind (16 kinds, 17 forms) -----------------
const LL = [
  { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
  { k: 'line', id: 2, a: [40, 0], b: [40, 30] },
];
const LLC = [...LL, { k: 'circle', id: 3, c: [20, 20], r: 5 }, { k: 'point', id: 4, p: [0, 0] }];
const ARC = { k: 'arc', id: 1, c: [0, 0], r: 10, a: [10, 0], b: [0, 10], sense: 'ccw' };
export const RULE_FIXTURES = {
  coincident: [LL, [{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }]],
  pointOnObject: [LLC, [{ k: 'pointOnObject', a: 4, aEnd: 'a', b: 1 }]],
  horizontal: [LL, [{ k: 'horizontal', a: 1 }]],
  vertical: [LL, [{ k: 'vertical', a: 2 }]],
  parallel: [
    [LL[0], { k: 'line', id: 2, a: [0, 10], b: [40, 10] }],
    [{ k: 'parallel', a: 1, b: 2 }],
  ],
  perpendicular: [LL, [{ k: 'perpendicular', a: 1, b: 2 }]],
  'tangent (simple)': [
    [{ k: 'line', id: 1, a: [0, 25], b: [40, 25] }, { k: 'circle', id: 2, c: [20, 20], r: 5 }],
    [{ k: 'tangent', a: 1, b: 2 }],
  ],
  'tangent (endpoint)': [
    [{ k: 'line', id: 1, a: [-10, 10], b: [0, 10] }, { k: 'arc', id: 2, c: [0, 0], r: 10, a: [0, 10], b: [10, 0], sense: 'cw' }],
    [{ k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }],
  ],
  equal: [
    [{ k: 'circle', id: 1, c: [0, 0], r: 5 }, { k: 'circle', id: 2, c: [20, 0], r: 5 }],
    [{ k: 'equal', a: 1, b: 2 }],
  ],
  'symmetric (three-point)': [
    [{ k: 'point', id: 1, p: [-5, 0] }, { k: 'point', id: 2, p: [5, 0] }, { k: 'point', id: 3, p: [0, 0] }],
    [{ k: 'symmetric', a: 1, b: 2, c: 3, cEnd: 'a' }],
  ],
  'symmetric (about a line)': [
    [{ k: 'point', id: 1, p: [-5, 3] }, { k: 'point', id: 2, p: [5, 3] }, { k: 'line', id: 3, a: [0, -10], b: [0, 10] }],
    [{ k: 'symmetric', a: 1, b: 2, c: 3 }],
  ],
  distance: [LLC, [{ k: 'distance', a: 1, aEnd: 'a', b: 2, bEnd: 'b', value: 50 }]],
  distanceX: [LL, [{ k: 'distanceX', a: 1, aEnd: 'a', b: 2, bEnd: 'a', value: 40 }]],
  distanceY: [LL, [{ k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 30 }]],
  radius: [LLC, [{ k: 'radius', a: 3, value: 5 }]],
  diameter: [LLC, [{ k: 'diameter', a: 3, value: 10 }]],
  angle: [LL, [{ k: 'angle', a: 1, b: 2, value: 90 }]],
  lock: [LL, [{ k: 'lock', a: 1, aEnd: 'a' }]],
};
RULE_FIXTURES.arcRadiusEqual = [
  [ARC, { k: 'circle', id: 2, c: [30, 0], r: 10 }],
  [{ k: 'equal', a: 1, b: 2 }],
];

for (const [name, [geoms, rules]] of Object.entries(RULE_FIXTURES)) {
  test(`matrix C rule ${name}: runs, round-trips`, () => {
    roundTrip(sketchDoc(geoms, rules), `rule ${name}`);
  });
}

test('matrix C: the 16 kinds are all covered by RULE_FIXTURES', () => {
  const kinds = new Set(Object.values(RULE_FIXTURES).flatMap(([, rules]) => rules.map((r) => r.k)));
  const sixteen = ['coincident', 'pointOnObject', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent', 'equal',
    'symmetric', 'distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle', 'lock'];
  assert.deepEqual(sixteen.filter((k) => !kinds.has(k)), []);
});

// --- value rules survive a param() binding ------------------------------------
const VALUE_RULES = ['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle'];
for (const kind of VALUE_RULES) {
  test(`matrix C value rule ${kind}: survives a param() binding, name kept in text`, () => {
    const [geoms, rules] = RULE_FIXTURES[kind];
    const row = rules[0];
    const pname = `p_${kind}`;
    const src = [
      `const ${pname} = param('${pname}', ${row.value}, { min: 0, max: 500, step: 1 })`,
      "const sk1 = sketch('top')",
      `sk1.geom(${JSON.stringify(geoms)})`,
      `sk1.rules([${JSON.stringify({ ...row, value: '__V__' }).replace('"__V__"', pname)}])`,
    ].join('\n');
    const a = runScript(src);
    assert.deepEqual(a.errors, [], `${kind}: ${JSON.stringify(a.errors)}\n${src}`);
    assert.equal(a.doc.features[0].rules[0].value, row.value);
    const first = toScript(a.doc, a.namedParams);
    assert.match(first, new RegExp(`param\\('${pname}', ${row.value}`), `${kind}: param declaration lost:\n${first}`);
    assert.match(first, new RegExp(`k:\\s*'${kind}'[^]*?value:\\s*${pname}\\b`), `${kind}: rule lost its param name:\n${first}`);
    const b = runScript(first);
    assert.deepEqual(b.errors, [], `${kind}: ${JSON.stringify(b.errors)}`);
    assert.equal(toScript(b.doc, b.namedParams), first, `${kind}: D6 fixpoint broken under param()`);
    assert.deepEqual(b.doc.features[0].rules, a.doc.features[0].rules);
  });
}
