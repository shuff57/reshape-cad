#!/usr/bin/env node
// SPIKE, referee only. Contract group "holes": reSHape Script -> ModelDoc -> (a) live OCCT, (b) live brep-rs wasm,
// (c) SolidCraft (truck) through the phase-0 translator, (d) a closed-form volume, (e) the saved FreeCAD ref when one exists.
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> bun contract/holes-run.mjs [--only=id,id] [--out=<dir>]
//
// holes-base.mjs is the oracle plumbing copied from phase0/run-phase0.mjs (OCCT measure, face-type classes, tolerances).
// brep-rs is read from archive/brep-rs/pkg (override: BREP_PKG). Read-only on everything but --out.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import * as B from './holes-base.mjs';
import { CASES } from './holes-cases.mjs';

const { oc, brep, buildDoc, arc, mt, solveDoc, runScript, runSC, occtMeasure, faceVerdict, rel, worstArr, flat, translateDoc, REPO, OUT, only, TOL, COM_TOL, COM_TOL_TESS } = B;
const FC_REFS = path.join(REPO, 'docs/replica/freecad/gauntlet/variants/refs');
const fcRef = (id) => { try { return JSON.parse(readFileSync(path.join(FC_REFS, `ref-${id}.json`), 'utf8')); } catch { return null; } };

async function runCase(c) {
  const out = { id: c.id, row: c.row, script: c.script, note: c.note };
  let run;
  try { run = runScript(c.script); } catch (e) { out.scriptThrew = String(e.message ?? e); out.verdict = 'script-error'; return out; }
  if (run.errors?.length) { out.scriptErrors = run.errors.map((e) => e.message ?? String(e)); out.verdict = 'script-error'; return out; }
  const doc0 = run.doc;
  const solids = doc0.features.filter((f) => !['sketch', 'datum'].includes(f.kind));
  const last = doc0.features.at(-1);
  const measure = last.id;
  out.featureKinds = doc0.features.map((f) => `${f.id}:${f.kind}`);
  out.lastFeature = last;
  const rootId = solids[0]?.id ?? null;
  const targetId = c.fromRoot ? rootId : (last.target ?? null);

  // ---- OCCT
  try {
    const built = buildDoc(oc, doc0, arc);
    const refusals = Object.fromEntries(built.refusals ?? []);
    const shape = built.shapes.get(measure);
    out.occtRefusals = refusals;
    if (Object.keys(refusals).length || !shape) out.occt = { refused: Object.values(refusals).join(' | ') || 'OCCT built nothing' };
    else out.occt = occtMeasure(shape);
    const prev = targetId && built.shapes.get(targetId);
    if (prev && out.occt.volume !== undefined) out.occtPrevVolume = occtMeasure(prev).volume;
  } catch (e) { out.occt = { refused: `OCCT threw: ${e.message}` }; }

  // ---- brep-rs
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc0)));
    const s = got.shapes?.[measure];
    out.brepRefusals = got.refusals ?? {};
    if (s && !Object.keys(got.refusals ?? {}).length) out.brep = { volume: s.volume, bbox: flat(s.bbox), faces: s.faces };
    else out.brep = { refused: Object.values(got.refusals ?? {}).join(' | ') || 'brep-rs built nothing' };
  } catch (e) { out.brep = { refused: `brep-rs threw: ${e.message}` }; }

  // ---- SolidCraft (truck) through the translator
  let tr;
  const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
  const tT = Date.now();
  try {
    const doc = solveDoc(doc0);
    tr = translateDoc(doc, { arc, mt, runSC, resolveAt });
    out.truckMs = Date.now() - tT;
    out.loadavg = (await import('node:os')).loadavg()[0];
  } catch (e) { out.truck = { refused: `translator threw: ${e.message}` }; out.verdict = 'translator-threw'; return out; }
  out.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal }));
  const mf = tr.features.find((f) => f.id === measure);
  const prevT = targetId ? tr.features.find((f) => f.id === targetId && f.measure) : null;
  if (prevT) out.truckPrevVolume = prevT.measure.volume;
  if (mf?.status !== 'built') {
    out.truck = { refused: mf?.refusal ?? `${measure} was not built`, firstRefusal: tr.features.find((f) => f.status === 'refused')?.refusal };
    out.verdict = 'truck-refused';
  } else {
    const m = mf.measure;
    out.truck = { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, kernelFaces: m.kernelFaces, faceTypes: m.faceTypes, curved: m.curved, bodies: m.bodies.length, bodyNames: m.bodies };
    // the translator keeps only the bodies it named; re-run the accepted commands and list EVERY body solidcraft holds
    try {
      const full = runSC(tr.commands);
      if (full.ok) {
        out.allBodies = full.measure.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, bbox: [...b.bbox.min, ...b.bbox.max] }));
        out.droppedBodies = out.allBodies.filter((b) => !m.bodies.includes(b.name));
      }
    } catch (e) { out.allBodiesError = String(e.message ?? e); }
    out.commands = mf.commands;
    out.verdict = 'truck-built';
  }

  // ---- FreeCAD ref + closed form
  if (c.fc) out.fc = fcRef(c.fc);
  if (typeof c.rem === 'number' && out.truckPrevVolume !== undefined) out.closed = { removed: c.rem, volume: out.truckPrevVolume - c.rem };
  if (typeof c.rem === 'number' && typeof out.occtPrevVolume === 'number') out.closedFromOcct = { volume: out.occtPrevVolume - c.rem };
  if (typeof c.vol === 'number') out.closed = { ...(out.closed ?? {}), volume: c.vol };

  // ---- comparisons (truck built only)
  if (out.verdict === 'truck-built') {
    const t = out.truck;
    const cmp = {};
    const oc_ = out.occt;
    if (oc_ && oc_.volume !== undefined) {
      const diag = Math.max(Math.hypot(oc_.bbox[3] - oc_.bbox[0], oc_.bbox[4] - oc_.bbox[1], oc_.bbox[5] - oc_.bbox[2]), 1);
      cmp.vsOcct = {
        dVol: rel(t.volume, oc_.volume), dBbox: worstArr(t.bbox, oc_.bbox),
        dCom: Math.max(...t.com.map((v, i) => Math.abs(v - oc_.com[i]))) / diag,
        faces: `${oc_.faces}/${t.faces}`, faceVerdict: faceVerdict(t.faceTypes, oc_),
      };
      if (typeof out.occtPrevVolume === 'number' && typeof out.truckPrevVolume === 'number') {
        const ro = out.occtPrevVolume - oc_.volume; const rt = out.truckPrevVolume - t.volume;
        cmp.vsOcct.removedOcct = ro; cmp.vsOcct.removedTruck = rt; cmp.vsOcct.dRemoved = ro !== 0 ? Math.abs(rt - ro) / Math.abs(ro) : (rt === 0 ? 0 : Infinity);
      }
    }
    if (out.brep && out.brep.volume !== undefined) cmp.vsBrep = { dVol: rel(t.volume, out.brep.volume), dBbox: worstArr(t.bbox, out.brep.bbox), faces: `${out.brep.faces}/${t.faces}` };
    if (out.closed && typeof out.closed.removed === 'number') {
      const rt = out.truckPrevVolume - t.volume;
      cmp.vsClosed = { removedClosed: out.closed.removed, removedTruck: rt, dRemoved: Math.abs(rt - out.closed.removed) / Math.max(Math.abs(out.closed.removed), 1e-12), dVol: rel(t.volume, out.closed.volume) };
    } else if (out.closed && typeof out.closed.volume === 'number') cmp.vsClosed = { dVol: rel(t.volume, out.closed.volume) };
    if (out.fc && out.fc.volume !== undefined) {
      cmp.vsFc = { dVol: rel(t.volume, out.fc.volume), dBbox: worstArr(t.bbox, out.fc.bbox), faces: `${out.fc.faces}/${t.faces}`, dCom: Math.max(...t.com.map((v, i) => Math.abs(v - out.fc.com[i]))) };
    }
    out.cmp = cmp;
  }
  return out;
}

const results = [];
for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue;
  console.log(`@@START ${c.id}`);
  const t0 = Date.now();
  const r = await runCase(c);
  r.ms = Date.now() - t0;
  results.push(r);
  const e = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  const tag = r.verdict === 'script-error' ? `SCRIPT-ERROR ${(r.scriptErrors ?? [r.scriptThrew])[0]}`
    : r.verdict === 'truck-refused' ? `TRUCK-REFUSED ${r.truck.refused} || occt:${r.occt?.refused ? 'refused' : 'built'} brep:${r.brep?.refused ? 'refused' : 'built'}`
      : `BUILT vsOcct dVol ${e(r.cmp?.vsOcct?.dVol)} dRem ${e(r.cmp?.vsOcct?.dRemoved)} dBbox ${e(r.cmp?.vsOcct?.dBbox)} dCom ${e(r.cmp?.vsOcct?.dCom)} faces(O/T) ${r.cmp?.vsOcct?.faces} | vsClosed dRem ${e(r.cmp?.vsClosed?.dRemoved)} dVol ${e(r.cmp?.vsClosed?.dVol)} | vsBrep ${e(r.cmp?.vsBrep?.dVol)} | vsFc ${e(r.cmp?.vsFc?.dVol)} bbox ${e(r.cmp?.vsFc?.dBbox)} | occt:${r.occt?.refused ? 'REFUSED ' + r.occt.refused : 'built'} brep:${r.brep?.refused ? 'REFUSED ' + r.brep.refused : 'built'}`;
  console.log(`${r.id.padEnd(44)} ${tag}`);
  console.log(`@@RESULT ${JSON.stringify(r)}`);
}
if (!process.env.HOLES_DRIVER) { writeFileSync(path.join(OUT, 'holes-results.json'), JSON.stringify(results, null, 1)); console.log(`wrote ${path.join(OUT, 'holes-results.json')} (${results.length} cases)`); }
