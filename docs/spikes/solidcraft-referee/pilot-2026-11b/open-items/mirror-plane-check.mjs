// mirror-plane-check.mjs <reference tree> <tree>... -- <cases.json>...: every mirror step of every document, built by the OCCT referee of each tree
// (packages/brep-adapter/dist/occt-build.js) and compared with the reference tree's: the same face of the part, the same number of pieces, the same
// volume. No engine is run, so it needs no lock. A document is cut off after its last mirror (what follows cannot change a mirror).
//   reference: a tree from before 2026-11-14, whose referee put the plane at the part's box rounded to 1e-4 mm
//   SAME_MM (2.1e-4): twice that rounding, the furthest a copy's far end can move when the plane is read exactly
// Written for the regression of 2026-11-14: read exactly, a box from -15.000000000000002 to 15 has its high face nearer zero, and the copy of
// `combined seed 340` went to the other side. The referee now says "as far as each other" with a tolerance and takes the low face, as before.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SAME_MM = 2.1e-4;
const args = process.argv.slice(2); const cut = args.indexOf('--'); const trees = args.slice(0, cut); const files = args.slice(cut + 1);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const OCCT_DIR = path.join(root, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const arc = await import(pathToFileURL(path.join(root, 'packages/sketch/dist/sketch-arc.js')).href);
const { solveDoc } = await import(pathToFileURL(path.join(root, 'packages/script/dist/model-codegen.js')).href);
const builders = []; for (const t of trees) builders.push((await import(pathToFileURL(path.join(t, 'packages/brep-adapter/dist/occt-build.js')).href)).buildDoc);
function measure(shape) {
  const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false); const lo = bx.CornerMin(), hi = bx.CornerMax();
  const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); let solids = 0; for (; ex.More(); ex.Next()) solids++;
  const r = { volume: g.Mass(), box: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], solids };
  g.delete(); bx.delete(); lo.delete(); hi.delete(); ex.delete(); return r;
}
const refusalOf = (rf, id) => (rf == null ? null : rf instanceof Map ? rf.get(id) ?? null : rf[id] ?? null);
function refusedUnder(doc, id, refusals) { // as the sweep: a step resting on a refused step is not an answer
  const by = new Map(doc.features.map((f) => [f.id, f])); const seen = new Set(); const todo = [id];
  while (todo.length) { const x = todo.pop(); if (seen.has(x)) continue; seen.add(x); if (refusalOf(refusals, x)) return true;
    const f = by.get(x); if (!f) continue; for (const k of ['target', 'into']) if (typeof f[k] === 'string') todo.push(f[k]); if (Array.isArray(f.targets)) todo.push(...f.targets); }
  return false;
}
const tot = trees.map(() => ({ same: 0, 'other face': 0, 'pieces differ': 0, 'volume differs': 0, 'refused here, built by the reference': 0, 'built here, refused by the reference': 0 }));
let docs = 0, mirrors = 0, both = 0, threw = 0; const rows = [];
for (const file of files) {
  const cases = JSON.parse(fs.readFileSync(file, 'utf8')); const name = `${path.basename(path.dirname(path.dirname(file)))}/${path.basename(file, '.json')}`;
  for (const c of cases) {
    const feats = c.doc?.features; if (!feats) continue; const last = feats.map((f) => f.kind).lastIndexOf('mirror'); if (last < 0) continue;
    const ids = feats.slice(0, last + 1).filter((f) => f.kind === 'mirror').map((f) => f.id); docs++; mirrors += ids.length;
    let doc; try { doc = solveDoc({ ...c.doc, features: feats.slice(0, last + 1) }); } catch { threw++; continue; }
    const got = builders.map((b) => { try { const r = b(oc, structuredClone(doc), arc); return Object.fromEntries(ids.map((id) => [id, refusedUnder(doc, id, r.refusals) || !r.shapes.get(id) ? null : measure(r.shapes.get(id))])); } catch { return Object.fromEntries(ids.map((id) => [id, null])); } });
    for (const id of ids) { const ref = got[0][id]; if (ref) both++;
      for (let t = 1; t < trees.length; t++) { const m = got[t][id]; let what;
        if (!ref && !m) continue;
        if (!ref) what = 'built here, refused by the reference'; else if (!m) what = 'refused here, built by the reference';
        else { const dBox = Math.max(...ref.box.map((x, i) => Math.abs(x - m.box[i]))); const dV = Math.abs(m.volume - ref.volume) / Math.max(1, Math.abs(ref.volume));
          what = dBox > SAME_MM ? 'other face' : m.solids !== ref.solids ? 'pieces differ' : dV > 1e-6 ? 'volume differs' : 'same';
          if (what !== 'same') rows.push(`${path.basename(trees[t])}  ${what}  ${name} ${c.id} ${id}: box ${dBox.toExponential(1)} mm, volume ${dV.toExponential(1)}, pieces ${ref.solids} -> ${m.solids}`); }
        tot[t][what]++; if (what.startsWith('built') || what.startsWith('refused')) rows.push(`${path.basename(trees[t])}  ${what}  ${name} ${c.id} ${id}`); } }
  }
}
console.log(`${files.length} files; ${docs} documents with a mirror, ${mirrors} mirror steps, ${both} built by the reference (${path.basename(trees[0])}); ${threw} documents the solver threw on`);
for (let t = 1; t < trees.length; t++) console.log(`${path.basename(trees[t])}: ${JSON.stringify(tot[t])}`);
for (const r of rows) console.log('  ' + r);
