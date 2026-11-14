// G-CURVED sees through a hollow (second pilot; owner decision 2026-11-13: "refuse both, same sentence"; pilot-2026-11b/PILOT-2.md, "A hole across a
// hollowed cylinder"). A hole across a cylinder was refused at once, but the same hole across a HOLLOWED cylinder was cut, because the walk back to the
// part's starting shape stopped at the hollow. No kernel here: the walk and the sentence, in the layer and in the contract copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { box, cyl, cone, circ, rect, extrude, hole, shell, move, mirror, pattern, fillet, prim } from './docs.mjs';

const H = await import(new URL('../dist/holes.js', import.meta.url).href);
const C = await import(new URL('../../../docs/spikes/solidcraft-referee/contract/holes4-translate.mjs', import.meta.url).href);
const G = (feats) => ({ byId: Object.fromEntries(feats.map((f) => [f.id, f])) });

test('curvedRootOf walks back over holes, hollows, moves, mirrors, row repeats and rounds to the shape underneath, and over nothing else', () => {
  const feats = [cyl('c1'), shell('s2', 'c1', prim('c1', '+z')), hole('h3', 's2', { axis: 'x' }), hole('h4', 'h3'), shell('s5', 'h4'),
    box('b1'), shell('s6', 'b1', prim('b1', '+z')), move('m7', 'c1', [5, 0, 0]), shell('s8', 'm7'), move('m9', 'c1', [60, 0, 0], true),
    mirror('x10', 'c1'), pattern('p11', 'x10'), pattern('p12', 'c1', { mode: 'circular' }), fillet('f13', 'p11', null, 1), fillet('f14', 'c1', null, 1, 'chamfer'),
    { id: 'r15', kind: 'rotate', target: 'c1', angles: [90, 0, 0] }, { id: 'd16', kind: 'draft', target: 'c1', angle: 5, pull: 'z', neutral: 0, whole: true }, hole('h17', 'r15'), hole('h18', 'd16')];
  for (const R of [H.curvedRootOf, C.curvedRootOf]) {
    assert.equal(R('c1', G(feats)).id, 'c1');
    assert.equal(R('s2', G(feats)).id, 'c1', 'through the hollow');
    assert.equal(R('h3', G(feats)).id, 'c1', 'through a hole and the hollow');
    assert.equal(R('s5', G(feats)).id, 'c1', 'hollow, holes, hollow');
    assert.equal(R('s6', G(feats)).id, 'b1');
    // owner decision 2026-11-14: the steps that leave the wall and its direction as they are
    assert.equal(R('s8', G(feats)).id, 'c1', 'through a hollow and a move');
    assert.equal(R('m9', G(feats)).id, 'c1', 'a copy');
    assert.equal(R('x10', G(feats)).id, 'c1', 'a mirror');
    assert.equal(R('p11', G(feats)).id, 'c1', 'a repeat in a row of a mirror');
    assert.equal(R('f13', G(feats)).id, 'c1', 'a round'); assert.equal(R('f14', G(feats)).id, 'c1', 'a bevel');
    // and the ones that do not
    assert.equal(R('p12', G(feats)).id, 'p12', 'a repeat round a centre: its copies point other ways');
    assert.equal(R('h17', G(feats)).id, 'r15', 'a turn changes the direction of the wall');
    assert.equal(R('h18', G(feats)).id, 'd16', 'a draft');
    assert.equal(R('nothing', G(feats)), null);
  }
  // a cycle in the ids does not hang
  const loop = G([{ id: 'a', kind: 'shell', target: 'b' }, { id: 'b', kind: 'hole', target: 'a' }]);
  for (const R of [H.curvedRootOf, C.curvedRootOf]) assert.ok(['a', 'b'].includes(R('a', loop).id), 'it stops inside the loop, as rootOf does');
});

test('the shape under a hollow has the curved wall the guard asks about: a cylinder, a cone, a round pad; a box and a plain pad do not', () => {
  const feats = [cyl('c1'), shell('s1', 'c1'), cone('k1'), shell('s2', 'k1'), circ('sk1'), extrude('e1', 'sk1'), shell('s3', 'e1'), box('b1'), shell('s4', 'b1'), rect('sk2'), extrude('e2', 'sk2'), shell('s5', 'e2')];
  for (const M of [H, C]) {
    const cv = (id) => { const r = M.curvedRootOf(id, G(feats)); return r ? M.curvedAxis(r, G(feats)) : null; };
    assert.deepEqual(cv('s1').axis, [0, 0, 1]); assert.equal(cv('s1').what, 'the cylinder');
    assert.equal(cv('s2').what, 'the cone'); assert.equal(cv('s3').what, 'the round pad');
    assert.equal(cv('s4'), null); assert.equal(cv('s5'), null);
  }
});

test('the old walk still stops at a hollow (everything but G-CURVED uses it), in the layer', () => {
  const feats = [cyl('c1'), shell('s2', 'c1'), hole('h3', 's2')];
  assert.equal(H.rootOf('h3', G(feats)).id, 's2');
});

test('the sentence is the one a hole across a solid cylinder already gets, word for word, in the layer and the contract copy', () => {
  const f = { id: 'hole1', kind: 'hole', target: 's2', diameter: 6, depth: 40, center: [0, 0, 0], axis: 'x' };
  const want = 'hole1 (hole): a hole drilled across the cylinder would cut through its curved wall at an angle, which is not supported yet, so hole1 is shown without it -- drill along the axis of the cylinder, or use a flat-sided shape.';
  assert.equal(H.SENTENCE.curved(f, 'the cylinder'), want); assert.equal(C.SENTENCE.curved(f, 'the cylinder'), want);
});
