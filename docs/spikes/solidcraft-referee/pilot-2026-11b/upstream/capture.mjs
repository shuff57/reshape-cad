// the command lists behind four engine findings, as the layer sends them on the pin (0.30.1), for trying on another release
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const WT = process.env.WT ?? '/home/shuff57/Documents/GitHub/reshape-cad'; const R = process.env.HOME + '/.cache/solidcraft-0.30.1-rig'; const imp = (p) => import(pathToFileURL(p).href);
process.env.WT = WT; process.env.SOLIDCRAFT_REFEREE_PKG ??= R + '/sc-referee-pkg'; process.env.SOLIDCRAFT_TOPOLOGY_PKG ??= R + '/sc-referee-pkg-topology';
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const H = await imp(path.join(WT, 'packages/solidcraft-host/pane/src/host-entry.mjs'));
const up = (await imp(path.join(WT, 'packages/layer/test/topology-upstream.mjs'))).loadUpstream(process.env.SOLIDCRAFT_TOPOLOGY_PKG);
const topologyOf = async (cmds) => { const t = await up.topologyOf(cmds); if (!t.ok) return t; const m = await up.runSC(cmds); return m.ok ? { ...t, measure: m.measure } : t; };
async function capture(raw) {
  const doc = C.solveDoc(structuredClone(raw)); const lists = [];
  const runSC = async (cmds) => { let res; try { res = await C.runSC(cmds); } catch (e) { res = { ok: false, failed: { command: '(wasm)', error: 'WASM TRAP: ' + e.message } }; } lists.push({ cmds: structuredClone(cmds), ok: !!res?.ok, error: res?.failed ? String(res.failed.error).slice(0, 200) : null }); return res; };
  const tr = await H.translateDoc(doc, { arc: C.arc, mt: C.mt, runSC, soups: {}, followMoves: true, fromUsage: H.hostFromUsage(doc, { recorded: false }), topologyOf });
  return { accepted: tr.commands, features: tr.features.map((f) => [f.id, f.status, (f.refusal ?? '').slice(0, 80)]), failed: lists.filter((l) => !l.ok).map((l) => ({ error: l.error, commands: l.cmds })) };
}
const prim = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });
const stop = JSON.parse(fs.readFileSync(path.join(WT, 'docs/spikes/solidcraft-referee/pilot-2026-11b/timing/continue/engine-stop-case.json'), 'utf8'))[0].doc;
const out = {
  'panic: a pocket into a drafted cylinder': await capture(stop),
  'round: a box with all twelve edges rounded': await capture({ version: 1, features: [{ id: 'b1', kind: 'box', size: [20, 20, 10], center: [8, -5, 3], round: 2, roundStyle: 'fillet' }] }),
  'cylinder: plain': await capture({ version: 1, features: [{ id: 'c1', kind: 'cylinder', radius: 8, height: 30, center: [8, -5, 3] }] }),
  'cylinder: with a pocket': await capture({ version: 1, features: [{ id: 'c1', kind: 'cylinder', radius: 8, height: 30, center: [8, -5, 3] }, { id: 'sk2', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [6, 0], [6, 4], [0, 4]] }, { id: 'pk3', kind: 'pocket', target: 'sk2', into: 'c1', depth: 2 }] }),
  'box: a prism hollowed, a cross bore through the rim': await capture({ version: 1, features: [{ id: 'p1', kind: 'prism', sides: 5, radius: 12, height: 12, center: [0, 0, 0] }, { id: 's2', kind: 'shell', target: 'p1', thickness: 2, open: prim('p1', '+z') }, { id: 'h3', kind: 'hole', target: 's2', diameter: 6, depth: 40, center: [4, 0, 5], axis: 'x' }] }),
};
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
for (const k in out) console.log(k, '| accepted', out[k].accepted.length, 'commands |', out[k].features.map((f) => f[0] + ':' + f[1]).join(' '), '| failed runs', out[k].failed.length, out[k].failed[0]?.error ?? '');
