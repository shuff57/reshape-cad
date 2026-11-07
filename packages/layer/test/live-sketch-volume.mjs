// REAL-KERNEL measure of the sketch-volume check (src/sketch-volume.ts). Not part of `npm test`: needs the SolidCraft wasm rig and OCCT.
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-sketch-volume.mjs --sweep [--out=f.json]
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-sketch-volume.mjs --corpus [--only=substr] [--out=f.json]
// Every doc is translated by the layer TWICE on the same kernel: check OFF (ctx.skipSketchVolume, = the layer before the check) and check ON (production).
//   --sweep   the HALT boundary sweep: rect(40, 30), chamfer(1, d), pulled 10, d = 5e-5 ... 3e-4, through 'unified', 'extrude-pocket' and 'base', against the closed form.
//   --corpus  every case of docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/cases-*.mjs through 'unified'. Each pull the check newly refuses is scored
//             against the references (closed form where the case has one, OCCT, brep-rs) as the sketch-geometry rig scores (bars: planar 1e-9, curved 3e-4): within the
//             bar before = OVER-REFUSAL, outside = a wrong solid now refused. Every measured feature still built is scored too (an uncaught wrong solid).
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
const TR = Object.fromEntries(['unified', 'extrude-pocket', 'base'].map((p) => [p, createTranslator({ planners: p })]));

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

if (has('corpus')) {
  const files = readdirSync(SG).filter((n) => /^cases-.*\.mjs$/.test(n)).sort();
  const rows = []; const T = { cases: 0, custom: 0, scriptRefused: 0, noPull: 0, compared: 0, same: 0, newlyRefused: 0, overRefusal: 0, caughtWrong: 0, noRef: 0, builtScored: 0, builtWrong: [], threw: 0 };
  const t0 = Date.now();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(SG, file)).href);
    for (const c of mod.cases ?? []) {
      if (only && !c.id.includes(only)) continue;
      T.cases++;
      if (c.custom) { T.custom++; continue; }
      let doc0;
      if (c.script !== undefined) {
        const src = c.preamble ? C.friendly.withPreamble(c.script) : c.script;
        let run; try { run = C.runScript(src, c.values ? { values: c.values } : undefined); } catch (e) { T.scriptRefused++; continue; }
        if (run.errors.length) { T.scriptRefused++; continue; }
        doc0 = c.doc ?? (c.edit ? c.edit(JSON.parse(JSON.stringify(run.doc))) : run.doc);
      } else doc0 = c.doc;
      if (!doc0 || !doc0.features?.some((f) => f.kind === 'extrude')) { T.noPull++; continue; }
      let doc; try { doc = C.solveDoc(doc0); } catch (e) { T.threw++; rows.push({ file, id: c.id, solveError: String(e.message).slice(0, 120) }); continue; }
      const off = await layer('unified', doc, false); const on = await layer('unified', doc, true);
      if (off.threw || on.threw) { T.threw++; rows.push({ file, id: c.id, threw: off.threw ?? on.threw }); continue; }
      T.compared++;
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
      const changed = on.feats.map((f, i) => ({ f, b: off.feats[i] })).filter(({ f, b }) => f.status !== b.status || f.refusal !== b.refusal);
      if (!changed.length) T.same++;
      const row = { file, id: c.id, changed: changed.map(({ f, b }) => ({ id: f.id, kind: f.kind, before: b.status, after: f.status, guard: f.guard, refusal: f.refusal })) };
      for (const { f, b } of changed) {
        if (!(b.status === 'built' && f.status === 'refused' && f.guard === 'SKETCH-VOLUME')) continue; // a feature downstream of a newly refused pull: counted with the pull
        T.newlyRefused++;
        const curved = c.curved ?? Object.keys(b.faceTypes ?? {}).some((k) => k !== 'plane');
        // the reference is of the case's measured feature; a newly refused pull that is not that feature is scored only when it is the case's measured one
        const s = f.id === ext ? scoreAgainst(b.volume, curved) : { verdict: 'NOT-MEASURED-FEATURE' };
        if (s.verdict === 'EXACT') T.overRefusal++; else if (s.verdict === 'WRONG') T.caughtWrong++; else T.noRef++;
        row.newly = { ...(row.newly ?? {}), [f.id]: { before: b.volume, curved, ...s } };
      }
      // every measured feature still built after: scored (a wrong solid the check does not catch)
      const m = on.feats.find((x) => x.id === ext);
      if (m && m.status === 'built' && m.volume != null && m.kind === 'extrude') {
        const curved = c.curved ?? Object.keys(m.faceTypes ?? {}).some((k) => k !== 'plane');
        const s = scoreAgainst(m.volume, curved);
        if (s.verdict !== 'NO-REF') T.builtScored++;
        if (s.verdict === 'WRONG') { T.builtWrong.push({ file, id: c.id, volume: m.volume, ...s }); row.builtWrong = s; }
      }
      rows.push(row);
      if (changed.length || row.builtWrong) console.log(`${file} ${c.id}: ${row.changed.map((x) => `${x.id} ${x.before}->${x.after}${x.guard ? ` [${x.guard}]` : ''}`).join(', ')}${row.newly ? ` ${JSON.stringify(row.newly)}` : ''}${row.builtWrong ? ` BUILT-WRONG ${JSON.stringify(row.builtWrong)}` : ''}`);
      if (T.compared % 50 === 0) { console.log(`.. ${T.compared} compared, ${Math.round((Date.now() - t0) / 1000)} s`); if (OUT) writeFileSync(OUT, JSON.stringify({ partial: true, T, rows }, null, 1)); }
    }
  }
  console.log(`DONE ${JSON.stringify({ ...T, builtWrong: T.builtWrong.length })}`);
  for (const w of T.builtWrong) console.log(`BUILT-WRONG ${w.file} ${w.id} vol ${w.volume} ${JSON.stringify(w.d)} tol ${w.tol}`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ pkg: process.env.SOLIDCRAFT_REFEREE_PKG, T, rows }, null, 1));
  process.exit(0);
}
console.error('usage: --sweep | --corpus');
process.exit(2);
