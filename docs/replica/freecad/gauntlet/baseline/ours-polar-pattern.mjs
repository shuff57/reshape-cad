// Piece polar-pattern: disc r30 h10, pocket r3 at (20,0) through, polar pattern x4 over 360 about Z.
// Variant A (pattern word): polarPattern(pocketed) -- the kernel pattern copies the WHOLE solid and unions.
// Variant B (explicit): four pockets at the four pattern positions -- what the pattern SHOULD equal.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const A = `
const sk1 = sketch('top'); sk1.circle(60);
const disc = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.circle(6, { at: [20, 0] });
const holed = pocket(sk2, disc, 10);
polarPattern(holed, { count: 4, axis: 'z', angle: 360 });
`;
const B = `
const sk1 = sketch('top'); sk1.circle(60);
const disc = extrude(sk1, 10);
const a = sketch('top', 10); a.circle(6, { at: [20, 0] }); pocket(a, disc, 10);
const b = sketch('top', 10); b.circle(6, { at: [0, 20] }); pocket(b, disc, 10);
const c = sketch('top', 10); c.circle(6, { at: [-20, 0] }); pocket(c, disc, 10);
const d = sketch('top', 10); d.circle(6, { at: [0, -20] }); pocket(d, disc, 10);
`;
function measure(script) {
  const o = { scriptSource: script };
  try {
    const r = runScript(script);
    if (r.errors.length) { o.outcome = 'not-expressible'; o.notes = JSON.stringify(r.errors); return o; }
    const j = JSON.stringify(r.doc);
    o.featureKinds = r.doc.features.map(f => f.kind);
    const b = JSON.parse(brep.build_doc_json(j));
    o.refusals = b.refusals;
    const last = r.doc.features.at(-1).id;
    const m = JSON.parse(brep.measure_doc(j)).shapes[last];
    if (b.refusals && Object.keys(b.refusals).length) { o.outcome = 'refused'; o.refusal = Object.values(b.refusals).join(' | '); }
    else if (!m) { o.outcome = 'error'; o.notes = 'no measurement for last feature'; }
    else { o.outcome = 'built'; o.volume = m.volume; o.bbox = m.bbox.flat(); o.faces = m.faces; }
  } catch (e) { o.outcome = 'error'; o.notes = String(e && e.stack || e); }
  return o;
}
const expected = Math.PI * 900 * 10 - 4 * Math.PI * 9 * 10;
const a = measure(A), b = measure(B);
const out = { id: 'polar-pattern', script: path.join(HERE, 'ours-polar-pattern.mjs'), expected: { volume: expected, faces: 7 }, variantA_polarPatternWord: a, variantB_explicitFourPockets: b };
Object.assign(out, a, { notes: (a.notes || '') + ' | variantA = polarPattern word; variantB (explicit 4 pockets) in variantB_explicitFourPockets' });
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(HERE, 'ours-polar-pattern.json'), JSON.stringify(out, null, 2));
