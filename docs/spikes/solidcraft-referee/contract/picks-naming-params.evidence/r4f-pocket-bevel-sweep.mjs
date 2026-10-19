// Round 4: where does bevel(edge(wall1, wall2), d) of a pocket corner go wrong? Sweep pocket depth and plate thickness (script text, page translator).
// Closed form: plate 40x30xT minus 10x10xdepth, plus d*d/2*depth.
import { L, T, save } from './common.mjs';
const H = (t, p, d) => `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });\nconst plate = extrude(sk1, ${t});\nconst sk2 = sketch('top', ${t}); sk2.rect(${p}, ${p}, { at: [20, 15] });\nconst part = pocket(sk2, plate, ${d});\n`;
const rows = [];
const orig = console.log; console.log = () => {};
for (const [t, d] of [[10, 2], [10, 4], [10, 6], [10, 8], [10, 9], [10, 9.5], [10, 10], [20, 4], [20, 10], [20, 15], [20, 19], [20, 19.5], [20, 20], [6, 3], [6, 5], [6, 6], [30, 25], [30, 30]]) for (const s of [0.5, 1, 2]) {
  const o = await T(`T${t} d${d} bevel ${s}`, H(t, 10, d) + `bevel(part.edge(part.wall(sk2, 1), part.wall(sk2, 2)), ${s})`, { control: false });
  const depth = Math.min(t, d); const closed = 40 * 30 * t - 100 * depth + s * s / 2 * depth;
  const v = o.truck?.volume;
  rows.push({ T: t, depth: d, size: s, outcome: o.outcome, sc: v, occt: o.occt?.volume, closed, rel: v ? Math.abs(v - closed) / closed : null, faces: o.truck?.faces, occtFaces: o.occt?.faces });
}
console.log = orig;
for (const r of rows) console.log(`T=${r.T} depth=${r.depth} bevel=${r.size}: ${r.outcome} SC=${r.sc?.toFixed(4)} closed=${r.closed.toFixed(4)} rel=${r.rel?.toExponential(1)} faces SC/OCCT ${r.faces}/${r.occtFaces}`);
import('node:fs').then((fs) => fs.writeFileSync((process.env.R3_OUT ? process.env.R3_OUT + '/' : '') + 'r4f-pocket-bevel-sweep.json', JSON.stringify(rows, null, 1)));
