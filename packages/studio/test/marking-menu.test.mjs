// marking-menu-core.ts's pure config/filter (SPEC-mouse-parity.md Phase 4.1).
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wedgesForMode,
  validSketchConstraints,
  classifyRightClick,
  contextListFor,
  flyoutHitTest,
  SKETCH_TOOL_CHILDREN,
} from '../dist/model/marking-menu-core.js';

test('part-viewport config returns exactly the 8 SPEC wedges', () => {
  const wedges = wedgesForMode('part-viewport');
  assert.equal(wedges.length, 8);
  assert.deepEqual(
    wedges.map((w) => w.id),
    ['repeat', 'delete', 'press-pull', 'undo', 'redo', 'move-copy', 'hole', 'sketch'],
  );
});

test('an arc + line selection includes tangent, excludes line-only constraints', () => {
  const valid = validSketchConstraints([{ kind: 'arc' }, { kind: 'line' }]);
  assert.ok(valid.includes('tangent'), 'tangent should be valid for an arc+line pair');
  for (const excluded of ['horizontal', 'vertical', 'parallel', 'perpendicular', 'equal']) {
    assert.ok(!valid.includes(excluded), `${excluded} requires a line-only pair/singleton, not arc+line`);
  }
});

test('two lines include parallel/perpendicular/equal, exclude tangent', () => {
  const valid = validSketchConstraints([{ kind: 'line' }, { kind: 'line' }]);
  assert.ok(valid.includes('parallel'));
  assert.ok(valid.includes('perpendicular'));
  assert.ok(valid.includes('equal'));
  assert.ok(!valid.includes('tangent'), 'tangent is never two lines -- parallel/perpendicular/equal own that pair');
});

test('two arcs (curve+curve) include tangent', () => {
  const valid = validSketchConstraints([{ kind: 'arc' }, { kind: 'circle' }]);
  assert.ok(valid.includes('tangent'));
  assert.ok(!valid.includes('parallel'));
});

test('a single line includes horizontal/vertical, excludes everything else', () => {
  const valid = validSketchConstraints([{ kind: 'line' }]);
  assert.deepEqual(valid.sort(), ['horizontal', 'vertical'].sort());
});

test('point-only selections gate coincident/pointOnObject/symmetric/lock', () => {
  assert.deepEqual(validSketchConstraints([{ kind: 'point' }]).sort(), ['lock']);
  assert.deepEqual(validSketchConstraints([{ kind: 'point' }, { kind: 'point' }]).sort(), ['coincident']);
  assert.deepEqual(
    validSketchConstraints([{ kind: 'point' }, { kind: 'point' }, { kind: 'point' }]).sort(),
    ['symmetric'],
  );
  // A point + a line also satisfies canHoriz/canVert (1 line, selShapes-only)
  // and canLock (1 point) alongside pointOnObject -- SketchCanvas2D.tsx's own
  // canX booleans never cross-check the OTHER axis's count, so this matches
  // the real toolbar buttons' combined disabled= state for the same pick.
  assert.deepEqual(
    validSketchConstraints([{ kind: 'point' }, { kind: 'line' }]).sort(),
    ['horizontal', 'lock', 'pointOnObject', 'vertical'].sort(),
  );
});

test('an empty selection excludes every selection-dependent constraint', () => {
  assert.deepEqual(validSketchConstraints([]), []);
});

test('sketch config carries every constraint id plus the two selection-independent commands', () => {
  const ids = wedgesForMode('sketch').map((w) => w.id);
  assert.ok(ids.includes('done'));
  assert.ok(ids.includes('dim'));
  for (const id of [
    'horizontal', 'vertical', 'coincident', 'parallel', 'perpendicular',
    'equal', 'tangent', 'pointOnObject', 'symmetric', 'lock',
  ]) {
    assert.ok(ids.includes(id), `sketch config is missing ${id}`);
  }
});

test('classifyRightClick: a release within the dead zone opens the menu', () => {
  const down = { x: 100, y: 100, t: 0 };
  const up = { x: 102, y: 101, t: 50 };
  assert.equal(classifyRightClick(down, up, 4), 'menu');
});

test('classifyRightClick: a release past the dead zone is a drag, not a click', () => {
  const down = { x: 100, y: 100, t: 0 };
  const up = { x: 200, y: 100, t: 300 };
  assert.equal(classifyRightClick(down, up, 4), 'ignore');
});

test('classifyRightClick: no matching pointerdown always ignores', () => {
  assert.equal(classifyRightClick(null, { x: 0, y: 0, t: 0 }, 4), 'ignore');
});

// --- todo 18: flyout + context list -------------------------------------------------

test('contextListFor returns the SPEC :34-35 entries for both modes', () => {
  const ids = contextListFor('part-viewport').map((w) => w.id);
  assert.deepEqual(ids, ['ctx-pan-zoom-orbit', 'ctx-isolate', 'ctx-workspaces', 'ctx-saved-shortcuts']);
  assert.deepEqual(contextListFor('sketch').map((w) => w.id), ids);
});

test('the part-viewport Sketch wedge carries a non-empty sketch-tool flyout', () => {
  const sketch = wedgesForMode('part-viewport').find((w) => w.id === 'sketch');
  assert.ok(sketch, 'the part-viewport config has a sketch wedge');
  assert.ok(Array.isArray(sketch.children) && sketch.children.length > 0, 'Sketch wedge has children');
  for (const c of sketch.children) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.label, 'string');
  }
  const childIds = sketch.children.map((c) => c.id);
  for (const expected of ['tool-line', 'tool-circle', 'tool-trim', 'tool-fillet']) {
    assert.ok(childIds.includes(expected), `sketch flyout missing ${expected}`);
  }
});

test('SKETCH_TOOL_CHILDREN matches the flyout data on the Sketch wedge', () => {
  const sketch = wedgesForMode('part-viewport').find((w) => w.id === 'sketch');
  assert.deepEqual(SKETCH_TOOL_CHILDREN(), sketch?.children);
});

test('flyoutHitTest: a diagonal move from the wedge toward the flyout STAYS open', () => {
  // Wedge at (90, 0) on the menu circle; flyout anchored one radius further
  // out at (180, 0). A diagonal path from the wedge toward the flyout stays
  // inside the dead-zone triangle.
  const verdict = flyoutHitTest({ x: 90, y: 0 }, { x: 180, y: 0 }, { x: 130, y: 20 });
  assert.equal(verdict, 'stay');
});

test('flyoutHitTest: a move back toward the menu center CLOSES the flyout', () => {
  // From the wedge back through the menu center is directly away from the
  // flyout -- outside the triangle.
  const verdict = flyoutHitTest({ x: 90, y: 0 }, { x: 180, y: 0 }, { x: 20, y: -10 });
  assert.equal(verdict, 'close');
});
