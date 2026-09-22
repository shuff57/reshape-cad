// previewTint (todo 25, SPEC-mouse-parity.md Phase 5.3): blue add / red cut.
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { previewTint } from '../dist/model/manipulator-core.js';

test('1: add operations tint blue -- extrude, fillet, draft', () => {
  assert.equal(previewTint('extrude'), 'add');
  assert.equal(previewTint('fillet'), 'add');
  assert.equal(previewTint('draft'), 'add');
});

test('2: cut operations tint red -- pocket', () => {
  assert.equal(previewTint('pocket'), 'cut');
});

test('3: kinds with no preview claim answer null', () => {
  assert.equal(previewTint('box'), null);
  assert.equal(previewTint('hole'), null);
  assert.equal(previewTint('shell'), null);
  assert.equal(previewTint('move'), null, 'a move relocates; blue/red is for ops that change the part');
});

// The ONE-undo guarantee, pinned at the seams it lives in: a drag frame
// never touches history (sendParams only setPreviewDoc), and the commit
// folds once (commitParams calls remember() exactly once, AFTER the
// pending map is read once and cleared). These are structural reads of
// ReshapeStudio.tsx -- a text pin, so a future "undo per frame" refactor
// fails a test rather than a student's undo stack.
test('4: every preview frame writes only the preview doc -- never history', () => {
  const src = fs.readFileSync(new URL('../src/ReshapeStudio.tsx', import.meta.url), 'utf8');
  const sendBody = src.slice(src.indexOf('const sendParams'), src.indexOf('const commitParams'));
  assert.ok(!/remember\(/.test(sendBody), 'sendParams must never call remember() -- no undo entries per frame');
  const commitBody = src.slice(src.indexOf('const commitParams'), src.indexOf('const specs ='));
  const commits = (commitBody.match(/remember\(/g) ?? []).length;
  assert.equal(commits, 1, 'commitParams pushes exactly ONE undo entry per gesture');
});
