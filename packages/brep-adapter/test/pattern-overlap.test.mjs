// S4b: a linear or polar pattern whose copies OVERLAP used to refuse ("its copies overlap, which
// brep-rs cannot combine without a boolean yet"). The pattern now folds the union boolean over the
// copies (planar and cylindrical targets only) and refuses, in a sentence, when a step cannot be
// built exactly or the result fails the volume sandwich. Disjoint patterns keep the no-boolean path.
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

function prep(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const id = r.doc.features.at(-1).id;
  return { r, id, json: JSON.stringify({ ...r.doc, measure: id }) };
}
function mine(code) {
  const { r, id, json } = prep(code);
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes[id];
  return { refusals, volume: s?.volume, bbox: s?.bbox, r, id, json };
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
// Mesh volume plus closure (every undirected edge used by exactly two triangles, vertices welded by position).
function meshStats(json, id, defl) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  assert.ok(!m.error, m.error);
  const key = (i) => [0, 1, 2].map((k) => Math.round(m.positions[i * 3 + k] * 1e6)).join(',');
  const uses = new Map();
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const ix = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const p = ix.map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
    v += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    for (let e = 0; e < 3; e++) {
      const a = key(ix[e]), b = key(ix[(e + 1) % 3]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (n !== 2) open++;
  return { vol: v, open };
}

const LIN = (shape, n, step) => `const b = ${shape}\nlinearPattern(b, { count: ${n}, step: [${step}] })`;
const POL = (shape, n, axis = 'z') => `const b = ${shape}\npolarPattern(b, { count: ${n}, axis: '${axis}' })`;
const LENS = (r, d) => 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);

test('three overlapping 20x20x10 boxes at step 15 join to exactly 10000', () => {
  const m = mine(LIN('box(20, 20, 10)', 3, '15, 0, 0'));
  assert.deepEqual(m.refusals, {});
  assert.ok(Math.abs(m.volume - 10000) < 1e-6, `${m.volume}`);
});

test('three overlapping d20 cylinders at step 15 join to 10*(3*pi*100 - 2*lens)', () => {
  const m = mine(LIN('cylinder(20, 10)', 3, '15, 0, 0'));
  assert.deepEqual(m.refusals, {});
  const want = 10 * (3 * Math.PI * 100 - 2 * LENS(10, 15));
  assert.ok(Math.abs(m.volume - want) < 1e-6 * want, `${m.volume} vs ${want}`);
  assert.ok(Math.abs(m.volume - 8518.154) < 1e-3);
});

test('polar boxes whose copies overlap at the centre: plus sign and straight bar, closed forms', () => {
  const plus = mine(POL('box(20, 8, 6, { at: [6, 0, 0] })', 4));
  assert.deepEqual(plus.refusals, {});
  assert.ok(Math.abs(plus.volume - 2688) < 1e-6, `${plus.volume}`);
  const bar = mine(POL('box(20, 8, 6, { at: [6, 0, 0] })', 2));
  assert.deepEqual(bar.refusals, {});
  assert.ok(Math.abs(bar.volume - 1536) < 1e-6, `${bar.volume}`);
});

test('disjoint patterns keep the no-boolean path (volume is the plain sum)', () => {
  const m = mine(LIN('box(20, 20, 10)', 3, '30, 0, 0'));
  assert.deepEqual(m.refusals, {});
  assert.ok(Math.abs(m.volume - 12000) < 1e-9);
});

test('a sphere pattern whose copies overlap still refuses, in a sentence', () => {
  const m = mine(LIN('sphere(20)', 2, '15, 0, 0'));
  assert.match(m.refusals.pat1 ?? '', /its copies overlap/);
  assert.equal(m.volume, undefined);
});

for (const [name, code] of [
  ['box x3', LIN('box(20, 20, 10)', 3, '15, 0, 0')],
  ['cylinder x3', LIN('cylinder(20, 10)', 3, '15, 0, 0')],
  ['plus', POL('box(20, 8, 6, { at: [6, 0, 0] })', 4)],
  ['hex prisms x3', POL('prism(6, 20, 8, { at: [8, 0, 0] })', 3)],
]) {
  test(`mesh watertight at 0.05 and 0.5, volume matches: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {});
    for (const defl of [0.05, 0.5]) {
      const s = meshStats(m.json, m.id, defl);
      assert.equal(s.open, 0, `open edges at ${defl}`);
      // a coarse mesh of a cylinder is inscribed, so allow chord error there
      assert.ok(Math.abs(s.vol - m.volume) < (defl === 0.05 ? 0.01 : 0.06) * m.volume, `${s.vol} vs ${m.volume} at ${defl}`);
    }
  });
}

// OCCT, the independent referee, on volume and bounding box. (Rings hang OCCT: none here.)
const REFEREE = {
  'box x2 step 15': LIN('box(20, 20, 10)', 2, '15, 0, 0'),
  'box x3 step 15': LIN('box(20, 20, 10)', 3, '15, 0, 0'),
  'box x4 diagonal step': LIN('box(20, 20, 10)', 4, '12, 9, 0'),
  'box x3 stepping up z': LIN('box(20, 20, 10)', 3, '5, 5, 6'),
  'box x5 tight step': LIN('box(20, 10, 10)', 5, '4, 0, 0'),
  'cylinder x2': LIN('cylinder(20, 10)', 2, '15, 0, 0'),
  'cylinder x3': LIN('cylinder(20, 10)', 3, '15, 0, 0'),
  'cylinder x3 diagonal': LIN('cylinder(16, 8)', 3, '9, 7, 0'),
  'prism hex x3 linear': LIN('prism(6, 20, 8)', 3, '14, 0, 0'),
  'prism pent x2 linear': LIN('prism(5, 18, 8)', 2, '10, 6, 0'),
  'wedge x3 linear': LIN('wedge(20, 10, 8)', 3, '12, 0, 0'),
  'hex prisms x2 polar': POL('prism(6, 20, 8, { at: [8, 0, 0] })', 2),
  'hex prisms x3 polar': POL('prism(6, 20, 8, { at: [8, 0, 0] })', 3),
  'plus box x4 polar': POL('box(20, 8, 6, { at: [6, 0, 0] })', 4),
  'cylinder x4 linear': LIN('cylinder(12, 6)', 4, '8, 0, 0'),
  'wedge x3 polar': POL('wedge(20, 10, 8, { at: [12, 0, 0] })', 3),
  'docs example at count 6': POL('cuboid(10, 30, 10, { at: [25, 0, 0] })', 6),
  'cylinder x3 polar': POL('cylinder(14, 8, { at: [6, 0, 0] })', 3),
};
for (const [name, code] of Object.entries(REFEREE)) {
  test(`OCCT agrees: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {}, name);
    const ref = occt(m.r.doc.features, m.id);
    assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${m.volume} vs OCCT ${ref.volume}`);
    for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(m.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${m.bbox[a][k]} vs OCCT ${ref.bbox[a][k]}`);
  });
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
for (const [name, code] of [
  ['box x3', LIN('box(20, 20, 10)', 3, '15, 0, 0')],
  ['cylinder x3', LIN('cylinder(20, 10)', 3, '15, 0, 0')],
  ['plus', POL('box(20, 8, 6, { at: [6, 0, 0] })', 4)],
  ['hex prisms x3', POL('prism(6, 20, 8, { at: [8, 0, 0] })', 3)],
]) {
  test(`STEP round trip: ${name}`, () => {
    const m = mine(code);
    assert.deepEqual(m.refusals, {});
    const f = JSON.parse(brep.export_step(m.json, m.id));
    assert.ok(f.step, JSON.stringify(f).slice(0, 200));
    const back = readStep(f.step);
    assert.ok(Math.abs(back.volume - m.volume) < 1e-6 * m.volume, `${back.volume} vs ${m.volume}`);
    assert.equal(back.solids, 1);
    assert.equal(back.valid, true);
  });
}

test('three bars crossing at 120 degrees: exact (matches OCCT) or a refusal, never a wrong solid', () => {
  const m = mine(POL('box(24, 6, 6, { at: [8, 0, 0] })', 3));
  if (Object.keys(m.refusals).length === 0) {
    const ref = occt(m.r.doc.features, m.id);
    assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `${m.volume} vs ${ref.volume}`);
  } else assert.match(m.refusals.pat1, /its copies overlap/);
});

test('a fold whose mesh would be open at a coarse chord refuses (sweep perm#1010: 101 open edges at 0.5)', () => {
  const m = mine("let v = cylinder(14.07, 13.7, { at: [-8.3, -9.41, -2.41] })\nconst p1 = cylinder(10.91, 17.95, { at: [-20.79, -7.77, -0.34] })\nv = cut(v, p1)\nrepeat(v, { count: 3, step: [20.36, 6.88, 0] })\nrepeatAround(v, { count: 3, axis: 'z' })");
  if (Object.keys(m.refusals).length === 0) for (const d of [0.05, 0.5]) assert.equal(meshStats(m.json, m.id, d).open, 0, `open edges at ${d}`);
  else assert.match(m.refusals.pat2, /its copies overlap/);
});

test('a pattern of a pattern too big to fold in reasonable time refuses instead of freezing (sweep BREP-HANG random#1059)', () => {
  const t0 = Date.now();
  const m = mine("let v = prism(6, 37.03, 24.39, { at: [-5.22, 4.66, 2.51] })\nrepeat(v, { count: 2, step: [30.58, 17.66, 0] })\nrepeatAround(v, { count: 5, axis: 'z' })\nrepeatAround(v, { count: 5, axis: 'z' })");
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
  assert.match(m.refusals.pat3 ?? '', /its copies overlap/);
});

test('a hole after an overlapping pattern still builds or refuses, never a wrong number', () => {
  const m = mine(LIN('box(20, 20, 10)', 3, '15, 0, 0') + '\nhole(b, { across: 6 })');
  if (Object.keys(m.refusals).length === 0) assert.ok(Math.abs(m.volume - (10000 - Math.PI * 9 * 10)) < 1e-6 * 10000, `${m.volume}`);
});
