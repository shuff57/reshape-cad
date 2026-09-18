// Step 9's self-check, updated 2026-09-17 when the default flipped to
// 'brep-rs' (FreeCAD kernel removed, brep-rs is the production kernel).
// setEngineMode() still round-trips either way.
// Against ../dist/ -- TypeScript source, same convention as
// packages/sketch/test/sketch-solve.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEngineMode, setEngineMode } from '../dist/config.js';

test('getEngineMode defaults to brep-rs with no setEngineMode() call', () => {
  assert.equal(getEngineMode(), 'brep-rs');
});

test('setEngineMode round-trips to brep-rs and occt', () => {
  setEngineMode('brep-rs');
  assert.equal(getEngineMode(), 'brep-rs');
  setEngineMode('occt');
  assert.equal(getEngineMode(), 'occt');
});
