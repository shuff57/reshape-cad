// REAL-KERNEL replay for fold 2 (holes). Not part of `npm test`: needs the SolidCraft wasm rig. NOT RUN by the agent that wrote it (the owner runs it).
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir, contract/RIG.md> node packages/layer/test/live-replay-holes.mjs --out=<file.json> [--only=id,id]
// Runs every case of the holes group (holes4-cases.mjs, which contains holes3-cases.mjs; holes-cases.mjs is added when it has a case the others lack)
// twice on the SAME kernel and the SAME ModelDoc:
//   original = docs/spikes/solidcraft-referee/contract/holes4-translate.mjs  translateDocGuarded   (synchronous)
//   layer    = packages/layer (compiled), createTranslator({ planners: 'holes' })                   (asynchronous)
// and requires the same translated commands, the same per-feature status, sentence and guard, and the same scene measure (volume, faces, bodies, bbox).
// It does NOT score either against an oracle (that was holes4-run.mjs against OCCT / brep-rs / the closed forms). It only shows the port changes nothing on a
// real kernel.
//
// Both sides run the engine through holes4-sc.mjs runBudgeted: one child process per engine run, under a CPU-time limit (G-BUDGET). That is the engine the
// original was measured with, and it is the one place a result can depend on the machine (a run close to the budget may time out on one side and not on the
// other). A mismatch in which either side has a G-BUDGET refusal is therefore run again once, and reported as `timing` rather than `differ` if the second run
// agrees; nothing else is retried.
//
// Docs that contain a feature phase0 and phase 4 plan differently (a shell's opened face, a fillet's edge, a draft's face by name, a constrained-sketch pull)
// are not compared: the original resolves names through brep-rs (ctx.resolveAt, archive/brep-rs/pkg), the layer through the engine's own topology. They are
// listed as `excluded` with the reason. See NOTES.md.
//
// Named exception (owner-approved, c5ab5d23, the same one holes.differential.test.mjs carries): a closed hollow's original sentence prints the missing
// reason as the word "undefined"; only that sentence is rewritten before the comparison and the row is marked H4-CLOSED-SENTENCE. Everything else in the
// row still has to match.
//
// Needs: SOLIDCRAFT_REFEREE_PKG; packages/{sketch,script,layer}/dist built (npm run build). Memory: the child processes are the engine; run one replay at a time.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const CONTRACT = path.join(REPO, 'docs', 'spikes', 'solidcraft-referee', 'contract');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const OUT = path.resolve(arg('out') || 'live-replay-holes.json');
mkdirSync(path.dirname(OUT), { recursive: true });
for (const k of ['H4_BUDGET_S', 'H4_DOC_BUDGET_S']) if (process.env[k] !== undefined) { console.error(`FATAL: ${k} is set; the layer uses the group's default budget (45 s per run, 180 s per document)`); process.exit(2); }

const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const original = await import(pathToFileURL(path.join(CONTRACT, 'holes4-translate.mjs')).href);
const { runBudgeted } = await import(pathToFileURL(path.join(CONTRACT, 'holes4-sc.mjs')).href);
const { createTranslator } = await load('packages/layer/dist/index.js');
const layer = createTranslator({ planners: 'holes' });

// the cases: round 4 is a superset of round 3; round 1 is added case by case when its id or script is new
const cases = []; const seen = new Set();
for (const f of ['holes4-cases.mjs', 'holes3-cases.mjs', 'holes-cases.mjs']) {
  const { CASES } = await import(pathToFileURL(path.join(CONTRACT, f)).href);
  for (const c of CASES) { const key = `${c.id}\u0000${c.script}`; if (!seen.has(key)) { seen.add(key); cases.push(c); } }
}

// where phase0 and phase 4 plan a non-hole feature differently (same rule as holes.differential.test.mjs)
const isSoup = (sk) => sk && sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function differences(doc) {
  const out = []; const sketches = {};
  for (const f of doc.features) {
    if (f.kind === 'sketch') sketches[f.id] = f;
    if (f.kind === 'shell' && f.open) out.push('shell with an open face');
    if (f.kind === 'fillet') out.push('fillet');
    if (f.kind === 'draft' && f.face && !f.whole) out.push('draft with a face');
    if (['extrude', 'pocket', 'revolve', 'groove'].includes(f.kind) && isSoup(sketches[f.target])) out.push(`${f.kind} of a constrained sketch`);
    if (f.kind === 'blend' && (f.targets ?? []).some((t) => isSoup(sketches[t]))) out.push('blend of a constrained sketch');
  }
  return [...new Set(out)];
}

const engine = (cmds, opts) => runBudgeted(cmds, opts);
async function sceneOf(commands) {
  const all = engine(commands, { budgetS: 200 });
  if (!all.ok) return { ok: false, timedOut: !!all.timedOut };
  const bs = all.measure.bodies;
  return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]) };
}
const feats = (tr) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.refusal ?? null, guard: x.guard ?? null }));
// canonical outcome of one translator on one doc
async function outcome(isOriginal, doc) {
  let tr;
  try {
    tr = isOriginal
      ? original.translateDocGuarded(structuredClone(doc), { arc, mt, runSC: engine, resolveAt: () => null }, {})
      : await layer.translateDoc(structuredClone(doc), { arc, mt, runSC: async (cmds, o) => engine(cmds, o), soups: {} });
  } catch (e) { return { threw: String(e?.message ?? e) }; }
  const out = { feats: feats(tr), commands: tr.commands };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') out.scene = await sceneOf(tr.commands);
  return out;
}
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));
const budgetInvolved = (o) => (o.feats ?? []).some((f) => f.guard === 'G-BUDGET') || o.scene?.timedOut;

// Named exception (owner-approved, c5ab5d23; same rule as holes.differential.test.mjs): the
// original's closed-hollow sentence prints its missing reason as "undefined"; the layer words it
// without one. Only the sentence is rewritten here -- status, guard, commands and scene must still
// match, or the row stays a differ.
const closedText = (id) => `${id} (hollow): a hollow with no open side is not built here, so ${id} is shown without it -- add open:'top' (or 'bottom', 'front', 'back', 'left', 'right') to leave one side open.`;
function closedSentenceException(a, b) {
  const fa = (a.feats ?? []).find((f) => f.guard === 'G-CLOSED');
  if (!fa || !/and undefined, so/.test(fa.refusal ?? '')) return false;
  const fb = (b.feats ?? []).find((f) => f.id === fa.id && f.guard === 'G-CLOSED');
  if (!fb || fb.refusal !== closedText(fb.id)) return false;
  fa.refusal = fb.refusal;
  return true;
}

const rows = []; let same = 0, differ = 0, timing = 0, noDoc = 0, excluded = 0, exceptions = 0;
const t0 = Date.now();
for (const c of cases) {
  if (only.length && !only.includes(c.id)) continue;
  const r = runScript(c.script);
  if (r.errors.length) { noDoc++; rows.push({ id: c.id, skipped: `script error: ${r.errors[0].message}` }); continue; }
  const doc = solveDoc(r.doc);
  const diff = differences(doc);
  if (diff.length) { excluded++; rows.push({ id: c.id, excluded: diff }); continue; }
  let a = await outcome(true, doc);
  let b = await outcome(false, doc);
  let exception = closedSentenceException(a, b);
  let eq = canon(a) === canon(b);
  let retried = false;
  if (!eq && (budgetInvolved(a) || budgetInvolved(b))) { retried = true; a = await outcome(true, doc); b = await outcome(false, doc); exception = closedSentenceException(a, b); eq = canon(a) === canon(b); }
  if (eq) { same++; if (retried) timing++; if (exception) exceptions++; } else differ++;
  rows.push(eq
    ? { id: c.id, same: true, retried, ...(exception ? { exception: 'H4-CLOSED-SENTENCE' } : {}), status: a.feats?.map((f) => f.status).join(',') ?? a.threw, guards: (a.feats ?? []).map((f) => f.guard).filter(Boolean), volume: a.scene?.volume ?? null }
    : { id: c.id, same: false, retried, original: a, layer: b });
  if ((same + differ) % 10 === 0) { writeFileSync(OUT, JSON.stringify({ partial: true, same, differ, timing, noDoc, excluded, exceptions, rows }, null, 1)); console.log(`${same + differ} cases, ${differ} differ, ${Math.round((Date.now() - t0) / 1000)} s`); }
}
writeFileSync(OUT, JSON.stringify({ pkg: PKG, cases: same + differ, same, differ, timingRetried: timing, noDoc, excluded, exceptions, rows }, null, 1));
console.log(`DONE: ${same + differ} cases replayed, ${same} identical (${timing} only after a re-run because of the CPU budget, ${exceptions} through the named closed-hollow sentence exception), ${differ} differ, ${noDoc} scripts that do not run (no doc), ${excluded} docs not compared (names resolved differently by design). Wrote ${OUT}`);
process.exit(differ ? 1 : 0);
