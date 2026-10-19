// Round 4: for the hollow-then-draft-a-wall sweep (r4g), the exact half-space closed form (../shell-draft-polytope.mjs) against the unguarded SolidCraft volume
// and live OCCT, for every case, so the guard region is decided by the closed form and not only by OCCT.
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r4h-draft-wall-closed.mjs
import * as L from './lib.mjs';
import * as P from '../shell-draft-polytope.mjs';
import { writeFileSync } from 'node:fs';
const lo = [-20, -9, -10], hi = [10, 27, 10];
const SIG = { front: ['-y', -1], right: ['+x', -1] };
const rows = []; const tally = {};
const orig = console.log; console.log = () => {};
for (const wall of [1, 1.5, 3]) for (const face of ['front', 'right']) for (const neutral of [-10, -3, 0, 10]) for (const ang of [-12, -8, -4, 2, 4, 6, 8, 12]) {
  const src = `const b = cuboid(30,36,20,{at:[-5,9,0]})\nhollow(b,{wall:${wall},open:'top'})\ndraft(b.face('${face}'),${ang},{neutral:${neutral}})`;
  const f = L.fromScript(src); const doc = L.cg.solveDoc(f.doc); const ref = L.references(doc);
  delete globalThis.__R3_TRANSLATE; const u = await L.scored(doc, { ref });
  const [w, sigma] = SIG[face]; const outer = P.boxPlanes(lo, hi); const i = P.PLANE_INDEX[w];
  const q = outer.map((p) => ({ ...p })); q[i] = P.draftPlane(outer[i], 'z', neutral, ang, sigma);
  const cav = P.boxPlanes([lo[0] + wall, lo[1] + wall, lo[2] + wall], [hi[0] - wall, hi[1] - wall, 1000]);
  const closed = P.measure(q).volume - P.measure([...q, ...cav]).volume;
  const sc = u.truck?.volume; const oc = ref.occt?.volume;
  const relSC = sc === undefined ? null : Math.abs(sc - closed) / closed; const relOC = oc === undefined ? null : Math.abs(oc - closed) / closed;
  rows.push({ wall, face, neutral, ang, closed, sc, occt: oc, relSC, relOC });
}
console.log = orig;
const bad = rows.filter((r) => r.relSC > 1e-6);
console.log(`cases ${rows.length}; SolidCraft off the closed form by >1e-6: ${bad.length}; OCCT off by >1e-6: ${rows.filter((r) => r.relOC > 1e-6).length}`);
console.log('positive angle off:', bad.filter((r) => r.ang > 0).length, ' negative angle off:', bad.filter((r) => r.ang < 0).length);
for (const r of bad.slice(0, 40)) console.log(`wall ${r.wall} ${r.face} neutral ${r.neutral} ang ${r.ang}: closed ${r.closed.toFixed(4)} SC ${r.sc?.toFixed(4)} (${r.relSC.toExponential(1)}) OCCT ${r.occt?.toFixed(4)} (${r.relOC?.toExponential(1)})`);
const r4g = JSON.parse((await import('node:fs')).readFileSync((process.env.R3_OUT ?? '.') + '/r4g-draft-wall-sweep.json', 'utf8'));
const refused = new Set(r4g.filter((r) => r.guarded === 'REFUSED').map((r) => `${r.wall}|${r.face}|${r.neutral}|${r.ang}`));
const badSet = new Set(bad.map((r) => `${r.wall}|${r.face}|${r.neutral}|${r.ang}`));
console.log('guard refused', refused.size, '; wrong-by-closed-form', badSet.size, '; wrong but not refused', [...badSet].filter((k) => !refused.has(k)).length, '; refused but not wrong', [...refused].filter((k) => !badSet.has(k)).length);
writeFileSync((process.env.R3_OUT ? process.env.R3_OUT + '/' : '') + 'r4h-draft-wall-closed.json', JSON.stringify(rows, null, 1));
