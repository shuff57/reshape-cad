// every hollow of the corpora and the new documents on OCCT with the arc join and with the mitred join: where do the two differ, and where does one fail?
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const WT = process.env.WT || new URL('../../../../../../', import.meta.url).pathname; const imp = (p) => import(pathToFileURL(p).href);
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const { buildDoc } = await imp(path.join(WT, 'packages/brep-adapter/dist/occt-build.js'));
const { resolveNameAsUsedBy } = await imp(path.join(WT, 'packages/brep-adapter/dist/topo-resolve.js'));
const oc = C.oc; const R = process.env.HOME + '/.cache/solidcraft-0.30.1-rig';
const vol = (s) => { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, g, 1e-7, false, false); return g.Mass(); };
function hollow(src, open, t, join) {
  try {
    const op = new oc.BRepOffsetAPI_MakeThickSolid(); const faces = new oc.NCollection_List_TopoDS_Shape(); if (open) faces.Append(open);
    op.MakeThickSolidByJoin(src, faces, -t, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType[join], false);
    op.Build(new oc.Message_ProgressRange());
    if (!op.IsDone()) return null;
    const v = open ? vol(op.Shape()) : vol(src) - vol(op.Shape()); const vs = vol(src);
    return Number.isFinite(v) && v > 0 && v < vs ? v : null;
  } catch { return null; }
}
const sets = [['h32/cases', ['holes', 'sd', 'mt', 'combined', 'rgcombined', 'fccombined']], ['h39/cases', ['combined', 'rgcombined', 'fccombined']], ['h45/cases', ['combined', 'rgcombined', 'fccombined']]];
const t = {}; const ex = {}; let docs = 0, shells = 0; const add = (k, s) => { t[k] = (t[k] ?? 0) + 1; (ex[k] ??= []).push(s); };
for (const [d, cs] of sets) for (const c of cs) for (const cse of JSON.parse(fs.readFileSync(`${R}/${d}/${c}.json`, 'utf8'))) {
  let raw; if (typeof cse.script === 'string') { const r = C.runScript(cse.script); if (r.errors.length) continue; raw = r.doc; } else raw = cse.doc;
  if (!raw.features.some((f) => f.kind === 'shell')) continue;
  let doc, built; try { doc = C.solveDoc(structuredClone(raw)); built = buildDoc(oc, doc, C.arc); } catch { continue; }
  docs++;
  for (const f of doc.features) { if (f.kind !== 'shell' || !(f.thickness > 0)) continue;
    const src = built.shapes.get(f.target); if (!src) continue;
    // only where everything the hollow rests on was built by the referee
    let ok = true; { const by = new Map(doc.features.map((x) => [x.id, x])); const todo = [f.target]; const seen = new Set(); while (todo.length) { const x = todo.pop(); if (seen.has(x)) continue; seen.add(x); if (built.refusals.get?.(x)) { ok = false; break; } const g = by.get(x); if (!g) continue; for (const k of ['target', 'into']) if (typeof g[k] === 'string') todo.push(g[k]); if (Array.isArray(g.targets)) todo.push(...g.targets); } }
    if (!ok) continue;
    let open = null; if (f.open) { try { open = resolveNameAsUsedBy(oc, f.open, built, f.target); } catch { open = null; } if (!open) continue; }
    shells++; const a = hollow(src, open, f.thickness, 'GeomAbs_Arc'), m = hollow(src, open, f.thickness, 'GeomAbs_Intersection');
    const where = `${c}:${cse.id.replace(/^[^#]+#\d+ /, '')} ${f.id}`;
    if (a === null && m === null) add('both fail', where);
    else if (a === null) add('arc fails, mitre builds', `${where} ${m}`);
    else if (m === null) add('ARC BUILDS, MITRE FAILS', `${where} ${a}`);
    else if (Math.abs(a - m) <= 1e-9 * Math.max(1, a)) add('both build, the same', where);
    else add('both build, they differ', `${where} arc ${a} mitre ${m} rel ${((a - m) / m).toExponential(2)}`);
  }
}
console.log(`documents with a hollow ${docs}, hollows tried ${shells}`); for (const k of Object.keys(t).sort()) console.log(String(t[k]).padStart(6), k, '\n         ', ex[k].slice(0, 6).join('\n          '));
fs.writeFileSync(process.argv[2] ?? '/tmp/join-all.json', JSON.stringify({ t, ex }, null, 1));
