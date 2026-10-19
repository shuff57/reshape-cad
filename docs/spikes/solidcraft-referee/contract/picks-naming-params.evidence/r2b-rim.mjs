// Round 2: round()/bevel() of the rim edge of a hollowed (open-top) box, radius vs wall. Independent closed form, live OCCT, brep-rs,
// and the engine (wasm) through the phase-7 translator (the product path).
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const BOX = [40, 30, 20], WALL = 2;
const cavity = (BOX[0] - 2 * WALL) * (BOX[1] - 2 * WALL) * (BOX[2] - WALL);
const base = BOX[0] * BOX[1] * BOX[2] - cavity; // 7152
// removed area of one rim cross-section when the round (radius r) is cut into a wall of thickness t (material x in [0,t], depth below top):
// depth removed at x is r - sqrt(r^2-(r-x)^2) for x<r, 0 beyond.
const area = (r, t, n = 200000) => { const m = Math.min(r, t); let s = 0; const h = m / n; for (let i = 0; i < n; i++) { const x = (i + 0.5) * h; s += r - Math.sqrt(Math.max(0, r * r - (r - x) * (r - x))); } return s * h; };
const full = (r) => (1 - Math.PI / 4) * r * r; // corner (solid both ways) cross-section removed
// edge of length Lg: the middle (Lg-2t) is wall-over-cavity, the two ends of length t sit on the adjacent walls (solid to depth r).
const removed = (r, t, Lg) => area(r, t) * (Lg - 2 * t) + 2 * t * full(r);
const rows = [];
for (const [pos, at] of [['origin', ''], ['off-centre [7,-5,3]', ',{at:[7,-5,3]}']]) {
  for (const [edge, Lg] of [['top","front', 40], ['top","back', 40], ['top","left', 30], ['top","right', 30]]) {
    for (const [fn, rs_] of [['round', [1.5, 1.99, 2, 2.01, 2.1, 2.5, 3]], ['bevel', [1.99, 2, 2.5, 3]]]) {
      for (const r of rs_) {
        const src = `const b=box(40,30,20${at})\nhollow(b,{wall:2,open:"top"})\n${fn}(b.edge("${edge}"),${r})`;
        const f = L.fromScript(src);
        const doc = f.doc;
        const ref = L.references(doc);
        const row = await L.scored(doc, { ref });
        let cf;
        if (fn === 'round') cf = base - removed(r, WALL, Lg);
        else { // bevel: triangle d x d removed from the cross-section (depth removed at x is d-x); corner: d^2/2
          const triArea = (d, t) => { const m = Math.min(d, t); return d * m - m * m / 2; };
          cf = base - (triArea(r, WALL) * (Lg - 2 * WALL) + 2 * WALL * (r * r / 2));
        }
        const sc = row.truck?.volume;
        const o = { pos, edge: edge.replace('","', '|'), fn, r, wall: WALL, outcome: row.outcome, sentence: row.sentence, scVol: sc, closedForm: +cf.toFixed(4), dCF: sc !== undefined ? (sc - cf) / cf : null, occt: ref.occt?.volume ?? ref.occt?.refused ?? ref.occtRefusals, brep: ref.brep?.volume ?? ref.brep?.refused ?? ref.brepRefusals, faces: row.truck?.faces };
        rows.push(o);
        console.log(pos.padEnd(20), o.edge.padEnd(10), fn, String(r).padEnd(5), o.outcome?.padEnd(8), 'SC', sc?.toFixed(3), 'CF', cf.toFixed(3), 'd', o.dCF !== null ? o.dCF.toExponential(1) : '-', '| OCCT', typeof o.occt === 'number' ? o.occt.toFixed(3) : JSON.stringify(o.occt).slice(0, 70), '| BREP', typeof o.brep === 'number' ? o.brep.toFixed(3) : JSON.stringify(o.brep).slice(0, 70), o.sentence ? '| SENT ' + o.sentence.slice(0, 120) : '');
      }
    }
  }
}
writeFileSync('r2b-rim.json', JSON.stringify(rows, null, 1));
