// G4 / G5: a boolean whose volume is right must also mesh closed (STL / 3D print). Every
// edge of the mesh is used once each way, volumes are closed forms. A result that cannot be
// made closed must be a refusal, never an open solid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

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

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const json = JSON.stringify(r.doc);
  const out = JSON.parse(brep.build_doc_json(json));
  const id = r.doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(json)).shapes[id];
  return { refusals: out.refusals, m, json, id };
}

const cases = [
  ['G5: two integer boxes joined (7.5 x 1 x 8 overlap): 810 + 72 - 60', 'let v = box(9, 10, 9, { at: [0, 0, 0] })\nconst p = box(8, 1, 9, { at: [1, 0, -1] })\nv = join(v, p)', 822],
  [
    'G5: two stubs on one face with collinear hole edges: 600 + 18 + 36',
    'let v = box(2, 8, 3, { at: [-1, 4, 3] })\nconst p1 = box(10, 6, 10, { at: [-1, 2, 0] })\nv = join(v, p1)\nconst p2 = box(4, 8, 3, { at: [0, 4, -3] })\nv = join(v, p2)',
    654,
  ],
  [
    // the planar result's top and bottom faces carried a vertex the +y face did not (a T-junction), so the closure guard refused a correct solid
    'T-junction: join, keep, keep ends in a 3 x 3.5 x 6 box (grid#2594)',
    'let v = box(8, 10, 6, { at: [-1, 4, 2] })\nconst p1 = box(7, 3, 10, { at: [1, 4, 0] })\nv = join(v, p1)\nconst p2 = box(3, 4, 6, { at: [-2, 1, 2] })\nv = keep(v, p2)\nconst p3 = box(10, 9, 8, { at: [-3, -2, 3] })\nv = keep(v, p3)',
    63,
  ],
  [
    'T-junction: join, cut, keep (grid#15281)',
    'let v = box(4, 6, 3, { at: [3, 0, -1] })\nconst p1 = box(10, 3, 2, { at: [0, 1, 0] })\nv = join(v, p1)\nconst p2 = box(10, 7, 8, { at: [-2, 0, -1] })\nv = cut(v, p2)\nconst p3 = box(8, 5, 9, { at: [3, -3, 0] })\nv = keep(v, p3)',
    15,
  ],
  [
    // a counterbore whose rim is tangent to the side wall: the rim put a vertex on the top face's straight edge that the side face did not have
    'tangent counterbore then a detached box join (open at deflection 0.1)',
    'let v = box(31, 31, 28)\nhole(v, { across: 7, at: [-8, 2], counterbore: { across: 15, deep: 2 } })\nconst p = box(6, 11, 5, { at: [-23, -23, 6] })\nv = join(v, p)',
    25883.973566302808,
  ],
  [
    // the cylinder only touches the hex prism's bottom face, splitting it along an arc; the mirrored copy kept the arcs' old normals and could not be meshed
    'mirror of a prism whose bottom face is split along an arc (empty mesh)',
    'let v = prism(6, 48.42, 31.97, { at: [-3.48, 2.17, -3.35] })\nconst p1 = cylinder(37.73, 15.43, { at: [-12.93, 6.44, -27.05] })\nv = cut(v, p1)\nv = mirror(v, "front-back")',
    97367.51748622919,
  ],
  [
    'G4: holed box then a box join',
    'const a = box(40, 40, 20)\nhole(a, { across: 8 })\nconst b = box(10, 10, 10, { at: [15, 0, 8] })\njoin(a, b)',
    32000 - Math.PI * 16 * 20 + 300,
  ],
  [
    'G4: holed box then a slot cut',
    'const a = box(40, 40, 20)\nhole(a, { across: 8 })\ncut(a, box(50, 10, 4, { at: [0, -20, 0] }))',
    32000 - Math.PI * 16 * 20 - 800,
  ],
];

for (const [name, code, volume] of cases) {
  test(name, () => {
    const { refusals, m, json, id } = build(code);
    assert.deepEqual(refusals, {}, 'these four build');
    assert.ok(m, 'built');
    assert.ok(Math.abs(m.volume - volume) < 1e-3, `${m.volume} vs ${volume}`);
    for (const defl of [0.02, 0.05, 0.1, 0.2]) assert.equal(openEdges(json, id, defl), 0, `open mesh edges at deflection ${defl}`);
  });
}
