// The primitives group's guard (src/primitives.ts), ported from contract/primitives.guard.mjs. No kernel: a fake engine that builds every body it is asked for
// (the guard is pure and runs before any engine run). Every planner set is run, and every verdict is compared with the ORIGINAL guard's on the same doc.
//
// The cases that made it (~/.cache/solidcraft-0.30.1-rig/HALT-4-host-route.md, class C): a flat cone turned and placed off the origin (e23-b: built -129.57 mm3,
// closed form 1.2561), a cylinder whose rim round leaves too narrow a flat top (e15b-R: +61%), a tiny box far out (e12-box: -33%).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './unified-harness.mjs';

const pg = await import(new URL('../dist/primitives.js', import.meta.url).href);
const G = await import(new URL('../../../docs/spikes/solidcraft-referee/contract/primitives.guard.mjs', import.meta.url).href); // the original, the oracle of the port
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const ALL_SETS = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(ALL_SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));
const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };
const D = (f, ...more) => ({ version: 1, features: [{ id: 'f1', center: [0, 0, 0], ...f }, ...more] });

/** every body a command names is built, a unit box at the origin (the guard runs before the engine; nothing here reads a volume) */
const fake = () => async (cmds) => {
  const names = new Set();
  for (const c of cmds) { const p = c.params ?? {}; if (p.body_name) names.add(p.body_name); }
  return { ok: true, measure: { bodies: [...names].map((name) => ({ name, volume_mm3: 1, area_mm2: 6, faces: 6, kernel: { faces: 6, shells: 1 }, face_types: { plane: 6 }, center_of_mass: [0, 0, 0], bbox: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } })) } };
};
const run = async (set, doc, extra = {}) => {
  const { _state, ...r } = await TR[set].translateDoc(structuredClone(doc), { arc: lib.arc, mt: lib.mt, runSC: fake(), soups: {}, resolveAt: () => null, skipMoveTurn: true, skipSketchVolume: true, skipVerify: true, ...extra });
  return r;
};
const feat = (r, id) => r.features.find((f) => f.id === id);

// HALT-4's class C, one doc per family (the probe's own docs: contract/primitives-r4 results), and the original guard's verdict on each
const CLASS_C = {
  'e23-b flat turned cone off the origin': D({ kind: 'cone', radius: 2.449, height: 0.2, center: [0, 0, 500], rotate: [30, 45, 60] }),
  'e26-b thin cone far': D({ kind: 'cone', radius: 0.5, height: 0.02, center: [300, 0, 0], rotate: [0, 30, 0] }),
  'e15b-R cylinder corner leftover': D({ kind: 'cylinder', radius: 10000, height: 20000, round: 9999.5 }),
  'e12-box tiny box far out': D({ kind: 'box', size: [0.01, 0.01, 0.01], center: [1e6, 1e6, 1e6] }),
  'e27-a long thin rounded plate': D({ kind: 'box', size: [2000, 1000, 4], round: 1.8 }),
};
test('class C: every family is refused in every set with the original guard\'s sentence and guard code PRIMITIVES, before any engine run', async () => {
  for (const [name, doc] of Object.entries(CLASS_C)) {
    const want = G.guardFirst(doc);
    assert.ok(want, `${name}: the original guard refuses it`);
    assert.deepEqual(pg.guardFirst(doc), want, `${name}: the port gives the same verdict`);
    for (const set of ALL_SETS) {
      const f = feat(await run(set, doc), 'f1');
      assert.equal(f.status, 'refused', `${set} ${name}: ${JSON.stringify(f).slice(0, 300)}`);
      assert.equal(f.refusal, want.sentence, `${set} ${name}`);
      assert.equal(f.guard, pg.PRIMITIVES_GUARD, `${set} ${name}`);
      assert.deepEqual(f.commands, [], `${set} ${name}`);
    }
  }
});

test('the guard judges the primitive as the script placed it: a turn and a plain move of the primitive itself are folded in', async () => {
  const flat = 'const c = cone(20, 4);';
  const cases = [
    [flat, 'built'],                                                        // flat, at the origin, unturned
    [`${flat} turn(c, [0, 0, 30]);`, 'built'],                             // turned at the origin
    ['const c = cone(20, 4, { at: [5, 0, 0] });', 'built'],               // moved, unturned
    ['const c = cone(20, 4, { at: [5, 0, 0] }); turn(c, [0, 0, 30]);', 'refused'], // the contract's own input (primitives.sentences.mjs coneTurnedMovedFlat)
    [`${flat} turn(c, [0, 0, 30]); move(c, [5, 0, 0]);`, 'refused'],       // the move is folded into the cone
    ['const c = cone(20, 20, { at: [5, 0, 0] }); turn(c, [0, 0, 30]);', 'built'], // tall = across: the limit itself is allowed
  ];
  for (const [src, status] of cases) {
    const doc = docOf(src);
    const want = G.guardFirst(doc);
    assert.equal(!!want, status === 'refused', `${src}: the original agrees`);
    for (const set of ALL_SETS) {
      const r = await run(set, doc);
      const c = feat(r, 'cone1');
      assert.equal(c.status, status, `${set} ${src}: ${JSON.stringify(c).slice(0, 300)}`);
      if (want) {
        assert.equal(c.refusal, want.sentence, `${set} ${src}`);
        for (const g of r.features.filter((x) => x.id !== 'cone1')) assert.equal(g.status, 'refused', `${set} ${src}: ${g.id} depends on the refused cone`);
      }
    }
  }
});

test('close to the limits but inside them: built in every set', async () => {
  const ok = [
    D({ kind: 'box', size: [0.01, 0.01, 0.01] }),                          // the planar floor, at the origin
    D({ kind: 'box', size: [10, 10, 10], center: [999999, 0, 0] }),        // far, but Q is small
    D({ kind: 'cylinder', radius: 10, height: 30, round: 5 }),             // a rim round well inside every limit
    D({ kind: 'cone', radius: 10, height: 0.2 }),                          // tall / across = 0.01, the floor itself
    D({ kind: 'sphere', radius: 1, center: [400, 0, 0] }),                 // 400 x the smallest size
    D({ kind: 'torus', ringRadius: 24, tubeRadius: 1 }),                   // across / tubeAcross = 50
  ];
  for (const doc of ok) {
    assert.equal(G.guardFirst(doc), null, JSON.stringify(doc.features[0]));
    for (const set of ALL_SETS) assert.equal(feat(await run(set, doc), 'f1').status, 'built', `${set} ${JSON.stringify(doc.features[0])}`);
  }
});

test('the contract\'s own guard inputs (primitives.sentences.mjs): the layer refuses each with the sentence the contract quotes', async () => {
  const S = await import(new URL('../../../docs/spikes/solidcraft-referee/contract/primitives.sentences.mjs', import.meta.url).href);
  let n = 0;
  for (const [key, inp] of Object.entries(S.INPUTS)) {
    if (inp.by !== 'guard') continue;
    const doc = inp.doc ?? docOf(inp.script);
    const want = S.produce(key);
    for (const set of ALL_SETS) {
      const r = await run(set, doc);
      const f = r.features.find((x) => x.status === 'refused');
      assert.ok(f, `${set} ${key}: refused`);
      // a box with an every-edge chamfer: the shell-draft group's G-CHAMFER decides it first in the sets that route it there (shell-draft, unified); a whole-shape round the
      // fillet-chamfer group's own guard refuses is refused there in that group's words (fillet-chamfer, unified). Every other set: the contract's sentence.
      if (f.guard === 'G-CHAMFER' || f.fc) continue;
      assert.equal(f.refusal, want, `${set} ${key}`);
      assert.equal(f.guard, pg.PRIMITIVES_GUARD, `${set} ${key}`);
      n++;
    }
  }
  assert.ok(n >= 150, `${n} comparisons`);
});

test('ctx.skipPrimitives switches it off (measuring only)', async () => {
  for (const set of ['base', 'unified']) for (const doc of Object.values(CLASS_C)) assert.notEqual(feat(await run(set, doc, { skipPrimitives: true }), 'f1').guard, pg.PRIMITIVES_GUARD, set);
});

// GUARD-OVERREFUSAL.md: the one place the original guard is narrower than its own row. The row is "cone turned (not about Z only) with tall/across above 10",
// and its evidence says "A turn about Z only (z90) keeps 2 faces"; the original refuses any turn. The probe's own Z-only inputs (e23-a-*-z90, e21-tcone-*-0_0_90)
// built right on 0.30.1 (2 faces, OCCT and brep-rs 2 faces, volume inside the curved bar).
test('cone-turned-slender: a slender cone turned about Z only is judged by the other rules, as its row says; any x or y part is refused as before', async () => {
  const slender = (rotate, center = [0, 0, 0]) => D({ kind: 'cone', radius: 1, height: 36, center, rotate });
  for (const [doc, status, origRefuses] of [
    [slender([0, 0, 90]), 'built', true],            // e23-a-r1-t18-z90's cone (tall / across 18): the original refuses it
    [slender([0, 0, 30], [5, 0, 0]), 'built', true], // about Z, off the origin: tall / across 18 is above the turned-and-moved floor of 1
    [slender([90, 0, 0]), 'refused', true],
    [slender([0, 1e-9, 90]), 'refused', true],       // the smallest y part is a turn off Z
    [slender([0, 0, 0]), 'built', false],            // unturned: nothing changes
  ]) {
    assert.equal(!!G.guardFirst(doc), origRefuses, `${JSON.stringify(doc.features[0].rotate)}: the original`);
    const want = status === 'refused' ? G.guardFirst(doc).sentence : null;
    for (const set of ALL_SETS) {
      const f = feat(await run(set, doc), 'f1');
      assert.equal(f.status, status, `${set} ${JSON.stringify(doc.features[0])}: ${JSON.stringify(f).slice(0, 300)}`);
      if (want) { assert.equal(f.refusal, want, set); assert.equal(f.guard, pg.PRIMITIVES_GUARD, set); }
    }
  }
  // the turn() of a script, folded into the cone: about Z builds, about X is refused with the row's sentence
  const z = docOf('const c = cone(2, 36); turn(c, [0, 0, 90]);'); const x = docOf('const c = cone(2, 36); turn(c, [0, 0, 90]); turn(c, [10, 0, 0]);');
  for (const set of ALL_SETS) {
    assert.equal(feat(await run(set, z), 'cone1').status, 'built', set);
    const fx = feat(await run(set, x), 'cone1');
    assert.equal(fx.status, 'refused', set);
    assert.equal(fx.refusal, 'cone(2, 36): too long to be turned -- a turned cone this long is built with a seam through its side, so tall has to be at most 10 times across, or leave the cone unturned.', set);
  }
});
