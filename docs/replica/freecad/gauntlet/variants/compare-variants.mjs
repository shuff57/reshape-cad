#!/usr/bin/env node
// Variant sweep scoreboard.  ONE command:   node compare-variants.mjs        (from this directory, real Node on PATH)
//
//   1. writes fc/<id>.py for every variant and runs them all in one headless FreeCAD (refs/ref-<id>.json)
//   2. builds every reSHape Script source on the real brep-rs kernel (solids) or solves the soup rows (sketches)
//   3. compares, classifies each non-MATCH from classifications.json, writes scoreboard.json and KERNEL-WORKLIST.md
//
//   --no-ref        reuse refs/*.json instead of re-running FreeCAD
//   --only=a,b      only variants whose id contains one of these substrings
//   --strict        exit 1 unless every variant is MATCH (default: exit 1 only for unclassified mismatches or errors)
//
// Statuses
//   MATCH     built; volume, bbox, faces, centre of mass agree with FreeCAD within tolerance (sketch: DoF, bucket, sets, bbox)
//   MISMATCH  built, a check is outside tolerance
//   REFUSED   the script layer or the kernel refused in a sentence (recorded); nothing is compared
//   REF-FAIL  FreeCAD could not build the reference
//   ERROR     our side crashed (a refusal without a sentence also lands here: it is a bug by itself)
// Tolerances: volume relative 1e-6, bbox absolute 1e-6, faces exact, centre of mass absolute 0.02 mm (ours comes from a
// tessellation at deflection 0.01, FreeCAD's is exact), mesh volume vs exact volume relative 5e-3 (self-consistency).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HERE, load, measureScript, measurePatched } from './lib.mjs';
import { VARIANTS } from './defs.mjs';
import { generateFc } from './gen-fc.mjs';
import { writeWorklist } from './worklist.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const TOL = { vol: 1e-6, bbox: 1e-6, com: 0.02, meshVol: 5e-3 };
const only = args.only ? String(args.only).split(',') : null;
const list = VARIANTS.filter((v) => !only || only.some((o) => v.id.includes(o)));

// ---- 1. references -----------------------------------------------------------------------------------------------------------------
generateFc();
if (!args['no-ref']) {
  for (const f of readdirSync(path.join(HERE, 'refs'))) if (f.endsWith('.json')) rmSync(path.join(HERE, 'refs', f)); // no stale reference can survive a run
  const fcRoot = path.join(os.homedir(), 'Applications/freecad-rc/squashfs-root');
  const r = spawnSync('./AppRun', ['freecadcmd', path.join(HERE, 'run-freecad.py')], { cwd: fcRoot, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });
  if (r.status !== 0 && !existsSync(path.join(HERE, 'refs'))) { console.error('FreeCAD failed:', r.stderr); process.exit(2); }
  console.log(`FreeCAD: reference run finished (exit ${r.status}), ${(r.stdout.match(/REFDONE/g) ?? []).length} references written`);
}
const readRef = (id) => { const f = path.join(HERE, 'refs', `ref-${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };

// ---- helpers --------------------------------------------------------------------------------------------------------------------------
const close = (a, b, t) => Math.abs(a - b) <= t;
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), Number.EPSILON);
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort((x, y) => x - y)) === JSON.stringify([...new Set(b)].sort((x, y) => x - y));
const round = (x) => (typeof x === 'number' ? +x.toPrecision(10) : Array.isArray(x) ? x.map(round) : x);

// ---- 2/3 solids ------------------------------------------------------------------------------------------------------------------------
function compareSolid(v, ref, ours) {
  const rec = { id: v.id, piece: v.piece, desc: v.desc, kind: 'solid', oursSource: v.ours, status: null, checks: [] };
  rec.oursOutcome = ours.outcome;
  if (!ref || ref.ok === false) {
    const why = ref ? (ref.error ?? `FreeCAD recompute left ${JSON.stringify(ref.bad)}, valid=${ref.valid}, solids=${ref.solids}`) : 'no reference file';
    if (ref && (ours.outcome === 'script-error' || ours.outcome === 'refused')) { // both sides refuse: recorded, with both sentences
      rec.status = 'REFUSED'; rec.bothRefuse = true; rec.layer = ours.outcome === 'script-error' ? 'script' : 'kernel'; rec.sentence = ours.refusal; rec.note = `FreeCAD does not build it either: ${why}`;
      return rec;
    }
    rec.status = 'REF-FAIL'; rec.note = why; if (ours.outcome === 'built') rec.ours = { volume: ours.volume, bbox: ours.bbox, faces: ours.faces, com: ours.com };
    return rec;
  }
  rec.ref = { volume: ref.volume, bbox: ref.bbox, faces: ref.faces, com: ref.com };
  if (ours.outcome === 'script-error' || ours.outcome === 'refused') {
    rec.status = 'REFUSED'; rec.layer = ours.outcome === 'script-error' ? 'script' : 'kernel'; rec.sentence = ours.refusal;
    return rec;
  }
  if (ours.outcome !== 'built') { rec.status = 'ERROR'; rec.note = ours.refusal ?? 'unknown'; return rec; }
  rec.ours = { volume: ours.volume, bbox: ours.bbox, faces: ours.faces, com: ours.com, meshVolume: ours.meshVolume };
  const ck = (name, r, o, pass, delta) => rec.checks.push({ name, ref: round(r), ours: round(o), pass, delta });
  ck('volume (rel 1e-6)', ref.volume, ours.volume, rel(ours.volume, ref.volume) <= TOL.vol, rel(ours.volume, ref.volume));
  const bd = Math.max(...ref.bbox.map((x, i) => Math.abs(x - ours.bbox[i])));
  ck('bbox (abs 1e-6)', ref.bbox, ours.bbox, bd <= TOL.bbox, bd);
  ck('faces (exact)', ref.faces, ours.faces, ref.faces === ours.faces);
  if (ref.com && ours.com) {
    const cd = Math.max(...ref.com.map((x, i) => Math.abs(x - ours.com[i])));
    ck('centre of mass (abs 0.02)', ref.com, ours.com, cd <= TOL.com, cd);
  }
  ck('own mesh volume vs exact volume (rel 5e-3)', ours.volume, ours.meshVolume, rel(ours.meshVolume, ours.volume) <= TOL.meshVol, rel(ours.meshVolume, ours.volume));
  rec.status = rec.checks.every((c) => c.pass) ? 'MATCH' : 'MISMATCH';
  return rec;
}

// ---- 2/3 sketches ----------------------------------------------------------------------------------------------------------------------
function geomBox(g) {
  const pts = [];
  for (const s of g) {
    if (s.k === 'line') pts.push(s.a, s.b);
    else if (s.k === 'circle') { pts.push([s.c[0] - s.r, s.c[1] - s.r], [s.c[0] + s.r, s.c[1] + s.r]); }
    else if (s.k === 'arc') {
      const ang = (p) => Math.atan2(p[1] - s.c[1], p[0] - s.c[0]);
      let a0 = ang(s.sense === 'cw' ? s.b : s.a), a1 = ang(s.sense === 'cw' ? s.a : s.b); // CCW from a0 to a1
      while (a1 < a0) a1 += 2 * Math.PI;
      pts.push(s.a, s.b);
      for (let q = 0; q < 8; q++) { const t = (q * Math.PI) / 2; for (const tt of [t, t + 2 * Math.PI]) if (tt > a0 && tt < a1) pts.push([s.c[0] + s.r * Math.cos(tt), s.c[1] + s.r * Math.sin(tt)]); }
    }
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

async function oursSketch(v) {
  const { SketchSession2D, brep } = await load();
  const run = (rows) => {
    const s = new SketchSession2D(); s.loadFromBytes(brep);
    const o = { openRefusal: s.open(v.oursGeom, rows) };
    if (!o.openRefusal) { o.solved = s.solve(); o.lastError = o.solved ? null : s.lastError(); o.diag = s.diagnose(); if (o.solved) { try { o.geoms = s.solvedGeoms(); } catch { /* none */ } } }
    s.close();
    return o;
  };
  const main = run(v.oursRules);
  if (main.openRefusal) return { outcome: 'refused', refusal: String(main.openRefusal) };
  if (!main.diag) return { outcome: 'refused', refusal: String(main.lastError ?? 'the solver gave no diagnosis') }; // solve failed with no diagnosis: the sentence is the solver's own
  const o = { outcome: 'built', solved: main.solved, lastError: main.lastError, dof: main.diag?.dof ?? null, bucket: main.diag?.bucket ?? null, nativeBlameRows: main.diag?.blame ?? [] };
  o.nativeBlame = [...new Set(o.nativeBlameRows.map((i) => v.oursMap[i]))].sort((a, b) => a - b);
  o.conflicting = []; o.leaveOneOut = false;
  if (o.bucket === 'conflicting') { // FreeCAD names the whole contradicting set; the solver names one row. Leave-one-out gives the like-for-like set.
    o.leaveOneOut = true;
    const n = v.spec.rules.length;
    for (let i = 0; i < n; i++) { const rows = v.oursRules.filter((_, j) => v.oursMap[j] !== i); const r = run(rows); if (!r.openRefusal && r.diag?.bucket !== 'conflicting') o.conflicting.push(i); }
  }
  o.redundant = o.bucket === 'redundant' ? o.nativeBlame : [];
  o.bbox = main.geoms ? geomBox(main.geoms) : null;
  return o;
}

function compareSketch(v, ref, ours) {
  const rec = { id: v.id, piece: v.piece, desc: v.desc, kind: 'sketch', status: null, checks: [], oursRules: v.spec.rules.length };
  if (!ref || ref.ok === false) { rec.status = 'REF-FAIL'; rec.note = ref?.error ?? 'no reference file'; return rec; }
  const toNeutral = (l) => [...new Set((l ?? []).map((i) => v.fcMap[i - 1]))].sort((a, b) => a - b); // FreeCAD lists are 1-based
  const fc = { dof: ref.dof, conflicting: toNeutral(ref.conflicting), redundant: toNeutral(ref.redundant), solve: ref.solve };
  fc.bucket = fc.conflicting.length ? 'conflicting' : fc.redundant.length ? 'redundant' : 'consistent';
  rec.ref = { ...fc, bbox: ref.bbox };
  if (ours.outcome !== 'built') { rec.status = 'REFUSED'; rec.layer = 'kernel'; rec.sentence = ours.refusal; return rec; }
  rec.ours = { dof: ours.dof, bucket: ours.bucket, conflicting: ours.conflicting, nativeBlame: ours.nativeBlame, redundant: ours.redundant, solved: ours.solved, bbox: ours.bbox };
  const ck = (name, r, o, pass) => rec.checks.push({ name, ref: round(r), ours: round(o), pass });
  const oursBucket = ours.bucket === 'consistent' ? 'consistent' : ours.bucket;
  ck('bucket (consistent / redundant / conflicting)', fc.bucket, oursBucket, fc.bucket === oursBucket);
  if (fc.bucket === 'consistent' && oursBucket === 'consistent') ck('degrees of freedom', fc.dof, ours.dof, fc.dof === ours.dof);
  if (fc.bucket === 'conflicting' || oursBucket === 'conflicting') ck('conflicting rules (neutral index, FreeCAD set vs leave-one-out)', fc.conflicting, ours.conflicting, sameSet(fc.conflicting, ours.conflicting));
  if (fc.bucket === 'redundant' || oursBucket === 'redundant') ck('redundant rules (neutral index)', fc.redundant, ours.redundant, sameSet(fc.redundant, ours.redundant));
  if (fc.bucket === 'consistent' && fc.dof === 0 && ours.bbox && ref.bbox) {
    const rb = [ref.bbox[0], ref.bbox[1], ref.bbox[3], ref.bbox[4]];
    const d = Math.max(...rb.map((x, i) => Math.abs(x - ours.bbox[i])));
    ck('solved geometry bbox in plane (abs 1e-6)', rb, ours.bbox, d <= TOL.bbox);
  }
  rec.status = rec.checks.every((c) => c.pass) ? 'MATCH' : 'MISMATCH';
  if (ours.nativeBlame?.length && ours.leaveOneOut && !sameSet(ours.nativeBlame, ours.conflicting)) rec.note = `brep-rs diagnose().blame names ${JSON.stringify(ours.nativeBlame)} (one row); FreeCAD names the whole set ${JSON.stringify(fc.conflicting)}`;
  return rec;
}

// ---- driver ---------------------------------------------------------------------------------------------------------------------------
const classes = existsSync(path.join(HERE, 'classifications.json')) ? JSON.parse(readFileSync(path.join(HERE, 'classifications.json'), 'utf8')) : {};
const pieces = [];
for (const v of list) {
  const ref = readRef(v.id);
  let rec;
  try {
    rec = v.kind === 'sketch' ? compareSketch(v, ref, await oursSketch(v)) : compareSolid(v, ref, v.patch ? await measurePatched(v.ours, v.patch.kind, v.patch.set) : await measureScript(v.ours));
  } catch (e) { rec = { id: v.id, piece: v.piece, desc: v.desc, status: 'ERROR', note: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
  const c = classes[v.id];
  if (rec.status !== 'MATCH') {
    if (c) rec.classification = c; else if (!rec.bothRefuse) rec.classification = null; // both sides refusing is agreement, not a mismatch
  } else if (c) rec.staleClassification = c; // a classified variant that now matches: the entry should be deleted
  pieces.push(rec);
  process.stdout.write(`${rec.status === 'MATCH' ? '.' : rec.status[0]}`);
}
console.log('');

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('variant', 46)}${pad('status', 10)}${pad('class', 20)}detail`);
console.log('-'.repeat(130));
for (const p of pieces) {
  const bad = (p.checks ?? []).filter((c) => !c.pass).map((c) => `${c.name.split(' (')[0]}: ref ${JSON.stringify(c.ref)} vs ours ${JSON.stringify(c.ours)}`).join('; ');
  const detail = p.status === 'MATCH' ? `${p.checks.length} checks ok` : p.status === 'REFUSED' ? `[${p.layer}] ${p.sentence}` : p.status === 'MISMATCH' ? bad : p.note ?? '';
  console.log(`${pad(p.id, 46)}${pad(p.status, 10)}${pad(p.status === 'MATCH' ? '' : p.bothRefuse ? 'agrees (both refuse)' : p.classification?.class ?? 'UNCLASSIFIED', 20)}${String(detail).slice(0, 150)}`);
}
console.log('-'.repeat(130));
const tally = {}; for (const p of pieces) tally[p.status] = (tally[p.status] ?? 0) + 1;
const classTally = {}; for (const p of pieces) if (p.status !== 'MATCH') { const k = p.bothRefuse ? 'agrees-both-refuse' : p.classification?.class ?? 'UNCLASSIFIED'; classTally[k] = (classTally[k] ?? 0) + 1; }
const perPiece = {}; for (const p of pieces) { perPiece[p.piece] ??= { total: 0, MATCH: 0 }; perPiece[p.piece].total++; if (p.status === 'MATCH') perPiece[p.piece].MATCH++; }
console.log(`variants ${pieces.length}: ` + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('non-MATCH by class: ' + (Object.entries(classTally).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'));
const stale = pieces.filter((p) => p.staleClassification).map((p) => p.id);
if (stale.length) console.log('STALE classifications (now MATCH, delete them): ' + stale.join(', '));

const board = {
  generatedAt: new Date().toISOString(),
  reference: 'FreeCAD 26.3.0 RC1 headless (variants/fc/<id>.py -> variants/refs/ref-<id>.json)',
  ours: 'reSHape Script -> ModelDoc -> brep-rs wasm (solids) / SketchSession2D (sketches)',
  tolerances: { volumeRelative: TOL.vol, bboxAbsolute: TOL.bbox, faces: 'exact', centreOfMassAbsolute: TOL.com, meshVolumeRelative: TOL.meshVol },
  summary: { total: pieces.length, ...tally, byClass: classTally, unclassified: classTally.UNCLASSIFIED ?? 0, staleClassifications: stale },
  perPiece,
  variants: pieces,
};
writeFileSync(path.join(HERE, 'scoreboard.json'), JSON.stringify(board, null, 2) + '\n');
const kernelItems = await writeWorklist(board);
console.log(`wrote ${path.join(HERE, 'scoreboard.json')}, ../KERNEL-WORKLIST.md (${kernelItems} kernel entries) and kernel-gaps/`);
const bad = (classTally.UNCLASSIFIED ?? 0) + (tally.ERROR ?? 0) + (tally['REF-FAIL'] ?? 0);
if (args.strict ? pieces.some((p) => p.status !== 'MATCH') : bad > 0) process.exit(1);
