// Step 9's self-check: default 'occt', and setEngineMode() round-trips.
// Against ../dist/ -- TypeScript source, same convention as
// packages/sketch/test/sketch-solve.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEngineMode, setEngineMode } from '../dist/config.js';

test('getEngineMode defaults to occt with no setEngineMode() call', () => {
  assert.equal(getEngineMode(), 'occt');
});

test('setEngineMode round-trips to freecad and back', () => {
  setEngineMode('freecad');
  assert.equal(getEngineMode(), 'freecad');
  setEngineMode('occt');
  assert.equal(getEngineMode(), 'occt');
});
