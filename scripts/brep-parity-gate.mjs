#!/usr/bin/env node
// Parity gate for packages/brep-rs against OpenCascade. LEAD-OWNED.
// docs/specs/SPEC-brep-kernel-rs.md §5. The brep-rs builder must not edit this
// file, scripts/brep-parity-fixtures.mjs, or the tolerances below.
//
// Every fixture is built TWICE -- on OCCT (replicad-opencascadejs, measured
// live, never a hardcoded number) and on brep-rs -- and compared. OCCT is the
// referee, not a dependency: brep-rs never links it.
//
// MEASURED OUR OWN WAY, NOT THROUGH occt-build.ts's measureShape(). That
// helper pads the bounding box (BRepBndLib.Add includes OCCT's tolerance gap)
// and rounds volume to 1e-4, so a CORRECT tight kernel would fail at 1e-6 for
// reasons that are OCCT's, not ours. Here: VolumeProperties at 1e-7,
// unrounded, and BRepBndLib.AddOptimal for a tight box.
//
// USAGE
//   npm run build                       (root; the gate reads packages/*/dist.
//                                        NOT --workspaces: sandbox-dev has no
//                                        build script and exits non-zero)
//   node scripts/brep-parity-gate.mjs                    all fixtures
//   node scripts/brep-parity-gate.mjs --kind fillet      one kind
//   node scripts/brep-parity-gate.mjs --reference-only   validate fixtures on OCCT only
//   node scripts/brep-parity-gate.mjs --size-target <gzipped bytes>
//
// EXIT 0 only when every selected fixture passes (and the size target, if
// given, is met). A refusal from brep-rs where OCCT built the feature is a FAIL.

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtures } from './brep-parity-fixtures.mjs';

const TOL = { tight: 1e-6, approx: 1e-4 };

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
const REFERENCE_ONLY = args.includes('--reference-only');
const KIND = arg('--kind');
const SIZE_TARGET = arg('--size-target') ? Number(arg('--size-target')) : undefined;

// --- OCCT, the referee -------------------------------------------------------
const OCCT_DIR = process.env.RESHAPE_KERNEL_DIR
  ?? path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
if (!existsSync(path.join(OCCT_DIR, 'replicad_single.wasm'))) {
  console.error(`FAIL: no OpenCascade kernel at ${OCCT_DIR}. Run npm install at the repo root.`);
  process.exit(1);
}
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/kernel/dist/occt-build.js');
const { resolveName, facesOf } = await load('packages/kernel/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');

function occtMeasure(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin();
  const hi = box.CornerMax();
  return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]] };
}

function occtResolve(name, build) {
  const part = resolveName(oc, name, build);
  if (!part) return null;
  const g = new oc.GProp_GProps();
  const c = () => { const p = g.CentreOfMass(); return [p.X(), p.Y(), p.Z()]; };
  if (name.kind === 'edge') {
    oc.BRepGProp.LinearProperties(part, g, false, false);
    return { kind: 'edge', length: g.Mass(), centroid: c() };
  }
  oc.BRepGProp.SurfaceProperties(part, g, false, false);
  return { kind: 'face', area: g.Mass(), centroid: c() };
}

// --- brep-rs, the kernel under test ------------------------------------------
const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const WASM = path.join(PKG, 'brep_rs_bg.wasm');
let brep = null;
if (!REFERENCE_ONLY && existsSync(WASM)) {
  brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
  brep.initSync({ module: readFileSync(WASM) });
  console.log(`brep-rs ${brep.version()}  ${readFileSync(WASM).length} bytes raw, ${gzipSync(readFileSync(WASM), { level: 9 }).length} bytes gzipped`);
} else if (!REFERENCE_ONLY) {
  console.log(`brep-rs NOT BUILT (no ${path.relative(REPO, WASM)}) -- every fixture fails until it exists`);
}
console.log(REFERENCE_ONLY ? 'mode: reference-only (validating fixtures on OCCT)\n' : '');

// --- compare -----------------------------------------------------------------
/** Largest relative delta across paired numbers; scale floor of 1 keeps
 *  coordinates near zero from dividing by ~0. */
function worst(pairs) {
  let max = 0; let where = '';
  for (const [label, got, want] of pairs) {
    const d = (typeof got === 'number' && Number.isFinite(got))
      ? Math.abs(got - want) / Math.max(Math.abs(want), 1)
      : Infinity;
    if (d > max) { max = d; where = label; }
  }
  return { max, where };
}

const flat = (b) => [b[0][0], b[0][1], b[0][2], b[1][0], b[1][1], b[1][2]];

let pass = 0;
let fail = 0;
const byKind = new Map();
const tally = (kind, ok) => {
  const t = byKind.get(kind) ?? { pass: 0, fail: 0 };
  ok ? t.pass++ : t.fail++;
  byKind.set(kind, t);
  ok ? pass++ : fail++;
};

for (const fx of fixtures().filter((f) => !KIND || f.kind === KIND)) {
  const tol = TOL[fx.tol];
  let doc; let measureId;
  let ref; let refName = null; let refShape = null;
  try {
    const d = fx.doc(mt);
    doc = { version: 1, features: d.features };
    measureId = fx.measure ?? d.measure;
    const built = buildDoc(oc, doc, arc);
    const refusal = built.refusals?.get?.(measureId);
    const shape = built.shapes.get(measureId);
    if (refusal || !shape) throw new Error(refusal ? `OCCT refused: ${refusal}` : 'OCCT built nothing');
    ref = occtMeasure(shape);
    refShape = shape;
    if (fx.resolve) {
      refName = occtResolve(fx.resolve, built);
      if (!refName) throw new Error('OCCT could not resolve the fixture name');
    }
  } catch (e) {
    console.log(`INVALID ${fx.id} [${fx.kind}]: ${e.message} -- the FIXTURE is broken, not the kernel`);
    tally(fx.kind, false);
    continue;
  }

  if (REFERENCE_ONLY) {
    console.log(`OK      ${fx.id} [${fx.kind}] volume=${ref.volume.toFixed(6)} faces=${facesOf(oc, refShape).length}${refName ? ` resolves ${refName.kind}` : ''}`);
    tally(fx.kind, true);
    continue;
  }
  if (!brep) { console.log(`FAIL    ${fx.id} [${fx.kind}]: brep-rs not built`); tally(fx.kind, false); continue; }

  let got; let gotName = null;
  try {
    got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    if (fx.resolve) gotName = JSON.parse(brep.resolve(JSON.stringify(doc), JSON.stringify(fx.resolve)));
  } catch (e) {
    console.log(`FAIL    ${fx.id} [${fx.kind}]: brep-rs threw ${e && e.message ? e.message : String(e)}`);
    tally(fx.kind, false);
    continue;
  }

  const refusal = got.refusals?.[measureId];
  const mine = got.shapes?.[measureId];
  if (refusal || !mine) {
    console.log(`FAIL    ${fx.id} [${fx.kind}]: ${refusal ? `refused -- ${refusal}` : 'no shape'} (OCCT built it)`);
    tally(fx.kind, false);
    continue;
  }

  // REAL B-REP, NOT FACETED. Added 2026-09-15 after dispatch 6 passed every
  // combine fixture with circles sampled into 8192-sided polygons: volume and
  // bbox agreed to ~1e-8, well inside 1e-6, while the "cylinder" wall was
  // thousands of flat faces. A face-count bound catches that without demanding
  // the exact same topology as OCCT (a kernel may legitimately split a seam):
  // more than 2x OCCT's faces plus 4 fails.
  const occtFaces = facesOf(oc, refShape).length;
  if (typeof mine.faces !== 'number') {
    console.log(`FAIL    ${fx.id} [${fx.kind}]: measure_doc returned no "faces" count (SPEC 4.7)`);
    tally(fx.kind, false);
    continue;
  }
  if (mine.faces > 2 * occtFaces + 4) {
    console.log(`FAIL    ${fx.id} [${fx.kind}]: ${mine.faces} faces vs OCCT ${occtFaces} -- faceted, not real B-rep (bound 2x+4)`);
    tally(fx.kind, false);
    continue;
  }

  const pairs = [['volume', mine.volume, ref.volume]];
  flat(ref.bbox).forEach((w, i) => pairs.push([`bbox[${i}]`, flat(mine.bbox ?? [[], []])[i], w]));
  if (fx.resolve) {
    if (!gotName || gotName.kind !== refName.kind) {
      console.log(`FAIL    ${fx.id} [${fx.kind}]: name ${gotName ? `resolved to a ${gotName.kind}` : 'did not resolve'} (OCCT: ${refName.kind})`);
      tally(fx.kind, false);
      continue;
    }
    const size = refName.kind === 'edge' ? 'length' : 'area';
    pairs.push([size, gotName[size], refName[size]]);
    refName.centroid.forEach((w, i) => pairs.push([`centroid[${i}]`, (gotName.centroid ?? [])[i], w]));
  }

  const { max, where } = worst(pairs);
  const ok = max <= tol;
  // Delta printed on PASS too: tightening a tolerance later is only safe if the
  // headroom is visible first (SPEC §8 decision 2).
  console.log(`${ok ? 'PASS' : 'FAIL'}    ${fx.id} [${fx.kind}] worst rel delta ${max.toExponential(2)} on ${where} (tol ${tol})`);
  tally(fx.kind, ok);
}

console.log('\nper kind:');
for (const [kind, t] of [...byKind.entries()].sort()) {
  console.log(`  ${kind.padEnd(10)} ${t.fail === 0 ? 'DONE' : 'open'}  ${t.pass} pass, ${t.fail} fail`);
}

let sizeOk = true;
if (SIZE_TARGET !== undefined && !REFERENCE_ONLY) {
  const gz = brep ? gzipSync(readFileSync(WASM), { level: 9 }).length : Infinity;
  sizeOk = gz < SIZE_TARGET;
  console.log(`\nsize: ${gz} bytes gzipped vs target < ${SIZE_TARGET} -- ${sizeOk ? 'PASS' : 'FAIL'}`);
}

console.log(`\nbrep-rs parity gate: ${pass} passed, ${fail} failed`);
// exitCode, not process.exit(): exiting hard while the OCCT/wasm async handles
// are still closing trips a libuv assertion on Windows (UV_HANDLE_CLOSING,
// src\win\async.c) and turns a PASS into exit 127 under Git Bash. Reported by
// the first brep-rs dispatch, 2026-09-15; the exit code IS the verdict here.
process.exitCode = fail === 0 && sizeOk ? 0 : 1;
