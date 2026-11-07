// Fillet chains and an errored body, through every planner set and the host entry, on one pkg (GUARD-FILLET-CHAIN.md). Not part of `npm test`.
//   flock <rig.lock> env SOLIDCRAFT_REFEREE_PKG=<pkg> SOLIDCRAFT_TOPOLOGY_PKG=<topology pkg> BREP_PKG=<brep-rs pkg> OUT=<file.json> \
//     node packages/layer/test/fillet-chain-run.mjs
// Cases (box 40 x 30 x 10 standing on z = 0, bottom edges, from the probe's fillet-sequence evidence):
//   B4 four bottom fillets R 1.5 (front, back, left, right), B3 the first three, B2 front + back, B2-adj front + left (one corner),
//   B2-mixed front R 1.5 then left R 1 (touching, different sizes: never one call), B4-bevel the four as bevels d 1.5;
//   far-sphere sphere(2) at (1e6, -1e6, 1e6), with the primitives guard on (production) and off (ctx.skipPrimitives, so the engine's reply is reached).
// Paths: B = the topology pkg's runSC + topologyOf (the host's ctx: followMoves, mt, arc); A = the referee pkg's runSC + ctx.resolveAt (brep-rs resolve, read-only)
// and no topologyOf (the node rig, family-c-run.mjs's path A).
// References: OCCT built directly (one BRepFilletAPI_MakeFillet over the named edges, picked by geometry) and, for B4, the fuzz closed form S.
// Verdict of a built last fillet: WRONG iff off OCCT by more than 1e-4 rel (and off S too where there is one); faces are recorded beside it.
// The far sphere's verdict: THREW (translateDoc threw), else the status and sentence. Exit 0 iff nothing is WRONG and nothing THREW.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG; const TOPO = process.env.SOLIDCRAFT_TOPOLOGY_PKG;
if (!PKG || !TOPO) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG / SOLIDCRAFT_TOPOLOGY_PKG unset'); process.exit(2); }
const OUT = path.resolve(process.env.OUT || 'fillet-chain-run.json');
mkdirSync(path.dirname(OUT), { recursive: true });
const TOL = 1e-4;
const require = createRequire(import.meta.url);
const sc = require(path.join(PKG, 'solidcraft_referee.js'));
const brepDir = process.env.BREP_PKG ?? path.join(REPO, 'archive', 'brep-rs', 'pkg');
if (!existsSync(path.join(brepDir, 'brep_rs_bg.wasm'))) { console.error(`FATAL: no brep-rs wasm in ${brepDir}; set BREP_PKG`); process.exit(2); }
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
const ocDir = path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json', { paths: [REPO] })), 'dist');
const glue = await import(pathToFileURL(path.join(ocDir, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(ocDir, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { createTranslator } = await load('packages/layer/dist/index.js');
const H = await load('packages/solidcraft-host/pane/src/host-entry.mjs');
const { oracle } = await load('docs/spikes/solidcraft-referee/fuzz/oracle.mjs');
const { loadUpstream } = await import(pathToFileURL(path.join(HERE, 'topology-upstream.mjs')).href);
const up = loadUpstream(TOPO);

const runA = async (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
const rel = (a, b) => (a == null || b == null ? null : Math.abs(a - b) / Math.abs(b));

// ---- OCCT direct: the named bottom edges of the box in ONE MakeFillet (what the doc asks for; see family-c-run.mjs occtDirect) -----------------
const MID = { front: [0, -15, 0], back: [0, 15, 0], left: [-20, 0, 0], right: [20, 0, 0] };
function occtDirect(sides, R) {
  const box = new oc.BRepPrimAPI_MakeBox(40, 30, 10).Shape();
  const exp = new oc.TopExp_Explorer(box, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); const edges = [];
  while (exp.More()) { const e = exp.Current(); if (!edges.some((u) => u.IsSame(e))) edges.push(e.clone()); exp.Next(); }
  const centre = (s) => { const g = new oc.GProp_GProps(); oc.BRepGProp.LinearProperties(s, g, false, false); const c = g.CentreOfMass(); return [c.X() - 20, c.Y() - 15, c.Z()]; };
  const mk = new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  for (const s of sides) {
    const e = edges.find((x) => Math.hypot(...centre(x).map((v, i) => v - MID[s][i])) < 1e-9);
    if (!e) throw new Error(`OCCT direct: no edge at ${s}`);
    mk.Add(R, oc.TopoDS.Edge(e));
  }
  mk.Build(new oc.Message_ProgressRange());
  if (mk.IsDone && !mk.IsDone()) return null;
  const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(mk.Shape(), g, 1e-7, false, false);
  return g.Mass();
}
const S4 = oracle({ t: 1, mode: 'convex', convex: { W: 40, D: 30, H: 10, kind: 'bfillet', s: 1.5 }, holes: [], opens: [{ axis: 'z', dir: 1, coord: 10, rect: [-20, 20, -15, 15], minus: [] }] }).S;

const boxScript = (lines) => `const b = box(40, 30, 10, { at: [0, 0, 5] });\n${lines.join('\n')}`;
const fl = (side, r, style = 'fillet') => `${style}(b.edge('bottom','${side}'), ${r});`;
const cases = [
  { id: 'B4', script: boxScript(['front', 'back', 'left', 'right'].map((s) => fl(s, 1.5))), occt: () => occtDirect(['front', 'back', 'left', 'right'], 1.5), S: S4, faces: 10 },
  { id: 'B3', script: boxScript(['front', 'back', 'left'].map((s) => fl(s, 1.5))), occt: () => occtDirect(['front', 'back', 'left'], 1.5), faces: 9 },
  { id: 'B2', script: boxScript(['front', 'back'].map((s) => fl(s, 1.5))), occt: () => occtDirect(['front', 'back'], 1.5), faces: 8 },
  { id: 'B2-adj', script: boxScript(['front', 'left'].map((s) => fl(s, 1.5))), occt: () => occtDirect(['front', 'left'], 1.5), faces: 8 },
  { id: 'B2-mixed', script: boxScript([fl('front', 1.5), fl('left', 1)]), occt: null },
  { id: 'B4-bevel', script: boxScript(['front', 'back', 'left', 'right'].map((s) => fl(s, 1.5, 'bevel'))), occt: null, faces: 10 },
  { id: 'far-sphere', script: 'sphere(2, { at: [1000000, -1000000, 1000000] });', far: true },
];
const SETS = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TRS = Object.fromEntries(SETS.map((s) => [s, createTranslator({ planners: s })]));

const rows = [];
for (const c of cases) {
  const r = runScript(c.script);
  if (r.errors.length) { rows.push({ id: c.id, cls: 'NODOC', msg: r.errors[0].message }); continue; }
  const doc = solveDoc(r.doc);
  let ref = null; try { ref = c.occt ? c.occt() : null; } catch (e) { ref = null; }
  const runs = [];
  const one = async (label, fn) => {
    const t0 = Date.now(); let tr = null; let threw = null;
    try { tr = await fn(); } catch (e) { threw = String(e?.stack ?? e).slice(0, 400); }
    const last = tr?.features.at(-1);
    const blends = tr ? tr.commands.filter((x) => x.command === 'solid.fillet' || x.command === 'solid.chamfer') : [];
    const row = { label, ms: Date.now() - t0, threw,
      feats: tr ? tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, guard: f.guard ?? null, refusal: f.refusal ?? null, volume: f.measure?.volume ?? null, faces: f.measure?.faces ?? null, group: f.group ?? null })) : null,
      blendCalls: blends.length, edgesPerCall: blends.map((x) => x.params.edges.length), lastStatus: last?.status ?? null, volume: last?.status === 'built' ? last.measure?.volume ?? null : null, faces: last?.status === 'built' ? last.measure?.faces ?? null : null };
    if (c.far) row.cls = threw ? 'THREW' : (last?.status ?? 'NONE');
    else if (threw) row.cls = 'THREW';
    else if (last?.status !== 'built') row.cls = 'REFUSED';
    else if (ref == null && c.S == null) row.cls = 'BUILT-NO-REF';
    else { const rO = rel(row.volume, ref); const rS = rel(row.volume, c.S); row.relOcct = rO; row.relS = rS; row.cls = (rO == null || rO > TOL) && (rS == null || rS > TOL) ? 'WRONG' : 'MATCH'; }
    runs.push(row);
    console.log(`${c.id.padEnd(10)} ${label.padEnd(30)} ${row.cls.padEnd(12)} V=${row.volume ?? '-'} faces=${row.faces ?? '-'} calls=${row.blendCalls} [${row.edgesPerCall.join(',')}] ${row.relOcct != null ? 'rO=' + row.relOcct.toExponential(2) : ''} ${row.threw ? 'THREW ' + row.threw.split('\n')[0] : ''} ${row.feats ? row.feats.filter((f) => f.status !== 'built').map((f) => `${f.id}:${f.status}/${f.guard ?? ''}: ${String(f.refusal ?? '').slice(0, 140)}`).join(' | ') : ''}`);
  };
  const ctxB = (extra = {}) => ({ arc, mt, runSC: up.runSC, topologyOf: up.topologyOf, soups: {}, followMoves: true, fromUsage: [], ...extra });
  const ctxA = (extra = {}) => ({ arc, mt, runSC: runA, resolveAt, soups: {}, fromUsage: [], ...extra });
  const variants = c.far ? [{ tag: '', extra: {} }, { tag: ' -primitives', extra: { skipPrimitives: true } }] : [{ tag: '', extra: {} }];
  for (const v of variants) {
    await one(`host${v.tag}`, () => H.translateDoc(structuredClone(doc), ctxB(v.extra)));
    for (const s of SETS) await one(`B ${s}${v.tag}`, () => TRS[s].translateDoc(structuredClone(doc), ctxB(v.extra)));
    for (const s of SETS) await one(`A ${s}${v.tag}`, () => TRS[s].translateDoc(structuredClone(doc), ctxA(v.extra)));
  }
  rows.push({ id: c.id, script: c.script, occt: ref, S: c.S ?? null, expectFaces: c.faces ?? null, runs });
}
const all = rows.flatMap((r) => (r.runs ?? []).map((x) => ({ id: r.id, ...x })));
const counts = {}; for (const x of all) counts[x.cls] = (counts[x.cls] ?? 0) + 1;
writeFileSync(OUT, JSON.stringify({ pkg: PKG, topo: TOPO, brep: brepDir, tolerance: TOL, counts, rows }, null, 1));
const bad = all.filter((x) => x.cls === 'WRONG' || x.cls === 'THREW').length;
console.log(`DONE ${all.length} runs ${JSON.stringify(counts)} -> ${OUT}`);
process.exit(bad ? 1 : 0);
