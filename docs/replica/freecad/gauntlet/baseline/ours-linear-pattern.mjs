// Piece linear-pattern: Pad 60x20x10 plate, circular Pocket r3 at (10,10) through, LinearPattern 3 occurrences, length 40 along X.
// FreeCAD Length=40 is first-to-last, so spacing 20: pocket centres x=10,30,50.
// reSHape Script has no feature-level pattern (linearPattern/repeat copies the WHOLE solid, model-types.ts:491-498).
// The expressible form is the lowering architecture.md describes: N copies of the pocket feature. Variant A does that.
// Variant B is the whole-solid linearPattern on the pocketed plate (measured to show why it is not the same thing).
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

const head = `const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,20],[0,20]]);
const plate = extrude(s1, 10);
`;
const pk = (i, x) => `const p${i} = sketch('top', 10); p${i}.circle(6, { at: [${x}, 10] });\npocket(p${i}, plate, 12);\n`;
const srcs = {
  A_three_pockets: head + pk(1, 10) + pk(2, 30) + pk(3, 50),
  B_single_pocket_then_wholesolid_linearPattern: head + pk(1, 10) + `linearPattern(plate, { count: 3, step: 20 });\n`,
  C_single_pocket_only: head + pk(1, 10),
};
function run1(src) {
  const r = { src };
  try {
    const run = runScript(src);
    if (run.errors?.length) { r.error = JSON.stringify(run.errors); return r; }
    const doc = run.doc;
    const built = adapter.build(doc);
    r.refusals = Object.fromEntries(built.refusals);
    const last = doc.features.at(-1).id;
    r.lastFeature = last; r.kinds = doc.features.map(f => f.kind);
    r.shapeBuilt = built.shapes.has(last);
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (m) { r.volume = m.volume; r.bbox = [...m.bbox[0], ...m.bbox[1]]; r.faces = m.faces; }
    const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), last, 0.05));
    r.meshTris = mesh.indices ? mesh.indices.length / 3 : 0;
  } catch (e) { r.error = String(e && e.stack || e); }
  return r;
}
const variants = Object.fromEntries(Object.entries(srcs).map(([k, v]) => [k, run1(v)]));
const A = variants.A_three_pockets;
const expected = 60 * 20 * 10 - 3 * Math.PI * 9 * 10;
const out = {
  id: 'linear-pattern',
  outcome: A.shapeBuilt && A.meshTris > 0 && !Object.keys(A.refusals || {}).length ? 'built' : (Object.keys(A.refusals || {}).length ? 'refused' : 'error'),
  expectedVolume: expected,
  ...A, variants,
};
console.log(JSON.stringify(out, null, 1));
writeFileSync(path.join(HERE, 'ours-linear-pattern.json'), JSON.stringify(out, null, 1));
