// S4d: hollow of a box that already has round holes straight through it. The cavity is the
// part's own surface moved inward by the wall: the inset box less a tube of radius (bore + wall)
// round every bore. Closed forms below; OpenCascade is the independent referee for the OPEN
// hollows only -- for a CLOSED hollow of a drilled box it silently returns the un-hollowed solid
// (30994.69 for the 40 x 40 x 20 box with an 8 mm bore), so the closed cases rest on the closed form.
// A hole that stops inside the part (rounded wall at the floor's rim), a recess, a wall that cannot
// run round a hole, and a rim round or chamfer still refuse in a sentence, never a wrong solid.
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
const OPEN_SIDE = { top: [2, 1], bottom: [2, 0], front: [1, 0], back: [1, 1], left: [0, 0], right: [0, 1] };

/** Closed form: the box less its bores, less the cavity (inset box less a tube round every bore). */
function closedForm(size, bores, wall, open) {
  const inner = size.map((s) => s - 2 * wall);
  const centreShift = [0, 0, 0];
  if (open) {
    const [ax] = OPEN_SIDE[open];
    inner[ax] += wall;
    centreShift[ax] = wall / 2;
  }
  let part = size[0] * size[1] * size[2];
  let cavity = inner[0] * inner[1] * inner[2];
  for (const b of bores) {
    part -= PI * b.r * b.r * size[b.axis];
    cavity -= PI * (b.r + wall) ** 2 * inner[b.axis];
  }
  return part - cavity;
}

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const json = JSON.stringify({ ...r.doc, measure: r.doc.features.at(-1).id });
  const id = r.doc.features.at(-1).id;
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const shape = JSON.parse(brep.measure_doc(json)).shapes[id];
  return { r, json, id, refusals, shape };
}

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
  return open;
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

const AX = { x: 0, y: 1, z: 2 };
// [name, script, size, bores [{r, axis}], wall, open]
const B = 'const b = box(40, 40, 20)\n';
const cases = [
  ['the acceptance case: 8 bore, open bottom', B + "hole(b, { across: 8 })\nhollow(b, { wall: 2, open: 'bottom' })", [40, 40, 20], [{ r: 4, axis: 2 }], 2, 'bottom'],
  ['8 bore, open top, wall 2.5', B + "hole(b, { across: 8 })\nhollow(b, { wall: 2.5, open: 'top' })", [40, 40, 20], [{ r: 4, axis: 2 }], 2.5, 'top'],
  ['8 bore, closed', B + 'hole(b, { across: 8 })\nhollow(b, { wall: 2 })', [40, 40, 20], [{ r: 4, axis: 2 }], 2, null],
  ['off-centre 6 bore, open top', B + "hole(b, { across: 6, at: [8, -5] })\nhollow(b, { wall: 2, open: 'top' })", [40, 40, 20], [{ r: 3, axis: 2 }], 2, 'top'],
  ['two bores, open top', B + "hole(b, { across: 6, at: [-10, 0] })\nhole(b, { across: 6, at: [10, 0] })\nhollow(b, { wall: 2, open: 'top' })", [40, 40, 20], [{ r: 3, axis: 2 }, { r: 3, axis: 2 }], 2, 'top'],
  ['two bores, closed', B + 'hole(b, { across: 6, at: [-10, 0] })\nhole(b, { across: 6, at: [10, 0] })\nhollow(b, { wall: 2 })', [40, 40, 20], [{ r: 3, axis: 2 }, { r: 3, axis: 2 }], 2, null],
  ['two bores of different sizes, open bottom', B + "hole(b, { across: 8, at: [-10, 5] })\nhole(b, { across: 4, at: [10, -8] })\nhollow(b, { wall: 1.5, open: 'bottom' })", [40, 40, 20], [{ r: 4, axis: 2 }, { r: 2, axis: 2 }], 1.5, 'bottom'],
  ['four bores (holes), open bottom', 'const b = box(60, 60, 20)\nholes(b, { across: 6, apart: [30, 30] })\nhollow(b, { wall: 2, open: \'bottom\' })', [60, 60, 20], [3, 3, 3, 3].map((r) => ({ r, axis: 2 })), 2, 'bottom'],
  ['four bores (holes), closed', 'const b = box(60, 60, 20)\nholes(b, { across: 6, apart: [30, 30] })\nhollow(b, { wall: 2 })', [60, 60, 20], [3, 3, 3, 3].map((r) => ({ r, axis: 2 })), 2, null],
  ['hole on a side face (x), open top', B + "hole(b, { across: 6, along: 'x' })\nhollow(b, { wall: 2, open: 'top' })", [40, 40, 20], [{ r: 3, axis: 0 }], 2, 'top'],
  ['hole on a side face (x), closed', B + "hole(b, { across: 6, along: 'x' })\nhollow(b, { wall: 2 })", [40, 40, 20], [{ r: 3, axis: 0 }], 2, null],
  ['hole through the front (y), off-centre, closed, wall 3', 'const b = box(40, 40, 30)\nhole(b, { across: 8, along: \'y\', at: [5, 3] })\nhollow(b, { wall: 3 })', [40, 40, 30], [{ r: 4, axis: 1 }], 3, null],
  ['hole through the front (y), open top', 'const b = box(40, 40, 30)\nhole(b, { across: 8, along: \'y\', at: [5, 3] })\nhollow(b, { wall: 3, open: \'top\' })', [40, 40, 30], [{ r: 4, axis: 1 }], 3, 'top'],
  ['hole along y with the open face at the front', 'const b = box(50, 40, 30)\nhole(b, { across: 10, along: \'y\' })\nhollow(b, { wall: 2, open: \'front\' })', [50, 40, 30], [{ r: 5, axis: 1 }], 2, 'front'],
  ['hole along x with the open face at the right', 'const b = box(50, 40, 30)\nhole(b, { across: 10, along: \'x\' })\nhollow(b, { wall: 2, open: \'right\' })', [50, 40, 30], [{ r: 5, axis: 0 }], 2, 'right'],
  ['a wide bore leaving a 1 mm ring of cavity, closed', B + 'hole(b, { across: 30 })\nhollow(b, { wall: 2 })', [40, 40, 20], [{ r: 15, axis: 2 }], 2, null],
  ['thin wall 0.5, open top', B + "hole(b, { across: 12, at: [-6, 6] })\nhollow(b, { wall: 0.5, open: 'top' })", [40, 40, 20], [{ r: 6, axis: 2 }], 0.5, 'top'],
];

for (const [name, code, size, bores, wall, open] of cases) {
  test(`hollow with holes: ${name} matches the closed form, watertight`, () => {
    const { json, id, refusals, shape } = build(code);
    assert.deepEqual(refusals, {}, name);
    const want = closedForm(size, bores, wall, open);
    assert.ok(Math.abs(shape.volume - want) <= 1e-7 * want, `volume ${shape.volume} vs closed form ${want}`);
    for (const defl of [0.05, 0.5]) assert.equal(openEdges(json, id, defl), 0, `open mesh edges at ${defl}`);
  });
  if (open) {
    test(`hollow with holes: ${name} agrees with OpenCascade`, () => {
      const { r, id, shape } = build(code);
      const ref = occt(r.doc.features, id);
      assert.ok(Math.abs(shape.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${shape.volume} vs OCCT ${ref.volume}`);
      for (let a = 0; a < 2; a++)
        for (let k = 0; k < 3; k++)
          assert.ok(Math.abs(shape.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${shape.bbox[a][k]} vs ${ref.bbox[a][k]}`);
    });
  }
}

test('the acceptance case is 8672 + 1130.97 - 100.53 = 9702.44', () => {
  const { shape } = build(B + "hole(b, { across: 8 })\nhollow(b, { wall: 2, open: 'bottom' })");
  // plain open cup 8672; the ring of wall round the bore adds pi (6^2 - 4^2) 18 = 1130.97; the bore
  // through the 2 mm top wall takes away pi 4^2 2 = 100.53
  const want = 8672 + PI * (36 - 16) * 18 - PI * 16 * 2;
  assert.ok(Math.abs(want - 9702.442) < 0.001, `${want}`);
  assert.ok(Math.abs(shape.volume - want) < 1e-7 * want, `${shape.volume}`);
});

for (const [name, code, size, bores, wall, open] of [cases[0], cases[2], cases[5], cases[9], cases[11]]) {
  test(`hollow with holes: STEP round trip, ${name}`, () => {
    const { json, id } = build(code);
    const f = JSON.parse(brep.export_step(json, id));
    assert.ok(f.step, JSON.stringify(f).slice(0, 200));
    const back = readStep(f.step);
    const want = closedForm(size, bores, wall, open);
    assert.ok(Math.abs(back.volume - want) < 1e-6 * want, `${back.volume} vs ${want}`);
    assert.equal(back.solids, 1);
    assert.equal(back.valid, true);
  });
}

// ---- a round part with a coaxial bore: the cavity is a tube of its own -------------------------------
const CYL = 'const p = cylinder(40, 30)\nhole(p, { across: 10 })\n';
const cylForm = (R, r, h, w, open) => {
  const part = PI * (R * R - r * r) * h;
  const ch = open ? h - w : h - 2 * w;
  return part - PI * ((R - w) ** 2 - (r + w) ** 2) * ch;
};
test('round part with an axial bore, open top: closed form and OpenCascade', () => {
  const { r, id, json, shape } = build(CYL + "hollow(p, { wall: 3, open: 'top' })");
  const want = cylForm(20, 5, 30, 3, true);
  assert.ok(Math.abs(shape.volume - want) <= 1e-7 * want, `${shape.volume} vs ${want}`);
  const ref = occt(r.doc.features, id);
  assert.ok(Math.abs(shape.volume - ref.volume) <= 1e-6 * ref.volume, `${shape.volume} vs OCCT ${ref.volume}`);
  for (const d of [0.05, 0.5]) assert.equal(openEdges(json, id, d), 0);
});
test('round part with an axial bore, closed: closed form (OpenCascade leaves it un-hollowed)', () => {
  const { id, json, refusals, shape } = build(CYL + 'hollow(p, { wall: 3 })');
  assert.deepEqual(refusals, {});
  const want = cylForm(20, 5, 30, 3, false);
  assert.ok(Math.abs(shape.volume - want) <= 1e-7 * want, `${shape.volume} vs ${want}`);
  for (const d of [0.05, 0.5]) assert.equal(openEdges(json, id, d), 0);
  const back = readStep(JSON.parse(brep.export_step(json, id)).step);
  assert.ok(Math.abs(back.volume - want) < 1e-6 * want && back.solids === 1 && back.valid);
});
test('round part with a bore too wide for the wall to run round it refuses', () => {
  const { r, refusals } = build('const p = cylinder(40, 30)\nhole(p, { across: 30 })\nhollow(p, { wall: 3 })');
  assert.ok(refusals[r.doc.features.at(-1).id]?.includes('thinner wall'));
});

// ---- a chamfer made before the hollow: the cavity is the inset box with the chamfer's plane moved
// in by the wall. A 45 degree chamfer of leg c cuts a triangle of legs c + sqrt2 wall - (walls to the
// inset box's faces on its two sides) off the cavity, along the whole edge.
const S2 = Math.SQRT2;
/** [name, script, closed-form volume, open face (or null), bore radius list] */
function chamferCase(name, code, volume, open) {
  return [name, code, volume, open];
}
const wedge = (L, len) => (L > 0 ? (L * L) / 2 * len : 0);
const chamferCases = [
  // top-front edge (along x), chamfer 3: part 32000 - 3^2/2 x 40
  chamferCase('top-front chamfer 3, wall 2.5, open top', B + "chamfer(b.edge('top', 'front'), 3)\nhollow(b, { wall: 2.5, open: 'top' })",
    32000 - 180 - (35 * 35 * 17.5 - wedge(3 + S2 * 2.5 - 2.5, 35)), 'top'),
  chamferCase('top-front chamfer 3, wall 2, closed', B + "chamfer(b.edge('top', 'front'), 3)\nhollow(b, { wall: 2 })",
    32000 - 180 - (36 * 36 * 16 - wedge(3 + S2 * 2 - 4, 36)), null),
  chamferCase('top-front chamfer 3, wall 2, open bottom', B + "chamfer(b.edge('top', 'front'), 3)\nhollow(b, { wall: 2, open: 'bottom' })",
    32000 - 180 - (36 * 36 * 18 - wedge(3 + S2 * 2 - 4, 36)), 'bottom'),
  chamferCase('top-front chamfer 8 (bigger than the wall), wall 2, open top', B + "chamfer(b.edge('top', 'front'), 8)\nhollow(b, { wall: 2, open: 'top' })",
    32000 - (8 * 8) / 2 * 40 - (36 * 36 * 18 - wedge(8 + S2 * 2 - 2, 36)), 'top'),
  chamferCase('top-front chamfer 1, wall 3, open top', B + "chamfer(b.edge('top', 'front'), 1)\nhollow(b, { wall: 3, open: 'top' })",
    32000 - 20 - (34 * 34 * 17 - wedge(1 + S2 * 3 - 3, 34)), 'top'),
  chamferCase('a chamfer so small the wall clears it (no cut in the cavity), wall 3, closed', B + "chamfer(b.edge('top', 'front'), 0.5)\nhollow(b, { wall: 3 })",
    32000 - 5 - 34 * 34 * 14, null),
  // vertical edge (along z), chamfer 4
  chamferCase('front-right vertical chamfer 4, wall 2, open top', B + "chamfer(b.edge('front', 'right'), 4)\nhollow(b, { wall: 2, open: 'top' })",
    32000 - 8 * 20 - (36 * 36 * 18 - wedge(4 + S2 * 2 - 4, 18)), 'top'),
  chamferCase('two top chamfers, wall 2, open bottom', B + "chamfer(b.edge('top', 'front'), 3)\nchamfer(b.edge('top', 'back'), 3)\nhollow(b, { wall: 2, open: 'bottom' })",
    32000 - 360 - (36 * 36 * 18 - 2 * wedge(3 + S2 * 2 - 4, 36)), 'bottom'),
  // a chamfer and a bore together, in either order
  chamferCase('chamfer then bore, wall 2, open top', B + "chamfer(b.edge('top', 'front'), 3)\nhole(b, { across: 8 })\nhollow(b, { wall: 2, open: 'top' })",
    32000 - 180 - PI * 16 * 20 - (36 * 36 * 18 - wedge(3 + S2 * 2 - 2, 36) - PI * 36 * 18), 'top'),
  chamferCase('bore then chamfer, wall 2, closed', B + "hole(b, { across: 8 })\nchamfer(b.edge('top', 'front'), 3)\nhollow(b, { wall: 2 })",
    32000 - 180 - PI * 16 * 20 - (36 * 36 * 16 - wedge(3 + S2 * 2 - 4, 36) - PI * 36 * 16), null),
];
for (const [name, code, want, open] of chamferCases) {
  test(`hollow with a chamfer: ${name} matches the closed form, watertight`, () => {
    const { json, id, refusals, shape } = build(code);
    assert.deepEqual(refusals, {}, name);
    assert.ok(Math.abs(shape.volume - want) <= 1e-7 * want, `volume ${shape.volume} vs closed form ${want}`);
    for (const defl of [0.05, 0.5]) assert.equal(openEdges(json, id, defl), 0, `open mesh edges at ${defl}`);
  });
  if (open)
    test(`hollow with a chamfer: ${name} agrees with OpenCascade`, () => {
      const { r, id, shape } = build(code);
      const ref = occt(r.doc.features, id);
      assert.ok(Math.abs(shape.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${shape.volume} vs OCCT ${ref.volume}`);
      for (let a = 0; a < 2; a++)
        for (let k = 0; k < 3; k++)
          assert.ok(Math.abs(shape.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${shape.bbox[a][k]} vs ${ref.bbox[a][k]}`);
    });
}
for (const [name, code, want] of [chamferCases[1], chamferCases[7], chamferCases[9]]) {
  test(`hollow with a chamfer: STEP round trip, ${name}`, () => {
    const { json, id } = build(code);
    const back = readStep(JSON.parse(brep.export_step(json, id)).step);
    assert.ok(Math.abs(back.volume - want) < 1e-6 * want, `${back.volume} vs ${want}`);
    assert.equal(back.solids, 1);
    assert.equal(back.valid, true);
  });
}

// ---- what still refuses, in a sentence, with the part left as it was ------------------------------
const refuses = [
  ['a blind hole (rounded wall at its floor)', B + "hole(b, { across: 8, deep: 6 })\nhollow(b, { wall: 2, open: 'bottom' })", 'blind hole'],
  ['a counterbored hole', B + 'hole(b, { across: 6, counterbore: { across: 12, deep: 3 } })\nhollow(b, { wall: 2 })', 'blind hole'],
  ['a bore too near the side for the wall to run round it', B + 'hole(b, { across: 8, at: [14, 0] })\nhollow(b, { wall: 2 })', 'thinner wall'],
  ['two bores close enough that their walls meet', B + 'hole(b, { across: 8, at: [-6, 0] })\nhole(b, { across: 8, at: [6, 0] })\nhollow(b, { wall: 2 })', 'thinner wall'],
  ['a rounded edge', B + "round(b.edge('top', 'front'), 3)\nhollow(b, { wall: 2.5, open: 'top' })", 'can only hollow a box or a straight cylinder yet'],
];
for (const [name, code, word] of refuses) {
  test(`hollow with holes still refuses: ${name}`, () => {
    const { r, refusals } = build(code);
    const hid = r.doc.features.find((f) => f.kind === 'shell').id;
    assert.ok(refusals[hid], `expected a refusal for ${hid}, got ${JSON.stringify(refusals)}`);
    assert.ok(refusals[hid].includes(word), refusals[hid]);
    assert.ok(!/NaN|undefined/.test(refusals[hid]));
  });
}
