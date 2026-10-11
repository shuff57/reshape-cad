// Piece mirrored: Pad 40x30x10, circular Pocket r3 at (10,15) through, Mirrored across the YZ plane through x=20.
// reSHape Script: mirror(pocketHandle, 'left-right', { at: 20 }) lowers to a reflected copy of the CUT (one more sketch and
// pocket), the way FreeCAD's PartDesign::Mirrored repeats the feature. Without { at } mirror() is still the whole-shape
// mirror through the origin, which is a different operation. The record is measured fresh from the built kernel each run.
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


function measure(src) {
  const r = { src };
  try {
    const run = runScript(src);
    if (run.errors?.length) { r.outcome = 'not-expressible'; r.refusal = run.errors.map((e) => e.message).join(' | '); return r; }
    const doc = run.doc;
    const built = adapter.build(doc);
    r.refusals = Object.fromEntries(built.refusals);
    r.kinds = doc.features.map((f) => f.kind);
    const last = doc.features.at(-1).id;
    r.lastFeature = last;
    r.shapeBuilt = built.shapes.has(last);
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (m) { r.volume = m.volume; r.bbox = [...m.bbox[0], ...m.bbox[1]]; r.faces = m.faces ?? m.face_count; }
    const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), last, 0.05));
    r.meshTris = mesh.indices ? mesh.indices.length / 3 : 0;
    r.outcome = r.shapeBuilt && !Object.keys(r.refusals).length && Number.isFinite(r.volume) ? 'built' : (Object.keys(r.refusals).length ? 'refused' : 'error');
    if (r.outcome === 'refused') r.refusal = Object.values(r.refusals).join(' | ');
  } catch (e) { r.outcome = 'error'; r.error = String(e && e.stack || e); }
  return r;
}

const PLATE = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]);
const plate = extrude(s1, 10);
const s2 = sketch('top', 10); s2.circle(6, { at: [10, 15] });
const p = pocket(s2, plate, 10);
`;
// the piece
const main = measure(PLATE + `mirror(p, 'left-right', { at: 20 });`);
// a second feature built AFTER the pocket that is mirrored: it must stay in the final part (no dead branch)
const later = measure(PLATE + `const s3 = sketch('top', 10); s3.circle(4, { at: [20, 6] });
const q = pocket(s3, p, 10);
mirror(p, 'left-right', { at: 20 });`);
// unmirrored base, for reference
const base = measure(PLATE.trimEnd());

const out = {
  id: 'mirrored',
  ...main,
  notes: 'main = mirror(p, "left-right", { at: 20 }) lowered to a reflected pocket. variants.laterFeature keeps a pocket built after the mirrored one; variants.base is the unmirrored plate.',
  variants: { laterFeature: later, base },
};
console.log(JSON.stringify(out, null, 1));
writeFileSync(path.join(HERE, 'ours-mirrored.json'), JSON.stringify(out, null, 1));
