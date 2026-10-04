// G2 / G3 regressions from the wrong-solid sweep.
//  G2: a TURNED cone meshed open (its wall's angle lattice starts at the rotated frame's u0, its base disk's does not).
//  G3: the bbox of a cone face after a boolean came from the untrimmed surface, not the trimmed face.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const json = JSON.stringify(r.doc);
  const id = r.doc.features.at(-1).id;
  assert.deepEqual(JSON.parse(brep.build_doc_json(json)).refusals, {}, code);
  return { json, id, s: JSON.parse(brep.measure_doc(json)).shapes[id] };
}

function openEdges(json, id, defl) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  const P = m.positions, I = m.indices;
  const ids = new Map(), canon = [];
  for (let i = 0; i < P.length / 3; i++) {
    const k = [0, 1, 2].map((a) => Math.round(P[3 * i + a] / 1e-6)).join(',');
    if (!ids.has(k)) ids.set(k, ids.size);
    canon.push(ids.get(k));
  }
  const d = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = canon[I[t + e]], b = canon[I[t + (e + 1) % 3]];
    if (a !== b) d.set(`${a}>${b}`, (d.get(`${a}>${b}`) ?? 0) + 1);
  }
  let open = 0;
  for (const k of d.keys()) { const [u, w] = k.split('>'); if (!d.has(`${w}>${u}`)) open++; }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  return { open, lo, hi };
}

for (const turn of ['[0,0,45]', '[0,90,0]', '[0,0,200]', '[30,0,0]', '[17,33,71]', '[0,0,0]']) {
  test(`G2: cone turned ${turn} meshes watertight at every deflection, volume exact`, () => {
    const { json, id, s } = build(`const c = cone(20, 20, { at: [0, 0, 0] }); turn(c, ${turn})`);
    assert.ok(Math.abs(s.volume - (Math.PI * 100 * 20) / 3) < 1e-6);
    for (const defl of [0.01, 0.05, 0.1, 0.3, 1]) assert.equal(openEdges(json, id, defl).open, 0, `deflection ${defl}`);
  });
}

test('G2: a bored and a cut turned cone stay watertight', () => {
  for (const code of [
    'const c = cone(20, 20); const t = turn(c, [0, 0, 45]); hole(t, { across: 4 })',
    'let v = cone(20, 20); v = turn(v, [0, 0, 45]); const p = box(30, 30, 6, { at: [0, 0, -4] }); v = cut(v, p)',
  ]) {
    const { json, id } = build(code);
    for (const defl of [0.05, 0.3]) assert.equal(openEdges(json, id, defl).open, 0, `${code} @ ${defl}`);
  }
});

test('G3: a cone cut by a box has a tight bbox (agrees with its mesh)', () => {
  const { json, id, s } = build('let v = cone(22.16, 11.93); const p = box(22.16, 22.16, 7.37, { at: [0, 0, -2.28] }); v = cut(v, p)');
  assert.ok(Math.abs(s.bbox[0][2] - 1.405) < 1e-9, `z-min ${s.bbox[0][2]}`);
  assert.ok(Math.abs(s.bbox[1][2] - 5.965) < 1e-9, `z-max ${s.bbox[1][2]}`);
  const { lo, hi } = openEdges(json, id, 0.01);
  for (let k = 0; k < 3; k++) {
    assert.ok(s.bbox[0][k] <= lo[k] + 1e-6 && lo[k] - s.bbox[0][k] < 0.02, `min axis ${k}`);
    assert.ok(s.bbox[1][k] >= hi[k] - 1e-6 && s.bbox[1][k] - hi[k] < 0.02, `max axis ${k}`);
  }
});
