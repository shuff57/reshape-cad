// Independent exact volume of a fully chamfered box (no kernel): intersect half-spaces with shell-draft-polytope.mjs.
//   bun primitives-evidence/chamfer-polytope.mjs
import { measure } from '../shell-draft-polytope.mjs';
const s2 = Math.SQRT2, s3 = Math.sqrt(3);
function planes(size, d, corners) {
  const H = size.map((v) => v / 2); const P = [];
  for (let i = 0; i < 3; i++) for (const s of [1, -1]) { const n = [0, 0, 0]; n[i] = s; P.push({ n, d: H[i] }); }
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) for (const si of [1, -1]) for (const sj of [1, -1]) {
    const n = [0, 0, 0]; n[i] = si / s2; n[j] = sj / s2; P.push({ n, d: (H[i] + H[j] - d) / s2 });
  }
  if (corners) for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) P.push({ n: [a / s3, b / s3, c / s3], d: (H[0] + H[1] + H[2] - d) / s3 });
  return P;
}
for (const [size, d] of [[[40, 30, 12], 3], [[20, 20, 20], 4], [[10, 20, 30], 1], [[10, 20, 30], 2], [[10, 20, 30], 4.9], [[10, 20, 30], 5], [[10, 20, 30], 5.5], [[20, 30, 12], 5.9], [[20, 30, 12], 6]]) {
  const e = measure(planes(size, d, false)).vol ?? measure(planes(size, d, false)).volume;
  const c = measure(planes(size, d, true)).vol ?? measure(planes(size, d, true)).volume;
  console.log(JSON.stringify(size), 'd', d, '12 edge planes only', e, '| plus 8 corner planes', c);
}
