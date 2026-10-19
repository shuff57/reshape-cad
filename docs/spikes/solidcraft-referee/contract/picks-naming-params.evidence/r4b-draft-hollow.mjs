// Round 4. draft of a carried face AFTER hollow, through the PAGE translator (script text). The tilted face's inward move at the open end,
// (h - neutral) * tan(angle), exceeds the wall: the plane enters the cavity.
// Closed form: material = V(outer with tilted plane) - V(outer-with-tilted-plane INTERSECT cavity), polytope in ../shell-draft-polytope.mjs.
import { L, T, save } from './common.mjs';
import * as P from '../shell-draft-polytope.mjs';
const lo = [-20, -9, -10], hi = [10, 27, 10], wall = 1.5, neutral = -3;
for (const ang of [4, 6, 6.5, 7, 8, 10]) {
  const src = `const b = cuboid(30,36,20,{at:[-5,9,0]})\nhollow(b,{wall:${wall},open:'top'})\ndraft(b.face('front'),${ang},{neutral:${neutral}})`;
  const o = await T(`hollow then draft front ${ang} deg`, src, { control: false });
  const outer = P.boxPlanes(lo, hi); const i = P.PLANE_INDEX['-y'];
  const q = outer.map((p) => ({ ...p })); q[i] = P.draftPlane(outer[i], 'z', neutral, ang, -1);
  const cav = P.boxPlanes([lo[0] + wall, lo[1] + wall, lo[2] + wall], [hi[0] - wall, hi[1] - wall, 1000]);
  const closed = P.measure(q).volume - P.measure([...q, ...cav]).volume;
  const pierces = (10 - neutral) * Math.tan(ang * Math.PI / 180) > wall;
  console.log(`   pierces=${pierces} closed=${closed.toFixed(4)} SC=${o.truck?.volume?.toFixed?.(4)} rel=${o.truck?.volume ? (Math.abs(o.truck.volume - closed) / closed).toExponential(1) : '-'}`);
  o.closed = closed; o.pierces = pierces;
}
save('r4b-draft-hollow.json');
