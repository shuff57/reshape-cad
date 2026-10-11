// Piece fillet-after-pocket: 40x30x10 plate, 10x10 pocket blind 4 at centre, fillet the 4 top edges of the pocket opening, r=1.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const PRE = `
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
const part = pocket(sk2, plate, 4);
`;
// Candidate ways to say "the pocket-opening edges" in today's script. Pocket walls are not primitive faces,
// so the only edge vocabulary is plate.edge(faceWord, faceWord) over the original box faces.
const candidates = [
  ['part.rim(sk2): the four pocket-opening edges, named by the pocket walls', PRE + `round(part.rim(sk2), 1);`],
  ['part.edge(top, front) on the pocketed handle', PRE + `round(part.edge('top', 'front'), 1);`],
  ['plate.edge(top, front) on the pre-pocket handle (fillet then ignores the pocket)', PRE + `round(plate.edge('top', 'front'), 1);`],
  ['round(part, 1) whole shape', PRE + `round(part, 1);`],
];
const out = { id: 'fillet-after-pocket', outcome: 'not-expressible', notes: '', attempts: [] };
function attempt(script) {
  const a = { script };
  const r = runScript(script);
  if (r.errors.length) { a.outcome = 'not-expressible'; a.notes = JSON.stringify(r.errors); return a; }
  const j = JSON.stringify(r.doc);
  const last = r.doc.features.at(-1).id;
  a.kinds = r.doc.features.map(f => f.kind);
  const b = JSON.parse(brep.build_doc_json(j));
  a.refusals = b.refusals;
  const refused = b.refusals && Object.keys(b.refusals).length;
  if (refused) a.refusal = Object.values(b.refusals).join(' | ');
  const m = JSON.parse(brep.measure_doc(j)).shapes[last];
  if (!m) { a.outcome = 'error'; a.notes = 'no measurement'; return a; }
  a.volume = m.volume; a.bbox = m.bbox.flat(); a.faces = m.faces;
  const mesh = JSON.parse(brep.mesh_feature(j, last, 0.1));
  a.meshTriangles = (mesh.indices || []).length / 3;
  a.outcome = a.meshTriangles <= 0 ? 'error' : refused ? 'refused' : 'built';
  return a;
}
try {
  for (const [label, s] of candidates) { try { const a = attempt(s); a.label = label; out.attempts.push(a); } catch (e) { out.attempts.push({ label, script: s, outcome: 'error', notes: String(e && e.stack || e) }); } }
  const rim = out.attempts[0];
  const REF = JSON.parse(readFileSync(path.join(HERE, 'ref-fillet-after-pocket.json'), 'utf8'));
  // The names resolve in the kernel when no refusal says the edge could not be found; a refusal is then the kernel's own sentence.
  const unresolved = Object.values(rim.refusals || {}).some(w => /could not be found/.test(w));
  out.expressible = rim.outcome === 'built' || (rim.outcome === 'refused' && !unresolved);
  out.script = rim.script;
  const rel = rim.volume === undefined ? null : Math.abs(rim.volume - REF.volume) / REF.volume;
  // compare.mjs does the comparing (it only compares a piece whose outcome is 'built'); the classification here is the
  // script's own record, kept beside it.
  out.outcome = rim.outcome === 'built' ? 'built' : rim.outcome === 'refused' ? 'refused' : 'not-expressible';
  out.classification = rim.outcome === 'built' && rel < 1e-6 && rim.faces === REF.faces ? 'match' : rim.outcome === 'refused' ? 'refused' : rim.outcome === 'built' ? 'built-mismatch' : 'not-expressible';
  Object.assign(out, { volume: rim.volume, bbox: rim.bbox, faces: rim.faces, refusals: rim.refusals, kinds: rim.kinds, refVolume: REF.volume, refFaces: REF.faces, relDelta: rel });
  out.notes = 'part.rim(sk2) names the four pocket-opening edges (a pocket wall is named by the sketch side that swept it, and survives edits of the plate). Naming a wall writes the pocket as pull(sk2, -4) subtracted from the plate so the kernel can find the walls. The kernel builds the four rounds together with the corners mitred (each round extended by its radius into the corner and cut by the plane of symmetry, the two quarter cylinders meeting along an ellipse arc), which is the solid FreeCAD builds. See attempts[].';
} catch (e) { out.outcome = 'error'; out.notes = String(e && e.stack || e); }
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(HERE, 'ours-fillet-after-pocket.json'), JSON.stringify(out, null, 2));
