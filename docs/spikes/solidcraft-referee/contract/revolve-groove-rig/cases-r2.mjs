// Round-2 cases (ids Z-*): the gaps the round-1 critic named. expectVol is a closed form where there is one.
const PI = Math.PI;
const CYL = `const sk1 = sketch('top'); sk1.circle(40); const cyl = extrude(sk1, 30);`;
const V0 = PI * 400 * 30;
const ringV = (r0, r1, h, a) => PI * (r1 * r1 - r0 * r0) * h * a / 360;
const R = (u0, u1, v0, v1) => `[[${u0},${v0}],[${u1},${v0}],[${u1},${v1}],[${u0},${v1}]]`;
export function round2(RG) {
  const out = [];
  const add = (id, src, extra = {}) => out.push({ id, src, ...extra });
  const rectN = `const s = sketch('top'); s.rect(10,30,{at:[-15,15]});`;
  // ---- spin: profile on the -u side (the mirror failure), every shape the critic named ----
  add('Z-spin-negside-cone-90', `const s = sketch('top'); s.polygon([[0,0],[-20,0],[0,30]]); spin(s, 90);`, { expectVol: PI * 400 * 30 / 3 / 4 });
  add('Z-spin-negside-touch-axis-90', `const s = sketch('top'); s.rect(10,30,{at:[-5,15]}); spin(s, 90);`, { expectVol: PI * 100 * 30 / 4 });
  add('Z-spin-negside-touch-axis-neg90', `const s = sketch('top'); s.rect(10,30,{at:[-5,15]}); spin(s, -90);`, { expectVol: PI * 100 * 30 / 4 });
  add('Z-spin-negside-offset5-neg90', `const s = sketch('top', 5); s.rect(10,30,{at:[-15,15]}); spin(s, -90);`, { expectVol: PI * 300 * 30 / 4 });
  add('Z-spin-negside-offset5-90', `const s = sketch('top', 5); s.rect(10,30,{at:[-15,15]}); spin(s, 90);`, { expectVol: PI * 300 * 30 / 4 });
  add('Z-spin-negside-torus-90', `const s = sketch('top'); s.circle(10,{at:[-20,15]}); spin(s, 90);`, { expectVol: 2 * PI * PI * 20 * 25 / 4 });
  add('Z-spin-negside-torus-neg90', `const s = sketch('top'); s.circle(10,{at:[-20,15]}); spin(s, -90);`, { expectVol: 2 * PI * PI * 20 * 25 / 4 });
  add('Z-spin-negside-oblique-120', `const s = sketch({origin:[1,2,3],u:[1,0,0],v:[0,0.6,0.8]}); s.rect(10,30,{at:[-15,15]}); spin(s, 120);`, { expectVol: PI * 300 * 30 / 3 });
  add('Z-spin-negside-custom-90', `const s = sketch({origin:[5,3,2],u:[0,1,0],v:[0,0,1]}); s.rect(10,30,{at:[-15,15]}); spin(s, 90);`, { expectVol: PI * 300 * 30 / 4 });
  add('Z-spin-negside-arc-270', `const s = sketch('top'); s.polygon([[-10,0],[-20,0],[-20,30],[-10,30]]); s.round(2,3); spin(s, 270);`);
  add('Z-spin-negside-360', `const s = sketch('top'); s.rect(10,30,{at:[-15,15]}); spin(s, 360);`, { expectVol: PI * 300 * 30 });
  add('Z-spin-posside-arc-270', `const s = sketch('top'); s.polygon([[10,0],[20,0],[20,30],[10,30]]); s.round(2,3); spin(s, 270);`);
  // ---- spin: angles ----
  for (const a of [0.5, 0.99]) add(`Z-spin-tiny-${String(a).replace('.', 'p')}`, `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, ${a});`, { expectVol: PI * 300 * 30 * a / 360 });
  for (const a of [1, 2, 5]) add(`Z-spin-small-${a}`, `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, ${a});`, { expectVol: PI * 300 * 30 * a / 360 });
  add('Z-spin-r105-2deg', `const s = sketch('top'); s.rect(10,30,{at:[105,15]}); spin(s, 2);`, { expectVol: PI * (110 * 110 - 100 * 100) * 30 * 2 / 360, tag: { amp: 110 * 110 / (110 * 110 - 100 * 100) } });
  add('Z-spin-r105-5deg', `const s = sketch('top'); s.rect(10,30,{at:[105,15]}); spin(s, 5);`, { expectVol: PI * (110 * 110 - 100 * 100) * 30 * 5 / 360, tag: { amp: 110 * 110 / (110 * 110 - 100 * 100) } });
  add('Z-spin-r35-5deg', `const s = sketch('top'); s.rect(10,30,{at:[35,15]}); spin(s, 5);`, { expectVol: PI * (40 * 40 - 30 * 30) * 30 * 5 / 360, tag: { amp: 40 * 40 / (40 * 40 - 30 * 30) } });
  add('Z-spin-neg-small-2', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, -2);`, { expectVol: PI * 300 * 30 * 2 / 360 });
  for (const a of [400, -400, 720, -720, 360.5, -360.5]) add(`Z-spin-over360-${String(a).replace('-', 'neg').replace('.', 'p')}`, `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, ${a});`, { expectVol: PI * 300 * 30, ref: RG + '/variants/refs/ref-revolution__top-400.json' });
  add('Z-spin-over360-negside-400', `${rectN} spin(s, 400);`, { expectVol: PI * 300 * 30 });
  add('Z-spin-over360-cone-500', `const s = sketch('top'); s.polygon([[0,0],[20,0],[0,30]]); spin(s, 500);`, { expectVol: PI * 400 * 30 / 3 });
  // ---- spin: profile problems ----
  const BOW = `[[10,0],[20,30],[20,0],[10,30]]`;
  add('Z-spin-bowtie-90', `const s = sketch('top'); s.polygon(${BOW}); spin(s, 90);`);
  add('Z-spin-bowtie-360', `const s = sketch('top'); s.polygon(${BOW}); spin(s, 360);`);
  add('Z-spin-bowtie-negside-90', `const s = sketch('top'); s.polygon([[-10,0],[-20,30],[-20,0],[-10,30]]); spin(s, 90);`);
  add('Z-spin-pinch-vertex-90', `const s = sketch('top'); s.polygon([[10,0],[20,0],[15,15],[20,30],[10,30],[15,15]]); spin(s, 90);`);
  add('Z-spin-undrawn-90', `const s = sketch('top'); spin(s, 90);`);
  add('Z-spin-undrawn-360', `const s = sketch('top'); spin(s, 360);`);
  add('Z-spin-dup-vertex-90', `const s = sketch('top'); s.polygon([[10,0],[10,0],[20,0],[20,30],[10,30]]); spin(s, 90);`);
  add('Z-spin-collinear-90', `const s = sketch('top'); s.polygon([[10,0],[15,0],[20,0]]); spin(s, 90);`);
  add('Z-spin-collinear-4pt-90', `const s = sketch('top'); s.polygon([[10,0],[15,0],[20,0],[25,0]]); spin(s, 90);`);
  add('Z-spin-cross-axis-1e-3-90', `const s = sketch('top'); s.polygon([[-0.001,0],[10,0],[10,30],[-0.001,30]]); spin(s, 90);`);
  add('Z-spin-cross-axis-1e-3-360', `const s = sketch('top'); s.polygon([[-0.001,0],[10,0],[10,30],[-0.001,30]]); spin(s, 360);`);
  add('Z-spin-cross-axis-1e-7-360', `const s = sketch('top'); s.polygon([[-1e-7,0],[10,0],[10,30],[-1e-7,30]]); spin(s, 360);`);
  add('Z-spin-cross-axis-circle-90', `const s = sketch('top'); s.circle(10,{at:[2,15]}); spin(s, 90);`);
  add('Z-spin-zero-circle-90', `const s = sketch('top'); s.circle(0,{at:[20,15]}); spin(s, 90);`);
  // ---- groove: box 40x40x20, front and side planes at every angle (the critic's overclaim) ----
  for (const plane of ['front', 'side']) for (const a of [360, 90, 180, 270]) {
    add(`Z-groove-box-${plane}-ring11-17-${a}`, `const b = box(40,40,20); const s = sketch('${plane}'); s.rect(6,8,{at:[14,0]}); groove(s, b, ${a});`);
    add(`Z-groove-box-${plane}-ring5-9-${a}`, `const b = box(40,40,20); const s = sketch('${plane}'); s.rect(4,8,{at:[7,0]}); groove(s, b, ${a});`);
  }
  // seam experiment: the same ring against the same box turned about the ring axis (Y) by t degrees; the cylinder wall patches of the result
  // move relative to the tool surface's own parametrization, so a face count that changes with t is a seam split, not a geometry change
  for (const a of [180, 360]) for (const t of [20, 40, 60, 80, 100, 130, 160]) {
    add(`Z-groove-box-front-ring11-17-${a}-turn${t}`, `const b = box(40,40,20); const tb = turn(b, [0, ${t}, 0]); const s = sketch('front'); s.rect(6,8,{at:[14,0]}); groove(s, tb, ${a});`);
  }
  // the round-1 critic's own box/post grooves (scratchpad crit/res-groove.json), reproduced verbatim as Z-crit-*
  const CB = `const s0 = sketch('top'); s0.rect(40, 40, { at: [0, 0] }); const bx = extrude(s0, 20);`;
  for (const [pl, off] of [['front', 0], ['front', 4], ['side', 0], ['side', -4]]) for (const a of [360, 90, 180, 270]) {
    add(`Z-crit-box-${pl}${off}-${a}`, `${CB} const sk2 = sketch('${pl}'${off ? ', ' + off : ''}); sk2.rect(7, 16, { at: [8.5, 6] }); groove(sk2, bx, ${a});`);
  }
  // coincidence experiment: the critic's boxes put the profile plane (z = 0, which holds the revolve seam and the end caps) ON the box's bottom
  // face; lifting the box off that plane by 1 or 3 mm (or centring it) should remove the coincidence
  for (const [pl, off] of [['front', 0], ['side', 0]]) for (const a of [360, 270, 180, 90]) for (const lift of [1, 3, -3]) {
    add(`Z-crit-box-${pl}${off}-${a}-lift${String(lift).replace('-', 'n')}`, `const s0 = sketch('top', ${lift}); s0.rect(40, 40, { at: [0, 0] }); const bx = extrude(s0, 20); const sk2 = sketch('${pl}'${off ? ', ' + off : ''}); sk2.rect(7, 16, { at: [8.5, 6] }); groove(sk2, bx, ${a});`);
  }
  // second coincidence sample, not the critic's boxes: a 40x40x20 box moved so one of its faces lies exactly in the profile plane
  const ON = { front: 'at:[0,0,10]', side: 'at:[0,0,10]', top: 'at:[0,20,0]' };   // front/side: profile plane z = 0 (box z 0..20); top: profile plane y = 0 (box y 0..40)
  for (const pl of ['front', 'side', 'top']) for (const a of [360, 270, 135]) for (const [tag, rc] of [['ring11-17', 's.rect(6,8,{at:[14,0]})'], ['ring5-9', 's.rect(4,8,{at:[7,0]})']]) {
    add(`Z-coin-box-${pl}-${tag}-${a}`, `const b = box(40,40,20,{${ON[pl]}}); const s = sketch('${pl}'); ${rc}; groove(s, b, ${a});`);
  }
  for (const a of [360, 180, 90]) add(`Z-crit-bore-axis-${a}`, `${CYL} const sk2 = sketch('top'); sk2.rect(6, 10, { at: [3, 15] }); groove(sk2, cyl, ${a});`);
  add('Z-crit-straddle-top-360', `${CYL} const sk2 = sketch('top'); sk2.rect(4, 10, { at: [15, 30] }); groove(sk2, cyl, 360);`);
  add('Z-crit-straddle-outer-360', `${CYL} const sk2 = sketch('top'); sk2.rect(10, 10, { at: [20, 15] }); groove(sk2, cyl, 360);`);
  add('Z-crit-miss-360', `${CYL} const sk2 = sketch('top'); sk2.rect(5, 10, { at: [32.5, 15] }); groove(sk2, cyl, 360);`);
  add('Z-crit-miss-90', `${CYL} const sk2 = sketch('top'); sk2.rect(5, 10, { at: [32.5, 15] }); groove(sk2, cyl, 90);`);
  add('Z-crit-miss-height', `${CYL} const sk2 = sketch('top'); sk2.rect(4, 10, { at: [10, 45] }); groove(sk2, cyl, 360);`);
  add('Z-crit-through-ring-360', `${CYL} const sk2 = sketch('top'); sk2.rect(4, 32, { at: [10, 15] }); groove(sk2, cyl, 360);`);
  // groove on the -u side with the ring inside the part (fast, so the mirror failure is measured on a post as well as on a box)
  for (const a of [45, 90, 179, 270]) add(`Z-groove-negside-interior-${a}`, `${CYL} const g = sketch('top'); g.polygon(${R(-12, -8, 12, 18)}); groove(g, cyl, ${a});`, { expectVol: V0 - ringV(8, 12, 6, a) });
  // ---- groove: more shapes of target ----
  const BOSS = `const s1 = sketch('top'); s1.circle(40); const base = extrude(s1, 30); const s2 = sketch('top', 30); s2.circle(20); const boss = extrude(s2, 20); const j = union(base, boss);`;
  add('Z-groove-join-boss-360', `${BOSS} const g = sketch('top'); g.polygon(${R(8, 10, 35, 40)}); groove(g, j, 360);`);
  add('Z-groove-join-base-360', `${BOSS} const g = sketch('top'); g.polygon(${R(18, 20, 10, 15)}); groove(g, j, 360);`);
  add('Z-groove-join-base-90', `${BOSS} const g = sketch('top'); g.polygon(${R(18, 20, 10, 15)}); groove(g, j, 90);`);
  const ECC = (a) => `${CYL} const g = sketch({origin:[5,0,0],u:[1,0,0],v:[0,0,1]}); g.polygon(${R(17, 19, 10, 15)}); groove(g, cyl, ${a});`;
  add('Z-groove-eccentric-360', ECC(360));
  add('Z-groove-eccentric-90', ECC(90));
  add('Z-groove-stacked-overlap-360-then-90', `${CYL} const a = sketch('top'); a.polygon(${R(18, 20, 5, 10)}); const g1 = groove(a, cyl, 360); const b = sketch('top'); b.polygon(${R(17, 19, 8, 13)}); groove(b, g1, 90);`);
  add('Z-groove-stacked-overlap-90-then-90', `${CYL} const a = sketch('top'); a.polygon(${R(18, 20, 5, 10)}); const g1 = groove(a, cyl, 90); const b = sketch('top'); b.polygon(${R(17, 19, 8, 13)}); groove(b, g1, 90);`);
  // a join of two cylinder PRIMITIVES (the critic's join case; the Z-groove-join-* cases above join two extrusions)
  const JP = `const a = cylinder(40, 30); const b = cylinder(20, 20, { at: [0, 0, 15] }); const j = union(a, b);`;
  add('Z-crit-groove-after-join', `const sk1 = sketch('top'); sk1.circle(40); const cyl = extrude(sk1, 30); const s2 = sketch('top', 30); s2.circle(20); const top = extrude(s2, 10); const j = join(cyl, top); const sa = sketch('top'); sa.rect(2, 5, { at: [9, 27] }); groove(sa, j, 360);`);
  add('Z-groove-join-cylprims-360', `${JP} const g = sketch('top'); g.polygon(${R(18, 20, 0, 5)}); groove(g, j, 360);`);
  add('Z-groove-join-cylprims-boss-360', `${JP} const g = sketch('top'); g.polygon(${R(8, 10, 18, 22)}); groove(g, j, 360);`);
  // ModelDoc angles the script layer would stop first
  out.push({ id: 'P-spin-800-patched', src: `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 90);`, patch: { kind: 'revolve', set: { angle: 800 } } });
  const BAR = `const bar = box(60,10,20);`;
  add('Z-groove-box-split-360', `${BAR} const g = sketch('top'); g.polygon(${R(10, 12, -20, 20)}); groove(g, bar, 360);`);
  add('Z-groove-box-split-180', `${BAR} const g = sketch('top'); g.polygon(${R(10, 12, -20, 20)}); groove(g, bar, 180);`);
  add('Z-groove-box-then-groove-split-piece', `${BAR} const g = sketch('top'); g.polygon(${R(10, 12, -20, 20)}); const g1 = groove(g, bar, 360); const h = sketch('top'); h.polygon(${R(20, 22, -5, 5)}); groove(h, g1, 360);`);
  add('Z-groove-soup-90', `${CYL} const g = sketch('top'); g.geom([{ k: 'circle', id: 1, c: [19, 12.5], r: 3 }, { k: 'circle', id: 2, c: [19, 12.5], r: 1 }]); groove(g, cyl, 90);`);
  add('Z-groove-undrawn-90', `${CYL} const g = sketch('top'); groove(g, cyl, 90);`);
  add('Z-groove-undrawn-360', `${CYL} const g = sketch('top'); groove(g, cyl, 360);`);
  add('Z-groove-bowtie-90', `${CYL} const g = sketch('top'); g.polygon([[18,10],[20,15],[20,10],[18,15]]); groove(g, cyl, 90);`);
  add('Z-groove-bowtie-360', `${CYL} const g = sketch('top'); g.polygon([[18,10],[20,15],[20,10],[18,15]]); groove(g, cyl, 360);`);
  add('Z-groove-dup-vertex-90', `${CYL} const g = sketch('top'); g.polygon([[18,10],[18,10],[20,10],[20,15],[18,15]]); groove(g, cyl, 90);`);
  add('Z-groove-collinear-90', `${CYL} const g = sketch('top'); g.polygon([[18,10],[19,10],[20,10]]); groove(g, cyl, 90);`);
  add('Z-groove-cross-axis-360', `${CYL} const g = sketch('top'); g.polygon(${R(-1, 1, 10, 15)}); groove(g, cyl, 360);`);
  add('Z-groove-cross-axis-1e-3-90', `${CYL} const g = sketch('top'); g.polygon(${R(-0.001, 2, 10, 15)}); groove(g, cyl, 90);`);
  // ---- groove that cuts nothing ----
  add('Z-groove-disjoint-r30-35-360', `${CYL} const g = sketch('top'); g.polygon(${R(30, 35, 10, 20)}); groove(g, cyl, 360);`, { expectVol: V0 });
  add('Z-groove-disjoint-r30-35-90', `${CYL} const g = sketch('top'); g.polygon(${R(30, 35, 10, 20)}); groove(g, cyl, 90);`, { expectVol: V0 });
  add('Z-groove-disjoint-above-360', `${CYL} const g = sketch('top'); g.polygon(${R(10, 20, 40, 50)}); groove(g, cyl, 360);`, { expectVol: V0 });
  add('Z-groove-disjoint-above-90', `${CYL} const g = sketch('top'); g.polygon(${R(10, 20, 40, 50)}); groove(g, cyl, 90);`, { expectVol: V0 });
  add('Z-groove-disjoint-below-270', `${CYL} const g = sketch('top'); g.polygon(${R(10, 20, -20, -5)}); groove(g, cyl, 270);`, { expectVol: V0 });
  add('Z-groove-turns-away-front-90', `${CYL} const g = sketch('front'); g.polygon(${R(18, 20, 10, 15)}); groove(g, cyl, 90);`, { expectVol: V0 });
  add('Z-groove-ring-inside-hollow-360', `const t = sketch('top'); t.rect(10,30,{at:[15,15]}); const tube = spin(t, 360); const g = sketch('top'); g.polygon(${R(2, 4, 10, 15)}); groove(g, tube, 360);`, { expectVol: PI * 300 * 30 });
  // ---- groove: angle in range, tiny ----
  add('Z-groove-box-0p5', `const b = box(60,60,40); const s = sketch('top'); s.rect(10,10,{at:[30,0]}); groove(s, b, 0.5);`);
  add('Z-groove-box-1', `const b = box(60,60,40); const s = sketch('top'); s.rect(10,10,{at:[30,0]}); groove(s, b, 1);`);
  add('Z-groove-box-2', `const b = box(60,60,40); const s = sketch('top'); s.rect(10,10,{at:[30,0]}); groove(s, b, 2);`);
  return out;
}
