// The shell-draft set's named-edge fillet pick through ctx.resolveAt (shell-draft.ts filletEdgeAt; next-work loop phase 1,
// docs/spikes/solidcraft-referee/fuzz/NEXT-LOOP-PHASE1.md). Fake engine and the fake primitive-frame resolver of the shell-draft differential test:
// no kernel. What it pins:
//   1. with a resolver, a fillet's `between` edge on a plain box whose history is fillets only is picked at the resolver's point (the edge midpoint
//      in the box's own frame), one candidate, pickedFrom says so, and the hollow after it is planned as before;
//   2. every case outside the proven-safe set falls back to path B (the base's topology pick) with the base's own result, so no new refusal or
//      sentence exists: a move in the history, the same edge twice, an earlier fillet as big as half the edge, a turned box, a whole-shape round,
//      a hole in the history, no resolver at all;
//   3. the fallback is exactly path B: a one-fillet doc comes out equal to the run with no resolver.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { fakeResolveAt } from './fake-resolve-at.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const arc = await imp('packages/sketch/dist/sketch-arc.js');
const mt = await imp('packages/script/dist/model-types.js');
const { createTranslator } = await imp('packages/layer/dist/index.js');
const sd = createTranslator({ planners: 'shell-draft' });
const PICKED_AT = 'ctx.resolveAt (primitive frame; only fillets in the history)';

const P = (part, feature = 'b1') => ({ cause: 'primitive', feature, kind: 'face', part });
const between = (a, b, feature = 'b1') => ({ cause: 'between', feature, kind: 'edge', of: [P(a, feature), P(b, feature)] });
const box = (extra = {}) => ({ id: 'b1', kind: 'box', size: [40, 30, 10], center: [0, 0, 5], ...extra });
const fillet = (id, target, edge, size = 1.5) => ({ id, kind: 'fillet', target, edge, size, style: 'fillet' });
const hollow = (target) => ({ id: 's1', kind: 'shell', target, thickness: 1, open: P('+z') });
const bottomFour = (size = 1.5) => [
  fillet('r1', 'b1', between('-z', '-y'), size), fillet('r2', 'r1', between('-z', '+y'), size),
  fillet('r3', 'r2', between('-z', '-x'), size), fillet('r4', 'r3', between('-z', '+x'), size),
];

async function run(features, { resolver = fakeResolveAt } = {}) {
  const fake = makeFake({ sync: true, shellDraft: true });
  const ctx = { arc, mt, runSC: fake.runSC, topologyOf: fake.topologyOf, soups: {}, ...(resolver ? { resolveAt: resolver } : {}) };
  const { _state, ...rest } = await sd.translateDoc({ features: structuredClone(features) }, ctx);
  return rest;
}
const byId = (tr) => Object.fromEntries(tr.features.map((f) => [f.id, f]));

test('path A: four bottom fillets on a plain box are picked at the resolver point, one candidate each, and the hollow still plans', async () => {
  const tr = byId(await run([box(), ...bottomFour(), hollow('r4')]));
  const want = { r1: [0, -15, 0], r2: [0, 15, 0], r3: [-20, 0, 0], r4: [20, 0, 0] };
  for (const [id, p] of Object.entries(want)) {
    assert.equal(tr[id].status, 'built', `${id} built`);
    assert.equal(tr[id].pickedFrom, PICKED_AT, `${id} picked through the resolver`);
    assert.deepEqual(tr[id].pick.edges, [p], `${id} picked at the edge midpoint`);
    assert.equal(tr[id].variantsTried, 1);
    assert.equal(tr[id].commands.length, 1);
    assert.equal(tr[id].commands[0].command, 'solid.fillet');
  }
  assert.ok(tr.s1, 'the hollow is planned');
});

test('path A: the same rule holds for a bevel (chamfer style) and a vertical edge', async () => {
  const tr = byId(await run([box(), { ...fillet('r1', 'b1', between('-y', '+x'), 1), style: 'chamfer' }]));
  assert.equal(tr.r1.status, 'built');
  assert.equal(tr.r1.pickedFrom, PICKED_AT);
  assert.deepEqual(tr.r1.pick.edges, [[20, -15, 5]]);
  assert.equal(tr.r1.commands[0].command, 'solid.chamfer');
});

// every one of these must come out of the step exactly as path B (no resolver) gives it
const FALLBACK = {
  'a move between the box and the fillet': [box(), { id: 'm1', kind: 'move', target: 'b1', offset: [5, 0, 0] }, fillet('r1', 'm1', between('-z', '-y'))],
  'the same edge rounded twice': [box(), fillet('r1', 'b1', between('-z', '-y')), fillet('r2', 'r1', between('-y', '-z'))],
  'an earlier fillet as big as half the edge': [box({ size: [8, 6, 10] }), fillet('r1', 'b1', between('-z', '-y'), 3), fillet('r2', 'r1', between('-z', '-x'), 1)],
  'a turned box': [box({ rotate: [0, 0, 30] }), fillet('r1', 'b1', between('-z', '-y'))],
  'a box with a whole-shape round': [box({ round: 1 }), fillet('r1', 'b1', between('-z', '-y'))],
  'a hole in the history': [box(), { id: 'h1', kind: 'hole', target: 'b1', center: [0, 0, 0], diameter: 4, depth: 12 }, fillet('r1', 'h1', between('-z', '-y'))],
  'opposite faces (no edge)': [box(), fillet('r1', 'b1', between('-z', '+z'))],
  'a face of another feature in the name': [box(), { id: 'b2', kind: 'box', size: [5, 5, 5], center: [0, 0, 20] }, fillet('r1', 'b1', { cause: 'between', feature: 'b1', kind: 'edge', of: [P('-z'), P('-y', 'b2')] })],
};
for (const [label, features] of Object.entries(FALLBACK)) {
  test(`path B kept: ${label}`, async () => {
    const withR = await run(features);
    const without = await run(features, { resolver: null });
    // the LAST fillet is the one outside the safe set (an earlier one may rightly be on path A)
    const fl = withR.features.filter((x) => x.kind === 'fillet');
    const last = fl[fl.length - 1];
    assert.notEqual(last.pickedFrom, PICKED_AT, `${last.id} must not use the resolver point`);
    // a doc with one fillet: the whole result equals path B's (no resolver); with two, the earlier one differs by its pick source only
    if (fl.length === 1) assert.deepEqual(withR.features, without.features, 'the doc comes out exactly as path B gives it');
    else assert.ok(last.status === 'built' ? /topology/.test(String(last.pickedFrom)) : !/resolveAt/.test(String(last.refusal)), `${last.id} is path B's result`);
  });
}

test('no resolver: the fillet is planned by path B as before', async () => {
  const tr = byId(await run([box(), fillet('r1', 'b1', between('-z', '-y'))], { resolver: null }));
  assert.notEqual(tr.r1.pickedFrom, PICKED_AT);
});

test('a resolver that answers nothing (or a face) leaves path B in charge', async () => {
  for (const resolver of [() => null, () => ({ kind: 'face', centroid: [0, 0, 0] }), () => ({ kind: 'edge', centroid: [0, -15, 0] })]) {
    const a = await run([box(), fillet('r1', 'b1', between('-z', '-y'))], { resolver });
    const b = await run([box(), fillet('r1', 'b1', between('-z', '-y'))], { resolver: null });
    assert.deepEqual(a.features.find((x) => x.id === 'r1'), b.features.find((x) => x.id === 'r1'));
  }
});
