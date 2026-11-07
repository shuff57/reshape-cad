// The open-outline pre-flight (src/open-outline.ts): a pull or pocket of a soup with an end that meets nothing is refused before any engine run, in every set.
// No kernel: the refusals are raised by planFeature, so the engine below only counts calls; the closed soups run on the repo's fake engine.
//
// The case that made it (docs/spikes/solidcraft-referee/GUARD-OPEN-OUTLINE.md): a soup rectangle whose line 3 ends at [0.00001, 20] while line 4 starts at [0, 20],
// no coincident rule, pulled 10. SolidCraft 0.30.1 welds the ends and builds 5999.9995 mm3, and 'unified' shipped it; OCCT and brep-rs refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './unified-harness.mjs';
import { makeFake } from './fake-engine.mjs';

const oo = await import(new URL('../dist/open-outline.js', import.meta.url).href);
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const ALL_SETS = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(ALL_SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));

const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };
const L = (id, a, b) => `{ k: 'line', id: ${id}, a: [${a}], b: [${b}] }`;
/** the 30 x 20 rect as four lines, no rules; line 3 ends at [gx, 20], line 4 starts at [0, 20 - gy] (the HALT sweep, step2/gap-sweep.json) */
const rows = (gx, gy) => `[${L(1, '0, 0', '30, 0')}, ${L(2, '30, 0', '30, 20')}, ${L(3, '30, 20', `${gx}, 20`)}, ${L(4, `0, ${20 - gy}`, '0, 0')}]`;
const PULL = (gx, gy) => `const sk = sketch('top'); sk.geom(${rows(gx, gy)}); const part = pull(sk, 10);`;
const POCKET = (gx, gy) => `const b = box(60, 50, 20, { at: [0, 0, 10] }); const sk = sketch('top', 20); sk.geom(${rows(gx, gy)}); pocket(sk, b, 5);`;
const HALT = "const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [30, 0] }, { k: 'line', id: 2, a: [30, 0], b: [30, 20] }, { k: 'line', id: 3, a: [30, 20], b: [0.00001, 20] }, { k: 'line', id: 4, a: [0, 20], b: [0, 0] }]); const part = pull(sk, 10);";

// the owner-approved sentences (2026-11-07), verbatim
const HAIR = (id) => `${id}: the outline does not close: two ends that should meet are a hair apart (less than 0.00001 mm); add a coincident rule between them or make them meet exactly`;
const LOOSE = (id, sk, at, verb) => `${id}: sketch ${sk} has an edge that does not close into a loop (a loose end near ${at}), so it has no outline to ${verb}`;

/** an engine that must not be called for the feature under test: it counts the calls and builds a plain box for any body */
function counting() {
  const seen = [];
  const runSC = async (cmds) => {
    seen.push(cmds);
    const bodies = cmds.filter((c) => c.params?.body_name).map((c) => ({ name: c.params.body_name, bbox: { min: [-30, -25, 0], max: [30, 25, 20] }, volume_mm3: 60000, area_mm2: 1, faces: 6, kernel: { faces: 6, shells: 1 }, face_types: { plane: 6 }, center_of_mass: [0, 0, 10] }));
    return { ok: true, measure: { bodies } };
  };
  return { runSC, seen };
}
const run = async (set, doc, runSC, extra = {}) => {
  const { _state, ...r } = await TR[set].translateDoc(structuredClone(doc), { arc: lib.arc, mt: lib.mt, runSC, soups: {}, resolveAt: () => null, ...extra });
  return r;
};
const feat = (r, kind) => r.features.find((f) => f.kind === kind);
const extrudeCmds = (seen) => seen.flat().filter((c) => c.command === 'solid.extrude').length;

/** refused in every set with `want`, and the feature's own commands never reached the engine */
async function refusedEverywhere(src, kind, want) {
  const doc = docOf(src);
  for (const set of ALL_SETS) {
    const eng = counting();
    const r = await run(set, doc, eng.runSC);
    const f = feat(r, kind);
    assert.equal(f.status, 'refused', `${set}: ${JSON.stringify(f).slice(0, 300)}`);
    assert.equal(f.refusal, want, set);
    assert.equal(f.guard, oo.OPEN_OUTLINE_GUARD, set);
    assert.equal(extrudeCmds(eng.seen), 0, `${set}: the engine was asked to extrude`);
  }
}

test('the halt case: line 3 stops 1e-5 short of line 4, no rule: every set refuses the pull with the loose-end sentence', async () => {
  const doc = docOf(HALT);
  const sk = doc.features.find((f) => f.kind === 'sketch').id;
  const pull = feat(await run('unified', doc, counting().runSC), 'extrude').id;
  await refusedEverywhere(HALT, 'extrude', LOOSE(pull, sk, '[0, 20]', 'pull'));
});

test('the gap sweep (1e-7, 1e-5, 3e-5, 1e-4 in x and in y): every set refuses the pull; under 1e-5 "a hair apart", from 1e-5 on the loose end', async () => {
  for (const g of [1e-7, 1e-5, 3e-5, 1e-4]) {
    for (const [gx, gy] of [[g, 0], [0, g]]) {
      const src = PULL(gx, gy);
      const doc = docOf(src);
      const sk = doc.features.find((f) => f.kind === 'sketch');
      const drawn = Math.hypot(sk.geoms[2].b[0] - sk.geoms[3].a[0], sk.geoms[2].b[1] - sk.geoms[3].a[1]);
      const id = doc.features.find((f) => f.kind === 'extrude').id;
      await refusedEverywhere(src, 'extrude', drawn < 1e-5 ? HAIR(id) : LOOSE(id, sk.id, '[0, 20]', 'pull'));
    }
  }
});

test('pockets with an open outline (1e-6, 1e-4, 1e-3): every set refuses, a wide gap with "no outline to cut"', async () => {
  for (const g of [1e-6, 1e-4, 1e-3]) {
    const src = POCKET(0, g);
    const doc = docOf(src);
    const sk = doc.features.find((f) => f.kind === 'sketch').id;
    const id = doc.features.find((f) => f.kind === 'pocket').id;
    await refusedEverywhere(src, 'pocket', g < 1e-5 ? HAIR(id) : LOOSE(id, sk, '[0, 20]', 'cut'));
  }
});

const CLOSED = {
  exact: PULL(0, 0),
  'coincident rules, ends drawn 1e-7 apart': `const sk = sketch('top'); sk.geom(${rows(1e-7, 0)}); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }]); const part = pull(sk, 10);`,
  'an arc and lines (a D shape), exact': `const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [20, 0] }, { k: 'arc', id: 2, c: [20, 10], r: 10, a: [20, 0], b: [20, 20], sense: 'ccw' }, { k: 'line', id: 3, a: [20, 20], b: [0, 20] }, { k: 'line', id: 4, a: [0, 20], b: [0, 0] }]); const part = pull(sk, 10);`,
  'a rect with a circle hole': `const sk = sketch('top'); sk.geom([${L(1, '0, 0', '30, 0')}, ${L(2, '30, 0', '30, 20')}, ${L(3, '30, 20', '0, 20')}, ${L(4, '0, 20', '0, 0')}, { k: 'circle', id: 5, c: [15, 10], r: 4 }]); const part = pull(sk, 10);`,
  'a lone circle': "const sk = sketch('top'); sk.geom([{ k: 'circle', id: 1, c: [0, 0], r: 5 }]); const part = pull(sk, 10);",
  'joined through a point row by coincident rules': `const sk = sketch('top'); sk.geom([${L(1, '0, 0', '30, 0')}, ${L(2, '30, 0', '30, 20')}, ${L(3, '30, 20', '1e-7, 20')}, ${L(4, '0, 20', '0, 0')}, { k: 'point', id: 5, p: [0, 20] }]); sk.rules([{ k: 'coincident', a: 3, aEnd: 'b', b: 5 }, { k: 'coincident', a: 5, b: 4, bEnd: 'a' }]); const part = pull(sk, 10);`,
};

test('closed soups build in every set: exact ends, coincident rules, arcs and circles; and a closed pocket', async () => {
  for (const [what, src] of Object.entries({ ...CLOSED, 'a closed pocket': POCKET(0, 0) })) {
    const doc = docOf(src);
    const sk = doc.features.find((f) => f.kind === 'sketch');
    assert.equal(oo.openOutline(sk), null, what);
    const kind = doc.features.some((f) => f.kind === 'pocket') ? 'pocket' : 'extrude';
    for (const set of ALL_SETS) {
      const fake = makeFake({ boxBool: true });
      const f = feat(await run(set, doc, fake.runSC, { skipSketchVolume: true, skipVerify: true }), kind);
      assert.equal(f.status, 'built', `${what} / ${set}: ${JSON.stringify(f).slice(0, 300)}`);
    }
  }
});

test('the threshold: ends 1e-10 apart are the same point, 1e-8 apart are not; construction rows and inactive rules do not join', () => {
  const sk = (geoms, rules = []) => ({ id: 'sk1', kind: 'sketch', plane: 'xy', geoms, rules });
  const line = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
  const rect = (g) => [line(1, [0, 0], [30, 0]), line(2, [30, 0], [30, 20]), line(3, [30, 20], [g, 20]), line(4, [0, 20], [0, 0])];
  assert.equal(oo.SAME_POINT, 1e-9);
  assert.equal(oo.openOutline(sk(rect(1e-10))), null);
  assert.equal(oo.openOutline(sk(rect(1e-12))), null);
  assert.deepStrictEqual(oo.openOutline(sk(rect(1e-8))), { kind: 'hair', gap: 1e-8 });
  // a coincident rule holds it, whatever the drawn gap
  assert.equal(oo.openOutline(sk(rect(0.5), [{ k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }])), null);
  // ... also through a point row, and through the origin (row -1)
  assert.equal(oo.openOutline(sk([...rect(0.5), { k: 'point', id: 5, p: [0, 20] }], [{ k: 'coincident', a: 3, aEnd: 'b', b: 5 }, { k: 'coincident', a: 5, b: 4, bEnd: 'a' }])), null);
  assert.equal(oo.openOutline(sk([line(1, [0, 0], [30, 0]), line(2, [30, 0], [30, 20]), line(3, [30, 20], [0, 20]), line(4, [0, 20], [0.5, 0])], [{ k: 'coincident', a: 1, aEnd: 'a', b: -1 }, { k: 'coincident', a: 4, aEnd: 'b', b: -1 }])), null);
  // an inactive rule does not
  assert.equal(oo.openOutline(sk(rect(0.5), [{ k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a', active: false }]))?.kind, 'loose');
  // a construction line on the gap does not close it
  assert.equal(oo.openOutline(sk([...rect(0.5), line(5, [0.5, 20], [0, 20], { construction: true })]))?.kind, 'loose');
  // an open chain of three lines: the loose end the even-odd picker would name
  assert.deepStrictEqual(oo.openOutline(sk([line(1, [0, 0], [10, 0]), line(2, [10, 0], [10, 10]), line(3, [10, 10], [0, 10])])), { kind: 'loose', at: [0, 10], gap: 10 });
  // not a soup, a pull of a circle sketch, a revolve: no claim
  assert.equal(oo.openOutline({ id: 'sk1', kind: 'sketch', shape: 'circle', points: [[0, 0], [10, 0]] }), null);
  assert.equal(oo.openOutlineRefusal({ id: 'r1', kind: 'revolve' }, sk(rect(0.5))), null);
});

test('ctx.skipOpenOutline switches the pre-flight off (measuring only)', async () => {
  const doc = docOf(HALT);
  const eng = counting();
  const f = feat(await run('unified', doc, eng.runSC, { skipOpenOutline: true, skipSketchVolume: true, skipVerify: true }), 'extrude');
  assert.notEqual(f.refusal ?? '', LOOSE(f.id, doc.features[0].id, '[0, 20]', 'pull'));
  assert.ok(extrudeCmds(eng.seen) > 0, 'the engine was asked');
});
