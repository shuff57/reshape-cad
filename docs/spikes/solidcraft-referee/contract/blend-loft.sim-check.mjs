// Checks the start-vertex simulation in blend-loft.guard.mjs (truckShift / leadIsB / ccwLoop) against what truck really built, on the planar-sided fuzz in
// blend-loft.r4-results.json. N7 (seed 4242) is the set the clockwise-list convention was fitted on; N7h (seed 99991) was run afterwards, unchanged.
//   bun contract/blend-loft.sim-check.mjs   (round 4: reads the LIVE harness output blend-loft.r4-results.json)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parallelShifts, ccwLoop, truckShift, leadIsB } from './blend-loft.guard.mjs';
const J = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'blend-loft.r4-results.json'), 'utf8'));
const segsCross = (p1, p2, p3, p4) => { const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4); return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)); };
const crossing = (P) => { const n = P.length; for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) { if (i === 0 && k === n - 1) continue; if (segsCross(P[i], P[(i + 1) % n], P[k], P[(k + 1) % n])) return true; } return false; };
let all = 0;
for (const [name, set] of [['N7 seed 4242 (fitting set)', J.N7], ['N7h seed 99991 (holdout)', J.N7h], ['N7p2 seed 31337 (front and side planes)', J.N7p2 ?? []]]) {
  let tot = 0, agree = 0, trulyWrong = 0, predictedWrong = 0; const miss = [];
  for (const x of set) {
    if (crossing(x.p) || crossing(x.q) || x.ps.length !== 1) continue;
    const P = ccwLoop(x.p), Q = ccwLoop(x.q); const ps = parallelShifts(P, Q);
    const simOk = ps.length === 1 && truckShift(P, Q, leadIsB(x.plane ?? 'xy', 0, x.p, x.h, x.q)).s === ps[0];
    const truthOk = x.dTG <= 1e-9; tot++; if (simOk === truthOk) agree++; else miss.push(x.label); if (!truthOk) trulyWrong++; if (!simOk) predictedWrong++;
  }
  console.log(`${name}: ${tot} non-crossing pairs with one parallel matching; simulation agrees with truck on ${agree}; truck really wrong on ${trulyWrong}; simulation predicts wrong on ${predictedWrong}${miss.length ? '; misses: ' + miss.join(', ') : ''}`);
  all += tot - agree;
}
process.exit(all ? 1 : 0);
