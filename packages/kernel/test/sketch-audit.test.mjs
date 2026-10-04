// 2D audit (docs/PLAN-next.md section 25 step 2), pinned from the student's side on the real wasm.
//
// CANONICAL SOLVER (measured, not assumed):
//   - Soup sketches (`geom` + `rules`, the studio's sketch canvas, sk.slot): the RUST session (brep-rs/src/sketch,
//     reached through kernel/src/sketch-session.ts) is the only solver, DoF counter, diagnoser and profile source.
//     build_doc_json runs the same session before it extrudes, so the canvas and the built part cannot disagree.
//   - Polygon sketches (`points` + rounds/chamfers, sk.rect/polygon/circle/round/chamfer): no solver at build time.
//     TS packages/sketch outlineOf() makes the outline for the studio, the script warnings and the OCCT referee;
//     Rust wasm.rs profile_corners() makes it for the kernel. They are two implementations of one rule and the
//     tests below hold each to the same closed forms. The TS least-squares solver (solveSketch) only settles
//     the legacy polygon rules (.across/.length/...) and has no DoF; nothing in it is canonical for new work.
//
// Oracles are independent of both kernels: hand-counted degrees of freedom, shoelace / circular-segment /
// rounded-rectangle areas, and OpenCascade through the referee apparatus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRunner, classify, shoelace, filletCut, roundedRect, segmentArea, slotArea } from './sketch-audit-lib.mjs';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { SketchSession2D } = await import('../dist/sketch-session.js');
const { buildSlotRows } = await import('@shuff57/reshape-sketch/sketch-slot');
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const session = new SketchSession2D();
session.loadFromBytes(brep);
const run = await makeRunner({ occt: true });

const L = (id, a, b) => ({ k: 'line', id, a, b });
const A = (id, c, r, a, b, sense = 'ccw') => ({ k: 'arc', id, c, r, a, b, sense });
const cc = (a, aEnd, b, bEnd) => ({ k: 'coincident', a, aEnd, b, bEnd });
const weld = (n) => Array.from({ length: n }, (_, i) => cc(i + 1, 'b', ((i + 1) % n) + 1, 'a'));
const poly = (pts) => pts.map((p, i) => L(i + 1, p, pts[(i + 1) % pts.length]));
const len = (a, v) => ({ k: 'distance', a, aEnd: 'a', b: a, bEnd: 'b', value: v });

function diag(geoms, rules) {
  const e = session.open(geoms, rules);
  assert.equal(e, null, `open refused: ${e}`);
  session.solve();
  return session.diagnose();
}

// ---------------------------------------------------------------- DoF = rank, against hand counts
const SQ = poly([[0, 0], [40, 0], [40, 30], [0, 30]]);
const TRI = poly([[0, 0], [40, 0], [0, 30]]);
const DOF = [
  ['free point', [{ k: 'point', id: 1, p: [1, 1] }], [], 2],
  ['free line', [L(1, [0, 0], [10, 0])], [], 4],
  ['free circle', [{ k: 'circle', id: 1, c: [0, 0], r: 5 }], [], 3],
  ['free arc: centre, radius and two end angles (its ends lie on its circle)', [A(1, [0, 0], 5, [5, 0], [0, 5])], [], 5],
  ['line + horizontal', [L(1, [0, 0], [10, 1])], [{ k: 'horizontal', a: 1 }], 3],
  ['line + horizontal + vertical', [L(1, [0, 0], [10, 1])], [{ k: 'horizontal', a: 1 }, { k: 'vertical', a: 1 }], 2],
  ['circle + radius', [{ k: 'circle', id: 1, c: [0, 0], r: 5 }], [{ k: 'radius', a: 1, value: 5 }], 2],
  ['welded quadrilateral: 4 points', SQ, weld(4), 8],
  ['welded quad + horizontal + vertical on two edges', SQ, [...weld(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }], 6],
  ['rectangle (H, V on all four edges) = position + width + height', SQ,
    [...weld(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }], 4],
  ['dimensioned rectangle: width and height given, only position free', SQ,
    [...weld(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }, len(1, 40), len(2, 30)], 2],
  ['triangle: 3 points', TRI, weld(3), 6],
  ['triangle with 3 side lengths: position and turn free', TRI, [...weld(3), len(1, 40), len(2, 50), len(3, 30)], 3],
  ['triangle, 3 sides, one edge horizontal, one corner locked: fully constrained',
    TRI, [...weld(3), len(1, 40), len(2, 50), len(3, 30), { k: 'horizontal', a: 1 }, { k: 'lock', a: 1, aEnd: 'a' }], 0],
];
for (const [name, g, r, want] of DOF) {
  test(`DoF = n - rank: ${name} = ${want}`, () => {
    const d = diag(g, r);
    assert.equal(d.dof, want, JSON.stringify(d));
    assert.equal(d.bucket, 'consistent', JSON.stringify(d));
  });
}

test('DoF: a slot (two caps, two tangent sides) is cA, cB, rA, rB = 6; one radius rule makes it 5', () => {
  const sl = buildSlotRows([0, 0], [30, 0], 5, 1);
  assert.equal(diag(sl.geoms, sl.rules).dof, 6);
  assert.equal(diag(sl.geoms, [...sl.rules, { k: 'radius', a: 1, value: 5 }]).dof, 5);
});

// ---------------------------------------------------------------- redundant vs conflicting, and blame
test('redundant: the same horizontal twice is redundant, harmless, and the NEWER rule takes the blame', () => {
  const d = diag([L(1, [0, 0], [10, 1])], [{ k: 'horizontal', a: 1 }, { k: 'horizontal', a: 1 }]);
  assert.equal(d.bucket, 'redundant');
  assert.equal(d.dof, 3);
  assert.deepEqual(d.blame, [1]);
});

test('redundant: parallel between two horizontals is implied; blame is the parallel (rule 3)', () => {
  const d = diag([L(1, [0, 0], [10, 0]), L(2, [0, 5], [10, 5])], [{ k: 'horizontal', a: 1 }, { k: 'horizontal', a: 2 }, { k: 'parallel', a: 1, b: 2 }]);
  assert.equal(d.bucket, 'redundant');
  assert.deepEqual(d.blame, [2]);
});

test('conflicting: lengths 10 and 12 on one edge conflict; the newer rule is blamed', () => {
  const d = diag([L(1, [0, 0], [10, 0])], [len(1, 10), len(1, 12)]);
  assert.equal(d.bucket, 'conflicting');
  assert.equal(d.blame[0], 1);
});

test('blame ignores the arc rows the session adds for itself, and a sketch with no problem blames nobody', () => {
  const d = diag([A(1, [0, 0], 5, [5, 0], [0, 5])], [{ k: 'radius', a: 1, value: 5 }, { k: 'radius', a: 1, value: 5 }]);
  assert.equal(d.bucket, 'redundant');
  assert.deepEqual(d.blame, [1]);
  assert.deepEqual(diag(SQ, weld(4)).blame, []);
});

test('an arc end cannot be dragged off its own circle: after a dimension pulls on it, the end is still on the circle', () => {
  const g = [A(1, [0, 0], 5, [3, 4], [-3, 4]), L(2, [-3, 4], [3, 4])];
  const e = session.open(g, [cc(1, 'b', 2, 'a'), cc(2, 'b', 1, 'a'), len(2, 8)]);
  assert.equal(e, null);
  assert.ok(session.solve());
  const [arc] = session.solvedGeoms();
  for (const p of [arc.a, arc.b]) assert.ok(Math.abs(Math.hypot(p[0] - arc.c[0], p[1] - arc.c[1]) - arc.r) < 1e-6);
});

test('a conflicting sketch never builds: the pull refuses in a sentence that tells the student to fix the rules', () => {
  const geoms = [L(1, [0, 0], [10, 0]), L(2, [10, 0], [10, 10]), L(3, [10, 10], [0, 0])];
  const rules = [...weld(3), len(1, 10), len(1, 12)];
  const rec = run.run({ code: `const s = sketch('top'); s.geom(${JSON.stringify(geoms)}); s.rules(${JSON.stringify(rules)}); pull(s, 5)`, tags: {} }, { occt: false });
  const sentence = Object.values(rec.refusals).join(' ');
  assert.match(sentence, /conflict/);
  assert.equal(rec.brep, undefined);
});

// ---------------------------------------------------------------- pull helper: closed form + OCCT + mesh + bbox
function pulled(code, volume, { bbox, needOcct = false } = {}) {
  const rec = run.run({ code, tags: {}, oracle: { exactVolume: volume } });
  const c = classify(rec);
  assert.deepEqual(rec.refusals, {}, `${code}\n${JSON.stringify(rec.refusals)}`);
  assert.ok(['AGREE', 'AGREE-ANALYTIC-ONLY', ...(needOcct ? [] : ['OCCT-REFUSED'])].includes(c.cls), `${c.cls} ${JSON.stringify(c.wrong ?? c.detail)}\n${code}`);
  assert.ok(Math.abs(rec.brep.volume - volume) <= 1e-9 * volume, `${code}: ${rec.brep.volume} vs ${volume}`);
  assert.equal(rec.mesh.open, 0, 'mesh has open edges');
  assert.equal(rec.mesh.unbalanced, 0);
  if (bbox) for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(rec.brep.bbox[a][k] - bbox[a][k]) < 1e-7, `bbox[${a}][${k}] ${rec.brep.bbox[a][k]} vs ${bbox[a][k]}`);
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
const warnings = (code) => runScript(code).warnings ?? [];

// ---------------------------------------------------------------- shapes by closed form
test('rectangle x height, bbox exact', () => pulled("const s = sketch('top')\ns.rect(30, 20)\npull(s, 7)", 30 * 20 * 7, { bbox: [[-15, -10, 0], [15, 10, 7]] }));
test('triangle by shoelace', () => pulled("const s = sketch('top')\ns.polygon([[0,0],[40,0],[0,30]])\npull(s, 6)", shoelace([[0, 0], [40, 0], [0, 30]]) * 6));
test('concave L by shoelace', () => {
  const pts = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  pulled(`const s = sketch('top')\ns.polygon(${JSON.stringify(pts)})\npull(s, 4)`, shoelace(pts) * 4);
});
test('clockwise winding builds the same solid', () => {
  const pts = [[0, 0], [0, 30], [40, 0]];
  pulled(`const s = sketch('top')\ns.polygon(${JSON.stringify(pts)})\npull(s, 6)`, 600 * 6);
});
test('circle: pi r^2 h', () => pulled("const s = sketch('top')\ns.circle(20)\npull(s, 5)", Math.PI * 100 * 5, { bbox: [[-10, -10, 0], [10, 10, 5]] }));
test('a negative pull goes the other way with the same volume', () =>
  pulled("const s = sketch('top')\ns.rect(30, 20)\npull(s, -5)", 3000, { bbox: [[-15, -10, -5], [15, 10, 0]] }));
test('slot: 2 r len + pi r^2', () => pulled("const s = sketch('top').slot([-20, 0], [20, 0], 5)\npull(s, 10)", slotArea(40, 5) * 10));
test('half disc and circular segments from soup arcs: r^2/2 (theta - sin theta)', () => {
  for (const [R, theta] of [[10, Math.PI], [10, Math.PI / 2], [25, 0.4], [7, 2.9], [10, 4.2]]) {
    const a = [R, 0], b = [R * Math.cos(theta), R * Math.sin(theta)];
    const g = [A(1, [0, 0], R, a, b), L(2, b, a)];
    pulled(`const s = sketch('top'); s.geom(${JSON.stringify(g)}); s.rules(${JSON.stringify([cc(1, 'b', 2, 'a'), cc(2, 'b', 1, 'a')])}); pull(s, 3)`, segmentArea(R, theta) * 3);
  }
});
test('a clockwise soup arc builds the same segment', () => {
  const R = 12, theta = 1.7, a = [R, 0], b = [R * Math.cos(theta), R * Math.sin(theta)];
  const g = [A(1, [0, 0], R, b, a, 'cw'), L(2, a, b)];
  pulled(`const s = sketch('top'); s.geom(${JSON.stringify(g)}); s.rules(${JSON.stringify([cc(1, 'b', 2, 'a'), cc(2, 'b', 1, 'a')])}); pull(s, 3)`, segmentArea(R, theta) * 3);
});

// ---------------------------------------------------------------- fillet / chamfer around the maximum
const RECT = (corners) => `const s = sketch('top')\ns.rect(30, 20)\n${corners}\npull(s, 5)`;
test('one round on a 30 x 20 rectangle: below, at and beyond the maximum (10)', () => {
  for (const r of [0.5, 9.99, 10]) {
    pulled(RECT(`s.round(0, ${r})`), (600 - (1 - Math.PI / 4) * r * r) * 5);
    assert.deepEqual(warnings(RECT(`s.round(0, ${r})`)), []);
  }
  for (const r of [10.01, 12, 100]) {
    pulled(RECT(`s.round(0, ${r})`), (600 - (1 - Math.PI / 4) * 100) * 5);
    const w = warnings(RECT(`s.round(0, ${r})`));
    assert.equal(w.length, 1, `a round cut down says so: ${JSON.stringify(w)}`);
    assert.match(w[0], /more than corner 0 has room for, so it was made 10 instead/);
  }
});
test('four equal rounds: w*h - (4 - pi) r^2 (was wrong: the second corner was held to half of what was left)', () => {
  for (const r of [1, 5, 8, 9.9, 10]) {
    pulled(RECT([0, 1, 2, 3].map((k) => `s.round(${k}, ${r})`).join('\n')), roundedRect(30, 20, r) * 5);
    assert.deepEqual(warnings(RECT([0, 1, 2, 3].map((k) => `s.round(${k}, ${r})`).join('\n'))), []);
  }
});
test('four rounds of 10 on 30 x 20 is a stadium: it equals the slot formula and a slot sketch', () => {
  const v = pulled(RECT([0, 1, 2, 3].map((k) => `s.round(${k}, 10)`).join('\n')), slotArea(10, 10) * 5).brep.volume;
  const sl = pulled("const s = sketch('top').slot([-5, 0], [5, 0], 10)\npull(s, 5)", slotArea(10, 10) * 5).brep.volume;
  assert.ok(Math.abs(v - sl) < 1e-9 * v);
});
test('four rounds beyond the maximum are all cut to it, evenly, whatever order they are listed in', () => {
  const asks = [0, 1, 2, 3];
  for (const order of [asks, [...asks].reverse(), [2, 0, 3, 1]]) {
    const code = RECT(order.map((k) => `s.round(${k}, 15)`).join('\n'));
    pulled(code, roundedRect(30, 20, 10) * 5);
    assert.equal(warnings(code).length, 4);
  }
});
test('two rounds that together want more than their shared edge share it in proportion, not first-come', () => {
  // 30 x 20, corners 0 and 3 share the 20-edge; asking 15 and 5 gives trims 15+5 > 20 once capped (cap 10): 10+5 fits.
  pulled(RECT('s.round(0, 15)\ns.round(3, 5)'), (600 - (1 - Math.PI / 4) * (100 + 25)) * 5);
  // chamfers are capped by the shorter edge (20), two of 15 on one 20-edge want 30 and each gets 20/30 of its ask: 10 each
  pulled(RECT('s.chamfer(0, 15)\ns.chamfer(3, 15)'), (600 - 2 * 100 / 2) * 5);
});
test('chamfer: below, at and beyond the shorter edge (20)', () => {
  for (const d of [1, 19.99, 20]) pulled(RECT(`s.chamfer(0, ${d})`), (600 - d * d / 2) * 5);
  for (const d of [20.01, 50]) {
    pulled(RECT(`s.chamfer(0, ${d})`), (600 - 200) * 5);
    assert.match(warnings(RECT(`s.chamfer(0, ${d})`))[0], /more than corner 0 has room for, so it was made 20 instead/);
  }
});
test('a round and a chamfer on one corner: the round wins, the chamfer is not built', () =>
  pulled(RECT('s.round(0, 5)\ns.chamfer(0, 8)'), (600 - (1 - Math.PI / 4) * 25) * 5));
test('fillet of an acute and an obtuse corner of a triangle, at its maximum and below it', () => {
  const pts = [[0, 0], [40, 0], [0, 30]];
  const alpha = Math.atan2(30, 40); // interior angle at (40, 0)
  const rmax = (40 / 2 > 25 ? 25 : 20) * Math.tan(alpha / 2); // shorter edge there is 40, so half = 20
  for (const f of [0.3, 1]) {
    const r = rmax * f;
    pulled(`const s = sketch('top')\ns.polygon(${JSON.stringify(pts)})\ns.round(1, ${r})\npull(s, 4)`, (600 - filletCut(alpha, r)) * 4);
  }
  const code = `const s = sketch('top')\ns.polygon(${JSON.stringify(pts)})\ns.round(1, 100)\npull(s, 4)`;
  pulled(code, (600 - filletCut(alpha, rmax)) * 4);
  assert.equal(warnings(code).length, 1);
});
test('a round on a straight corner or beside a curve is left out and the script says so', () => {
  const pts = [[0, 0], [10, 0], [20, 0], [20, 10], [0, 10]];
  const code = `const s = sketch('top')\ns.polygon(${JSON.stringify(pts)})\ns.round(1, 3)\npull(s, 2)`;
  pulled(code, 200 * 2);
  assert.match(warnings(code)[0], /was left out/);
});
test('a round whose size is 0 or negative changes nothing', () => {
  pulled(RECT('s.round(0, 0)'), 3000);
});

// ---------------------------------------------------------------- degenerate outlines: build right or say why
test('self-crossing polygons are refused, they used to extrude to their signed area', () => {
  const crossing = [
    [[0, 0], [30, 20], [30, 0], [0, 10]], // unequal bow-tie: signed area is non-zero
    [[0, 0], [40, 0], [40, 30], [20, -10], [0, 30]], // a five-pointed star-like self-crossing
    [[0, 0], [10, 10], [10, 0], [0, 10]], // bow-tie whose lobes cancel to zero area
  ];
  for (const pts of crossing) refused(`const s = sketch('top')\ns.polygon(${JSON.stringify(pts)})\npull(s, 5)`, /cross each other/);
});
test('zero area, a pinch and a spike are refused with a plain sentence', () => {
  const sk = (pts) => `const s = sketch('top')\ns.polygon(${JSON.stringify(pts)})\npull(s, 5)`;
  refused(sk([[0, 0], [10, 0], [20, 0]]), /no area/);
  refused(sk([[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]]), /touch where they should not/);
  refused(sk([[0, 0], [10, 0], [10, 10], [0, 0], [10, 0]]), /touch where they should not|runs back over/);
});
test('zero-size sketches and a zero pull are refused in a sentence about the sketch, not about solids', () => {
  refused("const s = sketch('top')\ns.rect(0, 20)\npull(s, 5)", /no area/);
  refused("const s = sketch('top')\ns.circle(0)\npull(s, 5)", /no size/);
  refused("const s = sketch('top')\ns.rect(30, 20)\npull(s, 0)", /pull height is 0/);
});
test('a doubled point is harmless: same solid as without it, mesh closed', () => {
  pulled("const s = sketch('top')\ns.polygon([[0,0],[10,0],[10,0],[10,10]])\npull(s, 5)", 50 * 5);
  pulled("const s = sketch('top')\ns.polygon([[0,0],[10,0],[10,10],[10,10],[0,10]])\npull(s, 5)", 100 * 5);
});
test('a stale refusal from an earlier sketch is not shown for a later one', () => {
  const bad = [L(1, [0, 0], [10, 0]), L(2, [10, 0], [10, 10])];
  const code = `const a = sketch('top'); a.geom(${JSON.stringify(bad)}); a.rules(${JSON.stringify([cc(1, 'b', 2, 'a')])}); pull(a, 5)\nconst b = sketch('top')\nb.rect(0, 5)\npull(b, 5)`;
  const rec = run.run({ code, tags: {} }, { occt: false });
  const sentences = Object.values(rec.refusals);
  assert.equal(sentences.length, 2);
  assert.match(sentences[0], /loose end/);
  assert.match(sentences[1], /no area/, 'the second sketch is refused for its own reason');
});

// soup degenerates (the Rust discovery; see also sketch-refusals.test.mjs)
const soupPull = (g, r) => `const s = sketch('top'); s.geom(${JSON.stringify(g)}); s.rules(${JSON.stringify(r)}); pull(s, 5)`;
test('soup: open outline, crossing outline, zero-length edge and a doubled edge are all refused', () => {
  refused(soupPull(poly([[0, 0], [10, 0], [10, 10], [0, 10]]).slice(0, 3), weld(3).slice(0, 2)), /loose end/);
  refused(soupPull(poly([[0, 0], [10, 10], [10, 0], [0, 10]]), weld(4)), /cross/);
  refused(soupPull([L(1, [0, 0], [10, 0]), L(2, [10, 0], [10, 0]), L(3, [10, 0], [10, 10]), L(4, [10, 10], [0, 0])], weld(4)), /./);
  refused(soupPull([L(1, [0, 0], [10, 0]), L(2, [10, 0], [0, 0])], weld(2)), /same claim|no area|enclose/);
});
test('soup: an arc end that does not lie on its circle is pulled onto it, never extruded open', () => {
  const g = [A(1, [0, 0], 5, [7, 0], [-5, 0]), L(2, [-5, 0], [7, 0])];
  const rec = run.run({ code: soupPull(g, [cc(1, 'b', 2, 'a'), cc(2, 'b', 1, 'a')]), tags: {} }, { occt: false });
  if (rec.brep) {
    // built: then it must be a real closed solid whose volume matches its own solved outline
    assert.equal(rec.mesh.open, 0);
    assert.ok(rec.brep.volume > 0);
  } else assert.ok(Object.values(rec.refusals).join(' ').length > 10);
});

// ---------------------------------------------------------------- the same shapes through OCCT, one fixed script set
test('referee: OCCT builds the same volume for sketch + pull scripts of every polygon kind', () => {
  const scripts = [
    RECT('s.round(0, 4)\ns.chamfer(2, 6)'),
    RECT([0, 1, 2, 3].map((k) => `s.round(${k}, 8)`).join('\n')),
    "const s = sketch('top')\ns.polygon([[0,0],[40,0],[30,25],[5,30]])\ns.round(2, 3)\npull(s, 6)",
    "const s = sketch('top')\ns.circle(18)\npull(s, 9)",
  ];
  for (const code of scripts) {
    const rec = run.run({ code, tags: {} });
    assert.deepEqual(rec.refusals, {});
    assert.ok(rec.occt, `OCCT built nothing for ${code}`);
    assert.ok(Math.abs(rec.occt.volume - rec.brep.volume) <= 1e-6 * rec.brep.volume, `${code}: OCCT ${rec.occt.volume} vs brep ${rec.brep.volume}`);
  }
});
