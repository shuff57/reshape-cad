// Piece pocket-blind: 40x30x10 plate, 10x10 square pocket centred at (20,15), blind depth 4.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const script = `
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
pocket(sk2, plate, 4);
`;
const out = { id: 'pocket-blind', script, outcome: 'error', notes: '' };
try {
  const r = runScript(script);
  if (r.errors.length) { out.outcome = 'not-expressible'; out.notes = JSON.stringify(r.errors); }
  else {
    const j = JSON.stringify(r.doc);
    const last = r.doc.features.at(-1).id;
    const b = JSON.parse(brep.build_doc_json(j));
    out.refusals = b.refusals;
    const m = JSON.parse(brep.measure_doc(j)).shapes[last];
    out.kinds = r.doc.features.map(f => f.kind);
    if (b.refusals && Object.keys(b.refusals).length) { out.outcome = 'refused'; out.refusal = Object.values(b.refusals).join(' | '); }
    else if (!m) { out.outcome = 'error'; out.notes = 'no measurement for last feature'; }
    else {
      out.outcome = 'built'; out.volume = m.volume; out.bbox = m.bbox.flat(); out.faces = m.faces;
      out.expected = { volume: 40*30*10 - 10*10*4 };
      const mesh = JSON.parse(brep.mesh_feature(j, last, 0.1));
      out.meshKeys = Object.keys(mesh); out.meshTriangles = (mesh.indices || mesh.triangles || []).length / 3;
      if (!(out.meshTriangles > 0)) { out.outcome = 'error'; out.notes = 'empty mesh'; }
    }
  }
} catch (e) { out.outcome = 'error'; out.notes = String(e && e.stack || e); }
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(HERE, 'ours-pocket-blind.json'), JSON.stringify(out, null, 2));
