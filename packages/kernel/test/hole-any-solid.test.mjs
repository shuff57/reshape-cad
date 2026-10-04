// S4c: a hole in a part that is not a plain box or cylinder. A fully rounded box, a chamfered cylinder and the like used
// to refuse ("brep-rs cannot cut this hole yet") because the hole builder wanted a plain part. The bore is now cut through
// the planar split-and-classify subtract, with every face the bore never reaches (the corner spheres, the edge rounds, the
// chamfer cone) carried through untouched. A bore that DOES reach a curved round or chamfer face still refuses, in a
// sentence. Closed forms first, then OpenCascade as the independent referee (volume + bbox), a watertight mesh at two
// deflections, and a STEP round trip read back by OCCT.
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
function openEdges(json, id, defl) {
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
function built(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const id = r.doc.features.at(-1).id;
  const json = JSON.stringify({ ...r.doc, measure: id });
  const out = JSON.parse(brep.build_doc_json(json));
  return { r, id, json, out, mine: JSON.parse(brep.measure_doc(json)).shapes[id] };
}

const PI = Math.PI;
// A box a x b x c with every edge rounded r: the flat block, four slabs ... (a-2r)(b-2r)(c-2r) + 2r[sum of face areas of the
// shrunk box] + pi r^2 [sum of the shrunk edge lengths] + 4/3 pi r^3.
const roundedBox = (a, b, c, r) => {
  const [x, y, z] = [a - 2 * r, b - 2 * r, c - 2 * r];
  return x * y * z + 2 * r * (x * y + y * z + x * z) + PI * r * r * (x + y + z) + (4 / 3) * PI * r ** 3;
};
// A cylinder of radius R, height h, its top rim chamfered c: less the triangle ring, centroid R - c/3 from the axis.
const chamferedCyl = (R, h, c) => PI * R * R * h - 2 * PI * (R - c / 3) * ((c * c) / 2);
const bore = (d, len) => PI * (d / 2) ** 2 * len;

// [name, script, closed-form volume]
const BOX = 'let v = box(40, 40, 20)\nround(v, 3)\n';
const CYL = "let v = cylinder(40, 20)\nbevel(v.edge('top', 'side'), 3)\n";
const cases = [
  ['acceptance: fully rounded 40x40x20 (r 3), bored 8 through', BOX + 'hole(v, { across: 8 })', roundedBox(40, 40, 20, 3) - bore(8, 20)],
  ['acceptance: cylinder 40 x 20, rim chamfer 3, bored 8 through', CYL + 'hole(v, { across: 8 })', chamferedCyl(20, 20, 3) - bore(8, 20)],
  ['rounded box, blind bore 8 deep 8', BOX + 'hole(v, { across: 8, deep: 8 })', roundedBox(40, 40, 20, 3) - bore(8, 8)],
  ['rounded box, bore 8 off centre (10, 6)', BOX + 'hole(v, { across: 8, at: [10, 6] })', roundedBox(40, 40, 20, 3) - bore(8, 20)],
  ['rounded box, bore 6 at (-12, 10), blind 12', BOX + 'hole(v, { across: 6, deep: 12, at: [-12, 10] })', roundedBox(40, 40, 20, 3) - bore(6, 12)],
  ['rounded box, bore 12 clear of the rounds', BOX + 'hole(v, { across: 12 })', roundedBox(40, 40, 20, 3) - bore(12, 20)],
  ['rounded box, two separate bores', BOX + 'hole(v, { across: 8, at: [-10, 0] })\nhole(v, { across: 6, at: [10, 0] })', roundedBox(40, 40, 20, 3) - bore(8, 20) - bore(6, 20)],
  ['rounded box 30^3 (r 2), bore 10', 'let v = box(30, 30, 30)\nround(v, 2)\nhole(v, { across: 10 })', roundedBox(30, 30, 30, 2) - bore(10, 30)],
  ['rounded box 60x40x10 (r 1.5), bore 20 at (8, -4)', 'let v = box(60, 40, 10)\nround(v, 1.5)\nhole(v, { across: 20, at: [8, -4] })', roundedBox(60, 40, 10, 1.5) - bore(20, 10)],
  ['rounded box, bore up to the flat of the top (x 12 + 4 = 16 < 17)', BOX + 'hole(v, { across: 8, at: [12, 0] })', roundedBox(40, 40, 20, 3) - bore(8, 20)],
  ['chamfered cylinder, blind bore 8 deep 8', CYL + 'hole(v, { across: 8, deep: 8 })', chamferedCyl(20, 20, 3) - bore(8, 8)],
  ['chamfered cylinder, bore 6 at (4, 3)', CYL + 'hole(v, { across: 6, at: [4, 3] })', chamferedCyl(20, 20, 3) - bore(6, 20)],
  ['chamfered cylinder 30 x 25 (c 2), bore 6 at (-5, 2), blind 10', "let v = cylinder(30, 25)\nbevel(v.edge('top', 'side'), 2)\nhole(v, { across: 6, deep: 10, at: [-5, 2] })", chamferedCyl(15, 25, 2) - bore(6, 10)],
  ['chamfered cylinder 50 x 12 (c 4), two bores', "let v = cylinder(50, 12)\nbevel(v.edge('top', 'side'), 4)\nhole(v, { across: 8, at: [-10, 0] })\nhole(v, { across: 8, at: [10, 0] })", chamferedCyl(25, 12, 4) - 2 * bore(8, 12)],
  ['chamfered cylinder, bottom rim, bore 8', "let v = cylinder(40, 20)\nbevel(v.edge('bottom', 'side'), 3)\nhole(v, { across: 8 })", chamferedCyl(20, 20, 3) - bore(8, 20)],
  ['rounded box then a bore then a second blind bore', BOX + 'hole(v, { across: 8, at: [-10, -10] })\nhole(v, { across: 5, deep: 6, at: [10, 10] })', roundedBox(40, 40, 20, 3) - bore(8, 20) - bore(5, 6)],
  ['a pocket cut into the rounded box (10 x 10 x 6), then a bore 6 at (-10, -10)', BOX + 'let c = cuboid(10, 10, 6, { at: [10, 10, 7] })\nv = cut(v, c)\nhole(v, { across: 6, at: [-10, -10] })', roundedBox(40, 40, 20, 3) - 600 - bore(6, 20)],
  ['the same pocket alone: a cut after a round is now exact too', BOX + 'let c = cuboid(10, 10, 6, { at: [10, 10, 7] })\nv = cut(v, c)', roundedBox(40, 40, 20, 3) - 600],
  ['rounded box bored, then a pocket cut', BOX + 'hole(v, { across: 8 })\nlet c = cuboid(10, 10, 6, { at: [10, 10, 7] })\nv = cut(v, c)', roundedBox(40, 40, 20, 3) - bore(8, 20) - 600],
  ['chamfered cylinder joined to a boss 16 x 10, bored 6 through both', CYL + 'let b = cylinder(16, 10, { at: [0, 0, 15] })\nv = join(v, b)\nhole(v, { across: 6 })', chamferedCyl(20, 20, 3) + PI * 64 * 10 - bore(6, 30)],
  ['two boxes joined, bored 8 through both', 'let a = cuboid(20, 20, 10)\nlet b = cuboid(20, 20, 10, { at: [0, 0, 10] })\nlet v = union(a, b)\nhole(v, { across: 8 })', 8000 - bore(8, 20)],
  ['a boss on a plate, bored 8 through both', 'let a = cuboid(40, 40, 10)\nlet b = cylinder(20, 10, { at: [0, 0, 10] })\nlet v = union(a, b)\nhole(v, { across: 8 })', 16000 + PI * 100 * 10 - bore(8, 20)],
];

for (const [name, code, want] of cases) {
  test(`hole in a rounded or chamfered part: ${name}`, () => {
    const { r, id, json, out, mine } = built(code);
    assert.deepEqual(out.refusals, {}, JSON.stringify(out.refusals));
    assert.ok(Math.abs(mine.volume - want) <= 1e-6 * want, `closed form ${want} vs ${mine.volume}`);
    const ref = occt(r.doc.features, id);
    assert.ok(Math.abs(mine.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${mine.volume} vs OCCT ${ref.volume}`);
    for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(mine.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${mine.bbox[a][k]} vs ${ref.bbox[a][k]}`);
    for (const d of [0.05, 0.5]) assert.equal(openEdges(json, id, d), 0, `open mesh at ${d}`);
  });
}

// A mirrored part is two lumps meeting on a plane. A bore that crosses that plane is cut out of each lump in turn.
const mirrored = [
  ['box 28 x 31 x 46 mirrored front-back, bored 8 on the seam', "let v = box(28, 31, 46)\nv = mirror(v, 'front-back')\nhole(v, { across: 8 })", 2 * 28 * 31 * 46 - bore(8, 46)],
  ['same, bore 8 at (4, -3)', "let v = box(28, 31, 46)\nv = mirror(v, 'front-back')\nhole(v, { across: 8, at: [4, -3] })", 2 * 28 * 31 * 46 - bore(8, 46)],
  ['box 28.15 x 31.01 x 46.03 mirrored front-back, bore 11.56 at (4.34, -3.62)', "let v = box(28.15, 31.01, 46.03)\nv = mirror(v, 'front-back')\nhole(v, { across: 11.56, at: [4.34, -3.62] })", 2 * 28.15 * 31.01 * 46.03 - bore(11.56, 46.03)],
  ['cylinder 20 x 30 mirrored top-bottom, bored 6 along the axis', "let v = cylinder(20, 30)\nv = mirror(v, 'top-bottom')\nhole(v, { across: 6, deep: 70 })", 2 * PI * 100 * 30 - bore(6, 60)],
  ['bored box mirrored left-right, then a 3 bore clear of the first two', "let v = box(30, 20, 10)\nhole(v, { across: 6, at: [4, 2] })\nv = mirror(v, 'left-right')\nhole(v, { across: 3, at: [10, 7] })", 2 * (6000 - bore(6, 10)) - bore(3, 10)],
  ['single-edge round, mirrored top-bottom, bored 6', "let v = box(30, 20, 10)\nround(v.edge('top', 'front'), 3)\nv = mirror(v, 'top-bottom')\nhole(v, { across: 6, deep: 30 })", 2 * (6000 - (1 - PI / 4) * 9 * 30) - bore(6, 20)],
];
for (const [name, code, want] of mirrored) {
  test(`hole in a mirrored part: ${name}`, () => {
    const { r, id, json, out, mine } = built(code);
    assert.deepEqual(out.refusals, {}, JSON.stringify(out.refusals));
    assert.ok(Math.abs(mine.volume - want) <= 1e-6 * want, `closed form ${want} vs ${mine.volume}`);
    const ref = occt(r.doc.features, id);
    assert.ok(Math.abs(mine.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${mine.volume} vs OCCT ${ref.volume}`);
    for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(mine.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${mine.bbox[a][k]} vs ${ref.bbox[a][k]}`);
    for (const d of [0.05, 0.5]) assert.equal(openEdges(json, id, d), 0, `open mesh at ${d}`);
  });
}

// The STEP writer has no spherical face yet (a fully rounded box cannot be written, pre-existing), so the round trip is on
// chamfered cylinders, whose faces are planes, cylinders and a cone.
test('STEP export of a bored chamfered cylinder reads back in OCCT with the same volume (4 parts)', () => {
  let n = 0;
  for (const [, code, want] of cases.filter(([name]) => /chamfered cylinder|cylinder 40 x 20/.test(name)).slice(0, 4)) {
    const { json, id } = built(code);
    const f = JSON.parse(brep.export_step(json, id));
    assert.ok(f.step, JSON.stringify(f).slice(0, 200));
    const back = readStep(f.step);
    assert.ok(Math.abs(back.volume - want) <= 1e-6 * want, `STEP ${back.volume} vs ${want}`);
    assert.equal(back.valid, true);
    n++;
  }
  assert.equal(n, 4);
});

test('at least 20 of the scripts build with no refusal', () => {
  let n = 0;
  for (const [, code] of cases) if (!Object.keys(built(code).out.refusals ?? {}).length) n++;
  assert.ok(n >= 20, `${n} built`);
});

// S4h made a bore coaxial with the chamfer cone exact: the cone meets it in a circle. Pi (1292 + 224/3).
test('a bore out to the chamfer cone of a cylinder, on its axis, builds exactly (S4h)', () => {
  const { r, out } = built(CYL + 'hole(v, { across: 36 })');
  assert.deepEqual(out.refusals ?? {}, {});
  const json = JSON.stringify(r.doc);
  const m = JSON.parse(brep.measure_doc(json)).shapes[r.doc.features.at(-1).id];
  assert.ok(Math.abs(m.volume - Math.PI * (1292 + 224 / 3)) < 1e-6, String(m.volume));
});

test('a bore that reaches a round or a chamfer still refuses, in a sentence, and the part is shown undrilled', () => {
  for (const [code, undrilled] of [
    [BOX + 'hole(v, { across: 8, at: [15, 0] })', roundedBox(40, 40, 20, 3)], // 11..19 crosses the round that starts at 17
    [BOX + 'hole(v, { across: 36 })', roundedBox(40, 40, 20, 3)], // wider than the flat top
  ]) {
    const { r, out } = built(code);
    const why = Object.values(out.refusals ?? {}).map(String);
    assert.equal(why.length, 1, `${code}: ${JSON.stringify(out.refusals)}`);
    assert.match(why[0], /^hole hole1: .+ -- hole1 is shown without it\.$/, code);
    const json = JSON.stringify({ ...r.doc, measure: r.doc.features.at(-2).id });
    brep.build_doc_json(json);
    const m = JSON.parse(brep.measure_doc(json)).shapes[r.doc.features.at(-2).id];
    assert.ok(Math.abs(m.volume - undrilled) < 1e-6 * undrilled, `${m.volume} vs ${undrilled}`);
  }
});
