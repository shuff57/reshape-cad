// Shell family C re-measure (next-work loop, phase 1, 2026-11-06). Not part of `npm test` (skipped by the *.test.mjs glob).
//   flock ~/.cache/solidcraft-0.30.1-rig/rig.lock \
//     env SOLIDCRAFT_REFEREE_PKG=<pkg dir> BREP_PKG=<brep-rs pkg dir> OUT=<file.json> node packages/layer/test/family-c-run.mjs
//   NEGATIVE_CONTROL=1 scales both OCCT numbers by 1.01 (the run must then report WRONG and exit 1).
// See docs/spikes/solidcraft-referee/fuzz/NEXT-LOOP-PHASE1.md.
//
// Every case is ONE reSHape Script, turned into ONE ModelDoc, and measured three ways:
//   layer = createTranslator({ planners: 'shell-draft' }) on the SolidCraft rig, named-edge fillets picked through ctx.resolveAt (brep-rs resolve,
//           wired by shell-draft.ts filletEdgeAt); the scene volume of the accepted commands;
//   OCCT  = packages/brep-adapter/dist/occt-build.js buildDoc on the SAME ModelDoc (loaded from dist/ by path, as the frozen gates load it),
//           volume by BRepGProp (exact, not a mesh);
//   P     = docs/spikes/solidcraft-referee/fuzz/oracle.mjs (plane-offset model, h = 0.05), for the cases that have a fuzz model.
// The unshelled part (the shell's target) is measured on the layer and on OCCT too, so a shell error can be told from a fillet error.
// For the repros, the raw command list (one solid.fillet call over four edges, guard-bypassed) is also run on the rig: that is the kernel probe
// the documented 1.0-1.9e-3 came from.
// Verdict per case (tolerance 1e-3 rel, the fuzz README's): WRONG iff the layer BUILDS the shell and |layer - OCCT| / OCCT > 1e-3, OCCT being the
// direct build where there is one (see occtDirect for why buildDoc's solid is not the doc's here) and buildDoc otherwise; both are recorded.
// Then (when the wrapper2 topology build is present) the SHIPPED path: the 'unified' set, edges from the engine's own topology, no ctx.resolveAt.
// Exit 0 iff 0 WRONG on both.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const PIN = process.env.SOLIDCRAFT_PIN || '0.30.1'; // the pinned SolidCraft release; the default rig follows it
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG || path.join(process.env.HOME, `.cache/solidcraft-${PIN}-rig/sc-referee-pkg`);
const OUT = path.resolve(process.env.OUT || 'family-c-run.json');
mkdirSync(path.dirname(OUT), { recursive: true });
const NEG = process.env.NEGATIVE_CONTROL === '1';
const TOL = 1e-3;
const require = createRequire(import.meta.url);

const sc = require(path.join(PKG, 'solidcraft_referee.js'));
const brepDir = process.env.BREP_PKG ?? path.join(REPO, 'archive', 'brep-rs', 'pkg');
if (!existsSync(path.join(brepDir, 'brep_rs_bg.wasm'))) { console.error(`FATAL: no brep-rs wasm in ${brepDir} (the pick source); set BREP_PKG`); process.exit(2); }
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
// the frozen gate's own lookup (scripts/occt-modeldoc-gate.mjs packagedKernel): the package exports no ./dist subpath, so go through package.json
const ocDir = process.env.RESHAPE_KERNEL_DIR ?? path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json', { paths: [REPO] })), 'dist');
const glue = await import(pathToFileURL(path.join(ocDir, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(ocDir, f) });

const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { createTranslator } = await load('packages/layer/dist/index.js');
const { oracle } = await load('docs/spikes/solidcraft-referee/fuzz/oracle.mjs');
const layer = createTranslator({ planners: 'shell-draft' });

const runSC = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
const brepResolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
const sceneVol = (cmds) => { const r = runSC(cmds); return r.ok ? r.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) : null; };
function occtVol(shape) { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false); return g.Mass(); }
// OCCT, built directly from the fuzz model (bottom-fillet plates only): what the doc ASKS for, in OCCT's own calls. Needed because buildDoc's
// per-feature fillet propagates along the tangent chain: after two parallel bottom edges are rounded, rounding a third bottom edge also rounds the
// two vertical edges it reaches through the first fillets' arcs (measured: round3 of a 40x30x10 R 1.5 adds two quarter-cylinder faces of area 20.0
// at (-19.45, +-14.45, 5.75)), so buildDoc's solid is not the doc's solid on these cases. Here the four bottom edges (picked by geometry: an edge
// whose centre lies on z = 0) go into ONE BRepFilletAPI_MakeFillet (four edges meeting at right angles: no tangent chain to the vertical edges),
// a through hole is a cylinder cut, and the hollow is the same MakeThickSolidByJoin call occt-build.ts makes, the face at z = H removed.
function occtDirect(model) {
  const { W: L, D: W, H, kind, s: R } = model.convex ?? {};
  if (model.mode !== 'convex' || kind !== 'bfillet') return null;
  const box = new oc.BRepPrimAPI_MakeBox(L, W, H).Shape(); // grows from the origin corner; volumes do not care, holes are shifted to match
  const shapes = (s, type) => { const out = []; const exp = new oc.TopExp_Explorer(s, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); while (exp.More()) { const e = exp.Current(); if (!out.some((u) => u.IsSame(e))) out.push(e.clone()); exp.Next(); } return out; };
  const centre = (s, lin) => { const g = new oc.GProp_GProps(); if (lin) oc.BRepGProp.LinearProperties(s, g, false, false); else oc.BRepGProp.SurfaceProperties(s, g, false, false); const c = g.CentreOfMass(); return [c.X(), c.Y(), c.Z()]; };
  const bottom = shapes(box, oc.TopAbs_ShapeEnum.TopAbs_EDGE).filter((e) => Math.abs(centre(e, true)[2]) < 1e-9);
  if (bottom.length !== 4) throw new Error(`direct OCCT: ${bottom.length} bottom edges, not 4`);
  const mk = new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  for (const e of bottom) mk.Add(R, oc.TopoDS.Edge(e));
  mk.Build(new oc.Message_ProgressRange());
  if (mk.IsDone && !mk.IsDone()) return { error: 'fillet not done' };
  let pre = mk.Shape();
  for (const h of model.holes ?? []) {
    if (h.type !== 'cyl' || (h.axis ?? 'z') !== 'z') return { error: `hole ${h.type}/${h.axis} not built directly` };
    const cyl = new oc.BRepPrimAPI_MakeCylinder(h.r, h.range[1] - h.range[0]).Shape();
    const tr = new oc.gp_Trsf(); tr.SetTranslation(new oc.gp_Vec(h.c[0] + L / 2, h.c[1] + W / 2, h.range[0]));
    const cut = new oc.BRepAlgoAPI_Cut(pre, new oc.BRepBuilderAPI_Transform(cyl, tr, false).Shape());
    cut.Build(new oc.Message_ProgressRange());
    pre = cut.Shape();
  }
  const top = shapes(pre, oc.TopAbs_ShapeEnum.TopAbs_FACE).filter((f) => Math.abs(centre(f, false)[2] - H) < 1e-9);
  if (top.length !== 1) throw new Error(`direct OCCT: ${top.length} faces at z = H, not 1`);
  const op = new oc.BRepOffsetAPI_MakeThickSolid();
  const closing = new oc.NCollection_List_TopoDS_Shape(); closing.Append(top[0]);
  op.MakeThickSolidByJoin(pre, closing, -model.t, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false);
  op.Build(new oc.Message_ProgressRange());
  if (!op.IsDone()) return { pre: occtVol(pre), error: 'thick solid not done' };
  return { pre: occtVol(pre), built: occtVol(op.Shape()), preFaces: shapes(pre, oc.TopAbs_ShapeEnum.TopAbs_FACE).length };
}
const rel = (a, b) => (a === null || b === null || a === undefined || b === undefined ? null : Math.abs(a - b) / Math.abs(b));

// ---- cases -------------------------------------------------------------------------------------------------------------
const cases = [];
const SIDES = ['front', 'back', 'left', 'right'];
const bfilletScript = (L, W, H, R, t, extra = '') => `const b = box(${L}, ${W}, ${H}, { at: [0, 0, ${H / 2}] });\n`
  + SIDES.map((e) => `fillet(b.edge('bottom','${e}'), ${R});`).join('\n') + `\n${extra}hollow(b, { wall: ${t}, open: 'top' });`;
const openTop = (L, W, H) => ({ axis: 'z', dir: 1, coord: H, rect: [-L / 2, L / 2, -W / 2, W / 2], minus: [] });
const bfilletModel = (L, W, H, R, t, holes = []) => ({ t, mode: 'convex', convex: { W: L, D: W, H, kind: 'bfillet', s: R }, holes, opens: [openTop(L, W, H)] });
const add = (c) => cases.push(c);

// control: a plain open box (all three must agree)
add({ id: 'control-plain-box-t1', family: 'control', script: 'const b = box(40, 30, 10, { at: [0, 0, 5] });\nhollow(b, { wall: 1, open: \'top\' });',
  model: { t: 1, mode: 'rect', boxes: [[-20, 20, -15, 15, 0, 10]], cuts: [], opens: [openTop(40, 30, 10)], holes: [], rbosses: [] } });
// the plain R = 1.5t bottom fillet, every wall the fuzz generator draws (fuzz-guard-run.mjs's plate, 40 x 30 x 10)
for (const t of [0.5, 1, 1.5, 2, 2.5]) add({ id: `C-plain-40x30x10-t${t}-R${1.5 * t}`, family: 'C', script: bfilletScript(40, 30, 10, 1.5 * t, t), model: bfilletModel(40, 30, 10, 1.5 * t, t) });
// the documented family-C repros (fuzz/repros/p8-*.json; s2-01562 regenerated by gen.mjs: no repro file was kept)
const repro = (f) => JSON.parse(readFileSync(path.join(REPO, 'docs/spikes/solidcraft-referee/fuzz/repros', f), 'utf8'));
for (const [f, L, W, H] of [['p8-s1-00475.json', 30, 24, 12], ['p8-s2-00591.json', 30, 24, 6]]) {
  const rp = repro(f);
  add({ id: `C-repro-${rp.id}`, family: 'C', script: bfilletScript(L, W, H, 0.75, 0.5), model: bfilletModel(L, W, H, 0.75, 0.5), raw: rp.commands, documented: rp.p8 });
}
{
  const h = { type: 'cyl', axis: 'z', c: [5.65, -5.15], r: 2.5, range: [-1, 7] };
  const raw = [{ command: 'solid.box', params: { length: 24, width: 20, height: 6, center: [0, 0, 3], body_name: 'b1' } },
    { command: 'solid.fillet', params: { edges: [[0, 10, 0], [0, -10, 0], [12, 0, 0], [-12, 0, 0]], radius: 0.75, body: 'b1' } },
    { command: 'solid.cylinder', params: { radius: 2.5, height: 8, base: [5.65, -5.15, -1], axis: [0, 0, 1], body_name: 'f1' } },
    { command: 'solid.combine', params: { target: 'b1', tools: ['f1'], operation: 'cut' } },
    { command: 'solid.shell', params: { faces: [[-3.429, 1.463, 6]], thickness: 0.5, body: 'b1' } }];
  add({ id: 'C-gen-s2-01562', family: 'C (+through hole)', script: bfilletScript(24, 20, 6, 0.75, 0.5, 'hole(b, { across: 5, deep: 8, at: [5.65, -5.15] });\n'), model: bfilletModel(24, 20, 6, 0.75, 0.5, [h]), raw });
}
// the two borderline family-B rows on a bottom fillet (blind hole), regenerated by gen.mjs: R = 1.5t (s1-01725) and R = t (s2-00829)
add({ id: 'B-gen-s1-01725', family: 'B (bfillet + blind)', script: bfilletScript(30, 16, 10, 1.5, 1, 'hole(b, { across: 5, deep: 7.55, at: [5.45, 2.5] });\n'),
  model: bfilletModel(30, 16, 10, 1.5, 1, [{ type: 'cyl', axis: 'z', c: [5.45, 2.5], r: 2.5, range: [2.45, 11] }]) });
add({ id: 'B-gen-s2-00829', family: 'B (bfillet + blind)', script: bfilletScript(30, 24, 8, 2, 2, 'hole(b, { across: 3, deep: 4.1, at: [9, 6.5] });\n'),
  model: bfilletModel(30, 24, 8, 2, 2, [{ type: 'cyl', axis: 'z', c: [9, 6.5], r: 1.5, range: [3.9, 9] }]) });

// ---- run ---------------------------------------------------------------------------------------------------------------
const rows = [];
for (const c of cases) {
  const t0 = Date.now();
  const row = { id: c.id, family: c.family };
  try { const o = oracle(c.model); row.oracle = { S: o.S, P: o.P }; } catch (e) { row.oracle = { error: String(e.message || e).slice(0, 200) }; }
  const r = runScript(c.script);
  if (r.errors.length) { row.cls = 'NODOC'; row.msg = r.errors[0].message; rows.push(row); continue; }
  const doc = solveDoc(r.doc);
  const shellF = doc.features.find((f) => f.kind === 'shell');
  // layer
  let tr = null;
  try { tr = await layer.translateDoc(structuredClone(doc), { arc, mt, runSC: async (cmds) => runSC(cmds), resolveAt: brepResolveAt, soups: {}, fromUsage: [] }); } catch (e) { row.layerThrew = String(e.message || e).slice(0, 200); }
  if (tr) {
    row.features = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, guard: f.guard ?? null, refusal: f.refusal ?? null, pickedFrom: f.pickedFrom ?? null, pick: f.pick?.edges ?? null }));
    const sh = tr.features.find((f) => f.kind === 'shell');
    const tgt = tr.features.find((f) => f.id === shellF.target);
    row.layer = { pre: tgt?.measure?.volume ?? null, shellStatus: sh?.status ?? null, built: sh?.status === 'built' ? sceneVol(tr.commands) : null };
  }
  // OCCT
  try {
    const res = buildDoc(oc, structuredClone(doc), arc);
    const s = res.shapes.get(shellF.id); const pre = res.shapes.get(shellF.target);
    row.occt = { pre: pre ? occtVol(pre) : null, built: s ? occtVol(s) * (NEG ? 1.01 : 1) : null, refusals: Object.fromEntries(res.refusals ?? []) };
  } catch (e) { row.occt = { error: String(e.message || e).slice(0, 200) }; }
  // OCCT built directly from the model (see occtDirect)
  try { row.occtDirect = occtDirect(c.model); if (row.occtDirect?.built != null && NEG) row.occtDirect.built *= 1.01; } catch (e) { row.occtDirect = { error: String(e.message || e).slice(0, 200) }; }
  // raw kernel probe (the repro's own command list)
  if (c.raw) row.raw = { built: sceneVol(c.raw), pre: sceneVol(c.raw.filter((x) => x.command !== 'solid.shell')), documented: c.documented ?? null };
  row.rel = {
    layerVsOcct: rel(row.layer?.built, row.occt?.built), layerVsP: rel(row.layer?.built, row.oracle?.P), occtVsP: rel(row.occt?.built, row.oracle?.P),
    preLayerVsOcct: rel(row.layer?.pre, row.occt?.pre), preLayerVsS: rel(row.layer?.pre, row.oracle?.S), preOcctVsS: rel(row.occt?.pre, row.oracle?.S),
    rawVsOcct: rel(row.raw?.built, row.occt?.built), rawVsP: rel(row.raw?.built, row.oracle?.P),
    layerVsDirect: rel(row.layer?.built, row.occtDirect?.built), directVsP: rel(row.occtDirect?.built, row.oracle?.P), rawVsDirect: rel(row.raw?.built, row.occtDirect?.built),
    preLayerVsDirect: rel(row.layer?.pre, row.occtDirect?.pre), preDirectVsS: rel(row.occtDirect?.pre, row.oracle?.S), preBuildDocVsDirect: rel(row.occt?.pre, row.occtDirect?.pre),
  };
  // the OCCT number a verdict is taken against: the direct build where there is one (buildDoc's solid is not the doc's on a bottom-fillet plate, see
  // occtDirect), else buildDoc's. Both are recorded.
  row.occtRef = row.occtDirect?.built != null ? 'direct' : 'buildDoc';
  const ref = row.occtRef === 'direct' ? row.occtDirect.built : row.occt?.built;
  row.rel.layerVsRef = rel(row.layer?.built, ref);
  const fillets = (row.features ?? []).filter((f) => f.kind === 'fillet');
  if (!tr) row.cls = 'ERROR';
  else if (fillets.some((f) => f.status !== 'built')) row.cls = 'NOT-REACHED';
  else if (row.layer.shellStatus !== 'built') row.cls = 'REFUSED';
  else if (row.layer.built === null) row.cls = 'ENGINE-FAIL';
  else if (ref == null) row.cls = 'NO-OCCT';
  else row.cls = row.rel.layerVsRef <= TOL ? 'MATCH' : 'WRONG';
  row.ms = Date.now() - t0;
  rows.push(row);
  const e = (v) => (v === null || v === undefined ? '-' : v.toExponential(2));
  console.log(`${c.id.padEnd(30)} ${row.cls.padEnd(11)} layer=${row.layer?.built ?? '-'} occt[${row.occtRef}]=${ref ?? '-'} P=${row.oracle?.P ?? '-'} | L/ref ${e(row.rel.layerVsRef)} L/P ${e(row.rel.layerVsP)} direct/P ${e(row.rel.directVsP)} | buildDoc=${row.occt?.built ?? '-'} L/bd ${e(row.rel.layerVsOcct)} | pre L/direct ${e(row.rel.preLayerVsDirect)} direct/S ${e(row.rel.preDirectVsS)} bd/direct ${e(row.rel.preBuildDocVsDirect)} | raw ${row.raw?.built ?? '-'} raw/direct ${e(row.rel.rawVsDirect)} | ${row.ms} ms`);
}
// ---- the shipped path: the 'unified' set with the engine's own topology (no ctx.resolveAt), on the wrapper2 build of the rig -------------------
// (test/topology-upstream.mjs; NOTES.md "Moved picks"). Skipped when that package is absent. Scored against the same OCCT reference.
const TOPO = process.env.SOLIDCRAFT_TOPOLOGY_PKG ?? path.join(process.env.HOME, `.cache/solidcraft-${PIN}-rig/sc-referee-pkg-topology`);
const shipped = { pkg: TOPO, set: 'unified', rows: [] };
if (existsSync(path.join(TOPO, 'solidcraft_referee_p2.js'))) {
  const { loadUpstream } = await import(pathToFileURL(path.join(HERE, 'topology-upstream.mjs')).href);
  const up = loadUpstream(TOPO);
  const uni = createTranslator({ planners: 'unified' });
  for (const c of cases.filter((x) => x.family.startsWith('C'))) {
    const row = rows.find((x) => x.id === c.id);
    const doc = solveDoc(runScript(c.script).doc);
    const tr = await uni.translateDoc(structuredClone(doc), { arc, mt, runSC: up.runSC, topologyOf: up.topologyOf, soups: {}, fromUsage: [] });
    const sh = tr.features.find((f) => f.kind === 'shell');
    let vol = null;
    if (sh?.status === 'built') { const r = await up.runSC(tr.commands); vol = r.ok ? r.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) : null; }
    const ref = row.occtRef === 'direct' ? row.occtDirect.built : row.occt?.built;
    const out = { id: c.id, statuses: tr.features.map((f) => `${f.id}:${f.status}${f.guard ? '/' + f.guard : ''}`).join(' '), vol, relOcct: rel(vol, ref), relP: rel(vol, row.oracle?.P) };
    out.cls = sh?.status !== 'built' ? 'REFUSED' : vol === null ? 'ENGINE-FAIL' : out.relOcct <= TOL ? 'MATCH' : 'WRONG';
    shipped.rows.push(out);
    console.log(`shipped ${c.id.padEnd(30)} ${out.cls.padEnd(8)} vol=${vol} L/ref ${out.relOcct?.toExponential(2)} L/P ${out.relP?.toExponential(2)} | ${out.statuses}`);
  }
} else console.log(`shipped path not measured: no ${TOPO}/solidcraft_referee_p2.js`);
const shippedWrong = shipped.rows.filter((x) => x.cls === 'WRONG').length;

const n = (k) => rows.filter((x) => x.cls === k).length;
const counts = Object.fromEntries(['MATCH', 'WRONG', 'REFUSED', 'NOT-REACHED', 'NO-OCCT', 'ENGINE-FAIL', 'NODOC', 'ERROR'].map((k) => [k, n(k)]));
writeFileSync(OUT, JSON.stringify({ pkg: PKG, brep: brepDir, occt: ocDir, negativeControl: NEG, tolerance: TOL, cases: rows.length, counts, rows, shipped }, null, 1));
console.log(`DONE ${rows.length} cases ${JSON.stringify(counts)}; shipped path ${shipped.rows.length} cases, ${shippedWrong} WRONG -> ${OUT}`);
process.exit(n('WRONG') + shippedWrong > 0 ? 1 : 0);
