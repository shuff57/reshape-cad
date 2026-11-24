import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await imp('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await imp('packages/brep-adapter/dist/topo-resolve.js');
const arc = await imp('packages/sketch/dist/sketch-arc.js');
const { solveDoc } = await imp('packages/script/dist/model-codegen.js');
const L = await imp('packages/layer/dist/index.js');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const r of rows) {
  if (!r.doc) { console.log(r.id.padEnd(14), 'NO-RUN (script error)'); continue; }
  const doc = solveDoc({ version: 1, features: r.doc.features });
  const bl = doc.features.find((f) => f.kind === 'blend');
  const st = r.features?.find((f) => f.id === bl?.id)?.status;
  let occ = null, faces = null;
  try { const b = buildDoc(oc, doc, arc); const s = b.shapes.get(bl.id); if (s) { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, g, 1e-7, false, false); occ = g.Mass(); faces = facesOf(oc, s).length; } } catch (e) { occ = 'throw ' + e.message; }
  const page = r.bodies?.length ? r.bodies.reduce((a, b) => a + b.volume, 0) : null;
  const pv = st === 'built' ? r.bodies.find(Boolean) : null;
  const closed = L.postCheckBlend(doc, bl, { kernelVolume: page ?? 0, outlineOf: arc.outlineOf });
  const d = typeof occ === 'number' && page ? Math.abs(page - occ) / occ : null;
  const curved = doc.features.some((f) => f.kind === 'sketch' && (f.shape === 'circle' || f.rounds));
  const G = L.blendLoftGuard; let warp = 0;
  if (!curved) { const os = bl.targets.map((id) => arc.outlineOf(doc.features.find((x) => x.id === id))); if (os.every((o) => o?.ok) && os[0].points.length === os[1].points.length) warp = G.parallelDeviation(G.ccwLoop(os[0].points), G.ccwLoop(os[1].points)); }
  const bar = curved || warp > 1e-9 ? 3e-4 : 1e-9;
  const wrong = st === 'built' && (d === null || d > bar);
  if (wrong) bad++;
  console.log(r.id.padEnd(14), (st ?? '-').padEnd(8), 'page', page?.toFixed(4) ?? '-', 'occt', typeof occ === 'number' ? occ.toFixed(4) : occ, 'faces page/occt', (r.bodies?.[0]?.faces ?? '-') + '/' + (faces ?? '-'), 'd', d?.toExponential(2) ?? '-', closed ? 'POSTCHECK ' + closed.d : '', wrong ? 'WRONG' : '');
}
console.log(bad ? `${bad} WRONG` : 'no built loft is off the OCCT volume');
