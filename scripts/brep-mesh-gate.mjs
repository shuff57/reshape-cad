#!/usr/bin/env node
// Mesh gate for packages/brep-rs's tessellator. LEAD-OWNED.
// docs/specs/SPEC-brep-mesh.md. The brep-rs builder must not edit this file.
//
// For every parity fixture, at each deflection, meshes the measured feature with
// brep.mesh_feature() and checks the mesh against brep-rs's own exact measure
// (measure_doc) and against OCCT's tessellation size:
//   - face ranges: one per B-rep face, contiguous, complete, count % 3 == 0
//   - watertight + oriented: after welding within WELD, every directed mesh
//     edge a>b is matched by the same number of b>a uses (2 each way is legal
//     on a tangent contact line; 0 back is a crack, unequal is a flip)
//   - no degenerate (area < 1e-12) or non-finite triangles
//   - --self-test feeds OCCT's own mesh through these checks to prove the gate
//     (skipping OCCT's zero-area pole/apex slivers); expect 0 failures
//   - signed volume > 0 and |V_mesh - V_exact| <= d * A_mesh * 1.05 + 1e-9
//   - mesh bbox and exact bbox agree within d
//   - triangles <= 4 * OCCT triangles + 200 at the same deflection
//   - edges: one polyline per B-rep edge, >= 2 points each, inside bbox + d
//
//   node scripts/brep-mesh-gate.mjs               all fixtures, d = 0.05 and 0.5
//   node scripts/brep-mesh-gate.mjs --kind box    one kind
//
// Exit code is the verdict (0 = every fixture passed at every deflection).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtures } from './brep-parity-fixtures.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
const KIND = arg('--kind');
const DEFLECTIONS = [0.05, 0.5];
const WELD = 1e-6;

const OCCT_DIR = process.env.RESHAPE_KERNEL_DIR
  ?? path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/kernel/dist/occt-build.js');
const { tessellate, triangleCount } = await load('packages/kernel/dist/occt-mesh.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');

const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const WASM = path.join(PKG, 'brep_rs_bg.wasm');
if (!existsSync(WASM)) {
  console.log(`FAIL: brep-rs not built (no ${path.relative(REPO, WASM)})`);
  process.exitCode = 1;
} else {
  const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
  brep.initSync({ module: readFileSync(WASM) });
  if (args.includes('--self-test')) {
    // Validates THIS gate's math, not brep-rs: feed OCCT's own (conforming,
    // outward) tessellation through checkMesh with one face range. Every
    // fixture should PASS; a FAIL here means the gate is wrong.
    let bad = 0;
    for (const fx of fixtures().filter((f) => !KIND || f.kind === KIND)) {
      const d0 = fx.doc(mt); const doc = { version: 1, features: d0.features }; const id = fx.measure ?? d0.measure;
      const exact = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[id];
      const shape = buildDoc(oc, doc, arc).shapes.get(id);
      for (const d of DEFLECTIONS) {
        const g = tessellate(oc, shape, { deflection: d });
        const positions = g.polygons.flatMap((p) => p.vertices.flat());
        const indices = positions.map((_, i) => i).filter((i) => i % 3 === 0).map((i) => i / 3);
        const m = { positions, indices, faces: [{ index: 0, start: 0, count: indices.length }], edges: [[...exact.bbox[0], ...exact.bbox[1]]] };
        const r = checkMesh(m, { ...exact, faces: 1, edges: undefined }, g.polygons.length, d, { skipDegenerate: true });
        if (r.bad.length) { bad++; console.log(`SELFTEST FAIL ${fx.id}@${d}: ${r.bad.join('; ')}`); }
      }
    }
    console.log(`self-test: ${bad} failures`);
    process.exitCode = bad ? 1 : 0;
  } else if (typeof brep.mesh_feature !== 'function') {
    console.log('FAIL: brep-rs exports no mesh_feature() (SPEC-brep-mesh.md)');
    process.exitCode = 1;
  } else {
    run(brep);
  }
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a) { return Math.sqrt(dot(a, a)); }

/** Every problem with one mesh, as strings; empty means it passed. */
function checkMesh(m, exact, occtTris, d, opts = {}) {
  const bad = [];
  const P = m.positions; const I = m.indices;
  if (!Array.isArray(P) || !Array.isArray(I) || P.length % 3 || I.length % 3 || I.length === 0) {
    return { bad: ['positions/indices missing or not multiples of 3'] };
  }
  const nv = P.length / 3;
  const pt = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  if (P.some((x) => !Number.isFinite(x))) bad.push('non-finite position');

  // face ranges
  if (!Array.isArray(m.faces) || m.faces.length !== exact.faces) {
    bad.push(`face ranges ${m.faces?.length} vs B-rep faces ${exact.faces}`);
  } else {
    let at = 0;
    m.faces.forEach((f, k) => {
      if (f.index !== k || f.start !== at || !(f.count > 0) || f.count % 3) bad.push(`face range ${k} ${JSON.stringify(f)} (expected start ${at})`);
      at = f.start + f.count;
    });
    if (at !== I.length) bad.push(`face ranges cover ${at} of ${I.length} indices`);
  }

  // weld, then edge-use counts
  const key = (p) => p.map((x) => Math.round(x / WELD)).join(',');
  const weldId = new Map(); const canon = new Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = key(pt(i));
    if (!weldId.has(k)) weldId.set(k, weldId.size);
    canon[i] = weldId.get(k);
  }
  const directed = new Map();
  let vol = 0; let area = 0; let degenerate = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    if (a >= nv || b >= nv || c >= nv) { bad.push(`index out of range at triangle ${t / 3}`); break; }
    const [pa, pb, pc] = [pt(a), pt(b), pt(c)];
    const n = cross(sub(pb, pa), sub(pc, pa));
    const ar = len(n) / 2;
    if (!(ar >= 1e-12)) { degenerate++; if (opts.skipDegenerate) continue; }
    area += ar;
    vol += dot(pa, cross(pb, pc)) / 6;
    const ids = [canon[a], canon[b], canon[c]];
    for (let e = 0; e < 3; e++) {
      const u = ids[e]; const v = ids[(e + 1) % 3];
      if (u === v) continue;
      const k = `${u}>${v}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }
  if (degenerate && !opts.skipDegenerate) bad.push(`${degenerate} degenerate triangles`);
  let open = 0; let flipped = 0;
  for (const [k, count] of directed) {
    const [u, v] = k.split('>');
    const back = directed.get(`${v}>${u}`) ?? 0;
    // Balanced, not exactly-once: a tangent contact line (tangent-union-cylinder)
    // is legitimately shared by 4 triangles, 2 in each direction.
    if (back === 0) open++;
    else if (count !== back) flipped++;
  }
  if (open) bad.push(`${open} open/cracked edges (not watertight)`);
  if (flipped) bad.push(`${flipped} edges used twice in the same direction (inconsistent orientation)`);

  // volume bound
  const bound = d * area * 1.05 + 1e-9;
  const dv = Math.abs(vol - exact.volume);
  if (!(vol > 0)) bad.push(`signed volume ${vol.toFixed(4)} not positive (inside-out?)`);
  else if (dv > bound) bad.push(`volume ${vol.toFixed(4)} vs exact ${exact.volume.toFixed(4)}: |dV| ${dv.toExponential(2)} > bound ${bound.toExponential(2)}`);

  // bbox agreement
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[3 * i + j]); hi[j] = Math.max(hi[j], P[3 * i + j]); }
  const eb = exact.bbox;
  for (let j = 0; j < 3; j++) {
    if (Math.abs(lo[j] - eb[0][j]) > d + 1e-9 || Math.abs(hi[j] - eb[1][j]) > d + 1e-9) {
      bad.push(`bbox axis ${j}: mesh [${lo[j].toFixed(4)}, ${hi[j].toFixed(4)}] vs exact [${eb[0][j].toFixed(4)}, ${eb[1][j].toFixed(4)}]`);
    }
  }

  // size vs OCCT
  const tris = I.length / 3;
  const cap = 4 * occtTris + 200;
  if (tris > cap) bad.push(`${tris} triangles > 4*OCCT(${occtTris})+200`);

  // edges
  if (!Array.isArray(m.edges) || m.edges.length === 0) bad.push('no edge polylines');
  else {
    if (typeof exact.edges === 'number' && m.edges.length !== exact.edges) bad.push(`edge polylines ${m.edges.length} vs B-rep edges ${exact.edges}`);
    m.edges.forEach((e, j) => {
      if (!Array.isArray(e) || e.length < 6 || e.length % 3) { bad.push(`edge ${j} has < 2 points`); return; }
      for (let i = 0; i < e.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (!(e[i + k] >= eb[0][k] - d - 1e-9 && e[i + k] <= eb[1][k] + d + 1e-9)) { bad.push(`edge ${j} point outside bbox`); return; }
        }
      }
    });
  }
  return { bad, volRatio: bound > 0 ? dv / bound : 0, triRatio: occtTris ? tris / occtTris : tris };
}

function run(brep) {
  let pass = 0; let fail = 0;
  const byKind = new Map();
  let worstVol = { r: 0, at: '' }; let worstTri = { r: 0, at: '' };
  for (const fx of fixtures().filter((f) => !KIND || f.kind === KIND)) {
    const d0 = fx.doc(mt);
    const doc = { version: 1, features: d0.features };
    const id = fx.measure ?? d0.measure;
    const json = JSON.stringify(doc);
    let exact;
    try {
      const got = JSON.parse(brep.measure_doc(json));
      exact = got.shapes?.[id];
      if (!exact) throw new Error(got.refusals?.[id] ?? 'no shape');
    } catch (e) {
      console.log(`FAIL    ${fx.id} [${fx.kind}]: measure_doc: ${e.message}`);
      fail++; tallyKind(byKind, fx.kind, false); continue;
    }
    const occtShape = buildDoc(oc, doc, arc).shapes.get(id);
    let ok = true; const notes = [];
    for (const d of DEFLECTIONS) {
      let m;
      try {
        m = JSON.parse(brep.mesh_feature(json, id, d));
      } catch (e) {
        ok = false; notes.push(`d=${d}: mesh_feature threw ${e && e.message ? e.message : String(e)}`); continue;
      }
      if (m.error) { ok = false; notes.push(`d=${d}: ${m.error}`); continue; }
      const occtTris = triangleCount(tessellate(oc, occtShape, { deflection: d }));
      const r = checkMesh(m, exact, occtTris, d);
      if (r.bad.length) { ok = false; notes.push(`d=${d}: ${r.bad.slice(0, 4).join('; ')}`); }
      if (r.volRatio > worstVol.r) worstVol = { r: r.volRatio, at: `${fx.id}@${d}` };
      if (r.triRatio > worstTri.r) worstTri = { r: r.triRatio, at: `${fx.id}@${d}` };
    }
    console.log(`${ok ? 'PASS' : 'FAIL'}    ${fx.id} [${fx.kind}]${notes.length ? ` -- ${notes.join(' | ')}` : ''}`);
    ok ? pass++ : fail++;
    tallyKind(byKind, fx.kind, ok);
  }
  console.log('\nper kind:');
  for (const [kind, t] of [...byKind.entries()].sort()) {
    console.log(`  ${kind.padEnd(10)} ${t.fail === 0 ? 'DONE' : 'open'}  ${t.pass} pass, ${t.fail} fail`);
  }
  console.log(`\nworst volume-bound ratio ${worstVol.r.toFixed(3)} (${worstVol.at}); worst triangles vs OCCT ${worstTri.r.toFixed(2)}x (${worstTri.at})`);
  console.log(`brep-rs mesh gate: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

function tallyKind(byKind, kind, ok) {
  const t = byKind.get(kind) ?? { pass: 0, fail: 0 };
  ok ? t.pass++ : t.fail++;
  byKind.set(kind, t);
}
