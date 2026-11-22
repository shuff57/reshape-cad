// G-COPY (move-turn.ts copyRefusal): a copying move built behind ctx.allowCopies (plan A, 2026-11-20) is checked against the run before it. The copy must
// come back under its own name, be the original moved by the offset, and leave the original as it was; each failure is refused in a sentence. The replies
// here are hand-made in the engine's measure shape (as copies-2026-11/measure-body-name.out); the live run against OCCT is copies-2026-11/live-copies.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(here, p)).href);
await imp('../dist/index.js'); // the layer's modules import each other: load them in the order the layer does
const { motionRefusal, motionRepair, COPY_GUARD } = await imp('../dist/move-turn.js');
const { rememberRun } = await imp('../dist/pocket-cut.js');

const body = (name, at, { volume = 1200, area = 760, faces = { plane: 6 } } = {}) => ({
  name, volume_mm3: volume, area_mm2: area, face_types: faces, center_of_mass: at,
  bbox: { min: [at[0] - 10, at[1] - 5, at[2] - 3], max: [at[0] + 10, at[1] + 5, at[2] + 3] },
});
const reply = (...bodies) => ({ ok: true, measure: { bodies } });
const st = () => ({ head: {}, bodies: { box1: ['b_box1'] }, motion: { names: {}, steps: {} }, measure: {}, stale: {}, refused: {} });
const f = { id: 'move1', kind: 'move', target: 'box1', offset: [30, 0, 0], copy: true };
const ctx = {};
const check = (after, before = reply(body('b_box1', [0, 0, 0]))) => {
  const accepted = [{ command: 'solid.box', params: {} }]; rememberRun(accepted, before);
  return motionRefusal(f, st(), ctx, after, ['b_move1'], accepted);
};

test('a right copy: the original moved by the offset, under its own name, the original as it was', () => {
  assert.equal(check(reply(body('b_box1', [0, 0, 0]), body('b_move1', [30, 0, 0]))), null);
});
test('a copy the engine renamed (its name was taken) is refused: which body it is cannot be told', () => {
  const r = check(reply(body('b_box1', [0, 0, 0]), body('b_box1 (2)', [30, 0, 0])));
  assert.equal(r.guard, COPY_GUARD); assert.match(r.sentence, /did not come back under its own name/);
});
test('a copy that is not the original moved is refused: its volume, then its place', () => {
  let r = check(reply(body('b_box1', [0, 0, 0]), body('b_move1', [30, 0, 0], { volume: 1100 })));
  assert.equal(r.guard, COPY_GUARD); assert.match(r.sentence, /would not be box1 moved by \[30\.0,0\.0,0\.0\] \(its volume is 1100 mm3 instead of 1200 mm3\)/);
  r = check(reply(body('b_box1', [0, 0, 0]), body('b_move1', [30, 2, 0])));
  assert.match(r.sentence, /its centre of mass is \[30\.0,2\.0,0\.0\] instead of \[30\.0,0\.0,0\.0\]/);
  r = check(reply(body('b_box1', [0, 0, 0]), body('b_move1', [30, 0, 0], { faces: { plane: 5, other: 1 } })));
  assert.match(r.sentence, /plane faces are 5 instead of 6/);
});
test('an original changed by its copy is refused', () => {
  const r = check(reply(body('b_box1', [0, 0, 0], { volume: 1000 }), body('b_move1', [30, 0, 0], { volume: 1000 })));
  assert.equal(r.guard, COPY_GUARD);
  assert.match(r.sentence, /would not be box1 moved/); // the copy of a changed part differs from the part before first
  const r2 = check(reply(body('b_box1', [0, 1, 0]), body('b_move1', [30, 0, 0])));
  assert.match(r2.sentence, /copying box1 would change box1 itself \(its centre of mass is \[0\.0,1\.0,0\.0\] instead of \[0\.0,0\.0,0\.0\]\)/);
});
test('with no run before to measure the original against, the copy is refused, not passed', () => {
  const r = motionRefusal(f, st(), ctx, reply(body('b_box1', [0, 0, 0]), body('b_move1', [30, 0, 0])), ['b_move1'], []);
  assert.equal(r.guard, COPY_GUARD); assert.match(r.sentence, /could not be measured before and after/);
});
test('G-COPY is always on: the measuring switches that turn the move-turn checks off do not turn it off', () => {
  const accepted = [{ command: 'solid.box', params: {} }]; rememberRun(accepted, reply(body('b_box1', [0, 0, 0])));
  const r = motionRefusal(f, st(), { skipMoveTurn: true, skipSketchVolume: true }, reply(body('b_box1', [0, 0, 0]), body('b_move1', [31, 0, 0])), ['b_move1'], accepted);
  assert.equal(r.guard, COPY_GUARD);
});

test('a multi-body copy preserves each named member and the other bodies', () => {
  const state = st();
  state.bodies.box1 = ['a', 'b'];
  const a = body('a', [0, 0, 0]);
  const b = body('b', [0, 20, 0]);
  const other = body('other', [0, -20, 0]);
  const aCopy = body('copy1', [30, 0, 0]);
  const bCopy = body('copy2', [30, 20, 0]);
  const accepted = [{ command: 'solid.box', params: {} }];
  rememberRun(accepted, reply(a, b, other));
  const check = (...bodies) => motionRefusal(f, state, ctx, reply(...bodies), ['copy1', 'copy2'], accepted);
  assert.equal(check(a, b, other, aCopy, bCopy), null);
  assert.match(check(a, b, other, { ...aCopy, name: 'copy2' }, { ...bCopy, name: 'copy1' }).sentence, /corresponding body/);
  assert.match(check(a, b, other, aCopy, bCopy, body('extra', [100, 0, 0])).sentence, /exactly the original bodies/);
  assert.match(check(a, b, body('other', [0, -21, 0]), aCopy, bCopy).sentence, /change a body already in the model/);
});

test('a copy of a closed hollow preserves the shells of both bodies', () => {
  const original = { ...body('b_box1', [0, 0, 0]), kernel: { faces: 12, shells: 2 } };
  const copy = { ...body('b_move1', [30, 0, 0]), kernel: { faces: 12, shells: 2 } };
  const collapsed = (value) => ({ ...value, kernel: { ...value.kernel, shells: 1 } });
  assert.equal(check(reply(original, copy), reply(original)), null);
  assert.match(check(reply(original, collapsed(copy)), reply(original)).sentence, /does not preserve the original's shells/);
  assert.match(check(reply(collapsed(original), copy), reply(original)).sentence, /change a body already in the model/);
});

test('copy repair pads only the copy and reruns the shell guard', async () => {
  const original = { ...body('b_box1', [0, 0, 0]), kernel: { faces: 12, shells: 2 } };
  const copy = { ...body('b_move1', [30, 0, 0]), kernel: { faces: 12, shells: 2 } };
  const accepted = [{ command: 'solid.box', params: {} }];
  rememberRun(accepted, reply(original));
  const variant = [{ command: 'solid.move', params: { copy: true } }];
  const repair = (run) => motionRepair(f, st(), ctx, { guard: COPY_GUARD }, ['b_move1'], accepted, variant, run);
  const result = await repair((commands) => {
    assert.deepEqual(commands.at(-1).params, { bodies: ['b_move1'], translate: [0, 0, 0] });
    return reply(original, copy);
  });
  assert.equal(result.pads, 1);
  assert.equal(await repair(() => reply(original, { ...copy, kernel: { faces: 12, shells: 1 } })), null);
});

test('with copies allowed, a copying move starts a part of its own (rootsOf): a hole in a copy or its original is a hole in one part among others', async () => {
  const { rootsOf } = await imp('../dist/holes.js');
  const byId = { box1: { id: 'box1', kind: 'box' }, move1: { id: 'move1', kind: 'move', target: 'box1', offset: [40, 0, 0], copy: true },
    move2: { id: 'move2', kind: 'move', target: 'box1', offset: [0, 5, 0], copy: false }, hole1: { id: 'hole1', kind: 'hole', target: 'move1' } };
  assert.deepEqual([...rootsOf('move1', byId, true)], ['move1']); assert.deepEqual([...rootsOf('hole1', byId, true)], ['move1']);
  assert.deepEqual([...rootsOf('move2', byId, true)], ['box1'], 'a plain move is the same part');
  assert.deepEqual([...rootsOf('move1', byId)], ['box1'], 'without the switch, as the contract copy has it: the copy shares the root');
});
