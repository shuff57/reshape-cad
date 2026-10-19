#!/usr/bin/env node
// SPIKE, referee only. shell-draft group (hollow + draft), round 2.
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/shell-draft-runner.mjs [--only=id,id] [--group=g1,g2] [--out=<dir>]
//
// Every case is a reSHape Script text -> ModelDoc -> five measurements of the SAME part:
//   closed  an independent closed form (shell-draft-polytope.mjs, or a formula) -- no kernel involved
//   occt    live OCCT (replicad-opencascadejs) through occt-build.ts
//   brep    live brep-rs wasm (archive/brep-rs/pkg)
//   raw     SolidCraft (truck) through phase0/translate.mjs, UNGUARDED -- what the first-round contract shipped
//   guard   SolidCraft through shell-draft-translate.mjs, i.e. phase0 plus the guards -- what a student would get
// A case's reference is the closed form when there is one, else OCCT, else brep-rs. Outcome vocabulary (per translator):
//   OK/PASS      built and matches the reference (planar 1e-9, curved 3e-4, COM 1e-6 / 3e-5 of the bbox diagonal)
//   WRONG/FAIL   built and does NOT match the reference  (the dangerous one: silent, ok:true)
//   REFUSED      a sentence; guard run additionally checks the sentence is plain (no engine text)
//   NO-REF       built, but nothing independent to compare with
//   SHOULD-REFUSE the reference says the request has no valid result (wall collapses, a face would vanish) -- built = WRONG
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import * as B from './holes-base.mjs';
import { translateDocGuarded, draftFromUsage } from './shell-draft-translate.mjs';
import * as P from './shell-draft-polytope.mjs';
import { CASES_FN } from './shell-draft-cases.mjs';
import { STEEP_FN } from './shell-draft-cases-steep.mjs';
import { R2_FN } from './shell-draft-cases-r2.mjs';

const { oc, brep, buildDoc, arc, mt, solveDoc, runScript, runSC, occtMeasure, faceVerdict, rel, TOL, COM_TOL, COM_TOL_TESS, translateDoc } = B;
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const groups = arg('group').split(',').filter(Boolean);
const OUT = arg('out') ? path.resolve(arg('out')) : path.dirname(new URL(import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });

const JARGON = /solid\.|solidcraft|kernel|brep|truck|occt|\[\s*-?\d|invalid |parameters|offset:|boolean|wasm|panic|unreachable|`|undefined|NaN|implausible|planes don/i;
// plain = no engine jargon, ends with a full stop, and ONE sentence (no full stop followed by a new sentence; decimals like 12.5 do not count)
const oneSentence = (s) => !/[.!?]\s+[A-Za-z(]/.test(String(s).replace(/\d\.\d/g, '0'));
const isPlain = (s) => typeof s === 'string' && s.length > 20 && !JARGON.test(s) && /[.!]$/.test(s.trim()) && oneSentence(s);

const flat = (b) => [...b[0], ...b[1]];
const diagOf = (bb) => Math.max(Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]), 1);
const bboxRel = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));

/** compare a measured {volume, bbox?, com?} with a reference {volume, bbox?, com?}; curved picks the looser bar */
function compare(m, ref, curved, tolOverride) {
  const tol = tolOverride ?? (curved ? TOL.curved : TOL.planar);
  const out = { dVol: rel(m.volume, ref.volume) };
  if (ref.bbox && m.bbox) out.dBbox = bboxRel(m.bbox, ref.bbox);
  if (ref.com && m.com) {
    const dg = diagOf(ref.bbox ?? m.bbox);
    out.dCom = Math.max(...m.com.map((v, i) => Math.abs(v - ref.com[i]))) / dg;
  }
  const comTol = curved ? COM_TOL_TESS : COM_TOL;
  out.tol = tol;
  out.ok = out.dVol <= tol && (out.dBbox === undefined || out.dBbox <= tol) && (out.dCom === undefined || out.dCom <= comTol);
  return out;
}

const brepResolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };

const sigma = (() => {
  // the draft sign convention is the kernels' own; fix it from brep-rs on one fixed case and let every other case test it
  const rs = runScript(`const b = box(40, 30, 12, { at: [15, -7, 3] });\ndraft(b.face('right'), 8);`);
  const v = JSON.parse(brep.measure_doc(JSON.stringify(rs.doc))).shapes[rs.doc.features.at(-1).id].volume;
  const base = P.boxPlanes([-5, -22, -3], [35, 8, 9]);
  const mk = (s) => { const q = [...base]; q[0] = P.draftPlane(base[0], 'z', 0, 8, s); return P.measure(q).volume; };
  return Math.abs(mk(1) - v) < Math.abs(mk(-1) - v) ? 1 : -1;
})();

const env = { P, sigma, rel };
const CASES = [...CASES_FN(env), ...STEEP_FN(env), ...R2_FN(env)];

function measureOcct(doc, id) {
  try {
    const built = buildDoc(oc, doc, arc);
    const refusals = Object.fromEntries(built.refusals ?? []);
    const shape = built.shapes.get(id);
    if (!shape || refusals[id] || Object.keys(refusals).length) return { refused: Object.values(refusals).join(' | ') || 'OCCT built nothing' };
    return occtMeasure(shape);
  } catch (e) { return { refused: `OCCT threw: ${e.message}` }; }
}
function measureBrep(doc, id) {
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const s = got.shapes?.[id]; const ref = got.refusals ?? {};
    if (s && !Object.keys(ref).length) return { volume: s.volume, bbox: flat(s.bbox), faces: s.faces };
    return { refused: Object.values(ref).join(' | ') || 'brep-rs built nothing' };
  } catch (e) { return { refused: `brep-rs threw: ${e.message}` }; }
}
const truckRow = (tr, id) => {
  const f = tr.features.find((x) => x.id === id);
  const first = tr.features.find((x) => x.status === 'refused');
  if (f?.status !== 'built') return { refused: f?.refusal ?? first?.refusal ?? `${id} was not built`, status: f?.status, guard: f?.guard, raw: f?.raw, unguarded: f?.unguarded, chainRefusal: first?.refusal };
  const m = f.measure;
  return { volume: m.volume, faces: m.faces, bbox: m.bbox, com: m.com, curved: m.curved, faceTypes: m.faceTypes, bodies: m.bodies.length, pick: f.pick, variantsTried: f.variantsTried };
};

function doCase(c) {
  const row = { id: c.id, group: c.group, feature: c.feature, script: c.script, note: c.note };
  const rs = runScript(c.script);
  if (rs.errors.length) {
    // script-layer messages (packages/script, read-only here) may hold two sentences; the contract shows ONE: the second is joined with a dash
    row.scriptRefusalVerbatim = rs.errors[0].message;
    row.scriptRefusal = String(rs.errors[0].message).replace(/\.\s+([A-Z])/g, (m, c) => ` -- ${c.toLowerCase()}`);
    row.outcome = 'SCRIPT-REFUSED'; row.plain = isPlain(row.scriptRefusal); return row;
  }
  const doc0 = rs.doc; if (c.patch) c.patch(doc0); const id = doc0.features.at(-1).id;
  row.doc = doc0.features.map((f) => (f.kind === 'sketch' ? { id: f.id, kind: 'sketch', plane: f.plane, points: f.points, shape: f.shape } : f));
  row.measureId = id;
  row.occt = measureOcct(doc0, id);
  row.brep = measureBrep(doc0, id);
  if (c.expect) { try { row.closed = c.expect(); } catch (e) { row.closedError = e.message; } }
  if (c.extraRef) { try { row.extraRef = c.extraRef(); } catch (e) { row.extraRefError = e.message; } }
  if (c.note) row.note = c.note;
  const solved = solveDoc(doc0);
  const ctx = { arc, mt, runSC, resolveAt: brepResolveAt };
  row.raw = truckRow(translateDoc(solved, ctx), id);
  row.guard = truckRow(translateDocGuarded(solved, ctx, { fromUsage: draftFromUsage(c.script), off: (process.env.SD_OFF ?? '').split(',').filter(Boolean) }), id);
  // reference
  let ref = null, refKind = null;
  if (row.closed && !row.closed.collapse && !row.closed.vanish) { ref = row.closed; refKind = 'closed'; }
  else if (!row.closed && !row.occt.refused) { ref = row.occt; refKind = 'occt'; }
  else if (!row.closed && !row.brep.refused) { ref = row.brep; refKind = 'brep'; }
  row.refKind = refKind ?? (row.closed?.collapse ? 'closed:collapse' : row.closed?.vanish ? 'closed:vanish' : null);
  const amb = !!row.closed?.ambiguous; // two faces tie for the word: no single right answer; the raw run is compared with OCCT's pick
  if (amb) { ref = !row.occt.refused ? row.occt : null; refKind = ref ? 'occt(tie)' : null; row.refKind = refKind; }
  const should = !!(row.closed?.collapse || row.closed?.vanish || c.shouldRefuse);
  const judge = (t, isGuard) => {
    if (t.refused) return { v: 'REFUSED', plain: isPlain(t.refused) };
    if (should || (amb && isGuard)) return { v: 'WRONG', why: amb && !should ? 'built, but the word names two faces equally' : 'built, but the request has no valid result' };
    if (!ref) return { v: 'NO-REF' };
    // OCCT's planar volumes carry quadrature error (measured up to 3.7e-9 on regular 7-12 sided prisms), so against OCCT as the reference the planar bar is 1e-8; closed forms keep 1e-9
    const cmp = compare(t, ref, t.curved, !t.curved && refKind?.startsWith('occt') ? 1e-8 : undefined);
    return { v: cmp.ok ? 'OK' : 'WRONG', cmp };
  };
  row.rawVerdict = judge(row.raw, false);
  row.guardVerdict = judge(row.guard, true);
  if (row.guardVerdict.v === 'OK') {
    row.guardVerdict.v = 'PASS';
    // face verdict against OCCT only when OCCT agrees with the reference on volume
    if (!row.occt.refused && ref) {
      const agree = rel(row.occt.volume, ref.volume) <= (row.guard.curved ? TOL.curved : TOL.planar);
      row.occtAgrees = agree;
      if (agree && row.guard.faceTypes) { const fv = faceVerdict(row.guard.faceTypes, row.occt); row.guardVerdict.faceOk = fv.ok; row.guardVerdict.faceKeys = fv.keys; row.guardVerdict.occtFaces = row.occt.faces; }
    }
  }
  if (row.guardVerdict.v === 'WRONG') row.guardVerdict.v = 'FAIL';
  // the other engines against the reference
  const cmpOther = (o) => (o.refused ? 'refused' : ref ? (compare(o, ref, row.guard.curved ?? row.raw.curved ?? false, !(row.guard.curved ?? row.raw.curved) && refKind?.startsWith('occt') ? 1e-8 : undefined).ok ? 'agrees' : 'differs') : '-');
  row.occtVsRef = cmpOther(row.occt); row.brepVsRef = cmpOther(row.brep);
  if (!row.occt.refused && ref && refKind === 'closed') row.occtVsRefD = rel(row.occt.volume, ref.volume);
  if (!row.brep.refused && ref && refKind === 'closed') row.brepVsRefD = rel(row.brep.volume, ref.volume);
  // pick sensitivity: how far the reference moves if the OTHER face were picked
  if (c.expectAlt) { try { const a = c.expectAlt(); row.altCom = a.com; if (ref?.com) row.pickSensitivity = Math.max(...a.com.map((v, i) => Math.abs(v - ref.com[i]))) / diagOf(ref.bbox); row.altVolume = a.volume; } catch { /* none */ } }
  row.outcome = `${row.rawVerdict.v}->${row.guardVerdict.v}`;
  return row;
}

const f4 = (v) => (typeof v === 'number' ? v.toFixed(4) : '-');
const e1 = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
const lines = []; const rows = [];
for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue;
  if (groups.length && !groups.includes(c.group)) continue;
  let r; try { r = doCase(c); } catch (e) { r = { id: c.id, group: c.group, feature: c.feature, script: c.script, outcome: 'RUNNER-ERROR', error: String(e.stack).split('\n').slice(0, 4).join(' | ') }; }
  rows.push(r);
  const ref = r.refKind ?? '-';
  const g = r.guard ?? {}; const w = r.raw ?? {};
  const s = [r.id.padEnd(44), String(r.outcome).padEnd(18), `ref=${ref}`.padEnd(14),
    'closed', f4(r.closed?.volume).padStart(11), 'occt', (r.occt?.refused ? 'REFUSED' : f4(r.occt?.volume)).padStart(11), 'brep', (r.brep?.refused ? 'REFUSED' : f4(r.brep?.volume)).padStart(11),
    'raw', (w.refused ? 'REFUSED' : f4(w.volume)).padStart(11), 'guard', (g.refused ? 'REFUSED' : f4(g.volume)).padStart(11),
    'dVol', e1(r.guardVerdict?.cmp?.dVol), 'dCom', e1(r.guardVerdict?.cmp?.dCom),
    g.refused ? ` -- ${g.refused}` : '', r.scriptRefusal ? ` -- SCRIPT: ${r.scriptRefusal}` : '', r.error ? ` -- ${r.error}` : ''].join(' ');
  lines.push(s); console.log(s);
}
writeFileSync(path.join(OUT, only.length || groups.length ? 'shell-draft-runs.partial.json' : 'shell-draft-runs.json'), JSON.stringify({ sigma, rows }, null, 1));
if (!only.length && !groups.length) writeFileSync(path.join(OUT, 'shell-draft-last-run.txt'), lines.join('\n') + '\n');
const bad = rows.filter((r) => r.guardVerdict?.v === 'FAIL' || r.outcome === 'RUNNER-ERROR' || (r.guardVerdict?.v === 'REFUSED' && !r.guardVerdict.plain));
console.log(`cases ${rows.length}; guarded FAIL or non-plain sentence or runner error: ${bad.length}${bad.length ? ' -> ' + bad.map((r) => r.id).join(', ') : ''}`);
process.exit(0);
