// Step 9's self-check, updated 2026-09-11 when the default flipped to
// 'freecad' (BrepViewportThree.tsx now falls back to OcctEngineAdapter
// automatically for anything FreeCAD refuses -- see that file's build
// effect). setEngineMode() still round-trips either way.
// Against ../dist/ -- TypeScript source, same convention as
// packages/sketch/test/sketch-solve.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEngineMode, setEngineMode } from '../dist/config.js';

test('getEngineMode defaults to freecad with no setEngineMode() call', () => {
  assert.equal(getEngineMode(), 'freecad');
});

test('setEngineMode round-trips to freecad and back', () => {
  setEngineMode('freecad');
  assert.equal(getEngineMode(), 'freecad');
  setEngineMode('occt');
  assert.equal(getEngineMode(), 'occt');
});
