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
    for (const defl of [0.05, 0.2]) assert.equal(openEdges(json, id, defl), 0, `open mesh edges at deflection ${defl}`);
  });
}
