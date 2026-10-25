import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, senderAllowed, COMMANDS, MAX_BATCH } from '../src/bridge.mjs';

test('allows a translator command and passes params through', () => {
  const r = validate({ id: 1, op: 'execute', command: 'solid.box', params: { length: 30 } });
  assert.deepEqual(r, { ok: true, call: { fn: 'execute', args: ['solid.box', { length: 30 }] } });
});
test('refuses a command outside the allowlist, including file and UI commands', () => {
  for (const c of ['file.export', 'file.save', 'ui.set', 'doc.recovery_open', 'view.layout', '']) {
    assert.equal(validate({ id: 1, op: 'execute', command: c }).ok, false, c);
  }
});
test('there is no raw request op: upstream control methods are not reachable', () => {
  assert.equal(validate({ id: 1, op: 'request', method: 'ui.set', params: {} }).ok, false);
});
test('batch is validated step by step and always asks for rollback', () => {
  const ok = validate({ id: 2, op: 'batch', commands: [{ command: 'sketch.create' }, { command: 'solid.extrude', params: { height: 5 } }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.call.args[1].rollback, true);
  assert.equal(validate({ id: 2, op: 'batch', commands: [{ command: 'solid.box' }, { command: 'file.export' }] }).ok, false);
  assert.equal(validate({ id: 2, op: 'batch', commands: [] }).ok, false);
  assert.equal(validate({ id: 2, op: 'batch', commands: Array.from({ length: MAX_BATCH + 1 }, () => ({ command: 'solid.box' })) }).ok, false);
});
test('needs an id and an object', () => {
  assert.equal(validate(null).ok, false);
  assert.equal(validate({ op: 'inspect' }).ok, false);
  assert.equal(validate({ id: 3, op: 'inspect', measure: true }).ok, true);
});
test('params must be a plain object', () => {
  assert.equal(validate({ id: 1, op: 'execute', command: 'solid.box', params: [1] }).ok, false);
  assert.equal(validate({ id: 1, op: 'execute', command: 'solid.box', params: 'x' }).ok, false);
});
test('only the embedding window from a listed origin may send', () => {
  const parent = {}; const other = {};
  assert.equal(senderAllowed({ source: parent, origin: 'https://a.example' }, parent, ['https://a.example']), true);
  assert.equal(senderAllowed({ source: other, origin: 'https://a.example' }, parent, ['https://a.example']), false);
  assert.equal(senderAllowed({ source: parent, origin: 'https://evil.example' }, parent, ['https://a.example']), false);
  assert.equal(senderAllowed({ source: parent, origin: 'https://a.example' }, parent, ['*']), false, 'a wildcard is never accepted');
});
test('allowlist has no dialog, file or UI command', () => {
  for (const c of COMMANDS) assert.match(c, /^(sketch|solid|edit)\./, c);
});
