// pad-task-core.ts: the pure half of the Pad / Pocket task panel. Imports from ../dist; build first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftOf, withDraft, checkDraft, upToFaceLength, readBinding, captionOf, typeOptions, lengthSlot,
  toolOf, toolIdOf, pullArrow, pullNormal, reachLength, typeChoiceOf,
} from '../dist/model/pad-task-core.js';

const doc = (features) => ({ version: 1, features });
const box = { id: 'b1', kind: 'box', size: [60, 40, 10], center: [0, 0, 0] };
const sk = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [10, 0], [10, 10], [0, 10]] };
const pad = { id: 'pull1', kind: 'extrude', target: 'sk1', height: 4 };
const pocket = { id: 'pocket1', kind: 'pocket', target: 'sk1', into: 'b1', depth: 3 };

test('draftOf reads one sided / symmetric / two sides and the through type', () => {
  assert.equal(draftOf(pad).side, 'one');
  assert.equal(draftOf({ ...pad, midplane: true }).side, 'symmetric');
  assert.equal(draftOf({ ...pad, length2: 2 }).side, 'two');
  assert.equal(draftOf({ ...pocket, through: true }).type, 'through');
  assert.equal(draftOf({ ...pad, height: -5 }).reversed, true);
  assert.equal(draftOf({ ...pad, height: -5 }).length, 5);
});

test('withDraft writes only what is set, and an unchanged draft is the same object', () => {
  assert.equal(withDraft(pad, draftOf(pad)), pad);
  const sym = withDraft(pad, { ...draftOf(pad), side: 'symmetric', length: 8 });
  assert.deepEqual(sym, { ...pad, height: 8, midplane: true });
  const two = withDraft(pad, { ...draftOf(pad), side: 'two', length2: 3, reversed: true });
  assert.deepEqual(two, { ...pad, reversed: true, length2: 3 });
  const thru = withDraft(pocket, { ...draftOf(pocket), type: 'through', side: 'two' });
  assert.deepEqual(thru, { ...pocket, through: true });
  const back = withDraft(sym, { ...draftOf(sym), side: 'one' });
  assert.ok(!('midplane' in back));
});

test('a legacy negative pad height keeps its spelling when still reversed', () => {
  const neg = { ...pad, height: -4 };
  assert.deepEqual(withDraft(neg, { ...draftOf(neg), length: 6 }), { ...pad, height: -6 });
  assert.deepEqual(withDraft(neg, { ...draftOf(neg), length: 6, reversed: false }), { ...pad, height: 6 });
});

test('checkDraft names the field in a sentence', () => {
  assert.match(checkDraft({ ...draftOf(pad), length: 0 }), /Length has to be a number above 0/);
  assert.match(checkDraft({ ...draftOf(pocket), length: NaN }), /Length has to be/);
  assert.match(checkDraft({ ...draftOf(pad), side: 'two', length2: 0 }), /Length 2/);
  assert.equal(checkDraft(draftOf(pad)), null);
});

test('the Type list follows FreeCAD: To last for a pad, Through all for a pocket', () => {
  assert.deepEqual(typeOptions('extrude').map((o) => o.id),
    ['dimension', 'toLast', 'toFirst', 'upToFace', 'twoLengths', 'upToShape']);
  assert.deepEqual(typeOptions('pocket').map((o) => o.id),
    ['dimension', 'through', 'toFirst', 'upToFace', 'twoLengths', 'upToShape']);
  assert.equal(lengthSlot(pad), 'pull1_height');
  assert.equal(lengthSlot(pocket), 'pocket1_depth');
  assert.equal(typeChoiceOf({ ...draftOf(pad), side: 'two', twoDims: true }), 'twoLengths');
  assert.equal(typeChoiceOf({ ...draftOf(pad), side: 'two' }), 'dimension');
});

test('To last / To first measure to the part faces ahead of the sketch', () => {
  const below = doc([box, { ...sk, offset: -20 }, pad]);
  assert.deepEqual(reachLength(below, pad, 'last', false).length, 25);
  assert.deepEqual(reachLength(below, pad, 'first', false).length, 15);
  // Pad pulled away from the part: nothing ahead.
  assert.equal(reachLength(below, pad, 'last', true).ok, false);
  // A pocket from the top face runs to the bottom face.
  const top = doc([box, { ...sk, offset: 5 }, pocket]);
  assert.equal(reachLength(top, pocket, 'last', false).length, 10);
  assert.equal(reachLength(top, pocket, 'first', false).length, 10);
  assert.match(reachLength(doc([sk, pad]), pad, 'last', false).why, /no part in the way/);
});

test('Up to face measures from the sketch plane to a picked box face, in the pad direction', () => {
  const d = doc([box, { ...sk, offset: -5 }, pad]);
  const face = { target: 'b1', name: { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' }, label: 'Box 1 · top face' };
  const r = upToFaceLength(d, pad, face, false);
  assert.deepEqual([r.ok, r.length], [true, 10]);
  const back = upToFaceLength(d, pad, face, true);
  assert.equal(back.ok, false);
  assert.match(back.why, /behind the sketch plane/);
  const below = { ...face, name: { ...face.name, part: '-z' } };
  assert.equal(upToFaceLength(d, { ...pad, reversed: true }, below, true).ok, false, 'reversed pad grows down, bottom face is 0 away ... or behind');
});

test('Up to face for a pocket measures into the material', () => {
  const d = doc([box, { ...sk, offset: 5 }, pocket]);
  const face = { target: 'b1', name: { cause: 'primitive', feature: 'b1', kind: 'face', part: '-z' }, label: 'Box 1 · bottom face' };
  const r = upToFaceLength(d, pocket, face, false);
  assert.deepEqual([r.ok, r.length], [true, 10]);
});

test('Up to face refuses a face it cannot measure, in a sentence', () => {
  const d = doc([box, sk, pad]);
  const side = { target: 'b1', name: { cause: 'primitive', feature: 'b1', kind: 'face', part: 'side' }, label: 'x' };
  assert.match(upToFaceLength(d, pad, side, false).why, /curved side|flat face/);
  const moved = doc([box, { id: 'mv1', kind: 'move', target: 'b1', offset: [0, 0, 3], copy: false }, sk, pad]);
  const top = { target: 'mv1', name: { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' }, label: 'x' };
  assert.match(upToFaceLength(moved, pad, top, false).why, /been through a move/);
  const turned = doc([{ ...box, rotate: [0, 30, 0] }, sk, pad]);
  assert.match(upToFaceLength(turned, pad, { ...top, target: 'b1' }, false).why, /turned/);
  const tilted = doc([box, { ...sk, plane: 'xz' }, pad]);
  const topF = { target: 'b1', name: { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' }, label: 'x' };
  assert.match(upToFaceLength(tilted, pad, topF, false).why, /not parallel/);
  assert.match(upToFaceLength(d, pad, { target: 'b1', name: null, label: 'x' }, false).why, /cannot be measured|flat face/);
});

test('readBinding: numbers, known parameter names, new names, and what it refuses', () => {
  const known = ['wall'];
  const ids = ['pull1', 'sk1'];
  assert.deepEqual(readBinding(' 12.5 ', known, ids), { kind: 'number', value: 12.5 });
  assert.deepEqual(readBinding('=wall', known, ids), { kind: 'param', name: 'wall', isNew: false });
  assert.deepEqual(readBinding('plateT', known, ids), { kind: 'param', name: 'plateT', isNew: true });
  assert.deepEqual(readBinding('plate_t', known, ids), { kind: 'param', name: 'plate_t', isNew: true });
  assert.match(readBinding('box', known, ids).why, /capital letter or an underscore/);
  assert.match(readBinding('pull1', known, ids).why, /name of a step/);
  assert.match(readBinding('2*wall', known, ids).why, /sums/);
  assert.match(readBinding('  ', known, ids).why, /number, or the name/);
});

test('captionOf', () => {
  assert.equal(captionOf('plateThickness'), 'Plate thickness');
  assert.equal(captionOf('plate_t'), 'Plate t');
});

test('Up to face reaches the cap and a wall of another pad', () => {
  const base = { id: 'pull1', kind: 'extrude', target: 'sk1', height: 4 };
  const sk2 = { id: 'sk2', kind: 'sketch', plane: 'xy', offset: -2, points: [[1, 1], [3, 1], [3, 3], [1, 3]] };
  const pad2 = { id: 'pull2', kind: 'extrude', target: 'sk2', height: 1 };
  const d = doc([sk, base, sk2, pad2]);
  const cap = { target: 'pull1', name: { cause: 'cap', feature: 'pull1', kind: 'face', end: 'top' }, label: 'Pad · top face' };
  const r = upToFaceLength(d, pad2, cap, false);
  assert.deepEqual([r.ok, r.length], [true, 6]);
  const bottom = { ...cap, name: { ...cap.name, end: 'bottom' } };
  assert.equal(upToFaceLength(d, pad2, bottom, false).length, 2);
  // A wall: sketch edge 1 runs (10,0) -> (10,10), the plane x = 10. A pad out of the yz plane reaches it.
  const sk3 = { id: 'sk3', kind: 'sketch', plane: 'yz', offset: 0, points: [[1, 1], [3, 1], [3, 3], [1, 3]] };
  const pad3 = { id: 'pull3', kind: 'extrude', target: 'sk3', height: 1 };
  const wall = { target: 'pull1', name: { cause: 'swept', feature: 'pull1', kind: 'face', from: 'sk1', edge: 1 }, label: 'Pad · side 2' };
  const w = upToFaceLength(doc([sk, base, sk3, pad3]), pad3, wall, false);
  assert.deepEqual([w.ok, w.length], [true, 10]);
  // A tapered pad's faces are not square to anything.
  const tapered = doc([sk, { ...base, taper: 5 }, sk2, pad2]);
  assert.match(upToFaceLength(tapered, pad2, cap, false).why, /tapered/);
});

test('taper and a custom direction round-trip through the draft, and untouched stays identical', () => {
  const d0 = draftOf(pad);
  assert.equal(d0.taper, 0);
  assert.equal(d0.dirMode, 'normal');
  const t = withDraft(pad, { ...d0, taper: 7 });
  assert.deepEqual(t, { ...pad, taper: 7 });
  assert.equal(draftOf(t).taper, 7);
  const c = withDraft(pad, { ...d0, dirMode: 'custom', dir: [1, 0, 1], alongNormal: false });
  assert.deepEqual(c, { ...pad, direction: [1, 0, 1], alongNormal: false });
  assert.equal(draftOf(c).dirMode, 'custom');
  assert.equal(withDraft(c, draftOf(c)), c);
  const back = withDraft(c, { ...draftOf(c), dirMode: 'normal' });
  assert.ok(!('direction' in back) && !('alongNormal' in back));
  assert.match(checkDraft({ ...d0, dirMode: 'custom', dir: [0, 0, 0] }), /points nowhere/);
  assert.match(checkDraft({ ...d0, taper: 120 }), /Taper angle/);
});

test('the preview block of a pocket is a pad swept the other way', () => {
  const d = doc([box, { ...sk, offset: 5 }, { ...pocket, taper: 4, direction: [1, 0, -1] }]);
  const tool = toolOf(d, d.features[2]);
  assert.equal(tool.id, toolIdOf(pocket));
  assert.equal(tool.kind, 'extrude');
  assert.equal(tool.height, -3);
  assert.deepEqual(tool.direction, [-1, 0, 1]);
  assert.equal(tool.taper, 4);
  const through = toolOf(d, { ...pocket, through: true });
  assert.ok(through.height < -10);
});

test('the arrow stands on the profile and points the way the pad grows, a pocket the other way', () => {
  const d = doc([box, sk, pad]);
  const a = pullArrow(d, pad, draftOf(pad));
  assert.deepEqual(a.origin, [5, 5, 0]);
  assert.deepEqual(a.dir, [0, 0, 1]);
  const r = pullArrow(d, pad, { ...draftOf(pad), reversed: true });
  assert.deepEqual(r.dir, [0, 0, -1]);
  assert.deepEqual(pullNormal(d, pocket), [0, 0, -1]);
  const c = pullArrow(d, pad, { ...draftOf(pad), dirMode: 'custom', dir: [0, 3, 4] });
  assert.deepEqual(c.dir, [0, 0.6, 0.8]);
});
