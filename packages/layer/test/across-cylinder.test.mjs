// A plain through bore ACROSS a cylinder or a pulled circle is cut (plan item 4; owner decision 2026-11-14: "allow plain through bores";
// pilot-2026-11b/PILOT-2.md, "A hole across a solid cylinder: the family"). Everything else across a curved wall stays refused with the sentence it had.
// The rule in the layer and in the contract copy, and through the translator on the fake engine. The real engine's side is the family's sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFake } from './fake-engine.mjs';
import { box, cyl, cone, circ, rect, extrude, hole, shell, move, mirror, pattern, fillet, prim } from './docs.mjs';

const H = await import(new URL('../dist/holes.js', import.meta.url).href);
const L = await import(new URL('../dist/index.js', import.meta.url).href);
const C = await import(new URL('../../../docs/spikes/solidcraft-referee/contract/holes4-translate.mjs', import.meta.url).href);
const arc = await import(new URL('../../sketch/dist/sketch-arc.js', import.meta.url).href);
const G = (feats) => ({ byId: Object.fromEntries(feats.map((f) => [f.id, f])) });
const across = (id, target, extra) => hole(id, target, { axis: 'x', depth: 60, ...extra });
/** the rule as planHole asks it: is this hole, across this part, one that is cut? (through: the caller measures that on the engine's box) */
const allowed = (M, feats, h, through = true) => { const g = G([...feats, h]); const cr = M.curvedRootOf(h.target, g); const cv = M.curvedAxis(cr, g); return M.acrossAllowed(h, cr, M.rootOf(h.target, g), cv, through, g); };

test('allowed: a plain through bore across a cylinder, a cylinder turned onto another main axis, a pulled circle, and after earlier holes', () => {
  for (const M of [H, C]) {
    assert.equal(allowed(M, [cyl('c1')], across('h2', 'c1')), true, 'a cylinder');
    assert.equal(allowed(M, [cyl('c1', 8, 12, [13, -7, 5])], across('h2', 'c1', { axis: 'y' })), true, 'not at the origin, along y');
    assert.equal(allowed(M, [cyl('c1', 8, 12, [0, 0, 0], { rotate: [90, 0, 0] })], across('h2', 'c1', { axis: 'z' })), true, 'turned: its axis is y, the bore along z');
    assert.equal(allowed(M, [cyl('c1', 8, 12, [0, 0, 0], { rotate: [0, 90, 0] })], across('h2', 'c1', { axis: 'y' })), true, 'turned: its axis is x');
    assert.equal(allowed(M, [circ('sk1'), extrude('e1', 'sk1')], across('h2', 'e1')), true, 'a pulled circle');
    assert.equal(allowed(M, [cyl('c1'), across('h2', 'c1', { center: [0, 0, 3] })], across('h3', 'h2', { center: [0, 0, -3] })), true, 'a second bore: only holes came before');
    assert.equal(allowed(M, [cyl('c1'), hole('h2', 'c1')], across('h3', 'h2')), true, 'after a hole along the axis (whether the two meet is G-CROSS, not this rule)');
  }
});

test('not allowed, so refused as before: a blind bore, a recess, four at the corners, a cone, a slanted cylinder, an outline that is not a circle, a pull with options', () => {
  for (const M of [H, C]) {
    assert.equal(allowed(M, [cyl('c1')], across('h2', 'c1'), false), false, 'it does not go all the way through');
    assert.equal(allowed(M, [cyl('c1')], across('h2', 'c1', { counterbore: { diameter: 7, depth: 2 } })), false, 'a counterbore');
    assert.equal(allowed(M, [cyl('c1')], across('h2', 'c1', { countersink: { diameter: 7, angleDeg: 90 } })), false, 'a countersink');
    assert.equal(allowed(M, [cyl('c1')], across('h2', 'c1', { corners: { dx: 2, dy: 2 } })), false, 'four holes at once');
    assert.equal(allowed(M, [cone('k1')], across('h2', 'k1')), false, 'a cone');
    assert.equal(allowed(M, [cyl('c1', 8, 12, [0, 0, 0], { rotate: [45, 0, 0] })], across('h2', 'c1')), false, 'a cylinder turned 45 degrees: its axis is along no main axis');
    assert.equal(allowed(M, [rect('sk1', 20, 12, { rounds: { 0: 3 } }), extrude('e1', 'sk1')], across('h2', 'e1')), false, 'a pad with one rounded corner');
    for (const opt of [{ taper: 3 }, { midplane: true }, { reversed: true }, { length2: 4 }, { rotate: [90, 0, 0] }]) {
      assert.equal(allowed(M, [circ('sk1'), extrude('e1', 'sk1', 10, opt)], across('h2', 'e1')), false, `a pulled circle with ${Object.keys(opt)[0]}`);
    }
  }
});

test('not allowed behind anything but earlier holes: a hollow, a move, a copy, a mirror, a repeat, a round, a bevel (owner decisions 2026-11-13 and 2026-11-14)', () => {
  const behind = [shell('s2', 'c1', prim('c1', '+z')), move('s2', 'c1'), move('s2', 'c1', [60, 0, 0], true), mirror('s2', 'c1'), pattern('s2', 'c1'), fillet('s2', 'c1', null, 1), fillet('s2', 'c1', null, 1, 'chamfer')];
  for (const M of [H, C]) for (const step of behind) {
    assert.equal(allowed(M, [cyl('c1'), step], across('h3', 's2')), false, `behind a ${step.kind}`);
    assert.equal(allowed(M, [cyl('c1'), step, across('h3', 's2', { center: [0, 0, 3] })], across('h4', 'h3', { center: [0, 0, -3] })), false, `behind a ${step.kind} and a hole`);
  }
});

test('the box check: how far one box reaches outside another, and the limit', () => {
  for (const M of [H, C]) {
    assert.equal(M.boxOutside([-1, -2, -3, 1, 2, 3], [-1, -2, -3, 1, 2, 3]), 0);
    assert.ok(Math.abs(M.boxOutside([-1, -2, -3.0091, 1, 2, 3], [-1, -2, -3, 1, 2, 3]) - 0.0091) < 1e-12, 'below the bottom');
    assert.ok(Math.abs(M.boxOutside([-1, -2, -3, 1.0005, 2, 3], [-1, -2, -3, 1, 2, 3]) - 0.0005) < 1e-12, 'past +x');
    assert.ok(M.boxOutside([-0.9, -1.9, -2.9, 0.9, 1.9, 2.9], [-1, -2, -3, 1, 2, 3]) < 0, 'inside everywhere');
    assert.equal(M.ACROSS_BOX_MM, 2.6e-3);
    assert.ok(M.ALL_GUARDS.includes('G-ACROSS-BOX'));
  }
  // the family's one case past the limit, and the largest that is the engine's ordinary movement of a cylinder's box
  assert.ok(0.0091 > H.ACROSS_BOX_MM && 8.1e-4 < H.ACROSS_BOX_MM);
});

test('through the translator: what stays refused gets the sentence it had, at once; the plain through bore is no longer stopped by G-CURVED', async () => {
  const SKIP = { skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true };
  const run = async (feats) => { const fa = makeFake({ sync: true }); let runs = 0;
    const r = await L.createTranslator({ planners: 'unified' }).translateDoc({ version: 1, features: structuredClone(feats) }, { arc, ...SKIP, runSC: (c, o) => { runs++; return fa.runSC(c, o); }, topologyOf: fa.topologyOf, soups: {} });
    return { last: r.features.at(-1), runs }; };
  const sentence = (id, what) => `${id} (hole): a hole drilled across ${what} would cut through its curved wall at an angle, which is not supported yet, so ${id} is shown without it -- drill along the axis of ${what}, or use a flat-sided shape.`;
  const base = (await run([cyl('c1', 8, 30)])).runs;
  for (const [what, feats] of [
    ['a blind bore', [cyl('c1', 8, 30), across('h2', 'c1', { depth: 6, center: [5, 0, 0] })]],
    ['a counterbore', [cyl('c1', 8, 30), across('h2', 'c1', { counterbore: { diameter: 7, depth: 2 } })]],
    ['a cone', [cone('c1', 8, 30), across('h2', 'c1')]],
    ['behind a move', [cyl('c1', 8, 30), move('m2', 'c1'), across('h2', 'm2')]],
  ]) {
    const { last } = await run(feats);
    assert.equal(last.status, 'refused', what); assert.equal(last.guard, 'G-CURVED', what);
    assert.equal(last.refusal, sentence('h2', feats[0].kind === 'cone' ? 'the cone' : 'the cylinder'), what);
  }
  const blind = await run([cyl('c1', 8, 30), across('h2', 'c1', { depth: 6, center: [5, 0, 0] })]);
  assert.equal(blind.runs, base, 'refused before the engine is asked for anything more');
  const plain = await run([cyl('c1', 8, 30), across('h2', 'c1')]);
  assert.notEqual(plain.last.guard, 'G-CURVED', 'the plain through bore goes on to the engine');
  assert.ok(plain.runs > base, 'and the engine is asked');
});
