// S4e: join (union) and keep (intersect) of two solid cylinders whose axes are perpendicular and
// meet, the second narrower than the first: a pipe tee, a radial boss on a shaft. Every number is
// an oracle that does not run through the kernel's own surface integrals: the volume the two
// cylinders share is V = integral over y of 2 sqrt(r^2 - y^2) x |[-sqrt(R^2 - y^2), sqrt(R^2 - y^2)] met by [xl, xh]|
// (Steinmetz when the small one runs right through), union = V(A) + V(B) - V; and OpenCascade, the
// independent referee, agrees on volume and bounding box.
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

// ---- the oracle ------------------------------------------------------------------------------
// V(A and B) for the big cylinder (radius R, axis z) and the small one (radius r, axis x, from xl to xh), Simpson on y = r sin t.
function shared(R, r, xl, xh, n = 100000) {
  const h = PI / n;
  const f = (t) => {
    const y = r * Math.sin(t);
    const x = Math.sqrt(R * R - y * y);
    const z = Math.sqrt(Math.max(r * r - y * y, 0));
    return 2 * z * Math.max(Math.min(x, xh) - Math.max(-x, xl), 0) * r * Math.cos(t);
  };
  let sum = f(-PI / 2) + f(PI / 2);
  for (let i = 1; i < n; i++) sum += f(-PI / 2 + i * h) * (i % 2 ? 4 : 2);
  return sum * h / 3;
}
const expected = (R, H, r, xl, xh, n) => {
  const v = shared(R, r, xl, xh, n);
  return { keep: v, join: PI * R * R * H + PI * r * r * (xh - xl) - v };
};

// ---- scripts ---------------------------------------------------------------------------------
const TURN = { x: '[0, 90, 0]', y: '[90, 0, 0]', z: null };
const E = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
// Big cylinder (width across 2R, height H, axis `ia`) and small (width 2r, length xh - xl, axis `id`) whose axis crosses the
// big one's at height c_v and whose middle is at `mid` along its own axis.
function script(op, { R, H, r, xl, xh, cv = 0, ia = 'z', id = 'x', swap = false }) {
  const mid = 0.5 * (xl + xh);
  const pos = E[ia].map((v, i) => v * cv + E[id][i] * mid);
  const a = `const a = cylinder(${2 * R}, ${H}, { at: [0, 0, 0] })\n${TURN[ia] ? `turn(a, ${TURN[ia]})\n` : ''}`;
  const b = `const b = cylinder(${2 * r}, ${xh - xl}, { at: [${pos.join(', ')}] })\n${TURN[id] ? `turn(b, ${TURN[id]})\n` : ''}`;
  return (swap ? b + a : a + b) + `${op}(${swap ? 'b, a' : 'a, b'})`;
}

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const id = r.doc.features.at(-1).id;
  const doc = JSON.stringify({ ...r.doc, measure: id });
  const out = JSON.parse(brep.build_doc_json(doc));
  const m = JSON.parse(brep.measure_doc(doc)).shapes[id];
  return { refusals: out.refusals ?? {}, m, r, id, doc };
}

// ---- hand cases ------------------------------------------------------------------------------
// [name, R, H, r, xl, xh]
const CASES = [
  ['the brief: cylinder(40, 30) with cylinder(14, 40) turned, same centre (the small ends are flush with the big wall)', 20, 30, 7, -20, 20],
  ['the brief: cylinder(20, 40) with cylinder(10, 40) turned, same centre', 10, 40, 5, -20, 20],
  ['small one pokes out further on one side', 10, 40, 5, -15, 18],
  ['a radial boss on a shaft: starts on the shaft axis', 10, 40, 5, 0, 25],
  ['a radial boss on a shaft: starts inside the shaft', 10, 40, 5, -4, 25],
  ['a wide boss (r = 0.9 R) with a short blind end', 10, 40, 9, -30, 4],
  ['a narrow boss starting off the axis', 10, 40, 2, 3, 25],
  ['both ends inside the shaft on one side, one outside', 10, 40, 5, -3, 13],
];

for (const [name, R, H, r, xl, xh] of CASES) {
  const want = expected(R, H, r, xl, xh, 400000);
  for (const [op, key] of [['join', 'join'], ['keep', 'keep']]) {
    test(`${op}: ${name}`, () => {
      const { refusals, m, doc, id } = build(script(op, { R, H, r, xl, xh, cv: 1.5 }));
      assert.deepEqual(refusals, {}, JSON.stringify(refusals));
      assert.ok(m, 'built');
      assert.ok(Math.abs(m.volume - want[key]) < 1e-6 * want[key], `${m.volume} vs ${want[key]}`);
      for (const defl of [0.05, 0.5]) {
        const { open, triangles } = openEdges(doc, id, defl);
        assert.equal(open, 0, `open mesh edges at ${defl}`);
        assert.ok(triangles > 20);
      }
    });
  }
}

test('the numbers the docs print (reshape-docs.ts, Join and Keep): 14187.92 mm^3 in 7 faces joined, 1520.04 mm^3 in 3 faces kept', () => {
  const p = { R: 10, H: 40, r: 5, xl: -20, xh: 20 };
  const j = build(script('join', p)).m, k = build(script('keep', p)).m;
  assert.equal(j.volume.toFixed(2), '14187.92');
  assert.equal(j.faces, 7);
  assert.equal(k.volume.toFixed(2), '1520.04');
  assert.equal(k.faces, 3);
});

test('the two ends of the same pair, in either order and on every axis, give the same solid', () => {
  const R = 10, H = 40, r = 4, xl = -15, xh = 15;
  const want = expected(R, H, r, xl, xh, 200000);
  for (const [ia, id] of [['z', 'x'], ['z', 'y'], ['x', 'z'], ['x', 'y'], ['y', 'x'], ['y', 'z']]) {
    for (const swap of [false, true]) {
      for (const op of ['join', 'keep']) {
        const { refusals, m } = build(script(op, { R, H, r, xl, xh, cv: -2, ia, id, swap }));
        assert.deepEqual(refusals, {}, `${op} ${ia}/${id} swap=${swap}`);
        const w = op === 'join' ? want.join : want.keep;
        assert.ok(Math.abs(m.volume - w) < 1e-6 * w, `${op} ${ia}/${id} swap=${swap}: ${m.volume} vs ${w}`);
      }
    }
  }
});

test('what is not a clean tee refuses in a sentence and builds nothing: equal radii, skew, oblique, through the cap, an end between the meeting curve and the wall', () => {
  const cyl = (o, turnB = '[0, 90, 0]') => `const a = cylinder(20, 40, { at: [0, 0, 0] })\nconst b = cylinder(${o.across ?? 10}, ${o.len ?? 40}, { at: [${o.at ?? '0, 0, 0'}] })\nturn(b, ${turnB})\n`;
  for (const [code, why] of [
    [cyl({ across: 20 }) + 'join(a, b)', 'equal radii, join'],
    [cyl({ across: 20 }) + 'keep(a, b)', 'equal radii, keep'],
    [cyl({}, '[0, 60, 0]') + 'join(a, b)', 'oblique axis'],
    [cyl({ at: '0, 3, 0' }) + 'join(a, b)', 'skew axes'],
    [cyl({ at: '0, 0, 20' }) + 'join(a, b)', "breaks through the big one's cap"],
    [cyl({ across: 8, len: 29.5, at: '-5.25, 0, 0' }) + 'join(a, b)', 'an end between the meeting curve and the wall (x from -20 to 9.5, s0 = 9.17)'],
  ]) {
    const { refusals, m } = build(code);
    assert.equal(m, undefined, `${why}: built a solid`);
    assert.match(refusals.op1 ?? '', /cannot boolean these two solids/, why);
  }
});

// ---- OpenCascade agrees ----------------------------------------------------------------------
const REFEREE = [
  ...CASES.map(([name, R, H, r, xl, xh]) => [name, { R, H, r, xl, xh, cv: 1.5 }]),
  ['x axis big, z axis small, off-centre', { R: 12, H: 36, r: 5, xl: -22, xh: 20, cv: 4, ia: 'x', id: 'z' }],
  ['y axis big, x axis small, blind', { R: 9, H: 30, r: 6, xl: -2, xh: 16, cv: -3, ia: 'y', id: 'x' }],
  ['z axis big, y axis small, through', { R: 14, H: 50, r: 3, xl: -25, xh: 25, cv: 7, ia: 'z', id: 'y' }],
  ['the small one first, the big one second', { R: 10, H: 40, r: 4, xl: -12, xh: 14, cv: 2, swap: true }],
];
for (const [name, p] of REFEREE) {
  for (const op of ['join', 'keep']) {
    test(`OCCT agrees: ${op} ${name}`, () => {
      const { refusals, m, r, id } = build(script(op, p));
      assert.deepEqual(refusals, {});
      const ref = occt(r.doc.features, id);
      assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${m.volume} vs OCCT ${ref.volume}`);
      for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
        assert.ok(Math.abs(m.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox[${a}][${k}] ${m.bbox[a][k]} vs ${ref.bbox[a][k]}`);
    });
  }
}

// ---- STEP round trip, read back by OpenCascade ---------------------------------------------------
for (const [name, op, p] of [
  ['join, through', 'join', { R: 10, H: 40, r: 5, xl: -20, xh: 20, cv: 1.5 }],
  ['join, boss on a shaft', 'join', { R: 10, H: 40, r: 5, xl: -4, xh: 25, cv: 1.5 }],
  ['join, the brief (flush ends)', 'join', { R: 20, H: 30, r: 7, xl: -20, xh: 20, cv: 0 }],
  ['keep, through', 'keep', { R: 10, H: 40, r: 5, xl: -20, xh: 20, cv: 1.5 }],
  ['keep, blind end', 'keep', { R: 10, H: 40, r: 5, xl: -4, xh: 25, cv: 1.5 }],
]) {
  test(`STEP round trip, read back by OpenCascade: ${name}`, () => {
    const { r, id, m } = build(script(op, p));
    const f = JSON.parse(brep.export_step(JSON.stringify(r.doc), id));
    assert.ok(f.step, JSON.stringify(f).slice(0, 300));
    const back = readStep(f.step);
    assert.ok(Math.abs(back.volume - m.volume) < 1e-6 * m.volume, `${back.volume} vs ${m.volume}`);
    assert.equal(back.solids, 1);
    assert.equal(back.valid, true);
  });
}

// ---- seeded random sweep --------------------------------------------------------------------------
function lcg(seed) {
  let s = BigInt(seed);
  return () => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number(s >> 33n) / 2 ** 31;
  };
}

test('300 seeded random crossing pairs, join and keep: 0 wrong against the oracle, a sample against OpenCascade and the mesh', () => {
  const rnd = lcg(20261004);
  const axes = [['z', 'x'], ['z', 'y'], ['x', 'y'], ['x', 'z'], ['y', 'x'], ['y', 'z']];
  let pairs = 0, built = 0, refused = 0, wrong = 0, occtChecked = 0, meshed = 0;
  const round = (v) => Math.round(v * 100) / 100;
  while (pairs < 300) {
    const R = round(3 + 9 * rnd());
    const r = round((0.1 + 0.8 * rnd()) * R);
    const s0 = Math.sqrt(R * R - r * r);
    const end = (sgn) => (rnd() < 0.6 ? sgn * round(R + 0.05 + 8 * rnd()) : round(s0 * 0.9 * (2 * rnd() - 1)));
    let xl = end(-1), xh = end(1);
    if (xl > xh) [xl, xh] = [xh, xl];
    if (xl > -R && xh < R) { if (rnd() < 0.5) xh = round(R + 0.05 + 8 * rnd()); else xl = -round(R + 0.05 + 8 * rnd()); }
    if (xh - xl < 0.5) continue;
    const H = round(2 * r + 1 + 20 * rnd());
    const cv = round((0.5 * H - r - 0.2) * (2 * rnd() - 1));
    const [ia, id] = axes[Math.floor(rnd() * 6) % 6];
    const swap = rnd() < 0.5;
    const p = { R, H, r, xl, xh, cv, ia, id, swap };
    pairs++;
    const want = expected(R, H, r, xl, xh, 20000);
    for (const op of ['join', 'keep']) {
      const { refusals, m, r: run, id: fid, doc } = build(script(op, p));
      if (m === undefined) {
        refused++;
        assert.match(refusals.op1 ?? '', /cannot/);
        continue;
      }
      built++;
      const w = op === 'join' ? want.join : want.keep;
      if (Math.abs(m.volume - w) > 2e-6 * w) {
        wrong++;
        assert.fail(`WRONG ${op} ${JSON.stringify(p)}: ${m.volume} vs ${w}`);
      }
      if (pairs % 6 === 0) {
        meshed++;
        assert.equal(openEdges(doc, fid, 0.05).open, 0, `open mesh ${op} ${JSON.stringify(p)}`);
        const ref = occt(run.doc.features, fid);
        occtChecked++;
        assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `OCCT volume ${op} ${JSON.stringify(p)}: ${m.volume} vs ${ref.volume}`);
        for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
          assert.ok(Math.abs(m.bbox[a][k] - ref.bbox[a][k]) <= 1e-5, `bbox ${op} ${JSON.stringify(p)}`);
      }
    }
  }
  console.log(`random tees: ${pairs} pairs, built ${built}, refused ${refused}, wrong ${wrong}, OCCT-checked ${occtChecked}, meshed ${meshed}`);
  assert.equal(wrong, 0);
  assert.equal(refused, 0, 'every pair in the supported zone builds');
});
