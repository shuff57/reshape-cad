// A bore straight across a cylinder's side, through its axis (SPEC-transverse-bore.md).
//
// The cylinder and the bore meet in a closed space curve,
// x = +-sqrt(R^2 - r^2 cos^2 t), that is neither a plane curve nor a conic, so the
// removed volume is an elliptic integral with no elementary form. The oracle here is
// therefore a NUMERIC integral that shares nothing with the kernel:
//
//   removed = 4 * integral over y in [-r, r] of sqrt(r^2 - y^2) * sqrt(R^2 - y^2) dy   (through)
//   removed = 2 * integral over y of sqrt(r^2 - y^2) * (sqrt(R^2 - y^2) - floor) dy    (blind)
//
// (R = 10, r = 2: 250.06441209661864.) Simpson's rule on y = r sin(theta), 400000
// intervals. OpenCascade is used read-only as an independent referee for volume,
// bounding box and face count, exactly as scripts/brep-parity-gate.mjs measures them.
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
const { facesOf } = await import('../dist/topo-resolve.js');
const arc = await import('../../sketch/dist/sketch-arc.js');

/** Removed volume by Simpson's rule on y = r sin(theta). */
function removed(R, r, floor = null) {
  const n = 400000;
  const a = -Math.PI / 2;
  const h = Math.PI / n;
  const g = (th) => {
    const y = r * Math.sin(th);
    const f = Math.sqrt(R * R - y * y);
    return 2 * r * r * Math.cos(th) ** 2 * (floor === null ? 2 * f : f - floor);
  };
  let acc = g(a) + g(-a);
  for (let i = 1; i < n; i++) acc += g(a + h * i) * (i % 2 ? 4 : 2);
  return (acc * h) / 3;
}

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const m = JSON.parse(brep.measure_doc(j));
  const id = r.doc.features.at(-1).id;
  return { doc: r.doc, json: j, refusals: m.refusals, s: m.shapes[id] ?? m.shapes[r.doc.features[0].id], id }; // a refused hole leaves the target shown
}
const near = (a, b, tol, what = '') =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what} ${a} vs ${b}`);

function occt(doc, id) {
  const built = buildDoc(oc, { version: 1, features: doc.features }, arc);
  const shape = built.shapes.get(id);
  assert.ok(shape, 'OCCT built it');
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]], faces: facesOf(oc, shape).length };
}

test('through bore: the spec numbers, exactly (R=10, r=2, h=30)', () => {
  near(removed(10, 2), 250.06441209661864, 1e-12);
  const { refusals, s } = build("const c = cylinder(20, 30); hole(c, { across: 4, along: 'x' })");
  assert.deepEqual(refusals, {});
  near(s.volume, 9174.71354867276, 1e-9);
  assert.equal(s.faces, 4); // pierced wall, bore wall, two caps
  assert.deepEqual(s.bbox, [[-10, -10, -15], [10, 10, 15]]);
});

test('through bore: volume equals the numeric integral for r/R in {0.05, 0.2, 0.5, 0.9}, at the origin and shifted', () => {
  for (const ratio of [0.05, 0.2, 0.5, 0.9]) {
    const r = 10 * ratio;
    const want = Math.PI * 100 * 30 - removed(10, r);
    for (const move of ['', '; move(result, [37, -23, 11])']) {
      // move() acts on the bored part; the volume must not change.
      const code = `const c = cylinder(20, 30); const h = hole(c, { across: ${2 * r}, along: 'x' })${move.replace('result', 'h')}`;
      const out = build(code);
      assert.deepEqual(out.refusals, {}, code);
      near(out.s.volume, want, 1e-9, `ratio ${ratio} ${move ? 'shifted' : 'origin'}`);
    }
  }
});

test('blind bore that starts at the side and stays inside: volume equals the numeric integral, both sides, several floors', () => {
  const R = 10;
  for (const ratio of [0.05, 0.2, 0.5, 0.9]) {
    const r = R * ratio;
    const s0 = Math.sqrt(R * R - r * r);
    for (const frac of [-0.9, 0, 0.9]) {
      const floor = frac * s0;
      // deep is measured from the side the bore enters at +x; the floor sits at R - deep.
      const out = build(`const c = cylinder(20, 30); hole(c, { across: ${2 * r}, along: 'x', deep: ${R - floor} })`);
      assert.deepEqual(out.refusals, {}, `ratio ${ratio} floor ${floor}`);
      near(out.s.volume, Math.PI * 100 * 30 - removed(R, r, floor), 1e-9, `ratio ${ratio} floor ${floor}`);
      assert.equal(out.s.faces, 5); // pierced wall, bore wall, floor, two caps
    }
  }
});

test('the bore can run along y as well, and sit at another height', () => {
  const a = build("const c = cylinder(20, 30); hole(c, { across: 4, along: 'y' })");
  const b = build("const c = cylinder(20, 30); hole(c, { across: 4, along: 'x', at: [0, 5] })");
  const c = build("const c = cylinder(20, 30); hole(c, { across: 4, along: 'y', at: [0, -6] })");
  for (const o of [a, b, c]) {
    assert.deepEqual(o.refusals, {});
    near(o.s.volume, 9174.71354867276, 1e-9);
  }
});

test('OpenCascade agrees on volume, bounding box and face count (through and blind)', () => {
  for (const code of [
    "const c = cylinder(20, 30); hole(c, { across: 4, along: 'x' })",
    "const c = cylinder(20, 30); hole(c, { across: 12, along: 'x' })",
    "const c = cylinder(20, 30); hole(c, { across: 4, along: 'x', deep: 12 })",
  ]) {
    const mine = build(code);
    const ref = occt(mine.doc, mine.id);
    near(mine.s.volume, ref.volume, 1e-6, code);
    for (let i = 0; i < 3; i++) {
      near(mine.s.bbox[0][i], ref.bbox[0][i], 1e-6, `${code} lo${i}`);
      near(mine.s.bbox[1][i], ref.bbox[1][i], 1e-6, `${code} hi${i}`);
    }
    console.log(`# ${code}: brep-rs ${mine.s.faces} faces, OCCT ${ref.faces}; volume ${mine.s.volume} vs ${ref.volume}`);
    assert.ok(mine.s.faces <= 2 * ref.faces + 4, `${code}: ${mine.s.faces} faces vs OCCT ${ref.faces}`);
  }
});

/** Watertight (every directed edge paired) and every vertex on its own surface. */
test('the mesh at deflection 0.05 is watertight, and each wall\'s vertices lie on its surface and nowhere past the other', () => {
  for (const code of [
    "const c = cylinder(20, 30); hole(c, { across: 8, along: 'x' })",
    "const c = cylinder(20, 30); hole(c, { across: 8, along: 'x', deep: 12 })",
    "const c = cylinder(20, 30); hole(c, { across: 18, along: 'x' })",
  ]) {
    const out = build(code);
    const m = JSON.parse(brep.mesh_feature(out.json, out.id, 0.05));
    assert.equal(m.error, undefined, code);
    const P = m.positions, I = m.indices;
    const key = (i) => [0, 1, 2].map((k) => Math.round(P[3 * i + k] / 1e-6)).join(',');
    const dir = new Map();
    for (let t = 0; t < I.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = key(I[t + e]), b = key(I[t + (e + 1) % 3]);
        if (a === b) continue;
        dir.set(`${a}>${b}`, (dir.get(`${a}>${b}`) ?? 0) + 1);
      }
    }
    for (const [k, c] of dir) {
      const [a, b] = k.split('>');
      assert.equal(dir.get(`${b}>${a}`) ?? 0, c, `${code}: open edge ${k}`);
    }
    // Faces 2 and 3 are the pierced wall and the bore wall (face order: top, bottom, wall, bore[, floor]).
    const R = 10, r = Number(/across: (\d+)/.exec(code)[1]) / 2;
    const rhoPart = (i) => Math.hypot(P[3 * i], P[3 * i + 1]);
    const rhoTool = (i) => Math.hypot(P[3 * i + 1], P[3 * i + 2]);
    const verts = (f) => {
      const { start, count } = m.faces[f];
      return new Set(I.slice(start, start + count));
    };
    for (const i of verts(2)) {
      assert.ok(Math.abs(rhoPart(i) - R) < 1e-9, 'wall vertex off the part cylinder');
      assert.ok(rhoTool(i) >= r - 1e-9, 'wall vertex inside the bore');
    }
    for (const i of verts(3)) {
      assert.ok(Math.abs(rhoTool(i) - r) < 1e-9, 'bore vertex off the bore cylinder');
      assert.ok(rhoPart(i) <= R + 1e-9, 'bore vertex outside the part');
    }
  }
});

test('near misses refuse in a sentence that says what builds', () => {
  const cases = {
    'a bore as wide as the part (tangent)': "const c = cylinder(20, 30); hole(c, { across: 20, along: 'x' })",
    'a bore nearly as wide as the part': "const c = cylinder(20, 30); hole(c, { across: 19.5, along: 'x' })",
    'an off-centre bore (axes do not meet)': "const c = cylinder(20, 30); hole(c, { across: 4, along: 'x', at: [5, 0] })",
    'a bore through the cap': "const c = cylinder(20, 30); hole(c, { across: 4, along: 'x', at: [0, 14] })",
    'a blind bore whose floor lies in the wall': "const c = cylinder(20, 30); hole(c, { across: 4, along: 'x', deep: 0.1 })",
  };
  for (const [what, code] of Object.entries(cases)) {
    const out = build(code);
    assert.match(out.refusals.hole1 ?? '', /^hole hole1: a bore across the side of a round part builds only when it runs at right angles straight through the part's axis, is at most 95% as wide as the part, stays clear of both ends, and either goes right through or stops strictly inside; .* -- hole1 is shown without it\.$/, what);
    near(out.s.volume, Math.PI * 100 * 30, 1e-12, what); // the part is shown, untouched
  }
});

test('a second cut on a bored part refuses plainly instead of reading its trimmed walls as whole cylinders', () => {
  const out = build("const c = cylinder(20, 30); const h = hole(c, { across: 4, along: 'x' }); hole(h, { across: 2, along: 'y' })");
  assert.match(out.refusals.hole2 ?? '', /already has a bore across its side/);
});

test('STEP export refuses in a sentence (no exact form for the space curve is written yet)', () => {
  const out = build("const c = cylinder(20, 30); hole(c, { across: 4, along: 'x' })");
  const r = JSON.parse(brep.export_step(out.json, out.id));
  assert.match(r.error, /cannot write a bore across a cylinder's side to STEP yet/);
});
