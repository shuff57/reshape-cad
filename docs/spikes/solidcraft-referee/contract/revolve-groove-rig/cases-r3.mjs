// Round-3 deterministic cases for the revolve-groove contract (ids R3-*): the gaps the round-2 critic named, plus the new guard's own behaviour.
// Exports `cases` (array of {id, src, expectVol?, tag?}); run with rg-run.mjs --cases=./cases-r3.mjs (oracle: OCCT + brep-rs + closed form) or rg3-cost.mjs (truck only, with a time kill).
const PI = Math.PI;
const CYL = `const sk1 = sketch('top'); sk1.circle(40); const cyl = extrude(sk1, 30);`;
const V0 = PI * 400 * 30;
const ringV = (r0, r1, h, a) => PI * (r1 * r1 - r0 * r0) * h * a / 360;
const R = (u0, u1, v0, v1) => `[[${u0},${v0}],[${u1},${v0}],[${u1},${v1}],[${u0},${v1}]]`;
export const cases = [];
const add = (id, src, extra = {}) => cases.push({ id: `R3-${id}`, src, ...extra });

// ---- spin / groove on a DATUM plane (sketch(plane('top', 4))) -------------------------------------------------------------------------
for (const [pl, off] of [['top', 4], ['front', 3], ['side', -5]]) for (const a of [90, 180, 360, -90, 270]) {
  add(`datum-spin-${pl}${off}-${a}`, `const p = plane('${pl}', ${off}); const s = sketch(p); s.rect(10, 30, { at: [15, 15] }); spin(s, ${a});`, { expectVol: PI * 300 * 30 * Math.abs(a) / 360 });
}
add('datum-spin-frame-90', `const p = plane({ origin: [2, 3, 4], u: [0, 1, 0], v: [0, 0, 1] }); const s = sketch(p); s.rect(10, 30, { at: [15, 15] }); spin(s, 90);`, { expectVol: PI * 300 * 30 / 4 });
add('datum-spin-negside-90', `const p = plane('top', 4); const s = sketch(p); s.rect(10, 30, { at: [-15, 15] }); spin(s, 90);`, { expectVol: PI * 300 * 30 / 4 });
for (const a of [360, 180, 90]) add(`datum-groove-top-lift-${a}`, `${CYL} const p = plane('top', 4); const g = sketch(p); g.polygon(${R(18, 20, 10, 15)}); groove(g, cyl, ${a});`, a === 360 ? { expectVol: V0 - ringV(18, 20, 5, 360) } : {});
for (const a of [360, 90]) add(`datum-groove-box-front-${a}`, `const b = box(40, 40, 20); const p = plane('front', 3); const g = sketch(p); g.rect(6, 8, { at: [14, 0] }); groove(g, b, ${a});`);
add('datum-groove-box-top-90', `const b = box(40, 40, 20); const p = plane('top', 4); const g = sketch(p); g.rect(6, 8, { at: [14, 0] }); groove(g, b, 90);`);

// ---- the starter rectangle: a deliberate rect(40, 25, { at: [20, 12.5] }) and the remedy in the sentence ----------------------------------
add('starter-deliberate-90', `const s = sketch('top'); s.rect(40, 25, { at: [20, 12.5] }); spin(s, 90);`);
add('starter-remedy-moved-90', `const s = sketch('top'); s.rect(40, 25, { at: [20.01, 12.5] }); spin(s, 90);`, { expectVol: null });
add('starter-undrawn-90', `const s = sketch('top'); spin(s, 90);`);

// ---- ground-box coincidence (G7): full turn nudge, partial refused, lifted by 1 mm builds --------------------------------------------------
const CB = (lift) => `const s0 = sketch('top', ${lift}); s0.rect(40, 40, { at: [0, 0] }); const bx = extrude(s0, 20);`;
for (const pl of ['front', 'side']) for (const a of [360, 270, 180, 90]) {
  add(`ground-${pl}-${a}`, `${CB(0)} const sk2 = sketch('${pl}'); sk2.rect(7, 16, { at: [8.5, 6] }); groove(sk2, bx, ${a});`);
  add(`ground-${pl}-${a}-lift1`, `${CB(1)} const sk2 = sketch('${pl}'); sk2.rect(7, 16, { at: [8.5, 6] }); groove(sk2, bx, ${a});`);
}
// the critic's two named cases (sketch offset can never clear G7): a 60x60x40 box on the ground, front plane offset -5 at 300 degrees; side plane offset 4
add('crit-gn-box-front-off-5-300', `const s1 = sketch('top'); s1.rect(60, 60, { at: [0, 0] }); const b = extrude(s1, 40); const sk = sketch('front', -5); sk.rect(7, 18, { at: [8.5, 17] }); groove(sk, b, 300);`);
add('crit-gn-box-yz-off4-270', `const s1 = sketch('top'); s1.rect(60, 60, { at: [0, 0] }); const b = extrude(s1, 40); const sk = sketch('side', 4); sk.rect(7, 18, { at: [8.5, 17] }); groove(sk, b, 270);`);
add('ground-front-360-nudge-offset-3', `${CB(0)} const sk2 = sketch('front', 3); sk2.rect(7, 16, { at: [8.5, 6] }); groove(sk2, bx, 360);`);
add('ground-hang-below-360', `const s0 = sketch('top', -20); s0.rect(40, 40, { at: [0, 0] }); const bx = extrude(s0, 20); const sk2 = sketch('front'); sk2.rect(7, 16, { at: [8.5, 6] }); groove(sk2, bx, 360);`);
add('ground-hang-below-90', `const s0 = sketch('top', -20); s0.rect(40, 40, { at: [0, 0] }); const bx = extrude(s0, 20); const sk2 = sketch('front'); sk2.rect(7, 16, { at: [8.5, 6] }); groove(sk2, bx, 90);`);

// ---- refused groove, then another groove on the SAME target handle (the chain rule) -------------------------------------------------------
add('chain-same-handle-refused-then-groove', `${CB(0)} const a = sketch('front'); a.rect(7, 16, { at: [8.5, 6] }); groove(a, bx, 90); const c = sketch('side'); c.rect(3, 8, { at: [12, 2] }); groove(c, bx, 180);`);
add('chain-into-form-refused-then-groove', `${CB(0)} const a = sketch('front'); a.rect(7, 16, { at: [8.5, 6] }); const g1 = groove(a, bx, 90); const c = sketch('side'); c.rect(3, 8, { at: [12, 2] }); groove(c, g1, 180);`);
add('chain-same-handle-then-extrude-combine', `${CB(0)} const a = sketch('front'); a.rect(7, 16, { at: [8.5, 6] }); groove(a, bx, 90); const x = box(10, 10, 10, { at: [40, 0, 5] }); union(bx, x);`);
add('chain-sealed-then-groove', `${CYL} const a = sketch('top'); a.rect(4, 6, { at: [10, 15] }); groove(a, cyl, 270); const c = sketch('top'); c.rect(2, 5, { at: [19, 12.5] }); groove(c, cyl, 360);`);
add('chain-both-built', `${CB(1)} const a = sketch('front'); a.rect(7, 16, { at: [8.5, 6] }); groove(a, bx, 270); const c = sketch('side'); c.rect(7, 16, { at: [8.5, 6] }); groove(c, bx, 180);`);
add('chain-both-built-into-form', `${CB(1)} const a = sketch('front'); a.rect(7, 16, { at: [8.5, 6] }); const g1 = groove(a, bx, 270); const c = sketch('side'); c.rect(7, 16, { at: [8.5, 6] }); groove(c, g1, 180);`);

// ---- sealed ring (G9): sweeps over angle and geometry --------------------------------------------------------------------------------------
for (const a of [45, 90, 120, 150, 170, 175, 179, 180, 181, 185, 190, 200, 225, 250, 270, 300, 315, 359, 360]) {
  add(`sealed-post-${a}`, `${CYL} const s2 = sketch('top'); s2.rect(4, 6, { at: [10, 15] }); groove(s2, cyl, ${a});`, { expectVol: V0 - ringV(8, 12, 6, a) });
  add(`sealed-boxtop-${a}`, `const b = box(40, 40, 20); const s = sketch('top'); s.rect(4, 6, { at: [10, 0] }); groove(s, b, ${a});`, { expectVol: 40 * 40 * 20 - ringV(8, 12, 6, a) });
}
for (const a of [90, 180, 270, 360]) {
  add(`sealed-boxfront-${a}`, `const b = box(60, 60, 60); const s = sketch('front'); s.rect(4, 6, { at: [10, 0] }); groove(s, b, ${a});`, { expectVol: 60 ** 3 - ringV(8, 12, 6, a) });
  add(`sealed-boxside-${a}`, `const b = box(60, 60, 60); const s = sketch('side'); s.rect(4, 6, { at: [10, 0] }); groove(s, b, ${a});`, { expectVol: 60 ** 3 - ringV(8, 12, 6, a) });
  add(`sealed-post-ecc-${a}`, `${CYL} const s2 = sketch({ origin: [4, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }); s2.rect(4, 6, { at: [6, 15] }); groove(s2, cyl, ${a});`);
  add(`sealed-bigring-${a}`, `const b = box(60, 60, 40); const s = sketch('top'); s.rect(6, 10, { at: [20, 20] }); groove(s, b, ${a});`, { expectVol: 60 * 60 * 40 - ringV(17, 23, 10, a) });
}
// sealed rings the proof does NOT cover (not a plain box/cylinder), so the kernel text is all the student gets
add('sealed-tube-360', `const k = sketch('top'); k.rect(10, 30, { at: [15, 15] }); const t = spin(k, 360); const s = sketch('top'); s.rect(4, 6, { at: [15, 15] }); groove(s, t, 360);`);
add('sealed-join-boss-360', `const k = sketch('top'); k.circle(40); const a = extrude(k, 30); const k2 = sketch('top', 30); k2.circle(20); const b = extrude(k2, 20); const j = union(a, b); const g = sketch('top'); g.polygon(${R(4, 8, 34, 40)}); groove(g, j, 360);`);

// ---- tool shapes into a BOX (cone, torus, round) -----------------------------------------------------------------------------------------
const BOXG = `const k = sketch('top'); k.rect(60, 40, { at: [10, 5] }); const b = extrude(k, 30);`;      // the critic's box: x -20..40, y -15..25, z 0..30
for (const a of [360, 180, 90]) {
  add(`box-circle-d6p7-${a}`, `${BOXG} const sk = sketch('top'); sk.circle(6.7, { at: [27.6, 0.5] }); groove(sk, b, ${a});`);
  add(`box-cone-tri-${a}`, `${BOXG} const sk = sketch('top'); sk.polygon([[21.7, 2], [33.3, 2], [21.7, 6.8]]); groove(sk, b, ${a});`);
  add(`box-trapezoid-${a}`, `${BOXG} const sk = sketch('top'); sk.polygon([[20, 4], [28, 4], [26, 12], [20, 12]]); groove(sk, b, ${a});`);
  add(`box-round-corner-${a}`, `${BOXG} const sk = sketch('top'); sk.polygon(${R(20, 28, 4, 14)}); sk.round(2, 3); groove(sk, b, ${a});`);
  add(`box-flat-${a}`, `${BOXG} const sk = sketch('top'); sk.polygon(${R(20, 28, 4, 14)}); groove(sk, b, ${a});`);
}
// ---- tilted frames: ring axis not a world axis -------------------------------------------------------------------------------------------
for (const tilt of [15, 30, 45, 90]) {
  const c = Math.cos(tilt * PI / 180).toFixed(6); const s = Math.sin(tilt * PI / 180).toFixed(6);
  for (const a of [360, 90]) {
    add(`tilt${tilt}-post-${a}`, `${CYL} const g = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${c}] }); g.polygon(${R(6, 9, -4, 6)}); groove(g, cyl, ${a});`);
    add(`tilt${tilt}-box-${a}`, `const b = box(60, 40, 30); const g = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${c}] }); g.polygon(${R(6, 9, -4, 6)}); groove(g, b, ${a});`);
  }
}
// ---- cost: the plain post groove (basic student case) and the successive-grooves chain, repeated for variance -----------------------------
for (const rep of [1, 2, 3]) add(`cost-post-coaxial-360-rep${rep}`, `${CYL} const sk2 = sketch('top'); sk2.rect(2, 5, { at: [19, 12.5] }); groove(sk2, cyl, 360);`);

// ---- the round-2 critic's own counterexamples, verbatim (scratchpad crit_rg/resFG.json, res5.json, res2b.json) -------------------------------------------------
add('crit-fz-groove-1', `const s1 = sketch('top'); s1.rect(60,40,{at:[10,5]}); const b = extrude(s1, 30); const sk = sketch('top'); sk.circle(6.7, { at: [27.6, 0.5] }); groove(sk, b, 90);`);
add('crit-fz-groove-13', `const s1 = sketch('top'); s1.rect(60,40,{at:[10,5]}); const b = extrude(s1, 30); const sk = sketch('top'); sk.polygon([[21.7,2],[33.3,2],[21.7,6.8]]); groove(sk, b, 360);`);
add('crit-fz-groove-37', `const s1 = sketch('top'); s1.rect(60,40,{at:[10,5]}); const b = extrude(s1, 30); const sk = sketch('top', 4.8); sk.circle(6.2, { at: [26.5, 18.8] }); groove(sk, b, 360);`);
add('crit-seq-two-grooves-same-target', `const s1 = sketch('top'); s1.rect(60,60,{at:[0,0]}); const b = extrude(s1, 40); const a = sketch('side', 4); a.rect(7,18,{at:[8.5,17]}); groove(a, b, 90); const c = sketch('top'); c.rect(6,10,{at:[20,25]}); groove(c, b, 180);`);
add('crit-gv-cyl-front-360', `const s1 = sketch('top'); s1.circle(40, { at: [0, 0] }); const b = extrude(s1, 30); const sk = sketch('front'); sk.rect(7, 16, { at: [8.5, 0] }); groove(sk, b, 360);`);
add('crit-gv-cyl-front-lift-360', `const s1 = sketch('top', 3); s1.circle(40, { at: [0, 0] }); const b = extrude(s1, 30); const sk = sketch('front'); sk.rect(7, 16, { at: [8.5, 0] }); groove(sk, b, 360);`);

// ---- stress for the "flat tool into a part with flat sides" class: rings that cross every side (and the corners) of the 60 x 40 x 30 box, full and part turns -------------
for (const a of [360, 270, 180, 90, 45]) {
  add(`boxwall-flat-${a}`, `${BOXG} const sk = sketch('top'); sk.polygon(${R(21, 33, 4, 14)}); groove(sk, b, ${a});`);
  add(`boxwall-flat-thin-${a}`, `${BOXG} const sk = sketch('top'); sk.polygon(${R(24, 26, -2, 40)}); groove(sk, b, ${a});`);
  add(`boxwall-cone-${a}`, `${BOXG} const sk = sketch('top'); sk.polygon([[21, 4], [33, 4], [21, 14]]); groove(sk, b, ${a});`);
}
// tilted frames whose ring reaches the box sides (the first tilt set sat inside the box)
for (const tilt of [15, 30, 45]) {
  const c = Math.cos(tilt * PI / 180).toFixed(6); const s = Math.sin(tilt * PI / 180).toFixed(6);
  for (const a of [360, 90]) add(`tiltwall${tilt}-box-${a}`, `const b = box(60, 40, 30); const g = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${c}] }); g.polygon(${R(14, 26, -6, 12)}); groove(g, b, ${a});`);
}
