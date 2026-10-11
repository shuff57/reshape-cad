// A cone kept by a box (W3 S1, SPEC-brep-cone-booleans.md): `keep(cone, box)` with a box that has a face square to the cone's axis, which is
// every box a script draws against a cone standing on z (a box turned about z too). The cone's slanted face is then cut by circles and
// hyperbolas, and brep-rs builds the part exactly.
// Oracles that do not run through the kernel's own surface integrals:
//   * OpenCascade, the independent referee, on volume and bounding box;
//   * an integral of exact cross-section areas (a disk of the cone's radius at each height inside the box's rectangle);
//   * a watertight mesh at two chord tolerances.
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

const PI = Math.PI;
const r2 = (x) => Math.round(x * 100) / 100;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function occt(features, id) {
  const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
  assert.ok(shape, 'OCCT built it');
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]] };
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

/** The area of the disk of radius rho about the origin inside [x0, x1] x [y0, y1], by integrating the chord length. */
function diskRect(rho, x0, x1, y0, y1) {
  if (rho <= 0) return 0;
  const n = 400;
  const a = Math.max(x0, -rho), b = Math.min(x1, rho);
  if (b <= a) return 0;
  const f = (x) => {
    const h = Math.sqrt(Math.max(rho * rho - x * x, 0));
    return Math.max(Math.min(h, y1) - Math.max(-h, y0), 0);
  };
  // Simpson over the stretches between the points where the integrand changes shape
  const cuts = [a, b];
  for (const y of [y0, y1]) if (Math.abs(y) < rho) { const x = Math.sqrt(rho * rho - y * y); for (const c of [-x, x]) if (c > a && c < b) cuts.push(c); }
  cuts.sort((p, q) => p - q);
  let s = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [p, q] = [cuts[i], cuts[i + 1]];
    const h = (q - p) / n;
    let t = f(p) + f(q);
    for (let k = 1; k < n; k++) t += f(p + k * h) * (k % 2 ? 4 : 2);
    s += (t * h) / 3;
  }
  return s;
}
/** cone(base radius r, height h) standing on z = 0, inside the box [lo, hi]: the cross-section integral. */
function overlap(r, h, lo, hi) {
  const z0 = Math.max(lo[2], 0), z1 = Math.min(hi[2], h);
  if (z1 <= z0) return 0;
  const n = 800;
  const f = (z) => diskRect(r * (1 - z / h), lo[0], hi[0], lo[1], hi[1]);
  const hh = (z1 - z0) / n;
  let t = f(z0) + f(z1);
  for (let k = 1; k < n; k++) t += f(z0 + k * hh) * (k % 2 ? 4 : 2);
  return (t * hh) / 3;
}

function randomCase(rand) {
  const R = r2(5 + rand() * 9), H = r2(6 + rand() * 18);
  const size = [r2((0.3 + rand() * 2) * R), r2((0.3 + rand() * 2) * R), r2((0.2 + rand() * 1.3) * H)];
  const at = [r2((rand() - 0.5) * 1.4 * R), r2((rand() - 0.5) * 1.4 * R), r2(rand() * 1.1 * H)];
  return { R, H, size, at };
}
const caseCode = ({ R, H, size, at }, turnZ) =>
  `let v = cone(${r2(2 * R)}, ${H}, { at: [0, 0, 0] })\nlet p = box(${size.join(', ')}, { at: [${at.join(', ')}] })${turnZ ? `\nturn(p, [0, 0, ${turnZ}])` : ''}\nv = keep(v, p)`;
/** The box's extents in the cone's frame, with the cone's base at z = 0 (the script centres a cone on its `at`). */
const extents = ({ H, size, at }) => {
  const c = [at[0], at[1], at[2] + H / 2];
  return [[c[0] - size[0] / 2, c[1] - size[1] / 2, c[2] - size[2] / 2], [c[0] + size[0] / 2, c[1] + size[1] / 2, c[2] + size[2] / 2]];
};

test('a cone kept by a box: exact against OpenCascade and an independent integral, mesh watertight', () => {
  const rand = rng(Number(process.env.CONEBOX_SEED ?? 8));
  const n = Number(process.env.CONEBOX_N ?? 90);
  let built = 0, refused = 0, empty = 0;
  const bad = [];
  for (let i = 0; i < n; i++) {
    const c = randomCase(rand);
    const code = caseCode(c, 0);
    const { refusals, m, r, id, doc } = build(code);
    const [lo, hi] = extents(c);
    const want = overlap(c.R, c.H, lo, hi);
    if (Object.keys(refusals).length) {
      refused++;
      // a refusal is honest when the pair leaves nothing, or when it is a sentence; never a solid
      if (want < 1e-6 * c.R * c.R * c.H) empty++;
      continue;
    }
    built++;
    const o = occt(r.doc.features, id);
    const rel = Math.abs(m.volume - want) / (PI * c.R * c.R * c.H / 3);
    const relO = Math.abs(m.volume - o.volume) / Math.max(o.volume, 1e-9);
    if (rel > 2e-5 || relO > 1e-6) bad.push(`volume ${m.volume} integral ${want} occt ${o.volume} :: ${code.replace(/\n/g, ' ; ')}`);
    const bb = m.bbox ?? m.aabb;
    if (bb) {
      const lo2 = bb.min ?? bb[0], hi2 = bb.max ?? bb[1];
      const tol = 2e-3 * Math.max(c.R, c.H);
      for (let k = 0; k < 3; k++) if (Math.abs(lo2[k] - o.bbox[0][k]) > tol || Math.abs(hi2[k] - o.bbox[1][k]) > tol) bad.push(`bbox ${JSON.stringify([lo2, hi2])} occt ${JSON.stringify(o.bbox)} :: ${code.replace(/\n/g, ' ; ')}`);
    }
    for (const d of [0.05, 0.5]) {
      const open = openEdges(doc, id, d);
      if (open) bad.push(`open mesh (${open} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  console.log(`cone keep box: built ${built}, refused ${refused} (of which empty ${empty}), of ${n}`);
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 0.5 * n, `only ${built} of ${n} built`);
});

test('a box turned about the cone axis is still a clean crossing, and the result does not depend on the turn', () => {
  const rand = rng(31);
  let built = 0;
  const bad = [];
  for (let i = 0; i < 24; i++) {
    const c = randomCase(rand);
    c.at[0] = 0;
    c.at[1] = 0; // turn about the cone's own axis keeps the box where it is relative to the axis only if it is centred on it
    c.size[0] = r2(c.size[0]);
    const code = caseCode(c, 17);
    const { refusals, m, r, id } = build(code);
    if (Object.keys(refusals).length) continue;
    built++;
    const o = occt(r.doc.features, id);
    if (Math.abs(m.volume - o.volume) > 2e-4 * Math.max(o.volume, 1e-9)) bad.push(`${m.volume} vs occt ${o.volume} :: ${code.replace(/\n/g, ' ; ')}`);
  }
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  assert.ok(built >= 12, `only ${built} built`);
});

test('what can be done to a kept cone: move, turn and save it, and every other operation refuses in a sentence', () => {
  const base = "let v = cone(20, 20, { at: [0, 0, 0] })\nlet p = box(8, 40, 30, { at: [4, 0, 10] })\nv = keep(v, p)\n";
  const plain = build(base);
  assert.deepEqual(plain.refusals, {});
  for (const extra of ['move(v, [5, 7, -3])', 'turn(v, [30, 40, 50])']) {
    const t = build(base + extra);
    assert.deepEqual(t.refusals, {}, extra);
    assert.ok(Math.abs(t.m.volume - plain.m.volume) < 1e-9 * plain.m.volume, `${extra} kept the volume`);
  }
  // cutting something else out of it is not built, and says why in words rather than returning a wrong solid
  for (const extra of ['let q = box(4, 4, 40, { at: [0, 0, 5] })\nv = cut(v, q)', 'hole(v, { at: [0, 0], across: 3, deep: 5, along: "z" })']) {
    const t = build(base + extra);
    assert.ok(Object.keys(t.refusals).length > 0, `${extra} is refused`);
    assert.match(Object.values(t.refusals).join(' '), /cut out of a cone by a box|cannot|do not/i);
  }
  // STEP: written, and OpenCascade reads it back as the same solid (the sweep is in step-cone-box.test.mjs)
  const s = stepRoundTrip(base);
  assert.ok(okRead(s), `STEP read-back: ${JSON.stringify(s.refused ?? { dv: s.dv, db: s.db, valid: s.got?.valid })}`);
});

// ---- join and cut (W3 S1b): the cone joined to, cut by, or cutting a box ------------------------------------------------------------
function solidCount(features, id) {
  const shape = buildDoc(oc, { version: 1, features }, arc).shapes.get(id);
  let n = 0;
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++;
  return n;
}
const OPS = [
  ['join', 'v = join(v, p)'],
  ['cut the box from the cone', 'v = cut(v, p)'],
  ['cut the cone from the box', 'v = cut(p, v)'],
];
test('a cone joined to, cut by, or cutting a box: exact against OpenCascade, mesh watertight, and every refusal is a result that is not one solid', () => {
  const rand = rng(Number(process.env.CONEBOX_SEED ?? 21));
  const n = Number(process.env.CONEBOX_N ?? 60);
  const tally = Object.fromEntries(OPS.map(([k]) => [k, { built: 0, refusedOk: 0, gap: 0 }]));
  const bad = [], gaps = [];
  for (let i = 0; i < n; i++) {
    const c = randomCase(rand);
    for (const [name, line] of OPS) {
      const code = caseCode(c, 0).replace('v = keep(v, p)', line);
      const { refusals, m, r, id, doc } = build(code);
      const o = (() => { try { return { ...occt(r.doc.features, id), solids: solidCount(r.doc.features, id) }; } catch { return null; } })();
      if (Object.keys(refusals).length) {
        // honest when the result is not one solid, or has no volume, or is a contact the kernel refuses by name
        if (!o || o.solids !== 1 || o.volume < 1e-6 * c.R * c.R * c.H) tally[name].refusedOk++;
        else { tally[name].gap++; gaps.push(`${name}: ${Object.values(refusals)[0].slice(0, 60)} :: ${code.replace(/\n/g, ' ; ')}`); }
        continue;
      }
      tally[name].built++;
      const relO = Math.abs(m.volume - o.volume) / Math.max(o.volume, 1e-9);
      if (relO > 1e-6) bad.push(`${name}: volume ${m.volume} occt ${o.volume} :: ${code.replace(/\n/g, ' ; ')}`);
      const bb = m.bbox ?? m.aabb;
      const tol = 2e-3 * Math.max(c.R, c.H);
      if (bb) {
        const lo2 = bb.min ?? bb[0], hi2 = bb.max ?? bb[1];
        for (let k = 0; k < 3; k++) if (Math.abs(lo2[k] - o.bbox[0][k]) > tol || Math.abs(hi2[k] - o.bbox[1][k]) > tol) bad.push(`${name}: bbox ${JSON.stringify([lo2, hi2])} occt ${JSON.stringify(o.bbox)} :: ${code.replace(/\n/g, ' ; ')}`);
      }
      for (const d of [0.05, 0.5]) {
        const open = openEdges(doc, id, d);
        if (open) bad.push(`${name}: open mesh (${open} edges at ${d}) :: ${code.replace(/\n/g, ' ; ')}`);
      }
    }
  }
  console.log('cone join/cut:', JSON.stringify(tally));
  assert.deepEqual(bad, [], bad.slice(0, 3).join('\n'));
  const total = n * OPS.length;
  const gapCount = Object.values(tally).reduce((a, t) => a + t.gap, 0);
  const builtCount = Object.values(tally).reduce((a, t) => a + t.built, 0);
  assert.ok(builtCount >= 0.4 * total, `only ${builtCount} of ${total} built`);
  assert.ok(gapCount <= 0.1 * total, `${gapCount} real results refused: ${gaps.slice(0, 3).join('\n')}`);
});

// A cut that leaves two separate pieces is not built (one result cannot hold two lumps yet): it refuses, and the sentence says why.
test('a slab cut through a cone, leaving two pieces, is refused with a sentence that says so', () => {
  const code = `let v = cone(20, 20, { at: [0, 0, 0] })\nlet p = box(40, 3, 60, { at: [0, 0, 0] })\nv = cut(v, p)`;
  const { refusals } = build(code);
  const text = Object.values(refusals).join(' ');
  assert.match(text, /two separate pieces/, text || 'it built');
});

// The result of a cone cut by a box has a cone face defined only by its wires. Anything built on it (another boolean, a hole, a round) must
// refuse in a sentence rather than work from that face as if it were a whole cone.
test('a cut cone is not built on: a further boolean on it refuses with the sentence that names it', () => {
  const base = `let v = cone(20, 20, { at: [0, 0, 0] })\nlet p = box(12, 40, 40, { at: [3, 0, 0] })\nv = keep(v, p)`;
  const first = build(base);
  assert.deepEqual(first.refusals, {}, 'the keep itself builds');
  for (const more of [`let q = box(3, 3, 3, { at: [0, 0, 0] })\nv = cut(v, q)`, `let q = box(3, 3, 3, { at: [0, 0, 12] })\nv = join(v, q)`, `move(v, [1, 0, 0])\nlet q = box(3, 3, 3, { at: [0, 0, 0] })\nv = cut(v, q)`]) {
    const { refusals } = build(`${base}\n${more}`);
    const text = Object.values(refusals).join(' ');
    assert.ok(text.length > 0, `built on a cut cone :: ${more}`);
  }
});
