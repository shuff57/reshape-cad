// Piece groove-coaxial: the same part as `groove` (cylinder r20 h30, ring x18..20 z10..15 about Z) written the way a groove spins:
// on the TOP plane, whose normal is the post axis. Reference: ref-groove.json (the Z-axis ring, measured once).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const script = process.env.GROOVE_SCRIPT || `
const sk1 = sketch('top'); sk1.circle(40);
const cyl = extrude(sk1, 30);
const sk2 = sketch('top'); sk2.rect(2, 5, { at: [19, 12.5] });
groove(sk2, cyl, 360);
`;
const out = { id: 'groove-coaxial', script: path.join(HERE, 'ours-groove-coaxial.mjs'), scriptSource: script, outcome: 'error', notes: '' };
try {
  const r = runScript(script);
  if (r.errors.length) { out.outcome = 'not-expressible'; out.notes = JSON.stringify(r.errors); }
  else {
    const j = JSON.stringify(r.doc);
    const last = r.doc.features.at(-1).id;
    out.featureKinds = r.doc.features.map(f => f.kind);
    out.sketches = r.doc.features.filter(f => f.kind === 'sketch').map(f => ({ id: f.id, plane: f.plane, offset: f.offset, points: f.points }));
    const b = JSON.parse(brep.build_doc_json(j));
    out.refusals = b.refusals;
    const m = JSON.parse(brep.measure_doc(j)).shapes[last];
    if (b.refusals && Object.keys(b.refusals).length) {
      out.outcome = 'refused'; out.refusal = Object.values(b.refusals).join(' | ');
    }
    else if (!m) { out.outcome = 'error'; out.notes = 'no measurement for last feature'; }
    else {
      out.outcome = 'built'; out.volume = m.volume; out.bbox = m.bbox.flat(); out.faces = m.faces;
      out.expected = { volume: Math.PI * 400 * 30 - Math.PI * (400 - 324) * 5 * 360 / 360 };
      out.notes = 'measure_doc on the same doc';
    }
  }
} catch (e) { out.outcome = 'error'; out.notes = String(e && e.stack || e); }
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(HERE, 'ours-groove-coaxial.json'), JSON.stringify(out, null, 2));
