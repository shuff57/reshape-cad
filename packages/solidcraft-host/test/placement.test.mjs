// Where a shape without at: went, and a join that joins nothing (pane/src/placement.mjs; owner-approved text, 2026-11-12). No kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const P = await imp('packages/solidcraft-host/pane/src/placement.mjs');
const { runScript } = await imp('packages/script/dist/reshape-script.js');

const run = (src) => { const r = runScript(src); assert.deepEqual(r.errors, [], src); return r; };

test('the script records the shapes it placed by default, and only those', () => {
  const r = run(`const a = box(40, 40, 20); const b = box(10, 10, 10); const c = cylinder(10, 5, { at: [0, 0, 0] }); const d = sphere(8);`);
  assert.deepEqual(r.placed, [{ id: 'box2', beside: 'box1' }, { id: 'ball1', beside: 'box2' }]);
  assert.deepEqual(r.doc.features.find((f) => f.id === 'box2').center, [50, 0, 0], '10 past the right edge of box1');
  assert.equal(JSON.stringify(r.doc).includes('beside'), false, 'the record is beside the doc, not in it');
  // the first shape goes to the origin and is not listed; a script with one shape, or with every shape placed, has no record at all
  assert.equal(run(`const a = box(40, 40, 20);`).placed, undefined);
  assert.equal(run(`const a = box(40, 40, 20); const b = box(10, 10, 10, { at: [0, 0, 30] });`).placed, undefined);
  // a part pulled from a sketch counts too (owner decision 2026-11-12; a box after a pulled plate used to land at the origin, inside the plate)
  const p = run(`const sk = sketch('top'); sk.rect(40, 30); const q = extrude(sk, 10); const b = box(10, 10, 10);`);
  assert.deepEqual(p.placed, [{ id: 'box1', beside: 'pull1' }]);
  assert.deepEqual(p.doc.features.find((f) => f.id === 'box1').center, [50, 0, 0], 'the plate reaches x = 20; a default box is 40 wide; 10 apart');
  // and a spun part
  const sp = run(`const s = sketch('front', 0); s.polygon([[5, -10], [15, -10], [15, 10], [5, 10]]); const t = revolve(s, 360); const b = box(10, 10, 10);`);
  assert.deepEqual(sp.placed, [{ id: 'box1', beside: 'rev1' }]);
  // a pulled part whose size is not known exactly (a sketch with dimensions and rules has no outline until the solver runs): the shape stays at the origin, and that is recorded
  const DIM = `const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [50, 0] }, { k: 'line', id: 2, a: [50, 0], b: [50, 30] }, { k: 'line', id: 3, a: [50, 30], b: [0, 30] }, { k: 'line', id: 4, a: [0, 30], b: [0, 0] }]); const q = extrude(sk, 6);`;
  const dm = run(`${DIM} const b = box(10, 10, 10);`);
  assert.deepEqual(dm.placed, [{ id: 'box1', beside: null, unmeasured: 'pull1' }]);
  assert.deepEqual(dm.doc.features.find((f) => f.id === 'box1').center, [0, 0, 0]);
  // the pull itself is where its sketch is: it is never moved, whatever came before
  const bp = run(`const b = box(10, 10, 10); const sk = sketch('top'); sk.rect(40, 30); const q = extrude(sk, 10);`);
  assert.equal(bp.placed, undefined);
});

test('shapeNote: the approved line, with the centre the doc has', () => {
  const r = run(`const a = box(20, 20, 5); const b = box(40, 40, 20);`);
  const placed = P.placedMap(r.placed);
  assert.equal(P.shapeNote(r.doc.features[1], placed), 'no at: given, so it was placed beside box1; its centre is at [40, 0, 0]');
  assert.equal(P.shapeNote(r.doc.features[0], placed), null, 'the first shape');
  assert.equal(P.shapeNote(r.doc.features[1], P.placedMap(undefined)), null, 'no record (a ModelDoc example): nothing is claimed');
  assert.equal(P.placedMap([{ id: 'x' }, null, { id: 'a', beside: 'b' }, { id: 'c', beside: null }]).size, 1, 'a malformed entry is dropped');
  // beside a pulled part, and at the origin because the pulled part cannot be measured
  const pl = run(`const sk = sketch('top'); sk.rect(40, 30); const q = extrude(sk, 10); const b = box(10, 10, 10);`);
  assert.equal(P.shapeNote(pl.doc.features.at(-1), P.placedMap(pl.placed)), 'no at: given, so it was placed beside pull1; its centre is at [50, 0, 0]');
  const og = { id: 'box1', kind: 'box', center: [0, 0, 0] };
  assert.equal(P.shapeNote(og, P.placedMap([{ id: 'box1', beside: null, unmeasured: 'pull1' }])), 'no at: given, so it is at the origin [0, 0, 0]; it may overlap pull1');
  // a shape that stayed at the origin gets no "placed beside" hint on a step that missed it
  const doc = { version: 1, features: [{ id: 'pull1', kind: 'extrude', target: 'sk1' }, og, { id: 'sk2', kind: 'sketch' }, { id: 'pocket1', kind: 'pocket', target: 'sk2', into: 'box1' }] };
  assert.equal(P.placementHint({ id: 'pocket1', status: 'refused', refusal: 'pocket1 does not touch the part, so it cuts nothing; move the sketch onto the part, or change the depth or direction' }, doc, P.placedMap([{ id: 'box1', beside: null, unmeasured: 'pull1' }])), null);
});

// the three sentences the hint is added to, as the layer writes them
const LAYER = readdirSync(path.join(root, 'packages/layer/src')).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(path.join(root, 'packages/layer/src', f), 'utf8')).join('\n');
const POCKET = 'pocket1 does not touch the part, so it cuts nothing; move the sketch onto the part, or change the depth or direction';
const KEEP = 'The two shapes do not overlap, so keeping their overlap leaves nothing.';
const GROOVE = 'groove1 (groove): the ring does not cut the part (it misses it, or turns away from it), so there is nothing to remove.';

test('the three sentences the hint is added to are the layer\'s own', () => {
  assert.ok(LAYER.includes('does not touch the part, so it cuts nothing; move the sketch onto the part, or change the depth or direction'));
  assert.ok(LAYER.includes('do not overlap, so keeping their overlap leaves nothing'));
  assert.ok(LAYER.includes('the ring does not cut the part (it misses it, or turns away from it), so there is nothing to remove'));
  assert.ok(P.MISSED.pocket.test(POCKET)); assert.ok(P.MISSED.combine.test(KEEP)); assert.ok(P.MISSED.groove.test(GROOVE));
});

test('placementHint: a pocket, keep() or groove that missed a part placed by default says where the part went', () => {
  const pk = run(`const o = box(20, 20, 5); const b = box(40, 40, 20); const sk = sketch('top', 10); sk.rect(10, 10); pocket(sk, b, 5);`);
  assert.equal(P.placementHint({ id: 'pocket1', status: 'refused', refusal: POCKET }, pk.doc, P.placedMap(pk.placed)),
    `${POCKET} (box2 has no at:, so it was placed beside box1 with its centre at [40, 0, 0]).`);
  const kp = run(`const a = box(40, 40, 20); const b = box(20, 20, 30); keep(a, b);`);
  assert.equal(P.placementHint({ id: 'op1', status: 'refused', refusal: KEEP }, kp.doc, P.placedMap(kp.placed)),
    'The two shapes do not overlap, so keeping their overlap leaves nothing (box2 has no at:, so it was placed beside box1 with its centre at [50, 0, 0]).');
  const gr = run(`const o = box(20, 20, 5); const b = box(40, 40, 20); const sg = sketch('front'); sg.polygon([[10, 2], [16, 2], [16, 8], [10, 8]]); groove(sg, b, 360);`);
  assert.equal(P.placementHint({ id: 'groove1', status: 'refused', refusal: GROOVE }, gr.doc, P.placedMap(gr.placed)),
    'groove1 (groove): the ring does not cut the part (it misses it, or turns away from it), so there is nothing to remove (box2 has no at:, so it was placed beside box1 with its centre at [40, 0, 0]).');
  // the part is found through the steps that only change it (a hole on the box, then the pocket)
  const ch = run(`const o = box(20, 20, 5); const b = box(40, 40, 20); hole(b, { across: 4 }); const sk = sketch('top', 10); sk.rect(10, 10); pocket(sk, b, 5);`);
  assert.match(P.placementHint({ id: 'pocket1', status: 'refused', refusal: POCKET }, ch.doc, P.placedMap(ch.placed)), /\(box2 has no at:/);
});

test('placementHint: nothing is added where it would not be true or is not asked', () => {
  const pk = run(`const o = box(20, 20, 5); const b = box(40, 40, 20); const sk = sketch('top', 10); sk.rect(10, 10); pocket(sk, b, 5);`);
  const placed = P.placedMap(pk.placed);
  // the part had an at:, or is the first shape
  const at = run(`const o = box(20, 20, 5); const b = box(40, 40, 20, { at: [0, 0, 0] }); const sk = sketch('top', 10); sk.rect(10, 10, { at: [100, 100] }); pocket(sk, b, 5);`);
  assert.equal(P.placementHint({ id: 'pocket1', status: 'refused', refusal: POCKET }, at.doc, P.placedMap(at.placed)), null);
  const first = run(`const b = box(40, 40, 20); const sk = sketch('top', 10); sk.rect(10, 10, { at: [100, 100] }); pocket(sk, b, 5);`);
  assert.equal(P.placementHint({ id: 'pocket1', status: 'refused', refusal: POCKET }, first.doc, P.placedMap(first.placed)), null);
  // another refusal of the same step, a built step, a cut (its sentence already says at:), a join
  assert.equal(P.placementHint({ id: 'pocket1', status: 'refused', refusal: 'pocket1: the cut and the volume the sketch should remove do not add up' }, pk.doc, placed), null);
  assert.equal(P.placementHint({ id: 'pocket1', status: 'built' }, pk.doc, placed), null);
  const cut = run(`const b = box(40, 40, 20); const c = cylinder(10, 30); subtract(b, c);`);
  assert.equal(P.placementHint({ id: 'op1', status: 'refused', refusal: 'The cutting shape does not overlap the shape being cut, so nothing would be removed; move it (give it an at: position) so the two overlap.' }, cut.doc, P.placedMap(cut.placed)), null);
  assert.equal(P.placementHint({ id: 'op1', status: 'refused', refusal: KEEP }, cut.doc, P.placedMap(cut.placed)), null, 'the sentence of keep() on a cut');
});

test('joinApartNote and pieceCount: a join of two shapes that do not touch is built, and the page says it is 2 pieces', () => {
  const r = run(`const plate = box(60, 40, 5); const peg = cylinder(10, 20); union(plate, peg);`);
  const box = { bbox: [-30, -20, -2.5, 30, 20, 2.5], faces: 6, bodies: ['b_box1'] }, cyl = { bbox: [45, -5, -10, 55, 5, 10], faces: 3, bodies: ['b_cyl1'] };
  const results = (join) => [{ id: 'box1', status: 'built', measure: box }, { id: 'cyl1', status: 'built', measure: cyl }, { id: 'op1', status: 'built', measure: join }];
  const fin = [{ name: 'b_box1', kernel: { shells: 2 } }];
  const want = 'box1 and cyl1 do not touch, so this join is 2 separate pieces; give one an at: position so they overlap';
  const j = { bbox: [-30, -20, -10, 55, 20, 10], faces: 9, bodies: ['b_box1'] };
  assert.equal(P.joinApartNote(results(j)[2], r.doc, results(j), fin), want, 'the count from the final scene');
  assert.equal(P.joinApartNote(results({ ...j, shells: 2 })[2], r.doc, results({ ...j, shells: 2 }), []), want, 'the count from the join\'s own measure');
  assert.equal(P.joinApartNote(results(j)[2], r.doc, results(j), []), want, 'two plain shapes: 2');
  // not said when it is not certain: the boxes overlap, faces were merged, the join was refused, or it is not a join of two
  const touching = [{ id: 'box1', status: 'built', measure: box }, { id: 'cyl1', status: 'built', measure: { ...cyl, bbox: [25, -5, -10, 35, 5, 10] } }, { id: 'op1', status: 'built', measure: j }];
  assert.equal(P.joinApartNote(touching[2], r.doc, touching, fin), null);
  assert.equal(P.joinApartNote(results({ ...j, faces: 8 })[2], r.doc, results({ ...j, faces: 8 }), fin), null);
  assert.equal(P.joinApartNote({ id: 'op1', status: 'refused' }, r.doc, results(j), fin), null);
  const three = run(`const a = box(10, 10, 10); const b = box(10, 10, 10); const c = box(10, 10, 10); union(a, b, c);`);
  assert.equal(P.joinApartNote({ id: 'op1', status: 'built', measure: j }, three.doc, results(j), fin), null);
  assert.equal(P.joinApartNote({ id: 'box1', status: 'built', measure: box }, r.doc, results(j), fin), null);
  // the card counts lumps
  assert.equal(P.pieceCount(fin), 2);
  assert.equal(P.pieceCount([{ name: 'a', kernel: { shells: 1 } }, { name: 'b' }, { name: 'c', kernel: { shells: 3 } }]), 5);
  assert.equal(P.pieceCount([]), 0); assert.equal(P.pieceCount(undefined), 0);
});
