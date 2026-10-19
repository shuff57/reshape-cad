// Round 5 shared rig, group 'sketch-constraints'. Referee only.
//   SOLIDCRAFT_REFEREE_PKG=<dir with solidcraft_referee.js>   the supplied pre-built referee pkg (wasm-bindgen --target nodejs of wrapper/, fe3717f). NOTHING ELSE IS NEEDED.
//   The pkg's `run` returns only the final measure (or the first failed command). Round 3 needed the wrapper2 `@sketch` dump (solved points, SolveReport, profile list),
//   which no longer exists; round 5 drops that dependency:
//     - per-command results are recovered by running the whole list and, when a command is refused, removing it and running again (wrapper2 also kept going after a refusal);
//     - the SOLVED sketch comes from an independent least-squares solve of the same rows (contract/sketch-geometry.solve.mjs), not from SolidCraft;
//     - SolidCraft's answer is checked AFTER the build against that independent expectation (volume, bbox, bodies, faces): a build that differs is refused.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../../../..');
export const SPIKE = path.join(REPO, 'docs/spikes/solidcraft-referee');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
export const imp = (p) => import(pathToFileURL(p).href);
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const sc1 = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
export const mapper = await imp(path.join(SPIKE, 'phase2/sketch-map.mjs'));
export const ruleCheck = await imp(path.join(SPIKE, 'phase2/rule-check.mjs'));
export const { runScript } = await imp(path.join(REPO, 'packages/script/dist/reshape-script.js'));
export const modelCodegen = await imp(path.join(REPO, 'packages/script/dist/model-codegen.js'));
export const solveMod = await imp(path.join(REPO, 'packages/sketch/dist/sketch-solve.js'));
export const arcMod = await imp(path.join(REPO, 'packages/sketch/dist/sketch-arc.js'));
export const mt = await imp(path.join(REPO, 'packages/script/dist/model-types.js'));
const BPKG = path.join(REPO, 'archive/brep-rs/pkg');
export const brep = await imp(path.join(BPKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(BPKG, 'brep_rs_bg.wasm')) });
const { SketchSession2D } = await imp(path.join(REPO, 'packages/brep-adapter/dist/sketch-session.js'));
const { BrepRsEngineAdapter } = await imp(path.join(REPO, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));
const stub = { BufferGeometry: class { setAttribute() {} setIndex() {} computeVertexNormals() {} addGroup() {} }, Float32BufferAttribute: class {} };
const adapter = new BrepRsEngineAdapter(stub); adapter.loadFromBytes(brep);
export { SketchSession2D, adapter };

export const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
/** true relative difference |a-b|/|b| (no floor: the max(|b|,1) floor of rel() turns it into an absolute bar for solids under 1 mm3) */
export const relT = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1e-300) : Infinity);
export const ex = (x) => (typeof x === 'number' ? x.toExponential(1) : String(x));
export const f6 = (x) => (typeof x === 'number' ? +x.toPrecision(10) : Array.isArray(x) ? x.map(f6) : x);

/**
 * Per-command results from the supplied pkg, whose `run` stops at the first refused command and returns only the final measure.
 * wrapper2 kept going after a refusal; this does the same: run the whole list, and when command k is refused record its error, drop it and run the rest again.
 * `@sketch` pseudo-commands are not available on this pkg: they come back as ok with out.error = 'no evaluated sketch' (nothing in round 5 reads them).
 */
export function scRaw(commands) {
  const results = commands.map((c, i) => ({ i, command: c.command, ok: true, out: c.command === '@sketch' ? { error: 'no evaluated sketch' } : {} }));
  const live = commands.map((c, i) => i).filter((i) => commands[i].command !== '@sketch');
  let measure = null;
  for (let guard = 0; guard < 64; guard++) {
    let r;
    try { r = JSON.parse(sc1.run(JSON.stringify({ commands: live.map((i) => commands[i]) }))); } catch (e) { return { ok: false, error: `WASM TRAP: ${e.message}`, results, measure: null }; }
    if (r.failed) { const gi = live[r.failed.index]; results[gi] = { i: gi, command: commands[gi].command, ok: false, error: r.failed.error }; live.splice(r.failed.index, 1); continue; }
    measure = r.ok ? { ok: true, out: r.measure } : { ok: false, error: r.error ?? 'no measure' };
    break;
  }
  return { ok: true, results, measure };
}
/** sum of all bodies of a measure */
export function bodiesOf(measure) {
  const bs = measure?.out?.bodies ?? measure?.bodies ?? null;
  if (!bs || !bs.length) return null;
  const volume = bs.reduce((a, b) => a + b.volume_mm3, 0);
  return { bodies: bs.length, volume, faces: bs.reduce((a, b) => a + b.faces, 0),
    bbox: [...[0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i]))), ...[0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])))],
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / volume) };
}
import { solveSoup } from './solve5.mjs';
/** INDEPENDENT solve of the soup rows (no SolidCraft): { solved, residual, residualAfter, moved, rank, dof, dofMoved, converged, scale }. Driving rules only; references (driving:false) and inactive rows are not equations. */
export function indepSolve(geoms, rules) {
  return solveSoup({ geoms: clone(geoms), rules: clone(rules) });
}
/**
 * UNGUARDED route (what round 1 measured): map + run + extrude. Returns mapperRefused | firstRefusal | {report, solved, profiles, volume...}.
 * extra: optional extrude params (e.g. profiles) ; stops reading at the first refused command.
 */
export function scSketch(geoms, rules, { plane = 'xy', height = 10, extrude = true, extrudeExtra = null, mapOpts = {} } = {}) {
  const m = mapper.mapSketch({ id: 'p', plane, geoms: clone(geoms), rules: clone(rules) }, { name: 'sk', ...mapOpts });
  if (!m.ok) return { mapperRefused: m.refusals.map((r) => r.sentence), map: m };
  const cmds = extrude ? mapper.extrudeCommands(m, { height }) : [...m.commands];
  if (extrudeExtra) { const e = cmds.find((c) => c.command === 'solid.extrude'); if (e) Object.assign(e.params, extrudeExtra); }
  const r = scRaw(cmds);
  const res = r.results ?? [];
  const bad = res.find((x) => !x.ok && x.command !== '@sketch');
  const firstRefusal = bad ? { index: bad.i, command: bad.command, error: bad.error, rule: m.ruleMap.findIndex((ix) => ix && ix.includes(bad.i)) } : null;
  const ext = res.find((x) => x.command === 'solid.extrude');
  const body = bodiesOf(r.measure);
  return {
    map: m, results: res, firstRefusal, dump: null, cmds,
    report: null,        // round 5: SolidCraft's SolveReport is not readable on this pkg
    solved: null,        // round 5: callers that need a solved sketch call indepSolve()
    profiles: [],
    extrudeError: ext && !ext.ok ? ext.error : null,
    body,
  };
}
/** brep-rs sketch session on soup geoms+rules: open + solve + diagnose + solved rows. */
export function brepSolve(geoms, rules) {
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  const o = { open: s.open(clone(geoms), clone(rules)) };
  if (!o.open) { o.solved = s.solve(); if (o.solved) { try { o.geoms = s.solvedGeoms(); } catch { /* */ } } else o.lastError = s.lastError(); o.diag = s.diagnose(); }
  s.close();
  return o;
}
/** brep-rs build of a doc */
export function brepBuild(doc) {
  try {
    const built = adapter.build(doc);
    const refusals = Object.fromEntries(built.refusals ?? []);
    const last = doc.features.at(-1).id;
    if (Object.keys(refusals).length) return { outcome: 'refused', refusal: Object.values(refusals).join(' | ') };
    if (!built.shapes.has(last)) return { outcome: 'refused', refusal: 'no shape built and no refusal sentence' };
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (!m) return { outcome: 'error', refusal: 'no measurement' };
    return { outcome: 'built', volume: m.volume, faces: m.faces ?? m.face_count, bbox: [...m.bbox[0], ...m.bbox[1]] };
  } catch (e) { return { outcome: 'error', refusal: String(e).slice(0, 200) }; }
}
