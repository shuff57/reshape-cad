// Rounding (or chamfering) the four top edges of a pocket's opening: two neighbouring edges meet at a corner whose
// third edge is the pocket's concave vertical corner, and the two blends have to be MITRED there (S4h). brep-rs
// builds that corner now: each blend is extended by its tangent length into the corner and cut by the plane of
// symmetry through the corner vertex, so the two remove the INTERSECTION of their cuts (a square pyramid of
// side s per chamfer corner, the material above both quarter cylinders per round corner), and the two quarter
// cylinders meet along the arc of the ellipse where that plane cuts them. A picked rim is still never shown HALF
// rounded: a corner the builder cannot take refuses the whole pick, and the part is shown as it stood before.
//
// Oracles: the pocketed plate's own volume (40 x 30 x 10 - 10 x 10 x 4 = 11600), closed forms ((1 - pi/4) r^2 per
// unit length of a rounded edge, (5/3 - pi/2) r^3 per mitred round corner, s^3 / 3 per mitred chamfer corner),
// the OCCT referee on the same rim (occtRim below), and FreeCAD 26.3rc1 for the same parts (docs/replica/freecad/gauntlet):
//   four edges r=1: 11591.03244517401, 15 faces      two opposite edges r=1: 11595.707963267949, 13 faces
//   two neighbouring edges: 11595.612092927622, 13    three edges: 11593.370204220879, 14     one edge: 11597.853981633974, 12
//   chamfers s=1: four 11578.666666666666 (15), two opposite 11590 (13), two neighbouring 11589.666666666668 (13)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mine, assertWatertight, assertStep, oc } from './s4i-harness.mjs';

// The OCCT referee for a rim: the SAME construction FreeCAD's Fillet/Chamfer feature makes -- every picked rim edge
// in ONE BRepFilletAPI_MakeFillet (or _MakeChamfer), built once on the pocketed plate. (occt-build.ts replays a
// chained pick one named edge at a time through its naming history, and measured here that replay loses one
// edge of every chain: four rounds come back as three, two as one. So the edges are picked by where they lie.)
const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const { buildDoc } = await import(pathToFileURL(path.join(HERE, '../dist/occt-build.js')).href);
const arc = await import(pathToFileURL(path.join(HERE, '../../sketch/dist/sketch-arc.js')).href);

function occtRim(m) {
  const feats = m.r.doc.features;
  const rounds = feats.filter((f) => f.kind === 'fillet');
  const base = feats.filter((f) => f.kind !== 'fillet');
  const shape = buildDoc(oc, { version: 1, features: base }, arc).shapes.get(base.at(-1).id);
  assert.ok(shape, 'OCCT built the pocketed plate');
  const boxOf = (sh) => {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.AddOptimal(sh, box, false, false);
    const lo = box.CornerMin(), hi = box.CornerMax();
    return [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]];
  };
  // the world segment each round names: the pocket sketch's side, at the sketch's plane height
  const wanted = rounds.map((f) => {
    const w = f.edge.of.find((n) => n.cause === 'swept');
    const sk = feats.find((x) => x.id === w.from);
    const a = sk.points[w.edge], b = sk.points[(w.edge + 1) % sk.points.length];
    return [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), sk.offset], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), sk.offset]];
  });
  const near = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 1e-6);
  const picked = [];
  const exp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; exp.More(); exp.Next()) {
    const e = exp.Current();
    if (picked.some((u) => u.IsSame(e))) continue;
    const bb = boxOf(e);
    if (wanted.some((w) => near(bb[0], w[0]) && near(bb[1], w[1]))) picked.push(e.clone());
  }
  assert.equal(picked.length, rounds.length, 'every named rim edge found on the OCCT plate');
  const style = rounds[0].style, size = rounds[0].size;
  const mk = style === 'chamfer' ? new oc.BRepFilletAPI_MakeChamfer(shape) : new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  for (const e of picked) mk.Add(size, oc.TopoDS.Edge(e));
  mk.Build(new oc.Message_ProgressRange());
  assert.ok(!mk.IsDone || mk.IsDone(), 'OCCT built the rim');
  const out = mk.Shape();
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(out, g, 1e-7, false, false);
  let faces = 0;
  for (const fx = new oc.TopExp_Explorer(out, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); fx.More(); fx.Next()) faces++;
  return { volume: g.Mass(), faces, bbox: boxOf(out) };
}

function assertOcctRim(m, name = '') {
  const ref = occtRim(m);
  assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `${name} volume ${m.volume} vs OCCT ${ref.volume}`);
  assert.equal(m.faces, ref.faces, `${name} faces vs OCCT`);
  for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
    assert.ok(Math.abs(m.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `${name} bbox[${a}][${k}] ${m.bbox[a][k]} vs OCCT ${ref.bbox[a][k]}`);
}

const PI = Math.PI;
const wedge = (r, L) => (1 - PI / 4) * r * r * L;
const roundCorner = (r) => (5 / 3 - PI / 2) * r * r * r;
const POCKETED = 40 * 30 * 10 - 10 * 10 * 4;
const SIDE = 10;

const script = (calls) => `
const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] });
const plate = extrude(s1, 10);
const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 15] });
const part = pocket(s2, plate, 4);
${calls}`;
const wall = (n, r = 1) => `round(part.edge('top', part.wall(s2, ${n})), ${r});`;

const close = (got, want, rel, what) => assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${what}: ${got} vs ${want}`);

test('four rim edges: the rounded rectangle FreeCAD builds, 15 faces, exact against the closed form and OCCT', () => {
  const m = mine(script('round(part.rim(s2), 1);'));
  assert.deepEqual(m.refusals, {});
  close(m.volume, POCKETED - 4 * wedge(1, SIDE) - 4 * roundCorner(1), 1e-9, 'closed form');
  close(m.volume, 11591.03244517401, 1e-9, 'FreeCAD');
  assert.equal(m.faces, 15);
  assertOcctRim(m, 'four rim rounds');
  assertWatertight(m);
  assertStep(m);
});

test('four rim edges at another radius, pocket and place: the same closed form, OCCT and FreeCAD-shaped topology', () => {
  const m = mine(`
const s1 = sketch('top'); s1.rect(50, 40, { at: [25, 20] });
const plate = extrude(s1, 12);
const s2 = sketch('top', 12); s2.rect(16, 12, { at: [18, 14] });
const part = pocket(s2, plate, 5);
round(part.rim(s2), 2);`);
  assert.deepEqual(m.refusals, {});
  const v = 50 * 40 * 12 - 16 * 12 * 5 - wedge(2, 2 * (16 + 12)) - 4 * roundCorner(2);
  close(m.volume, v, 1e-9, 'closed form');
  assert.equal(m.faces, 15);
  assertOcctRim(m, 'rim rounds r=2');
  assertWatertight(m);
  assertStep(m);
});

test('two neighbouring edges and three edges: one or two mitred corners, equal to FreeCAD', () => {
  for (const [calls, corners, edges, want, faces] of [
    [wall(1) + wall(2), 1, 2, 11595.612092927622, 13],
    [wall(1) + wall(2) + wall(3), 2, 3, 11593.370204220879, 14],
    [wall(4) + wall(1), 1, 2, 11595.612092927622, 13],
  ]) {
    const m = mine(script(calls));
    assert.deepEqual(m.refusals, {}, calls);
    close(m.volume, POCKETED - edges * wedge(1, SIDE) - corners * roundCorner(1), 1e-9, `${calls} closed form`);
    close(m.volume, want, 1e-9, `${calls} FreeCAD`);
    assert.equal(m.faces, faces, calls);
    assertOcctRim(m, calls);
    assertWatertight(m);
    assertStep(m);
  }
});

test('one edge, and two opposite edges (no shared corner): built as before, equal to FreeCAD and the closed form', () => {
  const one = mine(script(wall(2)));
  assert.deepEqual(one.refusals, {});
  assert.ok(Math.abs(one.volume - (POCKETED - wedge(1, SIDE))) <= 1e-9 * POCKETED);
  assert.ok(Math.abs(one.volume - 11597.853981633974) <= 1e-6 * one.volume);
  assert.equal(one.faces, 12);
  const two = mine(script(wall(1) + wall(3)));
  assert.deepEqual(two.refusals, {});
  assert.ok(Math.abs(two.volume - (POCKETED - 2 * wedge(1, SIDE))) <= 1e-9 * POCKETED);
  assert.ok(Math.abs(two.volume - 11595.707963267949) <= 1e-6 * two.volume);
  assert.equal(two.faces, 13);
  for (const m of [one, two]) { assertWatertight(m); assertStep(m); }
});

test('a rim the corner builder cannot take is refused whole, never shown half rounded', () => {
  // a round too big for the pocket's walls: its own fit sentence, and the neighbour is not applied on its own
  const m = mine(script(`round(part.edge('top', part.wall(s2, 1)), 6); round(part.edge('top', part.wall(s2, 2)), 6);`));
  assert.equal(Object.keys(m.refusals).length, 2, JSON.stringify(m.refusals));
  assert.ok(Math.abs(m.volume - POCKETED) <= 1e-9 * POCKETED, `volume ${m.volume}`);
  assert.equal(m.faces, 11);
});

test('a further edit of the mitred part is refused in a sentence, not cut through the rounds', () => {
  const m = mine(script(`round(part.rim(s2), 1); round(part.edge('top', 'front'), 2);`));
  assert.deepEqual(Object.keys(m.refusals), ['round5']);
  assert.match(m.refusals.round5, /mitred at the corners of a pocket's rim.*same pick/);
  close(m.volume, 11591.03244517401, 1e-9, 'the rim as rounded');
});

// The same corner for a chamfer: FreeCAD's mitre removes the INTERSECTION of the cuts (a square pyramid of side s per
// corner), where taking the four rim chamfers one after the other removed their union (11576, 23 faces).
const bevelWall = (n, s = 1) => `bevel(part.edge('top', part.wall(s2, ${n})), ${s});`;

test('chamfer: four rim edges and two neighbouring ones are the mitre, equal to FreeCAD and OCCT', () => {
  for (const [calls, want, faces, corners, edges] of [
    ['bevel(part.rim(s2), 1);', 11578.666666666666, 15, 4, 4],
    [bevelWall(1) + bevelWall(2), 11589.666666666668, 13, 1, 2],
  ]) {
    const m = mine(script(calls));
    assert.deepEqual(m.refusals, {}, calls);
    close(m.volume, POCKETED - edges * 0.5 * SIDE - corners / 3, 1e-9, `${calls} closed form`);
    close(m.volume, want, 1e-9, `${calls} FreeCAD`);
    assert.equal(m.faces, faces, calls);
    assertOcctRim(m, calls);
    assertWatertight(m);
    assertStep(m);
  }
});

test('chamfer: one edge and two opposite edges build, equal to FreeCAD and the closed form', () => {
  const one = mine(script(bevelWall(2)));
  assert.deepEqual(one.refusals, {});
  assert.ok(Math.abs(one.volume - (POCKETED - 0.5 * SIDE)) <= 1e-9 * POCKETED);
  const two = mine(script(bevelWall(1) + bevelWall(3)));
  assert.deepEqual(two.refusals, {});
  assert.ok(Math.abs(two.volume - (POCKETED - SIDE)) <= 1e-9 * POCKETED);
  assert.ok(Math.abs(two.volume - 11590) <= 1e-6 * two.volume);
  assert.equal(two.faces, 13);
  for (const m of [one, two]) { assertWatertight(m); assertStep(m); }
});

// Chamfers of DIFFERENT sizes on neighbouring rim edges are two picks, so their corner is never mitred. A 1 then a 1.5
// was built at 11580.9375 (15 faces) with no refusal: the second chamfer's end, against the first one's slanted face,
// read as open air, and its wedge ran 12.5 mm along the 10 mm edge, 2.5 mm on into the plate past the pocket's corner.
// That end is an inside corner, and the chamfer is refused in a sentence, the part shown as the feature before left it.
test('neighbouring chamfers of different sizes: the later one is refused in a sentence, never gouged into the plate', () => {
  for (const [calls, refused, want, faces] of [
    [bevelWall(1, 1) + bevelWall(2, 1.5), 'bevel2', POCKETED - 0.5 * SIDE, 12],
    [bevelWall(1, 1.5) + bevelWall(2, 1), 'bevel2', POCKETED - 0.5 * 1.5 * 1.5 * SIDE, 12],
    // a different size picked between two of one size: the last meets both earlier chamfers (was 11576.5, 18 faces)
    [bevelWall(1, 1) + bevelWall(3, 1.5) + bevelWall(2, 1), 'bevel3', POCKETED - 0.5 * SIDE - 0.5 * 1.5 * 1.5 * SIDE, 13],
    // beside a round
    [wall(1) + bevelWall(2, 1.5), 'bevel1', POCKETED - wedge(1, SIDE), 12],
  ]) {
    const m = mine(script(calls));
    assert.deepEqual(Object.keys(m.refusals), [refused], calls);
    assert.match(m.refusals[refused], /^brep-rs cannot chamfer this edge yet: it ends at an inside corner where it meets another round, chamfer or slanted face, .* -- bevel\d is shown without it\.$/);
    close(m.volume, want, 1e-9, `${calls} as the feature before left it`);
    assert.equal(m.faces, faces, calls);
  }
});

test('one size picked around an opposite edge is still the mitred pick, equal to OCCT', () => {
  // the last edge meets both earlier ones at inside corners: refused on its own, but the run rebuilds all three
  for (const [calls, want] of [
    [bevelWall(1) + bevelWall(3) + bevelWall(2), POCKETED - 3 * 0.5 * SIDE - 2 / 3],
    [wall(1) + wall(3) + wall(2), POCKETED - 3 * wedge(1, SIDE) - 2 * roundCorner(1)],
  ]) {
    const m = mine(script(calls));
    assert.deepEqual(m.refusals, {}, calls);
    close(m.volume, want, 1e-9, `${calls} closed form`);
    assert.equal(m.faces, 14, calls);
    assertOcctRim(m, calls);
    assertWatertight(m);
  }
});

test('a pick whose corner the builder tries and cannot take: a 0.5 mm wall outside one rim edge', () => {
  // r = 1 does not fit the thin wall's edge, but its neighbour builds on its own, so the corner IS tried, and refused
  // there and fails on the SIZE: the size's own sentence on both (not the corner's), the pocketed plate shown unmodified.
  const m = mine(`
const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] });
const plate = extrude(s1, 10);
const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 5.5] });
const part = pocket(s2, plate, 4);
${wall(1)}${wall(2)}`);
  assert.deepEqual(Object.keys(m.refusals).sort(), ['round1', 'round2']);
  for (const id of ['round1', 'round2']) {
    assert.match(m.refusals[id], /^A round of 1 would not fit where the edges picked with /);
    assert.doesNotMatch(m.refusals[id], /corner is not built/);
  }
  close(m.volume, POCKETED, 1e-12, 'the pocketed plate');
  assert.equal(m.faces, 11);
});

test('a size the kernel cannot hold says it is the size, not the corner', () => {
  // r = 0.001 is below what the part's own volume tolerance can check; r = 3.9999999999 in a 4 mm pocket leaves a
  // sliver of the wall. Both were refused as "that corner is not built".
  for (const [r, kind] of [[0.001, /is so small next to this part/], [3.9999999999, /leaves almost nothing of the face/]]) {
    for (const call of ['round', 'bevel']) {
      const m = mine(script(`${call}(part.rim(s2), ${r});`));
      assert.ok(Object.keys(m.refusals).length >= 1, `${call} ${r}`);
      for (const why of Object.values(m.refusals)) {
        assert.match(why, kind, `${call} ${r}`);
        assert.doesNotMatch(why, /corner is not built/, `${call} ${r}`);
      }
      close(m.volume, POCKETED, 1e-12, `${call} ${r}: the pocketed plate`);
    }
  }
});

test('a small rim (r = 0.01): held to its removed volume, equal to OCCT', () => {
  const r = 0.01;
  for (const [calls, removed] of [
    [`round(part.rim(s2), ${r});`, wedge(r, 4 * SIDE) + 4 * roundCorner(r)],
    [`bevel(part.rim(s2), ${r});`, 0.5 * r * r * 4 * SIDE + 4 * r ** 3 / 3],
  ]) {
    const m = mine(script(calls));
    assert.deepEqual(m.refusals, {}, calls);
    close(POCKETED - m.volume, removed, 1e-6, `${calls} removed volume`);
    assert.equal(m.faces, 15, calls);
    assertOcctRim(m, calls);
  }
});
