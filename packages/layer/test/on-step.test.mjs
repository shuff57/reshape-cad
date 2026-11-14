// ctx.onStep (plan item 3, 2026-11-14): the layer tells its caller which step it is about to work on, so a page can say so during a long run.
// Nothing in the result may depend on it. No kernel: the fake engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFake } from './fake-engine.mjs';
import { box, hole, rect, extrude } from './docs.mjs';

const L = await import(new URL('../dist/index.js', import.meta.url).href);
const arc = await import(new URL('../../sketch/dist/sketch-arc.js', import.meta.url).href);
const SKIP = { skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true };
const DOC = { version: 1, features: [box('box1', [40, 40, 20]), hole('hole1', 'box1', { diameter: 6 }), rect('sk1'), extrude('e1', 'sk1'), hole('hole2', 'nothing')] };
const run = (extra, planners = 'unified') => { const fa = makeFake({ sync: true }); return L.createTranslator({ planners }).translateDoc(structuredClone(DOC), { arc, ...SKIP, runSC: fa.runSC, topologyOf: fa.topologyOf, soups: {}, ...extra }); };
const lean = (r) => r.features.map((f) => [f.id, f.kind, f.status, f.refusal ?? null]);

test('every step is announced once, in order, with its place and the count, before it is worked on', async () => {
  for (const planners of ['unified', 'holes']) {
    const seen = []; const noted = [];
    const fa = makeFake({ sync: true });
    const r = await L.createTranslator({ planners }).translateDoc(structuredClone(DOC), { arc, ...SKIP, runSC: (c, o) => { noted.push(seen.length); return fa.runSC(c, o); }, topologyOf: fa.topologyOf, soups: {}, onStep: (s) => { seen.push(s); } });
    assert.deepEqual(seen, DOC.features.map((f, i) => ({ id: f.id, kind: f.kind, index: i, count: DOC.features.length })), planners);
    assert.ok(noted.length > 0 && noted.every((n) => n >= 1), 'no engine run before the first step was announced');
    assert.equal(r.features.length, DOC.features.length);
  }
});

test('a refused step is announced like any other, and the result is the same with and without the callback', async () => {
  const plain = await run({});
  const withCb = await run({ onStep: () => {} });
  const slow = await run({ onStep: () => new Promise((res) => setTimeout(res, 2)) }); // it is awaited: a page may yield to the browser in it
  assert.deepEqual(lean(withCb), lean(plain)); assert.deepEqual(lean(slow), lean(plain));
  assert.deepEqual(withCb.commands, plain.commands); assert.deepEqual(slow.commands, plain.commands);
  assert.equal(plain.features.at(-1).status, 'refused');
});

test('the callback is awaited before the step runs: a slow one delays the engine, it does not race it', async () => {
  const order = []; const fa = makeFake({ sync: true });
  await L.createTranslator({ planners: 'unified' }).translateDoc(structuredClone(DOC), { arc, ...SKIP, runSC: (c, o) => { order.push('run'); return fa.runSC(c, o); }, topologyOf: fa.topologyOf, soups: {},
    onStep: async (s) => { await new Promise((res) => setTimeout(res, 3)); order.push('told ' + s.id); } });
  assert.equal(order[0], 'told box1'); const firstRun = order.indexOf('run'); assert.ok(firstRun > 0);
  for (let i = 1; i < order.length; i++) if (order[i] === 'run') assert.ok(order.slice(0, i).some((x) => x.startsWith('told')), 'a run only after a step was announced');
});
