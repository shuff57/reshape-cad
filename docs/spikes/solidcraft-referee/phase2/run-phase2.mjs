#!/usr/bin/env node
// SPIKE, referee only. Phase 2: constrained sketches (constraints + dimensions BEFORE solving) -> solidcraft's own sketch
// solver -> extrude, scored against live brep-rs on the SAME doc and against reference values that exist (closed forms,
// FreeCAD in-plane bbox / dof / conflicting / redundant from the gauntlet refs). No FreeCAD is run here: refs are read.
//
//   SOLIDCRAFT_REFEREE_PKG2=<dir with solidcraft_referee_p2.js (wasm-bindgen --target nodejs of phase2/wrapper2)> \
//     node docs/spikes/solidcraft-referee/phase2/run-phase2.mjs [--only=substr,substr] [--out=<dir>]
//
// Needs `npm run build` (reads packages/*/dist) and packages/brep-rs/pkg. Not part of npm test. Writes results.json and
// last-run.txt under --out (default: this directory). Exit 0 only when no fixture FAILs and every negative control is
// rejected.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mapSketch, extrudeCommands, frameOf, docProfileIndices } from './sketch-map.mjs';
import { checkRules } from './rule-check.mjs';
import { OWN, H, gauntletFixtures } from './fixtures-p2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG2;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG2 is unset (needs the phase2/wrapper2 build, which returns every command output). Nothing was run.'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const OUT = arg('out') ? path.resolve(arg('out')) : HERE;
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee_p2.js'));
const GAUNTLET = path.join(REPO, 'docs/replica/freecad/gauntlet/variants');
const imp = (p) => import(pathToFileURL(p).href);
const { load, measureDoc } = await imp(path.join(GAUNTLET, 'lib.mjs'));
const { SketchSession2D, brep } = await load();
const mt = await imp(path.join(REPO, 'packages/script/dist/model-types.js'));

// ---- bars. Inherited from phase0 (run-phase0.mjs), NOT tuned here: truck's volume/bbox/COM are tessellation-derived. -------
const TOL = { planar: 1e-9, curved: 3e-4 };
const COM = { planar: 1e-6, curved: 3e-5 }; // x bbox diagonal
const REF_TOL = 1e-6; // brep-rs vs closed form (brep-rs is exact on these; the parity gate's 'tight')
const RULE_TOL = 1e-6; // a solver's output satisfying a rule, in mm / deg
const GEOM_TOL = 1e-6; // two solvers' solved geometry, abs mm, only where the reference says dof 0

const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); console.log(s); };
const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const clone = (o) => JSON.parse(JSON.stringify(o));
const fx6 = (x) => (typeof x === 'number' ? +x.toPrecision(10) : Array.isArray(x) ? x.map(fx6) : x);

// frame sanity: our copy of sketchFrameOf equals the built one
for (const plane of ['xy', 'xz', 'yz']) {
  const a = frameOf({ plane, offset: 3 }), b = mt.sketchFrameOf({ plane, offset: 3 });
  if (JSON.stringify([a.origin, a.u, a.v, a.n]) !== JSON.stringify([b.origin, b.u, b.v, b.n])) { console.error(`FATAL: frameOf(${plane}) differs from model-types sketchFrameOf`); process.exit(2); }
}

// ---- references ------------------------------------------------------------------------------------------------------
function fcRef(id) {
  const f = path.join(GAUNTLET, 'refs', `ref-${id}.json`);
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  // refs/ files are 1-based constraint lists in FreeCAD numbering; only counts and the bucket are used here
  return { dof: r.dof, conflicting: r.conflicting ?? [], redundant: r.redundant ?? [], bbox: r.bbox, bucket: (r.conflicting ?? []).length ? 'conflicting' : (r.redundant ?? []).length ? 'redundant' : 'consistent' };
}

// ---- geometry helpers ------------------------------------------------------------------------------------------------
function geomBox(gs) {
  const pts = [];
  for (const g of gs) {
    if (g.k === 'point') pts.push(g.p);
    else if (g.k === 'line') pts.push(g.a, g.b);
    else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]);
    else { pts.push(g.a, g.b); }
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
const hasCurve = (gs) => gs.some((g) => g.k === 'circle' || g.k === 'arc');
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
/** a hand-drawn start: every coordinate off by up to 3.5% of the sketch diagonal, except points a `lock` row holds. */
function roughen(fx) {
  const rnd = mulberry(seedOf(fx.id));
  const bb = geomBox(fx.geoms);
  const amp = 0.035 * Math.max(Math.hypot(bb[2] - bb[0], bb[3] - bb[1]), 1);
  const locked = new Set(fx.rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const j = () => (rnd() * 2 - 1) * amp;
  const mv = (p) => [p[0] + j(), p[1] + j()];
  return fx.geoms.map((g) => {
    const o = clone(g);
    const lk = (e) => locked.has(`${g.id}:${e}`) || (e === 'c' && (g.k === 'circle' || g.k === 'arc') && locked.has(`${g.id}:`)) || (e === 'a' && (g.k === 'line' || g.k === 'point') && locked.has(`${g.id}:`));
    if (g.k === 'point') { if (!lk('a')) o.p = mv(g.p); }
    if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); }
    if (g.k === 'circle') { if (!lk('c')) o.c = mv(g.c); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    if (g.k === 'arc') { if (!lk('c')) o.c = mv(g.c); if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    return o;
  });
}

// ---- brep-rs ---------------------------------------------------------------------------------------------------------
async function runBrep(fx, geoms) {
  const o = { geoms: null, diag: null, open: null, solved: null, lastError: null, build: null };
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  o.open = s.open(clone(geoms), clone(fx.rules));
  if (!o.open) {
    o.solved = s.solve();
    o.lastError = o.solved ? null : s.lastError();
    o.diag = s.diagnose();
    if (o.solved) { try { o.geoms = s.solvedGeoms(); } catch { /* none */ } }
  }
  s.close();
  const doc = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: fx.plane, offset: 0, geoms: clone(geoms), rules: clone(fx.rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }] };
  const m = await measureDoc(doc);
  o.build = { outcome: m.outcome, refusal: m.refusal ?? null, volume: m.volume, bbox: m.bbox, faces: m.faces, com: m.com };
  return o;
}

// ---- solidcraft ------------------------------------------------------------------------------------------------------
function execute(commands) {
  const r = JSON.parse(sc.run(JSON.stringify({ commands })));
  if (!r.results) throw new Error(`wrapper error: ${JSON.stringify(r).slice(0, 300)}`);
  return r;
}
/** solidcraft's solved sketch -> our geom rows, using the mapper's own name table. */
function truckGeoms(dump, names, geoms) {
  const P = new Map(dump.sketch.points.map((p) => [p.id, p.pos]));
  const C = new Map(dump.sketch.curves.map((c) => [c.id, c]));
  const at = (ref) => P.get(ref);
  return geoms.map((g) => {
    const n = names.find((x) => x.geom === g.id);
    if (g.k === 'point') return { ...g, p: at(n.points.a) };
    if (g.k === 'line') return { ...g, a: at(n.points.a), b: at(n.points.b) };
    const c = at(n.points.c);
    if (g.k === 'circle') { const cu = C.get(n.curve); return { ...g, c, r: cu?.r ?? cu?.radius ?? null }; }
    const a = at(n.points.a), b = at(n.points.b);
    return { ...g, c, a, b, r: Math.hypot(a[0] - c[0], a[1] - c[1]) };
  });
}
function bodyOf(r) {
  const bs = r.measure?.ok ? r.measure.out.bodies : null;
  if (!bs || !bs.length) return null;
  // every body of the result, aggregated (a profile selection that yields two bodies must not hide the second)
  const vol = bs.reduce((s, b) => s + b.volume_mm3, 0);
  const lo = [0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])));
  const com = [0, 1, 2].map((i) => bs.reduce((s, b) => s + b.volume_mm3 * b.center_of_mass[i], 0) / vol);
  const faceTypes = {};
  for (const b of bs) for (const [k, v] of Object.entries(b.face_types ?? {})) faceTypes[k] = (faceTypes[k] ?? 0) + v;
  return { volume: vol, bbox: [...lo, ...hi], com, faces: bs.reduce((s, b) => s + b.faces, 0), faceTypes, bodies: bs.length };
}
function runTruck(fx, geoms, { mapOverride = null, commandEdit = null } = {}) {
  const sk = { id: fx.id, plane: fx.plane, geoms, rules: mapOverride ?? fx.rules };
  const mapped = mapSketch(sk, { name: 'sk' });
  if (!mapped.ok) return { mapped, refused: 'mapper', refusals: mapped.refusals };
  let cmds = extrudeCommands(mapped, { height: H });
  if (commandEdit) cmds = commandEdit(cmds);
  let run = execute(cmds);
  // pass 2: select the profiles the doc means (outline minus holes), see sketch-map.mjs docProfileIndices
  const dump0 = run.results.find((x) => x.command === '@sketch');
  let profileSelection = null;
  if (dump0?.ok && dump0.out.profile_list) {
    const idx = docProfileIndices(dump0.out.profile_list, truckGeoms(dump0.out, mapped.names, geoms));
    profileSelection = { all: dump0.out.profile_list.length, chosen: idx };
    if (idx.length && idx.length !== dump0.out.profile_list.length) {
      const ex = cmds.find((c) => c.command === 'solid.extrude');
      ex.params.profiles = idx;
      run = execute(cmds);
    }
  }
  const failed = run.results.filter((x) => !x.ok);
  const dumpRes = run.results.find((x) => x.command === '@sketch');
  const out = { mapped, profileSelection, notes: mapped.notes, commands: cmds, results: run.results.map((x) => ({ i: x.i, command: x.command, ok: x.ok, error: x.error, out: x.command === '@sketch' || x.command === 'inspect.measure' ? undefined : x.out })), failed: failed.map((x) => ({ i: x.i, command: x.command, error: x.error })) };
  if (dumpRes?.ok && !dumpRes.out.error) {
    out.dump = dumpRes.out;
    out.report = dumpRes.out.report;
    out.geoms = truckGeoms(dumpRes.out, mapped.names, geoms);
  }
  // "stop at the first refusal" is the honest flow: nothing after a refused command is built. The run above kept going (so
  // the report AFTER a refusal is readable); `ignored` below is what an unwary caller that dropped the error would get.
  out.body = bodyOf(run);
  out.measureRaw = run.measure?.ok ? null : run.measure?.error;
  if (failed.length) { out.refused = 'solidcraft'; out.ignoredErrorBody = out.body; out.body = null; }
  return out;
}

// ---- scoring ---------------------------------------------------------------------------------------------------------
function checkSolid(label, body, ref, curved, comFromRef = true) {
  const t = curved ? TOL.curved : TOL.planar;
  const bx = ref.bbox ?? body.bbox;
  const diag = Math.max(Math.hypot(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]), 1);
  const res = [];
  const ck = (name, got, want, delta, tol) => res.push({ vs: label, name, got: fx6(got), want: fx6(want), delta, tol, pass: delta <= tol });
  if (ref.volume != null) ck('volume', body.volume, ref.volume, rel(body.volume, ref.volume), t);
  if (ref.bbox) ck('bbox', body.bbox, ref.bbox, Math.max(...ref.bbox.map((w, i) => Math.abs(body.bbox[i] - w) / Math.max(Math.abs(w), 1))), t);
  if (ref.com && comFromRef) ck('com', body.com, ref.com, Math.max(...ref.com.map((w, i) => Math.abs(body.com[i] - w))) / diag, curved ? COM.curved : COM.planar);
  return res;
}
function ruleSat(fx, geomsOut, start) {
  if (!geomsOut) return null;
  const rs = checkRules(geomsOut, fx.rules, start).filter((r) => r.driving && r.residual !== null);
  const worst = rs.reduce((m, r) => (r.residual > m.residual ? r : m), { residual: 0 });
  return { ok: worst.residual <= RULE_TOL, worst: { rule: worst.rule ?? null, kind: worst.kind ?? null, residual: worst.residual } };
}
function geomDelta(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const g = a[i], h = b[i];
    const arr = g.k === 'point' ? [[g.p, h.p]] : g.k === 'line' ? [[g.a, h.a], [g.b, h.b]] : g.k === 'circle' ? [[g.c, h.c]] : [[g.c, h.c], [g.a, h.a], [g.b, h.b]];
    for (const [p, q] of arr) m = Math.max(m, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
    if (g.r !== undefined && h.r != null) m = Math.max(m, Math.abs(g.r - h.r));
  }
  return m;
}

// ---- one fixture x one start mode -------------------------------------------------------------------------------------
async function runCase(fx, mode) {
  const start = mode === 'rough' ? roughen(fx) : clone(fx.geoms);
  const fc = fx.gauntlet ? fcRef(fx.id) : null;
  const rec = { id: fx.id, group: fx.group, mode, desc: fx.desc };
  const refDof = fc ? (fc.bucket === 'consistent' ? fc.dof : null) : (fx.expectDof ?? null);
  const refBucket = fc ? fc.bucket : 'consistent';
  rec.reference = { source: fc ? 'FreeCAD ref + closed form' : 'closed form (hand count)', dof: refDof, bucket: refBucket, fcConflicting: fc?.conflicting?.length ?? null, fcRedundant: fc?.redundant?.length ?? null, closedArea: fx.closed ?? null };
  const b = await runBrep(fx, start);
  const t = runTruck(fx, start);
  rec.brep = { open: b.open, solved: b.solved, lastError: b.lastError, diag: b.diag, build: b.build, ruleSat: ruleSat(fx, b.geoms, start) };
  rec.truck = { profileSelection: t.profileSelection ?? null, refused: t.refused ?? null, refusals: t.refusals, failed: t.failed, notes: t.notes, report: t.report ? { status: t.report.status, dof: t.report.dof, failing: t.report.failing, redundant: t.report.redundant, folded: t.report.folded, profiles: t.dump.profiles, max_residual: t.report.max_residual } : null, body: t.body, ignoredErrorBody: t.ignoredErrorBody ?? null, ruleSat: ruleSat(fx, t.geoms, start), commandCount: t.commands?.length };
  rec.solved = { start: fx6(start), brep: b.geoms ? fx6(b.geoms) : null, truck: t.geoms ? fx6(t.geoms) : null };
  rec.commands = t.commands;
  rec.commandResults = t.results;
  rec.names = t.mapped?.names;
  // reference solid values
  const bb = geomBox(fx.geoms);
  let refSolid = null;
  if (fx.closed != null) {
    refSolid = { volume: fx.closed * H, bbox: fx.bbox ?? null, source: 'closed form' };
    if (!refSolid.bbox && fc?.bbox && fc.bucket === 'consistent' && fc.dof === 0) refSolid.bbox = [fc.bbox[0], fc.bbox[1], 0, fc.bbox[3], fc.bbox[4], H];
  }
  rec.refSolid = refSolid;
  // ---- verdict -------------------------------------------------------------------------------------------------------
  const curved = hasCurve(fx.geoms);
  const determined = refBucket === 'consistent' && refDof === 0;
  rec.determined = determined;
  rec.checks = [];
  if (t.refused === 'mapper') { rec.verdict = 'REFUSED-MAPPER'; rec.sentence = t.refusals.map((r) => `rule ${r.rule} (${r.kind}): ${r.sentence}`).join(' | '); return rec; }
  if (t.refused === 'solidcraft') {
    const f = t.failed[0];
    rec.sentence = `command ${f.i} ${f.command}: ${f.error}`;
    const onlyExtrude = t.failed.every((x) => x.command === 'solid.extrude');
    // a refusal where the reference is merely REDUNDANT and brep-rs builds is not agreement: solidcraft is stricter
    rec.verdict = refBucket === 'redundant' && b.build.outcome === 'built' ? 'SOLIDCRAFT-STRICTER'
      : refBucket !== 'consistent' ? 'AGREED-REFUSAL' : (onlyExtrude && b.build.outcome !== 'built') ? 'AGREED-NO-SOLID' : 'REFUSED-UNEXPECTED';
    if (rec.verdict === 'AGREED-NO-SOLID') rec.sentence += ` | brep-rs: ${b.build.refusal}`;
    return rec;
  }
  if (!t.body) { rec.verdict = t.dump?.profiles === 0 || !t.dump ? 'NO-SOLID' : 'NO-SOLID'; rec.sentence = t.measureRaw ?? 'no body measured'; return rec; }
  const bm = b.build.outcome === 'built' ? b.build : null;
  if (refSolid) rec.checks.push(...checkSolid('closed form', t.body, refSolid, curved));
  if (bm) rec.checks.push(...checkSolid('brep-rs', t.body, { volume: bm.volume, bbox: bm.bbox, com: bm.com }, curved));
  if (bm && refSolid) {
    const d = rel(bm.volume, refSolid.volume);
    rec.brepVsClosed = { delta: d, pass: d <= REF_TOL };
  }
  if (bm && Math.abs(t.body.faces - bm.faces) > 0) rec.faceCount = { truck: t.body.faces, brep: bm.faces, types: t.body.faceTypes };
  else if (bm) rec.faceCount = { truck: t.body.faces, brep: bm.faces, types: t.body.faceTypes, same: true };
  // solved geometry vs brep-rs, only meaningful where the reference says it is determined
  if (b.geoms && t.geoms) rec.geomDelta = geomDelta(b.geoms, t.geoms);
  rec.refBasis = [refSolid ? 'closed form' : null, bm ? 'brep-rs' : `brep-rs ${b.build.outcome}: ${b.build.refusal}`].filter(Boolean);
  if (!rec.checks.length) { rec.verdict = 'NO-REFERENCE'; rec.why = `solidcraft built a solid (volume ${fx6(t.body.volume)}, ${t.body.bodies} bod${t.body.bodies === 1 ? 'y' : 'ies'}) but there is no closed form and brep-rs ${b.build.outcome} (${b.build.refusal}): nothing to score it against`; return rec; }
  const allPass = rec.checks.every((c) => c.pass);
  const dofNote = { brep: b.diag?.dof ?? null, truck: t.report?.dof ?? null, ref: refDof };
  rec.dof = dofNote;
  if (determined) {
    rec.verdict = allPass && rec.truck.ruleSat?.ok ? 'PASS' : 'FAIL';
    if (!rec.truck.ruleSat?.ok) rec.why = `solidcraft's output violates a rule (${JSON.stringify(rec.truck.ruleSat?.worst)})`;
    else if (!allPass) rec.why = rec.checks.filter((c) => !c.pass).map((c) => `${c.vs}/${c.name} delta ${c.delta.toExponential(2)} > ${c.tol}`).join('; ');
    if (rec.verdict === 'PASS' && rec.dof.truck !== 0) rec.dofDisagreement = `solidcraft reports dof ${rec.dof.truck} where the reference is ${refDof} (solid still correct)`;
    if (rec.verdict === 'PASS' && rec.geomDelta !== undefined && rec.geomDelta > GEOM_TOL) rec.verdict = 'FAIL', rec.why = `solved geometry differs from brep-rs by ${rec.geomDelta.toExponential(2)} abs mm though both claim determination`;
  } else {
    rec.verdict = allPass && rec.truck.ruleSat?.ok ? 'AGREE-UNDERDETERMINED' : 'DIVERGE-UNDERDETERMINED';
    rec.why = 'the reference leaves degrees of freedom open, so two solvers may legitimately land on different parts; every rule is checked on each output instead';
  }
  void bb;
  // geometry agreement and diagnostic agreement are separate claims: a case whose geometry passes but whose dof (or
  // redundancy list) disagrees with the reference is tallied on its own, never inside PASS / AGREE-UNDERDETERMINED
  if ((rec.verdict === 'PASS' || rec.verdict === 'AGREE-UNDERDETERMINED') && refDof !== null && rec.dof.truck !== refDof) {
    rec.dofDisagreement = `solidcraft dof ${rec.dof.truck}, reference ${refDof}, brep-rs ${rec.dof.brep}; redundant ${JSON.stringify(t.report?.redundant)}`;
    rec.verdict = 'GEOMETRY-OK-DOF-MISREPORTED';
  }
  return rec;
}

// ---- negative controls -----------------------------------------------------------------------------------------------
/** edit the already-mapped command list, then score exactly as the positive case is scored: it must come back not-PASS. */
async function negativeControl(fxId, name, edit, { geomsEdit = null, ruleEdit = null, rough = false, family = name } = {}) {
  const all = [...OWN, ...gauntletFixtures()];
  const base0 = all.find((f) => f.id === fxId);
  // rough: BOTH the edited run and the unedited brep-rs reference start from the same hand-drawn coordinates
  const base = rough ? { ...clone(base0), geoms: roughen(base0) } : base0;
  const fx = { ...clone(base), geoms: geomsEdit ? geomsEdit(clone(base.geoms)) : clone(base.geoms), rules: ruleEdit ? ruleEdit(clone(base.rules)) : clone(base.rules) };
  const fc = fx.gauntlet ? fcRef(fx.id) : null;
  const t = runTruck(fx, fx.geoms, { commandEdit: edit });
  const rec = { control: name, family, start: rough ? 'rough' : 'stored', fixture: fxId };
  if (t.refused === 'mapper') { rec.outcome = 'REFUSED-MAPPER'; rec.sentence = t.refusals.map((r) => r.sentence).join(' | '); rec.rejected = true; return rec; }
  if (t.refused === 'solidcraft') { rec.outcome = 'REFUSED-SOLIDCRAFT'; rec.sentence = t.failed.map((f) => f.error).join(' | '); rec.rejected = true; return rec; }
  const curved = hasCurve(base.geoms);
  const refSolid = { volume: base.closed != null ? base.closed * H : null, bbox: base.bbox ?? (fc?.bbox ? [fc.bbox[0], fc.bbox[1], 0, fc.bbox[3], fc.bbox[4], H] : null) };
  const brepBase = await runBrep(base, base.geoms); // the CORRECT doc on brep-rs is the reference
  const ref = { volume: brepBase.build.volume, bbox: brepBase.build.bbox, com: brepBase.build.com };
  const refOk = brepBase.build.outcome === 'built';
  const checks = [...(t.body && refSolid.volume != null ? checkSolid('closed form', t.body, refSolid, curved) : []), ...(t.body && refOk ? checkSolid('brep-rs (unedited doc)', t.body, ref, curved) : [])];
  if (t.geoms && brepBase.geoms) {
    const d = geomDelta(brepBase.geoms, t.geoms);
    checks.push({ vs: 'brep-rs (unedited doc)', name: 'solved sketch geometry', delta: d, pass: d <= GEOM_TOL });
    rec.geomDelta = d;
  }
  rec.outcome = t.body ? 'BUILT' : 'NO-SOLID';
  rec.checks = checks.map((c) => ({ vs: c.vs, name: c.name, delta: c.delta, pass: c.pass }));
  rec.rejected = !t.body || checks.some((c) => !c.pass);
  rec.rejectedBy = [...new Set(checks.filter((c) => !c.pass).map((c) => c.name))];
  rec.passedSignals = [...new Set(checks.filter((c) => c.pass).map((c) => c.name))];
  rec.truckBody = t.body ? { volume: t.body.volume, bbox: t.body.bbox } : null;
  return rec;
}
const swapLengthValues = (a, b) => (cmds) => {
  const dims = cmds.filter((c) => c.command === 'sketch.dimension' && c.params.type === 'length');
  const x = dims.find((d) => d.params.value === a), y = dims.find((d) => d.params.value === b);
  if (!x || !y) throw new Error(`negative control: no length dims with values ${a}, ${b}`);
  [x.params.value, y.params.value] = [y.params.value, x.params.value];
  return cmds;
};

// ---- run -------------------------------------------------------------------------------------------------------------
const FIXTURES = [...OWN, ...gauntletFixtures()].filter((f) => !only.length || only.some((o) => f.id.includes(o)));
log(`phase 2: ${FIXTURES.length} constrained sketches x 2 start modes (stored / rough), truck=solidcraft solver, ref=brep-rs + closed form + FreeCAD refs`);
log(`bars (inherited from phase0, not tuned): volume/bbox rel ${TOL.planar} planar / ${TOL.curved} curved; COM x diagonal ${COM.planar} / ${COM.curved}; rule residual ${RULE_TOL}; solved geometry ${GEOM_TOL}`);
const results = [];
for (const fx of FIXTURES) for (const mode of ['stored', 'rough']) {
  let rec;
  try { rec = await runCase(fx, mode); } catch (e) { rec = { id: fx.id, group: fx.group, mode, verdict: 'ERROR', sentence: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
  results.push(rec);
  const d = rec.dof ? `dof ref/brep/truck ${rec.dof.ref}/${rec.dof.brep}/${rec.dof.truck}` : '';
  log(`${rec.verdict.padEnd(24)} ${fx.id.padEnd(52)} ${mode.padEnd(7)} ${d}${rec.why ? ' | ' + rec.why : ''}${rec.sentence ? ' | ' + rec.sentence.slice(0, 220) : ''}`);
}

log('\n--- negative controls (each must be rejected by the same scorer) ---');
const CONTROLS = [];
const run = async (...a) => { try { CONTROLS.push(await negativeControl(...a)); } catch (e) { CONTROLS.push({ control: a[1], fixture: a[0], outcome: 'ERROR', rejected: false, sentence: String(e.message).slice(0, 200) }); } };
const SLOT = 'sk-circle-arc-tangent__slot-r6-L30-anchored';
if (!only.length || only.some((o) => 'own-rect-rough-dims'.includes(o))) await run('own-rect-rough-dims', 'swap width 30 <-> height 20 dimension', swapLengthValues(30, 20));
if (!only.length || only.some((o) => 'own-l-shape-dims'.includes(o))) await run('own-l-shape-dims', 'swap length 40 <-> 18', swapLengthValues(40, 18));
if (!only.length || only.some((o) => 'sk-rect-dof__corner-origin-25x60'.includes(o))) {
  await run('sk-rect-dof__corner-origin-25x60', 'swap dx 25 <-> dy 60 dimension', (cmds) => {
    const d = cmds.filter((c) => c.command === 'sketch.dimension' && (c.params.value === 25 || c.params.value === 60));
    const [x, y] = d; [x.params.value, y.params.value] = [y.params.value, x.params.value];
    return cmds;
  });
}
if (!only.length || only.some((o) => 'own-triangle-length-angle'.includes(o))) {
  await run('own-triangle-length-angle', 'angle 120 -> 100 (wrong dimension value)', (cmds) => { const a = cmds.find((c) => c.params.type === 'angle'); a.params.value = '100 deg'; return cmds; });
}
if (!only.length || only.some((o) => 'own-circle-diameter'.includes(o))) {
  await run('own-circle-diameter', 'radius dimension used where the doc says diameter', (cmds) => { const d = cmds.find((c) => c.params.type === 'diameter'); d.params.type = 'radius'; return cmds; });
}
if (!only.length || only.some((o) => 'slot-r6-L30-anchored'.includes(o))) {
  await run('sk-circle-arc-tangent__slot-r6-L30-anchored', 'tangent branch flipped: right cap starts bulging INWARD (same endpoints, other sense)', null,
    { geomsEdit: (g) => { g[1].sense = 'ccw'; return g; } });
}
if (!only.length || only.some((o) => 'circle-circle-external'.includes(o))) {
  await run('sk-circle-arc-tangent__circle-circle-external', 'tangent mode flipped: small circle starts INSIDE (internal) while the doc says external', null,
    { family: 'circle-circle tangent mode flipped', geomsEdit: (g) => { g[1].c = [3, 0]; return g; } });
  await run('sk-circle-arc-tangent__circle-circle-external', 'same, with the mode request stripped so the mapper cannot refuse it', null,
    { family: 'circle-circle tangent mode flipped', geomsEdit: (g) => { g[1].c = [3, 0]; return g; }, ruleEdit: (r) => r.map((x) => { const y = { ...x }; delete y.mode; return y; }) });
}
if (!only.length || only.some((o) => SLOT.includes(o))) {
  for (const rough of [false, true]) {
    await run(SLOT, `drop the first tangent row (${rough ? 'rough' : 'stored'} start)`, null, { family: 'drop first tangent', rough, ruleEdit: (r) => { const k = r.findIndex((x) => x.k === 'tangent'); r.splice(k, 1); return r; } });
    await run(SLOT, `slot length 30 -> 30.001 (${rough ? 'rough' : 'stored'} start)`, null, { family: '+1e-3 mm slot length', rough, ruleEdit: (r) => r.map((x) => (x.k === 'distance' ? { ...x, value: 30.001 } : x)) });
  }
}
for (const c of CONTROLS) log(`${c.rejected ? 'REJECTED' : 'NOT-REJECTED'} [${c.start ?? 'stored'}] ${c.fixture} :: ${c.control} -> ${c.outcome}${c.truckBody ? ` volume ${fx6(c.truckBody.volume)} bbox ${JSON.stringify(fx6(c.truckBody.bbox))}` : ''}${c.sentence ? ' | ' + c.sentence.slice(0, 200) : ''}${c.rejectedBy ? ' | rejected by: ' + (c.rejectedBy.join(', ') || 'nothing') : ''}${c.checks ? ' | failed: ' + c.checks.filter((k) => !k.pass).map((k) => `${k.vs}/${k.name} ${k.delta.toExponential(1)}`).join(', ') : ''}`);

// ---- diagnostics table (under-/over-/redundantly-constrained) -----------------------------------------------------------
log('\n--- solver diagnostics, stored start: FreeCAD ref | brep-rs sketch_diagnose | solidcraft (refusal at command time, then SolveReport) ---');
const DIAG = [];
for (const r of results.filter((x) => x.mode === 'stored' && (x.group === 'sk-conflict' || x.group === 'sk-rect-underconstrained' || x.id === 'sk-circle-arc-tangent__slot-r6-L30-floating'))) {
  const t = r.truck, b = r.brep;
  const row = {
    id: r.id,
    freecad: { bucket: r.reference.bucket, dof: r.reference.dof, conflicting: r.reference.fcConflicting, redundant: r.reference.fcRedundant },
    brep: { bucket: b.diag?.bucket ?? null, dof: b.diag?.dof ?? null, blame: b.diag?.blame ?? null, solved: b.solved, buildOutcome: b.build?.outcome, buildRefusal: b.build?.refusal ?? null },
    truck: { refusedAt: t.failed?.[0] ? `cmd ${t.failed[0].i} ${t.failed[0].command}: ${t.failed[0].error}` : null, status: t.report?.status ?? null, dof: t.report?.dof ?? null, redundant: t.report?.redundant ?? null, failing: t.report?.failing ?? null,
      solidIfErrorIgnored: t.ignoredErrorBody ? { volume: t.ignoredErrorBody.volume, bbox: t.ignoredErrorBody.bbox } : null, solid: t.body ? { volume: t.body.volume } : null },
  };
  DIAG.push(row);
  log(`${r.id}\n   FreeCAD  ${JSON.stringify(row.freecad)}\n   brep-rs  ${JSON.stringify(row.brep)}\n   solidcraft ${JSON.stringify(row.truck)}`);
}

// ---- summary -----------------------------------------------------------------------------------------------------------
const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
const byMode = {};
for (const r of results) { byMode[r.mode] ??= {}; byMode[r.mode][r.verdict] = (byMode[r.mode][r.verdict] ?? 0) + 1; }
log('\nverdict tally (all): ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', '));
for (const [m, t] of Object.entries(byMode)) log(`  ${m}: ` + Object.entries(t).map(([k, v]) => `${k} ${v}`).join(', '));
const bad = results.filter((r) => r.verdict === 'FAIL' || r.verdict === 'ERROR' || r.verdict === 'REFUSED-UNEXPECTED' || r.verdict === 'NO-SOLID');
const badControls = CONTROLS.filter((c) => !c.rejected);
log(`controls: ${new Set(CONTROLS.map((c) => c.family ?? c.control)).size} distinct, ${CONTROLS.length} runs, ${CONTROLS.filter((c) => c.rejected).length} rejected, ${badControls.length} NOT rejected`);
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), bars: { TOL, COM, REF_TOL, RULE_TOL, GEOM_TOL }, tally, byMode, results, controls: CONTROLS, diagnostics: DIAG }, null, 1) + '\n');
writeFileSync(path.join(OUT, 'last-run.txt'), lines.join('\n') + '\n');
log(`wrote ${path.join(OUT, 'results.json')}`);
process.exit(bad.length || badControls.length ? 1 : 0);
