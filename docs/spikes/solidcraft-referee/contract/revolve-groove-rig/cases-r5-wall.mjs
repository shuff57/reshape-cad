// Round-5 probes for the round-wall graze (critic round 2 blocking defect): ring outer/inner wall stops 0.05..0.1 mm short of a round wall of the part.
// Parts: post, tube, frustum, stepped (plate + post), post with an off-centre ring; controls at 0.3 mm and flush.
export const cases = [];
const add = (id, src, tag = {}) => cases.push({ id: `R5-${id}`, src, tag });
const poly = (pts) => JSON.stringify(pts);
const POST = `const k = sketch('top'); k.circle(40, { at: [0, 0] }); const t = extrude(k, 30);`;
const POSTOFF = `const k = sketch('top'); k.circle(40, { at: [0, 0] }); const t = extrude(k, 30);`;
const TUBE = `const s = sketch('top'); s.polygon([[10,0],[30,0],[30,30],[10,30]]); const t = spin(s, 360);`;
const FR = `const s = sketch('top'); s.polygon([[0,0],[30,0],[20,30],[0,30]]); const t = spin(s, 360);`;
const STEPPOST = `const k = sketch('top'); k.rect(60, 60, { at: [0, 0] }); const a = extrude(k, 10); const k2 = sketch('top', 10); k2.circle(30, { at: [0, 0] }); const c = extrude(k2, 20); const t = union(a, c);`;
const g = (pre, pts, ang) => `${pre} const r = sketch('top'); r.polygon(${poly(pts)}); groove(r, t, ${ang});`;
const ring = (u0, u1, z0, z1) => [[u0, z0], [u1, z0], [u1, z1], [u0, z1]];
// post, ring wall short of the post wall
for (const [gap, u] of [[0.05, 19.95], [0.1, 19.9], [0.2, 19.8], [0.3, 19.7]]) for (const a of [360, 90]) {
  add(`post-top-${gap}-${a}`, g(POST, ring(10, u, 20, 30), a), { fam: 'post-wall', gap, a });
}
add('post-bottom-0.05-360', g(POST, ring(10, 19.95, 0, 8), 360), { fam: 'post-wall', gap: 0.05, a: 360 });
add('post-bottom-0.1-180', g(POST, ring(10, 19.9, 0, 8), 180), { fam: 'post-wall', gap: 0.1, a: 180 });
add('post-flush-360', g(POST, ring(10, 20, 20, 30), 360), { fam: 'post-flush', gap: 0, a: 360 });
add('post-over-360', g(POST, ring(10, 25, 20, 30), 360), { fam: 'post-open', gap: -5, a: 360 });
// ring wall past the post wall by a hair (thin ring outside): 20.05 is past the wall
add('post-over-0.05-360', g(POST, ring(10, 20.05, 20, 30), 360), { fam: 'post-open', gap: -0.05, a: 360 });
// inner wall of a ring close to the post wall (ring entirely near the rim)
add('post-rim-0.05-360', g(POST, ring(19, 19.95, 20, 30), 360), { fam: 'post-wall', gap: 0.05, a: 360 });
// tube: outer wall, bore wall
for (const a of [360, 90]) {
  add(`tube-outer-0.05-${a}`, g(TUBE, ring(15, 29.95, 20, 30), a), { fam: 'tube-outer', gap: 0.05, a });
  add(`tube-outer-0.1-${a}`, g(TUBE, ring(15, 29.9, 10, 20), a), { fam: 'tube-outer', gap: 0.1, a });
  add(`tube-bore-0.05-${a}`, g(TUBE, ring(10.05, 20, 10, 20), a), { fam: 'tube-bore', gap: 0.05, a });
  add(`tube-bore-0.1-${a}`, g(TUBE, ring(10.1, 20, 20, 30), a), { fam: 'tube-bore', gap: 0.1, a });
  add(`tube-bore-0.3-${a}`, g(TUBE, ring(10.3, 20, 10, 20), a), { fam: 'tube-bore-control', gap: 0.3, a });
}
add('tube-bore-flush-360', g(TUBE, ring(10, 20, 10, 20), 360), { fam: 'tube-flush', gap: 0, a: 360 });
// frustum (cone wall, r 30 at z0 to 20 at z30)
for (const a of [360, 90]) {
  add(`frustum-wall-low-${a}`, g(FR, ring(10, 29.95, 0, 0.3), a), { fam: 'frustum-wall', a });
  add(`frustum-wall-top-${a}`, g(FR, ring(5, 19.95, 25, 30), a), { fam: 'frustum-wall', a });
  add(`frustum-wall-mid-${a}`, g(FR, ring(10, 24.95, 14, 20), a), { fam: 'frustum-wall', a });
  add(`frustum-wall-cross-${a}`, g(FR, ring(10, 25, 10, 20), a), { fam: 'frustum-cross', a });
  add(`frustum-wall-far-${a}`, g(FR, ring(10, 15, 10, 20), a), { fam: 'frustum-clear', a });
}
// stepped plate + post
for (const a of [360, 90]) {
  add(`steppost-wall-0.05-${a}`, g(STEPPOST, ring(5, 14.95, 15, 30), a), { fam: 'step-post-wall', gap: 0.05, a });
  add(`steppost-wall-0.1-${a}`, g(STEPPOST, ring(5, 14.9, 12, 30), a), { fam: 'step-post-wall', gap: 0.1, a });
  add(`steppost-wall-0.3-${a}`, g(STEPPOST, ring(5, 14.7, 12, 30), a), { fam: 'step-post-control', gap: 0.3, a });
  add(`steppost-plate-0.05-${a}`, g(STEPPOST, ring(35, 29.95, 0, 5).map(([u, z]) => [Math.min(u, 29.95), z]).slice(0, 0).concat(ring(20, 29.95, 2, 8)), a), { fam: 'step-plate-side', gap: 0.05, a });
}
// off-centre ring axis: ring axis shifted (sketch origin moved) so the circles are not concentric
for (const a of [360, 90]) {
  add(`post-offaxis-tangent-${a}`, `${POST} const r = sketch('top'); r.polygon(${poly(ring(0.5, 5, 20, 30))}); groove(r, t, ${a});`, { fam: 'post-offaxis-clear', a });
}
// sphere (round wall everywhere)
const SPH = `const t = sphere(60);`;
add('sphere-wall-0.05-90', g(SPH, ring(10, 29.95, -5, 5), 90), { fam: 'sphere-wall', a: 90 });

// Off-centre posts: the ring axis is NOT the post axis, so the walls are not concentric. Post d40 centred at (5,0), ring about the origin.
const POST5 = `const k = sketch('top'); k.circle(40, { at: [5, 0] }); const t = extrude(k, 30);`;
for (const [id, u1, a] of [['off-in-0.05', 14.95, 360], ['off-in-0.1', 14.9, 360], ['off-in-0.1', 14.9, 90], ['off-tan', 15, 360], ['off-clear', 14.5, 360], ['off-clear', 14.5, 90], ['off-out-0.1', 15.1, 360]]) add(`post-${id}-${a}`, g(POST5, ring(5, u1, 20, 30), a), { fam: 'post-offcentre', a });
// ring on the front plane of an upright post (ring axis is then not the post axis)
add('post-frontplane-lip-360', `${POST} const r = sketch('front'); r.polygon(${poly(ring(0, 5, 10, 25))}); groove(r, t, 360);`, { fam: 'post-front', a: 360 });
