// Picking self-check: resolveFace/resolveEdge/nameFace/nameEdge/faceSize/
// edgeLength ORCHESTRATION against a fake session -- does each method send
// the query for the RIGHT object (the picked feature's own CURRENT shape,
// not a frozen historical one), walk the primitive-ancestor chain
// correctly, and return an honest null rather than a guess when a name or
// element cannot be resolved. Like freecad-engine-adapter-build.test.mjs,
// this does NOT prove the geometry is right -- that needs the real kernel
// (see this port's own manual/real-kernel verification).
//
// Against ../dist/ -- TypeScript source, same convention as the build test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FreeCadEngineAdapter } from '../dist/freecad-engine-adapter.js';

/** `reads` maps a recognisable substring of the generated Python to a canned
 *  JSON response -- the same discipline freecad-engine-adapter-build.test.mjs's
 *  own makeFakeSession(edgeReads) already uses. */
function makeFakeSession({ reads = {} } = {}) {
  const calls = [];
  const record = (name, args) => { calls.push({ name, args }); };
  return {
    calls,
    exec(code) { record('exec', [code]); return { rc: 0, out: '' }; },
    read(code) {
      record('read', [code]);
      for (const [needle, response] of Object.entries(reads)) {
        if (code.includes(needle)) return response;
      }
      return {};
    },
  };
}

function makeAdapter(session) {
  const adapter = new FreeCadEngineAdapter(THREE, async () => ({}));
  adapter['session'] = session;
  return adapter;
}

const boxFace = (id, part) => ({ cause: 'primitive', feature: id, kind: 'face', part });
const betweenBox = (id, a, b) => ({ cause: 'between', feature: id, kind: 'edge', of: [boxFace(id, a), boxFace(id, b)] });

const box1 = { bodyName: 'Body1', objName: 'box1_pad', kind: 'solid', featureId: 'box1', featureKind: 'box' };
const fillet1 = { bodyName: 'Body1', objName: 'r1_result', kind: 'solid', featureId: 'r1', featureKind: 'fillet' };
const extrude1 = { bodyName: 'Body2', objName: 'e1_pad', kind: 'solid', featureId: 'e1', featureKind: 'extrude' };

function buildOf(entries) {
  return { shapes: new Map(entries.map((e) => [e.featureId, e])) };
}

test('resolveFace: a primitive name resolves to an FcElementRef on its own built object', () => {
  const session = makeFakeSession({ reads: { 'doc.getObject("box1_pad")': { parts: { '+z': 'Face1', '+x': 'Face3' } } } });
  const adapter = makeAdapter(session);
  const build = buildOf([box1]);

  const ref = adapter.resolveFace(boxFace('box1', '+z'), build);
  assert.deepEqual(ref, { objName: 'box1_pad', name: 'Face1' });

  assert.equal(adapter.resolveFace(boxFace('box1', '-y'), build), null, 'a part with no entry in the parts map is an honest null');
});

test('resolveFace: non-primitive causes and non-box/cylinder targets are honest nulls, never a throw', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const build = buildOf([box1, extrude1]);

  assert.equal(adapter.resolveFace({ cause: 'made', feature: 'box1', kind: 'face', at: { u: 0, v: 0 } }, build), null);
  assert.equal(adapter.resolveFace(boxFace('e1', 'side'), build), null, 'extrude is not box/cylinder');
  assert.equal(adapter.resolveFace(boxFace('missing', '+z'), build), null, 'unbuilt feature id');
  assert.equal(session.calls.filter((c) => c.name === 'read').length, 0, 'none of these should even reach the kernel');
});

test('resolveEdge: a between-primitive-faces name resolves via the existing edge resolver, wrapped with objName', () => {
  const session = makeFakeSession({ reads: { 'fa = _resolve_face("+x")': { edge: 'Edge7' } } });
  const adapter = makeAdapter(session);
  const build = buildOf([box1]);

  const ref = adapter.resolveEdge(betweenBox('box1', '+x', '+z'), build);
  assert.deepEqual(ref, { objName: 'box1_pad', name: 'Edge7' });
});

test('resolveEdge: mismatched or non-primitive face pair is an honest null', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const build = buildOf([box1]);
  assert.equal(adapter.resolveEdge(betweenBox('box1', '+x', '+z'), buildOf([])), null, 'target not built');
  const mixedPair = { cause: 'between', feature: 'box1', kind: 'edge', of: [boxFace('box1', '+x'), { cause: 'made', feature: 'box1', kind: 'face', at: { u: 0, v: 0 } }] };
  assert.equal(adapter.resolveEdge(mixedPair, build), null);
});

test('nameFace: resolves a clicked face on the primitive\'s OWN shape to its part', () => {
  const session = makeFakeSession({ reads: { 'doc.getObject("box1_pad")': { parts: { '+z': 'Face1', '-x': 'Face5' } } } });
  const adapter = makeAdapter(session);
  const build = buildOf([box1]);
  const doc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] }] };

  const name = adapter.nameFace(build, doc, 'box1', { objName: 'box1_pad', name: 'Face1' });
  assert.deepEqual(name, { cause: 'primitive', feature: 'box1', kind: 'face', part: '+z' });

  assert.equal(
    adapter.nameFace(build, doc, 'box1', { objName: 'box1_pad', name: 'Face99' }),
    null,
    'a face that matched no part\'s current winner is an honest null',
  );
});

test('nameFace: walks a fillet chain back to its box ancestor, and queries the FILLET\'s own CURRENT shape (not the box\'s frozen one)', () => {
  const session = makeFakeSession({ reads: { 'doc.getObject("r1_result")': { parts: { '+z': 'Face2' } } } });
  const adapter = makeAdapter(session);
  const build = buildOf([box1, fillet1]);
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
      { id: 'r1', kind: 'fillet', target: 'box1', edge: betweenBox('box1', '+x', '+z'), size: 1, style: 'fillet' },
    ],
  };

  const name = adapter.nameFace(build, doc, 'r1', { objName: 'r1_result', name: 'Face2' });
  assert.deepEqual(name, { cause: 'primitive', feature: 'box1', kind: 'face', part: '+z' }, 'name is rooted at the box, not the fillet');

  const geomCall = session.calls.find((c) => c.name === 'read' && c.args[0].includes('doc.getObject'));
  assert.match(geomCall.args[0], /doc\.getObject\("r1_result"\)/, 'geometry was queried against the fillet\'s own current object');
});

test('nameFace: a chain with no box/cylinder ancestor (a sketch/extrude chain) is an honest null, no kernel call', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const build = buildOf([extrude1]);
  const doc = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 5 },
    ],
  };
  assert.equal(adapter.nameFace(build, doc, 'e1', { objName: 'e1_pad', name: 'Face1' }), null);
  assert.equal(session.calls.filter((c) => c.name === 'read').length, 0, 'swept/cap faces have no resolver to guess with -- see this file\'s own header');
});

test('nameEdge: both adjacent faces resolve -> a between name; fewer/more than 2 adjacent is an honest null', () => {
  const session = makeFakeSession({
    reads: {
      'eidx = 6': { parts: { '+x': 'Face3', '+z': 'Face1' }, adjacent: ['Face3', 'Face1'] },
    },
  });
  const adapter = makeAdapter(session);
  const build = buildOf([box1]);
  const doc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] }] };

  const name = adapter.nameEdge(build, doc, 'box1', { objName: 'box1_pad', name: 'Edge7' });
  assert.deepEqual(name, { cause: 'between', feature: 'box1', kind: 'edge', of: [boxFace('box1', '+x'), boxFace('box1', '+z')] });

  const session2 = makeFakeSession({ reads: { 'eidx = 6': { parts: {}, adjacent: ['Face3'] } } });
  const adapter2 = makeAdapter(session2);
  assert.equal(adapter2.nameEdge(build, doc, 'box1', { objName: 'box1_pad', name: 'Edge7' }), null, 'only one adjacent face found -- refuse, do not guess the other');
});

test('nameEdge: a malformed edge name is an honest null', () => {
  const session = makeFakeSession();
  const adapter = makeAdapter(session);
  const build = buildOf([box1]);
  const doc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] }] };
  assert.equal(adapter.nameEdge(build, doc, 'box1', { objName: 'box1_pad', name: 'NotAnEdge' }), null);
});

test('faceSize: passes through the kernel\'s computed [w,d] or null', () => {
  const session = makeFakeSession({ reads: { "getElement(\"Face1\")": { size: [40, 20] } } });
  const adapter = makeAdapter(session);
  assert.deepEqual(adapter.faceSize({ objName: 'box1_pad', name: 'Face1' }), [40, 20]);

  const sessionNull = makeFakeSession({ reads: { "getElement(\"Face2\")": { size: null } } });
  const adapterNull = makeAdapter(sessionNull);
  assert.equal(adapterNull.faceSize({ objName: 'box1_pad', name: 'Face2' }), null, 'a curved/non-axis-aligned face is an honest null');

  assert.equal(adapter.faceSize(null), null, 'a malformed handle never reaches the kernel');
});

test('edgeLength: passes through the kernel\'s computed length or null', () => {
  const session = makeFakeSession({ reads: { "getElement(\"Edge3\")": { length: 12.34 } } });
  const adapter = makeAdapter(session);
  assert.equal(adapter.edgeLength({ objName: 'box1_pad', name: 'Edge3' }), 12.34);

  const sessionNull = makeFakeSession({ reads: { "getElement(\"Edge9\")": { length: null } } });
  const adapterNull = makeAdapter(sessionNull);
  assert.equal(adapterNull.edgeLength({ objName: 'box1_pad', name: 'Edge9' }), null);
});
