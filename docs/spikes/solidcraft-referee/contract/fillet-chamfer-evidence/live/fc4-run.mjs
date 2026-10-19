// SPIKE, referee only. ROUND 4 runner: every case goes through THREE live paths on the pane's own solidcraft wasm and is scored against independent oracles.
//   pane     = what ships today (forked translator, every FC switch off; fc-live-check.mjs proves it equals window.__host.run)
//   grouped  = grouping on, guard OFF (what the kernel does when handed the grouped call with no guard; used to tell a justified refusal from an over-refusal)
//   contract = grouping + guard + one-sentence refusals (the proposed page)
// Oracles: OCCT simultaneous (all picked edges in one maker), OCCT sequential (buildDoc), brep-rs measure_doc, a case-supplied closed form or saved FreeCAD number.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun live/fc4-run.mjs --cases=./fc4-cases-a.mjs --res=../fc4-results-a.json [--only=id,prefix*] [--resume]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openPage, runScriptLive, runDocLive, guarded, scriptToDoc } from './fc-live.mjs';
import { occtSim, occtSeq, brepSeq, verdict, firstBlend, occtBase, occtMeasure } from './fc-oracle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const casesFile = arg('cases'); const outFile = path.resolve(HERE, arg('res', '../fc4-results.json'));
const only = arg('only', '').split(',').filter(Boolean);
const resume = process.argv.includes('--resume');
const { CASES } = await import(pathToFileURL(path.resolve(HERE, casesFile)).href);
const pick = (c) => !only.length || only.some((o) => (o.endsWith('*') ? c.id.startsWith(o.slice(0, -1)) : c.id === o));

const slimRun = (r) => (r.scriptError ? { scriptError: r.scriptError[0] } : r.hang || r.error && !r.features ? { hang: !!r.hang, error: r.error } : {
  volume: r.volume, faces: r.faces, ok: r.ok, bodies: r.bodies?.map((b) => ({ volume: b.volume, faces: b.faces, bbox: b.bbox, faceTypes: b.faceTypes })),
  features: r.features.filter((f) => f.kind === 'fillet' || f.status === 'refused').map((f) => ({ id: f.id, status: f.status, sentence: f.sentence, refusal: f.refusal, guard: f.guard, group: f.group })),
  blendCommands: r.features.flatMap((f) => (f.commands ?? []).filter((c) => c.command === 'solid.fillet' || c.command === 'solid.chamfer')).map((c) => ({ command: c.command, edges: c.params.edges, size: c.params.radius ?? c.params.distance })),
  ms: r.ms,
});
const blendsBuilt = (r) => !!r.features && r.ok && r.features.length > 0 && !r.features.some((f) => f.status === 'refused') && r.volume > 0;
const bboxDelta = (a, b) => { if (!a || !b) return null; const diag = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) || 1; return Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / diag; };
let altTypes = null;
const asTruck = (r) => ({ volume: r.volume, faces: r.faces, faceTypes: r.bodies?.[0]?.faceTypes ?? altTypes });

await openPage();
const results = resume && existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : [];
const done = new Set(results.map((r) => r.id));
for (const c of CASES) {
  if (!pick(c) || done.has(c.id)) continue;
  const t0 = Date.now();
  const rec = { id: c.id, group: c.group ?? null, note: c.note ?? null, script: c.script ?? null };
  try {
    const mk = (opts) => guarded(() => (c.doc ? runDocLive({ version: 1, features: c.doc }, opts) : runScriptLive(c.script, opts)));
    const FAST = process.argv.includes('--fast');
    // pane: live, unless the case carries the number the pane gave when it was driven through window.__host.run (fc-live-check.mjs: identical on every recorded case)
    const pane = c.paneRecorded ? { ...c.paneRecorded, features: c.paneRecorded.features ?? [], ok: true, bodies: c.paneRecorded.bodies ?? [], fromRecord: true } : await mk({ mode: 'pane' });
    rec.pane = c.paneRecorded ? { volume: c.paneRecorded.volume, faces: c.paneRecorded.faces, recorded: true, refused: (c.paneRecorded.features ?? []).filter((f) => f.status === 'refused').map((f) => f.id) } : slimRun(pane);
    if (pane.scriptError) { rec.scriptError = pane.scriptError[0]; results.push(rec); done.add(c.id); writeFileSync(outFile, JSON.stringify(results, null, 1)); console.log(c.id.padEnd(44), 'SCRIPT ERROR', pane.scriptError[0].slice(0, 100)); continue; }
    const contract = await mk({ mode: 'contract' });
    rec.contract = slimRun(contract);
    altTypes = contract.bodies?.[0]?.faceTypes ?? null;
    const anyRefused = (contract.features ?? []).some((f) => f.status === 'refused');
    const grouped = !FAST || anyRefused ? await mk({ mode: 'contract', guard: false, group: true }) : contract;
    rec.grouped = grouped === contract ? { sameAsContract: true } : slimRun(grouped);
    const doc = contract.doc ?? pane.doc ?? (c.doc ? { version: 1, features: c.doc } : null);
    rec.hasBlend = doc ? firstBlend(doc) >= 0 : false;
    if (doc && c.whole && !c.noOracle) {
      rec.oracle = { occtSeq: occtSeq(doc), brepSeq: brepSeq(doc) };
      const ref = rec.oracle.occtSeq.refused ? null : rec.oracle.occtSeq;
      rec.truthSource = ref ? 'occtSeq' : null;
      const sv = (r) => (blendsBuilt(r) ? verdict(asTruck(r), ref ?? rec.oracle.brepSeq) : (r.ok ? 'some-refused' : 'error'));
      rec.verdicts = { pane: sv(pane), grouped: sv(grouped), contract: sv(contract) };
      if (ref?.bbox) rec.bboxDelta = { pane: bboxDelta(pane.bodies?.[0]?.bbox, ref.bbox), contract: bboxDelta(contract.bodies?.[0]?.bbox, ref.bbox) };
    } else if (doc && rec.hasBlend && !c.noOracle) {
      const bl = doc.features.filter((f) => f.kind === 'fillet');
      const sizes = [...new Set(bl.map((f) => f.size))]; const styles = [...new Set(bl.map((f) => f.style))];
      rec.oracle = {};
      try { const b0 = occtBase(doc); const m0 = occtMeasure(b0.shape); rec.base = { volume: m0.volume, faces: m0.faces, bbox: m0.bbox }; } catch (e) { rec.base = { error: String(e.message).slice(0, 80) }; }
      rec.oracle.occtSeq = occtSeq(doc);
      rec.oracle.brepSeq = brepSeq(doc);
      const picks = (rec.grouped.blendCommands ?? rec.contract.blendCommands ?? []).flatMap((x) => x.edges);
      rec.tailOnlyBlends = doc.features.slice(firstBlend(doc)).every((f) => f.kind === 'fillet'); // OCCT simultaneous = the base before the first blend + all blends in one maker: only valid when nothing else follows the blends
      if (picks.length && sizes.length === 1 && styles.length === 1 && rec.tailOnlyBlends) rec.oracle.occtSim = occtSim(doc, picks, sizes[0], styles[0]);
      if (c.closedForm) rec.oracle.closedForm = c.closedForm;
      if (c.fc) rec.oracle.freecad = c.fc;
      const ref = rec.oracle.occtSim && !rec.oracle.occtSim.refused ? rec.oracle.occtSim : (rec.oracle.occtSeq && !rec.oracle.occtSeq.refused ? rec.oracle.occtSeq : null);
      rec.truthSource = ref === rec.oracle.occtSim ? 'occtSim' : ref ? 'occtSeq' : null;
      const refCF = c.closedForm ? { volume: c.closedForm.volume, faces: c.closedForm.faces ?? asTruck(pane).faces } : null;
      const truth = ref ?? null;
      rec.verdicts = {
        pane: blendsBuilt(pane) ? verdict(asTruck(pane), truth ?? refCF) : (pane.ok ? 'some-refused' : 'error'),
        grouped: blendsBuilt(grouped) ? verdict(asTruck(grouped), truth ?? refCF) : (grouped.ok ? 'some-refused' : 'error'),
        contract: blendsBuilt(contract) ? verdict(asTruck(contract), truth ?? refCF) : (contract.ok ? 'some-refused' : 'error'),
      };
      if (ref?.bbox) rec.bboxDelta = { pane: bboxDelta(pane.bodies?.[0]?.bbox, ref.bbox), grouped: bboxDelta(grouped.bodies?.[0]?.bbox, ref.bbox), contract: bboxDelta(contract.bodies?.[0]?.bbox, ref.bbox) };
      if (c.closedForm) rec.verdicts.closedForm = {
        pane: blendsBuilt(pane) ? verdict(asTruck(pane), { volume: c.closedForm.volume, faces: c.closedForm.faces ?? pane.faces }) : 'refused-or-partial',
        contract: blendsBuilt(contract) ? verdict(asTruck(contract), { volume: c.closedForm.volume, faces: c.closedForm.faces ?? contract.faces }) : 'refused-or-partial',
      };
    }
  } catch (e) { rec.error = String(e.stack ?? e).slice(0, 500); }
  rec.ms = Date.now() - t0;
  results.push(rec); done.add(c.id);
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  const v = rec.verdicts;
  console.log(c.id.padEnd(44), rec.error ? 'ERROR ' + rec.error.slice(0, 120) : `pane ${rec.pane?.volume?.toFixed?.(4)} | contract ${rec.contract?.volume?.toFixed?.(4)} f${rec.contract?.faces} | ${v ? `verdict pane=${v.pane} grouped=${v.grouped} contract=${v.contract}` : 'no oracle'} | ${(rec.contract?.features ?? []).filter((f) => f.status === 'refused').map((f) => f.sentence).slice(0, 1).join('')}`.slice(0, 330));
}
console.log('wrote', outFile, results.length);
