// Piece hole-counterbore: Pad 40x30x10 plate (corner at origin), hole() dia 6, counterbore dia 10 deep 3, through, at (20,15).
// hole() is the script verb; counterbore is { across, deep }. Variants try at-coordinates in case `at` is plate-centred.
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

const plate = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]);
const plate = extrude(s1, 10);
`;
const variants = {
  atCorner: `hole(plate, { across: 6, at: [20, 15], counterbore: { across: 10, deep: 3 } });`,
  atCentred: `hole(plate, { across: 6, at: [0, 0], counterbore: { across: 10, deep: 3 } });`,
};
const results = {};
for (const [name, tail] of Object.entries(variants)) {
  const src = plate + tail;
  const r = { src };
  try {
    const run = runScript(src);
    if (run.errors?.length) { r.error = JSON.stringify(run.errors); results[name] = r; continue; }
    const doc = run.doc;
    const built = adapter.build(doc);
    r.refusals = Object.fromEntries(built.refusals);
    const last = doc.features.at(-1).id;
    r.lastFeature = last;
    r.builtIds = [...built.shapes.keys()];
    r.shapeBuilt = built.shapes.has(last);
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (m) { r.volume = m.volume; r.bbox = [...m.bbox[0], ...m.bbox[1]]; r.faces = m.faces ?? m.face_count; }
    if (r.shapeBuilt) {
      const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), last, 0.05));
      r.meshTris = mesh.indices ? mesh.indices.length / 3 : 0;
    }
  } catch (e) { r.error = String(e && e.stack || e); }
  results[name] = r;
}
const pick = results.atCentred; // `at` is relative to the plate centre: plate-corner (20,15) == at [0,0]; atCorner cuts a half-outside hole (volume 11891.6 != 11566.46)
const outcome = pick.error ? 'error' : (pick.shapeBuilt && pick.meshTris > 0) ? 'built' : 'refused';
const out = { id: 'hole-counterbore', outcome, ...pick, variants: results };
console.log(JSON.stringify(out, null, 1));
writeFileSync(path.join(HERE, 'ours-hole-counterbore.json'), JSON.stringify(out, null, 1));
