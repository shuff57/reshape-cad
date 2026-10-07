// Hollow of a part with flat faces beyond the plain box (W6): a box with rounded or chamfered edges along one axis (the cavity is the same
// prism moved in by the wall, each round's radius reduced by the wall), and any convex part with flat faces (a wedge, a prism, a turned box:
// its planes moved in). Oracles that do not run through the kernel's own surface integrals:
//   * a closed form: the outer prism less the cavity prism (the cavity's round reduced by the wall, its chamfer leg by wall (2 - sqrt 2));
//   * OpenCascade, the referee, where it builds the hollow (for a ROUNDED box it often returns the part unhollowed, which is no referee);
//   * a watertight mesh, and STEP read back by OpenCascade.
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
function occtVolume(features, id) {
  try {
    const sh = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
    const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(sh, g, 1e-7, false, false);
    return g.Mass();
  } catch { return null; }
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

// ---- a box with ONE rounded or chamfered edge ---------------------------------------------------------------------------------------------
const FACES = ['top', 'bottom', 'front', 'back', 'left', 'right'];
const AXIS = { top: 2, bottom: 2, front: 1, back: 1, left: 0, right: 0 };
const ADJ = [['top', 'front'], ['top', 'back'], ['top', 'left'], ['top', 'right'], ['bottom', 'front'], ['bottom', 'back'], ['bottom', 'left'], ['bottom', 'right'], ['front', 'left'], ['front', 'right'], ['back', 'left'], ['back', 'right']];
/** Closed form: the box less its cut edge, less the cavity (inset, the open side flush, the cut reduced by the wall unless the open side touches the edge). */
function oracle({ dims, edge, size, round, wall, open }) {
  const cutArea = (s) => (round ? (1 - Math.PI / 4) * s * s : 0.5 * s * s);
  const axisOfEdge = [0, 1, 2].find((i) => i !== AXIS[edge[0]] && i !== AXIS[edge[1]]);
  const outer = dims[0] * dims[1] * dims[2] - cutArea(size) * dims[axisOfEdge];
  const inner = [...dims];
  for (let i = 0; i < 3; i++) inner[i] -= 2 * wall;
  if (open) inner[AXIS[open]] += wall; // the open side stays flush
  if (inner.some((x) => x <= 0)) return null;
  let cav = inner[0] * inner[1] * inner[2];
  if (!(open && edge.includes(open))) {
    const s = round ? size - wall : size - wall * (2 - Math.SQRT2);
    if (s > 1e-9) cav -= cutArea(s) * inner[axisOfEdge];
  }
  return outer - cav;
}

test('a box with a rounded or chamfered edge hollows: exact against the closed form, OpenCascade where it builds, mesh watertight', () => {
  const rand = rng(Number(process.env.HOLLOWFLAT_SEED ?? 5));
  const n = Number(process.env.HOLLOWFLAT_N ?? 80);
  let built = 0, refused = 0, honest = 0;
  const bad = [];
  for (let i = 0; i < n; i++) {
    const dims = [r2(20 + rand() * 30), r2(20 + rand() * 30), r2(14 + rand() * 20)];
    const edge = ADJ[Math.floor(rand() * ADJ.length)];
    const wall = r2(1 + rand() * 3);
    const size = r2(0.8 + rand() * 6);
    const round = rand() < 0.65;
    const open = rand() < 0.2 ? null : FACES[Math.floor(rand() * 6)];
    const code = `let v = box(${dims.join(', ')}, { at: [0, 0, 0] })\n${round ? 'round' : 'bevel'}(v.edge('${edge[0]}', '${edge[1]}'), ${size})\nhollow(v, { wall: ${wall}${open ? `, open: '${open}'` : ''} })`;
    const { refusals, m, r, id, doc } = build(code);
    const want = oracle({ dims, edge, size, round, wall, open });
    const adjacentOpen = open && edge.includes(open);
    if (Object.keys(refusals).length) {
      refused++;
      // honest when the wall reaches the round (a round as wide as the wall on the open rim), or the closed form says nothing is left
      if (want === null || (adjacentOpen && size >= wall - 1e-9) || size >= Math.min(...dims) / 2) honest++;
      continue;
    }
    built++;
    if (round && adjacentOpen && size > wall + 1e-6) { bad.push(`built where the round eats the lip :: ${code.replace(/\n/g, ' ; ')}`); continue; }
    // a chamfer on the open face's own edge keeps its offset plane cutting the cavity right up to the rim, which the closed form here
    // does not model: OpenCascade is the check there
    const modelled = round || !adjacentOpen;
    if (modelled && want !== null && Math.abs(m.volume - want) > 1e-6 * want) bad.push(`volume ${m.volume} closed form ${want} :: ${code.replace(/\n/g, ' ; ')}`);
    if (open) {
      const o = occtVolume(r.doc.features, id);
      // OpenCascade sometimes hands back the part unhollowed; when it did hollow, it must agree
      if (o !== null && o < dims[0] * dims[1] * dims[2] * 0.95 && Math.abs(m.volume - o) > 1e-6 * o) bad.push(`volume ${m.volume} occt ${o} :: ${code.replace(/\n/g, ' ; ')}`);
    }
    for (const d of [0.05, 0.5]) {
      const open_ = openEdges(doc, id, d);
      if (open_) bad.push(`open mesh (${open_} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  console.log(`hollow of a box with a rounded or chamfered edge: built ${built}, refused ${refused} (honest ${honest}), of ${n}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 0.55 * n, `only ${built} of ${n} built`);
  assert.ok(refused - honest <= 0.1 * n, `${refused - honest} refusals that look wrong`);
});

// ---- any convex part with flat faces --------------------------------------------------------------------------------------------------------
const SHAPES = [
  ['a wedge', (r) => `wedge(${r2(20 + r() * 20)}, ${r2(20 + r() * 20)}, ${r2(14 + r() * 14)}, { at: [0, 0, 0] })`],
  ['a prism', (r) => `prism(${3 + Math.floor(r() * 8)}, ${r2(20 + r() * 20)}, ${r2(12 + r() * 16)}, { at: [0, 0, 0] })`],
  ['a turned box', (r) => `box(${r2(20 + r() * 20)}, ${r2(14 + r() * 14)}, ${r2(10 + r() * 14)}, { at: [0, 0, 0] })\nturn(v, [0, 0, ${r2(r() * 90)}])`],
];
test('a convex part with flat faces hollows: against OpenCascade, mesh watertight, and STEP reads back', () => {
  const rand = rng(Number(process.env.HOLLOWFLAT_SEED ?? 9));
  let built = 0, refused = 0, tried = 0;
  const bad = [];
  for (let i = 0; i < Number(process.env.HOLLOWFLAT_N ?? 60); i++) {
    const [name, make] = SHAPES[i % SHAPES.length];
    const wall = r2(0.8 + rand() * 2.5);
    const open = rand() < 0.2 ? null : FACES[Math.floor(rand() * 6)];
    const code = `let v = ${make(rand)}\nhollow(v, { wall: ${wall}${open ? `, open: '${open}'` : ''} })`;
    tried++;
    const { refusals, m, r, id, doc } = build(code);
    if (Object.keys(refusals).length) { refused++; continue; }
    built++;
    const o = occtVolume(r.doc.features, id);
    if (o !== null && Math.abs(m.volume - o) > 1e-6 * o) bad.push(`${name}: volume ${m.volume} occt ${o} :: ${code.replace(/\n/g, ' ; ')}`);
    for (const d of [0.05, 0.5]) { const open_ = openEdges(doc, id, d); if (open_) bad.push(`${name}: open mesh (${open_} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`); }
    if (i % 4 === 0) {
      const s = stepRoundTrip(code);
      if (!s.refused && !s.buildRefused && !okRead(s)) bad.push(`${name}: STEP read back wrong :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  console.log(`hollow of a flat convex part: built ${built}, refused ${refused}, of ${tried}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 0.5 * tried, `only ${built} of ${tried} built`);
});

// ---- a cone ------------------------------------------------------------------------------------------------------------------------------
// The cavity of a cone is the same cone with every side moved in by the wall: its slope by `wall`, which is `wall * slant / h` on the radius,
// and its base by `wall` (the base side stays flush when it is left open). OpenCascade hands a cone back unhollowed, so the closed form is the
// oracle; the mesh must be watertight and STEP must read back as the same solid.
test('a cone hollows to the closed form, open at its base or sealed, upright or turned over; mesh watertight; STEP reads back', () => {
  const rand = rng(Number(process.env.HOLLOWFLAT_SEED ?? 13));
  let built = 0, refused = 0;
  const bad = [];
  for (let i = 0; i < Number(process.env.HOLLOWFLAT_N ?? 40); i++) {
    const R = r2(8 + rand() * 25), h = r2(10 + rand() * 30);
    const wall = r2(0.8 + rand() * 4);
    const open = rand() < 0.6;
    const flip = rand() < 0.3;
    const code = `let v = cone(${r2(2 * R)}, ${h}, { at: [0, 0, 0] })\n${flip ? 'turn(v, [180, 0, 0])\n' : ''}hollow(v, { wall: ${wall}${open ? `, open: '${flip ? 'top' : 'bottom'}'` : ''} })`;
    const slant = Math.hypot(R, h);
    const hi = h - (wall * slant) / R; // the cavity's tip
    const Ri = R - (wall * slant) / h; // its radius at the base plane
    let want = null;
    if (hi > 0 && Ri > 0) {
      const outer = (Math.PI * R * R * h) / 3;
      if (open) want = outer - (Math.PI * Ri * Ri * hi) / 3;
      else if (hi - wall > 0) { const rw = Ri * (1 - wall / hi); want = outer - (Math.PI * rw * rw * (hi - wall)) / 3; }
    }
    const { refusals, m, doc, id } = build(code);
    if (Object.keys(refusals).length) { refused++; if (want !== null && wall < 0.5 * Math.min(R, h) && !open) bad.push(`refused a hollow with a closed form ${want} :: ${code.replace(/\n/g, ' ; ')}`); continue; }
    built++;
    if (want === null) { bad.push(`built where nothing is left :: ${code.replace(/\n/g, ' ; ')}`); continue; }
    if (Math.abs(m.volume - want) > 1e-6 * want) bad.push(`volume ${m.volume} closed form ${want} :: ${code.replace(/\n/g, ' ; ')}`);
    for (const d of [0.05, 0.5]) { const o = openEdges(doc, id, d); if (o) bad.push(`open mesh (${o} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`); }
    if (i % 3 === 0) { const s = stepRoundTrip(code); if (!s.refused && !s.buildRefused && !okRead(s)) bad.push(`STEP read back wrong ${JSON.stringify({ dv: s.dv, db: s.db, valid: s.got?.valid })} :: ${code.replace(/\n/g, ' ; ')}`); }
  }
  console.log(`cone hollow: built ${built}, refused ${refused}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 20, `only ${built} built`);
});

// The open face is named from the part as it was made: after a move or a turn, the face it names may be a plane the part no longer has.
// That must refuse (the part is then shown closed, with the sentence), never quietly build the sealed hollow as if the face had been found.
test('an open face that the part no longer has is refused, never a sealed hollow built in its place', () => {
  const sealed = (dims, w) => dims[0] * dims[1] * dims[2] - (dims[0] - 2 * w) * (dims[1] - 2 * w) * (dims[2] - 2 * w);
  for (const [name, code, dims] of [
    ['a part moved in y, open front', "let v = box(53.19, 59.56, 17.89, { at: [0, 0, 0] })\nmove(v, [0, 1.39, 0])\nhollow(v, { wall: 1.14, open: 'front' })", [53.19, 59.56, 17.89]],
    ['a prism moved and turned, open top', "let v = prism(6, 38.69, 20.47, { at: [0, 0, 0] })\nmove(v, [3.39, -8.66, -5.64])\nhollow(v, { wall: 1.47, open: 'top' })\nturn(v, [30, 0, 90])", null],
    ['a wedge turned, open front', "let v = wedge(17.86, 28.45, 13.46, { at: [0, 0, 0] })\nturn(v, [30, 0, 0])\nhollow(v, { wall: 1.6, open: 'front' })", null],
  ]) {
    const { refusals, m } = build(code);
    const refused = Object.values(refusals).some((s) => /could not find the face to leave open/.test(s));
    // either it found the face and built the OPEN hollow (checked against OpenCascade elsewhere), or it said it could not; the sealed volume is the wrong answer
    if (!refused && dims) assert.ok(Math.abs(m.volume - sealed(dims, 1.14)) > 1, `${name}: built the sealed hollow ${m.volume}`);
    assert.ok(refused || m, name);
  }
});

// ---- moved and turned parts ---------------------------------------------------------------------------------------------------------------
// A face named for the part as first built is followed through a move or a turn to where it is now, so a hollow with a face left open builds
// on a part that was moved or turned first. Against OpenCascade where it hollows (it hands some parts back unhollowed, which is no referee).
test('a moved or turned flat-faced part hollows with a face left open: builds, and agrees with OpenCascade where it can', () => {
  const rand = rng(Number(process.env.HOLLOWFLAT_SEED ?? 77));
  let built = 0, tried = 0, checked = 0;
  const bad = [];
  for (let i = 0; i < Number(process.env.HOLLOWFLAT_N ?? 90); i++) {
    const shape = [
      () => `box(${r2(20 + rand() * 30)}, ${r2(20 + rand() * 30)}, ${r2(15 + rand() * 20)}, { at: [0, 0, 0] })`,
      () => `wedge(${r2(20 + rand() * 20)}, ${r2(20 + rand() * 20)}, ${r2(15 + rand() * 15)}, { at: [0, 0, 0] })`,
      () => `prism(${3 + Math.floor(rand() * 7)}, ${r2(20 + rand() * 20)}, ${r2(15 + rand() * 15)}, { at: [0, 0, 0] })`,
    ][i % 3]();
    const mv = rand() < 0.75 ? `move(v, [${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}, ${r2((rand() - 0.5) * 30)}])\n` : '';
    const tn = rand() < 0.4 ? `turn(v, [${r2(rand() * 90)}, ${r2(rand() * 90)}, ${r2(rand() * 90)}])\n` : '';
    const code = `let v = ${shape}\n${mv}${tn}hollow(v, { wall: ${r2(0.8 + rand() * 2.5)}, open: '${FACES[Math.floor(rand() * 6)]}' })`;
    tried++;
    const { refusals, m, r, id } = build(code);
    if (Object.keys(refusals).length) continue;
    built++;
    const o = occtVolume(r.doc.features, id);
    // OpenCascade's own unhollowed answer is the outer part: the volume of the part before the hollow
    const before = (() => { const first = build(code.replace(/\nhollow\(.*\)$/, '')); return first.m?.volume ?? null; })();
    if (o !== null && before !== null && o < before * 0.999) {
      checked++;
      if (Math.abs(m.volume - o) > 1e-6 * o) bad.push(`volume ${m.volume} occt ${o} :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  console.log(`hollow of a moved or turned flat part: built ${built} of ${tried}, checked against OpenCascade ${checked}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 0.9 * tried, `only ${built} of ${tried} built`);
  assert.ok(checked >= 0.5 * built, `OpenCascade checked only ${checked} of ${built}`);
});
