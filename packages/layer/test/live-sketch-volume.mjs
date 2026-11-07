// REAL-KERNEL measure of the sketch-volume check (src/sketch-volume.ts). Not part of `npm test`: needs the SolidCraft wasm rig and OCCT.
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-sketch-volume.mjs --sweep [--out=f.json]
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-sketch-volume.mjs --corpus [--sets=a,b] [--only=substr] [--out=f.json]
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-sketch-volume.mjs --pocket [--out=f.json]
// Every doc is translated by the layer TWICE on the same kernel: check OFF (ctx.skipSketchVolume, = the layer before the check) and check ON (production).
//   --sweep   the HALT boundary sweep: rect(40, 30), chamfer(1, d), pulled 10, d = 5e-5 ... 3e-4, through 'unified', 'extrude-pocket' and 'base', against the closed form.
//   --pocket  the same chamfered rect cut as a POCKET (box(60, 50, 20) spanning z 0..20, sketch('top', 20), rect(40, 30), chamfer(1, d), pocket 5), d = 5e-5, 1e-4, 1.2e-4, through all nine sets,
//             against the closed form 60000 - (1200 - d^2/2) x 5, OCCT and brep-rs. The seven sets without an after-the-build pocket check now run the extrude-pocket group's
//             cut-consistency check (src/pocket-cut.ts); "off" is ctx.skipSketchVolume, which switches off both post-build sketch checks.
//   --corpus  every case of docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/cases-*.mjs through 'unified'. Each pull the check newly refuses is scored
//             against the references (closed form where the case has one, OCCT, brep-rs) as the sketch-geometry rig scores (bars: planar 1e-9, curved 3e-4): within the
//             bar before = OVER-REFUSAL, outside = a wrong solid now refused. Every measured feature still built is scored too (an uncaught wrong solid).
//             --sets=a,b runs those sets instead (and then also compares docs with a pocket and no pull, and scores pockets: a newly refused POCKET-CUT pocket and a
//             measured pocket still built).
// The references come from the sketch-geometry rig itself (sg-core.mjs: buildOCCT, buildBrep, the same doc it measures).
import { writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const SG = path.join(REPO, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness');
if (!process.env.SOLIDCRAFT_REFEREE_PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const C = await import(pathToFileURL(path.join(SG, 'sg-core.mjs')).href);
const L = await import(pathToFileURL(path.join(REPO, 'packages/layer/dist/index.js')).href);
const { createTranslator } = L;
// --tol=<planar>,<curved>: measure the check at other tolerances than the shipped ones (RECONCILE_TOL is read at every call)
if (process.argv.some((a) => a.startsWith('--tol='))) { const [p, c] = process.argv.find((a) => a.startsWith('--tol=')).slice(6).split(',').map(Number); L.RECONCILE_TOL.planar = p; L.RECONCILE_TOL.curved = c; }
console.log(`RECONCILE_TOL ${JSON.stringify(L.RECONCILE_TOL)}`);
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const has = (k) => process.argv.includes(`--${k}`);
const OUT = arg('out');
const only = arg('only');
const NINE = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(NINE.map((p) => [p, createTranslator({ planners: p })]));

async function layer(set, doc, on) {
  try {
    const tr = await TR[set].translateDoc(structuredClone(doc), { arc: C.arc, mt: C.mt, runSC: C.runSC, soups: {}, resolveAt: () => null, ...(on ? {} : { skipSketchVolume: true }) });
    return { feats: tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, guard: f.guard ?? null, volume: f.measure?.volume ?? null, faceTypes: f.measure?.faceTypes ?? null })) };
  } catch (e) { return { threw: String(e.message) }; }
}
const relv = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const e2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(1) : String(v));

if (has('sweep')) {
  const rows = [];
  for (const d of [5e-5, 1e-4, 1.2e-4, 1.5e-4, 2e-4, 2.5e-4, 3e-4]) {
    const doc = C.solveDoc(C.runScript(`const sk = sketch('top'); sk.rect(40, 30); sk.chamfer(1, ${d}); extrude(sk, 10)`).doc);
    const exact = (1200 - (d * d) / 2) * 10;
    for (const set of ['unified', 'extrude-pocket', 'base']) {
      const off = (await layer(set, doc, false)).feats.find((f) => f.kind === 'extrude');
      const on = (await layer(set, doc, true)).feats.find((f) => f.kind === 'extrude');
      const row = { d, set, exact, before: { status: off.status, volume: off.volume, rel: off.volume == null ? null : Math.abs(off.volume - exact) / exact, refusal: off.refusal }, after: { status: on.status, volume: on.volume, guard: on.guard, refusal: on.refusal } };
      rows.push(row);
      console.log(`chamfer ${d}\t${set}\tbefore ${off.status} ${off.volume ?? '-'} rel ${e2(row.before.rel)}\tafter ${on.status}${on.guard ? ` [${on.guard}]` : ''}\t${on.refusal ?? ''}`);
    }
  }
  if (OUT) writeFileSync(OUT, JSON.stringify({ pkg: process.env.SOLIDCRAFT_REFEREE_PKG, rows }, null, 1));
  process.exit(0);
}

if (has('pocket')) {
  const rows = []; const T = { runs: 0, builtWrong: 0, refusedRight: 0, builtExact: 0, refusedExact: 0 };
  for (const d of [5e-5, 1e-4, 1.2e-4]) {
    const doc0 = C.runScript(`const b = box(60, 50, 20, { at: [0, 0, 10] }); const sk = sketch('top', 20); sk.rect(40, 30); sk.chamfer(1, ${d}); pocket(sk, b, 5)`).doc;
    const doc = C.solveDoc(doc0);
    const pk = doc.features.find((f) => f.kind === 'pocket').id;
    const exact = 60000 - (1200 - (d * d) / 2) * 5;
    const o = C.buildOCCT(doc0, pk); const br = C.buildBrep(doc0, pk);
    const refs = { exact, occt: o.m?.volume ?? null, brep: br.m?.volume ?? null };
    console.log(`chamfer ${d}\trefs ${JSON.stringify(refs)}`);
    for (const set of NINE) {
      const off = (await layer(set, doc, false)).feats.find((f) => f.id === pk);
      const on = (await layer(set, doc, true)).feats.find((f) => f.id === pk);
      const rel = (v) => (v == null ? null : Math.abs(v - exact) / exact);
      const wrongBefore = off.status === 'built' && rel(off.volume) > 1e-9;
      const wrongAfter = on.status === 'built' && rel(on.volume) > 1e-9;
      T.runs++;
      if (wrongAfter) T.builtWrong++; else if (on.status === 'built') T.builtExact++; else if (wrongBefore) T.refusedRight++; else if (off.status === 'built') T.refusedExact++;
      rows.push({ d, set, refs, before: { status: off.status, volume: off.volume, rel: rel(off.volume), guard: off.guard, refusal: off.refusal }, after: { status: on.status, volume: on.volume, rel: rel(on.volume), guard: on.guard, refusal: on.refusal } });
      console.log(`pocket chamfer ${d}\t${set}\tbefore ${off.status} ${off.volume ?? '-'} rel ${e2(rel(off.volume))}\tafter ${on.status}${on.guard ? ` [${on.guard}]` : ''} ${on.volume ?? '-'}\t${on.refusal ?? ''}${wrongAfter ? '\tBUILT-WRONG' : ''}`);
    }
  }
  console.log(`DONE ${JSON.stringify(T)}`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ pkg: process.env.SOLIDCRAFT_REFEREE_PKG, T, rows }, null, 1));
  process.exit(0);
}

if (has('corpus')) {
  // --sets=a,b: run the corpus through those sets instead of 'unified' alone. Then docs with a pocket and no pull are compared too, a newly refused POCKET-CUT pocket and
  // a still-built measured pocket are scored as a pull is. Without --sets the run is exactly the one GUARD-SKETCH-VOLUME.md reports ('unified', pull docs, pulls scored).
  const SETS = arg('sets') ? arg('sets').split(',') : ['unified'];
  const WITH_POCKETS = !!arg('sets');
  const NEW_GUARDS = WITH_POCKETS ? ['SKETCH-VOLUME', 'POCKET-CUT'] : ['SKETCH-VOLUME'];
  const files = readdirSync(SG).filter((n) => /^cases-.*\.mjs$/.test(n)).sort();
  const rows = []; const T0 = { cases: 0, custom: 0, scriptRefused: 0, noPull: 0 };
  const TS = Object.fromEntries(SETS.map((s) => [s, { compared: 0, same: 0, newlyRefused: 0, byGuard: {}, overRefusal: 0, caughtWrong: 0, noRef: 0, notMeasured: 0, builtScored: 0, builtWrong: [], threw: 0 }]));
  const t0 = Date.now(); let nCompared = 0;
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(SG, file)).href);
    for (const c of mod.cases ?? []) {
      if (only && !c.id.includes(only)) continue;
      T0.cases++;
      if (c.custom) { T0.custom++; continue; }
      let doc0;
      if (c.script !== undefined) {
        const src = c.preamble ? C.friendly.withPreamble(c.script) : c.script;
        let run; try { run = C.runScript(src, c.values ? { values: c.values } : undefined); } catch (e) { T0.scriptRefused++; continue; }
        if (run.errors.length) { T0.scriptRefused++; continue; }
        doc0 = c.doc ?? (c.edit ? c.edit(JSON.parse(JSON.stringify(run.doc))) : run.doc);
      } else doc0 = c.doc;
      if (!doc0 || !doc0.features?.some((f) => f.kind === 'extrude' || (WITH_POCKETS && f.kind === 'pocket'))) { T0.noPull++; continue; }
      let doc; try { doc = C.solveDoc(doc0); } catch (e) { for (const s of SETS) TS[s].threw++; rows.push({ file, id: c.id, solveError: String(e.message).slice(0, 120) }); continue; }
      const ext = c.measure ?? [...doc0.features].reverse().find((f) => f.kind === 'extrude' || f.kind === 'pocket' || f.kind === 'revolve')?.id;
      let refs = null;
      const refsOf = () => {
        if (refs) return refs;
        const o = c.noOcct ? { refused: 'not run' } : C.buildOCCT(doc0, ext); const b = C.buildBrep(doc0, ext);
        refs = { exact: c.exact?.volume ?? null, occt: o.m?.volume ?? null, brep: b.m?.volume ?? null };
        return refs;
      };
      const scoreAgainst = (v, curved) => {
        const r = refsOf(); const tol = curved ? C.TOL.curved : C.TOL.planar;
        const ref = r.exact ?? r.occt ?? r.brep;
        if (ref == null) return { verdict: 'NO-REF', tol };
        if (!(v > 0)) return { verdict: 'WRONG', tol, why: 'a volume of 0 or less', refs: r }; // the rig's relative error has a 1 mm3 floor, which would call a negative volume on a tiny part exact
        const d = { exact: r.exact == null ? null : relv(v, r.exact), occt: r.occt == null ? null : relv(v, r.occt), brep: r.brep == null ? null : relv(v, r.brep) };
        const primary = r.exact != null ? d.exact : r.occt != null ? d.occt : d.brep;
        return { verdict: primary <= tol ? 'EXACT' : 'WRONG', tol, d, refs: r };
      };
      for (const set of SETS) {
        const T = TS[set];
        const off = await layer(set, doc, false); const on = await layer(set, doc, true);
        if (off.threw || on.threw) { T.threw++; rows.push({ file, id: c.id, set, threw: off.threw ?? on.threw }); continue; }
        T.compared++;
        const changed = on.feats.map((f, i) => ({ f, b: off.feats[i] })).filter(({ f, b }) => f.status !== b.status || f.refusal !== b.refusal);
        if (!changed.length) T.same++;
        const row = { file, id: c.id, set, changed: changed.map(({ f, b }) => ({ id: f.id, kind: f.kind, before: b.status, after: f.status, guard: f.guard, refusal: f.refusal })) };
        for (const { f, b } of changed) {
          if (!(b.status === 'built' && f.status === 'refused' && NEW_GUARDS.includes(f.guard))) continue; // a feature downstream of a newly refused pull / pocket: counted with it
          T.newlyRefused++; T.byGuard[f.guard] = (T.byGuard[f.guard] ?? 0) + 1;
          const curved = c.curved ?? Object.keys(b.faceTypes ?? {}).some((k) => k !== 'plane');
          // the reference is of the case's measured feature; a newly refused pull / pocket that is not that feature is not scored
          const s = f.id === ext ? scoreAgainst(b.volume, curved) : { verdict: 'NOT-MEASURED-FEATURE' };
          if (s.verdict === 'EXACT') T.overRefusal++; else if (s.verdict === 'WRONG') T.caughtWrong++; else if (s.verdict === 'NO-REF') T.noRef++; else T.notMeasured++;
          row.newly = { ...(row.newly ?? {}), [f.id]: { guard: f.guard, before: b.volume, curved, ...s } };
        }
        // every measured feature still built after: scored (a wrong solid the checks do not catch)
        const m = on.feats.find((x) => x.id === ext);
        if (m && m.status === 'built' && m.volume != null && (m.kind === 'extrude' || (WITH_POCKETS && m.kind === 'pocket'))) {
          const curved = c.curved ?? Object.keys(m.faceTypes ?? {}).some((k) => k !== 'plane');
          const s = scoreAgainst(m.volume, curved);
          if (s.verdict !== 'NO-REF') T.builtScored++;
          if (s.verdict === 'WRONG') { T.builtWrong.push({ file, id: c.id, set, kind: m.kind, volume: m.volume, ...s }); row.builtWrong = s; }
        }
        rows.push(row);
        if (changed.length || row.builtWrong) console.log(`${set} ${file} ${c.id}: ${row.changed.map((x) => `${x.id} ${x.before}->${x.after}${x.guard ? ` [${x.guard}]` : ''}`).join(', ')}${row.newly ? ` ${JSON.stringify(row.newly)}` : ''}${row.builtWrong ? ` BUILT-WRONG ${JSON.stringify(row.builtWrong)}` : ''}`);
      }
      nCompared++;
      if (nCompared % 50 === 0) { console.log(`.. ${nCompared} docs compared, ${Math.round((Date.now() - t0) / 1000)} s`); if (OUT) writeFileSync(OUT, JSON.stringify({ partial: true, T0, TS, rows }, null, 1)); }
    }
  }
  for (const set of SETS) {
    const T = TS[set];
    console.log(`DONE ${set} ${JSON.stringify({ ...T0, ...T, builtWrong: T.builtWrong.length })}`);
    for (const w of T.builtWrong) console.log(`BUILT-WRONG ${set} ${w.file} ${w.id} ${w.kind} vol ${w.volume} ${JSON.stringify(w.d)} tol ${w.tol}`);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify({ pkg: process.env.SOLIDCRAFT_REFEREE_PKG, T0, TS, rows }, null, 1));
  process.exit(0);
}
console.error('usage: --sweep | --pocket | --corpus');
process.exit(2);
