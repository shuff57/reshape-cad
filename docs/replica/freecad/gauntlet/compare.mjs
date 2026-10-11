#!/usr/bin/env node
// Gauntlet scoreboard: FreeCAD reference vs our stack (reSHape Script -> ModelDoc -> brep-rs wasm).
//
//   node compare.mjs                      re-run every baseline/ours-<id>.mjs, compare to baseline/ref-<id>.json
//   node compare.mjs --no-rerun           compare the ours-<id>.json already on disk (no script is run)
//   node compare.mjs --ours-dir=<dir>     take ours-<id>.mjs/.json from <dir> instead of baseline/ (refs stay in baseline/)
//   node compare.mjs --only=a,b           restrict to some ids
//   node compare.mjs --out=<file>         scoreboard path (default ./scoreboard.json)
//   node compare.mjs --strict             exit 1 unless every piece is MATCH (default exit 0 once the board is written)
//
// Statuses (a piece is MATCH only if ours outcome === 'built' AND every applicable check passes):
//   MATCH       built, all checks within tolerance
//   MISMATCH    built, at least one check outside tolerance (or a real difference we report instead of hiding)
//   NOT-BUILT   ours outcome is refused / not-expressible / error: never compared, never MATCH
//   INCOMPLETE  built, but ours does not report a field the reference has (so it cannot be called a match)
//   ERROR       the ours script crashed or wrote nothing; REF-MISSING: no reference file
//
// Tolerances: volume relative 1e-6, bbox absolute 1e-6 per coordinate, faces exact, DoF exact, index lists equal as sets.
//
// Frames. FreeCAD is Z-up. Our kernel axes are what a script's planes give (sketch('top') is the XY plane and
// extrudes along +Z, so those pieces already share FreeCAD's axes; a front-plane revolve ends up along world Y).
// An ours json says which it is with `frame`: 'y-up' means "map (x,y,z) -> (x,-z,y) before comparing", anything else
// (absent) means "already FreeCAD axes". The mapping is applied purely from that field; no piece id is looked at.
//
// Constraint indices. FreeCAD's Conflicting/Redundant lists are 1-based. Ours are 0-based rule indices. Everything is
// normalised to 0-based here (ref lists named *_1based or plain `conflicts`/`redundant` get -1; *_0based are used as is).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(HERE, 'baseline');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const OURS_DIR = args['ours-dir'] ? path.resolve(String(args['ours-dir'])) : BASE;
const OUT = args.out ? path.resolve(String(args.out)) : path.join(HERE, 'scoreboard.json');
const RERUN = !args['no-rerun'];
const TOL = { volumeRel: 1e-6, bboxAbs: 1e-6 };

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const arr6 = (b) => Array.isArray(b) && b.length === 6 && b.every(num);

// ---- frame mapping: ours (x,y,z) -> FreeCAD (x,-z,y); a box maps to the box of its two mapped corners ----------------
function mapYupToZup(b) {
  const lo = [b[0], -b[5], b[1]]; // (xmin, -zmax, ymin)
  const hi = [b[3], -b[2], b[4]]; // (xmax, -zmin, ymax)
  return [...lo, ...hi];
}

// ---- reference extraction ----------------------------------------------------------------------------------------
const idx0 = (l) => (Array.isArray(l) ? [...l].map(Number).sort((a, b) => a - b) : null);
const oneToZero = (l) => (Array.isArray(l) ? idx0(l.map((i) => i - 1)) : null);
function extractRef(ref) {
  const r = { kind: 'solid', volume: null, bbox: null, faces: null, dof: null, cases: null };
  if (ref.baseline && ref.conflict && ref.redundant) { // sk-conflict shape: three FreeCAD runs
    r.kind = 'sketch';
    const c = (o) => ({
      conflicting: o.conflicting_0based ? idx0(o.conflicting_0based) : oneToZero(o.conflicting_1based ?? o.conflicting ?? []),
      redundant: o.redundant_0based ? idx0(o.redundant_0based) : oneToZero(o.redundant_1based ?? o.redundant ?? []),
      dof: null,
    });
    r.cases = { baseline: c(ref.baseline), conflict: c(ref.conflict), redundant: c(ref.redundant) };
    return r;
  }
  r.volume = num(ref.volume) ? ref.volume : null;
  r.bbox = arr6(ref.bbox) ? ref.bbox : null;
  r.faces = num(ref.faces) ? ref.faces : null;
  const dof = ref.dof ?? ref.sketch_dof_attr ?? null;
  if (r.volume == null) { // a sketch piece: no solid, DoF + index lists are the measurement
    r.kind = 'sketch';
    r.cases = { main: { dof: num(dof) ? dof : null, conflicting: oneToZero(ref.conflicts ?? ref.conflicting ?? []), redundant: oneToZero(ref.redundant ?? []) } };
  }
  return r;
}

// ---- ours extraction -----------------------------------------------------------------------------------------------
function deriveOutcome(j) {
  if (typeof j.outcome === 'string') return j.outcome;
  const refusals = j.refusals && typeof j.refusals === 'object' ? Object.keys(j.refusals).length : 0;
  if (j.shapeBuilt === true && refusals === 0 && num(j.volume)) return 'built';
  return refusals ? 'refused' : 'error';
}
function extractOurs(j) {
  const s = j.std ?? {};
  const o = { outcome: s.outcome ?? deriveOutcome(j), frame: j.frame ?? s.frame ?? 'fc', refusal: null, bboxAxes: s.bboxAxes ?? [0, 1, 2], cases: s.cases ?? null };
  o.kind = s.kind ?? 'solid';
  o.volume = num(j.volume) ? j.volume : null;
  o.faces = num(j.faces) ? j.faces : null;
  o.bbox = arr6(s.bbox) ? s.bbox : arr6(j.bbox) ? j.bbox : null;
  if (o.outcome !== 'built') {
    o.refusal = j.refusal ?? (j.refusals ? Object.values(j.refusals).join(' | ') : null) ?? j.notes ?? null;
    if (!o.refusal) o.refusal = (j.notes ?? '').toString().slice(0, 300) || null;
  }
  return o;
}

// ---- checks ----------------------------------------------------------------------------------------------------------
const checks = [];
const check = (name, ref, ours, pass, extra = {}) => checks.push({ name, ref, ours, pass, ...extra });
const sameSet = (a, b) => JSON.stringify(idx0(a)) === JSON.stringify(idx0(b));

function compareOne(id, refRaw, oursRaw) {
  const ref = extractRef(refRaw);
  const ours = extractOurs(oursRaw);
  checks.length = 0;
  const rec = { id, kind: ref.kind, status: null, oursOutcome: ours.outcome, frame: ours.frame === 'y-up' ? 'y-up (mapped)' : 'FreeCAD axes', checks: [], notes: [], differences: [] };

  if (ours.outcome !== 'built') { // never MATCH on a piece we did not build
    rec.status = 'NOT-BUILT';
    rec.refusal = ours.refusal;
    rec.ref = { volume: ref.volume, bbox: ref.bbox, faces: ref.faces };
    rec.notes.push(`ours outcome is '${ours.outcome}', so no measurement is compared; the reference built it.`);
    return rec;
  }

  let missing = [];
  if (ref.kind === 'solid') {
    if (ref.volume != null) {
      if (ours.volume == null) missing.push('volume');
      else {
        const rel = Math.abs(ours.volume - ref.volume) / Math.max(Math.abs(ref.volume), Number.EPSILON);
        check('volume (rel 1e-6)', ref.volume, ours.volume, rel <= TOL.volumeRel, { delta: rel });
      }
    }
    if (ref.faces != null) {
      if (ours.faces == null) missing.push('faces'); else check('faces', ref.faces, ours.faces, ref.faces === ours.faces);
    }
  }
  if (ref.bbox) {
    if (!ours.bbox) missing.push('bbox');
    else {
      const ob = ours.frame === 'y-up' ? mapYupToZup(ours.bbox) : ours.bbox;
      const axes = ref.kind === 'sketch' ? ours.bboxAxes : [0, 1, 2]; // a sketch has no extent along its normal
      const idxs = axes.flatMap((a) => [a, a + 3]);
      const d = Math.max(...idxs.map((i) => Math.abs(ob[i] - ref.bbox[i])));
      check(`bbox (abs 1e-6${ref.kind === 'sketch' ? ', in-plane axes' : ''}${ours.frame === 'y-up' ? ', after Y-up->Z-up' : ''})`, idxs.map((i) => ref.bbox[i]), idxs.map((i) => ob[i]), d <= TOL.bboxAbs, { delta: d });
    }
  }
  if (ref.kind === 'sketch') {
    if (!ours.cases) missing.push('sketch cases');
    else for (const [cname, rc] of Object.entries(ref.cases)) {
      const oc = ours.cases[cname];
      if (!oc) { missing.push(`case ${cname}`); continue; }
      const tag = Object.keys(ref.cases).length > 1 ? `[${cname}] ` : '';
      if (rc.dof != null) check(`${tag}degrees of freedom`, rc.dof, oc.dof, rc.dof === oc.dof);
      check(`${tag}conflicting constraints (0-based)`, rc.conflicting, oc.conflicting, sameSet(rc.conflicting, oc.conflicting));
      check(`${tag}redundant constraints (0-based)`, rc.redundant, oc.redundant, sameSet(rc.redundant, oc.redundant));
      if (oc.conflictingNative && !sameSet(oc.conflictingNative, oc.conflicting)) {
        rec.differences.push({
          case: cname, what: 'conflicting list',
          freecad: rc.conflicting, oursNativeBlame: oc.conflictingNative, oursLeaveOneOutSet: oc.conflicting,
          reason: 'brep-rs diagnose().blame names ONE rule: the row whose presence breaks consistency (here the later, contradicting distanceX). FreeCAD ConflictingConstraints names the whole contradicting set (both distanceX rows). Both come from their own solver and neither is wrong; the compared list is the leave-one-out set from the same brep-rs solver (rule i is in it iff dropping rule i clears the conflicting bucket), which is the like-for-like quantity. The native blame is a strict subset of it.',
        });
      }
    }
  }
  rec.checks = checks.map((c) => ({ ...c }));
  rec.ref = { volume: ref.volume, bbox: ref.bbox, faces: ref.faces, cases: ref.cases };
  rec.ours = { volume: ours.volume, bbox: ours.bbox, faces: ours.faces, cases: ours.cases };
  if (missing.length) { rec.status = 'INCOMPLETE'; rec.notes.push(`ours does not report: ${missing.join(', ')}`); }
  else if (!rec.checks.length) { rec.status = 'INCOMPLETE'; rec.notes.push('nothing to compare'); }
  else rec.status = rec.checks.every((c) => c.pass) ? 'MATCH' : 'MISMATCH';
  if (rec.status === 'MATCH' && oursRaw.std?.conflictBuildRefused) rec.notes.push('ours refuses to build a solid on the conflicting sketch, with a sentence (FreeCAD marks the sketch Invalid).');
  return rec;
}

// ---- driver ----------------------------------------------------------------------------------------------------------
const ids = readdirSync(OURS_DIR).map((f) => /^ours-(.+)\.mjs$/.exec(f)?.[1]).filter(Boolean).sort();
const only = args.only ? String(args.only).split(',') : null;
const pieces = [];
for (const id of ids.filter((i) => !only || only.includes(i))) {
  const refFile = path.join(BASE, `ref-${id}.json`);
  const script = path.join(OURS_DIR, `ours-${id}.mjs`);
  const jsonFile = path.join(OURS_DIR, `ours-${id}.json`);
  if (!existsSync(refFile)) { pieces.push({ id, status: 'REF-MISSING', oursOutcome: null, checks: [], notes: [`no ${path.basename(refFile)}`] }); continue; }
  let ranNote = null;
  if (RERUN) {
    const before = existsSync(jsonFile) ? readFileSync(jsonFile, 'utf8') : null;
    const r = spawnSync(process.execPath, [script], { cwd: path.dirname(script), encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 28 });
    const after = existsSync(jsonFile) ? readFileSync(jsonFile, 'utf8') : null;
    if (r.status !== 0 && (after == null || after === before)) {
      pieces.push({ id, status: 'ERROR', oursOutcome: null, checks: [], notes: [`ours script exited ${r.status}${r.signal ? ' ' + r.signal : ''}: ${(r.stderr || '').split('\n').slice(0, 4).join(' | ')}`] });
      continue;
    }
    if (r.status !== 0) ranNote = `script exited ${r.status} after writing its json`;
  } else if (!existsSync(jsonFile)) { pieces.push({ id, status: 'ERROR', oursOutcome: null, checks: [], notes: [`no ${path.basename(jsonFile)} (and --no-rerun)`] }); continue; }
  try {
    const rec = compareOne(id, readJson(refFile), readJson(jsonFile));
    if (ranNote) rec.notes.push(ranNote);
    rec.rerun = RERUN;
    pieces.push(rec);
  } catch (e) { pieces.push({ id, status: 'ERROR', oursOutcome: null, checks: [], notes: [String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')] }); }
}

// ---- print + write ---------------------------------------------------------------------------------------------------
const fmt = (v) => (Array.isArray(v) ? JSON.stringify(v.map((x) => (typeof x === 'number' ? +x.toPrecision(10) : x))) : typeof v === 'number' ? String(+v.toPrecision(10)) : String(v));
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('piece', 26)}${pad('status', 12)}${pad('ours', 17)}${pad('frame', 15)}detail`);
console.log('-'.repeat(110));
for (const p of pieces) {
  const bad = (p.checks ?? []).filter((c) => !c.pass).map((c) => `${c.name}: ref ${fmt(c.ref)} vs ours ${fmt(c.ours)}`);
  const detail = p.status === 'MATCH' ? `${p.checks.length} checks ok` : p.status === 'MISMATCH' ? bad.join('; ') : p.status === 'NOT-BUILT' ? String(p.refusal ?? p.notes[0]).slice(0, 80) : (p.notes ?? []).join('; ').slice(0, 100);
  console.log(`${pad(p.id, 26)}${pad(p.status, 12)}${pad(p.oursOutcome ?? '-', 17)}${pad(p.frame ?? '-', 15)}${detail}`);
}
console.log('-'.repeat(110));
const tally = {};
for (const p of pieces) tally[p.status] = (tally[p.status] ?? 0) + 1;
console.log(`pieces ${pieces.length}: ` + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', '));
for (const p of pieces) for (const d of p.differences ?? []) {
  console.log(`\nNOTE ${p.id} [${d.case}] ${d.what}: FreeCAD ${fmt(d.freecad)}; ours native blame ${fmt(d.oursNativeBlame)}; ours leave-one-out set ${fmt(d.oursLeaveOneOutSet)}\n  ${d.reason}`);
}
const board = {
  generatedAt: new Date().toISOString(),
  reference: 'FreeCAD 26.3.0 RC1 (headless), baseline/ref-<id>.json',
  ours: 'reSHape Script -> ModelDoc -> brep-rs wasm, baseline/ours-<id>.mjs re-run' + (RERUN ? '' : ' (NOT re-run: --no-rerun)'),
  tolerances: { volumeRelative: TOL.volumeRel, bboxAbsolute: TOL.bboxAbs, faces: 'exact', dof: 'exact', constraintLists: 'equal as 0-based sets' },
  frameMapping: "ours json frame:'y-up' => (x,y,z) -> (x,-z,y) before bbox compare; otherwise already FreeCAD axes",
  summary: { total: pieces.length, ...tally },
  pieces,
};
writeFileSync(OUT, JSON.stringify(board, null, 2) + '\n');
console.log(`\nwrote ${OUT}`);
if (args.strict && pieces.some((p) => p.status !== 'MATCH')) process.exit(1);
