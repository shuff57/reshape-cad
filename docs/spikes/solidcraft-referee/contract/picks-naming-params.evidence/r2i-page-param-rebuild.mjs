// Round 2: (1) exactly what the page's sandboxed runner posts back for a param() script (runner-entry.mjs: runScript(withPreamble(code)) -> {errors, doc});
// (2) names survive a rebuild when the student EDITS THE NUMBER IN THE SCRIPT TEXT (the only route the page offers), scored against OCCT/brep-rs.
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const FS = await import(`${L.REPO}/docs/spikes/solidcraft-referee/phase7/pane/lib/friendly-sketch.mjs`);
FS.install(globalThis);
const runPage = (code) => { const r = L.rs.runScript(FS.withPreamble(code)); return { msg: { source: 'reshape-result', errors: r.errors.map((x) => ({ message: String(x.message), line: x.line })), doc: r.errors.length ? null : r.doc }, full: r }; };
const p = runPage(`const w = param('w', 40, {min: 20, max: 80, step: 5, caption: 'Width'})\nconst b = box(w, 30, 20)\nround(b.edge('top','right'), 2)`);
console.log('runner posts keys:', Object.keys(p.msg), '| doc keys:', Object.keys(p.msg.doc), '| RunResult keys (not posted):', Object.keys(p.full));
console.log('posted doc contains namedParams/params?', 'namedParams' in p.msg.doc, 'params' in p.msg.doc, '| box width in posted doc:', p.msg.doc.features[0].size[0]);
console.log('RunResult.namedParams (stays in the sandbox):', JSON.stringify(p.full.namedParams));
const mk = {
  'box edge round + hollow open front': (w, r, wall) => `const b = box(${w}, 30, 20, { at: [5, -3, 2] })\nround(b.edge('top','right'), ${r})\nhollow(b, { wall: ${wall}, open: 'front' })`,
  'plate + pocket edge(top, wall 2)': (t, off, r) => `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });\nconst plate = extrude(sk1, ${t});\nconst sk2 = sketch('top', ${off}); sk2.rect(10, 10, { at: [20, 15] });\nconst part = pocket(sk2, plate, 4);\nround(part.edge('top', part.wall(sk2, 2)), ${r})`,
  'cylinder rim round': (d, h, r) => `const c = cylinder(${d}, ${h})\nround(c.edge('top','side'), ${r})`,
  'hole then round edge': (a, r) => `const b = box(40, 30, 20, { at: [5, -3, 2] })\nhole(b, { across: ${a} })\nround(b.edge('top','right'), ${r})`,
  'draft face right': (an, w) => `const b = box(${w}, 30, 20, { at: [5, -3, 2] })\ndraft(b.face('right'), ${an})`,
};
const sets = {
  'box edge round + hollow open front': [[40, 2, 2], [25, 2, 2], [70, 4, 2], [33, 1, 3.5], [40, 5.9, 1]],
  'plate + pocket edge(top, wall 2)': [[10, 10, 1], [16, 10, 1], [14, 14, 1], [14, 14, 2.5], [16, 10, 1.5]],
  'cylinder rim round': [[20, 30, 2], [14, 30, 2], [20, 12, 1], [36, 50, 3.5]],
  'hole then round edge': [[6, 2], [12, 2], [3, 4], [16, 0.5]],
  'draft face right': [[5, 40], [12, 40], [2, 70], [8, 40]],
};
const rows = []; let base = {};
for (const [fam, f] of Object.entries(mk)) for (const args of sets[fam]) {
  const src = f(...args); const r = runPage(src).full;
  if (r.errors.length) { console.log(fam, args, 'SCRIPT ERR', r.errors[0].message); continue; }
  const doc = L.cg.solveDoc(r.doc);
  const names = doc.features.filter((x) => x.edge || x.open || x.face).map((x) => L.tn.formatName(x.edge ?? x.open ?? x.face)).join(' ; ');
  base[fam] ??= names;
  const ref = L.references(doc); const row = await L.scored(doc, { ref });
  const o = { fam, args, src, names, nameStable: names === base[fam], outcome: row.outcome, sentence: row.sentence, sc: row.truck?.volume, dVol: row.score?.dVol, refKind: row.score?.reference, occt: ref.occt?.volume ?? ref.occt?.refused, brep: ref.brep?.volume };
  rows.push(o);
  console.log(fam.padEnd(36), JSON.stringify(args).padEnd(16), 'names stable', o.nameStable, row.outcome.padEnd(12), 'SC', row.truck?.volume?.toFixed(4), 'dVol', row.score?.dVol?.toExponential(1), row.score?.reference ?? '', row.sentence ? '| ' + row.sentence.slice(0, 150) : '');
}
writeFileSync('r2i-page-param-rebuild.json', JSON.stringify({ posted: Object.keys(p.msg), namedParamsStaysInSandbox: p.full.namedParams, rows }, null, 1));
