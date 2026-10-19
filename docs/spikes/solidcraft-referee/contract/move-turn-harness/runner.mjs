// move-turn measurement harness. Runs in place: cd docs/spikes/solidcraft-referee/contract/move-turn-harness && SOLIDCRAFT_REFEREE_PKG=<pkg> bun <script>.mjs
// brep-rs wasm: BREP_RS_PKG, default archive/brep-rs/pkg (packages/brep-rs moved to archive/).
// reSHape Script -> runScript -> ModelDoc -> {OCCT, brep-rs, translate.mjs -> solidcraft}
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc as phase0TranslateDoc } from '../../phase0/translate.mjs';
import { translateDoc as guardTranslateDoc } from './translate-guard.mjs';
// MT_GUARD=1: every script that does not name its own translator runs the GUARD translator instead of the unpatched phase0 one (round 4: regression of the invariant on the 'supported' rows)
const shippedTranslateDoc = process.env.MT_GUARD === '1' ? guardTranslateDoc : phase0TranslateDoc;
import { init, occtMeasure, faceVerdict } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
export const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { toScript } = await load('packages/script/dist/reshape-script-gen.js');
const brepDir = process.env.BREP_RS_PKG ?? path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
init(oc, facesOf);
export { runScript, toScript, solveDoc, buildDoc, brep, sc };

const rel = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const worstArr = (a, b) => Math.max(...b.map((w, i) => rel(a?.[i], w)));
const runSCDirect = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
// SC_BOX_MS=<ms>: every solidcraft call runs in a child process that is killed at the limit (round 3: stands in for a Worker that is terminated).
// A killed call returns {ok:false, failed:{error:'TIME_LIMIT'}}. Wall times of the calls are collected in scCalls.
export const scCalls = [];
const BOX = Number(process.env.SC_BOX_MS || 0);
const runSCBoxed = (cmds) => {
  const t0 = Date.now();
  const r = spawnSync('bun', [path.join(HERE, 'sc-child.mjs')], { input: JSON.stringify({ commands: cmds }), timeout: BOX, killSignal: 'SIGKILL', maxBuffer: 1 << 28, env: process.env });
  const ms = Date.now() - t0;
  if (r.error || r.signal) { scCalls.push({ ms, timedOut: true }); return { ok: false, failed: { command: '(time limit)', error: `TIME_LIMIT after ${BOX} ms` } }; }
  const cpu = /CPU_MS:(\d+)/.exec(String(r.stderr))?.[1];
  scCalls.push({ ms, cpuMs: cpu ? Number(cpu) : undefined });
  try { return JSON.parse(r.stdout.toString()); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `no output: ${String(r.stderr).slice(0, 200)}` } }; }
};
export const runSC = BOX ? runSCBoxed : runSCDirect;
const flat = (b) => [...b[0], ...b[1]];

/** Run one script. ids: feature ids (or handle ids) to measure. translateFn: translateDoc by default. */
export function runCase({ script, ids, translateFn = shippedTranslateDoc, values, mutate }) {
  const r = runScript(script, values ? { values } : {});
  const out = { params: r.params, namedParams: r.namedParams, errors: r.errors.map((e) => e.message ?? String(e)), warnings: r.warnings ?? [] };
  if (r.errors.length) return out;
  const doc0 = mutate ? mutate(r.doc) : r.doc; // mutate: round 3, lets a probe rewrite the ModelDoc (e.g. prism own-rotate instead of a RotateFeature step)
  out.features = doc0.features.map((f) => ({ id: f.id, kind: f.kind, ...(f.offset ? { offset: f.offset } : {}), ...(f.angles ? { angles: f.angles } : {}), ...(f.rotate ? { rotate: f.rotate } : {}), ...(f.center ? { center: f.center } : {}), ...(f.copy !== undefined ? { copy: f.copy } : {}), ...(f.target ? { target: f.target } : {}) }));
  const lastId = doc0.features[doc0.features.length - 1].id;
  ids = ids ?? [lastId];
  const built = buildDoc(oc, doc0, arc);
  out.occtRefusals = built.refusals ? Object.fromEntries(built.refusals) : {};
  const oc_ = {};
  for (const id of ids) { const s = built.shapes.get(id); if (s) oc_[id] = occtMeasure(s); }
  out.occt = oc_;
  let bj = null;
  try { bj = JSON.parse(brep.measure_doc(JSON.stringify(doc0))); } catch (e) { bj = { error: e.message }; }
  out.brep = {};
  for (const id of ids) {
    const s = bj.shapes?.[id];
    out.brep[id] = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces, dVol: oc_[id] ? rel(s.volume, oc_[id].volume) : null, dBbox: oc_[id] ? worstArr(flat(s.bbox), oc_[id].bbox) : null } : { refused: bj.refusals?.[id] ?? bj.error ?? 'no shape' };
  }
  const doc = solveDoc(doc0);
  const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
  const tr = translateFn(doc, { arc, mt, runSC, resolveAt });
  out.truckFeatures = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal }));
  out.commands = tr.commands;
  out.measures = Object.fromEntries(tr.features.filter((x) => x.measure).map((x) => [x.id, { volume: x.measure.volume, com: x.measure.com, bbox: x.measure.bbox, bodies: x.measure.bodies }]));
  out.truck = {};
  for (const id of ids) {
    const mf = tr.features.find((f) => f.id === id);
    const o = oc_[id];
    if (!mf || mf.status !== 'built') { out.truck[id] = { refused: mf?.refusal ?? `${id} not built` }; continue; }
    const m = mf.measure;
    if (!o) { out.truck[id] = { built: true, volume: m.volume, note: 'no OCCT shape' }; continue; }
    const diag = Math.max(Math.hypot(o.bbox[3] - o.bbox[0], o.bbox[4] - o.bbox[1], o.bbox[5] - o.bbox[2]), 1);
    const dCom = Math.max(...m.com.map((v, i) => Math.abs(v - o.com[i]))) / diag;
    const fv = faceVerdict(m.faceTypes, o);
    out.truck[id] = { volume: m.volume, occtVolume: o.volume, dVol: rel(m.volume, o.volume), dBbox: worstArr(m.bbox, o.bbox), dCom, faces: m.faces, occtFaces: o.faces, faceTypes: m.faceTypes, occtTypes: o.types, faceOk: fv.ok, faceKeys: fv.keys, curved: m.curved, bodies: m.bodies, bbox: m.bbox, occtBbox: o.bbox };
  }
  return out;
}
export const f = (v) => (typeof v === 'number' ? v.toExponential(2) : String(v));
