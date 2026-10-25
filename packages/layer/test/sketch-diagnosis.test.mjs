import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainKernelSentence } from '../dist/index.js';

const pull = { id: 'pull1', kind: 'extrude' };
const pocket = { id: 'pocket1', kind: 'pocket' };
// the two raw refusals measured on SolidCraft v0.21.0 (packages/solidcraft-host/test/examples-0.21.0.json)
const CONFLICT = 'solidcraft refused it -- sketch.dimension: that would over-constrain the sketch (conflicts with k10, k12)';
const REDUNDANT = 'solidcraft refused it -- sketch.dimension: invalid parameters for `sketch.dimension`: that dimension is already determined by k10 (LinearDimension); add it as a driven (reference) dimension with driven: true';
const JARGON = /sketch\.dimension|\bk\d+\b|driven: true|solidcraft|LinearDimension/;

test('an over-constrained sketch is explained in plain words, with no kernel ids', () => {
  const s = plainKernelSentence(pull, CONFLICT);
  assert.match(s, /conflicts with the others/); assert.doesNotMatch(s, JARGON);
  assert.match(plainKernelSentence(pocket, CONFLICT), /nothing is cut/);
});
test('a redundant dimension is explained in plain words, with no kernel ids', () => {
  const s = plainKernelSentence(pull, REDUNDANT);
  assert.match(s, /already determined/); assert.doesNotMatch(s, JARGON);
});
test('other refusals keep the generic sentence', () => {
  assert.match(plainKernelSentence(pull, 'something else'), /does not close up cleanly/);
});
