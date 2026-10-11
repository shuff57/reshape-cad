// config's whole surface is WHERE the wasm is served from. There is no
// engine mode to read or set: one kernel, chosen at compile time, not at
// runtime. The first assertion is the load-bearing one -- a getEngineMode()
// or setEngineMode() reappearing here means a second engine came back with
// it, and every caller that branches on the answer comes back too.
// Against ../dist/ -- same convention as the other suites here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../dist/config.js';

test('config exports no engine-mode switch', () => {
  assert.equal(config.getEngineMode, undefined, 'getEngineMode must not exist');
  assert.equal(config.setEngineMode, undefined, 'setEngineMode must not exist');
});

test('the kernel base URL defaults to /reshape/kernel and round-trips', () => {
  assert.equal(config.getKernelBaseUrl(), '/reshape/kernel');
  config.setKernelBaseUrl('https://example.test/k');
  assert.equal(config.getKernelBaseUrl(), 'https://example.test/k');
  config.setKernelBaseUrl('/reshape/kernel');
  assert.equal(config.getKernelBaseUrl(), '/reshape/kernel');
});
