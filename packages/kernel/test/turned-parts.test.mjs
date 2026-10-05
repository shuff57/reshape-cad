// S4f: turned parts. A cylinder with a coaxial bore and rounds or chamfers on its rims is a solid of revolution: one profile (a
// rectangle with arcs and bevels on its corners) turned about the axis. brep-rs reads such a part back as its profile, edits the
// profile (round or chamfer a rim, cut a bore down the axis, move the wall in for a hollow) and revolves it, in one shot, into
// planes, cylinders, cones and tori. It used to refuse the second rim round ("only round an edge of a box yet"), a round or a
// chamfer after a bore, a hole after two rounded rims and a hollow of a part with a rim round or chamfer. Closed forms first (each
// derived here from Pappus with the textbook centroids, independent of the kernel's own profile integrals), then OpenCascade as
// the independent referee (volume + bbox) where it is right, a watertight mesh at two deflections whose enclosed volume matches
// (so a face turned the wrong way is caught), and a STEP round trip read back by OCCT for the parts with no torus.
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

function props(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]], shape };
}
function occt(features, id) {
  const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
  assert.ok(shape, 'OCCT built it');
  return props(shape);
}
function readStep(text) {
  oc.FS.writeFile('/in.step', text);
  const reader = new oc.STEPControl_Reader();
  reader.ReadFile('/in.step');
  reader.TransferRoots(new oc.Message_ProgressRange());
  const p = props(reader.OneShape());
  const an = new oc.BRepCheck_Analyzer(p.shape, true, false, false);
  return { volume: p.volume, valid: an.IsValid_2 ? an.IsValid_2() : an.IsValid() };
}
// Open edges of the mesh, and the volume it encloses (a face turned inside out would show as a wrong volume).
function meshCheck(json, id, defl) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  assert.ok(m.positions, JSON.stringify(m).slice(0, 200));
  const P = m.positions, I = m.indices;
  const ids = new Map();
  const canon = [];
  for (let i = 0; i < P.length / 3; i++) {
    const k = `${Math.round(P[3 * i] / 1e-6)},${Math.round(P[3 * i + 1] / 1e-6)},${Math.round(P[3 * i + 2] / 1e-6)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    canon.push(ids.get(k));
  }
  const dir = new Map();
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const p = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
    const [A, B, C] = [p(a), p(b), p(c)];
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    for (let e = 0; e < 3; e++) {
      const x = canon[I[t + e]], y = canon[I[t + ((e + 1) % 3)]];
      if (x !== y) dir.set(`${x}>${y}`, (dir.get(`${x}>${y}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [k, n] of dir) {
    const [u, w] = k.split('>');
    if ((dir.get(`${w}>${u}`) ?? 0) !== n) open++;
  }
  return { open, vol };
}
function built(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const id = r.doc.features.at(-1).id;
  const json = JSON.stringify({ ...r.doc, measure: id });
  const out = JSON.parse(brep.build_doc_json(json));
  return { r, id, json, out, mine: JSON.parse(brep.measure_doc(json)).shapes[id] };
}

const PI = Math.PI;
// What a round of radius r takes off a rim, spun: the corner square less the quarter disc, by Pappus. `rho` is the radius of
// the rim's circle and `sign` -1 when the part lies toward the axis (an outer rim), +1 when it lies away from it (a bore mouth).
const ring = (rho, r, sign) => {
  const A = (1 - PI / 4) * r * r;
  const square = rho + (sign * r) / 2;
  const disc = rho + sign * (r - (4 * r) / (3 * PI));
  return 2 * PI * ((r * r * square - ((PI * r * r) / 4) * disc) / A) * A;
};
// The chamfer takes a right triangle of legs c: centroid a third of the way from the corner.
const tri = (rho, c, sign) => 2 * PI * (rho + (sign * c) / 3) * ((c * c) / 2);
const R = 20, H = 20;
const CYL = PI * R * R * H;
const bore = (d, len) => PI * (d / 2) ** 2 * len;
// The wall's own corner clears a chamfer of up to w (2 - sqrt2); beyond that it bites, with legs c - w (2 - sqrt2) (closed end).
const SQ2 = Math.SQRT2;
const closedLeg = (c, w) => c - (2 - SQ2) * w;
// The open end: the offset plane meets the open face at legs c + w (sqrt2 - 1).
const openLeg = (c, w) => c + (SQ2 - 1) * w;

const C0 = 'let v = cylinder(40, 20)\n';
const bevel = (end, s) => `bevel(v.edge('${end}', 'side'), ${s})\n`;
const rnd = (end, s) => `round(v.edge('${end}', 'side'), ${s})\n`;
const holeS = (d, extra = '') => `hole(v, { across: ${d}${extra} })\n`;
const hollowS = (w, open) => `hollow(v, { wall: ${w}${open ? `, open: '${open}'` : ''} })\n`;

const ringBoth = 2 * ring(R, 3, -1);
const triBoth = 2 * tri(R, 3, -1);

// [name, script, closed-form volume, OCCT agrees (the referee is right about it)]
const cases = [
  // (a) a second rim
  ['round the top rim, then the bottom rim', C0 + rnd('top', 3) + rnd('bottom', 3), CYL - ringBoth, true],
  ['round top, chamfer bottom', C0 + rnd('top', 3) + bevel('bottom', 3), CYL - ring(R, 3, -1) - tri(R, 3, -1), true],
  ['chamfer top, round bottom', C0 + bevel('top', 3) + rnd('bottom', 3), CYL - ring(R, 3, -1) - tri(R, 3, -1), true],
  ['chamfer both rims', C0 + bevel('top', 3) + bevel('bottom', 3), CYL - triBoth, true],
  ['round both rims, different sizes (4, 2.5)', C0 + rnd('top', 4) + rnd('bottom', 2.5), CYL - ring(R, 4, -1) - ring(R, 2.5, -1), true],
  ['chamfer the bottom first, then round the top (the wall has moved its origin)', C0 + bevel('bottom', 3) + rnd('top', 3), CYL - tri(R, 3, -1) - ring(R, 3, -1), true],
  ['chamfer bottom, round top, then bore 8', C0 + bevel('bottom', 3) + rnd('top', 3) + holeS(8), CYL - tri(R, 3, -1) - ring(R, 3, -1) - bore(8, H), true],
  ['a plate 80 x 10, both rims rounded 4, bored 20', 'let v = cylinder(80, 10)\n' + rnd('top', 4) + rnd('bottom', 4) + holeS(20), PI * 1600 * 10 - 2 * ring(40, 4, -1) - bore(20, 10), true],
  ['a tall pin: 12 x 40, both rims chamfered 1.5', 'let v = cylinder(12, 40)\n' + bevel('top', 1.5) + bevel('bottom', 1.5), PI * 36 * 40 - 2 * tri(6, 1.5, -1), true],
  ['a washer 40 x 3, both rims rounded 1', 'let v = cylinder(40, 3)\n' + rnd('top', 1) + rnd('bottom', 1), PI * 400 * 3 - 2 * ring(R, 1, -1), true],
  // round or chamfer after a coaxial hole
  ['bore 8, then round the top rim', C0 + holeS(8) + rnd('top', 3), CYL - bore(8, H) - ring(R, 3, -1), true],
  ['bore 8, then round both rims', C0 + holeS(8) + rnd('top', 3) + rnd('bottom', 3), CYL - bore(8, H) - ringBoth, true],
  ['bore 8, then chamfer both rims', C0 + holeS(8) + bevel('top', 3) + bevel('bottom', 3), CYL - bore(8, H) - triBoth, true],
  ['bore 8, round top, chamfer bottom', C0 + holeS(8) + rnd('top', 3) + bevel('bottom', 3), CYL - bore(8, H) - ring(R, 3, -1) - tri(R, 3, -1), true],
  ['blind bore 8 deep 8, then chamfer the top rim', C0 + holeS(8, ', deep: 8') + bevel('top', 3), CYL - bore(8, 8) - tri(R, 3, -1), true],
  ['blind bore 8 deep 8, then round the top rim', C0 + holeS(8, ', deep: 8') + rnd('top', 3), CYL - bore(8, 8) - ring(R, 3, -1), true],
  ['a bore nearly the whole width (38), then chamfer 0.5', C0 + holeS(38) + bevel('top', 0.5), CYL - bore(38, H) - tri(R, 0.5, -1), true],
  // hole after round or chamfer
  ['round both rims, then bore 8 (acceptance)', C0 + rnd('top', 3) + rnd('bottom', 3) + holeS(8), CYL - ringBoth - bore(8, H), true],
  ['chamfer both rims, then bore 8', C0 + bevel('top', 3) + bevel('bottom', 3) + holeS(8), CYL - triBoth - bore(8, H), true],
  ['round both rims, then blind bore 8 deep 8', C0 + rnd('top', 3) + rnd('bottom', 3) + holeS(8, ', deep: 8'), CYL - ringBoth - bore(8, 8), true],
  ['an off-centre cylinder, rounded both rims, then bored', 'let v = cylinder(40, 20, { at: [5, 7, 3] })\n' + rnd('top', 3) + rnd('bottom', 3) + holeS(8), CYL - ringBoth - bore(8, H), true],
  // hollow with a rim round or chamfer
  ['chamfer top 3, hollow open top, wall 2', C0 + bevel('top', 3) + hollowS(2, 'top'),
    CYL - tri(R, 3, -1) - (PI * 18 * 18 * 18 - tri(18, openLeg(3, 2), -1)), true],
  ['chamfer top 3, hollow open bottom, wall 2', C0 + bevel('top', 3) + hollowS(2, 'bottom'),
    CYL - tri(R, 3, -1) - (PI * 18 * 18 * 18 - tri(18, closedLeg(3, 2), -1)), true],
  ['chamfer both 3, hollow open top, wall 2', C0 + bevel('top', 3) + bevel('bottom', 3) + hollowS(2, 'top'),
    CYL - triBoth - (PI * 18 * 18 * 18 - tri(18, openLeg(3, 2), -1) - tri(18, closedLeg(3, 2), -1)), true],
  ['round bottom 3, hollow open top, wall 2', C0 + rnd('bottom', 3) + hollowS(2, 'top'),
    CYL - ring(R, 3, -1) - (PI * 18 * 18 * 18 - ring(18, 1, -1)), true],
  ['a small chamfer (1) the wall clears: the cavity is a plain cylinder, open top', C0 + bevel('top', 1) + hollowS(2, 'top'),
    CYL - tri(R, 1, -1) - (PI * 18 * 18 * 18 - tri(18, openLeg(1, 2), -1)), true],
  // OpenCascade's shell goes wrong when a CLOSED-end chamfer is smaller than the wall's own corner clears (it keeps the chamfer's
  // offset face and takes a slab off the cavity: measured 16143.7 against 13701.3 from an independent distance-field oracle (brep-rs
  // 13763.3, the 62 mm^3 more being the meet-of-planes sliver at the open chamfer) on cylinder(33.34, 35.75) bevelled 1.09 / 3.09,
  // wall 3.47, open bottom), so the closed form is the oracle here.
  ['a small chamfer (1) at the CLOSED end, wall 2, open bottom: the cavity is the plain cup', C0 + bevel('top', 1) + hollowS(2, 'bottom'),
    CYL - tri(R, 1, -1) - PI * 18 * 18 * 18, false],
  ['plain cylinder, hollow open at the bottom (it only built open at the top before)', C0 + hollowS(2, 'bottom'), CYL - PI * 18 * 18 * 18, true],
  ['bore 8, chamfer both, hollow open top, wall 2', C0 + holeS(8) + bevel('top', 3) + bevel('bottom', 3) + hollowS(2, 'top'),
    CYL - bore(8, H) - triBoth - (PI * (18 * 18 - 36) * 18 - tri(18, openLeg(3, 2), -1) - tri(18, closedLeg(3, 2), -1)), false],
  // closed hollows (OCCT's closed shell of a drilled part is wrong; the closed forms rule)
  ['round both 3, hollow closed, wall 2', C0 + rnd('top', 3) + rnd('bottom', 3) + hollowS(2),
    CYL - ringBoth - (PI * 18 * 18 * 16 - 2 * ring(18, 1, -1)), false],
  ['chamfer both 3, hollow closed, wall 2', C0 + bevel('top', 3) + bevel('bottom', 3) + hollowS(2),
    CYL - triBoth - (PI * 18 * 18 * 16 - 2 * tri(18, closedLeg(3, 2), -1)), false],
  ['bore 8, chamfer top, hollow closed is a bushing with a sealed wall', C0 + holeS(8) + bevel('top', 3) + hollowS(2),
    CYL - bore(8, H) - tri(R, 3, -1) - (PI * (18 * 18 - 36) * 16 - tri(18, closedLeg(3, 2), -1)), false],
];

for (const [name, code, want, referee] of cases) {
  test(`turned part: ${name}`, () => {
    const { r, id, json, out, mine } = built(code);
    assert.deepEqual(out.refusals, {}, JSON.stringify(out.refusals));
    assert.ok(Math.abs(mine.volume - want) <= 1e-7 * want, `closed form ${want} vs ${mine.volume}`);
    if (referee) {
      const ref = occt(r.doc.features, id);
      assert.ok(Math.abs(mine.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${mine.volume} vs OCCT ${ref.volume}`);
      for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(mine.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${mine.bbox[a][k]} vs ${ref.bbox[a][k]}`);
    }
    for (const d of [0.05, 0.5]) {
      const m = meshCheck(json, id, d);
      assert.equal(m.open, 0, `open mesh at ${d}`);
      // the mesh is a polyhedron inside the curved part: its volume is the part's, less the chord error
      assert.ok(m.vol > 0 && Math.abs(m.vol - want) <= (d === 0.5 ? 0.12 : 0.02) * want, `mesh volume ${m.vol} vs ${want} at ${d}`);
    }
  });
}

test('the referee agrees on at least 15 of the scripts, and at least 25 build', () => {
  assert.ok(cases.filter((c) => c[3]).length >= 15);
  assert.ok(cases.length >= 25);
});

// OpenCascade's closed `shell` silently returns the part un-hollowed here (S4d found it for a drilled box; it does the same for a
// turned part), so a closed hollow has no referee: the closed form is the oracle, and the OCCT answer is pinned as the defect.
test('OpenCascade cannot be the referee for a closed hollow of a chamfered cylinder (it returns the solid part)', () => {
  const { r, id, mine } = built(C0 + bevel('top', 3) + bevel('bottom', 3) + hollowS(2));
  const ref = occt(r.doc.features, id);
  assert.ok(Math.abs(ref.volume - (CYL - triBoth)) < 1e-6 * CYL, `OCCT ${ref.volume}`);
  assert.ok(mine.volume < 0.5 * ref.volume);
});

// STEP: every turned part with a closed-form volume exports (planes, cylinders, cones, and since W3 tori) and reads back in OCCT
// at that volume. The hollowed ones are covered by step-curved.test.mjs; here the parts whose want is exact.
const stepCases = cases.filter(([name]) => !/blind/.test(name));
test('STEP export of turned parts, rounded or chamfered, reads back in OCCT with the same volume (at least 12)', () => {
  let n = 0, refused = [];
  for (const [name, code, want] of stepCases) {
    const { json, id } = built(code);
    const f = JSON.parse(brep.export_step(json, id));
    if (!f.step) { refused.push(`${name}: ${JSON.stringify(f).slice(0, 120)}`); continue; }
    const back = readStep(f.step);
    assert.ok(Math.abs(back.volume - want) <= 1e-6 * want, `${name}: STEP ${back.volume} vs ${want}`);
    assert.equal(back.valid, true, name);
    n++;
  }
  assert.ok(n >= 12, `${n} round trips; refused: ${refused.join(' | ')}`);
});

test('a part with a round now exports: tori read back at the closed-form volume', () => {
  const { json, id } = built(C0 + rnd('top', 3) + rnd('bottom', 3));
  const f = JSON.parse(brep.export_step(json, id));
  assert.ok(f.step && /TOROIDAL_SURFACE/.test(f.step), JSON.stringify(f).slice(0, 200));
  const back = readStep(f.step);
  const want = CYL - ringBoth;
  assert.ok(Math.abs(back.volume - want) <= 1e-6 * want, `${back.volume} vs ${want}`);
});

// Names survive: the part built by the profile keeps its faces nameable, so a second feature finds the rim it names. The top
// rim was already rounded, so its sharp edge is gone: a bevel of it says so (not "only a box").
test('a rim that is already rounded cannot be rounded again, and the sentence says why', () => {
  assert.match(sentence(C0 + rnd('top', 3) + rnd('bottom', 3) + bevel('top', 0.5)), /not a sharp rim of this turned part any more/);
});

// What still refuses, each in a sentence, the part shown without the feature (never a guess).
function sentence(code) {
  const { out } = built(code);
  const why = Object.values(out.refusals ?? {}).map(String);
  assert.equal(why.length, 1, `${code}: ${JSON.stringify(out.refusals)}`);
  return why[0];
}
test('a round that would eat the rim refuses: both 10 on a 20 high cylinder', () => {
  assert.match(sentence(C0 + rnd('top', 10) + rnd('bottom', 10)), /would not fit its edge/);
});
test('a chamfer larger than the radius refuses', () => {
  assert.match(sentence(C0 + bevel('top', 21)), /would not fit its edge/);
});
test('the wall at a rounded open end has no definite shape: refuses', () => {
  assert.match(sentence(C0 + rnd('top', 3) + hollowS(2, 'top')), /rounded rim at the open end/);
});
test('a wall thicker than the part allows refuses', () => {
  assert.match(sentence(C0 + holeS(30) + bevel('top', 1) + hollowS(5)), /cannot hollow this part/);
});
test('a bore off the axis keeps the older refusal for a round after it', () => {
  assert.match(sentence(C0 + holeS(6, ', at: [10, 0]') + rnd('top', 3)), /can only round a straight edge between two flat faces yet/);
});
test('a chamfer after a hollow whose lip is narrower than the chamfer refuses', () => {
  assert.match(sentence(C0 + holeS(8) + hollowS(2, 'top') + bevel('top', 3)), /would not fit its edge/);
});
