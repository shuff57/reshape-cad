// Piece hole-countersink: Pad 40x30x10 plate (corner at origin), Hole d6, countersink d12 / 90deg, through, at (20,15).
// hole() `at` is an OFFSET from the target's bbox centre (kernel centres the tool there), so world (20,15) on a plate
// spanning 0..40 x 0..30 is at:[0,0]. Variant `at2015` passes [20,15] literally to show the offset semantics.
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

const head = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]);
const plate = extrude(s1, 10);
`;
const variants = {
  centred: head + `hole(plate, { across: 6, countersink: { across: 12, angle: 90 } });`,
  at2015: head + `hole(plate, { across: 6, at: [20, 15], countersink: { across: 12, angle: 90 } });`,
};
const results = {};
for (const [name, src] of Object.entries(variants)) {
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
    if (m) { r.volume = m.volume; r.bbox = [...m.bbox[0], ...m.bbox[1]]; r.faces = m.faces ?? m.face_count; }
    r.shapeBuilt = built.shapes.has(last);
    const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), last, 0.05));
    r.meshTris = mesh.indices ? mesh.indices.length / 3 : 0;
  } catch (e) { r.error = String(e && e.stack || e); }
  results[name] = r;
}
// closed form: 40*30*10 - pi*9*10 - cone frustum extra (r 3 -> 6 over depth 3 at 90deg included)
const h = 3, r1 = 3, r2 = 6;
const expected = 12000 - Math.PI * 9 * 10 - (Math.PI * h / 3) * (r1*r1 + r1*r2 + r2*r2 - 3*3 * 3 / 3 * 0 - 3*r1*r1 + 3*r1*r1) + 0;
const frustum = (Math.PI * h / 3) * (r1*r1 + r1*r2 + r2*r2) - Math.PI * 9 * h;
const closed = 12000 - Math.PI * 9 * 10 - frustum;
const pick = results.centred;
const ok = pick.shapeBuilt && pick.meshTris > 0 && !Object.keys(pick.refusals || {}).length;
const out = { id: 'hole-countersink', outcome: pick.error ? 'error' : (ok ? 'built' : 'refused'), closedFormVolume: closed, ...pick, variants: results };
console.log(JSON.stringify(out, null, 1));
writeFileSync(path.join(HERE, 'ours-hole-countersink.json'), JSON.stringify(out, null, 1));
