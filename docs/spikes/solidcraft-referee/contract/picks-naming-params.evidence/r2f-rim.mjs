// Round 2: round(part.rim(sk), r): how many of the rim edges the page actually rounds, per pocket shape.
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const P = (sk2, d = 4) => `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });\nconst plate = extrude(sk1, 10);\nconst sk2 = sketch('top', 10); ${sk2}\nconst part = pocket(sk2, plate, ${d});\n`;
const cases = [
  ['rect 10x10 depth4 r1', P('sk2.rect(10, 10, { at: [20, 15] });') + `round(part.rim(sk2), 1)`, 4],
  ['rect 10x10 depth4 r0.2', P('sk2.rect(10, 10, { at: [20, 15] });') + `round(part.rim(sk2), 0.2)`, 4],
  ['rect 10x10 depth4 bevel 1', P('sk2.rect(10, 10, { at: [20, 15] });') + `bevel(part.rim(sk2), 1)`, 4],
  ['rect 10x10 depth 8 (deep) r1', P('sk2.rect(10, 10, { at: [20, 15] });', 8) + `round(part.rim(sk2), 1)`, 4],
  ['triangle depth4 r1', P('sk2.polygon([[12,8],[28,8],[20,22]]);') + `round(part.rim(sk2), 1)`, 3],
  ['circle pocket r1', P('sk2.circle(12, { at: [20, 15] });') + `round(part.rim(sk2), 1)`, 1],
  ['rounded-corner rect pocket r0.5', P('sk2.rect(12, 12, { at: [20, 15] }); sk2.round(1, 2);') + `round(part.rim(sk2), 0.5)`, 5],
  ['wall flush with plate edge (pocket x 0..10) r1', P('sk2.rect(10, 10, { at: [5, 15] });') + `round(part.rim(sk2), 1)`, 4],
  ['through pocket (depth 10) r1', P('sk2.rect(10, 10, { at: [20, 15] });', 10) + `round(part.rim(sk2), 1)`, 4],
];
const rows = [];
for (const [label, src, n] of cases) {
  const f = L.fromScript(src); if (f.errors.length) { console.log(label, 'ERR', f.errors[0].message); rows.push({ label, src, scriptError: f.errors[0].message }); continue; }
  const ref = L.references(f.doc, undefined);
  const row = await L.scored(f.doc, { ref });
  const rounds = row._tr.features.filter((x) => x.kind === 'fillet');
  const built = rounds.filter((x) => x.status === 'built').length;
  const lastBuilt = [...row._tr.features].reverse().find((x) => x.status === 'built' && x.kind === 'fillet') ?? [...row._tr.features].reverse().find((x) => x.status === 'built');
  const sc = lastBuilt?.measure?.volume;
  const o = { label, src, edges: rounds.length, built, refused: rounds.length - built, sentences: rounds.filter((x) => x.status !== 'built').map((x) => x.refusal), scVolShown: sc, occt: ref.occt?.volume ?? ref.occt?.refused, occtRef: ref.occtRefusals, brep: ref.brep?.volume ?? ref.brep?.refused, brepRef: ref.brepRefusals, feats: row.features.map((x) => `${x.id}:${x.status}`).join(',') };
  rows.push(o);
  console.log(label.padEnd(50), `rim edges ${o.edges}, built ${built}, refused ${o.refused} | SC shown ${sc?.toFixed(4)} | OCCT ${typeof o.occt === 'number' ? o.occt.toFixed(4) : String(o.occt).slice(0, 50)} ${JSON.stringify(o.occtRef).slice(0, 80)} | BREP ${typeof o.brep === 'number' ? o.brep.toFixed(4) : String(o.brep).slice(0, 50)}`);
  for (const s of o.sentences.slice(0, 2)) console.log('      REFUSED:', s.slice(0, 260));
}
writeFileSync('r2f-rim.json', JSON.stringify(rows, null, 1));
