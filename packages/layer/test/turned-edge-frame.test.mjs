// A named edge on a primitive turned by quarter turns (ctx.followMoves, resolve-names.ts turnedFrameClash). The name has two readings: the
// primitive's own frame (the face parts turn with the body, what the resolver picks) and the world frame (what the OCCT and brep-rs referees pick,
// brep-adapter topo-resolve.ts resolvePrimitiveFace). HALT-4 / audit FM-1: box(30,20,20), turn z90, round(top, front) built the 30 mm edge that
// was top-front before the turn, while both referees round the 20 mm world top-front edge. Pinned here on hand-made topology (no kernel):
//   - the two readings name different edges: refused, and the student sees the existing "was turned" sentence (fc-sentences.ts);
//   - the two readings agree (a turn by a whole turn): resolved as before;
//   - the world frame names no face (a cylinder lying on its side has no world top face): its TOP rim resolves as before, in the primitive's own
//     frame; its BOTTOM rim is refused (the referees' tie-break lands on the top rim, so no second oracle confirms it; owner decision);
//   - flag off: the standing refusal of any rotated primitive, unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveName } from '../dist/index.js';
import { plainSentence } from '../dist/fc-sentences.js';

const P = (part) => ({ cause: 'primitive', feature: 'box1', kind: 'face', part });
const edge = (a, b, feature = 'box1') => ({ cause: 'between', feature, kind: 'edge', of: [{ ...P(a), feature }, { ...P(b), feature }] });
const face = (name, n, c, area = 600) => ({ index: 0, name, area, centroid: c, plane_normal: n, point: c });
const envOf = (feat, faces, edges, followTurns = true) => ({
  features: [feat],
  shapeOf: async () => ({ ok: true, bodyName: 'b_' + feat.id, featureId: feat.id, featureNumber: 1, faces: faces.map((f, i) => ({ ...f, index: i })), edges: edges.map((e, i) => ({ ...e, index: i })) }),
  sketchFrame: () => { throw new Error('no sketch'); },
  outline: () => ({ ok: false }),
  followTurns,
});
const seg = (name, a, b) => ({ name, start: a, end: b, mid: a.map((v, i) => (v + b[i]) / 2), length: Math.hypot(...a.map((v, i) => v - b[i])) });

// box(30,20,20) turned [0,0,90]: world x 20, y 30, z 20. solidcraft's labels turn with the body: F1:-y (local front) faces world +x, F1:-x faces world -y.
const BOX_Z90 = { id: 'box1', kind: 'box', size: [30, 20, 20], center: [0, 0, 0], rotate: [0, 0, 90] };
const FACES_Z90 = [
  face('F1:+z', [0, 0, 1], [0, 0, 10]), face('F1:-z', [0, 0, -1], [0, 0, -10]),
  face('F1:-y', [1, 0, 0], [10, 0, 0]), face('F1:+y', [-1, 0, 0], [-10, 0, 0]),
  face('F1:+x', [0, 1, 0], [0, 15, 0], 400), face('F1:-x', [0, -1, 0], [0, -15, 0], 400),
];
const EDGES_Z90 = [seg('F1:+z|F1:-y', [10, -15, 10], [10, 15, 10]), seg('F1:+z|F1:-x', [-10, -15, 10], [10, -15, 10])];

test('a quarter turn that makes the two readings name different edges is refused, with the existing "was turned" sentence', async () => {
  const r = await resolveName(edge('+z', '-y'), envOf(BOX_Z90, FACES_Z90, EDGES_Z90), 'edge');
  assert.equal(r.ok, false);
  assert.match(r.sentence, /F1:\+z \^ F1:-y in box1's own frame, F1:\+z \^ F1:-x in the world frame/);
  assert.equal(plainSentence(`round1 (fillet): ${r.sentence}`).sentence,
    'The part for round1 was turned, so its edge cannot be found reliably and round1 is shown without it -- round or bevel the edge before you turn the part.');
});

test('flag off: a rotated primitive keeps its standing refusal (same sentence)', async () => {
  const r = await resolveName(edge('+z', '-y'), envOf(BOX_Z90, FACES_Z90, EDGES_Z90, false), 'edge');
  assert.equal(r.ok, false);
  assert.match(r.sentence, /is rotated; this demo resolves primitive faces only on unrotated primitives \(/);
  assert.match(plainSentence(`round1 (fillet): ${r.sentence}`).sentence, /^The part for round1 was turned/);
});

test('a turn where both readings name the same edge is resolved as before', async () => {
  // a whole turn: the identity, so every part names the same face in both frames
  const feat = { ...BOX_Z90, rotate: [0, 0, 360] };
  const faces = [
    face('F1:+z', [0, 0, 1], [0, 0, 10]), face('F1:-z', [0, 0, -1], [0, 0, -10]),
    face('F1:-y', [0, -1, 0], [0, -10, 0]), face('F1:+y', [0, 1, 0], [0, 10, 0]),
    face('F1:+x', [1, 0, 0], [15, 0, 0], 400), face('F1:-x', [-1, 0, 0], [-15, 0, 0], 400),
  ];
  const r = await resolveName(edge('+z', '-y'), envOf(feat, faces, [seg('F1:+z|F1:-y', [-15, -10, 10], [15, -10, 10])]), 'edge');
  assert.equal(r.ok, true, r.sentence);
  assert.deepEqual(r.evidence.engineEdges, ['F1:+z|F1:-y']);
  assert.equal(r.length, 30);
});

test('a cylinder lying on its side (no world top face) is resolved in its own frame, as before', async () => {
  // cylinder(r 10, h 20) turned [90,0,0]: local +z (top) faces world -y; no planar face faces world +z
  const feat = { id: 'box1', kind: 'cylinder', radius: 10, height: 20, center: [0, 0, 0], rotate: [90, 0, 0] };
  const faces = [
    face('F1:top', [0, -1, 0], [0, -10, 0], 314.16), face('F1:bottom', [0, 1, 0], [0, 10, 0], 314.16),
    { name: 'F1:side#0', area: 628.3, centroid: [0, 0, 6.4], plane_normal: null }, { name: 'F1:side#1', area: 628.3, centroid: [0, 0, -6.4], plane_normal: null },
  ];
  const edges = [
    { name: 'F1:side#0|F1:top', start: [10, -10, 0], mid: [0, -10, 10], end: [-10, -10, 0], length: 31.4159 },
    { name: 'F1:side#1|F1:top', start: [-10, -10, 0], mid: [0, -10, -10], end: [10, -10, 0], length: 31.4159 },
  ];
  const r = await resolveName(edge('+z', 'side'), envOf(feat, faces, edges), 'edge');
  assert.equal(r.ok, true, r.sentence);
  assert.deepEqual(r.evidence.engineEdges.sort(), ['F1:side#0|F1:top', 'F1:side#1|F1:top']);
});

test('the BOTTOM rim of a cylinder lying on its side is refused (no second oracle), with the existing "was turned" sentence', async () => {
  // same cylinder turned [90,0,0]: local -z (bottom) faces world +y. The referees' world-frame lookup ties and lands on the top rim, so nothing
  // confirms the bottom-rim build: refused (owner decision, audit FM-1). The top rim, where the tie-break lands on the same rim, builds (test above).
  const feat = { id: 'box1', kind: 'cylinder', radius: 10, height: 20, center: [0, 0, 0], rotate: [90, 0, 0] };
  const faces = [
    face('F1:top', [0, -1, 0], [0, -10, 0], 314.16), face('F1:bottom', [0, 1, 0], [0, 10, 0], 314.16),
    { name: 'F1:side#0', area: 628.3, centroid: [0, 0, 6.4], plane_normal: null }, { name: 'F1:side#1', area: 628.3, centroid: [0, 0, -6.4], plane_normal: null },
  ];
  const edges = [
    { name: 'F1:bottom|F1:side#0', start: [10, 10, 0], mid: [0, 10, 10], end: [-10, 10, 0], length: 31.4159 },
    { name: 'F1:bottom|F1:side#1', start: [-10, 10, 0], mid: [0, 10, -10], end: [10, 10, 0], length: 31.4159 },
  ];
  for (const of of [['-z', 'side'], ['side', '-z']]) {
    const r = await resolveName(edge(...of), envOf(feat, faces, edges), 'edge');
    assert.equal(r.ok, false);
    assert.match(r.sentence, /the bottom of a cylinder turned onto its side has no world-frame reading/);
    assert.equal(plainSentence(`bevel1 (fillet): ${r.sentence}`).sentence,
      'The part for bevel1 was turned, so its edge cannot be found reliably and bevel1 is shown without it -- round or bevel the edge before you turn the part.');
  }
});
