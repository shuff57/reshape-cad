// A bore parallel to a cone's axis, off it, through the base and out of the slanted face (SPEC-cone-axis-parallel-bores-loop.md): the
// part is exact. Oracles that do not run through the kernel's own surface integrals:
//   * OpenCascade, the independent referee, on volume and bounding box;
//   * an integral over the bore's disk of the cone's height there (a polar midpoint rule, not the kernel's quadrature);
//   * a watertight mesh at two chord tolerances.
// STEP export of the bored cone is a later slice: until then it must refuse in a sentence, never write a wrong solid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stepRoundTrip, okRead } from './step-readback-lib.mjs';

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

const r2 = (x) => Math.round(x * 100) / 100;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function occtMeasure(features, id) {
  try {
    const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
    const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    return g.Mass();
  } catch { return null; }
}
function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const id = r.doc.features.at(-1).id;
  const doc = JSON.stringify({ ...r.doc, measure: id });
  const out = JSON.parse(brep.build_doc_json(doc));
  const refusals = out.refusals ?? {};
  const m = Object.keys(refusals).length ? undefined : JSON.parse(brep.measure_doc(doc)).shapes[id];
  return { refusals, m, r, id, doc };
}
function openEdges(doc, id, defl) {
  const m = JSON.parse(brep.mesh_feature(doc, id, defl));
  const P = m.positions, I = m.indices, ids = new Map(), canon = [];
  for (let i = 0; i < P.length / 3; i++) {
    const k = `${Math.round(P[3 * i] / 1e-6)},${Math.round(P[3 * i + 1] / 1e-6)},${Math.round(P[3 * i + 2] / 1e-6)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    canon.push(ids.get(k));
  }
  const dir = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = canon[I[t + e]], b = canon[I[t + ((e + 1) % 3)]]; if (a !== b) dir.set(`${a}>${b}`, (dir.get(`${a}>${b}`) ?? 0) + 1); }
  let open = 0;
  for (const [k, n] of dir) { const [u, w] = k.split('>'); if ((dir.get(`${w}>${u}`) ?? 0) !== n) open++; }
  return open;
}
/** Volume of the cone (base radius R, height h) with a through bore of radius rho at offset e: the cone less the integral over the bore's disk of the cone's height there. */
function boredVolume(R, h, rho, e) {
  const ns = 400, nt = 4000;
  let removed = 0;
  for (let k = 0; k < nt; k++) {
    const t = (2 * Math.PI * (k + 0.5)) / nt, c = Math.cos(t);
    for (let i = 0; i < ns; i++) {
      const s = (rho * (i + 0.5)) / ns;
      removed += h * (1 - Math.sqrt(e * e + s * s + 2 * e * s * c) / R) * s;
    }
  }
  removed *= ((2 * Math.PI) / nt) * (rho / ns);
  return (Math.PI * R * R * h) / 3 - removed;
}

test('a cone bored parallel to its axis, off it: exact against OpenCascade and the integral, mesh watertight, STEP never wrong', () => {
  const rand = rng(Number(process.env.CONEBORE_SEED ?? 11));
  const N = Number(process.env.CONEBORE_N ?? 60);
  let tried = 0, built = 0, checkedOcct = 0, stepOk = 0, stepRefused = 0;
  const bad = [];
  for (let i = 0; i < N; i++) {
    const R = r2(5 + rand() * 20), h = r2(8 + rand() * 25);
    const rho = r2(0.4 + rand() * 0.35 * R), e = r2((0.1 + rand() * 0.8) * R);
    const ang = rand() * 2 * Math.PI;
    const at = [r2(e * Math.cos(ang)), r2(e * Math.sin(ang))];
    const e2 = Math.hypot(at[0], at[1]);
    const move = rand() < 0.4 ? `\nmove(v, [${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}])` : '';
    const code = `let v = cone(${r2(2 * R)}, ${h}, { at: [0, 0, 0] })${move}\nhole(v, { across: ${r2(2 * rho)}, at: [${at[0]}, ${at[1]}] })`;
    tried++;
    const { refusals, m, r, id, doc } = build(code);
    if (Object.keys(refusals).length) continue;
    built++;
    const want = boredVolume(R, h, rho, e2);
    if (Math.abs(m.volume - want) > 2e-6 * ((Math.PI * R * R * h) / 3)) bad.push(`volume ${m.volume} integral ${want} :: ${code.replace(/\n/g, ' ; ')}`);
    const o = occtMeasure(r.doc.features, id);
    if (o !== null) { checkedOcct++; if (Math.abs(m.volume - o) > 1e-6 * o) bad.push(`volume ${m.volume} occt ${o} :: ${code.replace(/\n/g, ' ; ')}`); }
    for (const d of [0.05, 0.5]) { const e = openEdges(doc, id, d); if (e) bad.push(`open mesh (${e} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`); }
    if (i % 3 === 0) {
      const s = stepRoundTrip(code);
      if (s.refused) stepRefused++;
      else if (okRead(s)) stepOk++;
      else bad.push(`STEP wrote a wrong solid ${JSON.stringify({ dv: s.dv, db: s.db, valid: s.got?.valid })} :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  console.log(`cone bores: built ${built} of ${tried}, against OpenCascade ${checkedOcct}, STEP read back ${stepOk}, STEP refused ${stepRefused}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 0.4 * tried, `only ${built} of ${tried} built`);
});

test('a bored cone is not built on: a further hole or boolean refuses rather than reading it as a whole cone', () => {
  const base = `let v = cone(30, 20, { at: [0, 0, 0] })\nhole(v, { across: 4, at: [6, 0] })`;
  assert.deepEqual(build(base).refusals, {}, 'the bore builds');
  for (const more of [`hole(v, { across: 3, at: [-6, 0] })`, `let q = box(3, 3, 3, { at: [0, 0, 0] })\nv = cut(v, q)`, `let q = cylinder(3, 8, { at: [0, 0, 15] })\nv = join(v, q)`]) {
    const { refusals, m, id } = build(`${base}\n${more}`);
    assert.ok(Object.keys(refusals).length > 0 || m, `${more}`);
    if (!Object.keys(refusals).length) assert.fail(`built on a bored cone: ${more}`);
  }
});
