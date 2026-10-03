// PLAN-scripting-layers.md S-2, kernel half: the same realistic soup fixtures as
// packages/script/test/soup-fixtures-roundtrip.test.mjs, built on the REAL
// wasm after a script round trip, asserted against CLOSED-FORM volumes
// (never a kernel number). refusals must be {}.
// The wasm must be built first (see brep-rs/AGENTS.md); same initSync
// convention as docs-examples.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');

const H = 10;
const sketchDoc = (geoms, rules = []) => ({
  version: 1,
  features: [{ id: 'sk1', kind: 'sketch', plane: 'top', offset: 0, geoms, rules }],
});

// Rows copied from slotRows (packages/studio/src/model/sketch-canvas-core.ts:818),
// see the script-side test for the derivation. Centres 0 and 40, r=10.
const slot = (ax, bx, r) => ({
  geoms: [
    { k: 'arc', id: 1, c: [ax, 0], r, a: [ax, -r], b: [ax, r], sense: 'cw' },
    { k: 'arc', id: 2, c: [bx, 0], r, a: [bx, r], b: [bx, -r], sense: 'cw' },
    { k: 'line', id: 3, a: [ax, r], b: [bx, r] },
    { k: 'line', id: 4, a: [bx, -r], b: [ax, -r] },
  ],
  rules: [
    { k: 'coincident', a: 3, aEnd: 'a', b: 1, bEnd: 'b' }, { k: 'tangent', a: 3, aEnd: 'a', b: 1, bEnd: 'b' },
    { k: 'coincident', a: 3, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'tangent', a: 3, aEnd: 'b', b: 2, bEnd: 'a' },
    { k: 'coincident', a: 4, aEnd: 'a', b: 2, bEnd: 'b' }, { k: 'tangent', a: 4, aEnd: 'a', b: 2, bEnd: 'b' },
    { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }, { k: 'tangent', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
    { k: 'equal', a: 1, b: 2 },
  ],
});
const RECT = [
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
  { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 },
];
const u = slot(0, 40, 10);
const s = slot(-20, 20, 5);

const CASES = [
  ['UI slot (centres 0,40, r=10): obround', sketchDoc(u.geoms, u.rules), (40 * 20 + Math.PI * 100) * H],
  ['slot centres (-20,0),(20,0) r=5', sketchDoc(s.geoms, s.rules), (40 * 10 + Math.PI * 25) * H],
  ['washer (rect minus circle hole)', sketchDoc([...RECT, { k: 'circle', id: 5, c: [20, 12.5], r: 5 }], RECT_RULES.slice(0, 6)), (40 * 25 - Math.PI * 25) * H],
  ['rectangle from 4 lines', sketchDoc(RECT, RECT_RULES), 40 * 25 * H],
  ['KNOWN DEFECT (session.rs:101 discards construction flag): construction line is ignored by the profile', sketchDoc([...RECT, { k: 'line', id: 5, a: [0, 0], b: [40, 25], construction: true }], RECT_RULES), 40 * 25 * H],
  ['circle with a radius rule', sketchDoc([{ k: 'circle', id: 1, c: [0, 0], r: 12 }], [{ k: 'radius', a: 1, value: 12 }]), Math.PI * 144 * H],
];

function build(doc) {
  // Through the script round trip, so what is built is what a reload would give.
  const r = runScript(toScript(doc));
  assert.deepEqual(r.errors, []);
  const features = [...r.doc.features, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }];
  return JSON.parse(brep.measure_doc(JSON.stringify({ version: 1, features })));
}

for (const [name, doc, want] of CASES) {
  test(`brep-rs builds ${name}: refusals {} and closed-form volume`, () => {
    const m = build(doc);
    assert.deepEqual(m.refusals ?? {}, {}, `refused: ${JSON.stringify(m.refusals)}`);
    const got = m.shapes?.e1?.volume;
    assert.ok(Number.isFinite(got), `no e1 shape: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `volume ${got}, closed form ${want}`);
  });
}

test('circle whose radius is param(): builds with the param value', () => {
  const src = [
    "const r = param('holeR', 7, { min: 1, max: 50, step: 1 })",
    "const sk1 = sketch('top')",
    "sk1.geom([{ k:'circle', id:1, c:[0,0], r:r }])",
  ].join('\n');
  const a = runScript(src);
  assert.deepEqual(a.errors, []);
  const features = [...a.doc.features, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }];
  const m = JSON.parse(brep.measure_doc(JSON.stringify({ version: 1, features })));
  assert.deepEqual(m.refusals ?? {}, {});
  assert.ok(Math.abs(m.shapes.e1.volume - Math.PI * 49 * H) < 1e-6 * Math.PI * 49 * H);
});
