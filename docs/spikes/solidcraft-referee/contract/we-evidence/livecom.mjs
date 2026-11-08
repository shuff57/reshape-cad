// livecom.mjs <corpus-stored-json> <host rows jsonl> <ids,comma>: OCCT (per-solid COM) and brep-rs (mesh COM about the box centre) on the SOLVED doc of a
// stored ep case, against the host's measured COM, for rows the probe scored on a stored reference with no COM
import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { readFileSync } from 'node:fs';
const WT = process.env.WT; const imp = (p) => import(pathToFileURL(p).href);
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const { buildDoc } = await imp(path.join(WT, 'packages/brep-adapter/dist/occt-build.js'));
const cases = new Map(JSON.parse(readFileSync(process.argv[2], 'utf8')).map((c) => [c.id, c]));
const rows = new Map(readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
for (const id of process.argv[4].split(',')) {
  const c = cases.get(id); const r = rows.get(id); const m = r.final.m;
  const doc = C.solveDoc(structuredClone(C.runScript(c.script).doc)); const fid = c.finalId ?? doc.features.at(-1).id;
  const bt = buildDoc(C.oc, doc, C.arc); const sh = bt.shapes.get(fid); let occt = null;
  if (sh) { const ex = new C.oc.TopExp_Explorer(sh, C.oc.TopAbs_ShapeEnum.TopAbs_SOLID, C.oc.TopAbs_ShapeEnum.TopAbs_SHAPE); let V = 0; const oc = [0, 0, 0];
  for (; ex.More(); ex.Next()) { const g = new C.oc.GProp_GProps(); C.oc.BRepGProp.VolumeProperties(ex.Current(), g, 1e-7, false, false); const v = g.Mass(); const p = g.CentreOfMass(); V += v; oc[0] += v * p.X(); oc[1] += v * p.Y(); oc[2] += v * p.Z(); }
  occt = { volume: V, com: oc.map((x) => x / V) }; } else occt = null;
  const occtRefused = sh ? null : String((bt.refusals instanceof Map ? bt.refusals.get(fid) : bt.refusals?.[fid]) ?? 'built nothing').slice(0, 160);
  const bb = m.bbox; const o = [0, 1, 2].map((k) => (bb[k] + bb[k + 3]) / 2); const diag = Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
  const g = JSON.parse(C.brep.mesh_feature(JSON.stringify(doc), fid, diag * 2e-5)); let brep = null;
  if (!g.error) { const P = g.positions.map((v, i) => v - o[i % 3]); const I = g.indices; let W = 0; const bc = [0, 0, 0];
    for (let t = 0; t < I.length; t += 3) { const [a, b, d] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3]; const v = (P[a] * (P[b + 1] * P[d + 2] - P[b + 2] * P[d + 1]) - P[a + 1] * (P[b] * P[d + 2] - P[b + 2] * P[d]) + P[a + 2] * (P[b] * P[d + 1] - P[b + 1] * P[d])) / 6; W += v; for (let k = 0; k < 3; k++) bc[k] += v * (P[a + k] + P[b + k] + P[d + k]) / 4; }
    brep = { volume: Math.abs(W), com: bc.map((x, k) => x / W + o[k]) }; }
  const dc = (x) => (x ? Math.max(...x.com.map((v, i) => Math.abs(v - m.com[i]))) / diag : null);
  console.log(JSON.stringify({ id, host: { volume: m.volume, com: m.com }, occt, occtRefused, brep, dComOCCT: dc(occt), dComBrep: dc(brep) }));
}
