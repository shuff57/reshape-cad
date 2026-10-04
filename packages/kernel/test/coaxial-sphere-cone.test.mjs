// S4h: booleans of a SPHERE or a CONE with a plane square to its axis (a box face, a slab) or with a coaxial cylinder,
// sphere or cone. Every cut is then a circle of constant latitude (or height), so each face splits into whole bands.
// Oracles that do not run through the kernel's own surface integrals:
//   * closed forms: caps pi h^2 (3R - h) / 3, zones pi (R^2 (z2 - z1) - (z2^3 - z1^3) / 3), cones and frusta;
//   * a cross-section oracle (below): every operand is a solid about one axis, so its section at height z is a set of
//     radial intervals and the volume is the integral of the section area, exact (Gauss-Legendre on a piecewise
//     quadratic) between the heights where the section changes shape;
//   * OpenCascade, the independent referee, on volume and bounding box;
//   * inclusion-exclusion with the partner operation: V(A+B) + V(A*B) = V(A) + V(B), V(A-B) + V(A*B) = V(A);
//   * a watertight mesh at deflection 0.05 and 0.5, and STEP read back by OpenCascade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import('../dist/occt-build.js');
const arc = await import('../../sketch/dist/sketch-arc.js');

const PI = Math.PI;

function occt(features, id) {
  const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
  assert.ok(shape, 'OCCT built it');
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]] };
}

function readStep(text) {
  oc.FS.writeFile('/in.step', text);
  const reader = new oc.STEPControl_Reader();
  reader.ReadFile('/in.step');
  reader.TransferRoots(new oc.Message_ProgressRange());
  const shape = reader.OneShape();
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const an = new oc.BRepCheck_Analyzer(shape, true, false, false);
  let solids = 0;
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) solids++;
  return { volume: g.Mass(), valid: an.IsValid_2 ? an.IsValid_2() : an.IsValid(), solids };
}

function openEdges(json, id, defl) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  const P = m.positions, I = m.indices;
  const ids = new Map();
  const canon = [];
  for (let i = 0; i < P.length / 3; i++) {
    const k = `${Math.round(P[3 * i] / 1e-6)},${Math.round(P[3 * i + 1] / 1e-6)},${Math.round(P[3 * i + 2] / 1e-6)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    canon.push(ids.get(k));
  }
  const dir = new Map();
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = canon[I[t + e]], b = canon[I[t + ((e + 1) % 3)]];
      if (a !== b) dir.set(`${a}>${b}`, (dir.get(`${a}>${b}`) ?? 0) + 1);
    }
  let open = 0;
  for (const [k, n] of dir) {
    const [u, w] = k.split('>');
    if ((dir.get(`${w}>${u}`) ?? 0) !== n) open++;
  }
  return { open, triangles: I.length / 3 };
}

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const id = r.doc.features.at(-1).id;
  const doc = JSON.stringify({ ...r.doc, measure: id });
  const out = JSON.parse(brep.build_doc_json(doc));
  const refusals = out.refusals ?? {};
  const m = Object.keys(refusals).length ? undefined : JSON.parse(brep.measure_doc(doc)).shapes[id];
  return { refusals, m, r, id, doc };
}

/** The volume of the solid a feature id names in a script's doc. */
function volumeOf(r, id) {
  return JSON.parse(brep.measure_doc(JSON.stringify({ ...r.doc, measure: id }))).shapes[id].volume;
}

// ---- closed forms ----------------------------------------------------------------------------
const ballV = (R) => (4 / 3) * PI * R ** 3;
/** The ball of radius R between heights z1 < z2 measured from its centre. */
const zone = (R, z1, z2) => {
  z1 = Math.max(z1, -R);
  z2 = Math.min(z2, R);
  return z2 <= z1 ? 0 : PI * (R * R * (z2 - z1) - (z2 ** 3 - z1 ** 3) / 3);
};
const coneV = (r, h) => (PI * r * r * h) / 3;
const cylV = (r, h) => PI * r * r * h;
const close = (got, want, tol = 1e-9) => Math.abs(got - want) <= tol * Math.max(Math.abs(want), 1);

// ---- scripts with a closed form -----------------------------------------------------------------
// Every script declares `a` then `b` (shapes at the origin unless given `at`: a script's second shape defaults to x = 45).
const BOX = 40 * 40 * 10;
const KNOB = cylV(4, 20 - (24 - Math.sqrt(48))) + zone(8, -8, -Math.sqrt(48)); // what the post and the ball share
const Z = (12 * 12 - 7 * 7 + 144) / 24 - 0; // unused spacer
void Z;
const LENS_Z = (100 - 49 + 144) / 24; // where a ball of radius 10 at 0 meets one of radius 7 at 12
const LENS = zone(10, LENS_Z, 10) + zone(7, -7, LENS_Z - 12);
const CAP4 = (PI * 16 * (36 - 4)) / 3; // a cap of height 4 on a ball of radius 12

const HAND = [
  // name, setup (declares a and b), op, closed-form volume
  ['join: a dome on a base plate (box(40, 40, 10), a ball of diameter 24 centred on its top face)',
    "const a = box(40, 40, 10)\nconst b = sphere(24, { at: [0, 0, 5] })", 'union', BOX + ballV(12) - zone(12, -10, 0)],
  ['join: the ball centred in the plate, out of both faces',
    "const a = box(40, 40, 10)\nconst b = sphere(24, { at: [0, 0, 0] })", 'union', BOX + ballV(12) - zone(12, -5, 5)],
  ['cut: a hemispherical pocket (box(40, 40, 20) minus a ball of diameter 24 centred on the top face)',
    "const a = box(40, 40, 20)\nconst b = sphere(24, { at: [0, 0, 10] })", 'subtract', 40 * 40 * 20 - ballV(12) / 2],
  ['cut: a ball through both faces of a slab',
    "const a = box(40, 40, 20)\nconst b = sphere(24, { at: [0, 0, 0] })", 'subtract', 40 * 40 * 20 - zone(12, -10, 10)],
  ['keep: the part of the ball inside the slab',
    "const a = box(40, 40, 20)\nconst b = sphere(24, { at: [0, 0, 0] })", 'intersect', zone(12, -10, 10)],
  ['join: a cone on a cylinder (cylinder(20, 20), cone(20, 14) standing on its top face)',
    "const a = cylinder(20, 20)\nconst b = cone(20, 14, { at: [0, 0, 17] })", 'union', cylV(10, 20) + coneV(10, 14)],
  ['join: a narrower cone on a cylinder',
    "const a = cylinder(20, 20)\nconst b = cone(12, 14, { at: [0, 0, 17] })", 'union', cylV(10, 20) + coneV(6, 14)],
  ['join: a wider cone on a cylinder overhangs it',
    "const a = cylinder(20, 20)\nconst b = cone(28, 14, { at: [0, 0, 17] })", 'union', cylV(10, 20) + coneV(14, 14)],
  ['join: a cone point down on a cylinder (the cone narrows into the cylinder)',
    "const a = cylinder(20, 20)\nconst b = cone(20, 14, { at: [0, 0, 3] })\nturn(b, [180, 0, 0])", 'union', cylV(10, 20)],
  ['keep: a ball sliced by a box that takes a cap (h = 4)',
    "const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(60, 60, 20, { at: [0, 0, 18] })", 'intersect', CAP4],
  ['cut: the same box takes the cap off the ball',
    "const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(60, 60, 20, { at: [0, 0, 18] })", 'subtract', ballV(12) - CAP4],
  ['join: the ball and the box that slices its cap',
    "const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(60, 60, 20, { at: [0, 0, 18] })", 'union', 60 * 60 * 20 + ballV(12) - CAP4],
  ['keep: a cone sliced at z = 5 by a plate above it (the tip is left)',
    "const a = cone(20, 20, { at: [0, 0, 10] })\nconst b = box(40, 40, 30, { at: [0, 0, 20] })", 'intersect', coneV(7.5, 15)],
  ['cut: the same plate takes the tip off the cone, a frustum is left',
    "const a = cone(20, 20, { at: [0, 0, 10] })\nconst b = box(40, 40, 30, { at: [0, 0, 20] })", 'subtract', coneV(10, 20) - coneV(7.5, 15)],
  ['join: a ball knob on a post (cylinder(8, 20), a ball of diameter 16 at its top)',
    "const a = cylinder(8, 20, { at: [0, 0, 10] })\nconst b = sphere(16, { at: [0, 0, 24] })", 'union', cylV(4, 20) + ballV(8) - KNOB],
  ['keep: what the post and the ball share',
    "const a = cylinder(8, 20, { at: [0, 0, 10] })\nconst b = sphere(16, { at: [0, 0, 24] })", 'intersect', KNOB],
  ['cut: a ball out of the end of a post',
    "const a = cylinder(8, 20, { at: [0, 0, 10] })\nconst b = sphere(16, { at: [0, 0, 24] })", 'subtract', cylV(4, 20) - KNOB],
  ['join: two balls on one line',
    "const a = sphere(20, { at: [0, 0, 0] })\nconst b = sphere(14, { at: [0, 0, 12] })", 'union', ballV(10) + ballV(7) - LENS],
  ['cut: a spherical dent in a ball',
    "const a = sphere(20, { at: [0, 0, 0] })\nconst b = sphere(14, { at: [0, 0, 12] })", 'subtract', ballV(10) - LENS],
  ['cut: a cone-shaped dent in a plate (the cone, point down, enters the top face)',
    "const a = box(40, 40, 10, { at: [0, 0, 0] })\nconst b = cone(20, 10, { at: [0, 0, 5] })\nturn(b, [180, 0, 0])", 'subtract', BOX - coneV(5, 5)],
];

for (const [name, setup, op, want] of HAND) {
  test(`${name}`, () => {
    const { refusals, m, doc, id } = build(`${setup}\n${op}(a, b)`);
    assert.deepEqual(refusals, {}, JSON.stringify(refusals));
    assert.ok(m, 'built');
    assert.ok(close(m.volume, want, 1e-9), `${m.volume} vs closed form ${want}`);
    for (const defl of [0.05, 0.5]) {
      const { open, triangles } = openEdges(doc, id, defl);
      assert.equal(open, 0, `open mesh edges at ${defl}`);
      assert.ok(triangles > 8);
    }
  });
}

test('face counts the docs print: a cone on a cylinder is 3 faces, a dome on a plate 8, the hemispherical pocket 7', () => {
  const f = (code) => build(code).m.faces;
  assert.equal(f(HAND[5][1] + '\nunion(a, b)'), 3, 'bottom disk, wall, cone');
  assert.equal(f(HAND[0][1] + '\nunion(a, b)'), 8, 'four sides, the top and bottom rings, a cap above and a cap below');
  assert.equal(f(HAND[2][1] + '\nsubtract(a, b)'), 7, 'five faces of the slab, the pocket top... and the bowl');
});

// ---- inclusion-exclusion with the partner operation (the guard, checked from outside) -------------
test('V(A+B) + V(A*B) = V(A) + V(B) and V(A-B) + V(A*B) = V(A) to 1e-9, on every pair that has all three', () => {
  const seen = new Set();
  let checked = 0;
  for (const [, setup] of HAND) {
    if (seen.has(setup)) continue;
    seen.add(setup);
    const results = {};
    for (const op of ['union', 'intersect', 'subtract']) results[op] = build(`${setup}\n${op}(a, b)`);
    if (!results.union.m || !results.intersect.m || !results.subtract.m) continue;
    const r = results.union.r;
    const feats = r.doc.features.filter((x) => x.kind !== 'combine' && x.kind !== 'turn');
    const [va, vb] = [volumeOf(r, feats[0].id), volumeOf(r, feats[1].id)];
    const [u, i, d] = [results.union.m.volume, results.intersect.m.volume, results.subtract.m.volume];
    assert.ok(close(u + i, va + vb, 1e-9), `${setup}: union + intersect = ${u + i} vs ${va + vb}`);
    assert.ok(close(d + i, va, 1e-9), `${setup}: subtract + intersect = ${d + i} vs ${va}`);
    checked++;
  }
  assert.ok(checked >= 8, `only ${checked} pairs had all three`);
});

// ---- OpenCascade agrees ---------------------------------------------------------------------
const REFEREE = [
  ...HAND.map(([name, setup, op]) => [name, `${setup}\n${op}(a, b)`]),
  ['join: a cone on a cone, base to base (a double cone)', "const a = cone(20, 14, { at: [0, 0, 0] })\nconst b = cone(20, 10, { at: [0, 0, -12] })\nturn(b, [180, 0, 0])\nunion(a, b)"],
  ['keep: a cone and a ball about one axis', "const a = cone(30, 30, { at: [0, 0, 0] })\nconst b = sphere(24, { at: [0, 0, 6] })\nintersect(a, b)"],
  ['cut: a ball out of a cone', "const a = cone(30, 30, { at: [0, 0, 0] })\nconst b = sphere(20, { at: [0, 0, 8] })\nsubtract(a, b)"],
  ['join: a cone point up on a ball', "const a = sphere(20, { at: [0, 0, 0] })\nconst b = cone(14, 20, { at: [0, 0, 15] })\nunion(a, b)"],
  ['join: a cylinder through a ball along x (the ball is turned onto the axis)', "const a = cylinder(8, 60, { at: [0, 0, 0] })\nturn(a, [0, 90, 0])\nconst b = sphere(24, { at: [0, 0, 0] })\nunion(a, b)"],
  ['join: a plate with a cone and its mirror image (left-handed cone faces)', "const a = cuboid(40, 40, 10, { at: [0, 0, -5] })\nconst b = cone(20, 14, { at: [0, 0, 12] })\nmirror(b, 'top-bottom')\nunion(a, b)"],
  ['join: a plate with a ball and its mirror image', "const a = cuboid(40, 40, 10, { at: [0, 0, 5] })\nconst b = sphere(16, { at: [0, 0, 10] })\nmirror(b, 'top-bottom')\nunion(a, b)"],
  ['join: a cylinder with a cone and its mirror image', "const a = cylinder(20, 20, { at: [0, 0, -10] })\nconst b = cone(20, 14, { at: [0, 0, 17] })\nmirror(b, 'top-bottom')\nunion(a, b)"],
  ['join: a cone on a plate whose axis is x', "const a = box(10, 40, 40, { at: [0, 0, 0] })\nconst b = cone(20, 14, { at: [12, 0, 0] })\nturn(b, [0, 90, 0])\nunion(a, b)"],
];

for (const [name, code] of REFEREE) {
  test(`OCCT agrees: ${name}`, () => {
    const { refusals, m, r, id } = build(code);
    assert.deepEqual(refusals, {}, JSON.stringify(refusals));
    const ref = occt(r.doc.features, id);
    assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${m.volume} vs OCCT ${ref.volume}`);
    for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(m.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${m.bbox[a][k]} vs ${ref.bbox[a][k]}`);
  });
}

// ---- STEP round trip, read back by OpenCascade ---------------------------------------------------
for (const [name, code] of [
  ['a cone on a cylinder (its apex circle came out with radius -1.8e-15 and OpenCascade dropped the whole solid on read-back)', HAND[5][1] + '\nunion(a, b)'],
  ['a dome on a plate (two sphere caps)', HAND[0][1] + '\nunion(a, b)'],
  ['a hemispherical pocket (a cap with the pole in it)', HAND[2][1] + '\nsubtract(a, b)'],
  ['a ball through both faces of a slab (a zone)', HAND[3][1] + '\nsubtract(a, b)'],
  ['the tip left of a cone above a cut', HAND[12][1] + '\nintersect(a, b)'],
  ['a frustum', HAND[13][1] + '\nsubtract(a, b)'],
  ['a narrower cone on a cylinder', HAND[6][1] + '\nunion(a, b)'],
  ['a ball sliced by a box, the cap kept', HAND[9][1] + '\nintersect(a, b)'],
  ['a bare cone', 'const k = cone(20, 20)'],
]) {
  test(`STEP round trip, read back by OpenCascade: ${name}`, () => {
    const { r, id, m, refusals } = build(code);
    assert.deepEqual(refusals, {});
    const f = JSON.parse(brep.export_step(JSON.stringify(r.doc), id));
    assert.ok(f.step, JSON.stringify(f).slice(0, 300));
    const back = readStep(f.step);
    assert.ok(Math.abs(back.volume - m.volume) < 1e-6 * m.volume, `${back.volume} vs ${m.volume}`);
    assert.equal(back.solids, 1);
    assert.equal(back.valid, true);
  });
}

// ---- what is not provably exact refuses in a sentence --------------------------------------------
test('what is not a clean coaxial pair refuses in a sentence and builds nothing', () => {
  const cases = [
    ["const a = box(20, 20, 20)\nconst b = sphere(24, { at: [0, 0, 0] })\nunion(a, b)", 'a ball through the sides of a small box'],
    ["const a = box(20, 20, 20)\nconst b = sphere(24, { at: [0, 0, 0] })\nsubtract(a, b)", 'a box inside a ball whose sides do not clear it'],
    ["const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(40, 40, 40, { at: [20, 20, 20] })\nsubtract(a, b)", 'a ball against a box corner'],
    ["const a = sphere(24, { at: [0, 0, 0] })\nconst b = cylinder(8, 40, { at: [5, 0, 0] })\nsubtract(a, b)", 'a cylinder off the ball\'s centre'],
    ["const a = sphere(24, { at: [0, 0, 0] })\nconst b = cylinder(8, 60, { at: [0, 0, 0] })\nturn(b, [0, 90, 0])\nsubtract(a, b)", 'a cylinder through the centre, on another axis than the plates (the sphere re-frames: builds)'],
    ["const a = sphere(24, { at: [0, 0, 0] })\nconst b = sphere(24, { at: [0, 0, 0] })\nunion(a, b)", 'the same ball twice (S4i: identical operands join into the copy: builds)'],
    ["const a = cone(20, 20, { at: [0, 0, 0] })\nconst b = cone(20, 20, { at: [0, 0, 0] })\nunion(a, b)", 'the same cone twice (S4i: builds)'],
    ["const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(40, 40, 10, { at: [0, 0, 17] })\nunion(a, b)", 'a plate resting on the ball (tangent at the pole)'],
  ];
  let refused = 0;
  for (const [code, why] of cases) {
    const { refusals, m } = build(code);
    if (why.includes('builds')) {
      assert.ok(m, why);
      if (why.startsWith('the same ball')) assert.ok(Math.abs(m.volume - (4 / 3) * Math.PI * 12 ** 3) < 1e-6, String(m.volume));
      continue;
    }
    assert.equal(m, undefined, `${why}: built a solid`);
    assert.match(refusals.op1 ?? '', /cannot boolean these two solids/, why);
    refused++;
  }
  assert.equal(refused, cases.length - 3, 'every case but the three that build refuses');
});

test('a result in two pieces is refused, not handed back as one solid: the ball cut by a slab through its middle', () => {
  const code = "const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(60, 60, 8, { at: [0, 0, 0] })\nsubtract(a, b)";
  const { refusals, m } = build(code);
  assert.equal(m, undefined);
  assert.match(refusals.op1 ?? '', /cannot boolean/);
});

// ---- a cross-section oracle, and a seeded sweep ----------------------------------------------------
function lcg(seed) {
  let s = BigInt(seed);
  return () => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number(s >> 33n) / 2 ** 31;
  };
}
const INF = Infinity;
// Solids about the z axis. A slab is 200 wide, wider than anything else.
const section = {
  ball: (s, z) => (Math.abs(z - s.c) < s.r ? [[0, s.r * s.r - (z - s.c) ** 2]] : []),
  cone: (s, z) => {
    const t = s.up ? z - s.zb : s.zb - z;
    return t > 0 && t < s.h ? [[0, (s.r * (1 - t / s.h)) ** 2]] : [];
  },
  cyl: (s, z) => (z > s.z0 && z < s.z1 ? [[0, s.r * s.r]] : []),
  slab: (s, z) => (z > s.z0 && z < s.z1 ? [[0, INF]] : []),
};
const ends = (s) => ({ ball: [s.c - s.r, s.c + s.r], cone: [s.zb, s.up ? s.zb + s.h : s.zb - s.h], cyl: [s.z0, s.z1], slab: [s.z0, s.z1] })[s.k];
const quad = (s) => {
  if (s.k === 'ball') return [-1, 2 * s.c, s.r * s.r - s.c * s.c];
  if (s.k === 'cyl') return [0, 0, s.r * s.r];
  if (s.k === 'cone') {
    const sg = s.up ? 1 : -1;
    const k = (-s.r * sg) / s.h, k0 = s.r * (1 + (sg * s.zb) / s.h);
    return [k * k, 2 * k * k0, k0 * k0];
  }
  return null;
};
const norm = (v) => {
  v = v.filter((p) => p[1] - p[0] > 1e-12 || p[1] === INF).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of v) {
    const l = out.at(-1);
    if (l && p[0] <= l[1]) l[1] = Math.max(l[1], p[1]);
    else out.push([...p]);
  }
  return out;
};
const inter = (x, y) => {
  const o = [];
  for (const p of x) for (const q of y) {
    const lo = Math.max(p[0], q[0]), hi = Math.min(p[1], q[1]);
    if (hi > lo) o.push([lo, hi]);
  }
  return norm(o);
};
const setOp = (op, a, b) => {
  if (op === 'union') return norm([...a, ...b]);
  if (op === 'intersect') return inter(a, b);
  const comp = [];
  let at = 0;
  for (const q of b) {
    if (q[0] > at) comp.push([at, q[0]]);
    at = q[1];
  }
  if (at < INF) comp.push([at, INF]);
  return inter(a, comp);
};
const areaOf = (v) => v.reduce((t, [lo, hi]) => t + (hi === INF ? 200 * 200 - PI * lo : PI * (hi - lo)), 0);
/** The exact volume of `((first op1 s1) op2 s2) ...`. */
function oracle(first, seq) {
  const all = [first, ...seq.map((x) => x[1])];
  const at = (z) => {
    let cur = section[first.k](first, z);
    for (const [op, s] of seq) cur = setOp(op, cur, section[s.k](s, z));
    return areaOf(cur);
  };
  const zs = all.flatMap(ends);
  for (let i = 0; i < all.length; i++) for (let j = 0; j < i; j++) {
    const p = quad(all[i]), q = quad(all[j]);
    if (!p || !q) continue;
    const [a, b, c] = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) zs.push(-c / b); }
    else {
      const d = b * b - 4 * a * c;
      if (d >= 0) zs.push((-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a));
    }
  }
  zs.sort((x, y) => x - y);
  let v = 0;
  for (let i = 0; i + 1 < zs.length; i++) {
    const [a, b] = [zs[i], zs[i + 1]];
    if (b - a < 1e-12) continue;
    const m = 0.5 * (a + b), h = 0.5 * (b - a), d = h * Math.sqrt(3 / 5);
    v += h * ((5 / 9) * (at(m - d) + at(m + d)) + (8 / 9) * at(m));
  }
  return v;
}
const scriptOf = (s, name) => {
  switch (s.k) {
    case 'ball': return `const ${name} = sphere(${2 * s.r}, { at: [0, 0, ${s.c}] })`;
    case 'cone': return s.up
      ? `const ${name} = cone(${2 * s.r}, ${s.h}, { at: [0, 0, ${s.zb + s.h / 2}] })`
      : `const ${name} = cone(${2 * s.r}, ${s.h}, { at: [0, 0, ${s.zb - s.h / 2}] })\nturn(${name}, [180, 0, 0])`;
    case 'cyl': return `const ${name} = cylinder(${2 * s.r}, ${s.z1 - s.z0}, { at: [0, 0, ${(s.z0 + s.z1) / 2}] })`;
    default: return `const ${name} = box(200, 200, ${s.z1 - s.z0}, { at: [0, 0, ${(s.z0 + s.z1) / 2}] })`;
  }
};
const r2 = (v) => Math.round(v * 100) / 100;
function randomSolid(rnd) {
  const k = ['ball', 'cone', 'cyl', 'slab'][Math.floor(rnd() * 4) % 4];
  const z = r2(-12 + 24 * rnd());
  if (k === 'ball') return { k, c: z, r: r2(4 + 10 * rnd()) };
  if (k === 'cone') return { k, zb: z, r: r2(3 + 10 * rnd()), h: r2(5 + 20 * rnd()), up: rnd() < 0.5 };
  if (k === 'cyl') return { k, z0: z, z1: r2(z + 4 + 20 * rnd()), r: r2(3 + 10 * rnd()) };
  return { k, z0: z, z1: r2(z + 3 + 20 * rnd()) };
}

test('the cross-section oracle reproduces the closed forms', () => {
  assert.ok(close(oracle({ k: 'ball', c: 0, r: 12 }, [['subtract', { k: 'slab', z0: -10, z1: 10 }]]) - 0, ballV(12) - zone(12, -10, 10), 1e-9));
  assert.ok(close(oracle({ k: 'cyl', z0: -10, z1: 10, r: 10 }, [['union', { k: 'cone', zb: 10, r: 10, h: 14, up: true }]]), cylV(10, 20) + coneV(10, 14), 1e-9));
});

test('300 seeded random coaxial pairs, all three operations: 0 wrong against the oracle; a sample against OpenCascade and the mesh', () => {
  const rnd = lcg(20261004);
  let pairs = 0, built = 0, refused = 0, wrong = 0, occtChecked = 0, meshed = 0;
  while (pairs < 300) {
    const a = randomSolid(rnd), b = randomSolid(rnd);
    if (a.k === 'slab' && b.k === 'slab') continue;
    pairs++;
    for (const op of ['union', 'intersect', 'subtract']) {
      const want = oracle(a, [[op, b]]);
      const { refusals, m, r, id, doc } = build(`${scriptOf(a, 'a')}\n${scriptOf(b, 'b')}\n${op}(a, b)`);
      if (m === undefined) {
        refused++;
        assert.match(refusals.op1 ?? '', /cannot/);
        continue;
      }
      built++;
      if (Math.abs(m.volume - want) > 1e-8 * Math.max(want, 1)) {
        wrong++;
        assert.fail(`WRONG ${op} ${JSON.stringify(a)} ${JSON.stringify(b)}: ${m.volume} vs ${want}`);
      }
      if (built % 5 === 0) {
        meshed++;
        assert.equal(openEdges(doc, id, 0.05).open, 0, `open mesh ${op} ${JSON.stringify(a)} ${JSON.stringify(b)}`);
        const ref = occt(r.doc.features, id);
        occtChecked++;
        assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `OCCT volume ${op} ${JSON.stringify(a)} ${JSON.stringify(b)}: ${m.volume} vs ${ref.volume}`);
        for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++)
          assert.ok(Math.abs(m.bbox[i][k] - ref.bbox[i][k]) <= 1e-5, `bbox ${op} ${JSON.stringify(a)} ${JSON.stringify(b)}`);
      }
    }
  }
  console.log(`random coaxial pairs: ${pairs} pairs, built ${built}, refused ${refused}, wrong ${wrong}, OCCT-checked ${occtChecked}, meshed ${meshed}`);
  assert.equal(wrong, 0);
  assert.ok(built >= 500, `only ${built} of ${pairs * 3} built`);
});

test('a second boolean on the first one\'s result (a bowl, a banded cone) agrees with the oracle', () => {
  const rnd = lcg(515);
  let built = 0;
  for (let n = 0; n < 150; n++) {
    const s0 = randomSolid(rnd), s1 = randomSolid(rnd), s2 = randomSolid(rnd);
    const ops = ['union', 'intersect', 'subtract'];
    const [op1, op2] = [ops[Math.floor(rnd() * 3) % 3], ops[Math.floor(rnd() * 3) % 3]];
    const code = `${scriptOf(s0, 'a').replace('const a', 'let a')}\n${scriptOf(s1, 'b')}\n${scriptOf(s2, 'c')}\na = ${op1}(a, b)\na = ${op2}(a, c)`;
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const doc = JSON.stringify({ ...r.doc, measure: id });
    const out = JSON.parse(brep.build_doc_json(doc));
    if (Object.keys(out.refusals ?? {}).length) continue;
    const m = JSON.parse(brep.measure_doc(doc)).shapes[id];
    const want = oracle(s0, [[op1, s1], [op2, s2]]);
    assert.ok(Math.abs(m.volume - want) <= 1e-8 * Math.max(want, 1), `${op1} then ${op2}: ${JSON.stringify([s0, s1, s2])}: ${m.volume} vs ${want}`);
    built++;
  }
  assert.ok(built >= 40, `only ${built} chains built`);
});
