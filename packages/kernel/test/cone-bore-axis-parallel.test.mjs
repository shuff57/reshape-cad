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
import { stepRoundTrip, okRead, oc as ocRead } from './step-readback-lib.mjs';

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


/** OpenCascade's volume of a STEP text by its FIXED-ORDER integrator. Its adaptive integrator (what the shared read-back uses) is biased by up to ~7e-5 on
 *  a cone face whose hole is a fitted spline with a sharp peak near the apex and no pcurves; the fixed-order one and OpenCascade's own meshing agree with the
 *  kernel's volume (which is the independent integral). A read-back is accepted on this referee only when the shared one is the lone dissenter. */
function fixedOrderVolume(stepText) {
  ocRead.FS.writeFile('/rb3.step', stepText);
  const reader = new ocRead.STEPControl_Reader();
  reader.ReadFile('/rb3.step');
  reader.TransferRoots(new ocRead.Message_ProgressRange());
  const g = new ocRead.GProp_GProps();
  ocRead.BRepGProp.VolumeProperties(reader.OneShape(), g, false, false, false);
  return g.Mass();
}
function stepAccepted(st) {
  if (okRead(st)) return true;
  // valid solid, exact box, and the fixed-order integrator and the meshed volume both agree with ours
  if (!st.got || st.bad || st.got.valid !== true || !(st.db <= 1e-5)) return false;
  return Math.abs(fixedOrderVolume(st.step) - st.want.volume) <= 5e-6 * Math.max(1, st.want.volume) && st.dvMesh <= 5e-5;
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

// A blind bore: it stops at a flat floor `deep` below the apex end, wholly inside the cone (the floor under the lowest point of the meeting
// curve). Volume = the through bore's less the cylinder the floor gives back.
test('a cone bored blind, off the axis, floor inside the cone: exact against OpenCascade and the integral, mesh watertight, STEP never wrong', () => {
  const rand = rng(Number(process.env.CONEBLIND_SEED ?? 31));
  const N = Number(process.env.CONEBLIND_N ?? 60);
  let tried = 0, expectedBuild = 0, built = 0, checkedOcct = 0, stepOk = 0, stepRefused = 0;
  const bad = [];
  for (let i = 0; i < N; i++) {
    const R = r2(6 + rand() * 20), h = r2(10 + rand() * 25);
    const rho = r2(0.5 + rand() * 0.25 * R), e = r2((0.1 + rand() * 0.6) * R);
    const zmin = h * (1 - (e + rho) / R);
    if (e + rho > R * 0.97 || Math.abs(e - rho) < 0.05 * R || zmin < 0.25 * h) continue;
    const zf = r2(0.05 * h + rand() * (zmin - 0.1 * h));
    if (zf <= 0.03 * h || zf >= zmin - 0.03 * h) continue;
    const ang = rand() * 2 * Math.PI;
    const at = [r2(e * Math.cos(ang)), r2(e * Math.sin(ang))];
    const e2 = Math.hypot(at[0], at[1]);
    const move = rand() < 0.4 ? `\nmove(v, [${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}])` : '';
    const code = `let v = cone(${r2(2 * R)}, ${h}, { at: [0, 0, 0] })${move}\nhole(v, { across: ${r2(2 * rho)}, at: [${at[0]}, ${at[1]}], deep: ${r2(h - zf)} })`;
    tried++;
    expectedBuild++;
    const { refusals, m, r, id, doc } = build(code);
    if (Object.keys(refusals).length) { if (process.env.CONEBLIND_WHY) console.log('REFUSED', Object.values(refusals)[0].slice(0, 160), '::', code.replace(/\n/g, ' ; ')); continue; }
    built++;
    const zfExact = h - r2(h - zf);
    const want = boredVolume(R, h, rho, e2) + Math.PI * rho * rho * zfExact;
    if (Math.abs(m.volume - want) > 2e-6 * ((Math.PI * R * R * h) / 3)) bad.push(`volume ${m.volume} integral ${want} :: ${code.replace(/\n/g, ' ; ')}`);
    const o = occtMeasure(r.doc.features, id);
    if (o !== null) { checkedOcct++; if (Math.abs(m.volume - o) > 1e-6 * o) bad.push(`volume ${m.volume} occt ${o} :: ${code.replace(/\n/g, ' ; ')}`); }
    for (const d of [0.05, 0.5]) { const e3 = openEdges(doc, id, d); if (e3) bad.push(`open mesh (${e3} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`); }
    if (i % 3 === 0) {
      const st = stepRoundTrip(code);
      if (st.refused) stepRefused++;
      else if (stepAccepted(st)) stepOk++;
      else bad.push(`STEP wrote a wrong solid ${JSON.stringify({ dv: st.dv, db: st.db, valid: st.got?.valid })} :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  console.log(`cone blind bores: built ${built} of ${tried}, against OpenCascade ${checkedOcct}, STEP read back ${stepOk}, STEP refused ${stepRefused}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 0.9 * expectedBuild, `only ${built} of ${expectedBuild} expected-exact blind bores built`);
});

/** The volume of the cone above the height zf inside a bore of radius rho at offset e: the integral over the bore's disk of max(0, H (1 - |p| / R) - zf), split at the kink. */
function removedAboveFloor(R, H, rho, e, zf) {
  const Rf = R * (1 - zf / H);
  const nt = 3000, pieces = 200;
  let total = 0;
  const f = (s, c) => Math.max(0, H * (1 - Math.sqrt(e * e + s * s + 2 * e * s * c) / R) - zf) * s;
  for (let k = 0; k < nt; k++) {
    const t = (2 * Math.PI * (k + 0.5)) / nt, c = Math.cos(t), sn = Math.sin(t);
    const cuts = [0, rho];
    const disc = Rf * Rf - e * e * sn * sn;
    if (disc >= 0) for (const sg of [-1, 1]) { const s0 = -e * c + sg * Math.sqrt(disc); if (s0 > 0 && s0 < rho) cuts.push(s0); }
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1], h = (b - a) / pieces;
      let acc = f(a, c) + f(b, c);
      for (let j = 1; j < pieces; j++) acc += f(a + j * h, c) * (j % 2 ? 4 : 2);
      total += (acc * h) / 3;
    }
  }
  return (total * 2 * Math.PI) / nt;
}

// A blind bore whose floor cuts through the cone's wall: the floor is a lens, the cone's hole is a curve arc and a circle arc, the wall
// runs between two points where the meeting curve comes down to the floor.
test('a cone bored blind with the floor through the wall: exact against OpenCascade and the integral, mesh watertight, STEP never wrong', () => {
  const rand = rng(Number(process.env.CONELENS_SEED ?? 43));
  const N = Number(process.env.CONELENS_N ?? 80);
  let tried = 0, built = 0, checkedOcct = 0, stepOk = 0, stepRefused = 0;
  const bad = [];
  for (let i = 0; i < N; i++) {
    const R = r2(6 + rand() * 20), h = r2(10 + rand() * 25);
    const rho = r2(0.5 + rand() * 0.3 * R), e0 = (0.1 + rand() * 0.7) * R;
    const ang = rand() * 2 * Math.PI;
    const at = [r2(e0 * Math.cos(ang)), r2(e0 * Math.sin(ang))];
    const e = Math.hypot(at[0], at[1]);
    if (e + rho > R * 0.95 || e < 0.05 * R) continue;
    const zmin = h * (1 - (e + rho) / R), ztop = h * (1 - Math.abs(e - rho) / R);
    if (ztop - zmin < 0.1 * h) continue;
    const zf = r2(zmin + (0.1 + rand() * 0.8) * (ztop - zmin));
    const deep = r2(h - zf), zfx = h - deep;
    if (zfx <= zmin + 0.02 * h || zfx >= ztop - 0.02 * h || zfx < 0.03 * h) continue;
    const move = rand() < 0.4 ? `\nmove(v, [${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}])` : '';
    const code = `let v = cone(${r2(2 * R)}, ${h}, { at: [0, 0, 0] })${move}\nhole(v, { across: ${r2(2 * rho)}, at: [${at[0]}, ${at[1]}], deep: ${deep} })`;
    tried++;
    const { refusals, m, r, id, doc } = build(code);
    if (Object.keys(refusals).length) { if (process.env.CONELENS_WHY) console.log('REFUSED', Object.values(refusals)[0].slice(0, 200), '::', code.replace(/\n/g, ' ; ')); continue; }
    built++;
    const want = (Math.PI * R * R * h) / 3 - removedAboveFloor(R, h, rho, e, zfx);
    if (Math.abs(m.volume - want) > 2e-6 * ((Math.PI * R * R * h) / 3)) bad.push(`volume ${m.volume} integral ${want} :: ${code.replace(/\n/g, ' ; ')}`);
    const o = occtMeasure(r.doc.features, id);
    if (o !== null) { checkedOcct++; if (Math.abs(m.volume - o) > 1e-6 * o) bad.push(`volume ${m.volume} occt ${o} :: ${code.replace(/\n/g, ' ; ')}`); }
    for (const d of [0.05, 0.5]) { const e3 = openEdges(doc, id, d); if (e3) bad.push(`open mesh (${e3} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`); }
    if (i % 3 === 0) {
      const st = stepRoundTrip(code);
      if (st.refused) stepRefused++;
      else if (stepAccepted(st)) stepOk++;
      else bad.push(`STEP wrote a wrong solid ${JSON.stringify({ dv: st.dv, db: st.db, valid: st.got?.valid })} :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  console.log(`cone lens bores: built ${built} of ${tried}, against OpenCascade ${checkedOcct}, STEP read back ${stepOk}, STEP refused ${stepRefused}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 0.8 * tried, `only ${built} of ${tried} expected-exact lens bores built`);
});

// STEP for every kind of bore (through, blind with the floor inside, blind with the floor through the wall), the cone placed, moved and
// turned: each script writes and reads back in OpenCascade as the same valid solid, or refuses in a sentence. Never a wrong solid.
test('every cone bore writes to STEP and reads back as the same solid, or refuses in a sentence', () => {
  const rand = rng(Number(process.env.CONESTEP_SEED ?? 57));
  const N = Number(process.env.CONESTEP_N ?? 150);
  let tried = 0, ok = 0;
  const refused = new Map(), bad = [];
  for (let i = 0; i < N; i++) {
    const R = r2(6 + rand() * 20), h = r2(10 + rand() * 25);
    const rho = r2(0.5 + rand() * 0.3 * R), e0 = (0.08 + rand() * 0.75) * R, ang = rand() * 2 * Math.PI;
    const at = [r2(e0 * Math.cos(ang)), r2(e0 * Math.sin(ang))];
    const e = Math.hypot(...at);
    if (e + rho > R * 0.95 || e < 0.04 * R) continue;
    const kind = rand();
    const ztop = h * (1 - Math.abs(e - rho) / R);
    const deep = kind < 0.3 ? '' : `, deep: ${r2(h - (0.05 + rand() * 0.9) * ztop)}`;
    const place = rand() < 0.5 ? `\nmove(v, [${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}])` : '';
    const code = `let v = cone(${r2(2 * R)}, ${h}, { at: [0, 0, 0] })${place}\nhole(v, { across: ${r2(2 * rho)}, at: [${at[0]}, ${at[1]}]${deep} })`;
    const { refusals } = build(code);
    if (Object.keys(refusals).length) continue;
    tried++;
    const st = stepRoundTrip(code);
    if (st.refused) { const k = st.refused.replace(/[\d.]+/g, '#').slice(0, 120); refused.set(k, (refused.get(k) ?? 0) + 1); }
    else if (stepAccepted(st)) ok++;
    else bad.push(`STEP wrote a wrong solid ${JSON.stringify({ dv: st.dv, db: st.db, valid: st.got?.valid })} :: ${code.replace(/\n/g, ' ; ')}`);
  }
  console.log(`cone bore STEP: ${tried} built, ${ok} read back, refused ${JSON.stringify([...refused])}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  const nref = [...refused.values()].reduce((a, b) => a + b, 0);
  assert.ok(ok >= 0.9 * tried, `only ${ok} of ${tried} read back (${nref} refused)`);
});
