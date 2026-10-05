// A bore through a sphere that does NOT pass through its centre (SPEC-brep-sphere-offset-bore.md, slice S1).
// The wall meets the sphere in two closed space curves (Curve::SphCyl), so the sphere keeps one face with two holes
// and the wall is a cylinder trimmed between the curves. A BLIND bore (slice S2) has one hole, the wall running from a flat floor
// up to the curve, and the floor disc. Closed form, derived here and checked against OpenCascade
// before any builder existed (worst relative difference 1.2e-10 over 20 seeded cases):
//   through   V = 4/3 pi R^3 - 2 I,   I = integral over D = {(x - e)^2 + y^2 < r^2} of sqrt(R^2 - x^2 - y^2)
//   blind     V = 4/3 pi R^3 - (I - f0 pi r^2),  f0 = floor height from the centre, |f0| < sqrt(R^2 - (e + r)^2)
// The inner x-integral is closed form and the outer one is taken in theta with y = r sin(theta), which removes the
// square-root singularity at y = +-r (a plain Simpson rule in y gave 3.7e-7, above the bar).
// OpenCascade is the referee for volume and face count; the mesh is checked with the JS ray-cast oracle.
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
/** I by Gauss-Legendre-free composite Simpson in theta (y = r sin theta). */
function integralI(R, r, e) {
  const N = 4000;
  const g = (th) => {
    const y = r * Math.sin(th), w = r * Math.cos(th), c2 = R * R - y * y, c = Math.sqrt(c2);
    const F = (x) => 0.5 * (x * Math.sqrt(Math.max(0, c2 - x * x)) + c2 * Math.asin(Math.max(-1, Math.min(1, x / c))));
    return (F(e + w) - F(e - w)) * r * Math.cos(th);
  };
  const h = PI / N;
  let acc = 0;
  for (let i = 0; i <= N; i++) acc += g(-PI / 2 + i * h) * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2);
  return (acc * h) / 3;
}
const through = (R, r, e) => (4 / 3) * PI * R ** 3 - 2 * integralI(R, r, e);
const blind = (R, r, e, f0) => (4 / 3) * PI * R ** 3 - (integralI(R, r, e) - f0 * PI * r * r);
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

// sphere(2R); the bore is `across: 2r` at [x, y] from the centre, so e = hypot(x, y).
const CASES = [
  [20, 3, 8, 0], [20, 3, 0, 8], [20, 3, 5.7, 5.7], [20, 6, 11, 0], [20, 2, 16.5, 0], // e + r = 0.925 R
  [10, 1.5, 4, 0], [30, 9.96, 14.76, 0], [8, 0.5, 6, 3], [12, 2, 9.2, 0],
  // S3: the bore swallows the sphere's own pole along its axis (e < r, e = r, and a hair above the axis)
  [20, 3, 2, 0], [20, 3, 3, 0], [20, 3, 0.5, 0], [20, 6, 5, 0], [20, 8, 3, 4], [20, 9, 8.9, 0], [20, 5, 0.01, 0],
];

for (const [R, r, x, y] of CASES) {
  const e = Math.hypot(x, y);
  test(`through bore R=${R} r=${r} e=${e.toFixed(2)}: the closed form, 2 faces`, () => {
    const { refusals, s } = build(`const s = sphere(${2 * R}); hole(s, { across: ${2 * r}, at: [${x}, ${y}] })`);
    assert.deepEqual(refusals, {});
    near(s.volume, through(R, r, e));
    assert.equal(s.faces, 2);
  });
}

test('the OpenCascade referee agrees on volume (1e-7) and face count', () => {
  for (const [R, r, x, y] of CASES) {
    const code = `const s = sphere(${2 * R}); hole(s, { across: ${2 * r}, at: [${x}, ${y}] })`;
    const { doc, id, s } = build(code);
    const o = occtVolume(doc, id);
    near(s.volume, o.volume, 1e-7);
    assert.equal(o.faces, 2, code);
    assert.equal(s.faces, 2, code);
  }
});

// [R, r, x, y, deep]: sphere(2R), the floor is at R - deep from the centre (`deep` is measured from the top).
const BLIND = [[20, 3, 8, 0, 10], [20, 3, 8, 0, 25], [20, 3, 8, 0, 20], [20, 6, 11, 0, 20], [20, 2, 16.5, 0, 14], [10, 1.5, 4, 0, 6], [20, 3, 5.7, 5.7, 30],
  // S3: blind, the pole swallowed (floor between -s0 and s0 = sqrt(R^2 - (e + r)^2))
  [20, 3, 2, 0, 20], [20, 3, 3, 0, 14], [20, 6, 5, 0, 25], [20, 8, 3, 4, 20]];

for (const [R, r, x, y, deep] of BLIND) {
  const e = Math.hypot(x, y);
  test(`blind bore R=${R} r=${r} e=${e.toFixed(2)} deep ${deep}: the closed form, 3 faces`, () => {
    const { refusals, s } = build(`const s = sphere(${2 * R}); hole(s, { across: ${2 * r}, at: [${x}, ${y}], deep: ${deep} })`);
    assert.deepEqual(refusals, {});
    near(s.volume, blind(R, r, e, R - deep));
    assert.equal(s.faces, 3);
  });
}

test('the OpenCascade referee agrees on the blind bores (volume 1e-7, 3 faces)', () => {
  for (const [R, r, x, y, deep] of BLIND) {
    const code = `const s = sphere(${2 * R}); hole(s, { across: ${2 * r}, at: [${x}, ${y}], deep: ${deep} })`;
    const { doc, id, s } = build(code);
    const o = occtVolume(doc, id);
    near(s.volume, o.volume, 1e-7);
    assert.equal(o.faces, 3, code);
    assert.equal(s.faces, 3, code);
  }
});

for (const along of ['x', 'y', 'z']) {
  test(`through bore along ${along}, moved by (37,-23,11) and turned: same volume`, () => {
    const at = along === 'z' ? '[8, 0]' : along === 'x' ? '[8, 0]' : '[0, 8]';
    const { refusals, s } = build(`const s = sphere(40); hole(s, { across: 6, along: '${along}', at: ${at} }); move(s, [37, -23, 11])`);
    assert.deepEqual(refusals, {});
    near(s.volume, through(20, 3, 8));
  });
}

test('mesh: watertight, outward, volume, and every probe point agrees with the analytic solid', { timeout: 120000 }, () => {
  for (const [R, r, x, y, deep] of [[20, 3, 8, 0], [20, 6, 11, 0], [20, 2, 16.5, 0], [20, 3, 5.7, 5.7], [20, 3, 8, 0, 25], [20, 6, 11, 0, 20], [20, 3, 8, 0, 10], [20, 3, 2, 0], [20, 3, 3, 0], [20, 8, 3, 4], [20, 3, 2, 0, 20], [20, 6, 5, 0, 25]]) {
    const e = Math.hypot(x, y);
    const f0 = deep === undefined ? -Infinity : R - deep;
    const { json, id, s } = build(`const s = sphere(${2 * R}); hole(s, { across: ${2 * r}, at: [${x}, ${y}]${deep === undefined ? '' : `, deep: ${deep}`} })`);
    for (const defl of [0.05, 0.5]) {
      const m = JSON.parse(brep.mesh_feature(json, id, defl));
      assert.ok(!m.error, m.error);
      const tri = (t) => [0, 1, 2].map((k) => { const i = m.indices[3 * t + k] * 3; return [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; });
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      let vol = 0;
      const key = (p) => p.map((v) => Math.round(v * 1e6)).join(',');
      const edges = new Map();
      for (let t = 0; t < m.indices.length / 3; t++) {
        const [a, b, c] = tri(t);
        vol += dot(a, cross(b, c)) / 6;
        const ks = [a, b, c].map(key);
        if (new Set(ks).size < 3) continue;
        for (let k = 0; k < 3; k++) { const p = ks[k], q = ks[(k + 1) % 3]; const ed = p < q ? `${p}|${q}` : `${q}|${p}`; const cur = edges.get(ed) ?? { n: 0, s: 0 }; cur.n++; cur.s += p < q ? 1 : -1; edges.set(ed, cur); }
      }
      for (const { n, s: sg } of edges.values()) assert.ok(n === 2 && sg === 0, `R=${R} r=${r} e=${e} defl ${defl}: watertight and consistently oriented`);
      // an inscribed polyhedron is light by itself at a coarse tolerance: 10% at 0.5, 1% at 0.05
      const tol = defl >= 0.5 ? 0.1 : 0.01;
      assert.ok(vol > 0 && Math.abs(vol - s.volume) / s.volume < tol, `mesh ${vol} vs ${s.volume} at ${defl}`);
      if (defl > 0.05) continue;
      const D = (() => { const d = [0.5773502691896258, 0.40412618, 0.70710678]; const n = Math.hypot(...d); return d.map((v) => v / n); })();
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
      const ang = Math.atan2(y, x);
      const pred = ([px, py, pz]) => {
        const rr = Math.hypot(px, py, pz);
        if (rr >= R) return false;
        // distance to the bore axis: the line through (e cos a, e sin a, *) along z
        const rho = Math.hypot(px - e * Math.cos(ang), py - e * Math.sin(ang));
        return !(rho < r && pz > f0);
      };
      const dist = ([px, py, pz]) => Math.min(Math.abs(Math.hypot(px, py, pz) - R), Math.abs(Math.hypot(px - e * Math.cos(ang), py - e * Math.sin(ang)) - r), deep === undefined ? 9 : Math.abs(pz - f0));
      let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const pts = [[0, 0, 0], [0, 0, 15], [e * Math.cos(ang), e * Math.sin(ang), 0], [e * Math.cos(ang), e * Math.sin(ang), 14], [e * Math.cos(ang), e * Math.sin(ang), Number.isFinite(f0) ? f0 + 1 : 3], [e * Math.cos(ang), e * Math.sin(ang), Number.isFinite(f0) ? f0 - 1 : -3]];
      for (let i = 0; i < 1200; i++) pts.push([0, 1, 2].map(() => -(R + 1) + 2 * (R + 1) * rnd()));
      let tested = 0;
      for (const p of pts) { if (dist(p) < 0.1) continue; tested++; assert.equal(inside(p), pred(p), `R=${R} r=${r} e=${e}: point ${p.map((v) => v.toFixed(2))}`); }
      assert.ok(tested > 600);
    }
  }
});

test('what this slice does not build still refuses in a sentence, never a wrong solid', () => {
  for (const [code, why] of [
    ['const s = sphere(40); hole(s, { across: 6, at: [8, 0], deep: 2 })', 'blind, the floor in the polar band the curve spans (it would meet the sphere\'s own face)'],
    ['const s = sphere(40); hole(s, { across: 6, at: [8, 0], deep: 38 })', 'blind, the floor below -s0 (it would leave the sphere)'],
    ['const s = sphere(40); hole(s, { across: 6, at: [17.5, 0] })', 'e + r > 0.95 R'],
    ['const s = sphere(40); hole(s, { across: 6, at: [8, 0] }); hole(s, { across: 4, at: [-8, 0] })', 'a second bore on a bored sphere'],
  ]) {
    const { refusals, s } = build(code);
    if (Object.keys(refusals).length) {
      assert.match(Object.values(refusals).join(' '), /hole|bore|cannot/i, why);
    } else {
      // if one ever builds, it must be the closed form of SOME bore, never the whole sphere
      assert.ok(s.volume < (4 / 3) * PI * 8000 - 1, why);
    }
  }
  // the polar-band floor specifically refuses today
  assert.ok(Object.keys(build('const s = sphere(40); hole(s, { across: 6, at: [8, 0], deep: 2 })').refusals).length > 0);
});

test('a bored sphere cannot be joined, cut again or kept: the combine refuses', () => {
  for (const op of ['join', 'cut', 'keep']) {
    const { refusals } = build(`const s = sphere(40); hole(s, { across: 6, at: [8, 0] }); const b = cuboid(10, 10, 10, { at: [18, 0, 0] }); ${op}(s, b)`);
    assert.ok(Object.keys(refusals).length > 0, `${op} on a bored sphere must refuse, not read its trimmed faces as a whole sphere`);
  }
});

// S4: the bored sphere's own wires write it (each hole a fitted B-spline, checked against the exact curve to 1e-7), read back by OpenCascade.
function stepReadBack(code) {
  const { json, id, s } = build(code);
  const out = JSON.parse(brep.export_step(json, id));
  assert.ok(!out.error && out.step, `${code}: ${JSON.stringify(out).slice(0, 200)}`);
  const f = `/s4-${Math.random().toString(36).slice(2)}.step`;
  oc.FS.writeFile(f, out.step);
  const reader = new oc.STEPControl_Reader();
  assert.equal(reader.ReadFile(f), oc.IFSelect_ReturnStatus.IFSelect_RetDone, code);
  reader.TransferRoots(new oc.Message_ProgressRange());
  const shape = reader.OneShape();
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  return { vol: g.Mass(), faces: facesOf(oc, shape).length, valid: new oc.BRepCheck_Analyzer(shape, true, false).IsValid(), s };
}

for (const [code, R, r, e, deep] of [
  ['const s = sphere(40); hole(s, { across: 6, at: [8, 0] })', 20, 3, 8],
  ['const s = sphere(40); hole(s, { across: 12, at: [11, 0] })', 20, 6, 11],
  ['const s = sphere(40); hole(s, { across: 6, at: [2, 0] })', 20, 3, 2],
  ['const s = sphere(40); hole(s, { across: 6, at: [3, 0] })', 20, 3, 3],
  ['const s = sphere(40); hole(s, { across: 16, at: [3, 4] })', 20, 8, 5],
  ['const s = sphere(40); hole(s, { across: 6, at: [8, 0], deep: 25 })', 20, 3, 8, 25],
  ['const s = sphere(40); hole(s, { across: 6, at: [3, 0], deep: 14 })', 20, 3, 3, 14],
  ["const s = sphere(40); hole(s, { across: 6, along: 'y', at: [8, 0] }); move(s, [37, -23, 11])", 20, 3, 8],
]) {
  test(`STEP: ${code.slice(20, 80)}... writes and OpenCascade reads it back (volume, validity, faces)`, () => {
    const o = stepReadBack(code);
    const want = deep === undefined ? through(R, r, e) : blind(R, r, e, R - deep);
    assert.ok(Math.abs(o.vol - want) <= 1e-6 * want, `STEP volume ${o.vol} vs closed form ${want} (${((o.vol - want) / want).toExponential(2)})`);
    assert.equal(o.faces, deep === undefined ? 2 : 3);
    assert.ok(o.valid, 'OpenCascade finds the read-back shape invalid');
  });
}
