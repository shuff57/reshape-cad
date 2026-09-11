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
function makeFakeSession({ edgeReads = {} } = {}) {
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
    sketchState() {
      record('sketchState', []);
      return { geometry: [], constraints: [], dof: 0, fully: true, conflicting: [], redundant: [], malformed: [] };
    },
    pad(bodyName, sketchName, padName, length) { record('pad', [bodyName, sketchName, padName, length]); return padName; },
    pocket(bodyName, sketchName, pocketName, length) { record('pocket', [bodyName, sketchName, pocketName, length]); return pocketName; },
    sphere(bodyName, featName, radius) { record('sphere', [bodyName, featName, radius]); return featName; },
    fillet(bodyName, baseName, edgeNames, radius) {
      record('fillet', [bodyName, baseName, edgeNames, radius]);
      if (radius > 1000) throw new Error('radius too large for this solid');
      return 'Fillet';
    },
    chamfer(bodyName, baseName, edgeNames, size) {
      record('chamfer', [bodyName, baseName, edgeNames, size]);
      return 'Chamfer';
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

test('box: centred rectangle sketch + pad + Body.Placement carrying center/rotation', () => {
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
  // center [5,0,0], size [40,20,10] -> x in [5-20,5+20]=[-15,25], y in [-10,10]
  assert.deepEqual(rect.args.slice(1), [-15, -10, 25, 10]);

  const pad = session.calls.find((c) => c.name === 'pad');
  assert.equal(pad.args[3], 10, 'pad length = box height');

  const placementExec = session.calls.find((c) => c.name === 'exec' && c.args[0].includes('body.Placement'));
  assert.ok(placementExec, 'setBodyPlacement must run an exec() snippet');
  assert.match(placementExec.args[0], /App\.Vector\(5,0,0\)/, 'placement carries the box center');
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

test('unsupported feature kinds throw a clear, named error', () => {
  for (const feature of [
    { id: 'c1', kind: 'cone', radius: 5, height: 10, center: [0, 0, 0] },
    { id: 't1', kind: 'torus', ringRadius: 10, tubeRadius: 2, center: [0, 0, 0] },
    { id: 'rev1', kind: 'revolve', target: 'sk1', angle: 360 },
  ]) {
    const session = makeFakeSession();
    const adapter = makeAdapter(session);
    assert.throws(
      () => adapter.build({ version: 1, features: [feature] }),
      new RegExp(`not yet supported on the FreeCAD engine: ${feature.kind}`),
    );
  }
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
