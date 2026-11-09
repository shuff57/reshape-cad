// hr-one.mjs <cases.json>: each {id, script, P?} through the HOST ROUTE exactly as host-route-com.mjs runs it (host-entry translateDoc, pane.js ctx, preflightScript,
// fromUsage, topologyOf with measure); prints every feature's status / guard / sentence and the scene volume, against P where given.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const WT = process.env.WT; const imp = (p) => import(pathToFileURL(p).href);
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const H = await imp(path.join(WT, 'packages/solidcraft-host/pane/src/host-entry.mjs'));
const up = (await imp(path.join(WT, 'packages/layer/test/topology-upstream.mjs'))).loadUpstream(process.env.SOLIDCRAFT_TOPOLOGY_PKG);
const topologyOf = async (cmds) => { const t = await up.topologyOf(cmds); if (!t.ok) return t; const m = await up.runSC(cmds); return m.ok ? { ...t, measure: m.measure } : t; };
const { runScript } = await imp(path.join(WT, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(WT, 'packages/script/dist/model-codegen.js'));
for (const c of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  const pf = H.preflightScript ? H.preflightScript(c.script) : null;
  if (pf) { console.log(JSON.stringify({ id: c.id, preflight: pf.sentence })); continue; }
  const r = runScript(c.script); if (r.errors.length) { console.log(JSON.stringify({ id: c.id, scriptError: r.errors[0].message })); continue; }
  const doc = solveDoc(r.doc);
  const ctx = { arc: C.arc, mt: C.mt, runSC: (cmds) => C.runSC(cmds), soups: {}, followMoves: true, fromUsage: H.draftFromUsage(c.script), topologyOf };
  const tr = await H.translateDoc(structuredClone(doc), ctx);
  const sc = await C.runSC(tr.commands); const V = sc.ok ? (sc.measure?.bodies ?? []).reduce((s, b) => s + b.volume_mm3, 0) : null;
  console.log(JSON.stringify({ id: c.id, pkg: path.basename(path.dirname(process.env.SOLIDCRAFT_REFEREE_PKG)), feats: tr.features.map((f) => [f.id, f.kind, f.status, f.guard ?? null, f.refusal ?? null]), sceneVolume: V, P: c.P ?? null, rel: V != null && c.P ? Math.abs(V - c.P) / c.P : null }));
}
