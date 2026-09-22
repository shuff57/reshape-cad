// step-tooltips.ts (todo 26, SPEC-mouse-parity.md Phase 5.4): the prompt
// follows the ACTIVE COMMAND's step, not the hover target. Imports from
// ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTooltip } from '../dist/model/step-tooltips.js';

test('1: an extrude with no selection yet prompts for profiles/faces verbatim', () => {
  assert.equal(
    stepTooltip('extrude', { active: true, selectionCount: 0 }),
    'Select sketch profiles or planar faces',
    'SPEC :47-48 observed string, verbatim',
  );
});

test('2: once a selection exists, the general modifier tooltip takes over', () => {
  assert.equal(
    stepTooltip('extrude', { active: true, selectionCount: 1 }),
    'Hold Ctrl to modify selection',
    'the ONE general tooltip reused across all the manipulator commands',
  );
});

test('3: each command has its own no-selection prompt, one shared selection prompt', () => {
  for (const cmd of ['extrude', 'press-pull', 'fillet', 'move']) {
    const none = stepTooltip(cmd, { active: true, selectionCount: 0 });
    assert.match(String(none), /^Select /, `${cmd} prompts a selection first`);
    const held = stepTooltip(cmd, { active: true, selectionCount: 2 });
    assert.equal(held, 'Hold Ctrl to modify selection');
  }
});

test('4: an inactive/cancelled command clears the prompt -- no stale text', () => {
  assert.equal(
    stepTooltip('extrude', { active: false, selectionCount: 1 }),
    null,
    'Esc mid-command must clear the tooltip, not persist it',
  );
  assert.equal(stepTooltip('unknown', { active: true, selectionCount: 0 }), null,
    'a command with no tooltip claim says nothing');
});
