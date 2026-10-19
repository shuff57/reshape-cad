// CRITIC repro (picks-naming-params, "carried through hollow, used as a draft face"): hollow(b,{wall:t,open:'top'}) then draft(b.face('front'), a, {neutral:n}).
// When the tilted outer plane moves INTO the cavity (inward move at the top, h*tan(a), is larger than the wall t) SolidCraft builds a solid 3% below the
// exact half-space answer and OCCT, with no sentence. Below that angle it is exact to 1e-15.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
//     bun docs/spikes/solidcraft-referee/contract/picks-naming-params.critic/draft-after-hollow-pierce.mjs --out=<scratch dir>
// Closed form: material = V(outer with the tilted plane) - V(outer-with-tilted-plane INTERSECT cavity box), independent polytope (shell-draft-polytope.mjs).
import { runScript } from '../../../../../packages/script/dist/reshape-script.js';
import * as P from '../shell-draft-polytope.mjs';
import { runFixture } from '../fillet-chamfer-evidence/base.mjs';
const lo = [-20, -9, -10], hi = [10, 27, 10], wall = 1.5;
let bad = 0;
for (const ang of [4, 6, 6.5, 7, 8, 10]) {
  const neutral = -3;
  const src = `const b = cuboid(30,36,20,{at:[-5,9,0]})\nhollow(b,{wall:${wall},open:'top'})\ndraft(b.face('front'),${ang},{neutral:${neutral}})`;
  const r = runScript(src); const feats = r.doc.features;
  const outer = P.boxPlanes(lo, hi); const i = P.PLANE_INDEX['-y'];
  const q = outer.map((p) => ({ ...p })); q[i] = P.draftPlane(outer[i], 'z', neutral, ang, -1);
  const cav = P.boxPlanes([lo[0] + wall, lo[1] + wall, lo[2] + wall], [hi[0] - wall, hi[1] - wall, 1000]);
  const closed = P.measure(q).volume - P.measure([...q, ...cav]).volume;
  const fx = runFixture({ id: `critic-dah-${ang}`, kind: 'critic', tol: 'approx', features: feats, measure: feats[feats.length - 1].id });
  const t = fx.truck?.volume;
  const verdict = t === undefined ? 'REFUSED' : (Math.abs(t - closed) / closed < 1e-9 ? 'ok' : 'WRONG');
  if (verdict === 'WRONG') bad++;
  const pierces = (10 - neutral) * Math.tan(ang * Math.PI / 180) > wall;
  console.log(`angle ${ang} (wall pierced: ${pierces}): closed form ${closed.toFixed(4)} | OCCT ${fx.occt?.volume?.toFixed(4)} | brep-rs ${fx.brep?.volume?.toFixed?.(4)} | SolidCraft ${t?.toFixed?.(4)} -> ${verdict}`);
}
console.log(bad ? `${bad} silent WRONG solids` : 'no wrong solids');
