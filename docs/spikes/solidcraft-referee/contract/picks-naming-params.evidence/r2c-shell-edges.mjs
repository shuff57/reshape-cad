// Round 2: other edges of an open-top hollowed box (floor edge, outer vertical edge) and a hollowed cylinder rim, radius vs wall.
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const t = 2, W = 40, D = 30, H = 20;
const base = W * D * H - (W - 2 * t) * (D - 2 * t) * (H - t);
const N = 2400;
const zoneArea = (r, mat) => { // area of {u,v in [0,r], outside circle centre (r,r) radius r} intersect mat(u,v)
  let s = 0; const h = r / N;
  for (let i = 0; i < N; i++) { const u = (i + 0.5) * h; for (let j = 0; j < N; j++) { const v = (j + 0.5) * h; if ((u - r) ** 2 + (v - r) ** 2 > r * r && mat(u, v)) s += h * h; } }
  return s;
};
// u,v = distances inward from the two faces meeting at the edge. Cavity (open top) = y,x in (t, D-t)/(t, W-t), z in (t, H].
const cases = {
  'top|front': { len: W, r: (r) => zoneArea(r, (u, v) => v < t) * (W - 2 * t) + 2 * t * zoneArea(r, () => true), // u = depth below top, v = inward y
    script: 'top","front' },
  'bottom|front': { len: W, r: (r) => zoneArea(r, (u, v) => v < t || u < t) * (W - 2 * t) + 2 * t * zoneArea(r, () => true), script: 'bottom","front' }, // u = height above bottom
  'front|left': { len: H, r: (r) => zoneArea(r, (u, v) => u < t || v < t) * (H - t) + t * zoneArea(r, () => true), script: 'front","left' }, // vertical, u inward y, v inward x
};
const rows = [];
for (const [name, c] of Object.entries(cases)) {
  for (const r of [1.5, 1.99, 2.5, 3, 5]) {
    const doc = L.fromScript(`const b=box(40,30,20,{at:[7,-5,3]})\nhollow(b,{wall:2,open:"top"})\nround(b.edge("${c.script}"),${r})`).doc;
    const ref = L.references(doc); const row = await L.scored(doc, { ref });
    const cf = base - c.r(r); const sc = row.truck?.volume;
    const o = { edge: name, r, outcome: row.outcome, sc, cf: +cf.toFixed(4), d: sc !== undefined ? (sc - cf) / cf : null, occt: ref.occt?.volume ?? ref.occt?.refused, occtRef: ref.occtRefusals, brep: ref.brep?.volume, sentence: row.sentence };
    rows.push(o); console.log(name.padEnd(13), String(r).padEnd(5), o.outcome.padEnd(13), 'SC', sc?.toFixed(3), 'CF', cf.toFixed(3), 'd', o.d?.toExponential(1), '| OCCT', typeof o.occt === 'number' ? o.occt.toFixed(3) : o.occt, JSON.stringify(o.occtRef).slice(0, 90), '| BREP', o.brep?.toFixed?.(3), o.sentence ? '| ' + o.sentence.slice(0, 100) : '');
  }
}
// cylinder hollowed open top, rim round vs wall
for (const r of [1, 1.5, 1.99, 2, 2.5, 3]) {
  const doc = L.fromScript(`const c=cylinder(30,20,{at:[4,-2,1]})\nhollow(c,{wall:2,open:"top"})\nround(c.edge("top","side"),${r})`).doc;
  const ref = L.references(doc); const row = await L.scored(doc, { ref });
  // closed form: ring wall of radius R=15, thickness t=2: rim round removes 2*pi*Rc*A(r,t), Rc the centroid radius of the removed area (Pappus), computed numerically
  const R = 15; let rem = 0; const n = 200000; const m = Math.min(r, t); const h = m / n;
  for (let i = 0; i < n; i++) { const x = (i + 0.5) * h; const dep = r - Math.sqrt(Math.max(0, r * r - (r - x) * (r - x))); rem += dep * h * 2 * Math.PI * (R - x); }
  const base2 = Math.PI * R * R * 20 - Math.PI * (R - t) ** 2 * (20 - t); const cf = base2 - rem; const sc = row.truck?.volume;
  rows.push({ edge: 'cylinder rim', r, outcome: row.outcome, sc, cf, d: sc ? (sc - cf) / cf : null, occt: ref.occt?.volume ?? ref.occt?.refused, occtRef: ref.occtRefusals, brep: ref.brep?.volume, sentence: row.sentence });
  console.log('cyl rim'.padEnd(13), String(r).padEnd(5), row.outcome.padEnd(13), 'SC', sc?.toFixed(3), 'CF', cf.toFixed(3), 'd', sc ? ((sc - cf) / cf).toExponential(1) : '-', '| OCCT', ref.occt?.volume?.toFixed?.(3) ?? ref.occt?.refused, JSON.stringify(ref.occtRefusals).slice(0, 90), '| BREP', ref.brep?.volume?.toFixed?.(3));
}
writeFileSync('r2c-shell-edges.json', JSON.stringify(rows, null, 1));
