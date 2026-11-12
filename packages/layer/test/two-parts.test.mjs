// A hole in a script that has more than one part (owner decision 2026-11-12; docs/spikes/solidcraft-referee/GUARD-TWO-PARTS.md).
// G-BODIES used to refuse every hole once the engine held a second body. It now lets a hole through when every other body is a DIFFERENT PART (no shared
// primitive or sketch), and G-OTHERS, after the cut, requires every other body to come back as it was. No kernel here: the layer's holes set and the
// contract copy on the fake engine, and a fake that damages the other part on purpose (what SolidCraft's solid.hole does to a lid on top of the drilled part).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFake } from './fake-engine.mjs';
import { box, cyl, rect, extrude, pocket, combine, pattern, move, hole } from './docs.mjs';

const H = await import(new URL('../dist/holes.js', import.meta.url).href);
const L = await import(new URL('../dist/index.js', import.meta.url).href);
const C = await import(new URL('../../../docs/spikes/solidcraft-referee/contract/holes4-translate.mjs', import.meta.url).href);
const arc = await import(new URL('../../sketch/dist/sketch-arc.js', import.meta.url).href);
const byIdOf = (feats) => Object.fromEntries(feats.map((f) => [f.id, f]));
const SKIP = { skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true };

test('rootsOf: the primitives and sketches a step is built from, in the layer and in the contract copy alike', () => {
  const feats = [box('b1'), box('b2', [10, 10, 10], [50, 0, 0]), hole('h1', 'b1'), hole('h2', 'h1'), rect('sk1'), extrude('e1', 'sk1'), rect('sk2'), pocket('pk1', 'sk2', 'e1'),
    combine('c1', 'union', ['b2', 'pk1']), pattern('p1', 'b1'), move('m1', 'b1', [60, 0, 0], true)];
  const byId = byIdOf(feats);
  for (const R of [H.rootsOf, C.rootsOf]) {
    assert.deepEqual([...R('b1', byId)], ['b1']);
    assert.deepEqual([...R('h2', byId)], ['b1'], 'through the holes back to the box');
    assert.deepEqual([...R('e1', byId)], ['sk1']);
    assert.deepEqual([...R('pk1', byId)].sort(), ['sk1', 'sk2']);
    assert.deepEqual([...R('c1', byId)].sort(), ['b2', 'sk1', 'sk2']);
    assert.deepEqual([...R('p1', byId)], ['b1'], 'a pattern of b1 shares its root');
    assert.deepEqual([...R('m1', byId)], ['b1'], 'a copy of b1 shares its root');
    assert.equal(R('nothing', byId).size, 0);
  }
  // a cycle in the ids does not hang
  const loop = byIdOf([{ id: 'a', kind: 'move', target: 'b' }, { id: 'b', kind: 'move', target: 'a' }]);
  assert.equal(H.rootsOf('a', loop).size, 0);
});

test('otherPartsOnly: other bodies are let through only when each is a different part with a known maker', () => {
  const feats = [box('b1'), box('b2', [10, 10, 10], [50, 0, 0]), pattern('p1', 'b1'), hole('h1', 'b1')];
  const byId = byIdOf(feats);
  const row = (name) => ({ name, volume: 1000, shells: 1, faces: 6 });
  const st = (bodies, rows) => ({ bodies, holes: { allRows: rows, allCount: rows.length }, allRows: rows, allCount: rows.length });
  for (const [f, mk] of [[H.otherPartsOnly, (b, r) => st(b, r)], [C.otherPartsOnly, (b, r) => st(b, r)]]) {
    // a second, unrelated box
    assert.equal(f('b1', ['B1'], mk({ b1: ['B1'], b2: ['B2'] }, [row('B1'), row('B2')]), byId), true);
    // a body no accepted step lists (a piece the engine split off, a copy it named itself): not known to be another part
    assert.equal(f('b1', ['B1'], mk({ b1: ['B1'], b2: ['B2'] }, [row('B1'), row('B2'), row('B2 (2)')]), byId), false);
    // a body a pattern of THIS part made: a copy, not another part
    assert.equal(f('b1', ['B1'], mk({ b1: ['B1'], p1: ['P1'] }, [row('B1'), row('P1')]), byId), false);
    // the rows are not the engine's state after the last accepted step (count differs): nothing is assumed
    assert.equal(f('b1', ['B1'], { ...mk({ b1: ['B1'], b2: ['B2'] }, [row('B1'), row('B2')]), holes: { allRows: [row('B1')], allCount: 2 }, allRows: [row('B1')], allCount: 2 }, byId), false);
    // the target is not in the doc
    assert.equal(f('zz', ['B1'], mk({ b1: ['B1'], b2: ['B2'] }, [row('B1'), row('B2')]), byId), false);
  }
});

test('othersChanged and makerOf: the body that changed, and the step that made it', () => {
  const before = [{ name: 'A', volume: 32000, shells: 1, faces: 6 }, { name: 'B', volume: 6400, shells: 1, faces: 6 }];
  for (const f of [H.othersChanged, C.othersChanged]) {
    assert.equal(f(['A'], before, [{ name: 'A', volume: 31434.6, shells: 1, faces: 7 }, { name: 'B', volume: 6400, shells: 1, faces: 6 }]), null, 'only the drilled part changed');
    assert.equal(f(['A'], before, [{ name: 'A', volume: 31095.3, shells: 1, faces: 9 }, { name: 'B', volume: 6332.153, shells: 1, faces: 8 }]), 'B', 'the lid lost volume (measured on 0.30.1)');
    assert.equal(f(['A'], before, [{ name: 'A', volume: 31434.6, shells: 1, faces: 7 }]), 'B', 'the other part is gone');
    assert.equal(f(['A'], before, [{ name: 'A', volume: 31434.6, shells: 1, faces: 7 }, { name: 'B', volume: 6400, shells: 1, faces: 7 }]), 'B', 'a face more');
    assert.equal(f(['A'], before, [{ name: 'A', volume: 31434.6, shells: 1, faces: 7 }, { name: 'B', volume: 6400, shells: 2, faces: 6 }]), 'B', 'a shell more');
    assert.equal(f(['A'], before, [{ name: 'A', volume: 31434.6, shells: 1, faces: 7 }, { name: 'B', volume: 6400 * (1 + 1e-12), shells: 1, faces: 6 }]), null, 'last-digit noise is not a change');
    assert.equal(f(['A'], before, [{ name: 'A', volume: 31434.6, shells: 1, faces: 7 }, { name: 'B', volume: 6400 - 1e-3, shells: 1, faces: 6 }]), 'B', 'a thousandth of a cubic millimetre is');
  }
  const byId = byIdOf([box('box1'), box('box2'), hole('hole1', 'box2')]);
  for (const mk of [H.makerOf, C.makerOf]) {
    const of = mk({ bodies: { box1: ['b_box1'], box2: ['b_box2'], hole1: ['b_box2'] } }, byId);
    assert.equal(of('b_box2'), 'box2', 'the step that made it, not the last step that changed it');
    assert.equal(of('b_nobody'), undefined);
  }
});

test('the G-OTHERS sentence is the owner-approved text, in the layer and in the contract copy', () => {
  const want = 'hole1 (hole): cutting it would also cut box2, which is in the way of this hole, so hole1 is shown without it -- drill this hole before you make box2.';
  assert.equal(L.HOLES_SENTENCE.others({ id: 'hole1' }, 'box2'), want);
  assert.equal(C.SENTENCE.others({ id: 'hole1' }, 'box2'), want);
});

const TWO = { version: 1, features: [box('box1', [40, 40, 20]), box('box2', [40, 40, 4], [0, 0, 12]), hole('hole1', 'box1', { diameter: 6 })] };
const lean = (r) => r.features.map((f) => [f.id, f.status, f.guard ?? null, f.refusal ?? null]);
async function both(doc, runSCOf, off = []) {
  const fa = makeFake({ sync: true }); const fb = makeFake({ sync: true });
  const port = await L.createTranslator({ planners: 'holes' }).translateDoc(structuredClone(doc), { arc, ...SKIP, runSC: runSCOf(fa), topologyOf: fa.topologyOf, soups: {}, ...(off.length ? { guardsOff: off } : {}) });
  const orig = C.translateDocGuarded(structuredClone(doc), { arc, ...SKIP, runSC: runSCOf(fb), resolveAt: () => null }, { off });
  assert.deepEqual(lean(port), lean(orig), 'the layer and the contract copy agree');
  return port;
}

test('a hole in one of two separate parts is built; a hole in each is built; a pattern of another part does not stop it', async () => {
  const plain = (fake) => fake.runSC;
  const r = await both(TWO, plain);
  assert.deepEqual(r.features.map((f) => f.status), ['built', 'built', 'built']);
  const each = await both({ version: 1, features: [...TWO.features, hole('hole2', 'box2', { diameter: 4 })] }, plain);
  assert.deepEqual(each.features.map((f) => f.status), ['built', 'built', 'built', 'built']);
  // a pattern of ANOTHER part does not stop a hole in this one
  const other = await both({ version: 1, features: [box('box1', [40, 40, 20]), pattern('p1', 'box1', { count: 2, step: [60, 0, 0] }), box('box2', [10, 10, 10], [0, 200, 0]), hole('hole1', 'box2', { diameter: 4 })] }, plain);
  assert.equal(other.features.find((f) => f.id === 'hole1').status, 'built');
  // a hole aimed at a part a pattern has since taken over is refused as before (not by this guard)
  const taken = await both({ version: 1, features: [box('box1', [40, 40, 20]), pattern('p1', 'box1', { count: 2, step: [60, 0, 0] }), hole('hole1', 'box1', { diameter: 6 })] }, plain);
  assert.equal(taken.features.find((f) => f.id === 'hole1').status, 'refused');
});

test('G-OTHERS: when the cut also changes the other part, the hole is refused in the approved sentence; switched off, it is built (the negative control)', async () => {
  // a fake that does what the kernel does to a lid on top of the drilled part: the reply that holds the cut has the OTHER body smaller, with two more faces
  const damaging = (fake) => (cmds, o) => {
    const res = fake.runSC(cmds, o);
    if (!res?.ok || !cmds.some((c) => c.command === 'solid.cylinder' && c.params?.operation === 'cut')) return res;
    const out = structuredClone(res);
    const lid = out.measure.bodies.find((b) => Math.abs(b.volume_mm3 - 6400) < 1e-6);
    assert.ok(lid, 'the fake holds the lid');
    lid.volume_mm3 -= 67.847; lid.faces += 2;
    return out;
  };
  const r = await both(TWO, damaging);
  const h = r.features.find((f) => f.id === 'hole1');
  assert.equal(h.status, 'refused'); assert.equal(h.guard, 'G-OTHERS');
  assert.equal(h.refusal, 'hole1 (hole): cutting it would also cut box2, which is in the way of this hole, so hole1 is shown without it -- drill this hole before you make box2.');
  assert.equal(r.commands.some((c) => c.command === 'solid.cylinder' && c.params?.operation === 'cut'), false, 'the cut is not among the commands the page builds');
  const off = await both(TWO, damaging, ['G-OTHERS']);
  assert.equal(off.features.find((f) => f.id === 'hole1').status, 'built', 'without the check the damaged lid would have been shown');
});
