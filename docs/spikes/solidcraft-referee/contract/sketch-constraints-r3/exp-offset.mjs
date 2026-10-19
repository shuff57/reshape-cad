// EXPLORATORY: constrained sketch on an offset plane / literal frame through the r2 guard (drops offset+frame) vs brep-rs vs OCCT.
import * as lib from './lib.mjs';
import { refsOfScript } from './refs.mjs';
import { rectG, rectShape, atOrigin, len, fmt } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const geoms = rectG(0.3, 0.2, 28.4, 17.1), rules = [...rectShape(), atOrigin(1), len(1, 30), len(2, 20)];
const rowsTxt = (rs) => rs.map((r) => `  { ${Object.entries(r).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')} }`).join(',\n');
const script = (head) => `const sk = ${head}\nsk.geom([\n${rowsTxt(geoms)}\n])\nsk.rules([\n${rowsTxt(rules)}\n])\nconst part = extrude(sk, 10)`;
const CASES = [['top', 7, 'xy', 7], ['front', -5, 'xz', -5], ['side', 3, 'yz', 3]];
for (const [word, off, plane, o] of CASES) {
  const r = refsOfScript(script(`sketch('${word}', ${off})`));
  const g = ladderSketch({ geoms, rules, plane, offset: o });
  console.log(word, off, 'brep', JSON.stringify(r.brep), 'occt', JSON.stringify(r.occt?.bbox), '\n  guard(r2, opts.plane only)', g.ok ? JSON.stringify(g.body.bbox) : g.sentence);
}
const fr = { origin: [3, 4, 5], u: [0.6, 0.8, 0], v: [-0.8, 0.6, 0] };
const r = refsOfScript(script(`sketch({ origin: [3, 4, 5], u: [0.6, 0.8, 0], v: [-0.8, 0.6, 0] })`));
console.log('frame brep', JSON.stringify(r.brep), 'occt', JSON.stringify(r.occt));
console.log(r.doc?.features?.[0]?.frame, r.doc?.features?.[0]?.offset, r.doc?.features?.[0]?.plane);

const g2 = ladderSketch({ geoms, rules, frame: fr });
console.log('frame guard r3', g2.ok ? JSON.stringify(g2.body.bbox) : g2.sentence);
