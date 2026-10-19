// CRITIC repro (picks-naming-params): a CHAMFER of a swept^swept edge at a REFLEX vertex of an extruded polygon.
// ModelDoc-level (studio / hand-written doc); script text cannot name this edge.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
//     bun docs/spikes/solidcraft-referee/contract/picks-naming-params.critic/concave-chamfer.mjs --out=<scratch dir>
// Scored against live OCCT and brep-rs through the fillet-chamfer-evidence harness (phase-0 translator, brep-rs picks) AND an exact closed form:
// an inside-corner chamfer of leg d on an extrusion of height h ADDS d*d/2*h to the volume.
import { runFixture } from '../fillet-chamfer-evidence/base.mjs';
const polys = {
  L: { pts: [[0,0],[40,0],[40,15],[15,15],[15,30],[0,30]], area: 825, reflex: [2] },
  T: { pts: [[0,0],[40,0],[40,10],[25,10],[25,30],[15,30],[15,10],[0,10]], area: 40*10 + 10*20, reflex: [2, 5] },
  U: { pts: [[0,0],[40,0],[40,30],[30,30],[30,10],[10,10],[10,30],[0,30]], area: 40*10 + 2*10*20, reflex: [3, 4] },
};
const H = 14;
const sw = (i) => ({ cause: 'swept', feature: 'pull1', kind: 'face', from: 'sk1', edge: i });
let bad = 0;
for (const [pn, p] of Object.entries(polys)) for (const d of [1, 2, 3]) for (const v of p.reflex) {
  const n = p.pts.length;
  const sk = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: p.pts };
  const feats = [sk, { id: 'pull1', kind: 'extrude', target: 'sk1', height: H },
    { id: 'round1', kind: 'fillet', target: 'pull1', edge: { cause: 'between', feature: 'pull1', kind: 'edge', of: [sw(v), sw((v + 1) % n)] }, size: d, style: 'chamfer' }];
  const fx = runFixture({ id: `critic-${pn}-${v}-${d}`, kind: 'critic', tol: 'approx', features: feats, measure: 'round1' });
  const closed = p.area * H + d * d / 2 * H;
  const t = fx.truck?.volume;
  const rel = (a, b) => Math.abs(a - b) / b;
  const verdict = t === undefined ? 'REFUSED' : (rel(t, closed) < 1e-9 ? 'ok' : 'WRONG');
  if (verdict === 'WRONG') bad++;
  console.log(`${pn} reflex edge pair ${v},${(v+1)%n} d=${d}: closed form ${closed.toFixed(4)} | OCCT ${fx.occt?.volume?.toFixed(4)} | brep-rs ${fx.brep?.volume?.toFixed?.(4)} | SolidCraft ${t?.toFixed?.(4)} (${fx.truck?.faces} faces vs OCCT ${fx.occt?.faces}) -> ${verdict}`);
}
console.log(bad ? `${bad} silent WRONG solids` : 'no wrong solids');
