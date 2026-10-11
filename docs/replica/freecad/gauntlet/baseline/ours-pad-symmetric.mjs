// pad-symmetric: Rectangle 40x30 (corner at origin) on XY, Pad 10 Midplane.
// reSHape Script has no `symmetric` option on pull(); the script-layer
// expression is: put the sketch plane 5 below XY (offset -5) and pull 10.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const require = createRequire(path.join(ROOT, 'packages/brep-adapter/package.json'));
const THREE = require('three');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import(new URL(`file://${PKG}/brep_rs.js`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(new URL(`file://${ROOT}/packages/script/dist/reshape-script.js`).href);
const { BrepRsEngineAdapter } = await import(new URL(`file://${ROOT}/packages/brep-adapter/dist/brep-rs-engine-adapter.js`).href);

const code = `const sk = sketch('top', -5); sk.rect(40, 30, { at: [20, 15] }); const pad = extrude(sk, 10);`;
const out = { id: 'pad-symmetric', script: 'docs/replica/freecad/gauntlet/baseline/ours-pad-symmetric.mjs', source: code };
try {
  const r = runScript(code);
  if (r.errors.length) { out.outcome = 'not-expressible'; out.refusal = r.errors.map(e => e.message ?? String(e)).join('; '); }
  else {
    const adapter = new BrepRsEngineAdapter(THREE); adapter.loadFromBytes(brep);
    const built = adapter.build(r.doc);
    const last = r.doc.features.at(-1).id;
    const ref = built.refusals?.[last];
    if (ref || !built.shapes.has(last)) { out.outcome = 'refused'; out.refusal = ref ?? JSON.stringify(built.refusals); }
    else {
      const mesh = adapter.mesh(built.shapes.get(last));
      const m = JSON.parse(brep.measure_doc(JSON.stringify(r.doc))).shapes[last];
      out.volume = m.volume; out.faces = m.faces;
      out.bbox = [...m.bbox[0], ...m.bbox[1]];
      out.meshTriangles = mesh ? mesh.geometry.getIndex().count / 3 : 0;
      out.outcome = mesh && out.meshTriangles > 0 ? 'built' : 'error';
      out.solveStatus = 'n/a (rect sketch, solid piece)';
    }
  }
} catch (e) { out.outcome = 'error'; out.refusal = String(e?.stack ?? e).slice(0, 600); }
out.notes = 'No Midplane option on extrude()/ExtrudeFeature; expressed as sketch offset -5 + pull 10 (script layer). rect() is centre-based, corner-at-origin via at:[20,15].';
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(HERE, 'ours-pad-symmetric.json'), JSON.stringify(out, null, 2) + '\n');
