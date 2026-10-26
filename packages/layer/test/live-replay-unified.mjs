// REAL-KERNEL replay for the 'unified' planner set. Not part of `npm test`: needs the SolidCraft wasm rig. NOT RUN by the agent that wrote it (the owner runs it).
//
//   ulimit -v 2097152   # 2 GB memory cap (the rig holds the kernel in this process and in the budgeted child processes)
//   SOLIDCRAFT_REFEREE_PKG=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg \
//     node packages/layer/test/live-replay-unified.mjs --out=/path/live-replay-unified.json [--only=id,id] [--corpus=ep,holes,sd,pm,bool,combined] [--combined=600] [--ep-join=cheap|full|off]
//   (BREP_PKG=<dir> overrides archive/brep-rs/pkg, the shell-draft group's pick source; without its wasm the replay runs without ctx.resolveAt, as the layer's own pick
//    path does when the host gives none, and the node rig answers sc.run with measures only, no topology, so a hollow or a draft that NAMES a face is refused by both sides alike.)
//   Packages sketch, script and layer must be built (dist/). Run one replay at a time. `--only` takes case ids ("hc2-then-join") and combined doc names ("combined seed 57").
//
// WHAT IT DOES. Every case of the five groups' committed corpora, as the group's own replay selects it (extrude-pocket-cases*.mjs; holes4/3/1-cases.mjs; the three
// shell-draft-cases*.mjs; pm-cases*.mjs without the scripts pm-preflight refuses and those with more than 60 copies; boolean-cases*.mjs), plus the COMBINED docs (test/unified-docs.mjs, 600 by default), each run on the SAME kernel and the SAME ModelDoc through
//   unified            createTranslator({ planners: 'unified' })
//   the single sets    createTranslator({ planners: 'extrude-pocket' | 'holes' | 'shell-draft' | 'patterns-mirror' | 'booleans' })
// and checks the two invariants of the unified set (NOTES.md "Unified"):
//   INVARIANT 2 (in-domain equality): a doc that uses ONE group's feature kinds only (domainOf) must give, through unified, the same translated commands, the same
//     per-feature status, sentence and guard, and the same scene measure (volume, faces, bodies, bbox) as that group's set. A doc that uses no group's kinds is compared
//     with the extrude-pocket set (the loop whose wording unified takes). A doc that uses two or more groups is not compared, and listed as `mixed`.
//     ACCEPTED EXCEPTIONS (NOTES.md, Unified): a difference whose first differing feature is refused by unified through PM-SNAPCUT or PM-WEB (the patterns-mirror group's cut guards bind on every pocket and
//     hole; the owner accepted this class) or through EP-JOIN (the extrude-pocket group's join checks bind on every combine; --ep-join sets the level, default 'cheap') is listed as `acceptedException`, not as `differ`.
//   INVARIANT 1 (safety): for every feature a single set refuses and that binds (unified-harness.mjs bindingRefusals: a kind the set owns, a base kind, or a cross-kind
//     guard; not a stand-in refusal of a kind another set owns, nor what depends on one), unified must refuse the feature or a feature it depends on. Any breach is
//     listed as `unifiedBuiltWhereASetRefused`, and the script exits 1. For the COMBINED docs the report also gives, per doc, the LITERAL count (features unified builds
//     that some single set refused, binding or not) and, for the docs unified builds, the scene measure.
// It does NOT score any result against an oracle (OCCT, closed forms): it shows the one loop keeps every group's decisions, and that no set's refusal is lost by merging.
// A built solid is not shown to be right by it; that is what the groups' own measure scripts (against OCCT / closed forms) did, and a unified-built combined doc has no oracle here.
//
// ENGINE. The holes corpus and the combined docs run every engine call through holes4-sc.mjs runBudgeted (one child process per run under a CPU limit; a document that
// drills runs EVERY step under { budgetS } in unified, and the single sets get the same default budget so nobody can hang the replay). The extrude-pocket and shell-draft
// corpora call sc.run in-process, as their own replays do (no budget; run under `timeout`). A mismatch in which a G-BUDGET refusal or a timed-out scene is involved is
// run once more and reported as `timing` if the second run agrees; any other mismatch is not retried.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const CONTRACT = path.join(REPO, 'docs', 'spikes', 'solidcraft-referee', 'contract');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const corpora = (arg('corpus') || 'ep,holes,sd,pm,bool,combined').split(',');
const EP_JOIN = arg('ep-join') || 'cheap';
const N_COMBINED = Number(arg('combined') || 600);
const OUT = path.resolve(arg('out') || 'live-replay-unified.json');
mkdirSync(path.dirname(OUT), { recursive: true });
for (const k of ['H4_BUDGET_S', 'H4_DOC_BUDGET_S']) if (process.env[k] !== undefined) { console.error(`FATAL: ${k} is set; the layer uses the group's default budget (45 s per run, 180 s per document)`); process.exit(2); }
if (process.env.SD_OFF) { console.error('FATAL: SD_OFF is set; the replay runs every guard on'); process.exit(2); }

const imp = (p) => import(pathToFileURL(p).href);
const load = (p) => imp(path.join(REPO, p));
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { createTranslator, domainOf, draftFromUsage } = await load('packages/layer/dist/index.js');
const { combinedDoc } = await imp(path.join(HERE, 'unified-docs.mjs'));
const { bindingRefusals, unifiedCovers } = await imp(path.join(HERE, 'unified-harness.mjs'));
const SETS = ['extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans'];
const TR = Object.fromEntries([...SETS, 'unified'].map((p) => [p, createTranslator({ planners: p })]));
const GROUP = { ep: 'extrude-pocket', holes: 'holes', sd: 'shell-draft', pm: 'patterns-mirror', bool: 'booleans' };
const ACCEPTED_GUARDS = ['PM-SNAPCUT', 'PM-WEB', 'EP-JOIN'];

// ---- engines ---------------------------------------------------------------------------------------------------------------------------------------------
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const inProcess = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const { runBudgeted } = await imp(path.join(CONTRACT, 'holes4-sc.mjs'));
const budgeted = (cmds, opts) => runBudgeted(cmds, opts ?? { budgetS: 60 });
// the patterns-mirror and booleans corpora hold cases that hang or trap the kernel (their groups ran them in a child process under a time limit): they go through the budgeted engine, one child process per run
const ENGINE = { ep: inProcess, sd: inProcess, holes: budgeted, pm: budgeted, bool: budgeted, combined: budgeted };

// the shell-draft group's pick source, when its (retired) wasm is there
const brepDir = process.env.BREP_PKG ?? path.join(REPO, 'archive', 'brep-rs', 'pkg');
let resolveAt = null;
if (existsSync(path.join(brepDir, 'brep_rs_bg.wasm'))) {
  const brep = await imp(path.join(brepDir, 'brep_rs.js'));
  brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
  resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
} else console.error(`NOTE: no brep-rs wasm in ${brepDir}: running without ctx.resolveAt (named faces are refused by both sides alike on the node rig)`);

// ---- corpora, selected the way the groups' own replays select them ---------------------------------------------------------------------------------------------
const items = [];
const add = (corpus, id, doc, fromUsage) => { if (!only.length || only.includes(id)) items.push({ corpus, id, doc, fromUsage }); };
if (corpora.includes('ep')) {
  const { CASES } = await imp(path.join(CONTRACT, 'extrude-pocket-cases.mjs'));
  for (const f of ['r2', 'r3', 'r4']) await imp(path.join(CONTRACT, `extrude-pocket-cases-${f}.mjs`));
  for (const c of CASES) {
    if (c.doc) { add('ep', c.id, c.doc); continue; }
    const r = runScript(c.script); if (r.errors.length) continue;
    add('ep', c.id, solveDoc(r.doc));
  }
}
if (corpora.includes('holes')) {
  const seen = new Set();
  for (const f of ['holes4-cases.mjs', 'holes3-cases.mjs', 'holes-cases.mjs']) {
    const { CASES } = await imp(path.join(CONTRACT, f));
    for (const c of CASES) { const key = `${c.id}\u0000${c.script}`; if (seen.has(key)) continue; seen.add(key); const r = runScript(c.script); if (r.errors.length) continue; add('holes', c.id, solveDoc(r.doc)); }
  }
}
if (corpora.includes('sd')) {
  const P = await imp(path.join(CONTRACT, 'shell-draft-polytope.mjs'));
  const { CASES_FN } = await imp(path.join(CONTRACT, 'shell-draft-cases.mjs'));
  const { STEEP_FN } = await imp(path.join(CONTRACT, 'shell-draft-cases-steep.mjs'));
  const { R2_FN } = await imp(path.join(CONTRACT, 'shell-draft-cases-r2.mjs'));
  const env = { P, sigma: -1, rel: (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1) };
  for (const c of [...CASES_FN(env), ...STEEP_FN(env), ...R2_FN(env)]) {
    const r = runScript(c.script); if (r.errors.length) continue;
    const doc0 = r.doc; if (c.patch) c.patch(doc0);
    add('sd', c.id, solveDoc(doc0), draftFromUsage(c.script));
  }
}
if (corpora.includes('pm')) {
  const { preflightScript } = await load('packages/layer/dist/index.js');
  const mods = await Promise.all(['pm-cases.mjs', 'pm-cases-r2.mjs', 'pm-cases-r3.mjs', 'pm-cases-r4.mjs', 'pm-cases-r6.mjs'].map((f) => imp(path.join(CONTRACT, f))));
  const seen = new Set();
  for (const c of mods.flatMap((m) => Object.values(m).filter(Array.isArray).flat()).filter((c) => c && typeof c.src === 'string')) {
    const key = `${c.id}\u0000${c.src}`; if (seen.has(key)) continue; seen.add(key);
    if (preflightScript(c.src)) continue;
    const r = runScript(c.src); if (r.errors.length) continue;
    const doc = solveDoc(r.doc); if (doc.features.some((f) => f.kind === 'pattern' && f.count > 60)) continue; // hundreds of copies: minutes of engine time (the group's own replay skips them without --large)
    add('pm', c.id, doc);
  }
}
if (corpora.includes('bool')) {
  const { CASES } = await imp(path.join(CONTRACT, 'boolean-cases.mjs'));
  for (const f of ['boolean-cases-r2.mjs', 'boolean-cases-r3.mjs', 'boolean-cases-r4.mjs', 'boolean-cases-r5.mjs', 'boolean-cases-r6.mjs']) await imp(path.join(CONTRACT, f));
  const seen = new Set();
  for (const c of CASES) {
    const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.features)}`; if (seen.has(key)) continue; seen.add(key);
    if (c.script === undefined) { add('bool', c.id, solveDoc({ version: 1, features: c.features })); continue; }
    const r = runScript(c.script); if (r.errors.length) continue;
    add('bool', c.id, solveDoc(r.doc));
  }
}
if (corpora.includes('combined')) for (let i = 0; i < N_COMBINED; i++) add('combined', `combined seed ${i}`, combinedDoc(i));

// ---- one run ---------------------------------------------------------------------------------------------------------------------------------------------
const feats = (tr) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.refusal ?? null, guard: x.guard ?? null }));
function sceneOf(engine, commands) {
  const all = engine(commands, { budgetS: 200 });
  if (!all.ok) return { ok: false, timedOut: !!all.timedOut };
  const bs = all.measure.bodies;
  return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]) };
}
async function outcome(set, it) {
  const engine = ENGINE[it.corpus];
  let tr;
  try { tr = await TR[set].translateDoc(structuredClone(it.doc), { arc, mt, runSC: async (cmds, o) => engine(cmds, o), soups: {}, ...(resolveAt ? { resolveAt } : {}), ...(it.fromUsage ? { fromUsage: it.fromUsage } : {}), ...(set === 'unified' ? { unifiedEpJoinChecks: EP_JOIN } : {}) }); } catch (e) { return { threw: String(e?.message ?? e) }; }
  const out = { feats: feats(tr), commands: tr.commands, notes: tr.features };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') out.scene = sceneOf(engine, tr.commands);
  return out;
}
const canon = (o) => JSON.stringify({ feats: o.feats, commands: o.commands, scene: o.scene, threw: o.threw }, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));
const budgetInvolved = (o) => (o.feats ?? []).some((f) => f.guard === 'G-BUDGET') || o.scene?.timedOut;

const rows = [];
const T = { docs: 0, inDomain: 0, equal: 0, equalAfterRerun: 0, differ: [], acceptedException: [], mixed: 0, binding: 0, unifiedBuiltWhereASetRefused: [], literalBuiltWhereASetRefused: 0, combinedBuilt: 0, threw: 0 };
const t0 = Date.now();
const save = (partial) => writeFileSync(OUT, JSON.stringify({ partial, pkg: PKG, ...T, rows }, null, 1));
for (const it of items) {
  T.docs++;
  const dom = domainOf(it.doc);
  const present = ['ep', 'holes', 'sd', 'pm', 'bool'].filter((k) => dom[k]);
  const zone = present.length === 1 ? present[0] : present.length === 0 ? 'none' : 'mixed';
  const ref = zone === 'none' ? 'extrude-pocket' : zone === 'mixed' ? null : GROUP[zone];
  const own = { ep: 'extrude-pocket', holes: 'holes', sd: 'shell-draft', pm: 'patterns-mirror', bool: 'booleans', combined: null }[it.corpus];
  const need = new Set([own, ref].filter(Boolean));
  if (zone === 'mixed' || it.corpus === 'combined') for (const s of SETS) need.add(s); // the safety check reads every set
  let u = await outcome('unified', it);
  const single = {}; for (const s of need) single[s] = await outcome(s, it);
  const row = { corpus: it.corpus, id: it.id, zone };
  // invariant 2
  if (ref) {
    T.inDomain++;
    let eq = canon(u) === canon(single[ref]);
    if (!eq && (budgetInvolved(u) || budgetInvolved(single[ref]))) { u = await outcome('unified', it); single[ref] = await outcome(ref, it); eq = canon(u) === canon(single[ref]); if (eq) T.equalAfterRerun++; }
    let accepted = false;
    if (!eq && !u.threw && !single[ref].threw) {
      // the accepted exceptions: the first differing feature is refused by unified through one of the cross-kind cut / join guards
      const key = (x) => JSON.stringify({ id: x.id, status: x.status, refusal: x.refusal, guard: x.guard });
      const k = u.feats.findIndex((x, j) => !single[ref].feats[j] || key(x) !== key(single[ref].feats[j]));
      if (k >= 0 && u.feats[k].status === 'refused' && ACCEPTED_GUARDS.includes(u.feats[k].guard)) { accepted = true; T.acceptedException.push({ id: it.id, guard: u.feats[k].guard, set: ref, setSaid: single[ref].feats[k].status }); row.acceptedException = u.feats[k].guard; }
    }
    if (eq) T.equal++; else if (!accepted) { T.differ.push(it.id); row.differ = { set: ref, unified: { feats: u.feats, scene: u.scene, threw: u.threw }, single: { feats: single[ref].feats, scene: single[ref].scene, threw: single[ref].threw } }; }
    row.equal = eq;
  } else { T.mixed++; row.mixed = present; }
  // invariant 1, and the report for the combined docs
  if (u.threw) T.threw++;
  if (!u.threw && need.size === SETS.length) {
    const literal = []; const violated = [];
    for (const s of SETS) {
      const o = single[s]; if (o.threw) continue;
      const b = bindingRefusals(s, it.doc, o.notes);
      T.binding += b.binding.length;
      o.notes.forEach((n, i) => { if (n.status === 'refused' && u.notes[i]?.status === 'built') literal.push(`${s}:${it.doc.features[i].id}`); });
      for (const i of b.binding) if (!unifiedCovers(it.doc, i, u.notes, o.notes[i].guard)) violated.push(`${s}:${it.doc.features[i].id}`);
    }
    row.literal = [...new Set(literal)];
    T.literalBuiltWhereASetRefused += row.literal.length;
    if (violated.length) { row.violated = violated; T.unifiedBuiltWhereASetRefused.push({ id: it.id, features: violated }); }
    if (it.corpus === 'combined') {
      row.unified = { feats: u.feats.map((f) => `${f.id}:${f.status}${f.guard ? `/${f.guard}` : ''}`), scene: u.scene ?? null };
      if (u.scene?.ok) T.combinedBuilt++;
    }
  }
  rows.push(row);
  if (T.docs % 10 === 0) { save(true); console.log(`${T.docs}/${items.length} docs, ${T.differ.length} in-domain differ, ${T.unifiedBuiltWhereASetRefused.length} docs with a built-where-refused, ${Math.round((Date.now() - t0) / 1000)} s`); }
}
save(false);
console.log(`DONE: ${T.docs} docs (${T.inDomain} inside one group's domain: ${T.equal} identical (${T.equalAfterRerun} only after a re-run because of the CPU budget), ${T.acceptedException.length} differ through an accepted exception (PM-SNAPCUT / PM-WEB / EP-JOIN at level ${EP_JOIN}), ${T.differ.length} differ; ${T.mixed} mixed, not compared for equality). Safety: ${T.binding} binding refusals checked, unified built-where-a-set-refused in ${T.unifiedBuiltWhereASetRefused.length} docs (MUST be 0); literal count (binding or not) ${T.literalBuiltWhereASetRefused}. ${T.combinedBuilt} combined docs built a scene. ${T.threw} unified runs threw. Wrote ${OUT}`);
process.exit(T.differ.length || T.unifiedBuiltWhereASetRefused.length ? 1 : 0);
