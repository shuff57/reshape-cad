// W3: round and chamfer on an INSIDE (concave) edge of a boolean result or a prism.
//
// An outside edge loses material; an inside edge (an L bracket's bend, the base of a boss on a plate) GAINS it:
// the blend is the corner prism minus the tangent cylinder, joined to the part. For the air wedge between the two
// faces of opening angle theta, a round of radius r adds  d r - (pi - theta) r^2 / 2  per unit length with the
// tangent length d = r / tan(theta / 2) (theta = 90 degrees: (1 - pi/4) r^2), and a chamfer of leg s adds
// (s^2 / 2) sin(theta). The kernel proves it every time (volume gained == area x length to 1e-9, else a refusal).
// Oracles, none of them the code under test: the closed form above (worked by hand for each part), OpenCascade
// (volume 1e-7, bbox 1e-5), a mesh closed at 0.05 and 0.5 whose enclosed volume matches, and STEP read back.
//
// Naming: the words (top, right, ...) match every edge between a top-looking and a right-looking face, and an
// inside corner shares its two words with the outside edges next to it, so the kernel is asked by NAME (the
// `between` pair of faces), as the cargo tests do; by words alone it is refused as ambiguous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, occt, brep, assertWatertight, assertStep } from './s4i-harness.mjs';

const PI = Math.PI;
const roundArea = (r, theta) => (r / Math.tan(theta / 2)) * r - ((PI - theta) * r * r) / 2;
const bevelArea = (s, theta) => 0.5 * s * s * Math.sin(theta);

/** features of a script that ends in a join, with its two primitives' ids */
function joined(code) {
  const r = mine(code);
  return { feats: r.r.doc.features, jid: r.r.doc.features.at(-1).id, a: r.r.doc.features[0].id, b: r.r.doc.features[1].id };
}
const carried = (jid, feat, part) => ({ cause: 'carried', feature: jid, kind: 'face', of: { cause: 'primitive', feature: feat, kind: 'face', part } });
const swept = (feat, sk, edge) => ({ cause: 'swept', feature: feat, kind: 'face', from: sk, edge });

function build(feats, target, edge, size, style) {
  const f = [...feats, { id: 'rr', kind: 'fillet', target, size, style, edge: { cause: 'between', feature: target, kind: 'edge', of: edge } }];
  const json = JSON.stringify({ version: 1, features: f, measure: 'rr' });
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes.rr;
  const v0 = JSON.parse(brep.measure_doc(JSON.stringify({ version: 1, features: feats, measure: target }))).shapes[target].volume;
  return { refusals, volume: s?.volume, bbox: s?.bbox, faces: s?.faces, v0, features: f, json, id: 'rr' };
}

const PLATE = `const p = box(40, 20, 10)\nconst w = box(10, 20, 30, { at: [-15, 0, 10] })\nconst v = join(p, w)\nv`;
const PLATE_OFF = `const p = box(60, 30, 8)\nconst w = box(6, 30, 20, { at: [-27, 0, 6] })\nconst v = join(p, w)\nv`;
const BOSS = `const p = box(40, 40, 20)\nconst w = box(20, 20, 20, { at: [0, 0, 20] })\nconst v = join(p, w)\nv`;
const BOSS_OFF = `const p = box(50, 30, 10)\nconst w = box(12, 8, 15, { at: [8, -3, 12.5] })\nconst v = join(p, w)\nv`;

const prism = (pts, h) => [
  { id: 'sk1', kind: 'sketch', plane: 'xy', points: pts },
  { id: 'e1', kind: 'extrude', target: 'sk1', height: h },
];

// [name, features, target, face pair, size, style, closed-form gain, OpenCascade resolves it too]
const CASES = [];
{
  const L = joined(PLATE); // inside corner: the plate's top (z = 5) against the wall's +x face (x = -10), 20 long
  const pair = [carried(L.jid, L.a, '+z'), carried(L.jid, L.b, '+x')];
  CASES.push(['L bracket, round 2', L.feats, L.jid, pair, 2, 'fillet', roundArea(2, PI / 2) * 20]);
  CASES.push(['L bracket, round 4', L.feats, L.jid, pair, 4, 'fillet', roundArea(4, PI / 2) * 20]);
  CASES.push(['L bracket, chamfer 2', L.feats, L.jid, pair, 2, 'chamfer', bevelArea(2, PI / 2) * 20]);
  CASES.push(['L bracket, chamfer 5', L.feats, L.jid, pair, 5, 'chamfer', bevelArea(5, PI / 2) * 20]);
  const O = joined(PLATE_OFF); // plate 60 x 30 x 8 (z -4..4), wall 6 x 30 x 20 flush at the left end (x -30..-24): inside corner at x = -24
  const po = [carried(O.jid, O.a, '+z'), carried(O.jid, O.b, '+x')];
  CASES.push(['thin-wall bracket, round 3', O.feats, O.jid, po, 3, 'fillet', roundArea(3, PI / 2) * 30]);
  CASES.push(['thin-wall bracket, chamfer 3', O.feats, O.jid, po, 3, 'chamfer', bevelArea(3, PI / 2) * 30]);
  const B = joined(BOSS); // a 20 x 20 boss on a 40 x 40 plate: its four base edges, 20 long
  for (const side of ['+x', '-x', '+y', '-y']) {
    CASES.push([`boss base ${side}, round 2`, B.feats, B.jid, [carried(B.jid, B.a, '+z'), carried(B.jid, B.b, side)], 2, 'fillet', roundArea(2, PI / 2) * 20]);
  }
  CASES.push(['boss base +x, chamfer 3', B.feats, B.jid, [carried(B.jid, B.a, '+z'), carried(B.jid, B.b, '+x')], 3, 'chamfer', bevelArea(3, PI / 2) * 20]);
  CASES.push(['boss base -y, chamfer 2', B.feats, B.jid, [carried(B.jid, B.a, '+z'), carried(B.jid, B.b, '-y')], 2, 'chamfer', bevelArea(2, PI / 2) * 20]);
  const F = joined(BOSS_OFF); // an off-centre 12 x 8 boss
  CASES.push(['off-centre boss base +x (8 long), round 2', F.feats, F.jid, [carried(F.jid, F.a, '+z'), carried(F.jid, F.b, '+x')], 2, 'fillet', roundArea(2, PI / 2) * 8]);
  CASES.push(['off-centre boss base -y (12 long), round 1.5', F.feats, F.jid, [carried(F.jid, F.a, '+z'), carried(F.jid, F.b, '-y')], 1.5, 'fillet', roundArea(1.5, PI / 2) * 12]);
}
{
  // prisms swept from a sketch: air wedge of 90, 120 and 60 degrees at the reflex corner
  const L90 = prism([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], 10); // reflex corner (4, 4), edges 2 and 3
  CASES.push(['L prism, 90 degree inside corner, round 1', L90, 'e1', [swept('e1', 'sk1', 2), swept('e1', 'sk1', 3)], 1, 'fillet', roundArea(1, PI / 2) * 10]);
  CASES.push(['L prism, 90 degree inside corner, chamfer 1.5', L90, 'e1', [swept('e1', 'sk1', 2), swept('e1', 'sk1', 3)], 1.5, 'chamfer', bevelArea(1.5, PI / 2) * 10]);
  const W120 = prism([[0, 0], [20, 0], [20, 10], [12, 10], [8, 4], [0, 4]], 8);
  // (12,10) -> (8,4) -> (0,4): at (8,4) the direction turns from (-4,-6) to (-8,0); interior is reflex there
  const a1 = Math.atan2(6, 4); // angle of the slanted wall against the horizontal
  const airAngle = PI - a1; // between (8,4)->(12,10) = (4,6) and (8,4)->(0,4) = (-8,0)
  CASES.push([`slanted wall on a plate, air wedge ${(airAngle * 180 / PI).toFixed(2)} degrees, round 1`, W120, 'e1', [swept('e1', 'sk1', 3), swept('e1', 'sk1', 4)], 1, 'fillet', roundArea(1, airAngle) * 8]);
  CASES.push([`slanted wall on a plate, chamfer 1.5`, W120, 'e1', [swept('e1', 'sk1', 3), swept('e1', 'sk1', 4)], 1.5, 'chamfer', bevelArea(1.5, airAngle) * 8]);
  // an acute air wedge: a wall leaning over the plate, (11, 4) -> (15, 12) against the plate top (20, 4) -> (11, 4)
  const HOOK = prism([[0, 0], [20, 0], [20, 4], [11, 4], [15, 12], [0, 12]], 6);
  const acute = Math.acos((4 * 9) / (Math.hypot(4, 8) * 9)); // between (+9, 0) and (4, 8): 63.43 degrees
  CASES.push([`leaning wall over a plate, air wedge ${(acute * 180 / PI).toFixed(2)} degrees, round 1`, HOOK, 'e1', [swept('e1', 'sk1', 2), swept('e1', 'sk1', 3)], 1, 'fillet', roundArea(1, acute) * 6]);
  CASES.push(['leaning wall over a plate, chamfer 2', HOOK, 'e1', [swept('e1', 'sk1', 2), swept('e1', 'sk1', 3)], 2, 'chamfer', bevelArea(2, acute) * 6]);
}

let referee = 0;
for (const [name, feats, target, pair, size, style, gain] of CASES) {
  test(`inside corner: ${name}`, () => {
    const m = build(feats, target, pair, size, style);
    assert.deepEqual(m.refusals, {}, name);
    assert.ok(Math.abs(m.volume - m.v0 - gain) <= 1e-9 * m.v0, `${name}: gained ${m.volume - m.v0}, closed form ${gain}`);
    const o = occt(m.features, 'rr');
    assert.ok(Math.abs(m.volume - o.volume) <= 1e-7 * m.v0, `${name}: ${m.volume} vs OpenCascade ${o.volume}`);
    for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(m.bbox[a][k] - o.bbox[a][k]) <= 1e-5, `${name} bbox ${m.bbox[a][k]} vs ${o.bbox[a][k]}`);
    referee++;
    assertWatertight(m);
  });
}

test('the referee compared at least 12 inside corners against OpenCascade', () => {
  assert.ok(referee >= 12, `${referee}`);
});

test('STEP round trip: a round (cylindrical face) and a chamfer of an inside corner, read back by OpenCascade', () => {
  for (const i of [0, 2, 6, 11]) {
    const [, feats, target, pair, size, style] = CASES[i];
    assertStep(build(feats, target, pair, size, style));
  }
});

test('by words alone an inside corner is ambiguous: a sentence, the part unchanged', () => {
  const m = mine(`const p = box(40, 20, 10)\nconst w = box(10, 20, 30, { at: [-15, 0, 10] })\nconst v = join(p, w)\nround(v.edge('top', 'right'), 2)`);
  assert.match(Object.values(m.refusals).join(' '), /3 edges of the part lie between a top face and a right face/);
  assert.ok(Math.abs(m.volume - 12000) < 1e-9);
});

test('an edge that ends on material that carries on (a tray corner) refuses in a sentence', () => {
  const t = joined(`const p = box(40, 20, 10)\nconst w = box(10, 20, 30, { at: [-15, 0, 10] })\nconst b = box(40, 10, 30, { at: [0, 15, 10] })\nconst v = join(p, w, b)\nv`);
  const m = build(t.feats, t.jid, [carried(t.jid, t.feats[0].id, '+z'), carried(t.jid, t.feats[1].id, '+x')], 2, 'fillet');
  assert.match(Object.values(m.refusals).join(' '), /inside corner/);
  assert.ok(Math.abs(m.volume - m.v0) < 1e-9, 'shown without it');
});

test('a round bigger than the plate beside the wall refuses, never a wrong solid', () => {
  const L = joined(PLATE);
  const m = build(L.feats, L.jid, [carried(L.jid, L.a, '+z'), carried(L.jid, L.b, '+x')], 40, 'fillet');
  assert.equal(Object.keys(m.refusals).length, 1, JSON.stringify(m.refusals));
  assert.ok(Math.abs(m.volume - m.v0) < 1e-9);
});

test('the base of a CYLINDRICAL boss is a circle, not a straight edge: refused in a sentence', () => {
  const r = mine(`const p = box(40, 40, 10)\nconst c = cylinder(10, 20, { at: [0, 0, 15] })\nconst v = join(p, c)\nv`);
  const feats = r.r.doc.features;
  const jid = feats.at(-1).id;
  const m = build(feats, jid, [carried(jid, feats[0].id, '+z'), carried(jid, feats[1].id, 'side')], 2, 'fillet');
  assert.equal(Object.keys(m.refusals).length, 1, JSON.stringify(m.refusals));
  assert.ok(Math.abs(m.volume - m.v0) < 1e-9);
});
