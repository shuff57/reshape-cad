import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDatum } from '../dist/model/datum-pick.js';

const xy = { id: 'pl1', origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], half: 40 };
const raised = { id: 'pl2', origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0], half: 40 };

test('a ray straight down hits the xy plane at its distance', () => {
  const h = pickDatum([5, 5, 100], [0, 0, -1], [xy]);
  assert.equal(h.id, 'pl1');
  assert.ok(Math.abs(h.t - 100) < 1e-9);
});

test('outside the square is a miss; the edge itself counts', () => {
  assert.equal(pickDatum([41, 0, 5], [0, 0, -1], [xy]), null);
  assert.equal(pickDatum([40, -40, 5], [0, 0, -1], [xy]).id, 'pl1');
});

test('a plane behind the ray is a miss', () => {
  assert.equal(pickDatum([0, 0, -5], [0, 0, -1], [xy]), null);
});

test('a ray parallel to the plane is a miss', () => {
  assert.equal(pickDatum([0, 0, 5], [1, 0, 0], [xy]), null);
});

test('the nearer of two stacked planes wins, whatever their order', () => {
  assert.equal(pickDatum([0, 0, 100], [0, 0, -1], [xy, raised]).id, 'pl2');
  assert.equal(pickDatum([0, 0, 100], [0, 0, -1], [raised, xy]).id, 'pl2');
});

test('a tilted frame is hit in its own coordinates', () => {
  // plane x = 5, spanned by y and z
  const side = { id: 'pl3', origin: [5, 0, 0], u: [0, 1, 0], v: [0, 0, 1], half: 10 };
  assert.equal(pickDatum([50, 3, 4], [-1, 0, 0], [side]).id, 'pl3');
  assert.equal(pickDatum([50, 11, 4], [-1, 0, 0], [side]), null);
});
