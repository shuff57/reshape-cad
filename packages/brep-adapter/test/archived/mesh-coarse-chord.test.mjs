// Four meshes that were open at a coarse chord with the volume exact (found by the S4 integration sweep).
// Three root causes, none of them "the two faces of an edge sampled it differently" (an edge is sampled once,
// by its own handle, and both faces read that one polyline):
//  1. cone kept with a sphere (csg#3702) and a sphere joined to a cylinder then drilled (s4 idx 883): the sphere
//     zone is a band a few microns wide and millimetres long, and its triangles were wound by their own
//     geometric normal, which for such a sliver points anywhere; neighbouring triangles wound against each other.
//     They are wound by their (u, v) parameters now.
//  2. a cylinder cut by a prism whose vertex lies 5 microns inside the wall (csg#2366s1): the vertex falls
//     outside the sampled arc (the sagitta is 0.2 mm at chord 0.5), the planar face's polygon crosses itself and
//     is not triangulated. A circular edge now takes a sample at the angle of every vertex that lies within a
//     chord of it.
//  3. a wide cylinder whose bottom face holds a narrower cylinder's top rim 5 microns from its own edge (random#5247s3):
//     the two rims' polylines cross. Two coplanar circles that come within two chords of touching, and every circle
//     of the faces they bound, are sampled at a third of the gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const PKG = process.env.BREP_PKG ?? path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

const CHORDS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0];

/** Directed-edge closure of a mesh, vertices welded to a micron: the count of edges without their reverse. */
function openEdges(m) {
  const P = m.positions, W = 1e-6;
  const key = (i) => `${Math.round(P[3 * i] / W)},${Math.round(P[3 * i + 1] / W)},${Math.round(P[3 * i + 2] / W)}`;
  const dir = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(m.indices[t + e]), b = key(m.indices[t + ((e + 1) % 3)]);
      if (a !== b) dir.set(`${a}>${b}`, (dir.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [k, n] of dir) {
    const [a, b] = k.split('>');
    if ((dir.get(`${b}>${a}`) ?? 0) !== n) open++;
  }
  return open;
}

function meshVolume(m) {
  const P = m.positions;
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((e) => m.indices[t + e] * 3);
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}

const CASES = {
  'cone kept with a sphere whose circle falls 4 microns from the cone base rim (csg#3702)':
    "let v = cone(29.73, 12.95, { at: [0, 0, 0] })\nconst p1 = sphere(49.61, { at: [0, 0, 13.39] })\nv = keep(v, p1)",
  'cylinder cut by a prism vertex 5 microns inside the wall (csg#2366s1)':
    "let v = cylinder(22.71, 10.96, { at: [0, 0, 0] })\nconst p1 = cylinder(26.47, 35.33, { at: [54.18, -1.75, 3.12] })\nv = join(v, p1)\nconst p2 = prism(7, 19.87, 15.66, { at: [-0.38, 1.98, 0.49] })\nv = cut(v, p2)\nconst p3 = box(22.71, 22.71, 8.67, { at: [0, 0, -1.15] })\nv = keep(v, p3)",
  'sphere joined with a wider cylinder and drilled, a dome ring 0.05 wide (s4 idx 883 seed 1)':
    "let v = sphere(24.1, { at: [1.09, -7.5, 4.08] })\nconst p1 = cylinder(41.25, 20.77, { at: [1.09, -7.5, 1.9] })\nv = join(v, p1)\nhole(v, { across: 17.54 })",
  'a cylinder pattern joined with a cylinder tangent to a copy to 5 microns (random#5247s3)':
    "let v = cylinder(24.17, 18.85, { at: [-9.67, -4.49, 8.03] })\nrepeat(v, { count: 3, step: [34.47, -5.72, 0] })\nmove(v, [-4.78, 0.91, -14.09])\nconst p1 = cylinder(30.88, 20.15, { at: [17.85, -6.75, 11.04] })\nv = join(v, p1)",
  // guards for the rule of case 3: neither of these was open before it, and neither may become so
  'a blind hole and a through hole 0.015 wider than it, concentric (holes#422s2)':
    "let v = box(46.27, 19.92, 23.84, { at: [0, 0, 0] })\nhole(v, { across: 3.12, deep: 4.14 })\nhole(v, { across: 3.09 })",
  'two holes of one box 0.095 apart (holes#526s1)':
    "let v = box(20.66, 34.24, 47.51, { at: [0, 0, 0] })\nhole(v, { across: 8.42, at: [5.06, 2.4] })\nhole(v, { across: 8.79, at: [0.83, -5.2], deep: 22.79 })",
};

for (const [name, code] of Object.entries(CASES)) {
  test(`mesh closed at every chord: ${name}`, () => {
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const json = JSON.stringify({ version: 1, features: r.doc.features });
    assert.deepEqual(JSON.parse(brep.build_doc_json(json)).refusals ?? {}, {});
    const exact = JSON.parse(brep.measure_doc(json)).shapes[id].volume;
    const bad = [];
    for (const d of CHORDS) {
      const m = JSON.parse(brep.mesh_feature(json, id, d));
      assert.ok(!m.error, m.error);
      const open = openEdges(m);
      if (open) bad.push(`chord ${d}: ${open} open edges`);
      // the mesh holds the part: its volume is the exact one to within the chord's own error
      const bound = 0.002 * exact + d * 10 * Math.cbrt(exact * exact);
      assert.ok(Math.abs(meshVolume(m) - exact) < bound, `chord ${d}: mesh volume ${meshVolume(m)} vs exact ${exact}`);
    }
    assert.deepEqual(bad, [], bad.join('; '));
  });
}
