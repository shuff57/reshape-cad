// Piece groove: cylinder r20 h30, ring groove x18..20 z10..15 revolved 360 about Z.
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
const sk2 = sketch('front'); sk2.rect(2, 5, { at: [19, 12.5] });
groove(sk2, cyl, 360);
`;
const out = { id: 'groove', script: path.join(HERE, 'ours-groove.mjs'), scriptSource: script, outcome: 'error', notes: '' };
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
      // Measured 2026-10-12: a groove spins its sketch about the sketch plane's normal. This front-plane script therefore
      // describes a ring about Y, not the Z-axis ring ref-groove.py measures (36505.30663471339, 7 faces). FreeCAD builds
      // the Y-axis ring as well (PartDesign Groove on an XY sketch about its V axis: 37332.6605, 7 faces, valid) but its two
      // mirror placements disagree at the 8th digit (a ring of the post's own radius crossing it at right angles).
      out.differenceFromRef = 'script spins about Y (front-plane normal), the reference about Z; FreeCAD builds the Y-axis ring as 37332.6605 / 7 faces and brep-rs refuses it in the sentence above. The Z-axis ring written on the top plane builds and equals FreeCAD (whole turn 36505.30663471339 / 7 faces, part turns 8 faces).';
    }
    else if (!m) { out.outcome = 'error'; out.notes = 'no measurement for last feature'; }
    else {
      out.outcome = 'built'; out.volume = m.volume; out.bbox = m.bbox.flat(); out.faces = m.faces;
      out.expected = { volume: Math.PI * 400 * 30 - Math.PI * (400 - 324) * 5 };
      out.notes = 'measure_doc on the same doc';
    }
  }
} catch (e) { out.outcome = 'error'; out.notes = String(e && e.stack || e); }
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(HERE, 'ours-groove.json'), JSON.stringify(out, null, 2));
