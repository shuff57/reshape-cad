// Round 6 (critic): nested shapes with a THIN wall. The rig's stand-in profile picker (sg-core solidPoints) used to split a thin ring into one point per side, so truck pulled the
// same ring 4 times (4 coincident bodies, 4x the volume) and nothing refused it. Every case here is judged against the closed-form even-odd area x pull height.
// Sources: critic scripts mycrit/cases11.mjs, cases12.mjs (the first block), plus ladders of wall width from 40% down to 1e-5 of the width.
const P = Math.PI;
export const cases = [];
const fr = (t) => String(Number(t.toPrecision(6)));
// A. rect inside rect, wall t on a W x W square, pulled 10
for (const W of [20, 40, 200]) for (const f of [0.3, 0.2, 0.1, 0.075, 0.05, 0.025, 0.01, 0.002, 1e-4]) {
  const t = W * f; const I = W - 2 * t;
  cases.push({ id: `tw-rr-${W}-${f}`, feature: 'several closed shapes', what: `rect(${W},${W}) with rect(${fr(I)},${fr(I)}) inside (wall ${fr(t)} = ${f * 100}% of the width), pulled 10`, script: `const sk = sketch('top'); sk.rect(${W},${W}); sk.rect(${fr(I)},${fr(I)}); pull(sk, 10)`, exact: { volume: (W * W - I * I) * 10 } });
}
// B. critic's named examples (rect, frame, polygon with inset rect)
cases.push({ id: 'tw-crit-tube-40-2', feature: 'several closed shapes', what: 'critic: rect(40,40).rect(36,36) pulled 10 (true 3040)', script: `pull(sketch('top').rect(40,40).rect(36,36), 10)`, exact: { volume: (1600 - 36 * 36) * 10 } });
cases.push({ id: 'tw-crit-tube-200-5', feature: 'several closed shapes', what: 'critic: rect(200,200).rect(190,190) pulled 10 (true 39000)', script: `pull(sketch('top').rect(200,200).rect(190,190), 10)`, exact: { volume: (40000 - 190 * 190) * 10 } });
cases.push({ id: 'tw-crit-frame-100x60-2', feature: 'several closed shapes', what: 'critic: rect(100,60).rect(96,56) pulled 10 (true 6240)', script: `pull(sketch('top').rect(100,60).rect(96,56), 10)`, exact: { volume: (6000 - 96 * 56) * 10 } });
cases.push({ id: 'tw-crit-poly-inset-1', feature: 'several closed shapes', what: 'critic: polygon 30x20 plus a rect inset by 1 mm (true 960)', script: `pull(sketch('top').polygon([[0,0],[30,0],[30,20],[0,20]]).rect(28,18,{at:[15,10]}), 10)`, exact: { volume: (600 - 28 * 18) * 10 } });
// C. rect with a circle inside
for (const f of [0.2, 0.1, 0.05, 0.02, 0.005]) {
  const t = 20 * f; const d = 20 - 2 * t;
  cases.push({ id: `tw-rc-${f}`, feature: 'several closed shapes', what: `rect(20,20) with circle(${fr(d)}) inside (wall ${fr(t)} at the closest point), pulled 10`, script: `const sk = sketch('top'); sk.rect(20,20); sk.circle(${fr(d)}); pull(sk, 10)`, exact: { volume: (400 - P * (d / 2) ** 2) * 10 } });
}
// D. circle ring
for (const f of [0.2, 0.1, 0.05, 0.02]) {
  const t = 20 * f; const d = 40 - 2 * t;
  cases.push({ id: `tw-cc-${f}`, feature: 'several closed shapes', what: `circle(40) with circle(${fr(d)}) inside (wall ${fr(t)}), pulled 10`, script: `const sk = sketch('top'); sk.circle(40); sk.circle(${fr(d)}); pull(sk, 10)`, exact: { volume: P * (400 - (d / 2) ** 2) * 10 } });
}
// E. polygon with polygon inset (triangle frame), polygon + rect inset
cases.push({ id: 'tw-tri-frame', feature: 'several closed shapes', what: 'triangle (0,0)(40,0)(20,30) with its inset triangle (4,2)(36,2)(20,26) inside', script: `const sk = sketch('top'); sk.polygon([[0,0],[40,0],[20,30]]); sk.polygon([[4,2],[36,2],[20,26]]); pull(sk, 10)`, exact: { volume: (0.5 * 40 * 30 - 0.5 * 32 * 24) * 10 } });
for (const t of [3, 1, 0.5, 0.2]) cases.push({ id: `tw-pr-${t}`, feature: 'several closed shapes', what: `polygon 30x20 with rect inset by ${t} mm`, script: `const sk = sketch('top'); sk.polygon([[0,0],[30,0],[30,20],[0,20]]); sk.rect(${30 - 2 * t},${20 - 2 * t},{at:[15,10]}); pull(sk, 10)`, exact: { volume: (600 - (30 - 2 * t) * (20 - 2 * t)) * 10 } });
// F. off the origin, tall pull, island in a thin ring (three levels), two thin frames side by side
for (const t of [2, 1, 0.5]) cases.push({ id: `tw-off-${t}`, feature: 'several closed shapes', what: `rect(20,20) at [100,50] with rect(${20 - 2 * t}) inside, pulled 10`, script: `const sk = sketch('top'); sk.rect(20,20,{at:[100,50]}); sk.rect(${20 - 2 * t},${20 - 2 * t},{at:[100,50]}); pull(sk, 10)`, exact: { volume: (400 - (20 - 2 * t) ** 2) * 10 } });
cases.push({ id: 'tw-3level-thin', feature: 'several closed shapes', what: 'frame 60 / hole 56 / island 40 (thin outer wall 2, gap 8, island solid)', script: `const sk = sketch('top'); sk.rect(60,60); sk.rect(56,56); sk.rect(40,40); pull(sk, 10)`, exact: { volume: (3600 - 3136 + 1600) * 10 } });
cases.push({ id: 'tw-3level-thin-island', feature: 'several closed shapes', what: 'frame 60 / hole 40 / island ring 36 inside 30 (two thin rings)', script: `const sk = sketch('top'); sk.rect(60,60); sk.rect(56,56); sk.rect(40,40); sk.rect(36,36); pull(sk, 10)`, exact: { volume: (3600 - 3136 + 1600 - 1296) * 10 } });
cases.push({ id: 'tw-two-frames', feature: 'several closed shapes', what: 'two thin square frames side by side (40 with 36 inside, at x=-30 and x=30)', script: `const sk = sketch('top'); sk.rect(40,40,{at:[-30,0]}); sk.rect(36,36,{at:[-30,0]}); sk.rect(40,40,{at:[30,0]}); sk.rect(36,36,{at:[30,0]}); pull(sk, 10)`, exact: { volume: 2 * (1600 - 1296) * 10 } });
cases.push({ id: 'tw-tall-pull', feature: 'several closed shapes', what: 'rect(40,40) with rect(36,36), pulled 100', script: `const sk = sketch('top'); sk.rect(40,40); sk.rect(36,36); pull(sk, 100)`, exact: { volume: (1600 - 1296) * 100 } });
cases.push({ id: 'tw-sketch-frame', feature: 'several closed shapes', what: 'thin square frame on a tilted custom frame', script: `const s=0.6, c=0.8; const sk = sketch({origin:[0,0,0],u:[c,s,0],v:[-s,c,0]}); sk.rect(40,40); sk.rect(36,36); pull(sk, 10)`, exact: { volume: (1600 - 1296) * 10 } });
cases.push({ id: 'tw-slot-frame', feature: 'several closed shapes', what: 'slot with a smaller slot inside (thin curved wall 1)', script: `const sk = sketch('top'); sk.slot([-10,0],[10,0],6); sk.slot([-10,0],[10,0],5); pull(sk, 10)`, exact: { volume: ((20 * 12 + P * 36) - (20 * 10 + P * 25)) * 10 } });
