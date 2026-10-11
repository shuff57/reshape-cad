// An outline with an arc (a round, a bulge, a soup arc) spun PART of a turn, either way round.
//
// This used to refuse with "an outline with an arc or a round can only be spun a full turn (360) yet". It builds now:
// `turned::build_solid_partial` takes the same turned profile the whole-turn builder takes and makes each wall a sector of
// its ring (a torus patch for an arc, a cone for a slant, a cylinder, a flat annulus sector), closes the two ends with a
// planar cap that holds the profile, and shares one edge at every junction and seam. Before it is returned the faces must
// account for Pappus' volume, ang / 2pi x the whole-turn integral, and every edge must be used by exactly two faces.
//
// Oracles, none of them a kernel number:
//   * Pappus with the textbook centroids (rectSpin: a corner piece a round takes off; segmentSpin: a circular segment) or
//     by quadrature round the outline (pappus/roundedPolygon), scaled by the turn,
//   * OpenCascade on the same script wherever it can spin it (volume to 1e-8, bounding box to 1e-6),
//   * a turn the other way is the mirror image of the turn this way (bounding box), and the same volume,
//   * the mesh must be closed at three deflections,
//   * FreeCAD 26.3rc1 on the same outlines (docs/replica/freecad/gauntlet/variants/refs, written by compare-variants.mjs):
//     volume, bounding box, face count, centre of mass.
// What must still refuse: a groove with an arc, an arc centred on the axis (a ball), and every cut, join, round or hollow of
// a part like this (it would read the sectors as whole rings), each in a sentence and with no shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeRunner } from './wrong-solid-sweep-lib.mjs';
import { rectSpin, pappus, roundedPolygon, segmentSpin } from './sketch-audit-lib.mjs';
import { stepRoundTrip, okRead, brep } from './step-readback-lib.mjs';
import { runScript } from '@shuff57/reshape-script/reshape-script';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const run = await makeRunner({ occt: true });
const PI = Math.PI;

// ---------------------------------------------------------------- helpers
/** A script built on the kernel and (when OpenCascade can spin it) on OpenCascade; checked against `volume`. */
function spun(code, volume, { needOcct = false, tol = 1e-9 } = {}) {
  const rec = run.run({ code, tags: {}, oracle: {} });
  assert.equal(rec.scriptError, undefined, `${code}\n${rec.scriptError}`);
  assert.deepEqual(rec.refusals, {}, `${code}\n${JSON.stringify(rec.refusals)}`);
  if (volume !== null) assert.ok(Math.abs(rec.brep.volume - volume) <= tol * volume, `${code}: brep ${rec.brep.volume} vs closed form ${volume}`);
  assert.equal(rec.mesh.open, 0, `mesh has open edges: ${code}`);
  assert.equal(rec.mesh.unbalanced, 0);
  // the inscribed mesh falls short by about (deflection x area): a thin sliver is mostly deficit, so the bound is the area's
  assert.ok(Math.abs(rec.mesh.meshVolume - rec.brep.volume) <= 0.02 * rec.brep.volume + 12 * rec.mesh.defl * rec.brep.volume ** (2 / 3), 'mesh volume is the solid');
  if (rec.occt) {
    assert.ok(Math.abs(rec.occt.volume - rec.brep.volume) <= 1e-8 * rec.brep.volume, `OpenCascade ${rec.occt.volume} vs ${rec.brep.volume}: ${code}`);
    const w = rec.brep.bbox.flat(), g = rec.occt.bbox.flat();
    for (let i = 0; i < 6; i++) assert.ok(Math.abs(w[i] - g[i]) <= 1e-6, `bbox ${JSON.stringify(rec.brep.bbox)} vs OpenCascade ${JSON.stringify(rec.occt.bbox)}: ${code}`);
  } else if (needOcct) assert.fail(`OpenCascade built nothing for ${code}: ${JSON.stringify(rec.occtRefusals)}`);
  return rec;
}
const FRONT = (body, turn, { plane = 'front', at = [40, 0] } = {}) => `const s = sketch('${plane}', 0)\ns.rect(30, 10, { at: [${at}] })\n${body}\nrevolve(s, ${turn})`;
const POLY = (pts, extra, turn, plane = 'front') => `const s = sketch('${plane}', 0)\ns.polygon(${JSON.stringify(pts)})\n${extra}\nrevolve(s, ${turn})`;
const ARC = (id, c, r, a, b) => ({ k: 'arc', id, c, r, a, b, sense: 'ccw' });
const LINE = (id, a, b) => ({ k: 'line', id, a, b });
const weld = (n) => Array.from({ length: n }, (_, i) => ({ k: 'coincident', a: i + 1, aEnd: 'b', b: ((i + 1) % n) + 1, bEnd: 'a' }));
const SOUP = (g, r, turn) => `const s = sketch('front', 0)\ns.geom(${JSON.stringify(g)})\ns.rules(${JSON.stringify(r)})\nrevolve(s, ${turn})`;
const segmentRows = (c, r, th) => {
  const a = [c + r * Math.cos(th / 2), -r * Math.sin(th / 2)], b = [c + r * Math.cos(th / 2), r * Math.sin(th / 2)];
  return [[ARC(1, [c, 0], r, a, b), LINE(2, b, a)], weld(2)];
};
/** The script's own doc with its revolve turned `angle` (a negative one is a turn the other way: the script layer refuses it). */
function docAt(code, angle) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const doc = structuredClone(r.doc);
  doc.features.findLast((x) => x.kind === 'revolve').angle = angle;
  return doc;
}
/** Build + measure a doc; mesh closure at three deflections. */
function built(doc) {
  const j = JSON.stringify(doc);
  const out = JSON.parse(brep.build_doc_json(j));
  assert.deepEqual(out.refusals ?? {}, {}, JSON.stringify(out.refusals));
  const id = doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(j)).shapes[id];
  const open = [0.02, 0.1, 0.5].map((d) => {
    const mesh = JSON.parse(brep.mesh_feature(j, id, d));
    const P = mesh.positions, I = mesh.indices, ids = new Map(), canon = [];
    for (let i = 0; i < P.length / 3; i++) {
      const k = `${Math.round(P[3 * i] / 1e-6)},${Math.round(P[3 * i + 1] / 1e-6)},${Math.round(P[3 * i + 2] / 1e-6)}`;
      if (!ids.has(k)) ids.set(k, ids.size);
      canon.push(ids.get(k));
    }
    const dir = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const c = [canon[I[t]], canon[I[t + 1]], canon[I[t + 2]]];
      for (let e = 0; e < 3; e++) { const a = c[e], b = c[(e + 1) % 3]; if (a !== b) dir.set(`${a}>${b}`, (dir.get(`${a}>${b}`) ?? 0) + 1); }
    }
    let bad = 0;
    for (const [k, n] of dir) { const [a, b] = k.split('>'); if ((dir.get(`${b}>${a}`) ?? 0) !== n) bad++; }
    return bad;
  });
  return { m, open };
}

// ---------------------------------------------------------------- a round on each corner of a rectangle, every plane and turn
test('a rectangle with one round, a part turn: ang/360 of the corner-piece Pappus, on every plane, OpenCascade agrees', () => {
  for (const plane of ['front', 'top', 'side']) {
    for (const k of [1, 2, 3, 4]) {
      for (const turn of [30, 90, 180, 270, 359]) {
        spun(FRONT(`s.round(${k}, 3)`, turn, { plane }), rectSpin(40, 30, 10, { [k]: ['R', 3] }) * turn / 360, { needOcct: true });
      }
    }
  }
});
test('four rounds of different sizes, and rounds with chamfers (cones and tori in one part), part of a turn', () => {
  for (const turn of [45, 200]) {
    spun(FRONT('s.round(1, 4)\ns.round(2, 3)\ns.round(3, 2)\ns.round(4, 1)', turn),
      rectSpin(40, 30, 10, { 1: ['R', 4], 2: ['R', 3], 3: ['R', 2], 4: ['R', 1] }) * turn / 360, { needOcct: true });
    spun(FRONT('s.round(1, 4)\ns.chamfer(2, 3)\ns.round(3, 2)\ns.chamfer(4, 1)', turn),
      rectSpin(40, 30, 10, { 1: ['R', 4], 2: ['C', 3], 3: ['R', 2], 4: ['C', 1] }) * turn / 360, { needOcct: true });
  }
});
test('a part turn is the whole turn scaled by the angle: nothing of the profile is lost between the walls', () => {
  const whole = spun(FRONT('s.round(1, 4)\ns.round(3, 2)', 360), rectSpin(40, 30, 10, { 1: ['R', 4], 3: ['R', 2] }), { needOcct: true }).brep.volume;
  for (const turn of [1, 7, 60, 120, 179, 181, 300, 359]) {
    const part = spun(FRONT('s.round(1, 4)\ns.round(3, 2)', turn), whole * turn / 360, { needOcct: true });
    assert.equal(part.brep.faces, 8, 'the profile\'s 6 walls (2 rounds + 4 sides) and 2 caps');
  }
});
test('an outline on the far side of the axis, rounded, part of a turn', () => {
  for (const turn of [90, 250]) {
    const far = spun(FRONT('s.round(1, 4)\ns.round(3, 2)', turn, { at: [-40, 0] }), null, { needOcct: true });
    // its mirror image about the axis is the near-side outline with the same two rounds on the mirrored corners (2 and 4)
    const near = spun(FRONT('s.round(2, 4)\ns.round(4, 2)', turn), rectSpin(40, 30, 10, { 2: ['R', 4], 4: ['R', 2] }) * turn / 360, { needOcct: true });
    assert.ok(Math.abs(far.brep.volume - near.brep.volume) <= 1e-9 * near.brep.volume, 'mirror image, same volume');
    assert.ok(Math.abs(far.brep.volume - rectSpin(40, 30, 10, { 2: ['R', 4], 4: ['R', 2] }) * turn / 360) <= 1e-9 * near.brep.volume);
  }
});
test('a polygon with a fillet at each corner in turn, by integrating the outline (tori of every orientation)', () => {
  const pts = [[20, 0], [60, 5], [55, 30], [25, 25]];
  for (const k of [0, 1, 2, 3]) {
    for (const r of [1.5, 4]) {
      for (const turn of [75, 210]) spun(POLY(pts, `s.round(${k + 1}, ${r})`, turn), pappus(roundedPolygon(pts, { [k]: r })) * turn / 360, { needOcct: true });
    }
  }
});
test('an outline that touches the axis (a solid with a rounded end), part of a turn', () => {
  const pts = [[0, 0], [30, 0], [30, 20], [0, 20]];
  for (const turn of [90, 270]) {
    spun(POLY(pts, 's.round(2, 5)\ns.round(3, 5)', turn), pappus(roundedPolygon(pts, { 1: 5, 2: 5 })) * turn / 360, { needOcct: true });
  }
});
test('a slanted side (a cone) with a round, to a point on the axis or clear of it, part of a turn', () => {
  const frustum = [[10, 0], [22, 0], [16, 30], [10, 30]];
  const cone = [[0, 0], [20, 0], [0, 30]];
  for (const turn of [30, 90, 250]) {
    spun(POLY(frustum, 's.round(3, 3)', turn), pappus(roundedPolygon(frustum, { 2: 3 })) * turn / 360, { needOcct: true });
    spun(POLY(frustum, 's.round(2, 4)\ns.round(3, 3)', turn), pappus(roundedPolygon(frustum, { 1: 4, 2: 3 })) * turn / 360, { needOcct: true });
    spun(POLY(cone, 's.round(2, 4)', turn), pappus(roundedPolygon(cone, { 1: 4 })) * turn / 360, { needOcct: true });
  }
});
test('a sketch lifted along the axis spins to the same volume', () => {
  spun("const s = sketch('top', 7)\ns.rect(30, 10, { at: [40, 3] })\ns.round(1, 4)\nrevolve(s, 100)", rectSpin(40, 30, 10, { 1: ['R', 4] }) * 100 / 360, { needOcct: true });
});

// ---------------------------------------------------------------- soup arcs: a circular segment, a rounded end
test('a circular segment (soup arc + chord) spun part of a turn: ang/360 x 2 pi (c + d) x area', () => {
  for (const [c, r, th] of [[30, 10, PI], [30, 10, PI / 2], [25, 8, 2.9], [40, 12, 0.6], [30, 10, 4.2], [12, 10, PI]]) {
    const [g, ru] = segmentRows(c, r, th);
    for (const turn of [60, 200, 300]) spun(SOUP(g, ru, turn), segmentSpin(c, r, th) * turn / 360, { tol: 1e-9 });
  }
});
test('a soup rectangle with a rounded end: a rectangle and a half disc in one outline', () => {
  const g = [LINE(1, [20, -5], [40, -5]), ARC(2, [40, 0], 5, [40, -5], [40, 5]), LINE(3, [40, 5], [20, 5]), LINE(4, [20, 5], [20, -5])];
  const full = 2 * PI * 30 * (20 * 10) + 2 * PI * (40 + 4 * 5 / (3 * PI)) * (PI * 25 / 2);
  for (const turn of [45, 180]) spun(SOUP(g, weld(4), turn), full * turn / 360);
});

// ---------------------------------------------------------------- the other way round
test('a turn the other way is the mirror image of the turn this way: same volume, bounding box mirrored about the axis plane', () => {
  const cases = [
    ["const s = sketch('top')\ns.rect(10, 30, { at: [15, 15] })\ns.round(3, 3)\nrevolve(s, 90)", 'top'],
    ["const s = sketch('top')\ns.polygon([[10,0],[22,0],[16,30],[10,30]])\ns.round(3, 3)\nrevolve(s, 90)", 'top'],
  ];
  for (const [code] of cases) {
    for (const turn of [30, 90, 135, 200, 270, 359]) {
      const a = built(docAt(code, turn)), b = built(docAt(code, -turn));
      assert.ok(Math.abs(a.m.volume - b.m.volume) <= 1e-9 * a.m.volume, `${turn}: ${a.m.volume} vs ${b.m.volume}`);
      assert.deepEqual(a.open, [0, 0, 0]);
      assert.deepEqual(b.open, [0, 0, 0]);
      // axis z: the mirror image about the plane y = 0
      const [[ax0, ay0, az0], [ax1, ay1, az1]] = a.m.bbox, [[bx0, by0, bz0], [bx1, by1, bz1]] = b.m.bbox;
      for (const [x, y] of [[ax0, bx0], [ax1, bx1], [az0, bz0], [az1, bz1], [-ay1, by0], [-ay0, by1]]) assert.ok(Math.abs(x - y) <= 1e-9, `${turn}: bbox ${JSON.stringify(a.m.bbox)} vs ${JSON.stringify(b.m.bbox)}`);
    }
  }
});
test('every whole angle, both ways round, of a rounded ring builds closed at three deflections', () => {
  const code = "const s = sketch('top')\ns.rect(10, 30, { at: [15, 15] })\ns.round(3, 3)\ns.round(1, 2)\nrevolve(s, 90)";
  const whole = built(docAt(code, 360)).m.volume;
  for (let a = 1; a <= 359; a += 11) {
    for (const sgn of [1, -1]) {
      const r = built(docAt(code, sgn * a));
      assert.ok(Math.abs(r.m.volume - whole * a / 360) <= 1e-9 * whole, `${sgn * a}: ${r.m.volume} vs ${whole * a / 360}`);
      assert.deepEqual(r.open, [0, 0, 0], `open edges at ${sgn * a}`);
    }
  }
});

// ---------------------------------------------------------------- STEP: OpenCascade reads it back valid, one solid, same volume
function readsBack(name, code, angle, closedForm) {
  test(`STEP reads back in OpenCascade: ${name}, ${angle} degrees`, () => {
    const r = stepRoundTrip(docAt(code, angle));
    assert.equal(r.buildRefused, undefined, JSON.stringify(r.buildRefused));
    assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
    assert.equal(r.bad, undefined, r.bad);
    assert.equal(r.got.valid, true, 'BRepCheck says the read-back shape is valid');
    assert.equal(r.got.solids, 1, 'one solid');
    assert.ok(okRead(r), JSON.stringify({ got: r.got, want: r.want, dv: r.dv, db: r.db }));
    if (closedForm) {
      const want = closedForm * Math.abs(angle) / 360;
      assert.ok(Math.abs(r.got.volume - want) <= 1e-6 * want, `read-back ${r.got.volume} vs closed form ${want}`);
      assert.ok(Math.abs(r.want.volume - want) <= 1e-9 * want, `brep-rs ${r.want.volume} vs closed form ${want}`);
    }
  });
}
const ROUNDED = "const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); sk.round(2, 3); revolve(sk, 90);";
const ROUNDED_FULL = rectSpin(15, 10, 30, { 2: ['R', 3] });
for (const a of [30, 90, 120, 270, -90, -30, -120, -270, 359]) readsBack('a rounded ring', ROUNDED, a, ROUNDED_FULL);
const FOUR = "const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); sk.round(1, 2); sk.round(2, 3); sk.round(3, 2); sk.round(4, 1); revolve(sk, 90);";
for (const a of [90, -90, 200]) readsBack('a ring with four rounds', FOUR, a, rectSpin(15, 10, 30, { 1: ['R', 2], 2: ['R', 3], 3: ['R', 2], 4: ['R', 1] }));
const MIXED = "const sk = sketch('top'); sk.rect(10, 30, { at: [15, 15] }); sk.round(1, 2); sk.chamfer(3, 3); revolve(sk, 90);";
for (const a of [90, -90, 250]) readsBack('a round and a chamfer', MIXED, a, rectSpin(15, 10, 30, { 1: ['R', 2], 3: ['C', 3] }));
const AXIS = "const sk = sketch('top'); sk.polygon([[0, 0], [30, 0], [30, 20], [0, 20]]); sk.round(2, 5); sk.round(3, 5); revolve(sk, 90);";
for (const a of [90, -90, 200]) readsBack('an outline touching the axis', AXIS, a, pappus(roundedPolygon([[0, 0], [30, 0], [30, 20], [0, 20]], { 1: 5, 2: 5 })));
const FAR = "const sk = sketch('front'); sk.rect(10, 20, { at: [-10, 10] }); sk.round(1, 3); sk.round(3, 2); spin(sk, 90);";
for (const a of [90, -90]) readsBack('an outline on the far side of the axis', FAR, a, null);
const CONE = "const sk = sketch('top'); sk.polygon([[0, 0], [30, 0], [30, 10], [10, 20], [0, 20]]); sk.round(3, 3); revolve(sk, 90);";
for (const a of [90, -90]) readsBack('a slanted side meeting the axis, with a round', CONE, a, pappus(roundedPolygon([[0, 0], [30, 0], [30, 10], [10, 20], [0, 20]], { 2: 3 })));
const TIP = "const sk = sketch('top'); sk.polygon([[0, 0], [20, 0], [0, 30]]); sk.round(2, 4); revolve(sk, 90);";
for (const a of [30, 90, -90, 250]) readsBack('a cone to a point on the axis, base corner rounded', TIP, a, pappus(roundedPolygon([[0, 0], [20, 0], [0, 30]], { 1: 4 })));

// ---------------------------------------------------------------- what is still refused, in a sentence
function refusedSentence(code) {
  const rec = run.run({ code, tags: {} }, { occt: false });
  const sentence = Object.values(rec.refusals ?? {}).join(' | ');
  assert.ok(sentence, `expected a refusal, got a solid: ${code}\n${JSON.stringify(rec.brep)}`);
  assert.equal(rec.brep, undefined, 'a refused feature carries no shape');
  return sentence;
}
/** The refusal sentence of a script whose revolve angle is patched to `angle` (the script layer itself will not take a negative one). */
function refusedAt(code, angle) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const doc = structuredClone(r.doc);
  doc.features.findLast((f) => f.kind === 'revolve').angle = angle;
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  const sentence = Object.values(out.refusals ?? {}).join(' | ');
  assert.ok(sentence, `expected a refusal at ${angle}, got a solid: ${code}`);
  return sentence;
}
const PART = "const s = sketch('top')\ns.rect(10, 30, { at: [15, 15] })\ns.round(3, 3)\nconst r = revolve(s, 100)\n";
test('a groove with an outline with an arc is still not built, part of a turn or not', () => {
  for (const turn of [90, 360]) {
    assert.match(refusedSentence(`const c = cylinder(120, 40)\nconst s = sketch('front', 0)\ns.rect(30, 10, { at: [40, 0] })\ns.round(1, 4)\ngroove(s, c, ${turn})`), /groove.*curved outline/);
  }
});
test('an arc centred on the axis is part of a ball: refused, part of a turn too', () => {
  const [g, ru] = segmentRows(0, 10, PI);
  assert.match(refusedSentence(SOUP(g, ru, 90)), /spins into part of a ball.*sphere\(\)/);
});
test('cutting, joining, rounding, drilling, hollowing or pulling onto a part turn of a curved outline says so, in a sentence', () => {
  const sentence = /was spun only part of a turn from an outline with a curve or a slant in it, and brep-rs can only move, copy or mirror a part like that yet/;
  assert.match(refusedSentence(PART + 'union(r, box(5, 5, 5))'), sentence);
  assert.match(refusedSentence(PART + 'cut(r, box(5, 5, 5, { at: [15, 0, 10] }))'), sentence);
  assert.match(refusedSentence(PART + 'hole(r, { across: 4, deep: 20, at: [15, 0] })'), sentence);
  assert.match(refusedSentence(PART + "const s2 = sketch('top', 30)\ns2.circle(4, { at: [15, 0] })\npocket(s2, r, 5)"), sentence);
  assert.match(refusedSentence(PART + 'hollow(r, { wall: 1 })'), sentence);
  assert.match(refusedSentence(PART + "fillet(r.edge('top', 'front'), 1)"), sentence);
  // the same outline spun a whole turn never meets this sentence: whatever the kernel says about it, it is not that one
  const whole = run.run({ code: PART.replace('revolve(s, 100)', 'revolve(s, 360)') + 'cut(r, box(5, 5, 5, { at: [15, 0, 10] }))', tags: {} }, { occt: false });
  assert.doesNotMatch(Object.values(whole.refusals ?? {}).join(' | '), sentence);
});
test('moving, mirroring and patterning a part turn of a curved outline are exact', () => {
  const base = spun(PART + 'r', null).brep;
  for (const tail of ['move(r, [5, 7, 3])', "mirror(r, 'top-bottom')", 'linearPattern(r, { count: 2, step: [60, 0, 0] })']) {
    const rec = run.run({ code: PART + tail, tags: {} }, { occt: true });
    assert.deepEqual(rec.refusals, {}, tail);
    const copies = tail.startsWith('move') ? 1 : 2;
    assert.ok(Math.abs(rec.brep.volume - copies * base.volume) <= 1e-9 * base.volume, tail);
    assert.equal(rec.mesh.open, 0, tail);
    if (rec.occt) assert.ok(Math.abs(rec.occt.volume - rec.brep.volume) <= 1e-8 * rec.brep.volume, tail);
  }
});

test('a part turn of a rounded outline, then turned off the axes, is drawn: every turn() meshes closed at three deflections', () => {
  // the two seams of a sector are the same meridian but each is its own edge: after a tilt their samples sit on other phases
  const base = "const s = sketch('front', 0)\ns.rect(30, 10, { at: [40, 0] })\ns.round(1, 3)\n";
  const whole = spun(base + 'revolve(s, 360)', null).brep.volume;
  for (const turn of [120, 330]) {
    for (const t of ['[0,0,45]', '[0,0,5]', '[0,0,30]', '[0,0,60]', '[30,0,0]', '[1,0,0]', '[0,45,0]', '[20,35,50]']) {
      const rec = spun(base + `const a = revolve(s, ${turn})\nturn(a, ${t})`, whole * turn / 360, { needOcct: false, tol: 1e-9 });
      assert.deepEqual(rec.refusals, {}, t);
    }
  }
  // and meshed directly at three deflections, not just the runner's own
  const r = runScript(base + 'const a = revolve(s, 120)\nturn(a, [0, 0, 45])');
  assert.deepEqual(r.errors, []);
  const j = JSON.stringify(r.doc);
  for (const d of [0.01, 0.05, 0.5]) assert.ok(!JSON.parse(brep.mesh_feature(j, r.doc.features.at(-1).id, d)).error, `meshes at ${d}`);
});
test('an outline whose arc leaves a corner on the far side of the line and crosses it again is refused as crossing, not built open', () => {
  const g = [LINE(1, [16.27387982120707, -22.63780188248133], [29.93431909295401, -16.376168179020823]),
    LINE(2, [29.93431909295401, -16.376168179020823], [19.458312735990113, -9.99480163320743]),
    { k: 'arc', id: 3, c: [14.06746036548752, -15.359527179461962], r: 7.6053645190213865, a: [19.458312735990113, -9.99480163320743], b: [16.27387982120707, -22.63780188248133], sense: 'cw' }];
  for (const turn of [45, 90, 270, 360]) assert.match(refusedSentence(SOUP(g, weld(3), turn)), /two of its edges cross each other/);
  assert.match(refusedSentence(`const s = sketch('front', 0)\ns.geom(${JSON.stringify(g)})\ns.rules(${JSON.stringify(weld(3))})\nextrude(s, 10)`), /two of its edges cross each other/);
});
test('a spin a hair off the axis, or a sliver of a turn, is refused in a sentence rather than built undrawable', () => {
  assert.match(refusedSentence(FRONT('s.round(2, 3)', 100, { at: [15 + 1e-7, 0] })), /a hair's width from the axis/);
  for (const turn of [1e-6, 0.001, 359.999999]) assert.match(refusedSentence(FRONT('s.round(2, 3)', turn)), /close to no turn, or to a whole turn/);
  // a rect with its edge exactly on the axis, and a turn that is small but not a sliver, still build
  spun(FRONT('s.round(2, 3)', 100, { at: [15, 0] }), null);
  spun(FRONT('s.round(2, 3)', 0.5), null);
});

// A circular segment whose arc only touches the axis is a horn torus: nothing can mesh it or write it to STEP, so a part turn
// of it must refuse in a sentence (it used to build with no refusal and no picture).
test('an arc tangent to the spin axis refuses for a part turn, as it does for a whole one', () => {
  const r = 10, c = 10, th = 1;
  const a = [c - r * Math.cos(th), -r * Math.sin(th)], b = [c - r * Math.cos(th), r * Math.sin(th)];
  const g = [{ k: 'arc', id: 1, c: [c, 0], r, a: b, b: a, sense: 'ccw' }, LINE(2, a, b)];
  for (const turn of [360, 45, 90, 180, 270, 359.9]) {
    assert.match(refusedSentence(SOUP(g, weld(2), turn)), /cannot be spun|too thin to draw|hair's width|close to no turn/, `turn ${turn}`);
  }
  for (const turn of [-45, -90, -270]) assert.match(refusedAt(SOUP(g, weld(2), 90), turn), /cannot be spun/, `turn ${turn}`);
});

// The mesh closes only while the thinnest ring's width (radius x angle) is above what the sampling can resolve, so a sliver
// by THICKNESS refuses, not by angle alone. Each shape closes at a turn wide enough and refuses below.
test('a part turn too thin at its thinnest ring refuses, and the same shape a little wider builds closed', () => {
  for (const k of [0.05, 0.1, 0.3]) {
    const pts = [[0.5 * k, 0], [6 * k, 0], [6 * k, 4 * k], [0.5 * k, 4 * k]];
    for (const turn of [0.02, 0.05]) {
      assert.match(refusedSentence(POLY(pts, `s.round(3, ${k})`, turn, 'top')), /sliver too thin to draw/, `k ${k} turn ${turn}`);
    }
    assert.match(refusedAt(POLY(pts, `s.round(3, ${k})`, 90, 'top'), -0.02), /sliver too thin to draw/, `k ${k} turn -0.02`);
  }
  // 0.5 radius at 10 degrees is a 0.087 mm ring: well past the limit, closed
  spun(POLY([[0.5, 0], [6, 0], [6, 4], [0.5, 4]], 's.round(3, 1)', 10, 'top'), null);
});

// A partial turn used to bring every pcurve onto the same turn with `while` loops that also ran on planar caps, whose (u, v)
// are millimetres: iterations went with coordinate / 2pi, so a coordinate of 1e12 froze the tab.
test('a part turn at huge coordinates builds (or refuses) at once and stays closed', () => {
  for (const k of [1e3, 1e9, 1e12, 1e15]) {
    const r = runScript(`const s = sketch('top', 0)\ns.polygon(${JSON.stringify([[0.5 * k, 0], [6 * k, 0], [6 * k, 4 * k], [0.5 * k, 4 * k]])})\ns.round(3, ${k})\nrevolve(s, 90)`);
    assert.deepEqual(r.errors, []);
    for (const ang of [90, -90]) {
      const doc = structuredClone(r.doc);
      doc.features.findLast((f) => f.kind === 'revolve').angle = ang;
      const j = JSON.stringify(doc), id = doc.features.at(-1).id;
      const t0 = Date.now();
      const out = JSON.parse(brep.build_doc_json(j));
      JSON.parse(brep.measure_doc(j));
      JSON.parse(brep.mesh_feature(j, id, 0.01 * k));
      assert.ok(Date.now() - t0 < 2000, `k ${k} ang ${ang}: ${Date.now() - t0} ms`);
      assert.deepEqual(out.refusals ?? {}, {}, `k ${k}`);
    }
  }
});

// ---------------------------------------------------------------- FreeCAD: the same outlines, spun by PartDesign::Revolution
// The references are written by variants/compare-variants.mjs (a headless FreeCAD 26.3rc1 per variant); a missing record
// skips, so the suite never needs FreeCAD installed. ours: the variant's script (a turn the other way: the same script with
// its revolve patched, because the script layer refuses a negative angle in a sentence).
const VARIANTS_DIR = path.join(REPO, 'docs/replica/freecad/gauntlet/variants');
const defs = existsSync(path.join(VARIANTS_DIR, 'defs.mjs')) ? await import(pathToFileURL(path.join(VARIANTS_DIR, 'defs.mjs')).href) : null;
for (const v of defs?.VARIANTS ?? []) {
  if (!v.id.startsWith('revolution__arc-')) continue;
  const refFile = path.join(VARIANTS_DIR, 'refs', `ref-${v.id}.json`);
  test(`FreeCAD agrees: ${v.id}`, { skip: !existsSync(refFile) && 'no FreeCAD reference record' }, () => {
    const ref = JSON.parse(readFileSync(refFile, 'utf8'));
    assert.equal(ref.ok, true, 'FreeCAD built it');
    const r = runScript(v.ours);
    assert.deepEqual(r.errors, [], v.ours);
    const doc = structuredClone(r.doc);
    if (v.patch) Object.assign(doc.features.find((f) => f.kind === v.patch.kind), v.patch.set);
    const { m, open } = built(doc);
    assert.deepEqual(open, [0, 0, 0]);
    assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${m.volume} vs FreeCAD ${ref.volume}`);
    const w = m.bbox.flat();
    for (let i = 0; i < 6; i++) assert.ok(Math.abs(w[i] - ref.bbox[i]) <= 1e-6, `bbox ${JSON.stringify(m.bbox)} vs FreeCAD ${JSON.stringify(ref.bbox)}`);
    assert.equal(m.faces, ref.faces, 'face count');
    // centre of mass from the tessellation (FreeCAD's is exact: 0.02 mm at deflection 0.01)
    const id = doc.features.at(-1).id;
    const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), id, 0.01));
    let vol = 0, cx = 0, cy = 0, cz = 0;
    const P = mesh.positions, I = mesh.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const d = P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
      vol += d / 6;
      cx += d / 24 * (P[a] + P[b] + P[c]); cy += d / 24 * (P[a + 1] + P[b + 1] + P[c + 1]); cz += d / 24 * (P[a + 2] + P[b + 2] + P[c + 2]);
    }
    for (const [i, x] of [cx / vol, cy / vol, cz / vol].entries()) assert.ok(Math.abs(x - ref.com[i]) <= 0.02, `centre of mass ${[cx / vol, cy / vol, cz / vol]} vs FreeCAD ${ref.com}`);
  });
}

// ---------------------------------------------------------------- a round that ends a fraction of a degree past its bottom
// Open at coarse deflections with no refusal: the round's last row sat within the rim chord's sagitta of the junction circle
// it shares with the cone, the zipper folded, and each triangle wound by its own normal turned against its neighbours.
// The sector band now winds by (u, v). The mesh must close at every deflection, not only the three `built` checks.
test('a round ending 0.3 degrees past the bottom of its circle, then a cone: closed at every deflection and turn', () => {
  const rows = [
    // [centre x, radius, start point, end point, tip]
    [38, 6, [43.76757017562991, 1.653824134901995], [38.03141578298852, -5.99991775348456], [36.5, -14]],
    [60, 15, [60 + 15 * Math.cos(0.35), 15 * Math.sin(0.35)], [60 + 15 * Math.cos(-89.7 * PI / 180), 15 * Math.sin(-89.7 * PI / 180)], [56, -40]],
  ];
  for (const [cx, r, a, b, tip] of rows) {
    const code = SOUP([ARC(1, [cx, 0], r, a, b), LINE(2, b, tip), LINE(3, tip, a)], weld(3), 90).replace("sketch('front', 0)", "sketch('top', 0)");
    for (const turn of [10, 90, 180, 200, 250, 300, 340, 350, 359.5, -90, -250]) {
      const doc = docAt(code, turn);
      const j = JSON.stringify(doc);
      const out = JSON.parse(brep.build_doc_json(j));
      assert.deepEqual(out.refusals ?? {}, {}, JSON.stringify(out.refusals));
      const id = doc.features.at(-1).id;
      for (const d of [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5]) {
        const mesh = JSON.parse(brep.mesh_feature(j, id, d));
        const P = mesh.positions, I = mesh.indices, ids = new Map(), canon = [];
        for (let i = 0; i < P.length / 3; i++) {
          const k = `${Math.round(P[3 * i] / 1e-6)},${Math.round(P[3 * i + 1] / 1e-6)},${Math.round(P[3 * i + 2] / 1e-6)}`;
          if (!ids.has(k)) ids.set(k, ids.size);
          canon.push(ids.get(k));
        }
        const dir = new Map();
        for (let t = 0; t < I.length; t += 3) {
          const c = [canon[I[t]], canon[I[t + 1]], canon[I[t + 2]]];
          for (let e = 0; e < 3; e++) { const x = c[e], y = c[(e + 1) % 3]; if (x !== y) dir.set(`${x}>${y}`, (dir.get(`${x}>${y}`) ?? 0) + 1); }
        }
        let bad = 0;
        for (const [k, n] of dir) { const [x, y] = k.split('>'); if ((dir.get(`${y}>${x}`) ?? 0) !== n) bad++; }
        assert.equal(bad, 0, `open edges: centre ${cx}, turn ${turn}, deflection ${d}`);
      }
    }
  }
});
