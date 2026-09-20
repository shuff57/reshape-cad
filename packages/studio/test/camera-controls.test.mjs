// camera-controls.ts's mouse-scheme table + localStorage persistence.
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOUSE_SCHEMES,
  DEFAULT_SCHEME_NAME,
  loadSchemeName,
  saveSchemeName,
  schemeToMouseButtons,
  schemeToTouches,
} from '../dist/camera-controls.js';

test('1: default scheme name is a real scheme', () => {
  assert.ok(MOUSE_SCHEMES[DEFAULT_SCHEME_NAME]);
});

test('2: legacy and fusion schemes assign three distinct buttons', () => {
  for (const name of ['legacy', 'fusion']) {
    const b = schemeToMouseButtons(name);
    const values = new Set([b.ORBIT, b.PAN, b.DOLLY]);
    assert.equal(values.size, 3);
  }
});

test('3: legacy and fusion schemes assign three distinct touches', () => {
  for (const name of ['legacy', 'fusion']) {
    const t = schemeToTouches(name);
    const values = new Set([t.ORBIT, t.PAN, t.DOLLY]);
    assert.equal(values.size, 3);
  }
});

test('4: loadSchemeName falls back to default without localStorage', () => {
  const original = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    assert.equal(loadSchemeName(), DEFAULT_SCHEME_NAME);
  } finally {
    if (original !== undefined) globalThis.localStorage = original;
  }
});

test('5: saveSchemeName + loadSchemeName round-trip through localStorage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try {
    saveSchemeName('fusion');
    assert.equal(loadSchemeName(), 'fusion');
  } finally {
    delete globalThis.localStorage;
  }
});

test('6: loadSchemeName ignores a garbage stored value', () => {
  globalThis.localStorage = {
    getItem: () => 'not-a-scheme',
    setItem: () => {},
  };
  try {
    assert.equal(loadSchemeName(), DEFAULT_SCHEME_NAME);
  } finally {
    delete globalThis.localStorage;
  }
});
