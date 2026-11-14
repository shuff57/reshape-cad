// The progress line (src/progress.mjs; plan item 3). The words are a proposal and are pinned here only so that a change to them is a decision, not a slip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgress, LINES, yieldToBrowser } from '../src/progress.mjs';

const steps = (ids) => ids.map((id, index) => ({ id, kind: 'x', index, count: ids.length }));

test('one line per step, written before the page is given its moment to draw', async () => {
  const said = []; const order = []; let t = 0;
  const p = createProgress({ say: (s) => { said.push(s); order.push('say'); }, yieldToPage: async () => { order.push('yield'); }, now: () => t });
  for (const s of steps(['box1', 'hole1', 'shell1'])) await p.onStep(s);
  assert.deepEqual(said, ['building step 1 of 3: box1 ...', 'building step 2 of 3: hole1 ...', 'building step 3 of 3: shell1 ...']);
  assert.deepEqual(order, ['say', 'yield', 'say', 'yield', 'say', 'yield']);
});

test('when the steps come round again it is a later translation, and the line says checking', async () => {
  const said = []; const p = createProgress({ say: (s) => said.push(s), now: () => 0 });
  for (const s of steps(['box1', 'hole1'])) await p.onStep(s);
  for (const s of steps(['box1'])) await p.onStep(s); // the second translation, one step left out
  for (const s of steps(['box1', 'hole1'])) await p.onStep(s); // a third
  assert.deepEqual(said, ['building step 1 of 2: box1 ...', 'building step 2 of 2: hole1 ...', 'checking step 1 of 1: box1 ...', 'checking step 1 of 2: box1 ...', 'checking step 2 of 2: hole1 ...']);
  assert.equal(p.pass, 3);
});

test('a step that has been going for ten seconds is said to be slow, once, at the next gap between engine calls', async () => {
  const said = []; let t = 0; const p = createProgress({ say: (s) => said.push(s), now: () => t });
  await p.beforeEngine(); assert.deepEqual(said, [], 'nothing before the first step');
  await p.onStep(steps(['box1', 'union1'])[1]);
  t = 9999; await p.beforeEngine(); assert.equal(said.length, 1);
  t = 10000; await p.beforeEngine(); await p.beforeEngine(); t = 60000; await p.beforeEngine();
  assert.deepEqual(said, ['building step 2 of 2: union1 ...', 'building step 2 of 2: union1 ... (this one is slow)']);
  // the next step starts fresh
  t = 61000; await p.onStep({ id: 'hole1', kind: 'hole', index: 0, count: 1 }); await p.beforeEngine();
  assert.equal(said.at(-1), 'building step 1 of 1: hole1 ...', 'no "slow" carried over, and this is the first time step 1 came round here');
});

test('the words are in one place and can be replaced whole', async () => {
  const said = []; const p = createProgress({ say: (s) => said.push(s), now: () => 0, lines: { building: (n, c, id) => `${id} (${n}/${c})`, checking: (n, c, id) => `again ${id}`, slow: ' slow' } });
  await p.onStep({ id: 'a', kind: 'box', index: 0, count: 2 });
  assert.deepEqual(said, ['a (1/2)']);
  assert.equal(LINES.building(4, 9, 'hole1'), 'building step 4 of 9: hole1 ...'); assert.equal(LINES.checking(4, 9, 'hole1'), 'checking step 4 of 9: hole1 ...'); assert.equal(LINES.slow, ' (this one is slow)');
});

test('yieldToBrowser resolves after a frame and a task, and also when no frame ever comes (a hidden tab)', async () => {
  const mk = (frames) => { const q = []; return { q, setTimeout: (f, ms) => q.push([ms, f]), ...(frames ? { requestAnimationFrame: (f) => q.push(['frame', f]) } : {}) }; };
  const drain = (w) => { while (w.q.length) w.q.shift()[1](); };
  let done = false; const w = mk(true); yieldToBrowser(w)().then(() => { done = true; }); drain(w); await Promise.resolve(); await Promise.resolve(); assert.equal(done, true);
  // no frames: only the 50 ms timer is there, and it is enough
  done = false; const h = mk(false); yieldToBrowser(h)().then(() => { done = true; }); assert.deepEqual(h.q.map((x) => x[0]), [50]); drain(h); await Promise.resolve(); await Promise.resolve(); assert.equal(done, true);
});
