// Surface sketch: pure tests (no kernel). Every expected number comes from a closed form or from a second,
// independent computation -- never from the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  surfaceMap, mapLoops, stretchAt, shapes, planSurfaceSketch, verifySurfaceSketch, regionArea, polyArea, loopPoints,
  wavesHeight, sphereCapHeight, cylinderTopHeight, fitHeight, cornerFrame, integrateRegion,
} from '../dist/surface-sketch.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const plen = (pts, closed = false) => { let s = 0; for (let i = 0; i + 1 < pts.length; i++) s += len(sub(pts[i + 1], pts[i])); if (closed) s += len(sub(pts[0], pts[pts.length - 1])); return s; };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, want ${b} (tol ${tol})`);
const rad = (d) => (d * Math.PI) / 180;
const mapLine = (m, a, b, n = 4000) => Array.from({ length: n + 1 }, (_, i) => m.at([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]).p);

// ---------------------------------------------------------------- cylinder
const CYL = { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 20, extent: [0, 40] };
const cylPl = { anchor: [25, 0, 20], xDir: [0, 1, 0] }; // x round the wall, y up the axis

test('cylinder: every sketch line keeps its length, in any direction (unrolling)', () => {
  const m = surfaceMap(CYL, cylPl);
  for (const ang of [0, 17, 45, 73, 90, 135]) {
    const a = rad(ang), L = 30;
    const pts = mapLine(m, [0, 0], [L * Math.cos(a), L * Math.sin(a)]);
    close(plen(pts), L, 1e-6, `angle ${ang}`);
    for (const p of pts) close(Math.hypot(p[0], p[1]), 20, 1e-9, 'on the wall');
  }
  // round the wall: x = R*theta lands at angle theta
  const p = m.at([20 * (Math.PI / 3), 0]).p;
  close(Math.atan2(p[1], p[0]), Math.PI / 3, 1e-12, 'arc length -> angle');
  close(stretchAt(m, [7, -3]), 0, 1e-6, 'no stretch');
});

test('cylinder: closed form equals the numerical geodesic walk on the same wall as a height field', () => {
  const m = surfaceMap(CYL, cylPl);
  // the wall's top seen along +x: height field over the (y, z) plane, z_h = sqrt(R^2 - y^2) - R, anchor at x = 20
  const g = surfaceMap({ kind: 'graph', origin: [20, 0, 0], x: [0, 1, 0], y: [0, 0, 1], height: cylinderTopHeight(20), bounds: { x: [-19, 19], y: [0, 40] } }, { anchor: [20, 0, 20], xDir: [0, 1, 0] });
  for (const q of [[5, 3], [-12, 7], [18, -15], [0, 19], [-25, 4]]) {
    const a = m.at(q).p, b = g.at(q).p;
    assert.ok(len(sub(a, b)) < 1e-7, `${q}: ${len(sub(a, b))}`);
  }
});

// ---------------------------------------------------------------- sphere
const SPH = { kind: 'sphere', center: [0, 0, 0], radius: 30 };
const sphPl = { anchor: [0, 0, 40], xDir: [1, 0, 0] };

test('sphere: closed form equals the numerical geodesic walk on the cap as a height field', () => {
  const m = surfaceMap(SPH, sphPl);
  const g = surfaceMap({ kind: 'graph', origin: [0, 0, 30], x: [1, 0, 0], y: [0, 1, 0], height: sphereCapHeight(30), bounds: { x: [-29, 29], y: [-29, 29] } }, { anchor: [0, 0, 30], xDir: [1, 0, 0] });
  for (const q of [[5, 3], [-12, 7], [18, -15], [0, 19], [-9, -9]]) {
    const a = m.at(q).p, b = g.at(q).p;
    assert.ok(len(sub(a, b)) < 1e-7, `${q}: ${len(sub(a, b))}`);
  }
});

test('sphere: distances from the anchor are kept; a sketch circle comes out 2 pi R sin(r/R) long; stretch is 1 - sinc', () => {
  const R = 30, m = surfaceMap(SPH, sphPl);
  for (const ang of [0, 33, 90, 200]) close(plen(mapLine(m, [0, 0], [15 * Math.cos(rad(ang)), 15 * Math.sin(rad(ang))])), 15, 1e-6, 'radial');
  const r = 10;
  const circ = mapLoops(m, [shapes.circle([0, 0], r)])[0].pieces[0].surface.map((s) => s.p);
  // the mapped polyline is a chord polygon of ~1260 sides: allow its chord shortfall (~6e-5)
  close(plen(circ, true), 2 * Math.PI * R * Math.sin(r / R), 1.5e-4, 'circle length');
  close(stretchAt(m, [r, 0]), 1 - Math.sin(r / R) / (r / R), 1e-5, 'stretch');
});

test('sphere: area of a disk sketch is the cap area 2 pi R^2 (1 - cos(r/R))', () => {
  const R = 30, r = 4;
  const p = planSurfaceSketch({ body: 'b', target: SPH, placement: sphPl, loops: [shapes.circle([0, 0], r)], op: { op: 'cut', depth: 1 } });
  assert.ok(p.ok, p.refusal);
  close(p.prediction.surfaceArea, 2 * Math.PI * R * R * (1 - Math.cos(r / R)), 2e-4 * 50, 'cap area');
});

// ---------------------------------------------------------------- corner, at many angles
function cornerAt(deg, convex) {
  // face A: the plane z = 0, part with x <= 0 (normal +z); edge along y through the origin.
  // face B turns down (convex, outside corner) or up (concave, inside corner) by the interior angle `deg`.
  const phi = rad(deg);
  const mB = [-Math.cos(phi), 0, convex ? -Math.sin(phi) : Math.sin(phi)]; // in-face direction away from the edge
  // B's outward normal: perpendicular to the edge and to mB, on the outside of the material
  let nB = [mB[2], 0, -mB[0]];
  if (convex ? nB[0] < 0 : nB[0] > 0) nB = nB.map((v) => -v);
  return { kind: 'corner', edgePoint: [0, 0, 0], edgeDir: [0, 1, 0], normalA: [0, 0, 1], normalB: nB, pointB: [10 * mB[0], 3, 10 * mB[2]], _mB: mB };
}
// interior angle between the faces measured inside the material: convex 90 = a box edge
const ANGLES = [30, 60, 90, 120, 150, 175];

test('corner: the shortest path across the edge equals the sketch distance, at every angle, inside and outside corners', () => {
  for (const convex of [true, false]) for (const deg of ANGLES) {
    const t = cornerAt(deg, convex);
    // anchor on A at x = -8; sketch x points at the edge (+x)
    const m = surfaceMap(t, { anchor: [-8, 0, 0], xDir: [1, 0, 0] });
    for (const q of [[15, 0], [20, 6], [12, -9], [9.5, 2]]) {
      const P = m.at(q);
      assert.equal(P.face, 'B', `${deg} ${q}`);
      // P lies on plane B
      close(dot(P.p, t.normalB), 0, 1e-9, 'on B');
      // independent: shortest path anchor -> edge point (0, y, 0) -> P, minimised over y by golden section
      const A = m.anchor;
      const f = (y) => len(sub([0, y, 0], A)) + len(sub(P.p, [0, y, 0]));
      let lo = -100, hi = 100;
      for (let k = 0; k < 200; k++) { const a = lo + (hi - lo) * 0.382, b = lo + (hi - lo) * 0.618; if (f(a) < f(b)) hi = b; else lo = a; }
      close(f((lo + hi) / 2), Math.hypot(q[0], q[1]), 1e-6, `${convex ? 'outside' : 'inside'} ${deg} deg ${q}`);
    }
    // a circle across the edge keeps its length and is broken exactly at the edge
    const ml = mapLoops(m, [shapes.circle([8, 0], 5)])[0];
    const all = ml.pieces.flatMap((pc) => pc.surface.map((s) => s.p));
    close(ml.pieces.reduce((s, pc) => s + plen(pc.surface.map((x) => x.p)), 0), 2 * Math.PI * 5, 1e-3, 'circle length');
    assert.equal(ml.pieces.length, 2, 'two pieces, one per face');
    for (const pc of ml.pieces) for (const end of [pc.surface[0].p, pc.surface[pc.surface.length - 1].p]) close(Math.hypot(end[0], end[2]), 0, 1e-9, 'piece ends on the edge');
    void all;
    const fr = cornerFrame(t, m.anchor);
    close(fr.angleDeg, deg, 1e-9, 'interior angle');
    assert.equal(fr.convex, convex);
  }
});

// ---------------------------------------------------------------- wavy (non-uniform, doubly curved)
const WAVES = wavesHeight([{ a: 2, kx: 1 / 6, ky: 0 }, { a: 1.5, kx: 1 / 11, ky: 1 / 5 }, { a: 0.8, kx: 0.13, ky: -0.07, phase: 1 }]);
const WAVY = { kind: 'graph', origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0], height: WAVES, bounds: { x: [-30, 30], y: [-30, 30] } };
const wavyPl = { anchor: [3, -2, 20], xDir: [1, 0.2, 0] };

test('wavy: mapped points lie on the surface and radial walks are exactly as long as the sketch says', () => {
  const m = surfaceMap(WAVY, wavyPl);
  for (const ang of [0, 40, 95, 180, 260]) {
    const pts = mapLine(m, [0, 0], [14 * Math.cos(rad(ang)), 14 * Math.sin(rad(ang))], 700);
    close(plen(pts), 14, 2e-4, `radial ${ang}`);
    for (const p of pts) close(p[2] - 20, WAVES(p[0], p[1]).z, 1e-9, 'on the surface');
  }
});

test('wavy: the walk is a geodesic (no sideways bending), and halving the step changes nothing', () => {
  const m = surfaceMap(WAVY, wavyPl);
  const fine = surfaceMap(WAVY, wavyPl, { step: 0.0125 });
  for (const q of [[10, 4], [-6, 9], [3, -12]]) assert.ok(len(sub(m.at(q).p, fine.at(q).p)) < 1e-7, `step ${q}`);
  // geodesic curvature: the curve's acceleration has no component along the surface, sideways to the curve
  const n = 4000, L = 12, h = L / n;
  const pts = Array.from({ length: n + 1 }, (_, i) => m.at([(L * i) / n * 0.8, (L * i) / n * 0.6]).p);
  let worst = 0;
  for (let i = 100; i < n - 100; i += 50) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const acc = [(a[0] - 2 * b[0] + c[0]) / (h * h), (a[1] - 2 * b[1] + c[1]) / (h * h), (a[2] - 2 * b[2] + c[2]) / (h * h)];
    const tv = sub(c, a).map((v) => v / (2 * h));
    const s = WAVES(b[0], b[1]);
    const nn = [-s.zx, -s.zy, 1].map((v) => v / Math.hypot(s.zx, s.zy, 1));
    const side = [tv[1] * nn[2] - tv[2] * nn[1], tv[2] * nn[0] - tv[0] * nn[2], tv[0] * nn[1] - tv[1] * nn[0]];
    worst = Math.max(worst, Math.abs(dot(acc, side)));
  }
  assert.ok(worst < 1e-3, `geodesic curvature ${worst}`);
});

test('wavy: a height field fitted to measured points maps a sketch where the true surface does', () => {
  const pts = [];
  for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) { const x = -30 + i, y = -30 + j; pts.push([x, y, 20 + WAVES(x, y).z]); }
  const fit = fitHeight(pts, { origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0] }, 2);
  assert.ok(fit.maxResidual < 2e-3, `residual ${fit.maxResidual}`);
  const mf = surfaceMap({ ...WAVY, height: fit.height }, wavyPl), mt = surfaceMap(WAVY, wavyPl);
  for (const q of [[10, 4], [-6, 9], [3, -12], [14, 14]]) assert.ok(len(sub(mf.at(q).p, mt.at(q).p)) < 2e-3, `${q}: ${len(sub(mf.at(q).p, mt.at(q).p))}`);
});

// ---------------------------------------------------------------- planning: commands and predictions
test('cut along the view on a cylinder: volume = shadow area x depth, shadow of a wrapped rectangle in closed form', () => {
  const R = 20, a = 8, z0 = -5, z1 = 5, h = 1.5;
  const p = planSurfaceSketch({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.rect(-a, z0, a, z1)], op: { op: 'cut', depth: h } });
  assert.ok(p.ok, p.refusal);
  // the wrapped rectangle seen along the radius: width 2 R sin(a/R), height z1 - z0
  close(-p.prediction.volumeDelta, 2 * R * Math.sin(a / R) * (z1 - z0) * h, 1e-6, 'volume');
  close(p.prediction.surfaceArea, 2 * a * (z1 - z0), 1e-6, 'surface area = sketch area');
  const ids = p.commands.map((c) => c.command);
  assert.deepEqual(ids.slice(-5), ['solid.extrude', 'solid.move', 'solid.combine', 'solid.combine', 'solid.combine']);
  // seen along the radius, the sides up the axis and the sides round the wall (circles at one height) are all straight
  assert.equal(ids.filter((c) => c === 'sketch.line').length, 4);
  // turned 30 degrees, the sides become helices and come out as splines
  const q = planSurfaceSketch({ body: 'c', target: CYL, placement: { anchor: cylPl.anchor, xDir: [0, Math.cos(rad(30)), Math.sin(rad(30))] }, loops: [shapes.rect(-a, z0, a, z1)], op: { op: 'cut', depth: h } });
  assert.ok(q.ok && q.commands.filter((c) => c.command === 'sketch.spline.fit_point').length === 4);
});

test('cut square to the surface on a cylinder: volume between radius R and R - h inside the shadow prism (closed form)', () => {
  const R = 20, a = 8, z0 = -5, z1 = 5, h = 1.5, w = R * Math.sin(a / R);
  const F = (x, r) => (x * Math.sqrt(r * r - x * x) + r * r * Math.asin(x / r)) / 2;
  const want = (z1 - z0) * 2 * (F(w, R) - F(w, R - h));
  const p = planSurfaceSketch({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.rect(-a, z0, a, z1)], op: { op: 'cut', depth: h, floor: 'normal' } });
  assert.ok(p.ok, p.refusal);
  close(-p.prediction.volumeDelta, want, want * 2e-5, 'volume');
});

test('raise square to the surface on a sphere: shell volume inside the shadow cylinder (closed form)', () => {
  const R = 30, r = 6, h = 1;
  const a = R * Math.sin(r / R);
  const cap = (Rr) => (2 * Math.PI / 3) * (Rr ** 3 - (Rr * Rr - a * a) ** 1.5);
  const want = cap(R + h) - cap(R);
  const p = planSurfaceSketch({ body: 'b', target: SPH, placement: sphPl, loops: [shapes.circle([0, 0], r)], op: { op: 'raise', height: h, floor: 'normal' } });
  assert.ok(p.ok, p.refusal);
  close(p.prediction.volumeDelta, want, want * 1e-4, 'volume');
});

test('imprint on a round face: split the far side off first, then one periodic spline', () => {
  const p = planSurfaceSketch({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.circle([0, 0], 5)], op: { op: 'imprint' } });
  assert.ok(p.ok, p.refusal);
  const ids = p.commands.map((c) => c.command);
  assert.deepEqual(ids, ['solid.split_face', 'sketch.create', 'sketch.spline.fit_point', 'sketch.finish', 'solid.split_face']);
  assert.equal(p.commands[2].params.periodic, true);
  assert.ok(p.prediction.seam);
  close(p.prediction.curves[0].length, 2 * Math.PI * 5, 1e-3, 'mark length = sketch length (unrolling)');
});

test('region area counts an inner loop as a hole', () => {
  const outer = loopPoints(shapes.rect(0, 0, 10, 10)), inner = loopPoints(shapes.circle([5, 5], 2));
  // the hole is a 252-sided polygon: its area is short of pi r^2 by ~1.3e-3
  close(regionArea([outer, inner]), 100 - Math.PI * 4, 2e-3);
  close(Math.abs(polyArea(outer)), 100, 1e-9);
  close(integrateRegion([outer, inner], () => 1), 100 - Math.PI * 4, 2e-3, 'scanline quadrature agrees');
});

// ---------------------------------------------------------------- refusals (one plain sentence, nothing built)
const refusal = (input) => { const p = planSurfaceSketch(input); assert.equal(p.ok, false, 'expected a refusal'); assert.doesNotMatch(p.refusal, /undefined|NaN|solidcraft|kernel/i); return p.refusal; };

test('refused: a sketch too big for the sphere to hold without stretching', () => {
  assert.match(refusal({ body: 'b', target: SPH, placement: sphPl, loops: [shapes.circle([0, 0], 12)], op: { op: 'cut', depth: 1 } }), /stretching.*\d+(\.\d)?%/);
  // the same sketch is accepted when the student allows the stretch
  assert.ok(planSurfaceSketch({ body: 'b', target: SPH, placement: sphPl, loops: [shapes.circle([0, 0], 12)], op: { op: 'cut', depth: 1 }, maxStretch: 0.05 }).ok);
});
test('refused: a sketch that wraps too far round a cylinder for one view', () => {
  assert.match(refusal({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.rect(-30, -3, 30, 3)], op: { op: 'cut', depth: 1 } }), /wraps too far/);
});
test('refused: running off the end of the round face, or off a wavy face', () => {
  assert.match(refusal({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.rect(-3, 15, 3, 25)], op: { op: 'cut', depth: 1 } }), /off the end/);
  assert.match(refusal({ body: 'w', target: { ...WAVY, bounds: { x: [-5, 5], y: [-5, 5] } }, placement: wavyPl, loops: [shapes.circle([0, 0], 6)], op: { op: 'cut', depth: 1 } }), /off the edge/);
});
test('refused: marking an outline with corners (the kernel would carry its sides on to the edge of the face)', () => {
  assert.match(refusal({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.rect(-3, -3, 3, 3)], op: { op: 'imprint' } }), /smooth closed outline/);
});
test('refused: a corner too sharp to work across, zero depth, an irregular measured face', () => {
  const t = cornerAt(30, true);
  assert.match(refusal({ body: 'b', target: t, placement: { anchor: [-8, 0, 0], xDir: [1, 0, 0] }, loops: [shapes.circle([8, 0], 4)], op: { op: 'cut', depth: 1 } }), /corner/);
  assert.match(refusal({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.circle([0, 0], 3)], op: { op: 'cut', depth: 0 } }), /more than zero/);
  assert.match(refusal({ body: 'w', target: WAVY, placement: wavyPl, loops: [shapes.circle([0, 0], 3)], op: { op: 'cut', depth: 1 }, fit: { maxResidual: 0.05 } }), /too irregular/);
});

// ---------------------------------------------------------------- verification
test('verify: a volume that matches passes, one that does not is refused', () => {
  const prediction = { op: 'cut', volumeDelta: -120, curves: [], stretch: 0, tiltDeg: 0, view: [1, 0, 0] };
  assert.ok(verifySurfaceSketch({ prediction, volumeBefore: 50265.48, volumeAfter: 50145.48 }).ok);
  const bad = verifySurfaceSketch({ prediction, volumeBefore: 50265.48, volumeAfter: 50150 });
  assert.equal(bad.ok, false);
});
test('verify: an imprint whose edges leave the predicted outline (carried on to the face edge) is refused', () => {
  const circle = Array.from({ length: 400 }, (_, i) => [Math.cos((2 * Math.PI * i) / 400) * 5, Math.sin((2 * Math.PI * i) / 400) * 5, 0]);
  const prediction = { op: 'imprint', curves: [{ points: circle, closed: true, length: 2 * Math.PI * 5 }], stretch: 0, tiltDeg: 0, view: [0, 0, 1] };
  const arc = (a0, a1) => { const P = (a) => [5 * Math.cos(a), 5 * Math.sin(a), 0]; return { start: P(a0), mid: P((a0 + a1) / 2), end: P(a1), length: 5 * (a1 - a0) }; };
  const ring = Array.from({ length: 8 }, (_, k) => arc((k * Math.PI) / 4, ((k + 1) * Math.PI) / 4));
  const frame = [{ start: [-20, -20, 0], mid: [0, -20, 0], end: [20, -20, 0], length: 40 }];
  assert.ok(verifySurfaceSketch({ prediction, edgesBefore: frame, edgesAfter: [...frame, ...ring] }).ok);
  const stray = { start: [5, 0, 0], mid: [12.5, 0, 0], end: [20, 0, 0], length: 15 };
  assert.equal(verifySurfaceSketch({ prediction, edgesBefore: frame, edgesAfter: [...frame, ...ring, stray] }).ok, false);
  assert.equal(verifySurfaceSketch({ prediction, edgesBefore: frame, edgesAfter: [...frame, ...ring.slice(0, 5)] }).ok, false, 'part of the outline missing');
});

test('corner: a rectangle across the edge stays straight-sided in the shadow (its corners are not rounded off)', () => {
  for (const deg of [60, 90, 120]) for (const convex of [true, false]) {
    const t = cornerAt(deg, convex);
    const p = planSurfaceSketch({ body: 'k', target: t, placement: { anchor: [-8, 0, 0], xDir: [1, 0, 0] }, loops: [shapes.rect(2, -4, 14, 4)], op: { op: 'raise', height: 1 } });
    assert.ok(p.ok, p.refusal);
    const ids = p.commands.map((c) => c.command);
    // seen along the bisector, the sides that cross the edge square-on stay straight lines, so 4 lines
    assert.equal(ids.filter((c) => c === 'sketch.line').length, 4, `${deg} ${convex}`);
    assert.equal(ids.filter((c) => c === 'sketch.spline.fit_point').length, 0, `${deg} ${convex}`);
    // closed form: 6 x 8 on each face, seen along the bisector of the two normals
    const half = (180 - deg) / 2;
    close(p.prediction.volumeDelta, 2 * 48 * Math.cos(rad(half)), 1e-5, `${deg} ${convex} volume`);
  }
});

test('outlines whose pieces meet smoothly are sent as one closed periodic spline (slot), and can be marked', () => {
  const p = planSurfaceSketch({ body: 'c', target: CYL, placement: cylPl, loops: [shapes.slot([0, 0], 8, 2)], op: { op: 'imprint' } });
  assert.ok(p.ok, p.refusal);
  const sp = p.commands.filter((c) => c.command === 'sketch.spline.fit_point');
  assert.equal(sp.length, 1);
  assert.equal(sp[0].params.periodic, true);
  close(p.prediction.curves[0].length, 2 * 8 + 2 * Math.PI * 2, 1e-3, 'slot outline length');
});
