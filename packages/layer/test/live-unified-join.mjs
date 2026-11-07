// REAL-KERNEL measure of the unified set's join-check level ('cheap' against 'full'), through the layer exactly as the host page calls it. Not part of `npm test`:
// needs the SolidCraft wasm rig, OCCT (replicad-opencascadejs, the referee apparatus by path) and brep-rs (archive/brep-rs/pkg, read-only; copy the wasm in for the run).
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-unified-join.mjs --corpus=ep|bool|unified --out=<dir> [--ep-results=<ep-results.json>] [--combined=N] [--rg-combined=N] [--only=id,id] [--timeout=S] [--chunk=N]
//
// cheap = createTranslator({ planners: 'unified' }) with ctx.unifiedEpJoinChecks 'cheap' (the library default: what the host passed before 2026-11-07)
// full  = packages/solidcraft-host/pane/src/host-entry.mjs translateDoc (the host's own entry; it sets 'full' itself)
// Both get the host page's ctx, { arc, mt, runSC, soups, followMoves: true } (pane.js), without topologyOf: the node rig has no topology reply, so a named face or edge is
// refused by both sides alike. runSC is in-process; it ignores { budgetS } (the node rig has no cancel), as the layer's other live replays do.
//
// Corpora:
//   ep       every extrude-pocket contract case (ep-results.json: the SHIPPED ROUTE rows' 473 cases), scored against the case's stored kernel-independent reference
//            (closed form > live OCCT > brep-rs), as extrude-pocket-measure.mjs score().
//   bool     every case of the booleans live replay (boolean-cases*.mjs, deduplicated as live-replay-booleans.mjs) whose doc has a join (combine/union).
//   unified  the join-bearing docs of the unified live replay's corpora (live-replay-unified.mjs: holes, shell-draft, patterns-mirror, revolve-groove case files, and the
//            seeded combined / rg-combined docs), all of them; fillet-chamfer corpora are left out (they need the topology reply).
//   bool and unified are scored against live OCCT and live brep-rs of the same raw ModelDoc (both oracles; a disagreement between them is reported, not resolved).
// A case is scored on the measured feature (the case's `measure`, else its last feature) by the layer's own measure of that feature AND by the whole scene (every body
// the commands leave, as live-replay-unified.mjs sceneOf): RIGHT when either matches the reference (a split part leaves its pieces as separate bodies), WRONG when neither does.
// The scene counts only when its bodies' boxes are pairwise apart (no two bodies overlap or touch) and, where the reference has a solid count, the body count equals it.
// For a case that 'full' refuses and 'cheap' built, the first feature that changed is scored too (the join itself), so an over-refusal of a join that does not feed the
// last feature is not missed.
// Cost: engine runs (runSC calls) and wall time of translateDoc per doc at each level (the scene run and the oracles are not timed). The two levels run in alternating
// order (even index cheap first, odd index full first).
//
// ONE CHILD PROCESS PER CHUNK, watched: a case that makes no progress for --timeout seconds (default 240) is recorded as HANG and the run resumes after it.
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const CONTRACT = path.join(REPO, 'docs', 'spikes', 'solidcraft-referee', 'contract');
const SG = path.join(CONTRACT, 'sketch-geometry-harness');
if (!process.env.SOLIDCRAFT_REFEREE_PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const CORPUS = arg('corpus');
if (!['ep', 'bool', 'unified'].includes(CORPUS)) { console.error('FATAL: --corpus=ep|bool|unified'); process.exit(2); }
const OUT = path.resolve(arg('out') || '.');
const JSONL = path.join(OUT, `ujf-${CORPUS}.jsonl`);
const imp = (p) => import(pathToFileURL(p).href);

// ---- driver --------------------------------------------------------------------------------------------------------------------------------------------------
if (!process.argv.includes('--child')) {
  mkdirSync(OUT, { recursive: true });
  const timeoutMs = Number(arg('timeout') || 240) * 1000;
  const done = new Set(existsSync(JSONL) ? readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).i) : []);
  let from = 0; let total = null;
  while (total === null || from < total) {
    while (done.has(from)) from++;
    const res = await new Promise((resolve) => {
      const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--child', `--from=${from}`], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
      let cur = null; let timer = null; let buf = ''; let lastDone = from - 1;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { ch.kill('SIGKILL'); }, timeoutMs); };
      arm();
      ch.stdout.on('data', (d) => {
        buf += d; let k;
        while ((k = buf.indexOf('\n')) >= 0) {
          const ln = buf.slice(0, k); buf = buf.slice(k + 1);
          if (ln.startsWith('@@TOTAL@@')) total = Number(ln.slice(9));
          else if (ln.startsWith('@@START@@')) { cur = JSON.parse(ln.slice(9)); arm(); }
          else if (ln.startsWith('@@DONE@@')) { lastDone = Number(ln.slice(8)); done.add(lastDone); cur = null; arm(); }
          else console.log(ln);
        }
      });
      ch.on('exit', (code, sig) => { clearTimeout(timer); resolve({ code, sig, cur, lastDone }); });
    });
    if (res.cur) { // killed (or crashed) inside a case
      appendFileSync(JSONL, JSON.stringify({ i: res.cur.i, id: res.cur.id, corpus: CORPUS, hang: res.sig === 'SIGKILL', crashed: res.sig !== 'SIGKILL', code: res.code, sig: res.sig }) + '\n');
      console.log(`${res.cur.id}\t${res.sig === 'SIGKILL' ? 'HANG' : `CRASH code=${res.code} sig=${res.sig}`}`);
      done.add(res.cur.i); from = res.cur.i + 1;
    } else if (res.code !== 0) { console.error(`FATAL: child exited ${res.code} ${res.sig} outside a case`); process.exit(1); }
    else from = res.lastDone + 1;
    if (total === null) { console.error('FATAL: child gave no total'); process.exit(1); }
  }
  console.log(`ALL DONE ${CORPUS} ${total} -> ${JSONL}`);
  process.exit(0);
}

// ---- child ---------------------------------------------------------------------------------------------------------------------------------------------------
const C = await imp(path.join(SG, 'sg-core.mjs'));
const L = await imp(path.join(REPO, 'packages/layer/dist/index.js'));
const H = await imp(path.join(REPO, 'packages/solidcraft-host/pane/src/host-entry.mjs'));
if (H.HOST_EP_JOIN_CHECKS !== 'full') { console.error(`FATAL: host-entry.mjs HOST_EP_JOIN_CHECKS is ${H.HOST_EP_JOIN_CHECKS}, expected 'full'`); process.exit(2); }
const CHEAP = L.createTranslator({ planners: 'unified' });
const isJoin = (f) => f.kind === 'combine' && f.op === 'union';
const FROM = Number(arg('from') || 0);
const CHUNK = Number(arg('chunk') || 120);

// items: { id, doc (solved), raw (unsolved features, for the oracles), measureId, ref? (stored), curved?, expect? }
const items = [];
if (CORPUS === 'ep') {
  const cases = JSON.parse(readFileSync(path.resolve(arg('ep-results')), 'utf8'));
  for (const c of cases) {
    const ref = c.analytic?.volume != null ? { src: 'analytic', ...c.analytic } : c.occt?.volume != null ? { src: 'occt', ...c.occt } : c.brep?.volume != null ? { src: 'brep', ...c.brep } : null;
    items.push({ id: c.id, script: c.script, measureId: c.finalId, ref, curved: !!c.curved, expect: c.expect });
  }
} else if (CORPUS === 'bool') {
  const { CASES } = await imp(path.join(CONTRACT, 'boolean-cases.mjs'));
  for (const f of ['r2', 'r3', 'r4', 'r5', 'r6']) await imp(path.join(CONTRACT, `boolean-cases-${f}.mjs`));
  const seen = new Set();
  for (const c of CASES) {
    const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.features)}`; if (seen.has(key)) continue; seen.add(key);
    items.push({ id: c.id, script: c.script, features: c.features, measure: c.measure, analytic: typeof c.analytic === 'number' ? c.analytic : null });
  }
} else {
  const { runScript } = C;
  const P = await imp(path.join(CONTRACT, 'shell-draft-polytope.mjs'));
  const seen = new Set();
  const addScript = (corpus, id, src, patch) => { const key = `${id}\u0000${src}`; if (seen.has(key)) return; seen.add(key); items.push({ id: `${corpus}:${id}`, script: src, patch }); };
  for (const f of ['holes4-cases.mjs', 'holes3-cases.mjs', 'holes-cases.mjs']) for (const c of (await imp(path.join(CONTRACT, f))).CASES) addScript('holes', c.id, c.script);
  const env = { P, sigma: -1, rel: (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1) };
  const { CASES_FN } = await imp(path.join(CONTRACT, 'shell-draft-cases.mjs'));
  const { STEEP_FN } = await imp(path.join(CONTRACT, 'shell-draft-cases-steep.mjs'));
  const { R2_FN } = await imp(path.join(CONTRACT, 'shell-draft-cases-r2.mjs'));
  for (const c of [...CASES_FN(env), ...STEEP_FN(env), ...R2_FN(env)]) addScript('sd', c.id, c.script, c.patch);
  const { preflightScript } = L;
  const mods = await Promise.all(['pm-cases.mjs', 'pm-cases-r2.mjs', 'pm-cases-r3.mjs', 'pm-cases-r4.mjs', 'pm-cases-r6.mjs'].map((f) => imp(path.join(CONTRACT, f))));
  for (const c of mods.flatMap((m) => Object.values(m).filter(Array.isArray).flat()).filter((c) => c && typeof c.src === 'string')) { if (!preflightScript(c.src)) addScript('pm', c.id, c.src); }
  const rigDir = path.join(CONTRACT, 'revolve-groove-rig');
  const { allCases } = await imp(path.join(rigDir, 'rg-cases.mjs'));
  const rgSrc = [...allCases('/nonexistent-rg-dir', [])];
  for (const f of ['cases-r3.mjs', 'cases-r3-chainprobe.mjs', 'cases-r3-fuzz.mjs', 'cases-r3-sliver.mjs', 'cases-r3-spinfuzz.mjs', 'cases-r4-graze.mjs', 'cases-r5-regress.mjs', 'cases-r5-wall.mjs']) rgSrc.push(...(await imp(path.join(rigDir, f))).cases);
  for (const c of rgSrc) if (typeof c.src === 'string') addScript('rg', c.id, c.src);
  const { combinedDoc } = await imp(path.join(HERE, 'unified-docs.mjs'));
  const { rgCombinedDoc } = await imp(path.join(HERE, 'rg-docs.mjs'));
  for (let i = 0; i < Number(arg('combined') || 600); i++) items.push({ id: `combined seed ${i}`, features: combinedDoc(i).features });
  for (let i = 0; i < Number(arg('rg-combined') || 400); i++) items.push({ id: `rg combined seed ${i}`, features: rgCombinedDoc(i).features });
}
// resolve every item to a doc; keep the join-bearing ones (ep: all), in a fixed order
const ONLY = arg('only').split(',').filter(Boolean);
const ready = [];
for (const it of items) {
  if (ONLY.length && !ONLY.includes(it.id)) continue;
  let raw;
  if (it.script !== undefined) { const r = C.runScript(it.script); if (r.errors.length) continue; raw = r.doc; if (it.patch) it.patch(raw); }
  else raw = { version: 1, features: it.features };
  if (CORPUS !== 'ep' && !raw.features.some(isJoin)) continue;
  let doc; try { doc = C.solveDoc(structuredClone(raw)); } catch { continue; }
  ready.push({ ...it, raw: { version: 1, features: raw.features }, doc, measureId: it.measureId ?? it.measure ?? raw.features[raw.features.length - 1].id });
}
console.log('@@TOTAL@@' + ready.length);

const relV = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / (Math.abs(b) > 0 ? Math.abs(b) : 1) : Infinity);
// as extrude-pocket-measure.mjs score() (true relative volume, bbox per component with floor 1, COM over the bbox diagonal, a live-OCCT bbox held to max(tol, 2e-7))
function score(m, ref, curved) {
  if (m.apart === false) return { apart: false, ok: false };
  const t = curved ? C.TOL.curved : C.TOL.planar;
  const dVol = relV(m.volume, ref.volume);
  const dBbox = m.bbox && ref.bbox ? C.worstArr(m.bbox, ref.bbox) : null;
  const diag = ref.bbox ? Math.max(Math.hypot(ref.bbox[3] - ref.bbox[0], ref.bbox[4] - ref.bbox[1], ref.bbox[5] - ref.bbox[2]), 1) : 1;
  const dCom = m.com && ref.com ? Math.max(...m.com.map((v, i) => Math.abs(v - ref.com[i]))) / diag : null;
  const comTol = curved ? C.COM_TOL.curved : C.COM_TOL.planar;
  const tb = ref.src === 'occt' ? Math.max(t, 2e-7) : t;
  const solidsOk = ref.solids == null || m.nBodies == null || m.nBodies === ref.solids;
  return { dVol, dBbox, dCom, tol: t, ok: dVol <= t && (dBbox === null || dBbox <= tb) && (dCom === null || dCom <= comTol) && solidsOk, solidsOk };
}
const fm = (f) => (f?.measure ? { volume: f.measure.volume, bbox: f.measure.bbox, com: f.measure.com, faces: f.measure.faces, curved: !!f.measure.curved, nBodies: f.measure.bodies?.length ?? null, bodies: f.measure.bodies } : null);
async function sceneOf(commands) {
  const all = await C.runSC(commands);
  if (!all.ok) return { ok: false };
  const bs = all.measure?.bodies ?? [];
  if (!bs.length) return { ok: true, volume: 0, nBodies: 0, bbox: null, bodies: [] };
  const mn = [0, 1, 2].map((k) => Math.min(...bs.map((b) => b.bbox.min[k]))); const mx = [0, 1, 2].map((k) => Math.max(...bs.map((b) => b.bbox.max[k])));
  // two bodies whose boxes overlap or touch: a join that merged them would have left one body, so the scene is not taken as the join's result (mp-join-on-top-right:
  // the tool fused to the far block, the near block left touching it; the volume and the overall box are right, the part is not)
  const sep = (a, b) => [0, 1, 2].some((k) => a.bbox.max[k] < b.bbox.min[k] - 1e-9 || b.bbox.max[k] < a.bbox.min[k] - 1e-9);
  let apart = true; for (let x = 0; x < bs.length; x++) for (let y = x + 1; y < bs.length; y++) if (!sep(bs[x], bs[y])) apart = false;
  return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), nBodies: bs.length, bbox: [...mn, ...mx], apart, bodies: bs.map((b) => ({ name: b.name, volume: b.volume_mm3, bbox: [...b.bbox.min, ...b.bbox.max] })) };
}
async function runLevel(level, doc) {
  let calls = 0; let commands = 0;
  const runSC = async (cmds) => { calls++; commands += cmds.length; return C.runSC(cmds); };
  const ctx = { arc: C.arc, mt: C.mt, runSC, soups: {}, followMoves: true };
  const t0 = performance.now(); let tr;
  try { tr = level === 'cheap' ? await CHEAP.translateDoc(structuredClone(doc), { ...ctx, unifiedEpJoinChecks: 'cheap' }) : await H.translateDoc(structuredClone(doc), ctx); }
  catch (e) { return { threw: String(e?.message ?? e), ms: performance.now() - t0, calls }; }
  const ms = performance.now() - t0;
  return { ms, calls, commands, tr, feats: tr.features.map((f) => ({ id: f.id, kind: f.kind, op: f.op ?? null, status: f.status, guard: f.guard ?? null, refusal: f.refusal ?? null, m: fm(f) })) };
}
const oracleCache = new Map();
function oracles(it) {
  if (!oracleCache.has(it.id)) oracleCache.set(it.id, { occt: {}, brep: {} });
  return oracleCache.get(it.id);
}
const occtOf = (it, id) => { const c = oracles(it); if (!(id in c.occt)) { const r = C.buildOCCT(it.raw, id); c.occt[id] = r.m ? { src: 'occt', volume: r.m.volume, bbox: r.m.bbox, com: r.m.com, solids: r.m.solids, faces: r.m.faces } : { refused: String(r.refused).slice(0, 300) }; } return c.occt[id]; };
const brepOf = (it, id) => { const c = oracles(it); if (!(id in c.brep)) { const r = C.buildBrep(it.raw, id); c.brep[id] = r.m ? { src: 'brep', volume: r.m.volume, bbox: r.m.bbox, faces: r.m.faces } : { refused: String(r.refused).slice(0, 300) }; } return c.brep[id]; };

function verdictOf(it, lv, id, scene) {
  const f = lv.feats?.find((x) => x.id === id);
  if (!f) return { verdict: lv.threw ? 'THREW' : 'MISSING' };
  if (f.status !== 'built') return { verdict: 'REFUSED', guard: f.guard, refusal: f.refusal };
  const curved = (it.curved || f.m?.curved) ?? false;
  if (CORPUS === 'ep' && id === it.measureId) {
    if (!it.ref) return { verdict: 'BUILT-NO-REF' };
    const sF = score(f.m, it.ref, curved); const sS = scene?.ok && id === it.measureId ? score({ volume: scene.volume, bbox: scene.bbox, nBodies: scene.nBodies, apart: scene.apart }, it.ref, curved) : null;
    return { verdict: sF.ok || sS?.ok ? (it.expect === 'refuse' ? 'RIGHT(expect refuse)' : 'RIGHT') : 'WRONG', sF, sS, ref: 'stored ' + it.ref.src };
  }
  const o = occtOf(it, id); const b = brepOf(it, id);
  const per = (ref) => (ref?.volume == null ? null : { f: score(f.m, ref, curved), s: scene?.ok && id === it.measureId ? score({ volume: scene.volume, bbox: scene.bbox, nBodies: scene.nBodies, apart: scene.apart }, ref, curved) : null });
  const vo = per(o); const vb = per(b ? { ...b, solids: undefined } : null);
  const okO = vo ? (vo.f.ok || !!vo.s?.ok) : null; const okB = vb ? (vb.f.ok || !!vb.s?.ok) : null;
  const an = it.analytic != null && id === it.measureId ? relV(f.m.volume, it.analytic) <= (curved ? C.TOL.curved : C.TOL.planar) || (scene?.ok && scene.apart && relV(scene.volume, it.analytic) <= (curved ? C.TOL.curved : C.TOL.planar)) : null;
  let verdict;
  if (okO === null && okB === null && an === null) verdict = 'BUILT-NO-REF';
  else if ([okO, okB, an].some((x) => x === true) && ![okO, okB, an].some((x) => x === false)) verdict = 'RIGHT';
  else if ([okO, okB, an].some((x) => x === false) && ![okO, okB, an].some((x) => x === true)) verdict = 'WRONG';
  else verdict = 'ORACLES-SPLIT';
  return { verdict, okO, okB, an, occt: o, brep: b, sO: vo, sB: vb, m: f.m };
}

let n = 0;
for (let i = FROM; i < ready.length && n < CHUNK; i++, n++) {
  const it = ready[i];
  console.log('@@START@@' + JSON.stringify({ i, id: it.id }));
  const order = i % 2 === 0 ? ['cheap', 'full'] : ['full', 'cheap'];
  const lv = {};
  for (const level of order) lv[level] = await runLevel(level, it.doc);
  const row = { i, id: it.id, corpus: CORPUS, measureId: it.measureId, joins: it.doc.features.filter(isJoin).map((f) => f.id), level: {} };
  for (const level of ['cheap', 'full']) {
    const l = lv[level];
    const fin = l.feats?.find((x) => x.id === it.measureId);
    const scene = fin?.status === 'built' ? await sceneOf(l.tr.commands) : null;
    row.level[level] = { ms: l.ms, calls: l.calls, commands: l.commands ?? null, threw: l.threw ?? null, feats: l.feats?.map(({ m, ...r }) => ({ ...r, volume: m?.volume ?? null })) ?? null, scene, final: verdictOf(it, l, it.measureId, scene) };
  }
  // the first feature 'cheap' built and 'full' did not
  const c = lv.cheap.feats ?? []; const f = lv.full.feats ?? [];
  const changed = c.filter((x) => x.status === 'built' && f.find((y) => y.id === x.id)?.status !== 'built').map((x) => x.id);
  row.changed = changed;
  row.newlyBuilt = f.filter((x) => x.status === 'built' && c.find((y) => y.id === x.id)?.status !== 'built').map((x) => x.id);
  if (changed.length) {
    const first = changed[0]; const ff = f.find((y) => y.id === first);
    row.firstChanged = { id: first, kind: ff?.kind, op: ff?.op, guard: ff?.guard ?? null, refusal: ff?.refusal ?? null, cheap: first === it.measureId ? row.level.cheap.final : verdictOf(it, lv.cheap, first, null) };
  }
  row.sameCommands = JSON.stringify(lv.cheap.tr?.commands ?? null) === JSON.stringify(lv.full.tr?.commands ?? null);
  appendFileSync(JSONL, JSON.stringify(row) + '\n');
  console.log(`${it.id}\tcheap ${row.level.cheap.final.verdict} ${row.level.cheap.calls}r ${row.level.cheap.ms.toFixed(0)}ms\tfull ${row.level.full.final.verdict} ${row.level.full.calls}r ${row.level.full.ms.toFixed(0)}ms${changed.length ? `\tCHANGED ${changed.join(',')} [${row.firstChanged.guard}] cheap-was ${row.firstChanged.cheap.verdict}` : ''}`);
  console.log('@@DONE@@' + i);
}
process.exit(0);
