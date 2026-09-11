// engine/bridge/p1d-test.mjs
//
// Lead's gate for P1d (2D sketcher growth): Ellipse, Point, and the four new
// constraints (Symmetric, Angle, DistanceX, DistanceY). Written by the lead,
// not by the builder that wrote the emitters -- a builder that can edit its
// own gate eventually will.
//
// The reason this file exists, stated plainly so nobody weakens it later:
// addEllipse originally emitted a FOUR-argument Part.Ellipse(center, normal,
// majorAxis, ry). That form does not exist. EllipsePyImp.cpp:55-140 accepts
// exactly four shapes and lists them in its own TypeError -- empty; Ellipse;
// (Point, double, double); (Point, Point, Point) -- so the old call raised
// TypeError on every use. The rewrite uses the three-point form, which routes
// through OCCT's GC_MakeEllipse, and GC_MakeEllipse REFUSES major < minor.
// So a TALL ellipse (ry > rx) has to be handed over with its AXES swapped
// rather than its radii, and:
//
//   *** A WIDE-ONLY TEST PASSES WHILE TALL IS BROKEN. ***
//
// That is the whole point of slice 1. Do not delete the tall case, and do not
// let the wide case stand in for it. rx == ry is here too because it sits
// exactly on GC_MakeEllipse's major >= minor boundary, which is the value most
// likely to be off by one comparison operator.
//
// The radii cannot be asserted from sketchState(): state() reports cx/cy/r,
// and an Ellipse has MajorRadius/MinorRadius rather than Radius, so its `r`
// is silently absent. So the ellipse is PADDED and measured as a solid --
// volume proves the radii (pi*rx*ry*depth) and the bounding box proves the
// ORIENTATION, which volume alone cannot: pi*20*10 and pi*10*20 are the same
// number, and a swapped-axis bug is exactly what would produce it.
//
// Run inside the PartDesign-enabled kernel container:
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/p1d-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';
import { attachSketchCommands } from '../../packages/engine/src/fc-sketch.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachSketchCommands(attachCommands(createFcSession(await loadNodeKernel(kernelJs))));

/** Bounding box of the active solid, from the tessellated face vertices.
 *  meshFaces() is the only reader that hands back real coordinates, and the
 *  X/Y extents of a padded ellipse are its two diameters -- which is how this
 *  gate tells a wide ellipse from a tall one. Tessellation is an inner
 *  approximation, so the measured extent is a hair UNDER the true diameter;
 *  every comparison below carries a tolerance that accounts for it. */
function bbox() {
  const { faces } = s.meshFaces();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of faces) {
    for (let i = 0; i < f.positions.length; i += 3) {
      const x = f.positions[i], y = f.positions[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { dx: x1 - x0, dy: y1 - y0 };
}

/** One padded ellipse, built in its own document so nothing leaks between
 *  cases, measured three ways: it was CREATED (no TypeError), its area is
 *  right (volume), and its axes point the right way (bounding box). */
function ellipseCase(tag, rx, ry, depth = 5) {
  const doc = `ell_${tag}`;
  s.newDocument(doc);
  s.newBody('B');
  s.sketchNew('B', 'S');

  // (1) it builds at all. The four-argument form died here with a TypeError.
  const gid = s.sketchAddEllipse('S', 0, 0, rx, ry);
  const st = s.sketchState('S');
  const row = st.geometry.find((g) => g.id === gid);
  console.log(`  [${tag}] rx=${rx} ry=${ry} -> geoId=${gid} type=${row?.type} centre=(${row?.cx},${row?.cy})`);
  assert.ok(row, `${tag}: ellipse geometry missing from sketchState`);
  assert.equal(row.type, 'Ellipse', `${tag}: geometry type is Ellipse`);
  assert.ok(Math.abs(row.cx) < 1e-6 && Math.abs(row.cy) < 1e-6, `${tag}: centre at the origin`);

  // (1b) state() must carry enough to DRAW it. Added after the browser dogfood
  // found ellipses committing to the solver and rendering nothing: redrawGeometry
  // had no branch, and could not have had one, because state() reported cx/cy and
  // then silently dropped the radii (an Ellipse has MajorRadius/MinorRadius, so
  // the shared cx/cy/r line throws on `.Radius` after setting cx and cy).
  //
  // AngleXU is the real orientation check and the one worth having here: FreeCAD
  // always stores major >= minor, so BOTH a wide and a tall ellipse report
  // rx=20 ry=10, and the ONLY thing distinguishing them is the angle -- 0 for
  // wide, PI/2 for tall. A renderer that ignores it draws every tall ellipse
  // lying down, and no volume or radius assertion anywhere would notice.
  const major = Math.max(rx, ry), minor = Math.min(rx, ry);
  console.log(`  [${tag}] state rx=${row.rx} ry=${row.ry} ang=${row.ang}`);
  assert.ok(typeof row.rx === 'number', `${tag}: state() reports rx (MajorRadius) -- the renderer needs it`);
  assert.ok(typeof row.ry === 'number', `${tag}: state() reports ry (MinorRadius) -- the renderer needs it`);
  assert.ok(typeof row.ang === 'number', `${tag}: state() reports ang (AngleXU) -- wide and tall differ ONLY by this`);
  assert.ok(Math.abs(row.rx - major) < 1e-6, `${tag}: rx is the MAJOR radius ${major} (got ${row.rx})`);
  assert.ok(Math.abs(row.ry - minor) < 1e-6, `${tag}: ry is the MINOR radius ${minor} (got ${row.ry})`);
  const wantAng = ry > rx ? Math.PI / 2 : 0;
  assert.ok(Math.abs(Math.abs(row.ang) - wantAng) < 1e-6,
    `${tag}: AngleXU is ${wantAng} (got ${row.ang}) -- this is what tells a tall ellipse from a wide one`);

  // (2) the radii are the ones asked for: an ellipse's area is pi*rx*ry, so a
  //     pad of `depth` has exactly that volume. This catches both radii being
  //     set to the same value, or one being dropped.
  s.pad('B', 'S', 'Pad', depth);
  const vol = s.mesh().volume;
  const want = Math.PI * rx * ry * depth;
  console.log(`  [${tag}] volume=${vol.toFixed(3)} want=${want.toFixed(3)}`);
  assert.ok(Math.abs(vol - want) / want < 2e-3, `${tag}: padded volume is pi*rx*ry*depth (got ${vol}, want ${want})`);

  // (3) the axes point the right way. THIS is the tall check -- volume is
  //     identical for (20,10) and (10,20), so only the box can tell them apart.
  const { dx, dy } = bbox();
  console.log(`  [${tag}] bbox dx=${dx.toFixed(3)} dy=${dy.toFixed(3)} want ${2 * rx} x ${2 * ry}`);
  assert.ok(Math.abs(dx - 2 * rx) < 0.2, `${tag}: X extent is 2*rx (got ${dx}, want ${2 * rx}) -- axes swapped?`);
  assert.ok(Math.abs(dy - 2 * ry) < 0.2, `${tag}: Y extent is 2*ry (got ${dy}, want ${2 * ry}) -- axes swapped?`);
}

// --- slice 1: ellipse, all three orientations ------------------------------
console.log('slice 1: ellipse');
ellipseCase('wide', 20, 10);   // major along X -- the case that always passed
ellipseCase('tall', 10, 20);   // major along Y -- the case the old code broke
ellipseCase('equal', 15, 15);  // sits on GC_MakeEllipse's major >= minor boundary

// --- slice 2: point --------------------------------------------------------
// A Point bounds no face and has no corners, so there is nothing to pad and
// nothing to measure but its existence and its coordinates. That IS the
// contract: it is a snap marker, and the DoF badge must not pretend otherwise.
console.log('slice 2: point');
s.newDocument('pt');
s.newBody('B');
s.sketchNew('B', 'S');
const gpt = s.sketchAddPoint('S', 12, -7);
let st = s.sketchState('S');
const ptRow = st.geometry.find((g) => g.id === gpt);
console.log(`  point geoId=${gpt} type=${ptRow?.type} dof=${st.dof}`);
assert.ok(ptRow, 'point geometry missing from sketchState');
assert.equal(ptRow.type, 'Point', 'geometry type is Point');
assert.equal(st.conflicting.length, 0, 'a lone point conflicts with nothing');

// A Point exposes X/Y/Z and NOTHING else -- no StartPoint, no EndPoint, no
// Center -- so it arrives from state() with no coordinates at all unless they
// are read from those three. That is why the browser drew nothing for it: not
// a missing renderer branch alone, but a renderer branch with nothing to draw.
console.log(`  point state px=${ptRow.px} py=${ptRow.py} (placed at 12,-7)`);
assert.ok(typeof ptRow.px === 'number', 'state() reports px -- the renderer needs it');
assert.ok(typeof ptRow.py === 'number', 'state() reports py -- the renderer needs it');
assert.ok(Math.abs(ptRow.px - 12) < 1e-6, `point px is 12 (got ${ptRow.px})`);
assert.ok(Math.abs(ptRow.py + 7) < 1e-6, `point py is -7 (got ${ptRow.py})`);

// --- slice 3: symmetric ----------------------------------------------------
// One line, its two endpoints made symmetric about the sketch origin (the root
// point, geoId -1 / PointPos 1). Point-symmetry means the MIDPOINT lands on
// the origin -- which is also the correction made to the solver comment this
// phase, where "perpendicular bisector" (line symmetry) was the wrong words
// for the right maths.
console.log('slice 3: symmetric');
s.newDocument('sym');
s.newBody('B');
s.sketchNew('B', 'S');
const gs = s.sketchAddLine('S', 3, 4, 19, 26); // deliberately not centred
s.constrainSymmetric('S', gs, 1, gs, 2, -1, 1);
st = s.sketchState('S');
const symRow = st.geometry.find((g) => g.id === gs);
const mx = (symRow.x1 + symRow.x2) / 2, my = (symRow.y1 + symRow.y2) / 2;
console.log(`  midpoint=(${mx.toFixed(6)}, ${my.toFixed(6)}) want (0,0)  conflicting=${st.conflicting.length}`);
assert.equal(st.conflicting.length, 0, 'symmetric alone does not conflict');
assert.ok(Math.abs(mx) < 1e-6 && Math.abs(my) < 1e-6, `symmetric put the midpoint on the origin (got ${mx},${my})`);

// --- slice 4: angle --------------------------------------------------------
// Two lines sharing a corner, constrained to meet at 45 degrees. Measured back
// as the signed turn between the direction vectors -- the same quantity the
// solver's own `angle` residual compares, so a sign or wrap error shows here.
console.log('slice 4: angle');
s.newDocument('ang');
s.newBody('B');
s.sketchNew('B', 'S');
const ga = s.sketchAddLine('S', 0, 0, 20, 0);
const gb = s.sketchAddLine('S', 0, 0, 14, 3); // ~12 degrees: the solver must move it
s.constrainCoincident('S', ga, 1, gb, 1);
s.constrainAngle('S', ga, gb, 45);
st = s.sketchState('S');
const ra = st.geometry.find((g) => g.id === ga);
const rb = st.geometry.find((g) => g.id === gb);
const ax = ra.x2 - ra.x1, ay = ra.y2 - ra.y1;
const bx = rb.x2 - rb.x1, by = rb.y2 - rb.y1;
const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * (180 / Math.PI);
console.log(`  measured turn=${turn.toFixed(4)} deg  want 45  conflicting=${st.conflicting.length}`);
assert.equal(st.conflicting.length, 0, 'a 45-degree angle on two free lines does not conflict');
assert.ok(Math.abs(Math.abs(turn) - 45) < 1e-3, `angle solved to 45 degrees (got ${turn})`);

// --- slice 5: distanceX / distanceY ----------------------------------------
// These two already had a bridge path before P1d (fc-sketch.mjs:314-315) and
// are exercised by sketch-test.mjs. They are re-checked here for one reason
// only: P1d put them behind NEW UI that passes {geoId, pointPos} pairs from a
// point selection rather than the single-geometry endpoints sketch-test uses,
// so this asserts the two-point call shape the buttons actually emit.
console.log('slice 5: distanceX / distanceY');
s.newDocument('dxy');
s.newBody('B');
s.sketchNew('B', 'S');
const d0 = s.sketchAddLine('S', 0, 0, 11, 2);
const d1 = s.sketchAddLine('S', 11, 2, 13, 21);
s.constrainCoincident('S', d0, 2, d1, 1);
s.constrainDistanceX('S', d0, 1, d1, 2, 30);   // start of line 0 -> end of line 1
s.constrainDistanceY('S', d0, 1, d1, 2, 25);
st = s.sketchState('S');
const e0 = st.geometry.find((g) => g.id === d0);
const e1 = st.geometry.find((g) => g.id === d1);
const gapX = e1.x2 - e0.x1, gapY = e1.y2 - e0.y1;
console.log(`  gapX=${gapX.toFixed(6)} want 30   gapY=${gapY.toFixed(6)} want 25   conflicting=${st.conflicting.length}`);
assert.equal(st.conflicting.length, 0, 'distanceX + distanceY on two free lines do not conflict');
assert.ok(Math.abs(gapX - 30) < 1e-6, `distanceX solved to 30 (got ${gapX})`);
assert.ok(Math.abs(gapY - 25) < 1e-6, `distanceY solved to 25 (got ${gapY})`);

console.log('\nP1d gate: all slices passed');
