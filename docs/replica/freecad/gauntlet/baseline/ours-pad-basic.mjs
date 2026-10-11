// pad-basic: Rectangle 40x30 on XY (corner at origin), Pad 10 up. reSHape Script -> ModelDoc -> brep-rs wasm via the adapter.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ours-pad-basic.json');
const req = createRequire(path.join(ROOT, 'packages/brep-adapter/package.json'));
const result = { id: 'pad-basic', outcome: 'error', script: fileURLToPath(import.meta.url), notes: '' };
const SCRIPT = "const sk = sketch('top'); sk.rect(40, 30, { at: [20, 15] }); extrude(sk, 10);";
try {
  const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
  brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
  const THREE = await import(pathToFileURL(req.resolve('three')).href);
  const { runScript } = await import(pathToFileURL(path.join(ROOT, 'packages/script/dist/reshape-script.js')).href);
  const { BrepRsEngineAdapter } = await import(pathToFileURL(path.join(ROOT, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js')).href);
  const adapter = new BrepRsEngineAdapter(THREE); adapter.loadFromBytes(brep);
  const r = runScript(SCRIPT);
  result.scriptSource = SCRIPT;
  if (r.errors.length) { result.outcome = 'error'; result.notes = 'runScript errors: ' + JSON.stringify(r.errors); }
  else {
    const b = adapter.build(r.doc);
    const last = r.doc.features.at(-1).id;
    result.featureKinds = r.doc.features.map(f => f.kind);
    if (b.refusals.size || !b.shapes.has(last)) {
      result.outcome = 'refused';
      result.refusal = [...b.refusals.values()].join(' | ') || 'no shape built';
      result.notes = 'kernel refused';
    } else {
      const m = JSON.parse(brep.measure_doc(JSON.stringify(r.doc))).shapes[last];
      const mesh = adapter.mesh(b.shapes.get(last));
      const tris = mesh ? (mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3) : 0;
      result.volume = m.volume; result.faces = m.faces;
      result.bbox = [...m.bbox[0], ...m.bbox[1]];
      result.meshTriangles = tris;
      result.outcome = tris > 0 ? 'built' : 'error';
      result.notes = tris > 0 ? 'built via adapter (rect at is the CENTRE, so at:[20,15] puts the corner at the origin); volume/bbox/faces from measure_doc on the same doc' : 'built but mesh empty';
    }
  }
} catch (e) { result.outcome = 'error'; result.notes = String(e && e.stack || e); }
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
