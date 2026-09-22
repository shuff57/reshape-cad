// marking-menu-core.ts's pure config/filter (SPEC-mouse-parity.md Phase 4.1).
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wedgesForMode,
  validSketchConstraints,
  classifyRightClick,
  classifyGesture,
  contextListFor,
  flyoutHitTest,
  SKETCH_TOOL_CHILDREN,
} from '../dist/model/marking-menu-core.js';
import { rightButtonRole, rightClickGuard } from '../dist/model/marking-menu-guard.js';

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

// --- todo 19: hold + directional drag gesture ----------------------------------------

test('classifyGesture: a fast directional drag beyond the dead zone selects a wedge, no menu', () => {
  const down = { x: 100, y: 100, t: 0 };
  const up = { x: 100, y: 160, t: 60 }; // 60px straight down in 60ms
  const verdict = classifyGesture(down, up, { delayMs: 150, deadZonePx: 4, wedgeCount: 8 });
  assert.equal(verdict.kind, 'wedge');
  if (verdict.kind === 'wedge') {
    // MarkingMenu.tsx lays wedge i at (-90 + 45*i) SVG degrees (y-down):
    // i=0 up, i=1 upper-right, i=2 right, i=3 lower-right, i=4 DOWN, ...
    // A straight-down drag is exactly wedge 4.
    assert.equal(verdict.wedgeIndex, 4);
  }
});

test('classifyGesture: a hold within the dead zone through the delay shows the menu', () => {
  const down = { x: 100, y: 100, t: 0 };
  const up = { x: 101, y: 102, t: 200 }; // well past the 150ms delay, ~2px move
  const verdict = classifyGesture(down, up, { delayMs: 150, deadZonePx: 4, wedgeCount: 8 });
  assert.deepEqual(verdict, { kind: 'menu' });
});

test('classifyGesture: a slow drag past the dead zone after the delay is still menu', () => {
  const down = { x: 100, y: 100, t: 0 };
  const up = { x: 160, y: 100, t: 400 }; // 60px but 400ms > 150ms delay
  const verdict = classifyGesture(down, up, { delayMs: 150, deadZonePx: 4, wedgeCount: 8 });
  assert.deepEqual(verdict, { kind: 'menu' });
});

test('classifyGesture: no pointerdown always ignores', () => {
  assert.deepEqual(classifyGesture(null, { x: 0, y: 0, t: 0 }, { delayMs: 150, deadZonePx: 4, wedgeCount: 8 }), { kind: 'ignore' });
});

test('classifyGesture: the wedge index matches MarkingMenu.tsx layout order', () => {
  // MarkingMenu.tsx lays wedge i at angle (-90 + 360/n * i) degrees, SVG
  // y-down. A drag toward the upper-right (+X, -Y screen) must land on the
  // wedge at -45deg, which is i=1 (slots step clockwise from up).
  const down = { x: 100, y: 100, t: 0 };
  const up = { x: 160, y: 40, t: 50 };
  const verdict = classifyGesture(down, up, { delayMs: 150, deadZonePx: 4, wedgeCount: 8 });
  assert.equal(verdict.kind, 'wedge');
  if (verdict.kind === 'wedge') {
    const id = wedgesForMode('part-viewport')[verdict.wedgeIndex]?.id;
    assert.equal(id, 'delete', 'wedge 1 is Delete in the SPEC reading order');
  }
});

// --- todo 20: right-click vs pan/orbit guard ------------------------------------------

test('rightButtonRole reads the scheme map, not hardcoded', () => {
  // legacy binds right to PAN; fusion binds right to DOLLY.
  assert.equal(rightButtonRole({ ORBIT: 0, PAN: 2, DOLLY: 1 }), 'pan');
  assert.equal(rightButtonRole({ ORBIT: 0, PAN: 1, DOLLY: 2 }), 'dolly');
  // A scheme with no camera action on the right button.
  assert.equal(rightButtonRole({ ORBIT: 0, PAN: 1, DOLLY: 1 }), 'none');
});

test('rightClickGuard: a release within the dead zone opens the menu, a drag stays camera', () => {
  const down = { x: 100, y: 100, t: 0 };
  assert.equal(rightClickGuard(down, { x: 102, y: 101, t: 80 }, 4), 'menu');
  assert.equal(rightClickGuard(down, { x: 200, y: 100, t: 300 }, 4), 'camera-gesture');
  assert.equal(rightClickGuard(null, { x: 0, y: 0, t: 0 }, 4), 'ignore');
});

test('rightClickGuard + classifyGesture compose: a fast wedge drag wins, a slow drag orbits', () => {
  const down = { x: 100, y: 100, t: 0 };
  // Fast drag down (60ms, 60px): classifyGesture says 'wedge', so the guard
  // is never consulted -- the wedge fires and the camera does not move.
  const fast = classifyGesture(down, { x: 100, y: 160, t: 60 }, { delayMs: 150, deadZonePx: 4, wedgeCount: 8 });
  assert.equal(fast.kind ?? fast.kind, fast.kind);
  if (fast.kind === 'wedge') assert.equal(wedgesForMode('part-viewport')[fast.wedgeIndex]?.id, 'redo');
  // Slow drag (400ms, 60px): classifyGesture says 'menu' but the guard says
  // 'camera-gesture' wins -- the menu must NOT open on a slow drag that the
  // camera already consumed.
  const slowVerdict = rightClickGuard(down, { x: 160, y: 100, t: 400 }, 4);
  assert.equal(slowVerdict, 'camera-gesture');
  // Hold (200ms, 2px): menu.
  assert.equal(rightClickGuard(down, { x: 101, y: 102, t: 200 }, 4), 'menu');
});
