#!/usr/bin/env node
// STEP gate for packages/brep-rs's writer. LEAD-OWNED.
// docs/kernel-campaign.md W9a. The brep-rs builder must not edit this file.
//
// For every parity fixture, brep.export_step(docJson, featureId) writes a STEP
// file, OCCT reads that file back with its own STEPControl_Reader, and OCCT's
// measurement of what it read is compared against brep-rs's own measure_doc for
// the same feature:
//   - volume relative error <= 1e-6
//   - bbox absolute error <= 1e-6
//   - face count exact
//   - OCCT sees >= 1 solid and at least one shell per solid
//   - BRepCheck_Analyzer(shape, true, false, false).IsValid() is true
//
// The check is OCCT read-back, not a self round-trip, on purpose: a writer that
// only round-trips through its own reader proves nothing about the format; the
// file is only correct if a FOREIGN kernel agrees about the solid it describes.
//
// An export_step() that returns {error} is a REFUSAL, not a failure: refusing to
// write what it cannot represent exactly is the honest outcome. Refusals are
// grouped by reason in the summary.
//
//   node scripts/brep-step-gate.mjs               all fixtures
//   node scripts/brep-step-gate.mjs --kind box    one kind
//   node scripts/brep-step-gate.mjs --only cone   one fixture
//
// Exit code is the verdict (0 = zero failures; refusals do not fail the gate).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtures } from './brep-parity-fixtures.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
const KIND = arg('--kind');
const ONLY = arg('--only');

// Scratch dir outside the repo tree. (Do not lean on mkdirSync's return value:
// under bun it is undefined when the directory already exists.)
const OUT = path.join(tmpdir(), 'brep-step-gate');
mkdirSync(OUT, { recursive: true });

const OCCT_DIR = process.env.RESHAPE_KERNEL_DIR
  ?? path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const mt = await import(pathToFileURL(path.join(REPO, 'packages/script/dist/model-types.js')).href);

const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const WASM = path.join(PKG, 'brep_rs_bg.wasm');
if (!existsSync(WASM)) {
  console.log(`FAIL: brep-rs not built (no ${path.relative(REPO, WASM)})`);
  process.exitCode = 1;
} else {
  const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
  brep.initSync({ module: readFileSync(WASM) });
  if (typeof brep.export_step !== 'function') {
    console.log('FAIL: brep-rs exports no export_step() (kernel-campaign W9a)');
    process.exitCode = 1;
  } else {
    run(brep);
  }
}

/** OCCT reads a STEP file from disk and measures what it understood. */
function occtRead(file) {
  oc.FS.writeFile('/in.step', readFileSync(file));
  const reader = new oc.STEPControl_Reader();
  const status = reader.ReadFile('/in.step');
  if (String(status) !== 'IFSelect_RetDone' && status?.value !== 1) {
    const s = (status && status.constructor && status.constructor.name === 'Object') ? JSON.stringify(status) : String(status);
    if (!s.includes('RetDone')) return { error: 'ReadFile ' + s };
  }
  reader.TransferRoots(new oc.Message_ProgressRange());
  if (reader.NbShapes() < 1) return { error: 'no shape transferred' };
  const shape = reader.OneShape();
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  let faces = 0, solids = 0, shells = 0;
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces++;
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) solids++;
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) shells++;
  let valid = 'n/a';
  try {
    const an = new oc.BRepCheck_Analyzer(shape, true, false, false);
    valid = an.IsValid_2 ? an.IsValid_2() : an.IsValid();
  } catch { valid = 'threw'; }
  return {
    volume: g.Mass(),
    bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]],
    faces, solids, shells, valid,
  };
}

function run(brep) {
  let pass = 0, fail = 0, refused = 0;
  const failures = [];
  const refusals = [];
  const byKind = new Map();

  for (const fx of fixtures().filter((f) => (!KIND || f.kind === KIND) && (!ONLY || f.id === ONLY))) {
    const d0 = fx.doc(mt);
    const doc = { version: 1, features: d0.features };
    const id = fx.measure ?? d0.measure;
    const docJson = JSON.stringify(doc);
    const mine = JSON.parse(brep.measure_doc(docJson));
    const want = mine.shapes?.[id];
    if (!want) { console.log(`SKIP    ${fx.id} [${fx.kind}]: brep-rs built no ${id}`); continue; }

    const res = JSON.parse(brep.export_step(docJson, id));
    if (res.error) {
      refused++;
      refusals.push(`${fx.id}: ${res.error}`);
      console.log(`REFUSE  ${fx.id} [${fx.kind}] -- ${res.error}`);
      tallyKind(byKind, fx.kind, 'refused');
      continue;
    }

    const file = path.join(OUT, `${fx.id}.step`);
    writeFileSync(file, res.step);
    const got = occtRead(file);
    if (got.error) {
      fail++; failures.push(`${fx.id}: OCCT ${got.error}`);
      console.log(`FAIL    ${fx.id} [${fx.kind}] -- OCCT ${got.error}`);
      tallyKind(byKind, fx.kind, false);
      continue;
    }
    const dv = Math.abs(got.volume - want.volume) / Math.max(1, Math.abs(want.volume));
    const db = Math.max(...want.bbox.flat().map((w, i) => Math.abs(got.bbox.flat()[i] - w)));
    const okV = dv <= 1e-6, okB = db <= 1e-6, okF = got.faces === want.faces;
    // Not every solid is one shell or one body: `pattern` leaves disjoint
    // copies, a pocket leaves an enclosed cavity. What must hold is that OCCT
    // calls the shape valid and measures it the way the kernel did.
    const okS = got.solids >= 1 && got.shells >= got.solids;
    const okValid = got.valid === true;
    if (okV && okB && okF && okS && okValid) {
      pass++;
      console.log(`PASS    ${fx.id.padEnd(34)} [${fx.kind}] vol ${got.volume.toFixed(6)}  faces ${got.faces}  solids ${got.solids} shells ${got.shells}`);
      tallyKind(byKind, fx.kind, true);
    } else {
      fail++;
      const why = [
        okV ? null : `volume ${got.volume.toFixed(6)} vs ${want.volume.toFixed(6)} (rel ${dv.toExponential(2)})`,
        okB ? null : `bbox off by ${db.toExponential(2)}`,
        okF ? null : `faces ${got.faces} vs ${want.faces}`,
        okS ? null : `solids ${got.solids} shells ${got.shells}`,
        okValid ? null : `BRepCheck ${got.valid}`,
      ].filter(Boolean).join('; ');
      failures.push(`${fx.id}: ${why}`);
      console.log(`FAIL    ${fx.id} [${fx.kind}] -- ${why}`);
      tallyKind(byKind, fx.kind, false);
    }
  }

  console.log('\nper kind:');
  for (const [kind, t] of [...byKind.entries()].sort()) {
    console.log(`  ${kind.padEnd(10)} ${t.fail === 0 ? 'DONE' : 'open'}  ${t.pass} pass, ${t.fail} fail, ${t.refused} refused`);
  }
  console.log(`\nbrep-rs STEP gate: ${pass} passed, ${fail} failed, ${refused} refused`);
  if (refusals.length) {
    console.log('\nrefused (honest, not written):');
    const byReason = new Map();
    for (const r of refusals) {
      const reason = r.slice(r.indexOf(': ') + 2);
      byReason.set(reason, (byReason.get(reason) ?? []).concat(r.slice(0, r.indexOf(': '))));
    }
    for (const [reason, ids] of byReason) console.log(`  ${ids.length}x ${reason}\n      ${ids.join(', ')}`);
  }
  if (failures.length) { console.log('\nfailures:'); for (const f of failures) console.log('  ' + f); }
  process.exitCode = fail === 0 ? 0 : 1;
}

function tallyKind(byKind, kind, outcome) {
  const t = byKind.get(kind) ?? { pass: 0, fail: 0, refused: 0 };
  if (outcome === 'refused') t.refused++;
  else if (outcome) t.pass++;
  else t.fail++;
  byKind.set(kind, t);
}