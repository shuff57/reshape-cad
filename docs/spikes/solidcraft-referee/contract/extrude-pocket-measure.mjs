#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group). Not an engine, not in npm test.
//
// Measures pull()/extrude and pocket() and every option of them: reSHape Script text -> ModelDoc (runScript + solveDoc) -> TWO SolidCraft routes
//   shipped  = phase7/pane/lib/translate-p4.mjs (the route as it stands)
//   contract = contract/translate-ep.mjs (same file; only the extrude and pocket cases map the options)
// and scores both against
//   analytic = a closed form written in extrude-pocket-cases.mjs (no kernel involved)
//   occt     = live OCCT (replicad-opencascadejs): occt-build for sketches/primitives, THIS file's own prism/loft/cut for the options
//   brep     = live brep-rs wasm (archive/brep-rs/pkg) measure_doc
//   fc       = the saved FreeCAD result (docs/replica/freecad/gauntlet/variants/refs) where one covers the case
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-measure.mjs [--only=id,id] [--out=<dir>]
// Writes <out>/ep-results.json (default: this directory). Heavy: run it under systemd-run (see RIG.md).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const OUT = arg('out') ? path.resolve(arg('out')) : HERE;
mkdirSync(OUT, { recursive: true });
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));

const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js'); // Node harness, not the app origin
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const shipped = await import(pathToFileURL(path.join(HERE, '..', 'phase7', 'pane', 'lib', 'translate-p4.mjs')).href);
const contract = await import(pathToFileURL(path.join(HERE, process.env.EP_TRANSLATOR ?? 'translate-ep.mjs')).href); // EP_TRANSLATOR=translate-ep.round2.mjs replays the round-2 mapping (baseline evidence)
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
const FC_REFS = path.join(REPO, 'docs', 'replica', 'freecad', 'gauntlet', 'variants', 'refs');

const TOL = { planar: 1e-9, curved: 3e-4 };
const COM_TOL = { planar: 1e-6, curved: 3e-5 }; // x bbox diagonal (phase0/PROGRESS.md)
const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const worst = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));

// ---- vector helpers ------------------------------------------------------------------------------------------------
const V = {
  add: (a, b) => a.map((x, i) => x + b[i]), sub: (a, b) => a.map((x, i) => x - b[i]), mul: (a, k) => a.map((x) => x * k),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len: (a) => Math.hypot(...a),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

// ---- OCCT side -------------------------------------------------------------------------------------------------------------
function occtMeasure(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const c = g.CentreOfMass();
  const bx = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(); const hi = bx.CornerMax();
  let solids = 0;
  const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (ex.More()) { solids++; ex.Next(); }
  return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: facesOf(oc, shape).length, solids };
}
const trsf = (shape, v) => { const t = new oc.gp_Trsf(); t.SetTranslation(new oc.gp_Vec(v[0], v[1], v[2])); return new oc.BRepBuilderAPI_Transform(shape, t, true).Shape(); };
const cutOf = (a, b) => { const op = new oc.BRepAlgoAPI_Cut(a, b); op.Build(new oc.Message_ProgressRange()); return op.Shape(); };
const fuseOf = (a, b) => { const op = new oc.BRepAlgoAPI_Fuse(a, b); op.Build(new oc.Message_ProgressRange()); return op.Shape(); };

/** Frame normal u x v of a sketch feature, from the ModelDoc (the same definition every route uses). */
function frameN(sk) { const fr = mt.sketchFrameOf(sk); return { ...fr, n: V.cross(fr.u, fr.v) }; }


/** The OCCT pull/pocket solid for one feature, written out here (occt-build does plain ones only). Returns the TOOL/SOLID shape or {refusal}. */
function occtSweepShape(f, kind, face, sk) {
  const fr = frameN(sk);
  const n = fr.n.map((c) => c / V.len(fr.n));
  const len0 = kind === 'pull' ? f.height : f.depth;
  const L = Math.abs(len0);
  const mid = !!f.midplane; const l2 = mid || !(f.length2 > 0) ? 0 : f.length2;
  let flip = false; let slant = null;
  if (f.direction) {
    const dh = f.direction.map((c) => c / V.len(f.direction));
    const c = V.dot(dh, n);
    if (V.len(V.cross(dh, n)) <= 1e-9) flip = (kind === 'pull' ? c : -c) < 0; else slant = { dh, c };
  }
  const sgn = (f.reversed ? -1 : 1) * (flip ? -1 : 1) * (len0 < 0 ? -1 : 1);
  const through = kind === 'pocket' && f.through;
  // through-all: to the far end of the part; with midplane both ways (brep-rs: the whole part is cut either way). Round 2: through+midplane was wrong here.
  const span = through ? (mid ? 2 * f.__far : f.__far) : (mid ? L : L + l2);
  const back = through ? (mid ? f.__far : 0) : (mid ? L / 2 : l2);
  // pull: solid = n-line sgn*[-back, span-back]; pocket tool = sgn*[back-span, back]; (sheared prism for a slant)
  let S; let start;
  if (slant) {
    const mag = span / (f.alongNormal === false ? 1 : Math.abs(slant.c));
    S = V.mul(slant.dh, mag * sgn);
    start = V.mul(S, -back / span);
  } else if (kind === 'pull') { S = V.mul(n, sgn * span); start = V.mul(n, -sgn * back); }
  else { S = V.mul(n, -sgn * span); start = V.mul(n, sgn * back); }
  const moved = trsf(face, start);
  if (f.taper) {
    const tp = Math.tan((f.taper * Math.PI) / 180) * span;
    // ruled loft from the outline to its mitre offset, the second copy translated along S
    const op = new oc.BRepOffsetAPI_MakeOffset(oc.TopoDS.Face(moved), oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    op.Perform(tp, 0);
    const off = op.Shape();
    const wires = [];
    const ex = new oc.TopExp_Explorer(off, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (ex.More()) { wires.push(oc.TopoDS.Wire(ex.Current())); ex.Next(); }
    const w0 = []; const ex0 = new oc.TopExp_Explorer(moved, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (ex0.More()) { w0.push(oc.TopoDS.Wire(ex0.Current())); ex0.Next(); }
    if (w0.length !== 1 || wires.length !== 1) return { refusal: `occt: taper oracle needs one outline (got ${w0.length}/${wires.length})` };
    const second = new oc.BRepBuilderAPI_Transform(wires[0], (() => { const t = new oc.gp_Trsf(); t.SetTranslation(new oc.gp_Vec(S[0], S[1], S[2])); return t; })(), true).Shape();
    const th = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6);
    th.AddWire(w0[0]); th.AddWire(oc.TopoDS.Wire(second));
    th.Build(new oc.Message_ProgressRange());
    return { shape: th.Shape(), S, start };
  }
  const tool = new oc.BRepPrimAPI_MakePrism(moved, new oc.gp_Vec(S[0], S[1], S[2]), false, true).Shape();
  return { shape: tool, S, start };
}

/** Walk the ModelDoc and build every feature on OCCT (plain ones by occt-build; pull/pocket/union by this file). */
function occtDoc(doc) {
  const built = buildDoc(oc, doc, arc);
  const mine = new Map();
  const heads = new Map();
  const headOf = (id) => heads.get(id) ?? id;
  const out = { shapes: mine, refusals: new Map(built.refusals ?? []) };
  for (const f of doc.features) {
    try {
      if (f.kind === 'extrude' || f.kind === 'pocket') {
        const sk = doc.features.find((x) => x.id === f.target);
        const face = built.shapes.get(f.target);
        if (!face) { out.refusals.set(f.id, `occt: sketch ${f.target} did not build`); continue; }
        if (!(Math.abs(f.kind === 'extrude' ? f.height : f.depth) > 0)) { out.refusals.set(f.id, 'occt: not run, a zero-length prism hangs OCCT (AGENTS.md: never a depth 0 fixture)'); continue; }
        if (f.kind === 'extrude') {
          const r = occtSweepShape(f, 'pull', face, sk);
          if (r.refusal) { out.refusals.set(f.id, r.refusal); continue; }
          mine.set(f.id, r.shape);
        } else {
          const base = mine.get(headOf(f.into)) ?? built.shapes.get(headOf(f.into));
          if (!base) { out.refusals.set(f.id, `occt: ${f.into} did not build`); continue; }
          let far = 0;
          if (f.through) { const m = occtMeasure(base); const o = frameN(sk).origin; for (const cx of [m.bbox[0], m.bbox[3]]) for (const cy of [m.bbox[1], m.bbox[4]]) for (const cz of [m.bbox[2], m.bbox[5]]) far = Math.max(far, V.len(V.sub([cx, cy, cz], o))); far += 1; }
          const r = occtSweepShape({ ...f, __far: far }, 'pocket', face, sk);
          if (r.refusal) { out.refusals.set(f.id, r.refusal); continue; }
          mine.set(f.id, cutOf(base, r.shape));
          heads.set(f.into, f.id);
        }
      } else if (f.kind === 'combine' && f.op === 'union') {
        const live = f.targets.map((t) => mine.get(headOf(t)) ?? built.shapes.get(headOf(t)));
        if (live.some((x) => !x)) { out.refusals.set(f.id, 'occt: a union target did not build'); continue; }
        let sh = live[0]; for (let i = 1; i < live.length; i++) sh = fuseOf(sh, live[i]);
        mine.set(f.id, sh);
      } else if (built.shapes.get(f.id)) mine.set(f.id, built.shapes.get(f.id));
    } catch (e) { out.refusals.set(f.id, `occt threw: ${e?.message ?? e}`); }
  }
  return out;
}

// ---- SolidCraft side -------------------------------------------------------------------------------------------------------
const runSC = async (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
async function viaRoute(route, doc) {
  const t0 = Date.now();
  let tr;
  try { tr = await route.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null }); } catch (e) { return { error: `translator threw: ${e.message}` }; }
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  const refusals = tr.features.filter((x) => x.status === 'refused').map((x) => ({ id: x.id, sentence: x.refusal }));
  const res = { ms: Date.now() - t0, finalId: last?.id, finalStatus: last?.status, refusals, checks: tr.features.flatMap((x) => (x.checks ?? []).map((c) => ({ feature: x.id, ...c }))), failedRaw: tr.features.filter((x) => x.status === 'refused' && x.failed).map((x) => `${x.id}: ${JSON.stringify(x.failed).slice(0, 400)}`), commands: JSON.stringify(tr.commands).slice(0, 4000) };
  if (last?.status === 'built') {
    // the SCENE: every body solidcraft holds after the accepted commands (a multi-piece result is more than the one body the translator names)
    const all = await runSC(tr.commands);
    const bs = all.ok ? all.measure.bodies : [];
    const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
    const V = bs.reduce((s, b) => s + b.volume_mm3, 0);
    const faceTypes = bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {});
    res.measure = {
      volume: V, faces: bs.reduce((s, b) => s + b.faces, 0), shells: bs.reduce((s, b) => s + (b.kernel?.shells ?? 1), 0), kernelEdges: bs.reduce((s, b) => s + (b.kernel?.edges ?? 0), 0), bbox: [...lo, ...hi], bodies: bs.map((b) => b.name), faceTypes,
      com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / V),
      curved: Object.keys(faceTypes).some((k) => k !== 'plane'), namedBodyOnly: last.measure.volume,
    };
    res.sceneOk = all.ok;
  }
  return res;
}

// ---- the cases ---------------------------------------------------------------------------------------------------------------
const { CASES } = await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases.mjs')).href);
await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases-r2.mjs')).href); // round 2: appends to CASES and re-labels the ones whose right answer is now a refusal
await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases-r3.mjs')).href); // round 3: join contact, outlines, rows without rules, slanted round tools crossing holes, loft faces
await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases-r4.mjs')).href); // round 4: tapers on holes / several shapes, shape count, flat pads, floors and steps

// round 2: volume error is a TRUE relative error (the old floor of 1 in rel() made any solid under 1 mm3 pass vacuously); a bbox that comes from
// live OCCT (no closed form) carries OCCT's own 1e-7 bounding-box gap, so it is held to 2e-7, a closed-form bbox to the usual bar.
const relV = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / (Math.abs(b) > 0 ? Math.abs(b) : 1) : Infinity);
function score(m, ref, curved, bboxFromOcct = false) {
  if (!m || !ref || ref.volume === undefined) return null;
  const t = curved ? TOL.curved : TOL.planar;
  const dVol = relV(m.volume, ref.volume);
  const dBbox = m.bbox && ref.bbox ? worst(m.bbox, ref.bbox) : null;
  const diag = ref.bbox ? Math.max(Math.hypot(ref.bbox[3] - ref.bbox[0], ref.bbox[4] - ref.bbox[1], ref.bbox[5] - ref.bbox[2]), 1) : 1;
  const dCom = m.com && ref.com ? Math.max(...m.com.map((v, i) => Math.abs(v - ref.com[i]))) / diag : null;
  const comTol = curved ? COM_TOL.curved : COM_TOL.planar;
  const tb = bboxFromOcct ? Math.max(t, 2e-7) : t;
  return { dVol, dBbox, dCom, tol: t, comTol, ok: dVol <= t && (dBbox === null || dBbox <= tb) && (dCom === null || dCom <= comTol) };
}

const rows = [];
for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue;
  const row = { id: c.id, feature: c.feature, note: c.note ?? null, script: c.script, expect: c.expect ?? 'build' };
  const r = runScript(c.script);
  if (r.errors.length) { row.scriptError = r.errors[0].message; rows.push(row); console.log(c.id.padEnd(34), 'SCRIPT ERROR:', row.scriptError); continue; }
  const doc = solveDoc(r.doc);
  const finalFeature = [...doc.features].reverse().find((f) => !['sketch', 'datum'].includes(f.kind));
  row.finalId = finalFeature.id;
  row.featureKinds = doc.features.map((f) => `${f.id}:${f.kind}`);
  row.doc = doc.features.filter((f) => f.kind === 'extrude' || f.kind === 'pocket').map((f) => { const { id, kind, target, into, ...o } = f; return { id, kind, ...o }; });
  const curvedHint = !!c.curved;
  // analytic
  row.analytic = c.analytic ? c.analytic() : null;
  // OCCT (own builder)
  try {
    const o = occtDoc(doc);
    const sh = o.shapes.get(finalFeature.id);
    row.occt = sh ? occtMeasure(sh) : { refused: o.refusals.get(finalFeature.id) ?? 'occt built nothing' };
  } catch (e) { row.occt = { refused: `occt threw: ${e.message}` }; }
  // brep-rs
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const s = got.shapes?.[finalFeature.id];
    row.brep = s ? { volume: s.volume, bbox: [...s.bbox[0], ...s.bbox[1]], faces: s.faces } : { refused: got.refusals?.[finalFeature.id] ?? 'no shape' };
  } catch (e) { row.brep = { refused: `brep-rs threw: ${e.message}` }; }
  // FreeCAD
  if (c.fc) {
    const p = path.join(FC_REFS, `ref-${c.fc}.json`);
    if (existsSync(p)) { const j = JSON.parse(readFileSync(p, 'utf8')); row.fc = j.ok ? { id: c.fc, volume: j.volume, bbox: j.bbox, faces: j.faces, com: j.com, solids: j.solids } : { id: c.fc, refused: j.error ?? JSON.stringify(j).slice(0, 200) }; }
  }
  // SolidCraft, both routes
  // round 3: a case flagged noShipped is one the shipped route would run for minutes (slanted round tool crossing a hole); it is not run there
  row.shipped = c.noShipped ? { skipped: true, refusals: [{ id: '-', sentence: '(not run: the shipped route would spend minutes in the kernel on this case)' }], checks: [] } : await viaRoute(shipped, doc);
  row.contract = await viaRoute(contract, doc);
  // scoring: the reference is analytic when given, else live OCCT; every other oracle is cross-checked against it
  const refOf = (o) => (o && o.volume !== undefined ? o : null);
  const occtRef = refOf(row.occt);
  const an = row.analytic;
  const ref = an ? { ...(occtRef ?? {}), ...an } : occtRef;
  row.refSource = !an ? 'occt' : (an.volume !== undefined && an.bbox && an.com ? 'analytic' : `analytic(${['volume', 'bbox', 'com'].filter((k) => an[k]).join('+')})+occt`);
  const curved = curvedHint || !!row.contract.measure?.curved || !!row.shipped.measure?.curved;
  row.curved = curved;
  for (const k of ['occt', 'brep', 'fc']) if (row[k] && refOf(row[k]) && ref && refOf(row[k]) !== ref) row[k].vsRef = score(row[k], ref, curved, !(an && an.bbox));
  for (const k of ['shipped', 'contract']) {
    const rt = row[k];
    if (rt.measure) {
      rt.vsRef = score(rt.measure, ref, curved, !(an && an.bbox));
      if (refOf(row.occt)) rt.vsOcct = score(rt.measure, row.occt, curved, true);
      if (refOf(row.brep)) rt.vsBrep = { dVol: relV(rt.measure.volume, row.brep.volume), dBbox: worst(rt.measure.bbox, row.brep.bbox) };
      if (!ref) rt.vsRef = null;
      if (refOf(row.fc)) rt.vsFc = score(rt.measure, row.fc, curved, false);
      rt.facesVsOcct = row.occt?.faces !== undefined ? `${rt.measure.faces}/${row.occt.faces}` : null;
      rt.featureVsScene = rel(rt.measure.namedBodyOnly, rt.measure.volume); // the translator's own per-feature measure must equal the scene (multi-piece results)
    }
  }
  rows.push(row);
  const f = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  const stat = (rt) => (rt.measure ? (rt.vsRef?.ok ? 'PASS' : 'WRONG') : rt.error ? 'ERR' : 'REFUSED');
  if (row.contract.measure && row.contract.vsRef) row.contract.vsRef.ok = row.contract.vsRef.ok && row.contract.featureVsScene <= 1e-9;
  console.log(c.id.padEnd(22), (ref?.volume ?? NaN).toFixed(4).padStart(12),
    '| shipped', stat(row.shipped).padEnd(7), '| contract', stat(row.contract).padEnd(7), f(row.contract.vsRef?.dVol), f(row.contract.vsRef?.dBbox), f(row.contract.vsRef?.dCom),
    '| occt', row.occt.refused ? 'REF' : f(row.occt.vsRef?.dVol ?? 0), 'brep', row.brep.refused ? 'REF' : f(row.brep.vsRef?.dVol ?? 0), row.fc ? `fc ${row.fc.refused ? 'REF' : f(row.fc.vsRef?.dVol ?? 0)}` : '');
}
writeFileSync(path.join(OUT, 'ep-results.json'), JSON.stringify(rows, null, 1));
console.log(`wrote ${path.join(OUT, 'ep-results.json')} (${rows.length} cases)`);
