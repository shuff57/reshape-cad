// W3 sketch leftovers: revolve takes the same outline checks a pull does, and builds a rounded or arced outline
// exactly. Every volume here is Pappus's second theorem, 2 pi x (distance of the area's centroid from the axis) x area, worked
// out below from the textbook centroids (a rectangle, a triangle, the corner piece a round or a chamfer takes off, a
// circular segment) or by integrating pi x^2 dy round the outline (`pappus`, a quadrature that reads no kernel number).
// brep-rs is held to it; OpenCascade is the second referee wherever it can spin the sketch (it cannot spin soup rows);
// the mesh must be closed.
//
// What each refusal below used to be: a bow-tie and a zero-area outline were "supports only profiles parallel or
// perpendicular to the axis", a pinch and an outline across the axis built a solid (the second one the union of the
// two sides, which is not what was drawn), and a round was spun as a CHAMFER (the chord), a wrong solid that OpenCascade's
// own reference path reproduced and so agreed with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRunner, classify, pappus, roundedPolygon, rectSpin, segmentSpin } from './sketch-audit-lib.mjs';
import { runScript } from '@shuff57/reshape-script/reshape-script';

const run = await makeRunner({ occt: true });
const PI = Math.PI;

// ---------------------------------------------------------------- helpers
function spun(code, volume, { needOcct = false, tol = 1e-9 } = {}) {
  const rec = run.run({ code, tags: {}, oracle: { exactVolume: volume } });
  const c = classify(rec);
  assert.deepEqual(rec.refusals, {}, `${code}\n${JSON.stringify(rec.refusals)}`);
  assert.ok(['AGREE', 'AGREE-ANALYTIC-ONLY', ...(needOcct ? [] : ['OCCT-REFUSED'])].includes(c.cls), `${c.cls} ${JSON.stringify(c.wrong ?? c.detail)}\n${code}`);
  assert.ok(Math.abs(rec.brep.volume - volume) <= tol * volume, `${code}: brep ${rec.brep.volume} vs Pappus ${volume}`);
  assert.equal(rec.mesh.open, 0, `mesh has open edges: ${code}`);
  assert.equal(rec.mesh.unbalanced, 0);
  if (needOcct) assert.ok(rec.occt, `OpenCascade built nothing for ${code}`);
  return rec;
}
function refused(code, re) {
  const rec = run.run({ code, tags: {} }, { occt: false });
  const sentence = Object.values(rec.refusals ?? {}).join(' | ');
  assert.ok(sentence, `expected a refusal, got a solid: ${code}\n${JSON.stringify(rec.brep)}`);
  assert.match(sentence, re, code);
  assert.equal(rec.brep, undefined, 'a refused feature must carry no shape');
  return sentence;
}
const FRONT = (body, turn = 360, at = [40, 0]) => `const s = sketch('front', 0)\ns.rect(30, 10, { at: [${at}] })\n${body}\nrevolve(s, ${turn})`;
const POLY = (pts, extra = '', plane = 'front') => `const s = sketch('${plane}', 0)\ns.polygon(${JSON.stringify(pts)})\n${extra}\nrevolve(s, 360)`;
const SOUP = (g, r, turn = 360, verb = 'revolve(s, ' + turn + ')') => `const s = sketch('front', 0)\ns.geom(${JSON.stringify(g)})\ns.rules(${JSON.stringify(r)})\n${verb}`;
const warnings = (code) => runScript(code).warnings ?? [];
const weld = (n) => Array.from({ length: n }, (_, i) => ({ k: 'coincident', a: i + 1, aEnd: 'b', b: ((i + 1) % n) + 1, bEnd: 'a' }));

// ---------------------------------------------------------------- straight outlines: Pappus, OCCT, mesh
test('rectangle: 2 pi x centroid x area, on every plane, OpenCascade agrees', () => {
  for (const plane of ['front', 'top', 'side']) {
    const code = `const s = sketch('${plane}', 0)\ns.rect(30, 10, { at: [40, 0] })\nrevolve(s, 360)`;
    spun(code, rectSpin(40, 30, 10), { needOcct: true });
  }
});
test('a rectangle off the sketch plane origin spins to the same volume', () =>
  spun("const s = sketch('front', 7)\ns.rect(30, 10, { at: [40, 3] })\nrevolve(s, 360)", rectSpin(40, 30, 10), { needOcct: true }));
test('triangle and trapezoid (cones) by the textbook centroid', () => {
  const tri = [[20, 0], [50, 0], [20, 30]];
  const A = 450, cx = (20 + 50 + 20) / 3;
  spun(POLY(tri), 2 * PI * cx * A, { needOcct: true });
  const trap = [[10, 0], [40, 0], [30, 20], [10, 20]];
  spun(POLY(trap), pappus(roundedPolygon(trap)), { needOcct: true });
});
test('an outline wholly on the far side of the axis spins to the same volume as its mirror image', () => {
  spun(FRONT('', 360, [-40, 0]), rectSpin(40, 30, 10), { needOcct: true });
  spun(FRONT('s.round(1, 3)', 360, [-40, 0]), rectSpin(40, 30, 10, { 2: ['R', 3] }), { needOcct: true });
});
test('an outline that only touches the axis builds (a full cylinder), and one corner on the axis builds (a cone)', () => {
  spun(POLY([[0, 0], [20, 0], [20, 10], [0, 10]]), PI * 400 * 10, { needOcct: true });
  // a frustum with one side on the axis: radius 20 at the bottom, 10 at the top
  spun(POLY([[0, 0], [20, 0], [10, 15], [0, 15]]), PI * 15 / 3 * (400 + 200 + 100), { needOcct: true });
});
test('part of a turn is that part of the full volume (straight outline)', () => {
  for (const turn of [90, 180, 270]) spun(FRONT('', turn), rectSpin(40, 30, 10) * turn / 360, { needOcct: true, tol: 1e-6 });
});

// ---------------------------------------------------------------- rounds and chamfers: a torus, not a chord
test('a round on each corner of the rectangle: below, at and beyond the maximum (5, half the short side)', () => {
  for (const k of [1, 2, 3, 4]) {
    for (const r of [0.5, 3, 5]) spun(FRONT(`s.round(${k}, ${r})`), rectSpin(40, 30, 10, { [k]: ['R', r] }), { needOcct: true });
    const code = FRONT(`s.round(${k}, 9)`);
    spun(code, rectSpin(40, 30, 10, { [k]: ['R', 5] }), { needOcct: true });
    assert.equal(warnings(code).length, 1);
    assert.match(warnings(code)[0], new RegExp(`more than corner ${k} has room for, so it was made 5 instead`));
  }
});
test('a round is NOT a chamfer: the volumes differ by the sliver between the arc and the chord', () => {
  const round = spun(FRONT('s.round(1, 4)'), rectSpin(40, 30, 10, { 1: ['R', 4] }), { needOcct: true }).brep.volume;
  const chamfer = spun(FRONT('s.chamfer(1, 4)'), rectSpin(40, 30, 10, { 1: ['C', 4] }), { needOcct: true }).brep.volume;
  assert.ok(round - chamfer > 100, `${round} vs ${chamfer}`);
});
test('four rounds of different sizes, and a mix of rounds and chamfers', () => {
  spun(FRONT('s.round(1, 4)\ns.round(2, 3)\ns.round(3, 2)\ns.round(4, 1)'),
    rectSpin(40, 30, 10, { 1: ['R', 4], 2: ['R', 3], 3: ['R', 2], 4: ['R', 1] }), { needOcct: true });
  spun(FRONT('s.round(1, 4)\ns.chamfer(2, 3)\ns.round(3, 2)\ns.chamfer(4, 1)'),
    rectSpin(40, 30, 10, { 1: ['R', 4], 2: ['C', 3], 3: ['R', 2], 4: ['C', 1] }), { needOcct: true });
});
test('chamfers on every corner, below and beyond the shorter side', () => {
  for (const d of [1, 4, 10]) spun(FRONT([1, 2, 3, 4].map((k) => `s.chamfer(${k}, ${d})`).join('\n')), rectSpin(40, 30, 10, { 1: ['C', Math.min(d, 5)], 2: ['C', Math.min(d, 5)], 3: ['C', Math.min(d, 5)], 4: ['C', Math.min(d, 5)] }), { needOcct: d < 5 });
});
test('a convex polygon with one fillet, by integrating the outline (tori of every orientation)', () => {
  const pts = [[20, 0], [60, 5], [55, 30], [25, 25]];
  for (const k of [0, 1, 2, 3]) for (const r of [1.5, 4]) {
    spun(POLY(pts, `s.round(${k + 1}, ${r})`), pappus(roundedPolygon(pts, { [k]: r })), { needOcct: true, tol: 1e-9 });
  }
});
test('a rounded outline that sits right against the axis (a corner on it) builds', () => {
  const pts = [[0, 0], [30, 0], [30, 20], [0, 20]];
  spun(POLY(pts, 's.round(2, 5)\ns.round(3, 5)'), pappus(roundedPolygon(pts, { 1: 5, 2: 5 })), { needOcct: true });
});
test('the same rounded part spun from each of the three planes', () => {
  for (const plane of ['front', 'top', 'side']) {
    spun(`const s = sketch('${plane}', 0)\ns.rect(30, 10, { at: [40, 0] })\ns.round(1, 4)\ns.round(3, 2)\nrevolve(s, 360)`,
      rectSpin(40, 30, 10, { 1: ['R', 4], 3: ['R', 2] }), { needOcct: true });
  }
});

// ---------------------------------------------------------------- soup arcs
const ARC = (id, c, r, a, b) => ({ k: 'arc', id, c, r, a, b, sense: 'ccw' });
const LINE = (id, a, b) => ({ k: 'line', id, a, b });
function segmentRows(c, r, th) {
  const a = [c + r * Math.cos(th / 2), -r * Math.sin(th / 2)], b = [c + r * Math.cos(th / 2), r * Math.sin(th / 2)];
  return [[ARC(1, [c, 0], r, a, b), LINE(2, b, a)], weld(2)];
}
test('a circular segment (soup arc + chord) spun about an axis clear of it: 2 pi (c + d) x area', () => {
  for (const [c, r, th] of [[30, 10, PI], [30, 10, PI / 2], [25, 8, 2.9], [40, 12, 0.6], [30, 10, 4.2]]) {
    const [g, ru] = segmentRows(c, r, th);
    spun(SOUP(g, ru), segmentSpin(c, r, th), { tol: 1e-9 });
  }
});
test('a half disc beside the axis, and one touching it with its flat side on the axis side', () => {
  // arc on the right of the centre c, flat side at u = c; the circle reaches back to u = c - r
  const [g, ru] = segmentRows(12, 10, PI);
  spun(SOUP(g, ru), segmentSpin(12, 10, PI));
});
test('a clockwise soup arc spins to the same volume', () => {
  const c = 30, r = 10, th = 1.7;
  const a = [c + r * Math.cos(th / 2), -r * Math.sin(th / 2)], b = [c + r * Math.cos(th / 2), r * Math.sin(th / 2)];
  spun(SOUP([{ k: 'arc', id: 1, c: [c, 0], r, a: b, b: a, sense: 'cw' }, LINE(2, a, b)], weld(2)), segmentSpin(c, r, th));
});
test('a soup rectangle with a rounded end: a rectangle, a half disc, in one outline', () => {
  // flat at u = 20..40 on the bottom and top, a semicircular end of radius 5 centred (40, 0) bulging to u = 45
  const g = [LINE(1, [20, -5], [40, -5]), ARC(2, [40, 0], 5, [40, -5], [40, 5]), LINE(3, [40, 5], [20, 5]), LINE(4, [20, 5], [20, -5])];
  const rect = 2 * PI * 30 * (20 * 10);
  const half = 2 * PI * (40 + 4 * 5 / (3 * PI)) * (PI * 25 / 2);
  spun(SOUP(g, weld(4)), rect + half);
});

// ---------------------------------------------------------------- what a spin must say no to, in a sentence
test('self-crossing, zero-area, pinched and spiked outlines are refused for spinning, as for pulling', () => {
  refused(POLY([[20, 0], [40, 10], [40, 0], [20, 10]]), /cannot be spun.*cross each other/);
  refused(POLY([[20, 0], [30, 0], [40, 0]]), /cannot be spun.*no area/);
  refused(POLY([[20, 0], [40, 0], [40, 10], [30, 0], [20, 10]]), /cannot be spun.*touch where they should not/);
  refused(POLY([[20, 0], [30, 0], [30, 10], [20, 0], [30, 0]]), /cannot be spun.*(touch where they should not|runs back over)/);
  refused(POLY([[20, 0], [40, 40], [40, 0], [20, 40]]), /cannot be spun.*cross each other/);
});
test('an outline that crosses the axis is refused: the two sides would overlap', () => {
  refused(POLY([[-10, 0], [20, 0], [20, 10], [-10, 10]]), /crosses the axis it spins about/);
  refused(POLY([[-1, 0], [30, 0], [30, 10], [-1, 10]]), /crosses the axis/);
  // an arc that bulges across the axis while both its ends stay on one side
  const g = [ARC(1, [3, 0], 10, [3, 10], [3, -10]), LINE(2, [3, -10], [3, 10])];
  refused(SOUP(g, weld(2)), /crosses the axis/);
  const g2 = [ARC(1, [3, 0], 10, [-7, 0], [3, 10]), LINE(2, [3, 10], [-7, 0])];
  refused(SOUP(g2, weld(2)), /crosses the axis/);
});
test('an arc whose centre is on the axis (a ball) says so instead of building a wrong solid', () => {
  const [g, ru] = segmentRows(0, 10, PI);
  refused(SOUP(g, ru), /spins into part of a ball.*sphere\(\)/);
});
test('an outline with an arc or a round spins a full turn only, and a groove with one is not built yet', () => {
  refused(FRONT('s.round(1, 4)', 90), /full turn \(360\)/);
  const [g, ru] = segmentRows(30, 10, PI);
  refused(SOUP(g, ru, 180), /full turn \(360\)/);
  refused(`const c = cylinder(120, 40)\nconst s = sketch('front', 0)\ns.rect(30, 10, { at: [40, 0] })\ns.round(1, 4)\nconst g = groove(s, c, 360)`, /groove.*curved outline/);
});
test('an outline with a hole in it is refused for spinning, in a sentence', () => {
  const g = [LINE(1, [20, 0], [60, 0]), LINE(2, [60, 0], [60, 30]), LINE(3, [60, 30], [20, 30]), LINE(4, [20, 30], [20, 0]),
    LINE(5, [30, 10], [50, 10]), LINE(6, [50, 10], [50, 20]), LINE(7, [50, 20], [30, 20]), LINE(8, [30, 20], [30, 10])];
  const r = [...weld(4), ...[5, 6, 7, 8].map((i) => ({ k: 'coincident', a: i, aEnd: 'b', b: i === 8 ? 5 : i + 1, bEnd: 'a' }))];
  refused(SOUP(g, r), /has a hole in it/);
});
test('two arcs that touch at a point inside both pinch the outline, and a pull and a spin both say so', () => {
  // circles of radius 5 at (-5, 0) and (5, 0) kiss at the origin; shifted right by 30 so the outline clears the axis for the spin
  const dx = 30;
  const g = [ARC(1, [dx - 5, 0], 5, [dx - 5, -5], [dx - 5, 5]), LINE(2, [dx - 5, 5], [dx + 5, 5]), ARC(3, [dx + 5, 0], 5, [dx + 5, 5], [dx + 5, -5]), LINE(4, [dx + 5, -5], [dx - 5, -5])];
  refused(SOUP(g, weld(4), 360, 'pull(s, 5)'), /touch where they should not.*two curves just touch/);
  refused(SOUP(g, weld(4)), /cannot be spun.*touch where they should not.*two curves just touch/);
});
test('tangent circles whose arcs do not meet, and a stadium, are not pinches', () => {
  // the halves facing away from each other
  const dx = 30;
  const g = [ARC(1, [dx - 5, 0], 5, [dx - 5, 5], [dx - 5, -5]), LINE(2, [dx - 5, -5], [dx + 5, -5]), ARC(3, [dx + 5, 0], 5, [dx + 5, -5], [dx + 5, 5]), LINE(4, [dx + 5, 5], [dx - 5, 5])];
  const rec = run.run({ code: SOUP(g, weld(4), 360, 'pull(s, 5)'), tags: {} }, { occt: false });
  assert.deepEqual(rec.refusals, {}, JSON.stringify(rec.refusals));
  assert.ok(Math.abs(rec.brep.volume - (10 * 10 + PI * 25) * 5) < 1e-6 * 400);
});

// ---------------------------------------------------------------- corner numbers: the script counts corners from 1, like the panel
test('.round() and .chamfer() count corners from 1, like .pin() and the Rules panel; 0 and too-big say so', () => {
  const r = runScript("const s = sketch('top')\ns.rect(30, 20)\ns.round(1, 3)\ns.chamfer(2, 2)");
  assert.deepEqual(r.errors, []);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  assert.deepEqual(Object.keys(sk.rounds), ['0'], 'corner 1 is the first point (stored from 0)');
  assert.deepEqual(Object.keys(sk.chamfers), ['1']);
  for (const [call, bad] of [['round(0, 3)', 0], ['round(5, 3)', 5], ['chamfer(0, 2)', 0], ['chamfer(1.5, 2)', 1.5]]) {
    const e = runScript(`const s = sketch('top')\ns.rect(30, 20)\ns.${call}`).errors;
    assert.equal(e.length, 1, call);
    assert.match(e[0].message, /corner has to be a whole number from 1 to 4 \(corner 1 is the first corner\)/, call);
    assert.ok(e[0].message.includes(String(bad)));
  }
});
test('the trim note names the corner the way the script wrote it', () => {
  const w = warnings("const s = sketch('top')\ns.rect(30, 20)\ns.round(4, 99)\npull(s, 5)");
  assert.equal(w.length, 1);
  assert.match(w[0], /^\.round\(4, 99\) is more than corner 4 has room for, so it was made 10 instead\.$/);
});
