// Step 7's self-check, the part that needs no live FreeCAD kernel:
// FreeCadEngineAdapter.build()'s own ORCHESTRATION -- does it call the right
// bridge methods with the right arguments and in the right order for each
// supported Feature.kind, does it throw for an unsupported kind, does a
// fillet whose edge cannot be resolved (or whose kernel call itself refuses)
// land in `refusals` with a pass-through shape rather than aborting the
// whole build, and does the whole-doc build throw for revolve (a found
// profile-orientation mismatch -- see this port's own report).
//
// This does NOT prove the built FreeCAD document's VOLUME matches OCCT's --
// that needs the real kernel, which this sandboxed environment could not
// run (no docker daemon). packages/kernel/test/ also carries the
// kernel-dependent volume-comparison fixtures the spec's own self-check
// asks for, written but UNRUN, following engine/bridge/*-test.mjs's own
// "run inside the kernel-build-final container" convention.
//
// Against ../dist/ -- TypeScript source, same convention as
// packages/sketch/test/sketch-solve.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FreeCadEngineAdapter } from '../dist/freecad-engine-adapter.js';

/** Records every call. `read()` and `exec()` are driven by a small
 *  dictionary of canned responses keyed by a recognisable substring of the
 *  Python, since resolvePrimitiveEdgeName()/setBodyPlacement() build real
 *  (if synthetic-answered) snippets. */
function makeFakeSession({ edgeReads = {}, bodyTip = {} } = {}) {
  const calls = [];
  const record = (name, args) => { calls.push({ name, args }); };
  let bodyCounter = 0;

  return {
    calls,
    newDocument(name) { record('newDocument', [name]); },
    newBody(name) { record('newBody', [name]); bodyCounter += 1; return name; },
    sketchNew(bodyName, sketchName) { record('sketchNew', [bodyName, sketchName]); return sketchName; },
    sketchAddRectangle(sk, x1, y1, x2, y2) { record('sketchAddRectangle', [sk, x1, y1, x2, y2]); return [0, 1, 2, 3]; },
    sketchCircle(bodyName, sketchName, radius, cx, cy) { record('sketchCircle', [bodyName, sketchName, radius, cx, cy]); return sketchName; },
    sketchAddLine(sk, x1, y1, x2, y2) { record('sketchAddLine', [sk, x1, y1, x2, y2]); return calls.filter((c) => c.name === 'sketchAddLine').length - 1; },
    sketchAddArc() { record('sketchAddArc', arguments); return 0; },
    sketchAddCircle(sk, cx, cy, r) { record('sketchAddCircle', [sk, cx, cy, r]); return 0; },
    constrainHorizontal() { record('constrainHorizontal', arguments); return 0; },
    constrainVertical() { record('constrainVertical', arguments); return 0; },
    constrainDistance() { record('constrainDistance', arguments); return 0; },
    constrainEqual() { record('constrainEqual', arguments); return 0; },
    constrainParallel() { record('constrainParallel', arguments); return 0; },
    constrainPerpendicular() { record('constrainPerpendicular', arguments); return 0; },
    constrainDistanceX() { record('constrainDistanceX', arguments); return 0; },
    constrainDistanceY() { record('constrainDistanceY', arguments); return 0; },
    constrainSymmetric() { record('constrainSymmetric', arguments); return 0; },
    constrainAngle() { record('constrainAngle', arguments); return 0; },
    constrainRadius() { record('constrainRadius', arguments); return 0; },
    constrainCoincident() { record('constrainCoincident', arguments); return 0; },
    delConstraint() { record('delConstraint', arguments); },
    sketchState() {
      record('sketchState', []);
      return { geometry: [], constraints: [], dof: 0, fully: true, conflicting: [], redundant: [], malformed: [] };
    },
    pad(bodyName, sketchName, padName, length) { record('pad', [bodyName, sketchName, padName, length]); return padName; },
    pocket(bodyName, sketchName, pocketName, length) { record('pocket', [bodyName, sketchName, pocketName, length]); return pocketName; },
    sphere(bodyName, featName, radius) { record('sphere', [bodyName, featName, radius]); return featName; },
    cone(bodyName, featName, radius1, radius2, height) { record('cone', [bodyName, featName, radius1, radius2, height]); return featName; },
    torus(bodyName, featName, ringRadius, tubeRadius) { record('torus', [bodyName, featName, ringRadius, tubeRadius]); return featName; },
    prism(bodyName, featName, radius, height, sides) { record('prism', [bodyName, featName, radius, height, sides]); return featName; },
    linearPattern(bodyName, featureName, count, step, axis, patternName = 'LinearPattern', worldAxis = null) {
      record('linearPattern', [bodyName, featureName, count, step, axis, patternName, worldAxis]);
      return patternName;
    },
    polarPattern(bodyName, featureName, count, angle, axis, patternName = 'PolarPattern', worldAxis = null) {
      record('polarPattern', [bodyName, featureName, count, angle, axis, patternName, worldAxis]);
      return patternName;
    },
    patternAxis(bodyName, axisName, origin, direction) {
      record('patternAxis', [bodyName, axisName, origin, direction]);
      return axisName;
    },
    sketchNewOnOrigin(bodyName, sketchName, planeRole = 'XZ_Plane') {
      record('sketchNewOnOrigin', [bodyName, sketchName, planeRole]);
      return sketchName;
    },
    revolve(bodyName, sketchName, revName, angle = 360) {
      record('revolve', [bodyName, sketchName, revName, angle]);
      return revName;
    },
    groove(bodyName, sketchName, featName, angle = 360) {
      record('groove', [bodyName, sketchName, featName, angle]);
      return featName;
    },
    fillet(bodyName, baseName, edgeNames, radius) {
      record('fillet', [bodyName, baseName, edgeNames, radius]);
      if (radius > 1000) throw new Error('radius too large for this solid');
      return 'Fillet';
    },
    chamfer(bodyName, baseName, edgeNames, size) {
      record('chamfer', [bodyName, baseName, edgeNames, size]);
      return 'Chamfer';
    },
    thickness(bodyName, baseName, faceNames, value) {
      record('thickness', [bodyName, baseName, faceNames, value]);
      if (value > 1000) throw new Error('hollowing failed for this face — try a smaller thickness');
      return 'Thickness';
    },
    neutralPlane(bodyName, sketchName, origin, direction) {
      record('neutralPlane', [bodyName, sketchName, origin, direction]);
      if (sketchName.includes('failplane')) throw new Error('neutral plane failed');
      return sketchName;
    },
    draft(bodyName, baseName, faceName, angleDegrees, neutralSketchName) {
      record('draft', [bodyName, baseName, faceName, angleDegrees, neutralSketchName]);
      if (Math.abs(angleDegrees) > 89) throw new Error('draft failed for this face — try a smaller angle');
      return 'Draft';
    },
    mirrored(bodyName, baseName, planeSketchName, mirrorName = 'Mirrored') {
      record('mirrored', [bodyName, baseName, planeSketchName, mirrorName]);
      if (mirrorName.includes('fail')) throw new Error('mirror failed for this plane');
      return mirrorName;
    },
    // Tests opt in explicitly via the `bodyTip` map (bodyName -> current tip
    // objName) -- default `null` for anything not named intentionally
    // triggers the tip-mismatch refusal, so a move test that expects to
    // BUILD must say so, matching this file's own opt-in style for
    // edgeReads/BOX_40_40_20_SIZE etc. above.
    bodyTip(bodyName) {
      record('bodyTip', [bodyName]);
      return bodyTip[bodyName] ?? null;
    },
    // A large-magnitude offset (>= 99999 on any axis) is this mock's own
    // failure trigger -- moveBody/copyBodyMoved have no feature-id-derived
    // name to key a 'fail' marker off (unlike mirrored/draft above, which
    // key off a name built from f.id), so a numeric sentinel plays the same
    // role fillet/thickness/draft's own radius/value thresholds already do.
    moveBody(bodyName, offset) {
      record('moveBody', [bodyName, offset]);
      if (offset.some((v) => Math.abs(v) >= 99999)) throw new Error('moving this shape broke something');
    },
    copyBodyMoved(bodyName, offset) {
      record('copyBodyMoved', [bodyName, offset]);
      if (offset.some((v) => Math.abs(v) >= 99999)) throw new Error('copying this shape did not work');
      return { bodyName: `${bodyName}_copy`, tipName: `${bodyName}_copy_pad` };
    },
    // Same "key the failure off the requested name" style as mirrored/draft
    // above -- partBoolean has no numeric threshold to abuse, so a
    // resultName containing 'fail' (derived from f.id, e.g. id 'combofail'
    // -> 'combofail_op1') is this mock's own failure trigger.
    partBoolean(op, baseName, toolName, resultName) {
      record('partBoolean', [op, baseName, toolName, resultName]);
      if (resultName.includes('fail')) throw new Error('the two shapes leave nothing behind');
      return resultName;
    },
    // Same "key the failure off the requested name" style as mirrored/draft/
    // partBoolean above -- a pocketName containing 'fail' (derived from
    // f.id, e.g. id 'boreholefail' -> 'boreholefail_bore0') is this mock's
    // own failure trigger.
    bore(bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth) {
      record('bore', [bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth]);
      if (pocketName.includes('fail')) throw new Error('hole failed — the bore could not be cut here');
      return pocketName;
    },
    exec(code) { record('exec', [code]); return { rc: 0, out: '' }; },
    read(code) {
      record('read', [code]);
      for (const [needle, response] of Object.entries(edgeReads)) {
        if (code.includes(needle)) return response;
      }
      return { edge: null };
    },
  };
}

function makeAdapter(session) {
  const adapter = new FreeCadEngineAdapter(THREE, async () => ({}));
  adapter['session'] = session;
  return adapter;
}

const boxNamed = (id, part) => ({ cause: 'primitive', feature: id, kind: 'face', part });
const betweenBox = (id, partA, partB) => ({ cause: 'between', feature: id, kind: 'edge', of: [boxNamed(id, partA), boxNamed(id, partB)] });

test('box: rectangle sketch at LOCAL origin (not center) + pad + Body.Placement carrying ALL of center/rotation', () => {
  // `center` used to get baked into the sketch's own local x/y coordinates
  // AND applied again via Body.Placement -- a real double-translation bug,
  // fixed by drawing the sketch at local (0,0) unconditionally and letting
  // setBodyPlacement's Body.Placement carry `center` exclusively, same
  // convention as sphere/cone/torus/prism. See freecad-engine-adapter.ts's
  // own comments on the box/cylinder branches and setBodyPlacement.
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [{ id: 'box1', kind: 'box', size: [40, 20, 10], center: [5, 0, 0], rotate: [0, 0, 30] }],
  };

  const result = adapter.build(doc);
  assert.ok(result.shapes.get('box1'));
  assert.equal(result.refusals, undefined);

  const rect = session.calls.find((c) => c.name === 'sketchAddRectangle');
  // size [40,20,10] -> x in [-20,20], y in [-10,10] -- centred on LOCAL
  // origin regardless of `center`, which never appears here anymore.
  assert.deepEqual(rect.args.slice(1), [-20, -10, 20, 10]);

  const pad = session.calls.find((c) => c.name === 'pad');
  assert.equal(pad.args[3], 10, 'pad length = box height');

  const placementExec = session.calls.find((c) => c.name === 'exec' && c.args[0].includes('body.Placement'));
  assert.ok(placementExec, 'setBodyPlacement must run an exec() snippet');
  assert.match(placementExec.args[0], /App\.Vector\(5,0,0\)/, 'placement carries the box center -- the ONLY place center is applied now');
  assert.match(placementExec.args[0], /-5\)/, 'placement pre-shift carries -height\\/2 = -5');
  assert.match(placementExec.args[0], /App\.Rotation\(App\.Vector\(0,0,1\), 30\)/, 'placement carries the Z rotation');
});

test('cylinder and sphere build via the proven sketch+pad / sphere primitive paths', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'cyl1', kind: 'cylinder', radius: 8, height: 20, center: [0, 0, 0] },
      { id: 'sph1', kind: 'sphere', radius: 5, center: [30, 0, 0] },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.shapes.get('cyl1'));
  assert.ok(result.shapes.get('sph1'));
  assert.ok(session.calls.find((c) => c.name === 'sketchCircle' && c.args[2] === 8));
  assert.ok(session.calls.find((c) => c.name === 'sphere' && c.args[2] === 5));
});

test('fillet: a resolvable primitive-face-pair edge builds; an unresolvable one refuses with pass-through', () => {
  const session = makeFakeSession({ edgeReads: { 'fa = _resolve_face("+x")': { edge: 'Edge3' } } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'r1', kind: 'fillet', target: 'box1', edge: betweenBox('box1', '+x', '+z'), size: 3, style: 'fillet' },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, 'a resolvable edge must not be refused');
  const filletCall = session.calls.find((c) => c.name === 'fillet');
  assert.deepEqual(filletCall.args[2], ['Edge3']);
  assert.equal(filletCall.args[3], 3);
  assert.notEqual(result.shapes.get('r1'), result.shapes.get('box1'), 'a built fillet gets its own shape entry');

  // A second doc, same box, but an edge pair this narrow resolver does not
  // cover (no canned 'read' response -> resolves to null) -- must refuse,
  // not throw, and the fillet's own shape entry must fall back to its
  // target's, matching occt-build.ts's own established pass-through pattern.
  const session2 = makeFakeSession(); // no edgeReads at all
  const adapter2 = makeAdapter(session2);
  const doc2 = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'r1', kind: 'fillet', target: 'box1', edge: betweenBox('box1', '+x', '+z'), size: 3, style: 'fillet' },
    ],
  };
  const result2 = adapter2.build(doc2);
  assert.ok(result2.refusals && result2.refusals.get('r1'), 'an unresolvable edge must be refused, not thrown');
  assert.equal(result2.shapes.get('r1'), result2.shapes.get('box1'), 'refused fillet falls back to its target shape');
});

test('fillet: the FreeCAD kernel itself refusing the radius lands in refusals too', () => {
  const session = makeFakeSession({ edgeReads: { 'fa = _resolve_face("+x")': { edge: 'Edge3' } } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'r1', kind: 'fillet', target: 'box1', edge: betweenBox('box1', '+x', '+z'), size: 9999, style: 'fillet' },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals.get('r1').includes('would not fit its edge'));
  assert.equal(result.shapes.get('r1'), result.shapes.get('box1'));
});

// The shell branch always queries the target's current BoundBox size for the
// collapse guard, so every shell fixture below registers a canned response
// for it -- the exact needle text bboxPy emits in freecad-engine-adapter.ts's
// own 'shell' branch.
const BOX_40_40_20_SIZE = { "'size': [bb.XLength, bb.YLength, bb.ZLength]": { size: [40, 40, 20] } };
// queryPrimitiveGeometry()'s own needle (resolveFace's 'primitive' path) --
// distinct from resolvePrimitiveEdgeName's `fa = _resolve_face(...)` needle
// the fillet tests above use.
const TOP_FACE_READ = { "result[part] = 'Face%d'": { parts: { '+z': 'Face6' }, adjacent: [] } };

test('shell: a resolvable open face builds a hollow with that face named to Thickness', () => {
  const session = makeFakeSession({ edgeReads: { ...BOX_40_40_20_SIZE, ...TOP_FACE_READ } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 's1', kind: 'shell', target: 'box1', thickness: 2, open: boxNamed('box1', '+z') },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, 'a resolvable open face must not be refused');
  const thicknessCall = session.calls.find((c) => c.name === 'thickness');
  assert.ok(thicknessCall, 'session.thickness must be called');
  assert.deepEqual(thicknessCall.args[2], ['Face6']);
  assert.equal(thicknessCall.args[3], 2);
  assert.notEqual(result.shapes.get('s1'), result.shapes.get('box1'), 'a built shell gets its own shape entry');
});

test('shell: no `open` face at all refuses -- this engine cannot build a fully-closed hollow', () => {
  const session = makeFakeSession({ edgeReads: BOX_40_40_20_SIZE });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 's1', kind: 'shell', target: 'box1', thickness: 2 },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('s1'), 'an absent open face must be refused, not built as a surprise opening');
  assert.match(result.refusals.get('s1'), /needs a face to open/);
  assert.equal(result.shapes.get('s1'), result.shapes.get('box1'), 'refused shell falls back to its target shape');
  assert.equal(session.calls.find((c) => c.name === 'thickness'), undefined, 'the kernel must never be called for an unresolvable open face');
});

test('shell: an `open` face given but unresolvable ALSO refuses -- does not silently fall back to closed like occt-build.ts (this kernel cannot make a closed hollow at all)', () => {
  const session = makeFakeSession({ edgeReads: BOX_40_40_20_SIZE }); // no TOP_FACE_READ -> queryPrimitiveGeometry finds nothing
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 's1', kind: 'shell', target: 'box1', thickness: 2, open: boxNamed('box1', '+z') },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('s1'));
  assert.match(result.refusals.get('s1'), /needs a face to open/);
  assert.equal(result.shapes.get('s1'), result.shapes.get('box1'));
});

test('shell: thickness <= 0 refuses before ever touching the kernel', () => {
  const session = makeFakeSession({ edgeReads: BOX_40_40_20_SIZE });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 's1', kind: 'shell', target: 'box1', thickness: 0, open: boxNamed('box1', '+z') },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('s1'), /greater than zero/);
  assert.equal(session.calls.find((c) => c.name === 'read' && c.args[0].includes('BoundBox')), undefined, 'the collapse check must not even run once thickness<=0 already refused');
});

test('shell: a thickness that would collapse the solid refuses before calling the kernel', () => {
  const session = makeFakeSession({ edgeReads: { ...BOX_40_40_20_SIZE, ...TOP_FACE_READ } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      // smallest bbox dim is 20 (height); 2*11 = 22 >= 20 -> collapse.
      { id: 's1', kind: 'shell', target: 'box1', thickness: 11, open: boxNamed('box1', '+z') },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('s1'), /would collapse it/);
  assert.equal(session.calls.find((c) => c.name === 'thickness'), undefined);
});

test('shell: the FreeCAD kernel itself refusing the thickness lands in refusals too', () => {
  // A thickness that clears the TS-side collapse guard (2*2000 = 4000 well
  // under a 10000-wide box) but still trips the fake session's own
  // kernel-refusal threshold (value > 1000) -- exercises the try/catch
  // around session.thickness() itself, distinct from the collapse guard.
  const BIG_BOX_SIZE = { "'size': [bb.XLength, bb.YLength, bb.ZLength]": { size: [10000, 10000, 10000] } };
  const session = makeFakeSession({ edgeReads: { ...BIG_BOX_SIZE, ...TOP_FACE_READ } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10000, 10000, 10000], center: [0, 0, 0] },
      { id: 's1', kind: 'shell', target: 'box1', thickness: 2000, open: boxNamed('box1', '+z') },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals.get('s1').includes('did not work'));
  assert.equal(result.shapes.get('s1'), result.shapes.get('box1'));
});

// queryPrimitiveGeometry()'s own needle, one entry per part this draft suite
// resolves a face against.
const PLUS_X_FACE_READ = { "result[part] = 'Face%d'": { parts: { '+x': 'Face2' }, adjacent: [] } };

test('draft: a resolvable face, pull=z, unrotated body -- builds a neutral plane then the draft', () => {
  const session = makeFakeSession({ edgeReads: PLUS_X_FACE_READ });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'd1', kind: 'draft', target: 'box1', face: boxNamed('box1', '+x'), angle: 10, pull: 'z', neutral: -10 },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, 'a resolvable face on an unrotated body with pull=z must not be refused');
  const neutralCall = session.calls.find((c) => c.name === 'neutralPlane');
  assert.ok(neutralCall, 'session.neutralPlane must be called to set up the world-frame pivot');
  assert.deepEqual(neutralCall.args[2], [0, 0, -10], 'neutral plane origin carries f.neutral as a world Z offset');
  assert.deepEqual(neutralCall.args[3], [0, 0, 1], 'neutral plane normal is world Z -- the only supported pull axis');
  const draftCall = session.calls.find((c) => c.name === 'draft');
  assert.ok(draftCall, 'session.draft must be called');
  assert.equal(draftCall.args[2], 'Face2', 'the resolved +x face name is passed through');
  assert.equal(draftCall.args[3], 10, 'f.angle is passed through unchanged -- cross-engine-verified (freecad-draft.manual.mjs) to need no sign flip');
  assert.notEqual(result.shapes.get('d1'), result.shapes.get('box1'), 'a built draft gets its own shape entry');
});

test('draft: `whole: true` (Body Draft) refuses -- no face-enumeration machinery for an arbitrary solid on this engine', () => {
  const session = makeFakeSession({ edgeReads: PLUS_X_FACE_READ });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'd1', kind: 'draft', target: 'box1', whole: true, angle: 10, pull: 'z', neutral: 0 },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('d1'), /Body Draft/);
  assert.equal(result.shapes.get('d1'), result.shapes.get('box1'), 'refused draft falls back to its target shape');
  assert.equal(session.calls.find((c) => c.name === 'draft'), undefined, 'the kernel must never be called for whole:true');
});

test('draft: a pull other than \'z\' refuses -- PullDirection cannot be set to a custom reference on this kernel', () => {
  const session = makeFakeSession({ edgeReads: PLUS_X_FACE_READ });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'd1', kind: 'draft', target: 'box1', face: boxNamed('box1', '+x'), angle: 10, pull: 'x', neutral: 0 },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('d1'), /pull direction other than 'z'/);
  assert.equal(session.calls.find((c) => c.name === 'draft'), undefined);
});

test('draft: a rotated target body refuses -- the implicit pull direction would follow the body\'s own tilt', () => {
  const session = makeFakeSession({ edgeReads: PLUS_X_FACE_READ });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], rotate: [0, 0, 45] },
      { id: 'd1', kind: 'draft', target: 'box1', face: boxNamed('box1', '+x'), angle: 10, pull: 'z', neutral: 0 },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('d1'), /rotated body/);
  assert.equal(session.calls.find((c) => c.name === 'draft'), undefined);
});

test('draft: an unresolvable face refuses, not throws -- and never calls neutralPlane/draft', () => {
  const session = makeFakeSession(); // no PLUS_X_FACE_READ -> resolveFace finds nothing
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'd1', kind: 'draft', target: 'box1', face: boxNamed('box1', '+x'), angle: 10, pull: 'z', neutral: 0 },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('d1'));
  assert.match(result.refusals.get('d1'), /face could not be found/);
  assert.equal(result.shapes.get('d1'), result.shapes.get('box1'));
  assert.equal(session.calls.find((c) => c.name === 'neutralPlane'), undefined, 'no neutral plane should be built for a face that never resolved');
  assert.equal(session.calls.find((c) => c.name === 'draft'), undefined);
});

test('draft: no `face` given at all refuses cleanly', () => {
  const session = makeFakeSession({ edgeReads: PLUS_X_FACE_READ });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'd1', kind: 'draft', target: 'box1', angle: 10, pull: 'z', neutral: 0 },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('d1'), /needs a face to draft/);
  assert.equal(session.calls.find((c) => c.name === 'neutralPlane'), undefined);
});

test('draft: the FreeCAD kernel itself refusing the angle lands in refusals too', () => {
  const session = makeFakeSession({ edgeReads: PLUS_X_FACE_READ });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'd1', kind: 'draft', target: 'box1', face: boxNamed('box1', '+x'), angle: 91, pull: 'z', neutral: 0 },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals.get('d1').includes('would not fit its face'));
  assert.equal(result.shapes.get('d1'), result.shapes.get('box1'));
});

// The mirror branch reads the TARGET BODY's own current Shape.BoundBox
// (WORLD-frame, since Body.Shape reflects Body.Placement -- see
// freecad-engine-adapter.ts's own mesh() comment) to find the near-face
// world coordinate, not the feature object's own body-local BoundBox --
// so this needle keys off the mirror branch's own distinctive bbox query,
// not the shell branch's `'size': [bb.XLength, ...]` one.
const bodyWorldBbox = (lo, hi) => ({ "'bbox': [[bb.XMin,bb.YMin,bb.ZMin]": { bbox: [lo, hi] } });

test('mirror: builds a world-frame mirror plane at the target\'s own near-face world coordinate, then PartDesign::Mirrored', () => {
  // Box centered at world origin, size 40x40x20 -> world bbox
  // [[-20,-20,-10],[20,20,10]]. plane 'yz' -> mirror normal is world X;
  // |lo|==|hi|==20 on X, ties go to lo (occt-build.ts's own convention:
  // `Math.abs(lo) <= Math.abs(hi) ? lo : hi`), so the plane sits at x=-20.
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'm1', kind: 'mirror', target: 'box1', plane: 'yz' },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, 'a resolvable mirror target must not be refused');

  const neutralCall = session.calls.find((c) => c.name === 'neutralPlane');
  assert.ok(neutralCall, 'session.neutralPlane must be reused to build the world-frame mirror-plane proxy');
  assert.deepEqual(neutralCall.args[2], [-20, 0, 0], 'plane origin is the box\'s own near-face world X coordinate');
  assert.deepEqual(neutralCall.args[3], [1, 0, 0], 'plane normal is world X for a yz mirror plane');

  const mirroredCall = session.calls.find((c) => c.name === 'mirrored');
  assert.ok(mirroredCall, 'session.mirrored must be called');
  assert.equal(mirroredCall.args[0], 'Body1', 'mirror is built in the target\'s own body');
  assert.equal(mirroredCall.args[1], 'box1_pad', 'Originals references the target\'s own object');
  assert.equal(mirroredCall.args[2], neutralCall.args[1], 'MirrorPlane references the SAME proxy sketch neutralPlane just built');
  assert.notEqual(result.shapes.get('m1'), result.shapes.get('box1'), 'a built mirror gets its own shape entry');
});

test('mirror: picks the HIGH side of the bounding box when it is nearer to zero than the low side', () => {
  // Box world bbox x in [10,50] -- hi (50) is farther than... wait, we want
  // hi NEARER: box world bbox x in [-50,-10] (box sitting entirely on the
  // negative side) -> |lo|=50, |hi|=10 -> hi (-10) is nearer to zero.
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-50, -20, -10], [-10, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [-30, 0, 0] },
      { id: 'm1', kind: 'mirror', target: 'box1', plane: 'yz' },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined);
  const neutralCall = session.calls.find((c) => c.name === 'neutralPlane');
  assert.deepEqual(neutralCall.args[2], [-10, 0, 0], 'the nearer (high) side of the bbox is chosen, not the low side');
});

test('mirror: plane \'xy\' mirrors along world Z, plane \'xz\' along world Y', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const docZ = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'm1', kind: 'mirror', target: 'box1', plane: 'xy' },
    ],
  };
  adapter.build(docZ);
  const neutralZ = session.calls.find((c) => c.name === 'neutralPlane');
  assert.deepEqual(neutralZ.args[3], [0, 0, 1], 'xy mirror plane normal is world Z');
  assert.deepEqual(neutralZ.args[2], [0, 0, -10], 'origin picks the near side along Z');

  const session2 = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter2 = makeAdapter(session2);
  const docY = {
    version: 1,
    features: [
      { id: 'box2', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'm2', kind: 'mirror', target: 'box2', plane: 'xz' },
    ],
  };
  adapter2.build(docY);
  const neutralY = session2.calls.find((c) => c.name === 'neutralPlane');
  assert.deepEqual(neutralY.args[3], [0, 1, 0], 'xz mirror plane normal is world Y');
  assert.deepEqual(neutralY.args[2], [0, -20, 0], 'origin picks the near side along Y');
});

test('mirror: setting up the mirror plane failing on the kernel lands in refusals, not a throw', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      // id chosen so the emitted plane sketch name trips the fake session's
      // own 'failplane' marker (see makeFakeSession's neutralPlane above).
      { id: 'failplane', kind: 'mirror', target: 'box1', plane: 'yz' },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('failplane'));
  assert.match(result.refusals.get('failplane'), /mirror plane failed/);
  assert.equal(result.shapes.get('failplane'), result.shapes.get('box1'), 'refused mirror falls back to its target shape');
  assert.equal(session.calls.find((c) => c.name === 'mirrored'), undefined, 'the kernel must never be asked to mirror once the plane setup already failed');
});

test('mirror: the FreeCAD kernel itself refusing PartDesign::Mirrored lands in refusals, not a throw', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      // id chosen so the emitted mirror feature name trips the fake
      // session's own 'fail' marker on mirrored() (see makeFakeSession above).
      { id: 'fail', kind: 'mirror', target: 'box1', plane: 'yz' },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('fail'));
  assert.match(result.refusals.get('fail'), /did not work/);
  assert.equal(result.shapes.get('fail'), result.shapes.get('box1'));
});

test('sketch -> extrude: pad targets the translated sketch object', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
      { id: 'pull1', kind: 'extrude', target: 'sk1', height: 12 },
    ],
  };
  const result = adapter.build(doc);
  const skEntry = result.shapes.get('sk1');
  const padCall = session.calls.find((c) => c.name === 'pad');
  assert.equal(padCall.args[1], skEntry.objName);
  assert.equal(padCall.args[3], 12);
  assert.equal(result.shapes.get('pull1').kind, 'solid');
});

test('sketch -> pocket cuts into the same body as its target', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    ],
  };
  // Build the box first to get its real body name, then extend the doc with
  // a pocket targeting a sketch in that SAME body -- mirroring how a real
  // pocket in this app always targets a face-attached sketch on an existing
  // solid; sketchNewOnFace itself is out of this phase's scope, so this
  // fixture instead pins the pocket's `into` at the box's own body by
  // constructing the sketch feature directly (v1 plane 'xy' only).
  const built1 = adapter.build(doc);
  const boxBody = built1.shapes.get('box1').bodyName;

  const doc2 = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[5, 5], [15, 5], [15, 15], [5, 15]] },
      { id: 'p1', kind: 'pocket', target: 'sk1', into: 'box1', depth: 5 },
    ],
  };
  assert.throws(
    () => adapter.build(doc2),
    /pocket p1 cuts across two different bodies/,
    'v1 has no combine, so a pocket whose sketch landed in its OWN fresh body (not on-a-face of the target) correctly refuses rather than guessing',
  );
});

test('cone, torus, prism build via the proven PartDesign primitive paths', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'c1', kind: 'cone', radius: 5, height: 10, center: [0, 0, 0] },
      { id: 't1', kind: 'torus', ringRadius: 10, tubeRadius: 2, center: [30, 0, 0] },
      { id: 'p1', kind: 'prism', sides: 8, radius: 6, height: 15, center: [0, 30, 0] },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.shapes.get('c1'));
  assert.ok(result.shapes.get('t1'));
  assert.ok(result.shapes.get('p1'));

  const coneCall = session.calls.find((c) => c.name === 'cone');
  assert.deepEqual(coneCall.args.slice(2), [5, 0, 10], 'radius1=f.radius, radius2=0 (tapers to a point), height');

  const torusCall = session.calls.find((c) => c.name === 'torus');
  assert.deepEqual(torusCall.args.slice(2), [10, 2]);

  const prismCall = session.calls.find((c) => c.name === 'prism');
  assert.deepEqual(prismCall.args.slice(2), [6, 15, 8], 'radius, height, sides all pass through');
});

test('prism sides clamps to the 3..12 range, same bound occt-build.ts uses', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  adapter.build({ version: 1, features: [{ id: 'p1', kind: 'prism', sides: 40, radius: 6, height: 15, center: [0, 0, 0] }] });
  const prismCall = session.calls.find((c) => c.name === 'prism');
  assert.equal(prismCall.args[4], 12);
});

test('pattern: linear along a single world axis -- Length is signed step*(count-1), axis auto-detected', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
      { id: 'pat1', kind: 'pattern', target: 'box1', mode: 'linear', count: 3, step: [20, 0, 0] },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined);
  const call = session.calls.find((c) => c.name === 'linearPattern');
  const boxBody = result.shapes.get('box1').bodyName;
  assert.equal(call.args[0], boxBody);
  assert.equal(call.args[2], 3, 'count passes through as Occurrences');
  assert.equal(call.args[3], 40, 'Length = step(20) * (count(3) - 1)');
  assert.equal(call.args[4], 'x');
  assert.equal(call.args[5], 'pat1_pattern', 'a per-feature-id name, not the emitter default');
  assert.notEqual(result.shapes.get('pat1').objName, result.shapes.get('box1').objName);
});

test('pattern: circular around z OR a non-z axis builds on a non-primitive (sketch/extrude) chain -- CLOSED (SPEC-coord-fix.md gap 2), both pass a world-frame worldAxis instead of the bare axis string', () => {
  // A sketch->extrude chain never calls setBodyPlacement(), so Body.Placement
  // stays identity and body-local IS world for it.
  for (const [axis, direction] of [['z', [0, 0, 1]], ['x', [1, 0, 0]]]) {
    const session = makeFakeSession();
    const adapter = makeAdapter(session);
    const doc = {
      version: 1,
      features: [
        { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[25, -5], [35, -5], [35, 5], [25, 5]] },
        { id: 'ext1', kind: 'extrude', target: 'sk1', height: 10 },
        { id: 'pat1', kind: 'pattern', target: 'ext1', mode: 'circular', count: 6, axis, totalAngle: 360 },
      ],
    };
    const result = adapter.build(doc);
    assert.equal(result.refusals, undefined, `axis '${axis}': ${result.refusals?.get('pat1')}`);
    const call = session.calls.find((c) => c.name === 'polarPattern');
    assert.equal(call.args[2], 6, `axis '${axis}'`);
    assert.equal(call.args[3], 360, `axis '${axis}'`);
    assert.equal(call.args[4], axis);
    assert.deepEqual(call.args[6], { origin: [0, 0, 0], direction }, `axis '${axis}'`);
  }
});

test('pattern: circular on a primitive target (box, cylinder, sphere, cone, torus, or prism) now builds -- CLOSED (SPEC-coord-fix.md gap 3), the world-frame axis proxy no longer sits at the same body-local origin as the primitive', () => {
  for (const feature of [
    { id: 'box1', kind: 'box', size: [10, 10, 10], center: [30, 0, 0] },
    { id: 'cyl1', kind: 'cylinder', radius: 5, height: 10, center: [30, 0, 0] },
    { id: 'sph1', kind: 'sphere', radius: 5, center: [30, 0, 0] },
  ]) {
    const session = makeFakeSession();
    const adapter = makeAdapter(session);
    const doc = {
      version: 1,
      features: [
        feature,
        { id: 'pat1', kind: 'pattern', target: feature.id, mode: 'circular', count: 4, axis: 'z', totalAngle: 360 },
      ],
    };
    const result = adapter.build(doc);
    assert.equal(result.refusals, undefined, `${feature.kind}: ${result.refusals?.get('pat1')}`);
    const call = session.calls.find((c) => c.name === 'polarPattern');
    assert.ok(call, `${feature.kind} must call polarPattern`);
    assert.deepEqual(call.args[6], { origin: [0, 0, 0], direction: [0, 0, 1] }, feature.kind);
  }
});

test('pattern: a rotated target now builds -- CLOSED (SPEC-coord-fix.md gap 1), the world-frame axis proxy does not co-rotate with the body', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0], rotate: [0, 0, 30] },
      { id: 'pat1', kind: 'pattern', target: 'box1', mode: 'linear', count: 3, step: [20, 0, 0] },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('pat1'));
  const call = session.calls.find((c) => c.name === 'linearPattern');
  assert.ok(call, 'linearPattern must be called');
  assert.deepEqual(call.args[6], { origin: [0, 0, 0], direction: [1, 0, 0] });
});

test('pattern: a diagonal step (more than one nonzero axis) refuses rather than guessing a direction', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
      { id: 'pat1', kind: 'pattern', target: 'box1', mode: 'linear', count: 3, step: [20, 20, 0] },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals?.get('pat1')?.includes('more than'), result.refusals?.get('pat1'));
});

test('pattern: count < 1 refuses, matching occt-build.ts\'s own guard', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
      { id: 'pat1', kind: 'pattern', target: 'box1', mode: 'linear', count: 0, step: [20, 0, 0] },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals?.get('pat1')?.includes('needs at least one copy'));
});

test('unsupported feature kinds throw a clear, named error', () => {
  for (const feature of [
    { id: 'w1', kind: 'wedge', width: 30, depth: 20, height: 25, center: [0, 0, 0] },
  ]) {
    const session = makeFakeSession();
    const adapter = makeAdapter(session);
    assert.throws(
      () => adapter.build({ version: 1, features: [feature] }),
      new RegExp(`not yet supported on the FreeCAD engine: ${feature.kind}`),
    );
  }
});

test('revolve now builds -- CLOSED (SPEC-coord-fix.md), profile sketch attached to the Body\'s own XZ_Plane origin datum via sketchNewOnOrigin instead of throwing', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[5, 0], [15, 0], [10, 10]] },
      { id: 'rev1', kind: 'revolve', target: 'sk1', angle: 360 },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('rev1'));
  const onOrigin = session.calls.find((c) => c.name === 'sketchNewOnOrigin');
  assert.ok(onOrigin, 'sketchNewOnOrigin must be called');
  assert.equal(onOrigin.args[2], 'XZ_Plane');
  const rev = session.calls.find((c) => c.name === 'revolve');
  assert.ok(rev, 'session.revolve must be called');
  assert.equal(rev.args[3], 360);
  assert.equal(result.shapes.get('rev1').objName, rev.args[2]);
});

test('revolve refuses cleanly when the profile crosses the spin axis, rather than building the self-intersecting solid occt-build.ts would', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[-5, 0], [15, 0], [10, 10]] },
      { id: 'rev1', kind: 'revolve', target: 'sk1', angle: 360 },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals?.get('rev1')?.includes('crosses the'), result.refusals?.get('rev1'));
  assert.equal(result.shapes.get('rev1'), result.shapes.get('sk1'));
  assert.equal(session.calls.find((c) => c.name === 'revolve'), undefined);
});

test('groove now builds when target and into share a body -- CLOSED (SPEC-coord-fix.md)', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [20, 0], [20, 20], [0, 20]] },
      { id: 'base1', kind: 'extrude', target: 'sk1', height: 5 },
      { id: 'grv1', kind: 'groove', target: 'sk1', into: 'base1', angle: 360 },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('grv1'));
  const grv = session.calls.find((c) => c.name === 'groove');
  assert.ok(grv, 'session.groove must be called');
  assert.equal(grv.args[3], 360);
});

test('groove across two different bodies still throws -- unrelated pre-existing constraint (no combine yet), same as pocket', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[5, 5], [15, 5], [15, 15], [5, 15]] },
      { id: 'grv1', kind: 'groove', target: 'sk1', into: 'box1', angle: 360 },
    ],
  };
  assert.throws(
    () => adapter.build(doc),
    /groove grv1 cuts across two different bodies/,
  );
});

test('sketch on a non-xy plane or nonzero offset refuses rather than building the wrong plane', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  assert.throws(
    () => adapter.build({
      version: 1,
      features: [{ id: 'sk1', kind: 'sketch', plane: 'xz', offset: 0, points: [[0, 0], [1, 0], [1, 1]] }],
    }),
    /plane 'xz'/,
  );
});

test('move: copy=false translates the target in place, reusing the same bodyName/objName', () => {
  const session = makeFakeSession({ bodyTip: { Body1: 'box1_pad' } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'mv1', kind: 'move', target: 'box1', offset: [20, 0, 0], copy: false },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('mv1'));
  const moveCall = session.calls.find((c) => c.name === 'moveBody');
  assert.ok(moveCall, 'session.moveBody must be called');
  assert.equal(moveCall.args[0], 'Body1');
  assert.deepEqual(moveCall.args[1], [20, 0, 0]);
  assert.equal(session.calls.find((c) => c.name === 'copyBodyMoved'), undefined, 'copy=false must never call copyBodyMoved');
  const mvEntry = result.shapes.get('mv1');
  const boxEntry = result.shapes.get('box1');
  assert.equal(mvEntry.bodyName, boxEntry.bodyName, 'in-place move keeps the SAME bodyName as its target');
  assert.equal(mvEntry.objName, boxEntry.objName, 'in-place move keeps the SAME objName as its target');
});

test('move: copy=true duplicates the body, gets a NEW bodyName/objName, and leaves the target shape entry untouched', () => {
  const session = makeFakeSession({ bodyTip: { Body1: 'box1_pad' } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'mv1', kind: 'move', target: 'box1', offset: [60, 0, 0], copy: true },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('mv1'));
  const copyCall = session.calls.find((c) => c.name === 'copyBodyMoved');
  assert.ok(copyCall, 'session.copyBodyMoved must be called');
  assert.equal(copyCall.args[0], 'Body1');
  assert.deepEqual(copyCall.args[1], [60, 0, 0]);
  assert.equal(session.calls.find((c) => c.name === 'moveBody'), undefined, 'copy=true must never call moveBody');
  const mvEntry = result.shapes.get('mv1');
  const boxEntry = result.shapes.get('box1');
  assert.equal(mvEntry.bodyName, 'Body1_copy', 'the copy gets the kernel-reported NEW bodyName, never a guessed suffix');
  assert.equal(mvEntry.objName, 'Body1_copy_pad', 'the copy gets the kernel-reported NEW objName');
  assert.notEqual(mvEntry.bodyName, boxEntry.bodyName, 'the copy must not reuse the target\'s own body');
  assert.equal(boxEntry.bodyName, 'Body1', 'the original target\'s own shape entry is untouched');
});

test('move: a target with something already built on top (Body.Tip mismatch) refuses rather than silently moving it too', () => {
  // Body.Tip is 'Fillet', not box1's own 'box1_pad' -- something (a fillet)
  // was already built on top of box1 in the same body, so moving box1
  // would move that fillet too.
  const session = makeFakeSession({ bodyTip: { Body1: 'Fillet' } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'mv1', kind: 'move', target: 'box1', offset: [20, 0, 0], copy: false },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('mv1'));
  assert.match(result.refusals.get('mv1'), /would also move/);
  assert.equal(result.shapes.get('mv1'), result.shapes.get('box1'), 'refused move falls back to its target shape');
  assert.equal(session.calls.find((c) => c.name === 'moveBody'), undefined, 'the kernel must never be asked to move once the tip mismatch already refused');
  assert.equal(session.calls.find((c) => c.name === 'copyBodyMoved'), undefined);
});

test('move: copy=true with a zero offset refuses before ever touching the kernel', () => {
  const session = makeFakeSession({ bodyTip: { Body1: 'box1_pad' } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'mv1', kind: 'move', target: 'box1', offset: [0, 0, 0], copy: true },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('mv1'), /somewhere to go/);
  assert.equal(result.shapes.get('mv1'), result.shapes.get('box1'));
  assert.equal(session.calls.find((c) => c.name === 'copyBodyMoved'), undefined, 'the kernel must never be called for a zero-offset copy');
});

test('move: the FreeCAD kernel itself refusing the move (copy=false) lands in refusals, not a throw', () => {
  const session = makeFakeSession({ bodyTip: { Body1: 'box1_pad' } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'mv1', kind: 'move', target: 'box1', offset: [99999, 0, 0], copy: false },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('mv1'));
  assert.match(result.refusals.get('mv1'), /did not work/);
  assert.equal(result.shapes.get('mv1'), result.shapes.get('box1'));
});

test('move: the FreeCAD kernel itself refusing the copy (copy=true) lands in refusals, not a throw', () => {
  const session = makeFakeSession({ bodyTip: { Body1: 'box1_pad' } });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'mv1', kind: 'move', target: 'box1', offset: [99999, 0, 0], copy: true },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('mv1'));
  assert.match(result.refusals.get('mv1'), /did not work/);
});

// -----------------------------------------------------------------------
// combine -- Part::Fuse/Cut/Common across two finished Body shapes, folded
// pairwise in ModelDoc order. See freecad-engine-adapter.ts's own 'combine'
// branch comment and fc-commands.mjs's partBoolean() header for the design
// (PartDesign::Boolean was probed and rejected for a coordinate-frame bug;
// Part::Fuse/Cut/Common reads both bodies' world placements directly).
// -----------------------------------------------------------------------

test('combine: union of two solids calls partBoolean once, base/tool = the two bodyNames', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'box2', kind: 'box', size: [40, 40, 20], center: [20, 0, 0] },
      { id: 'c1', kind: 'combine', op: 'union', targets: ['box1', 'box2'] },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('c1'));

  const box1Body = result.shapes.get('box1').bodyName;
  const box2Body = result.shapes.get('box2').bodyName;
  const pb = session.calls.filter((c) => c.name === 'partBoolean');
  assert.equal(pb.length, 1);
  assert.deepEqual(pb[0].args, ['union', box1Body, box2Body, 'c1_op1']);

  const entry = result.shapes.get('c1');
  assert.equal(entry.bodyName, 'c1_op1');
  assert.equal(entry.objName, 'c1_op1', 'combine result: bodyName === objName -- a document-level Part:: object, not a Body');
  assert.equal(entry.container, 'part');
  assert.equal(entry.kind, 'solid');
});

test('combine: subtract folds pairwise across 3 targets, the FIRST target is the body being cut', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'box2', kind: 'box', size: [10, 10, 10], center: [10, 0, 0] },
      { id: 'box3', kind: 'box', size: [10, 10, 10], center: [-10, 0, 0] },
      { id: 'c1', kind: 'combine', op: 'subtract', targets: ['box1', 'box2', 'box3'] },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('c1'));

  const b1 = result.shapes.get('box1').bodyName;
  const b2 = result.shapes.get('box2').bodyName;
  const b3 = result.shapes.get('box3').bodyName;
  const pb = session.calls.filter((c) => c.name === 'partBoolean');
  assert.equal(pb.length, 2, 'two pairwise ops for three targets, a loop not a reduce');
  assert.deepEqual(pb[0].args, ['subtract', b1, b2, 'c1_op1'], 'first op cuts target[0] (the body) by target[1]');
  assert.deepEqual(pb[1].args, ['subtract', 'c1_op1', b3, 'c1_op2'], 'second op chains off the FIRST result, not off box1 again');

  const entry = result.shapes.get('c1');
  assert.equal(entry.objName, 'c1_op2', 'the final entry is the LAST pairwise result');
});

test('combine: fewer than two solid targets refuses cleanly, falling back to the one live target', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'c1', kind: 'combine', op: 'union', targets: ['box1'] },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('c1'));
  assert.match(result.refusals.get('c1'), /needs two solid shapes/);
  assert.equal(result.shapes.get('c1'), result.shapes.get('box1'));
  assert.equal(session.calls.filter((c) => c.name === 'partBoolean').length, 0, 'never reaches the kernel with < 2 targets');
});

test('combine: the FreeCAD kernel itself refusing the boolean (e.g. disjoint shapes) lands in refusals, not a throw', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'box2', kind: 'box', size: [40, 40, 20], center: [1000, 0, 0] },
      // id chosen so the mock's own failure trigger (resultName containing
      // 'fail') fires -- see makeFakeSession's own partBoolean comment.
      { id: 'combofail', kind: 'combine', op: 'intersect', targets: ['box1', 'box2'] },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('combofail'));
  assert.match(result.refusals.get('combofail'), /left nothing behind/);
  assert.equal(result.shapes.get('combofail'), result.shapes.get('box1'), 'falls back to the FIRST live target, not the second');
});

test('combine result: container "part" gates every PartDesign-building branch via notInABody -- fillet, pattern, shell, draft, mirror, pocket, groove all refuse before touching the kernel', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const baseDoc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'box2', kind: 'box', size: [40, 40, 20], center: [20, 0, 0] },
      { id: 'c1', kind: 'combine', op: 'union', targets: ['box1', 'box2'] },
    ],
  };

  const cases = [
    { id: 'r1', kind: 'fillet', target: 'c1', edge: betweenBox('c1', '+x', '+z'), size: 3, style: 'fillet' },
    { id: 'p1', kind: 'pattern', target: 'c1', mode: 'linear', count: 3, step: [10, 0, 0] },
    { id: 's1', kind: 'shell', target: 'c1', thickness: 2 },
    { id: 'd1', kind: 'draft', target: 'c1', whole: false, pull: 'z', face: boxNamed('c1', '+x'), angle: 5, neutral: 0 },
    { id: 'm1', kind: 'mirror', target: 'c1', plane: 'yz' },
  ];
  for (const feature of cases) {
    const result = adapter.build({ version: 1, features: [...baseDoc.features, feature] });
    const why = result.refusals?.get(feature.id);
    assert.ok(why, `${feature.kind} on a combine result must refuse, got: ${JSON.stringify([...(result.refusals ?? [])])}`);
    assert.match(why, /works inside a PartDesign Body/, `${feature.kind}'s refusal message`);
    assert.equal(
      session.calls.filter((c) => c.name === feature.kind).length, 0,
      `${feature.kind} must never reach the kernel once notInABody refuses`,
    );
  }

  // pocket/groove gate on `into`, not `target` -- their own `target`/`src` is
  // the cutting SKETCH, so the fixture needs a real sketch feature too.
  const sketchFeature = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[5, 5], [15, 5], [15, 15], [5, 15]] };

  const pocketResult = adapter.build({
    version: 1,
    features: [...baseDoc.features, sketchFeature, { id: 'pk1', kind: 'pocket', target: 'sk1', into: 'c1', depth: 5 }],
  });
  const pocketWhy = pocketResult.refusals?.get('pk1');
  assert.ok(pocketWhy, 'pocket into a combine result must refuse');
  assert.match(pocketWhy, /works inside a PartDesign Body/);
  assert.equal(session.calls.filter((c) => c.name === 'pocket').length, 0);

  const grooveResult = adapter.build({
    version: 1,
    features: [...baseDoc.features, sketchFeature, { id: 'gr1', kind: 'groove', target: 'sk1', into: 'c1', angle: 360 }],
  });
  const grooveWhy = grooveResult.refusals?.get('gr1');
  assert.ok(grooveWhy, 'groove into a combine result must refuse');
  assert.match(grooveWhy, /works inside a PartDesign Body/);
  assert.equal(session.calls.filter((c) => c.name === 'groove').length, 0);
});

// -----------------------------------------------------------------------
// hole (docs/specs/SPEC-hole.md) -- ONE PartDesign::Pocket per drill plane,
// cut from an unattached, world-positioned circle-profile sketch
// (fc-commands.mjs's bore()). See freecad-engine-adapter.ts's own 'hole'
// branch comment for why this is NOT a Part::Cut (would set container:'part'
// and break the app's own documented flagship chain) and NOT
// PartDesign::Hole (three silent-wrong-answer bugs measured against this
// kernel). Real-kernel volume/bbox/isInside verification lives in
// packages/kernel/test/freecad-hole.manual.mjs; this file only covers
// build()'s own orchestration, same split as every other feature above.
// -----------------------------------------------------------------------

test('hole: default (no corners) calls bore() once with a single-centre group and no `container` field', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'h1', kind: 'hole', target: 'box1', diameter: 6, depth: 22, center: [0, 0, 0], axis: 'z' },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('h1'));

  const boreCalls = session.calls.filter((c) => c.name === 'bore');
  assert.equal(boreCalls.length, 1, 'one drill plane -> one bore() call');
  const [bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth] = boreCalls[0].args;
  assert.equal(bodyName, result.shapes.get('box1').bodyName);
  assert.equal(radius, 3, 'radius = diameter/2');
  assert.deepEqual(worldCenters, [[0, 0, 0]], 'target bbox centred at world origin + f.center offset of zero');
  assert.deepEqual(worldOrigin, [0, 0, 0]);
  assert.deepEqual(worldAxis, [0, 0, 1], "axis 'z' -> world Z");
  assert.equal(depth, 22);
  assert.ok(sketchName.startsWith('h1_boresk'));
  assert.ok(pocketName.startsWith('h1_bore'));

  const entry = result.shapes.get('h1');
  assert.equal(entry.container, undefined, 'no `container` field -- stays in the Body, unlike combine');
  assert.equal(entry.bodyName, result.shapes.get('box1').bodyName, 'built in the target\'s own body');
  assert.equal(entry.objName, pocketName, 'the LAST pocket name becomes the entry\'s objName (the body\'s new Tip)');
  assert.notEqual(entry.objName, result.shapes.get('box1').objName, 'a built hole gets its own shape entry');
});

test("hole: axis 'x' passes world X as the drill axis and checks fit against the y/z cross-section", () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'h1', kind: 'hole', target: 'box1', diameter: 6, depth: 50, center: [0, 0, 0], axis: 'x' },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('h1'));
  const call = session.calls.find((c) => c.name === 'bore');
  assert.deepEqual(call.args[6], [1, 0, 0], "axis 'x' -> world X");
});

test('hole: corners {dx,dy} -- ONE bore() call with FOUR centres in one group, not four chained calls', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'h1', kind: 'hole', target: 'box1', diameter: 6, depth: 22, center: [0, 0, 0], axis: 'z', corners: { dx: 15, dy: 10 } },
    ],
  };
  const result = adapter.build(doc);
  assert.equal(result.refusals, undefined, result.refusals?.get('h1'));
  const boreCalls = session.calls.filter((c) => c.name === 'bore');
  assert.equal(boreCalls.length, 1, 'all four corners share the same z-plane -- one sketch, one Pocket');
  assert.deepEqual(
    boreCalls[0].args[4],
    [[-15, -10, 0], [15, -10, 0], [-15, 10, 0], [15, 10, 0]],
    'four centres, verbatim from occt-build.ts\'s own corner ordering',
  );
});

test('hole: diameter <= 0 or depth <= 0 refuses before ever touching the kernel', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const docD = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'h1', kind: 'hole', target: 'box1', diameter: 0, depth: 22, center: [0, 0, 0], axis: 'z' },
    ],
  };
  const resultD = adapter.build(docD);
  assert.match(resultD.refusals.get('h1'), /diameter and depth must both be greater than zero/);
  assert.equal(session.calls.find((c) => c.name === 'bore'), undefined, 'the kernel must never be called once diameter<=0 already refused');
  assert.equal(session.calls.find((c) => c.name === 'read'), undefined, 'not even the bbox read should run');

  const session2 = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter2 = makeAdapter(session2);
  const docZ = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'h1', kind: 'hole', target: 'box1', diameter: 6, depth: 0, center: [0, 0, 0], axis: 'z' },
    ],
  };
  const resultZ = adapter2.build(docZ);
  assert.match(resultZ.refusals.get('h1'), /diameter and depth must both be greater than zero/);
});

test('hole: a diameter too large for the target\'s cross-section refuses with occt-build.ts\'s own "would not fit" wording', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-5, -5, -10], [5, 5, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 20], center: [0, 0, 0] },
      { id: 'h1', kind: 'hole', target: 'box1', diameter: 20, depth: 22, center: [0, 0, 0], axis: 'z' },
    ],
  };
  const result = adapter.build(doc);
  assert.match(result.refusals.get('h1'), /would not fit/);
  assert.equal(result.shapes.get('h1'), result.shapes.get('box1'), 'refused hole falls back to its target shape');
  assert.equal(session.calls.find((c) => c.name === 'bore'), undefined, 'the kernel must never be called once the fit check already refused');
});

test('hole: notInABody gates a hole targeting a combine result, matching fillet/pattern/shell/draft/mirror', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'box2', kind: 'box', size: [40, 40, 20], center: [20, 0, 0] },
      { id: 'c1', kind: 'combine', op: 'union', targets: ['box1', 'box2'] },
      { id: 'h1', kind: 'hole', target: 'c1', diameter: 6, depth: 10, center: [0, 0, 0], axis: 'z' },
    ],
  };
  const result = adapter.build(doc);
  const why = result.refusals?.get('h1');
  assert.ok(why, 'hole on a combine result must refuse');
  assert.match(why, /works inside a PartDesign Body/);
  assert.equal(result.shapes.get('h1'), result.shapes.get('c1'), 'refused hole falls back to the combine\'s own shape');
  assert.equal(session.calls.find((c) => c.name === 'bore'), undefined, 'the kernel must never be called once notInABody already refused');
});

test('hole: the FreeCAD kernel itself refusing the bore lands in refusals, not a throw', () => {
  const session = makeFakeSession({ edgeReads: bodyWorldBbox([-20, -20, -10], [20, 20, 10]) });
  const adapter = makeAdapter(session);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      // id chosen so the emitted pocket name trips the fake session's own
      // 'fail' marker on bore() (see makeFakeSession's own bore comment).
      { id: 'boreholefail', kind: 'hole', target: 'box1', diameter: 6, depth: 22, center: [0, 0, 0], axis: 'z' },
    ],
  };
  const result = adapter.build(doc);
  assert.ok(result.refusals && result.refusals.get('boreholefail'));
  assert.match(result.refusals.get('boreholefail'), /did not work/);
  assert.equal(result.shapes.get('boreholefail'), result.shapes.get('box1'));
});
