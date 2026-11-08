// A named edge after a move or a turn (translate.ts confirmOnTarget). Edges are not carried through a move: the edge is looked for on the target
// where it WAS. Another edge of the moved part can sit exactly there -- HALT-4 / audit FM-1, live on the host: box(30,30,10) moved [0,-30,0], then
// round(top, front) rounded the top-BACK edge (volume and box right, centre of mass 1.9e-3 of the diagonal off OCCT); the same after hole + turn 180.
// solidcraft's persistent labels travel with the body, so the edge found there must carry the named edge's own label. Pinned on hand-made topology:
//   - another edge at the spot after a move: refused, and the student sees the existing "already changed by an earlier move" sentence;
//   - the same edge at the spot (a move along the edge, or no move in the chain): picked as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmOnTarget } from '../dist/translate.js';
import { plainSentence } from '../dist/fc-sentences.js';

const E = (name, mid, length = 30) => ({ name, start: mid, mid, end: mid, length });
const named = (edgeName, mid) => ({
  ok: true, kind: 'edge', point: mid, length: 30, edges: [E(edgeName, mid)],
  shape: { ok: true, bodyName: 'b_box1', featureId: 'box1', featureNumber: 1, faces: [], edges: [] },
  evidence: { name: 'box1.edge[box1.face[+z] ^ box1.face[-y]]', engineEdges: [edgeName] },
});
const argsOf = (targetEdges, features, targetId) => ({
  st: { head: {}, bodies: { [targetId]: ['b1'] } }, accepted: [], targetId, features,
  ctx: { topologyOf: async () => ({ ok: true, topology: { bodies: [{ name: 'b1', faces: [], edges: targetEdges }] } }) },
});
const BOX = { id: 'box1', kind: 'box', size: [30, 30, 10], center: [0, 0, 0] };
const MOVE = { id: 'move1', kind: 'move', target: 'box1', offset: [0, -30, 0] };

test('after a move, another edge at the named edge\'s old place is refused with the existing "earlier move" sentence', async () => {
  // box(30,30,10) moved [0,-30,0]: its top-back edge F1:+y|F1:+z now lies where top-front F1:+z|F1:-y was, at (0,-15,5)
  const r = await confirmOnTarget(named('F1:+z|F1:-y', [0, -15, 5]), argsOf([E('F1:+y|F1:+z', [0, -15, 5]), E('F1:+z|F1:-y', [0, -45, 5])], [BOX, MOVE], 'move1'));
  assert.equal(r.ok, false);
  assert.match(r.sentence, /but that edge is no longer present whole on b1: after move1 \(a move\) the edge at its place is F1:\+y\|F1:\+z/);
  assert.equal(plainSentence(`round1 (fillet): ${r.sentence}`, { causes: [{ id: 'move1', kind: 'move' }] }).sentence,
    'The edge for round1 was already changed by an earlier move, so round1 is shown without it -- round the edge before that step, or name an edge it left alone.');
});

test('after a turn, the same check (a turned holed box puts its bottom-back edge where top-front was)', async () => {
  const feats = [BOX, { id: 'hole1', kind: 'hole', target: 'box1' }, { id: 'turn1', kind: 'rotate', target: 'hole1', angles: [180, 0, 0] }];
  const r = await confirmOnTarget(named('F1:+z|F1:-y', [0, -15, 5]), argsOf([E('F1:+y|F1:-z', [0, -15, 5])], feats, 'turn1'));
  assert.equal(r.ok, false);
  assert.match(r.sentence, /after turn1 \(a rotate\) the edge at its place is F1:\+y\|F1:-z/);
});

test('the same edge at the spot after a move (labels in either order, a ~n suffix) is picked as before', async () => {
  const r = await confirmOnTarget(named('F1:+z|F1:-y', [0, -15, 5]), argsOf([E('F1:-y|F1:+z~1', [0, -15, 5])], [BOX, { ...MOVE, offset: [12, 0, 0] }], 'move1'));
  assert.equal(r.ok, true, r.sentence);
  assert.deepEqual(r.evidence.target.edges, ['F1:-y|F1:+z~1']);
});

test('no move or turn between the name and the target: the label is not compared (behaviour unchanged)', async () => {
  const r = await confirmOnTarget(named('F1:+z|F1:-y', [0, -15, 5]), argsOf([E('F2:+z|F2:-y', [0, -15, 5])], [BOX, { id: 'hole1', kind: 'hole', target: 'box1' }], 'hole1'));
  assert.equal(r.ok, true, r.sentence);
});
