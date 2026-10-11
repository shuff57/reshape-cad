// Piece hole-simple: Pad 40x30x10 plate (corner at origin), Hole d6 through at (20,15) from top face.
// hole() centres on the target bbox centre: for this plate the bbox centre IS (20,15), so no at: is needed.
// Variants measured: no-at, at[0,0], at[20,15] (to show whether at: is bbox-relative or absolute).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const { BrepRsEngineAdapter } = await import(path.join(ROOT, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));
const adapter = new BrepRsEngineAdapter({ BufferGeometry: class { setAttribute() {} setIndex() {} computeVertexNormals() {} addGroup() {} }, Float32BufferAttribute: class {} });
adapter.loadFromBytes(brep);

const variants = { noAt: '', atZero: ', at: [0, 0]', atAbs: ', at: [20, 15]' };
const results = {};
for (const [name, extra] of Object.entries(variants)) {
  const src = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]);
const plate = extrude(s1, 10);
hole(plate, { across: 6${extra} });`;
  const r = { src };
  try {
    const run = runScript(src);
    if (run.errors?.length) { r.error = JSON.stringify(run.errors); results[name] = r; continue; }
    const doc = run.doc;
    const built = adapter.build(doc);
    r.refusals = Object.fromEntries(built.refusals);
    const last = doc.features.at(-1).id;
    r.lastFeature = last;
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (m) { r.volume = m.volume; r.bbox = [...m.bbox[0], ...m.bbox[1]]; r.faces = m.faces ?? m.face_count; r.measureKeys = Object.keys(m); }
    r.builtIds = [...built.shapes.keys()];
    r.shapeBuilt = built.shapes.has(last);
    // mesh via real adapter needs THREE; use raw kernel mesh for non-empty check + face count
    const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), last, 0.05));
    r.meshTris = mesh.indices ? mesh.indices.length / 3 : 0;
    r.meshFaces = mesh.faces ? mesh.faces.length : undefined;
  } catch (e) { r.error = String(e && e.stack || e); }
  results[name] = r;
}
const pick = results.noAt;
const out = { id: 'hole-simple', ...pick, variants: results };
console.log(JSON.stringify(out, null, 1));
writeFileSync(path.join(HERE, 'ours-hole-simple.json'), JSON.stringify(out, null, 1));
