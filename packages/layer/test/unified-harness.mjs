// Shared by unified.test.mjs and live-replay-unified.mjs: the corpora of the three groups and the combined docs, the four engine
// configurations, and how a set is run on a doc through the fake engine. No kernel, no wasm.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { fakeResolveAt } from './fake-resolve-at.mjs';
import { handDocs, generatedDoc } from './docs.mjs';
import { epDoc } from './ep-docs.mjs';
import { holeDoc } from './holes-docs.mjs';
import { sdDoc, sdFromUsage } from './sd-docs.mjs';
import { combinedDoc } from './unified-docs.mjs';
import { pmDoc } from './pm-docs.mjs';
import { boolDoc } from './bool-docs.mjs';
import { rgDoc, rgCombinedDoc } from './rg-docs.mjs';
import { fcDoc, fcCombinedDoc } from './fc-docs.mjs';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../../..');
export const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
export const imp = (p) => import(pathToFileURL(p).href);
const dist = (f) => imp(path.join(here, '../dist', f));

export const lib = {
  tr: await dist('translator.js'),
  un: await dist('unified.js'),
  sd: await dist('shell-draft.js'),
  h: await dist('holes.js'),
  arc: await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js')),
  mt: await imp(path.join(root, 'packages/script/dist/model-types.js')),
  script: await imp(path.join(root, 'packages/script/dist/reshape-script.js')),
  codegen: await imp(path.join(root, 'packages/script/dist/model-codegen.js')),
};
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;

export const SETS = ['extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer'];
export const TR = Object.fromEntries([...SETS, 'unified', 'base'].map((p) => [p, lib.tr.createTranslator({ planners: p })]));

// ---- the four engine configurations (as the earlier differentials: the models on, the default fake, a failing engine, a CPU budget) -------------------------------
const cutCount = (cmds) => cmds.filter((c) => c.command === 'solid.hole' || (c.command === 'solid.cylinder' && c.params?.operation === 'cut')).length;
export const CONFIGS = [
  { name: 'all models, mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true }, useMt: true, resolver: fakeResolveAt },
  { name: 'default fake, mt, no resolver', fake: {}, useMt: true, resolver: null },
  { name: 'all models, every 5th call fails, no mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, failEvery: 5 }, useMt: false, resolver: fakeResolveAt },
  { name: 'all models, cpu budget (20 s per cut command), mt, resolver down', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, cpuMs: (cmds) => 50 + 20000 * cutCount(cmds) }, useMt: true, resolver: () => null },
  // the patterns-mirror group's fusing model on top of the others (copies that touch along an edge, a gap that closes, an aligned sliver), and a pattern of five or more copies that runs past its time limit
  { name: 'all models + pmModel, mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, pmModel: true }, useMt: true, resolver: fakeResolveAt },
  { name: 'all models + pmModel, a pattern of 5 or more copies runs past the time limit, no mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, pmModel: true, cpuMs: (cmds) => (cmds.some((c) => c.command.startsWith('solid.pattern') && (c.params.count ?? c.params.count1) >= 5) ? 700000 : 10) }, useMt: false, resolver: fakeResolveAt },
  // the booleans group's model on top (pieces, keep_tools, coincident faces, a sliver the engine ignores, a keep that overshoots), and a bridge that dies on every 7th call (the executor's WASM TRAP path)
  { name: 'all models + pmModel + boolModel, mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, pmModel: true, boolModel: true }, useMt: true, resolver: fakeResolveAt },
  { name: 'all models + boolModel, the bridge dies on every 7th call, no mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, boolModel: true, throwWhen: (cmds, k) => k % 7 === 0 }, useMt: false, resolver: fakeResolveAt },
  // the revolve-groove group's model on top (a ring that cuts nothing, a cut that leaves pieces, cylinders and spins with their closed-form volumes), and a groove run that goes past its time limit
  { name: 'all models + pmModel + boolModel + rgModel, mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, pmModel: true, boolModel: true, rgModel: true }, useMt: true, resolver: fakeResolveAt },
  { name: 'all models + rgModel, a groove run past its time limit, no mt, resolver', fake: { fcModel: true, holeModel: true, boxBool: true, shellDraft: true, boolModel: true, rgModel: true, cpuMs: (cmds) => (cmds[cmds.length - 1].command === 'solid.revolve' && cmds[cmds.length - 1].params?.operation === 'cut' ? 700000 : 10) }, useMt: false, resolver: fakeResolveAt },

  // the fillet-chamfer group's model: a blend that adds no face (the post-build net), with the measure in the topology reply; the default fake above has no measure in the reply and no face added (the missing-measure fail-open the port closes)
  { name: 'all models + fcModel noface (a blend adds no face), mt, resolver', fake: { holeModel: true, boxBool: true, shellDraft: true, fcModel: 'noface' }, useMt: true, resolver: fakeResolveAt },
];

/** which of the extrude-pocket group's join checks unified applies to a combine ('cheap' is the default of the set; UNIFIED_EP_JOIN=full|off measures the other readings) */
export const EP_JOIN_LEVEL = process.env.UNIFIED_EP_JOIN ?? 'cheap';
const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
/** One run of one set on one doc on a fresh fake engine: { result (no _state), error, log }. */
export async function runSet(set, doc, cfg, fromUsage, extra = {}) {
  const fake = makeFake({ ...cfg.fake });
  const ctx = { arc: lib.arc, runSC: fake.runSC, topologyOf: fake.topologyOf, soups: {}, ...(cfg.useMt ? { mt: lib.mt } : {}), ...(cfg.resolver ? { resolveAt: cfg.resolver } : {}), ...(fromUsage ? { fromUsage } : {}), ...(set === 'unified' ? { unifiedEpJoinChecks: EP_JOIN_LEVEL } : {}), ...extra };
  let result; let error = null;
  // the patterns-mirror set notes the wall milliseconds of the run that built a feature; a fixed clock keeps two runs of the same doc comparable
  const realNow = Date.now; Date.now = () => 0;
  try { const { _state, ...rest } = await TR[set].translateDoc(structuredClone(doc), ctx); result = rest; } catch (e) { error = errOf(e); } finally { Date.now = realNow; }
  return { result, error, log: fake.log };
}

// ---- corpora -----------------------------------------------------------------------------------------------------------------------------------------------------
/** [{ corpus, name, doc, fromUsage }] for every corpus of the three groups (as their differential tests select them) and the combined docs. */
export async function loadCorpora({ combined = 600, only = null } = {}) {
  const out = [];
  const add = (corpus, name, doc, fromUsage) => { if (!only || only.has(`${corpus}:${name}`) || only.has(name)) out.push({ corpus, name, doc, fromUsage }); };
  // extrude-pocket: its cases (ep-results.json), 240 generated outlines, the hand docs
  for (const c of JSON.parse(fs.readFileSync(path.join(contract, 'ep-results.json'), 'utf8'))) {
    const r = runScript(c.script); if (r.errors.length) continue;
    add('ep-cases', `case ${c.id}`, solveDoc(r.doc));
  }
  for (let i = 0; i < 240; i++) add('ep-generated', `ep seed ${5000 + i}`, epDoc(5000 + i));
  // holes: round 4 / 3 / 1 cases, 300 generated hole docs
  const seen = new Set();
  for (const file of ['holes4-cases.mjs', 'holes3-cases.mjs', 'holes-cases.mjs']) {
    const { CASES } = await imp(path.join(contract, file));
    for (const c of CASES) {
      const key = `${c.id}\u0000${c.script}`; if (seen.has(key)) continue; seen.add(key);
      const r = runScript(c.script); if (r.errors.length) continue;
      add('holes-cases', `case ${c.id}`, solveDoc(r.doc));
    }
  }
  for (let i = 0; i < 300; i++) add('holes-generated', `hole seed ${i}`, holeDoc(i));
  // shell-draft: its three case files, 420 generated docs
  const poly = await imp(path.join(contract, 'shell-draft-polytope.mjs'));
  const { CASES_FN } = await imp(path.join(contract, 'shell-draft-cases.mjs'));
  const { STEEP_FN } = await imp(path.join(contract, 'shell-draft-cases-steep.mjs'));
  const { R2_FN } = await imp(path.join(contract, 'shell-draft-cases-r2.mjs'));
  const env = { P: poly, sigma: -1, rel: (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1) };
  for (const c of [...CASES_FN(env), ...STEEP_FN(env), ...R2_FN(env)]) {
    const r = runScript(c.script); if (r.errors.length) continue;
    const doc0 = r.doc; if (c.patch) c.patch(doc0);
    add('sd-cases', `case ${c.id}`, solveDoc(doc0), lib.sd.draftFromUsage(c.script));
  }
  for (let i = 0; i < 420; i++) { const doc = sdDoc(i); add('sd-generated', `sd seed ${i}`, doc, sdFromUsage(i, doc)); }
  // patterns-mirror: its case scripts (those that run and have at most 40 copies: a repeat of hundreds is a real-engine case), 400 generated docs
  const pmc = await Promise.all(['pm-cases.mjs', 'pm-cases-r2.mjs', 'pm-cases-r3.mjs', 'pm-cases-r4.mjs', 'pm-cases-r6.mjs'].map((f) => imp(path.join(contract, f))));
  const pmSeen = new Set();
  for (const c of pmc.flatMap((m) => Object.values(m).filter(Array.isArray).flat()).filter((c) => c && typeof c.src === 'string')) {
    const key = `${c.id}\u0000${c.src}`; if (pmSeen.has(key)) continue; pmSeen.add(key);
    const r = runScript(c.src); if (r.errors.length) continue;
    const doc = solveDoc(r.doc); if (doc.features.some((f) => f.kind === 'pattern' && f.count > 40)) continue;
    add('pm-cases', `case ${c.id}`, doc);
  }
  for (let i = 0; i < 400; i++) add('pm-generated', `pm seed ${i}`, pmDoc(i));
  // booleans: its case scripts (all rounds), 720 generated docs
  const { CASES: BCASES } = await imp(path.join(contract, 'boolean-cases.mjs'));
  for (const f of ['boolean-cases-r2.mjs', 'boolean-cases-r3.mjs', 'boolean-cases-r4.mjs', 'boolean-cases-r5.mjs', 'boolean-cases-r6.mjs']) await imp(path.join(contract, f));
  const bSeen = new Set();
  for (const c of BCASES) {
    const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.features)}`; if (bSeen.has(key)) continue; bSeen.add(key);
    if (c.script === undefined) { add('bool-cases', `case ${c.id}`, solveDoc({ version: 1, features: c.features })); continue; }
    const r = runScript(c.script); if (r.errors.length) continue;
    add('bool-cases', `case ${c.id}`, solveDoc(r.doc));
  }
  for (let i = 0; i < 720; i++) add('bool-generated', `bool seed ${i}`, boolDoc(i));
  // revolve-groove: its case scripts (all rounds; the rig's own list), 600 generated docs
  const rigDir = path.join(contract, 'revolve-groove-rig');
  const { allCases } = await imp(path.join(rigDir, 'rg-cases.mjs'));
  const rgSrc = [...allCases('/nonexistent-rg-dir', [])];
  for (const f of ['cases-r3.mjs', 'cases-r3-chainprobe.mjs', 'cases-r3-fuzz.mjs', 'cases-r3-sliver.mjs', 'cases-r3-spinfuzz.mjs', 'cases-r4-graze.mjs', 'cases-r5-regress.mjs', 'cases-r5-wall.mjs']) rgSrc.push(...(await imp(path.join(rigDir, f))).cases);
  const rSeen = new Set();
  for (const c of rgSrc) {
    if (typeof c.src !== 'string') continue;
    const key = `${c.id}\u0000${c.src}`; if (rSeen.has(key)) continue; rSeen.add(key);
    const r = runScript(c.src); if (r.errors.length) continue;
    add('rg-cases', `case ${c.id}`, solveDoc(r.doc));
  }
  for (let i = 0; i < 600; i++) add('rg-generated', `rg seed ${i}`, rgDoc(i));
  // the combined documents (several groups' kinds) with a groove cut into the part they end with, a spin before it, a second groove after
  for (let i = 0; i < 400; i++) add('rg-combined', `rg combined seed ${i}`, rgCombinedDoc(i));
  // fillet-chamfer: its case files (every round of the group's evidence), the three fuzz kinds of its generator, 600 generated docs, 400 combined docs with blends
  {
    const fcDir = path.join(contract, 'fillet-chamfer-evidence');
    const fSeen = new Set();
    const addFc = (c) => {
      const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.doc)}`; if (fSeen.has(key)) return; fSeen.add(key);
      if (c.doc) { add('fc-cases', `case ${c.id}`, solveDoc({ version: 1, features: c.doc.features ?? c.doc })); return; }
      if (typeof c.script !== 'string') return;
      const r = runScript(c.script); if (r.errors.length) return;
      add('fc-cases', `case ${c.id}`, solveDoc(r.doc));
    };
    for (const f of ['cases.mjs', 'cases-r2.mjs', 'cases-r2b.mjs', 'cases-r2c.mjs', 'cases-r3.mjs', 'cases-r3f.mjs', 'cases-seq.mjs', 'cases-fc.mjs', 'live/fc4-cases-a.mjs', 'live/fc4-cases-b.mjs', 'live/fc4-cases-c.mjs', 'live/fc4-cases-regress.mjs']) { try { for (const c of (await imp(path.join(fcDir, f))).CASES) addFc(c); } catch { /* a case file that does not load is skipped */ } }
    const keep = { FZ: process.env.FZ, SEED: process.env.SEED, N: process.env.N };
    for (const fz of ['single', 'group', 'pocket']) { process.env.FZ = fz; process.env.SEED = '2027'; process.env.N = '100'; for (const c of (await import(`${pathToFileURL(path.join(fcDir, 'live/fc4-cases-fuzz.mjs')).href}?fz=${fz}`)).CASES) addFc(c); }
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  for (let i = 0; i < 600; i++) add('fc-generated', `fc seed ${i}`, fcDoc(i));
  for (let i = 0; i < 400; i++) add('fc-combined', `fc combined seed ${i}`, fcCombinedDoc(i));
  // the shared hand docs, the base generator
  for (const [name, doc] of handDocs()) add('hand', `hand ${name}`, doc);
  for (let i = 0; i < 160; i++) add('base-generated', `generated seed ${1000 + i}`, generatedDoc(1000 + i));
  // combined
  for (let i = 0; i < combined; i++) add('combined', `combined seed ${i}`, combinedDoc(i));
  return out;
}

// ---- the two invariants -------------------------------------------------------------------------------------------------------------------------------------
/** Which kinds each set OWNS (has a planner of its own for). A kind no set owns is a base kind. */
export const OWNS = { 'extrude-pocket': ['extrude', 'pocket'], holes: ['hole'], 'shell-draft': ['shell', 'draft'], 'patterns-mirror': ['pattern', 'mirror'], booleans: ['combine'], 'revolve-groove': ['revolve', 'groove'], 'fillet-chamfer': ['fillet'] };
const ALL_OWNED = Object.values(OWNS).flat();
/** The guards that look at kinds their set does not own (the shell-draft loop's G-VOID and G-CHAMFER, the execution budget of the holes and patterns-mirror loops, the patterns-mirror cut guards on a pocket / hole, the revolve-groove chain: a refused groove refuses a later feature on the same part). */
export const CROSS_KIND_GUARDS = ['G-VOID', 'G-CHAMFER', 'G-BUDGET', 'PM-SNAPCUT', 'PM-WEB', 'RG-CHAIN', 'FC-KNIFE-RIM', 'FC-WHOLE-CHAMFER', 'FC-NEGATIVE', 'FC-TOO-SMALL'];

/** UNIFIED_NO_CHAIN_TAINT=1 measures what the chain taint of bindingRefusals changes (NOTES.md Fold 6) */
const CHAIN_TAINT = process.env.UNIFIED_NO_CHAIN_TAINT !== '1';
// the failure can also sit in a guard's probe (the holes group's G-TOP probe re-runs the engine and refuses when the re-run fails)
const INJECTED = /injected failure on call|fake: unreachable executed/;
/** Every string a feature mentions except its own id (what it reads). */
function mentions(f) {
  const out = new Set();
  const walk = (v, key) => { if (typeof v === 'string') { if (key !== 'id') out.add(v); } else if (Array.isArray(v)) v.forEach((x) => walk(x, key)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k); };
  walk(f, '');
  return out;
}

/**
 * Invariant 1 for one set S on one doc. Returns the refusals of S that BIND unified, and those that do not, and why:
 *   binding     S refuses a feature of a kind S owns, or of a kind no set owns, or any feature through one of S's cross-kind guards (CROSS_KIND_GUARDS).
 *   stand-in    S refuses a kind ANOTHER set owns, through the base planner or a stand-in sentence (the holes set refuses every closed hollow with G-CLOSED, the
 *               extrude-pocket and holes sets refuse a whole-body draft the base does not map): S has no guard for that kind, so there is nothing to lose.
 *   injected    S refuses because the fake engine failed on a call NUMBER (failEvery: every 5th call fails). Which call that is depends on how many runs the set made before, so it
 *               is not a decision of a guard; unified makes other calls and meets other failures.
 *   downstream  S refuses a feature that reads a stand-in refusal (directly or through others): it may be refused only because of it.
 */
export function bindingRefusals(set, doc, notes) {
  const taint = new Set(); const binding = []; const standIn = []; const downstream = []; const injected = [];
  doc.features.forEach((f, i) => {
    const n = notes[i];
    if (!n || n.status !== 'refused') return;
    const reads = mentions(f);
    const dep = [...reads].some((s) => taint.has(s));
    // the extrude-pocket group's fork also planned `combine`; there its SAFETY checks (join contact, a flush step, a join that does not add up, a slanted round pull) are kept as guards on the booleans group's
    // kind (unified.ts EP_COMBINE_SAFETY) and bind; the rest of what it says about a combine is capability and engine reply, which the booleans executor decides differently
    const epJoin = set === 'extrude-pocket' && f.kind === 'combine' && EP_JOIN_LEVEL !== 'off'
      && (lib.un.EP_COMBINE_SAFETY.some((re) => re.test(n.refusal ?? '')) || (EP_JOIN_LEVEL === 'full' && lib.un.EP_COMBINE_CONSISTENCY.some((re) => re.test(n.refusal ?? ''))));
    const own = OWNS[set].includes(f.kind) || !ALL_OWNED.includes(f.kind) || epJoin;
    // a refused groove leaves its part's handle pointing at itself (the revolve-groove group's chain): what is refused later on that part is refused BECAUSE of it, so when the groove's own refusal does not bind
    // (an injected failure, a dependency on a stand-in refusal, a kind another set owns) the part is tainted too
    const mark = () => { taint.add(f.id); if (CHAIN_TAINT && f.kind === 'groove' && typeof f.into === 'string') taint.add(f.into); };
    if (INJECTED.test(JSON.stringify([n.failed ?? null, n.raw ?? null, n.probe ?? null]))) { mark(); injected.push(i); return; }
    if (dep) { mark(); downstream.push(i); return; }
    if (!own && !CROSS_KIND_GUARDS.includes(n.guard)) { mark(); standIn.push(i); return; }
    binding.push(i);
  });
  return { binding, standIn, downstream, injected };
}

/**
 * The features feature i depends on: everything it mentions and what those mention, in turn (the ancestors); and the earlier features that use the same
 * inputs as it or as an ancestor (a pocket, a hole or a hollow of the same part changes it in place or uses it up: the refusal of one may be the reason the other
 * is refused or built). The co-users are not followed further.
 */
export function dependencies(doc, i) {
  const fs = doc.features; const idx = new Map(fs.map((f, k) => [f.id, k]));
  const anc = new Set([i]); const todo = [i];
  while (todo.length) {
    const k = todo.pop();
    for (const s of mentions(fs[k])) { const j = idx.get(s); if (j !== undefined && j < k && !anc.has(j)) { anc.add(j); todo.push(j); } }
  }
  const out = new Set([...anc].filter((k) => k !== i));
  for (const k of anc) for (const s of mentions(fs[k])) if (idx.has(s)) for (let q = 0; q < k; q++) if (q !== i && mentions(fs[q]).has(s)) out.add(q);
  return out;
}

/**
 * Invariant 1 for one binding refusal of S at feature i (a note with its guard): does unified refuse it ('itself'), or a feature it depends on ('dependency'), or
 * (G-BODIES counts every body of the scene) any earlier feature ('scene')? null = a violation.
 */
export function unifiedCovers(doc, i, uniNotes, guard) {
  if (uniNotes[i]?.status === 'refused') return 'itself';
  for (const j of dependencies(doc, i)) if (uniNotes[j]?.status === 'refused') return 'dependency';
  if (guard === 'G-BODIES') for (let j = 0; j < i; j++) if (uniNotes[j]?.status === 'refused') return 'scene';
  return null;
}
