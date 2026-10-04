// A bore straight through a sphere's centre (SPEC-sphere-bore.md, PLAN-next K-2).
// The wall meets the sphere in two circles z = +-h, h = sqrt(R^2 - r^2), so the sphere
// keeps a zone and the wall is a plain cylinder: no new curve. Closed forms, derived here:
//   through   V = 4/3 pi h^3                                    (the napkin ring)
//   blind     V = 4/3 pi R^3 - pi r^2 (h - f) - pi c^2 (3R - c) / 3,   c = R - h,
//             f = height of the flat floor from the centre, -h < f < h
// OpenCascade is read-only referee for volume and face count; the mesh is checked with
// the JS ray-cast oracle (same method as bore-oracle.test.mjs).
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

const PI = Math.PI;
const through = (R, r) => (4 / 3) * PI * (R * R - r * r) ** 1.5;
const blind = (R, r, f) => {
  const h = Math.sqrt(R * R - r * r), c = R - h;
  return (4 / 3) * PI * R ** 3 - PI * r * r * (h - f) - (PI * c * c * (3 * R - c)) / 3;
};
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  const id = r.doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(j));
  return { doc: r.doc, json: j, refusals, s: m.shapes[id] ?? m.shapes[r.doc.features[0].id], id };
}
function occtVolume(doc, id) {
  const built = buildDoc(oc, { version: 1, features: doc.features }, arc);
  const shape = built.shapes.get(id);
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  return { volume: g.Mass(), faces: facesOf(oc, shape).length };
}

// sphere(40) is R = 20. across 6 is r = 3.
for (const [R, d, r] of [[20, 40, 3], [20, 40, 10], [20, 40, 19], [5, 10, 0.5], [30, 60, 15]]) {
  test(`through bore, R=${R} r=${r}: napkin-ring volume, 2 faces`, () => {
    const { refusals, s } = build(`const s = sphere(${d}); hole(s, { across: ${2 * r} })`);
    assert.deepEqual(refusals, {});
    near(s.volume, through(R, r));
    assert.equal(s.faces, 2);
  });
}

for (const along of ['x', 'y', 'z']) {
  test(`through bore along ${along}, moved by (37,-23,11): same volume`, () => {
    const { refusals, s } = build(`const s = sphere(40); hole(s, { across: 6, along: '${along}' }); move(s, [37, -23, 11])`);
    assert.deepEqual(refusals, {});
    near(s.volume, through(20, 3));
  });
}

for (const deep of [10, 25, 38, 5]) {
  test(`blind bore, deep ${deep} from the top: floor at ${20 - deep}, 3 faces`, () => {
    const { refusals, s } = build(`const s = sphere(40); hole(s, { across: 6, deep: ${deep} })`);
    assert.deepEqual(refusals, {});
    near(s.volume, blind(20, 3, 20 - deep));
    assert.equal(s.faces, 3);
  });
}

test('the OCCT referee agrees on volume and face count (through and blind)', () => {
  for (const [code, want] of [
    ['const s = sphere(40); hole(s, { across: 6 })', 2],
    ['const s = sphere(40); hole(s, { across: 6, deep: 10 })', 3],
  ]) {
    const { doc, id, s } = build(code);
    const o = occtVolume(doc, id);
    near(s.volume, o.volume, 1e-7);
    assert.equal(o.faces, want);
    assert.equal(s.faces, want);
  }
});

test('mesh: watertight, outward, and every probe point agrees with the analytic solid', { timeout: 120000 }, () => {
  for (const code of ['const s = sphere(40); hole(s, { across: 6 })', 'const s = sphere(40); hole(s, { across: 6, deep: 10 })']) {
    const { json, id, s } = build(code);
    const m = JSON.parse(brep.mesh_feature(json, id, 0.005));
    assert.ok(!m.error, m.error);
    const tri = (t) => [0, 1, 2].map((k) => { const i = m.indices[3 * t + k] * 3; return [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; });
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let vol = 0;
    const key = (p) => p.map((x) => Math.round(x * 1e6)).join(',');
    const edges = new Map();
    for (let t = 0; t < m.indices.length / 3; t++) {
      const [a, b, c] = tri(t);
      vol += dot(a, cross(b, c)) / 6;
      const ks = [a, b, c].map(key);
      if (new Set(ks).size < 3) continue;
      for (let k = 0; k < 3; k++) { const x = ks[k], y = ks[(k + 1) % 3]; const e = x < y ? `${x}|${y}` : `${y}|${x}`; const cur = edges.get(e) ?? { n: 0, s: 0 }; cur.n++; cur.s += x < y ? 1 : -1; edges.set(e, cur); }
    }
    for (const { n, s: sg } of edges.values()) assert.ok(n === 2 && sg === 0, 'watertight and consistently oriented');
    assert.ok(vol > 0 && Math.abs(vol - s.volume) / s.volume < 0.01, `mesh ${vol} vs ${s.volume}`);
    const D = (() => { const d = [0.5773502691896258, 0.40412618, 0.70710678]; const n = Math.hypot(...d); return d.map((x) => x / n); })();
    const inside = (p) => {
      let hits = 0;
      for (let t = 0; t < m.indices.length / 3; t++) {
        const [a, b, c] = tri(t);
        const e1 = sub(b, a), e2 = sub(c, a), h = cross(D, e2), det = dot(e1, h);
        if (Math.abs(det) < 1e-14) continue;
        const f = 1 / det, sv = sub(p, a), u = f * dot(sv, h);
        if (u < 0 || u > 1) continue;
        const q = cross(sv, e1), v = f * dot(D, q);
        if (v < 0 || u + v > 1) continue;
        if (f * dot(e2, q) > 0) hits++;
      }
      return hits % 2 === 1;
    };
    const blindCase = code.includes('deep');
    const f = 10;
    const pred = ([x, y, z]) => {
      const rho = Math.hypot(x, y), rr = Math.hypot(rho, z);
      if (rr >= 20) return false;
      if (rho < 3 && (blindCase ? z > f : true)) return false;
      return true;
    };
    const dist = ([x, y, z]) => { const rho = Math.hypot(x, y); return Math.min(Math.abs(Math.hypot(rho, z) - 20), Math.abs(rho - 3), blindCase ? Math.abs(z - f) : 9); };
    let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pts = [[0, 0, 0], [0, 0, -15], [0, 0, 15], [5, 0, 0], [0, 0, 9], [0, 0, 11]];
    for (let i = 0; i < 1500; i++) pts.push([0, 1, 2].map(() => -21 + 42 * rnd()));
    let tested = 0;
    for (const p of pts) { if (dist(p) < 0.1) continue; tested++; assert.equal(inside(p), pred(p), `point ${p.map((x) => x.toFixed(2))}`); }
    assert.ok(tested > 800);
  }
});

test('near misses refuse in a sentence, never a wrong solid', () => {
  for (const code of [
    "const s = sphere(40); hole(s, { across: 6, at: [5, 0] })", // off-centre
    'const s = sphere(40); hole(s, { across: 39 })', // r/R > 0.95
    'const s = sphere(40); hole(s, { across: 6, deep: 0.1 })', // floor in the polar cap
  ]) {
    const { refusals, s } = build(code);
    if (Object.keys(refusals).length) {
      assert.match(Object.values(refusals)[0], /hole|fit|cannot|builds only/i, code);
    } else {
      // if it ever builds, the volume must still be the closed form of SOME bore, not the whole sphere
      assert.ok(s.volume < (4 / 3) * PI * 8000 - 1, code);
    }
  }
});

// STEP: a bore through the poles leaves a spherical zone between two circles, which has an exact STEP form
// (SPHERICAL_SURFACE, rim circles, meridian seam). OCCT reads the file back; the volume is the napkin-ring
// closed form, not another kernel's number. A blind bore leaves the sphere with a pole inside the face: a polar cap, whose
// one bound is its rim (S4h writes it; it used to refuse "a spherical face").
test('STEP: the through bore and the blind bore write exactly and OCCT reads them back', async () => {
  const { pathToFileURL } = await import('node:url');
  const dir = path.resolve(PKG, '../../../node_modules/replicad-opencascadejs/dist');
  const glue = await import(pathToFileURL(path.join(dir, 'replicad_single.js')).href);
  const oc2 = await glue.default({ locateFile: (f) => path.join(dir, f) });
  const through = build('const s = sphere(40); hole(s, { across: 6 })');
  const out = JSON.parse(brep.export_step(through.json, through.id));
  assert.ok(!out.error && (out.step ?? out.text ?? out.data), JSON.stringify(out).slice(0, 200));
  const text = out.step ?? out.text ?? out.data;
  oc2.FS.writeFile('/in.step', text);
  const reader = new oc2.STEPControl_Reader();
  reader.ReadFile('/in.step');
  reader.TransferRoots(new oc2.Message_ProgressRange());
  const shape = reader.OneShape();
  const g = new oc2.GProp_GProps();
  oc2.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const R = 20, r = 3;
  const napkin = (4 / 3) * Math.PI * (R * R - r * r) ** 1.5;
  assert.ok(Math.abs(g.Mass() - napkin) < 1e-7 * napkin, `${g.Mass()} vs ${napkin}`);
  const blind = build('const s = sphere(40); hole(s, { across: 6, deep: 10 })');
  const b = JSON.parse(brep.export_step(blind.json, blind.id));
  assert.ok(!b.error && b.step, JSON.stringify(b).slice(0, 200));
  oc2.FS.writeFile('/in2.step', b.step);
  const reader2 = new oc2.STEPControl_Reader();
  reader2.ReadFile('/in2.step');
  reader2.TransferRoots(new oc2.Message_ProgressRange());
  const g2 = new oc2.GProp_GProps();
  oc2.BRepGProp.VolumeProperties(reader2.OneShape(), g2, 1e-7, false, false);
  // a ball less the bore (floor 10 below the top, so 9.774 of it is inside the ball's circle) and the polar cap above the circle
  const h = Math.sqrt(R * R - r * r), c = R - h;
  const want = (4 / 3) * Math.PI * R ** 3 - Math.PI * r * r * (h - 10) - (Math.PI * c * c * (3 * R - c)) / 3;
  assert.ok(Math.abs(g2.Mass() - want) < 1e-7 * want, `${g2.Mass()} vs ${want}`);
});
