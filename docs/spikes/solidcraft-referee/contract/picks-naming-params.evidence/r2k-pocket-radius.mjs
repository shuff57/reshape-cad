// Round 2: radius vs pocket wall height on a pocket wall edge (the pocket is 4 deep): closed form (1-pi/4) r^2 L.
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const H = `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });\nconst plate = extrude(sk1, 10);\nconst sk2 = sketch('top', 10); sk2.rect(10, 8, { at: [24, 12] });\nconst part = pocket(sk2, plate, 4);\n`;
const rows = [];
for (const [fn, n, rs_] of [['round', 1, [3.9, 4, 4.5, 6]], ['bevel', 2, [3.9, 4, 4.5]]]) for (const r of rs_) {
  const f = L.fromScript(H + `${fn}(part.edge('top', part.wall(sk2, ${n})), ${r})`);
  const ref = L.references(f.doc); const row = await L.scored(f.doc, { ref });
  // wall n=1 / n=2 lengths from the sketch: rect 10 x 8: edge0 along x (10), edge1 along y (8)
  const Lg = n === 1 ? 10 : 8; const base = 40 * 30 * 10 - 10 * 8 * 4;
  const cf = fn === 'round' ? base - (1 - Math.PI / 4) * r * r * Lg : base - (r * r / 2) * Lg;
  const o = { fn, wall: n, r, outcome: row.outcome, sentence: row.sentence, sc: row.truck?.volume, cf, d: row.truck ? (row.truck.volume - cf) / cf : null, occt: ref.occt?.volume, occtRef: ref.occtRefusals, brep: ref.brep?.volume };
  rows.push(o); console.log(fn, 'wall', n, 'r', r, row.outcome.padEnd(9), 'SC', row.truck?.volume?.toFixed(4), 'CF(valid only if r<=4)', cf.toFixed(4), 'd', o.d?.toExponential(1), '| OCCT', ref.occt?.volume?.toFixed?.(4), JSON.stringify(ref.occtRefusals).slice(0, 80), '| BREP', ref.brep?.volume?.toFixed?.(4)); if (row.sentence) console.log('      ', row.sentence.slice(0, 250));
}
writeFileSync('r2k-pocket-radius.json', JSON.stringify(rows, null, 1));
