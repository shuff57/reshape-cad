// one document's hollows, each join, with the point check: node one-probe2.mjs <cases.json> <id substring>
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const WT = process.env.WT || new URL('../../../../../../', import.meta.url).pathname; const imp = (p) => import(pathToFileURL(p).href);
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const { buildDoc } = await imp(path.join(WT, 'packages/brep-adapter/dist/occt-build.js'));
const { resolveNameAsUsedBy } = await imp(path.join(WT, 'packages/brep-adapter/dist/topo-resolve.js'));
const { probe } = await import('./study.mjs'); const oc = C.oc;
const vol = (s) => { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, g, 1e-7, false, false); return g.Mass(); };
const cse = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).find((x) => x.id.includes(process.argv[3]));
const raw = typeof cse.script === 'string' ? C.runScript(cse.script).doc : cse.doc; const doc = C.solveDoc(structuredClone(raw)); const built = buildDoc(oc, doc, C.arc);
console.log('rss MB', (process.memoryUsage().rss / 1048576) | 0);
for (const f of doc.features) { if (f.kind !== 'shell') continue; const src = built.shapes.get(f.target); const open = f.open ? resolveNameAsUsedBy(oc, f.open, built, f.target) : null;
  for (const join of ['GeomAbs_Arc', 'GeomAbs_Intersection']) { let s = null;
    try { const op = new oc.BRepOffsetAPI_MakeThickSolid(); const faces = new oc.NCollection_List_TopoDS_Shape(); if (open) faces.Append(open);
      op.MakeThickSolidByJoin(src, faces, -f.thickness, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType[join], false); op.Build(new oc.Message_ProgressRange());
      if (op.IsDone()) { s = op.Shape(); if (!open) { const c = new oc.BRepAlgoAPI_Cut(src, s, new oc.Message_ProgressRange()); s = c.IsDone() ? c.Shape() : null; } } } catch { s = null; }
    if (!s) { console.log(f.id, join, 'does not build'); continue; }
    let r; try { r = probe(src, open, f.thickness, s); r = JSON.stringify({ ...r, bad: r.bad.slice(0, 2) }); } catch (e) { r = 'THREW ' + String(e); }
    console.log(f.id, join, 'volume', vol(s), 'source', vol(src), r); }
  console.log('rss MB', (process.memoryUsage().rss / 1048576) | 0); }
