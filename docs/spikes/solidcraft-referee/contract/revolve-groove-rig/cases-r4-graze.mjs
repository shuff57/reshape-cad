// Round-4 graze probes on parts that are NOT a plain box or cylinder (the critic's blocking defect: the lip graze guard G10 used to run only for those two).
// Targets: frustum (spin), tube (spin), box with a pocket, stepped plate (union of two boxes). Ring end 0.05 mm short of an outer end face, 0.3 mm (control), and short of a face inside the part.
export const cases = [];
const add = (id, src, tag = {}) => cases.push({ id: `R4-${id}`, src, tag });
const poly = (pts) => JSON.stringify(pts);
const FR = `const s = sketch('top'); s.polygon([[0,0],[30,0],[20,30],[0,30]]); const t = spin(s, 360);`;
const TUBE = `const s = sketch('top'); s.polygon([[10,0],[30,0],[30,30],[10,30]]); const t = spin(s, 360);`;
const POCKET = `const k = sketch('top'); k.rect(60, 40, { at: [0, 0] }); const b = extrude(k, 30); const q = sketch('top', 30); q.rect(10, 10, { at: [20, 0] }); const t = pocket(q, b, 10);`;
const STEP = `const k = sketch('top'); k.rect(60, 60, { at: [0, 0] }); const a = extrude(k, 10); const k2 = sketch('top', 10); k2.rect(20, 20, { at: [0, 0] }); const c = extrude(k2, 10); const t = union(a, c);`;
const g = (pre, pts, ang) => `${pre} const r = sketch('top'); r.polygon(${poly(pts)}); groove(r, t, ${ang});`;
for (const a of [360, 180, 90]) {
  add(`frustum-lip005-${a}`, g(FR, [[5,0],[15,0],[15,29.95],[5,29.95]], a), { fam: 'frustum-lip', d: 0.05, a });
  add(`frustum-lip03-${a}`, g(FR, [[5,0],[15,0],[15,29.7],[5,29.7]], a), { fam: 'frustum-lip-control', d: 0.3, a });
}
add('frustum-lip005-mid-90', g(FR, [[5,10],[15,10],[15,29.95],[5,29.95]], 90), { fam: 'frustum-lip', d: 0.05, a: 90 });
add('frustum-bottomlip005-90', g(FR, [[5,0.05],[15,0.05],[15,10],[5,10]], 90), { fam: 'frustum-lip', d: 0.05, a: 90 });
add('frustum-lip001-90', g(FR, [[5,0],[15,0],[15,29.99],[5,29.99]], 90), { fam: 'frustum-lip', d: 0.01, a: 90 });
for (const a of [360, 180, 90]) {
  add(`tube-lip005-${a}`, g(TUBE, [[12,20],[20,20],[20,29.95],[12,29.95]], a), { fam: 'tube-lip', d: 0.05, a });
  add(`tube-lip03-${a}`, g(TUBE, [[12,20],[20,20],[20,29.7],[12,29.7]], a), { fam: 'tube-lip-control', d: 0.3, a });
}
for (const a of [360, 90]) {
  add(`pocket-top-lip005-${a}`, g(POCKET, [[22,10],[28,10],[28,29.95],[22,29.95]], a), { fam: 'pocket-lip', d: 0.05, a });
  add(`pocket-floor-lip005-${a}`, g(POCKET, [[15,10],[25,10],[25,19.95],[15,19.95]], a), { fam: 'pocket-floor-lip-inside', d: 0.05, a });
  add(`pocket-floor-lip03-${a}`, g(POCKET, [[15,10],[25,10],[25,19.7],[15,19.7]], a), { fam: 'pocket-floor-lip-control', d: 0.3, a });
  add(`step-lip005-${a}`, g(STEP, [[20,3],[28,3],[28,9.95],[20,9.95]], a), { fam: 'step-lip-inside', d: 0.05, a });
  add(`step-top-lip005-${a}`, g(STEP, [[2,12],[8,12],[8,19.95],[2,19.95]], a), { fam: 'step-lip-outer', d: 0.05, a });
  add(`step-lip03-${a}`, g(STEP, [[20,3],[28,3],[28,9.7],[20,9.7]], a), { fam: 'step-lip-control', d: 0.3, a });
}
for (const a of [90, 200]) add(`frustum-sealed-${a}`, g(FR, [[5,10],[15,10],[15,20],[5,20]], a), { fam: 'frustum-sealed', a });
add('frustum-tangent-90', g(FR, [[18,2],[25,2],[25,6],[18,6]], 90), { fam: 'frustum-wall' });
// Other uncertified targets named by the critic: sealed rings, tangent / near-coincident round walls.
const SPH = `const t = sphere(60);`;
for (const a of [90, 200]) {
  add(`tube-sealed-${a}`, g(TUBE, [[15,10],[25,10],[25,20],[15,20]], a), { fam: 'tube-sealed', a });
  add(`step-sealed-${a}`, g(STEP, [[22,3],[27,3],[27,7],[22,7]], a), { fam: 'step-sealed', a });
}
add('sphere-sealed-90', g(SPH, [[5,-5],[10,-5],[10,5],[5,5]], 90), { fam: 'sphere-sealed', a: 90 });
add('sphere-groove-90', g(SPH, [[20,-5],[40,-5],[40,5],[20,5]], 90), { fam: 'sphere-open', a: 90 });
for (const a of [360, 90]) add(`tube-bore-graze005-${a}`, g(TUBE, [[5,10],[10.05,10],[10.05,20],[5,20]], a), { fam: 'tube-bore-graze', d: 0.05, a });
add('tube-bore-graze005-wide-90', g(TUBE, [[8,10],[10.05,10],[10.05,25],[8,25]], 90), { fam: 'tube-bore-graze', d: 0.05, a: 90 });
for (const a of [90, 360]) add(`pocket-wall-tangent-${a}`, g(POCKET, [[10,22],[15.05,22],[15.05,28],[10,28]], a), { fam: 'pocket-wall-tangent', d: 0.05, a });
add('pocket-wall-tangent-exact-90', g(POCKET, [[10,22],[15,22],[15,28],[10,28]], 90), { fam: 'pocket-wall-tangent', d: 0, a: 90 });
// Sealed-ring angle sweep on parts the guard cannot certify (the engine alone is erratic by angle on a post, see the sealed row): frustum, stepped plate, sphere.
for (const a of [45, 135, 180, 225, 270, 315, 360]) {
  add(`frustum-sealed-${a}`, g(FR, [[5,10],[15,10],[15,20],[5,20]], a), { fam: 'frustum-sealed', a });
  add(`step-sealed-${a}`, g(STEP, [[22,3],[27,3],[27,7],[22,7]], a), { fam: 'step-sealed', a });
  add(`sphere-sealed-${a}`, g(SPH, [[5,-5],[10,-5],[10,5],[5,5]], a), { fam: 'sphere-sealed', a });
}
