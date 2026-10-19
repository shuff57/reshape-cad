#!/usr/bin/env node
// ROUND 4 runner (holes4-cases.mjs through holes4-translate.mjs; every SolidCraft run is a child process under a CPU budget, holes4-sc.mjs). SPIKE, referee only. Contract group "holes": reSHape Script -> ModelDoc -> (a) live OCCT, (b) live brep-rs wasm,
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
import { CASES } from './holes4-cases.mjs';
import { translateDocGuarded, plainScriptError, lintSentence, ALL_GUARDS } from './holes4-translate.mjs';
import { runBudgeted } from './holes4-sc.mjs';
import { occtChain } from './holes4-oracle.mjs';

const { oc, brep, buildDoc, arc, mt, solveDoc, runScript, runSC, occtMeasure, faceVerdict2: faceVerdict, rel, worstArr, flat, translateDoc, REPO, OUT, only, TOL, COM_TOL, COM_TOL_TESS } = B;
const FC_REFS = path.join(REPO, 'docs/replica/freecad/gauntlet/variants/refs');
const fcRef = (id) => { try { return JSON.parse(readFileSync(path.join(FC_REFS, `ref-${id}.json`), 'utf8')); } catch { return null; } };

async function runCase(c) {
  const out = { id: c.id, row: c.row, script: c.script, note: c.note };
  let run;
  try { run = runScript(c.script); } catch (e) { out.scriptThrew = String(e.message ?? e); out.verdict = 'script-error'; return out; }
  if (run.errors?.length) { out.scriptErrors = run.errors.map((e) => e.message ?? String(e)); out.plainScriptErrors = out.scriptErrors.map((e) => plainScriptError(e, c.script)); out.lint = out.plainScriptErrors.map((e) => lintSentence(e)); out.verdict = 'script-error'; return out; }
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
    // ROUND 4: recess-aware OCCT oracle (holes4-oracle.mjs): the repo OCCT ignores counterbore/countersink
    try { const oc2 = occtChain(oc, built, doc0, measure); if (oc2) { out.occtChain = oc2.chain; if (oc2.hasRecess) out.occt2 = occtMeasure(oc2.shape); } } catch (e) { out.occt2 = { refused: `recess oracle threw: ${e.message}` }; }
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
    const cpu0 = process.cpuUsage();
    tr = translateDocGuarded(doc, { arc, mt, runSC: (cmds, o) => runBudgeted(cmds, o), resolveAt }, { off: (process.env.H4_OFF ?? '').split(',').filter(Boolean) });
    out.translateCpuMs = tr.spentS * 1000;
    const cpu1 = process.cpuUsage(cpu0);
    out.truckMs = Date.now() - tT;
    out.parentCpuMs = (cpu1.user + cpu1.system) / 1000;
    out.loadavg = (await import('node:os')).loadavg()[0];
  } catch (e) { out.truck = { refused: `translator threw: ${e.message}` }; out.verdict = 'translator-threw'; return out; }
  out.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, guard: f.guard, raw: f.raw, probe: f.probe, unguarded: f.unguarded }));
  out.lint = tr.features.filter((f) => f.refusal).map((f) => ({ id: f.id, problems: lintSentence(f.refusal) }));
  const mf = tr.features.find((f) => f.id === measure);
  const prevT = targetId ? tr.features.find((f) => f.id === targetId && f.measure) : null;
  if (prevT) out.truckPrevVolume = prevT.measure.volume;
  if (mf?.status !== 'built') {
    out.truck = { refused: mf?.refusal ?? `${measure} was not built`, guard: mf?.guard, raw: mf?.raw, unguarded: mf?.unguarded, firstRefusal: tr.features.find((f) => f.status === 'refused')?.refusal };
    out.verdict = 'truck-refused';
  } else {
    const m = mf.measure;
    out.truck = { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, kernelFaces: m.kernelFaces, shells: m.shells, faceTypes: m.faceTypes, curved: m.curved, bodies: m.bodies.length, bodyNames: m.bodies };
    // the translator keeps only the bodies it named; re-run the accepted commands and list EVERY body solidcraft holds
    try {
      const full = runBudgeted(tr.commands, { budgetS: 200 });
      out.finalCpuMs = full.cpuMs;
      if (full.timedOut) out.finalTimedOut = true;
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
    const o2 = out.occt2;
    if (o2 && o2.volume !== undefined) {
      const diag2 = Math.max(Math.hypot(o2.bbox[3] - o2.bbox[0], o2.bbox[4] - o2.bbox[1], o2.bbox[5] - o2.bbox[2]), 1);
      cmp.vsOcct2 = { dVol: rel(t.volume, o2.volume), dBbox: worstArr(t.bbox, o2.bbox), dCom: Math.max(...t.com.map((v, i) => Math.abs(v - o2.com[i]))) / diag2, faces: `${o2.faces}/${t.faces}`, solids: o2.solids, faceVerdict: faceVerdict(t.faceTypes, o2) };
      if (typeof out.truckPrevVolume === 'number' && typeof out.occtPrevVolume === 'number') { const ro = out.occtPrevVolume - o2.volume; const rt = out.truckPrevVolume - t.volume; cmp.vsOcct2.removedOcct = ro; cmp.vsOcct2.removedTruck = rt; cmp.vsOcct2.dRemoved = ro !== 0 ? Math.abs(rt - ro) / Math.abs(ro) : (rt === 0 ? 0 : Infinity); }
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


/** the same script with NO guard and NO budget (a kill at H4_CTL_S = 100 s of CPU so the control ends): what the guard layer prevents. A plain hole goes through the pristine phase-0
 *  translator (what shipped before any of this); counterbore / countersink are not mapped there at all, so a recess goes through the round-4 translator with EVERY guard off,
 *  i.e. the native solid.hole call as the layer would send it. Separate from runCase so a hang here cannot lose the guarded result. */
async function runUnguarded(c, out) {
  const run = runScript(c.script); const doc0 = run.doc; const measure = doc0.features.at(-1).id;
  const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
  const recess = doc0.features.some((f) => f.kind === 'hole' && (f.counterbore || f.countersink));
  try {
    let cpuU = 0; let timedOutU = false;
    const runU = (cmds) => { const r = runBudgeted(cmds, { budgetS: 1e9 }); cpuU += r.cpuMs ?? 0; if (r.timedOut) timedOutU = true; return r; };
    const t2 = recess
      ? translateDocGuarded(solveDoc(doc0), { arc, mt, runSC: runU, resolveAt }, { off: ALL_GUARDS })
      : translateDoc(solveDoc(doc0), { arc, mt, runSC: runU, resolveAt });
    const mf2 = t2.features.find((f) => f.id === measure);
    if (timedOutU) return { timeout: true, timeoutCpuSeconds: Number(process.env.H4_CTL_S ?? 100), cpuMs: cpuU, recessMapped: recess };
    if (mf2?.status === 'built') {
      const full2 = runBudgeted(t2.commands, { budgetS: 1e9 });
      const all2 = full2.ok ? full2.measure.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, shells: b.kernel?.shells })) : [];
      return { volume: mf2.measure.volume, faces: mf2.measure.faces, bbox: mf2.measure.bbox, reportedBodies: mf2.measure.bodies.length, allBodies: all2.length, allVolume: all2.reduce((a, b) => a + b.volume, 0), shells: all2.map((b) => b.shells), cpuMs: cpuU, recessMapped: recess };
    }
    return { refused: mf2?.refusal, recessMapped: recess };
  } catch (e) { return { threw: String(e.message) }; }
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
  if (c.unguarded && r.verdict === 'truck-refused') {
    console.log(`@@START2 ${c.id}`);
    const u = await runUnguarded(c, r);
    r.unguardedTruck = u;
    console.log(`@@EXTRA ${c.id} ${JSON.stringify(u)}`);
  }
}
if (!process.env.HOLES_DRIVER) { writeFileSync(path.join(OUT, 'holes4-results.json'), JSON.stringify(results, null, 1)); console.log(`wrote ${path.join(OUT, 'holes4-results.json')} (${results.length} cases)`); }
