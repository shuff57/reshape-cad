// The sketch task panel's pure parts: the solver message, the freedom probe that decides which rows are
// painted fully constrained, and the geometry of a drawn dimension. Real wasm via initSync, the same
// convention as sketch-dof-badge.test.mjs. Imports from ../dist; build first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { SketchSession2D } = await import('@shuff57/reshape-brep-adapter/sketch-session');
const { solverMessage, fullyConstrainedIds, dimensionArt, ruleName, geomName } =
  await import('../dist/model/sketch-canvas-core.js');

const session = new SketchSession2D();
session.loadFromBytes(brep);
const L = (id, a, b) => ({ k: 'line', id, a, b });
const rect = [L(1, [0, 0], [40, 0]), L(2, [40, 0], [40, 30]), L(3, [40, 30], [0, 30]), L(4, [0, 30], [0, 0])];
const weld = [1, 2, 3, 4].map((i) => ({ k: 'coincident', a: i, aEnd: 'b', b: (i % 4) + 1, bEnd: 'a' }));
const hv = [{ k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const dist = (id, value) => ({ k: 'distance', a: id, aEnd: 'a', b: id, bEnd: 'b', value });
function diag(geoms, rules) {
  assert.equal(session.open(geoms, rules), null);
  session.solve();
  return session.diagnose();
}

test('solverMessage names the five states', () => {
  assert.equal(solverMessage(null, 0).state, 'empty');
  const under = solverMessage({ dof: 4, bucket: 'consistent', blame: [] }, 4);
  assert.deepEqual([under.state, under.tone, under.detail], ['under', 'warn', '4 degrees of freedom']);
  assert.equal(solverMessage({ dof: 1, bucket: 'consistent', blame: [] }, 4).detail, '1 degree of freedom');
  assert.equal(solverMessage({ dof: 0, bucket: 'consistent', blame: [] }, 4).state, 'full');
  const over = solverMessage({ dof: 3, bucket: 'conflicting', blame: [11, 9] }, 4);
  assert.deepEqual([over.state, over.tone, over.ids], ['over', 'bad', [10, 12]]);
  assert.equal(solverMessage({ dof: 3, bucket: 'redundant', blame: [8] }, 4).state, 'redundant');
  assert.equal(solverMessage({ dof: 0, bucket: 'globallyInfeasible', blame: [] }, 4).tone, 'bad');
});

test('names are command names', () => {
  assert.equal(ruleName('coincident'), 'Coincident');
  assert.equal(ruleName('distanceX'), 'Horizontal distance');
  assert.equal(geomName('circle'), 'Circle');
});

test('the freedom probe marks only the rows nothing can move', () => {
  // A welded, horizontal/vertical rectangle with nothing pinned: no row is determined.
  let rules = [...weld, ...hv];
  assert.equal(fullyConstrainedIds(session, rect, rules, diag(rect, rules)).size, 0);
  // Sized AND pinned at one corner: every row is determined.
  rules = [...weld, ...hv, dist(1, 40), dist(2, 30), { k: 'lock', a: 1, aEnd: 'a' }];
  const full = fullyConstrainedIds(session, rect, rules, diag(rect, rules));
  assert.deepEqual([...full].sort(), [1, 2, 3, 4]);
});

test('a rectangle with an extra free circle paints the rectangle fixed and the circle free', () => {
  const geoms = [...rect, { k: 'circle', id: 5, c: [20, 15], r: 4 }];
  const rules = [...weld, ...hv, dist(1, 40), dist(2, 30), { k: 'lock', a: 1, aEnd: 'a' }];
  const d = diag(geoms, rules);
  assert.ok(d.dof > 0);
  const full = fullyConstrainedIds(session, geoms, rules, d);
  assert.deepEqual([...full].sort(), [1, 2, 3, 4]);
});

test('a contradiction paints nothing green', () => {
  const rules = [...weld, ...hv, dist(1, 40), dist(1, 50)];
  const d = diag(rect, rules);
  assert.equal(d.bucket, 'conflicting');
  assert.equal(fullyConstrainedIds(session, rect, rules, d).size, 0);
});

test('dimensionArt: an aligned distance sits off the part, with two arrowheads and two extension lines', () => {
  const art = dimensionArt(rect, dist(1, 40), null, 5, { x: 20, y: 15 });
  assert.equal(art.arrows.length, 2);
  assert.equal(art.lines.length, 3);
  // The bottom edge's dimension line goes below it (away from the centroid), centred on the edge.
  assert.ok(art.label.y < 0);
  assert.ok(Math.abs(art.label.x - 20) < 1e-9);
  // A placed label wins: the line runs through it.
  const placed = dimensionArt(rect, dist(1, 40), { x: 12, y: -9 }, 5, { x: 20, y: 15 });
  assert.ok(Math.abs(placed.label.y + 9) < 1e-9);
});

test('dimensionArt: radius runs from the centre to the rim, diameter across it', () => {
  const circ = [{ k: 'circle', id: 1, c: [0, 0], r: 5 }];
  const rad = dimensionArt(circ, { k: 'radius', a: 1, value: 5 }, null, 4, { x: 0, y: 0 });
  assert.equal(rad.arrows.length, 1);
  assert.ok(Math.abs(Math.hypot(rad.arrows[0].tip.x, rad.arrows[0].tip.y) - 5) < 1e-9);
  const dia = dimensionArt(circ, { k: 'diameter', a: 1, value: 10 }, null, 4, { x: 0, y: 0 });
  assert.equal(dia.arrows.length, 2);
  assert.equal(dimensionArt(circ, { k: 'angle', a: 1, b: 1, value: 3 }, null, 4, { x: 0, y: 0 }), null);
});

test('dimensionArt: an angle between two lines is an arc about their meeting point', () => {
  const two = [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
    { k: 'line', id: 2, a: [0, 0], b: [0, 30] },
  ];
  const art = dimensionArt(two, { k: 'angle', a: 1, b: 2, value: 90 }, null, 4, { x: 0, y: 0 });
  assert.ok(art);
  assert.equal(art.arrows.length, 2);
  const radii = art.arrows.map((a) => Math.hypot(a.tip.x, a.tip.y));
  assert.ok(Math.abs(radii[0] - radii[1]) < 1e-9, 'both ends sit on one circle');
  // The arc spans the quadrant the value names: both ends in x,y >= 0.
  for (const a of art.arrows) assert.ok(a.tip.x > -1e-9 && a.tip.y > -1e-9);
  assert.ok(art.label.x > 0 && art.label.y > 0);
  // Parallel lines have no vertex, so no arc.
  const par = [two[0], { k: 'line', id: 3, a: [0, 5], b: [40, 5] }];
  assert.equal(dimensionArt(par, { k: 'angle', a: 1, b: 3, value: 0 }, null, 4, { x: 0, y: 0 }), null);
});

test('dimensionArt: a Lock pair measures from the origin (built-in id -1), zero included', () => {
  const pt = [{ k: 'point', id: 1, p: [40, 0] }];
  const dx = dimensionArt(pt, { k: 'distanceX', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 40 }, null, 5, { x: 0, y: 10 });
  assert.ok(dx, 'distanceX from the origin draws');
  assert.equal(dx.arrows.length, 2);
  const dy = dimensionArt(pt, { k: 'distanceY', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 0 }, null, 5, { x: 0, y: 10 });
  assert.ok(dy, 'a zero distance still draws its extension line and number');
  assert.equal(dy.arrows.length, 0);
  assert.ok(Number.isFinite(dy.label.x) && Number.isFinite(dy.label.y));
});
