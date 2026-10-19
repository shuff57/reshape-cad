// Round 5 attack cases: the blind attacks the critic ran against the round-4 contract, kept as cases so they run through BOTH the raw translator and the guarded one.
// NOTE: the critic's param-* cases passed `values: { w: -4 }` keyed by param NAME, which runScript ignores (values are keyed by slot, e.g. sk1_p1u); measured: the default size was built.
// Here the tested number is the param()'s own default in the script text, which is the only way a param name reaches the doc.
// Generated once from the critic's attack scripts (attack1/3b/4/5/6.mjs), then edited by hand; the ids are prefixed 'a5-'.
const P = Math.PI;
// ---- attack1 (from the critic's attack1.mjs) ----
const attack1 = (() => {

const bul = (b) => (d) => { const sk = d.features.find((f) => f.kind === 'sketch'); sk.bulges = b; return d; };
const cases = [
  // A. what I found unguarded
  { id: 'A-bowtie', script: `const sk = sketch('top'); sk.polygon([[0,0],[30,30],[30,0],[0,30]]); pull(sk, 10)` },
  { id: 'A-bowtie2', script: `const sk = sketch('top'); sk.polygon([[0,0],[40,25],[40,0],[0,35]]); pull(sk, 10)` },
  { id: 'A-tri-bulge-0.9', script: `const sk = sketch('top'); sk.polygon([[0,0],[40,0],[10,30]]); pull(sk, 10)`, edit: bul({0:-0.9}) },
  { id: 'A-rect-bulge-3', script: `const sk = sketch('top'); sk.rect(40,25); pull(sk, 10)`, edit: bul({0:-3}) },
  { id: 'A-stadium', script: `const sk = sketch('top'); sk.rect(20,10); sk.round(1,5); sk.round(2,5); sk.round(3,5); sk.round(4,5); pull(sk, 12)`, exact: { volume: (200 - (4 - P) * 25) * 12 } },
  { id: 'A-chamfer99', script: `const sk = sketch('top'); sk.rect(30,20); sk.chamfer(2,99); pull(sk, 12)` },
  { id: 'A-circle0', script: `const sk = sketch('top'); sk.circle(0); pull(sk,10)` },
  { id: 'A-arc-mismatch', script: `const sk = sketch('top'); sk.geom([{k:'arc', id:1, c:[0,0], r:3, a:[3,0], b:[0,5], sense:'ccw'},{k:'line',id:2,a:[0,5],b:[3,0]}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}]); pull(sk,10)` },
  { id: 'A-two-squares-apart', script: `const sk = sketch('top'); sk.rect(10,10,{at:[-20,0]}); sk.rect(14,6,{at:[20,3]}); pull(sk, 10)`, exact: { volume: 1840 } },
  { id: 'A-ring-disc', script: `const sk = sketch('top'); sk.circle(60); sk.circle(40); sk.circle(20); pull(sk, 15)`, exact: { volume: P * (900 - 400 + 100) * 15 } },
  { id: 'A-crossing', script: `const sk = sketch('top'); sk.rect(40,30); sk.circle(20,{at:[20,0]}); pull(sk, 10)` },
  // B. new attacks: tolerance traps
  { id: 'B-slit-1e-6', script: `const sk = sketch('top'); sk.polygon([[0,0],[20,0],[20,10],[10.000001,10],[10.000001,2],[9.999999,2],[9.999999,10],[0,10]]); pull(sk, 10)` },
  { id: 'B-slit-5e-6', script: `const sk = sketch('top'); sk.polygon([[0,0],[20,0],[20,10],[10.000005,10],[10.000005,2],[10,2],[10,10],[0,10]]); pull(sk, 10)` },
  { id: 'B-slit-1e-5', script: `const sk = sketch('top'); sk.polygon([[0,0],[20,0],[20,10],[10.00001,10],[10.00001,2],[10,2],[10,10],[0,10]]); pull(sk, 10)`, exact: { volume: (200 - 8e-5) * 10 } },
  { id: 'B-slit-1e-4', script: `const sk = sketch('top'); sk.polygon([[0,0],[20,0],[20,10],[10.0001,10],[10.0001,2],[10,2],[10,10],[0,10]]); pull(sk, 10)`, exact: { volume: (200 - 8e-4) * 10 } },
  { id: 'B-hole-near-edge-1e-4', script: `const sk = sketch('top'); sk.rect(40,30); sk.circle(10,{at:[14.9999,0]}); pull(sk, 10)` },
  { id: 'B-hole-near-edge-1e-3', script: `const sk = sketch('top'); sk.rect(40,30); sk.circle(10,{at:[14.999,0]}); pull(sk, 10)`, exact: { volume: (1200 - P * 25) * 10 } },
  { id: 'B-hole-near-edge-0.01', script: `const sk = sketch('top'); sk.rect(40,30); sk.circle(10,{at:[14.99,0]}); pull(sk, 10)`, exact: { volume: (1200 - P * 25) * 10 } },
  { id: 'B-hole-r.999R', script: `const sk = sketch('top'); sk.circle(50); sk.circle(49.9); pull(sk, 10)`, exact: { volume: P * (625 - 24.95 * 24.95) * 10 } },
  { id: 'B-hole-r.99R', script: `const sk = sketch('top'); sk.circle(50); sk.circle(49); pull(sk, 10)`, exact: { volume: P * (625 - 24.5 * 24.5) * 10 } },
  { id: 'B-two-holes-close', script: `const sk = sketch('top'); sk.rect(60,30); sk.circle(10,{at:[-5.001,0]}); sk.circle(10,{at:[5.001,0]}); pull(sk, 10)`, exact: { volume: (1800 - 2 * P * 25) * 10 } },
  { id: 'B-two-holes-gap-1e-3', script: `const sk = sketch('top'); sk.rect(60,30); sk.circle(10,{at:[-5.0005,0]}); sk.circle(10,{at:[5.0005,0]}); pull(sk, 10)`, exact: { volume: (1800 - 2 * P * 25) * 10 } },
  // C. coordinates / scale
  { id: 'C-far-rect-round', script: `const sk = sketch('top'); sk.rect(30,20,{at:[1e6,1e6]}); sk.round(1,4); pull(sk, 12)`, exact: { volume: (600 - (4 - P) * 4) * 12 } },
  { id: 'C-far-hole', script: `const sk = sketch('top'); sk.rect(30,20,{at:[1e5,-1e5]}); sk.circle(8,{at:[1e5,-1e5]}); pull(sk, 12)`, exact: { volume: (600 - P * 16) * 12 } },
  { id: 'C-big-circle-thin', script: `const sk = sketch('top'); sk.circle(10000); pull(sk, 1)`, exact: { volume: P * 25e6 } },
  { id: 'C-big-plate-hole', script: `const sk = sketch('top'); sk.rect(1000,1000); sk.circle(4,{at:[100,100]}); pull(sk, 5)`, exact: { volume: (1e6 - P * 4) * 5 } },
  // D. multi-shape variants
  { id: 'D-hole-first-then-outer', script: `const sk = sketch('top'); sk.circle(10); sk.rect(40,30); pull(sk, 10)`, exact: { volume: (1200 - P * 25) * 10 } },
  { id: 'D-3level-polys', script: `const sk = sketch('top'); sk.rect(60,60); sk.rect(40,40); sk.rect(20,20); pull(sk, 10)`, exact: { volume: (3600 - 1600 + 400) * 10 } },
  { id: 'D-slot-in-hole-in-plate', script: `const sk = sketch('top'); sk.circle(60); sk.circle(40); sk.slot([-5,0],[5,0],3); pull(sk, 10)`, exact: { volume: (P * (900 - 400) + 60 + P * 9) * 10 } },
  { id: 'D-frame-swapped-hole', script: `const sk = sketch({origin:[1,2,3],u:[0,1,0],v:[1,0,0]}); sk.rect(40,30,{at:[3,4]}); sk.circle(10,{at:[6,4]}); pull(sk, 10)`, exact: { volume: (1200 - P * 25) * 10 } },
  { id: 'D-tilted-frame-two-pieces', script: `const s=Math.SQRT1_2; const sk = sketch({origin:[4,-3,2],u:[s,s,0],v:[-s,s,0]}); sk.rect(10,10,{at:[-12,0]}); sk.circle(8,{at:[12,0]}); pull(sk, 10)`, exact: { volume: (100 + P * 16) * 10 } },
  { id: 'D-polygon-with-polygon-hole-concave', script: `const sk = sketch('top'); sk.polygon([[0,0],[40,0],[40,30],[0,30]]); sk.polygon([[5,5],[20,5],[20,10],[10,10],[10,25],[5,25]]); pull(sk, 10)`, exact: { volume: (1200 - (15*5 + 5*15)) * 10 } },
  { id: 'D-hole-through-pocket', script: `const b=cuboid(60,60,20); const sk=sketch('top',10); sk.rect(40,40); sk.circle(20); pocket(sk,b,5)`, exact: { volume: (72000 - (1600 - P * 100) * 5) } },
  // E. polygons
  { id: 'E-acute-sliver', script: `const sk = sketch('top'); sk.polygon([[0,0],[100,0],[100,0.01]]); pull(sk, 10)`, exact: { volume: 0.5 * 100 * 0.01 * 10 } },
  { id: 'E-200gon', script: `const pts=[]; for(let i=0;i<200;i++){const a=2*Math.PI*i/200; pts.push([30*Math.cos(a),30*Math.sin(a)])}; const sk = sketch('top'); sk.polygon(pts); pull(sk, 10)`, exact: { volume: 0.5 * 200 * 900 * Math.sin(2 * P / 200) * 10 } },
  { id: 'E-star-concave', script: `const pts=[]; for(let i=0;i<10;i++){const a=2*Math.PI*i/10; const r=i%2?10:25; pts.push([r*Math.cos(a),r*Math.sin(a)])}; const sk = sketch('top'); sk.polygon(pts); pull(sk, 10)`, exact: { volume: 0.5 * 10 * 25 * 10 * Math.sin(2 * P / 10) * 10 } },
  { id: 'E-star-round-reflex', script: `const pts=[]; for(let i=0;i<10;i++){const a=2*Math.PI*i/10; const r=i%2?10:25; pts.push([r*Math.cos(a),r*Math.sin(a)])}; const sk = sketch('top'); sk.polygon(pts); for (let i=2;i<=10;i+=2) sk.round(i,3); pull(sk, 10)` },
  { id: 'E-star-round-tips', script: `const pts=[]; for(let i=0;i<10;i++){const a=2*Math.PI*i/10; const r=i%2?10:25; pts.push([r*Math.cos(a),r*Math.sin(a)])}; const sk = sketch('top'); sk.polygon(pts); for (let i=1;i<=10;i+=2) sk.round(i,2); pull(sk, 10)` },
  { id: 'E-chamfer-round-same-corner', script: `const sk = sketch('top'); sk.rect(30,20); sk.chamfer(1,5); sk.round(1,3); pull(sk,10)` },
  { id: 'E-slot-small-gap', script: `const sk = sketch('top'); sk.slot([0,0],[0.02,0],5); pull(sk, 10)`, exact: { volume: (0.02*10 + P*25) * 10 } },
  { id: 'E-slot-1', script: `const sk = sketch('top'); sk.slot([-30,0],[30,0],0.5); pull(sk, 10)`, exact: { volume: (60 * 1 + P * 0.25) * 10 } },
];

  return cases;
})();
// ---- attack3b (from the critic's attack3b.mjs) ----
const attack3b = (() => {

const cases = [
  { id: 'weird-pull-neg', script: `const sk = sketch('top'); sk.rect(10,10); pull(sk,-5)`, exact: { volume: 500 } },
  { id: 'param-w-0', script: `const w = param('w', 0, {min:0, max:50}); const sk = sketch('top'); sk.rect(w, 5); pull(sk,10)` },
  { id: 'param-w-neg', script: `const w = param('w', -4, {min:-50, max:50}); const sk = sketch('top'); sk.rect(w, 5); pull(sk,10)` },
  { id: 'param-d-0', script: `const d = param('d', 0, {min:0, max:50}); const sk = sketch('top'); sk.circle(d); pull(sk,10)` },
  { id: 'param-d-neg', script: `const d = param('d', -6, {min:-50, max:50}); const sk = sketch('top'); sk.circle(d); pull(sk,10)` },
  { id: 'param-r-neg', script: `const r = param('r', -2, {min:-5, max:50}); const sk = sketch('top'); sk.rect(30,20); sk.round(1,r); pull(sk,10)` },
  { id: 'param-r-big', script: `const r = param('r', 400, {min:0, max:500}); const sk = sketch('top'); sk.rect(30,20); sk.round(1,r); pull(sk,10)` },
  { id: 'param-slot-0', script: `const r = param('r', 0, {min:0, max:50}); const sk = sketch('top'); sk.slot([-10,0],[10,0],r); pull(sk,10)` },
  { id: 'param-offset-plane', script: `const o = param('o', -20, {min:-50, max:50}); const sk = sketch('top', o); sk.rect(30,20); pull(sk,10)` },
  { id: 'param-poly-pt', script: `const x = param('x', -30, {min:-50, max:50}); const sk = sketch('top'); sk.polygon([[0,0],[x,0],[x,10],[0,10]]); pull(sk,10)` },
  { id: 'param-poly-bowtie', script: `const x = param('x', 30, {min:-50, max:50}); const sk = sketch('top'); sk.polygon([[0,0],[x,10],[x,0],[0,10]]); pull(sk,10)` },
];

  return cases;
})();
// ---- attack4 (from the critic's attack4.mjs) ----
const attack4 = (() => {

const RECT = `const w = param('w', 10); const sk = sketch('top'); sk.rect(w, 5); pull(sk,10)`;
const CIRC = `const d = param('d', 10); const sk = sketch('top'); sk.circle(d); pull(sk,10)`;
const RND = `const r = param('r', 3); const sk = sketch('top'); sk.rect(30,20); sk.round(1,r); pull(sk,10)`;
const SLOT = `const r = param('r', 3); const sk = sketch('top'); sk.slot([-10,0],[10,0],r); pull(sk,10)`;
const cases = [
  { id: 'slide-across-0', script: CIRC, values: { sk1_across: 0 } },
  { id: 'slide-across-neg6', script: CIRC, values: { sk1_across: -6 } },
  { id: 'slide-across-0.3', script: CIRC, values: { sk1_across: 0.3 } },
  { id: 'slide-r0-neg2', script: RND, values: { sk1_r0: -2 } },
  { id: 'slide-r0-400', script: RND, values: { sk1_r0: 400 } },
  { id: 'slide-r0-0', script: RND, values: { sk1_r0: 0 } },
  { id: 'slide-slot-g1r-0', script: SLOT, values: { sk1_g1r: 0, sk1_g2r: 0 } },
  { id: 'slide-slot-g1r-6', script: SLOT, values: { sk1_g1r: 6 } },
  { id: 'slide-slot-both-6', script: SLOT, values: { sk1_g1r: 6, sk1_g2r: 6 }, exact: { volume: (2*6*20 + P*36) * 10 } },
  { id: 'slide-rect-bowtie', script: RECT, values: { sk1_p2u: -5, sk1_p3u: 5 } },
  { id: 'slide-rect-collapse', script: RECT, values: { sk1_p1u: -5, sk1_p2u: -5 } },
  { id: 'slide-rect-collinear', script: RECT, values: { sk1_p2v: -2.5, sk1_p3v: -2.5 } },
  { id: 'slide-rect-pdup', script: RECT, values: { sk1_p1u: -5, sk1_p1v: -2.5 } },
  { id: 'slide-offset-1e5', script: RND.replace("sketch('top')", "sketch('top', 0)"), values: { sk1_offset: 1e5 } },
  { id: 'slide-rect-w-neg-via-points', script: RECT, values: { sk1_p1u: -15, sk1_p2u: -15 } },
];

  return cases;
})();
// ---- attack5 (from the critic's attack5.mjs) ----
const attack5 = (() => {
const bul = (b) => (d) => { const sk = d.features.find((f) => f.kind === 'sketch'); sk.bulges = b; return d; };
 (b) => (d) => { const sk = d.features.find((f) => f.kind === 'sketch'); sk.bulges = b; return d; };
const base = { script: `const sk = sketch('top'); sk.rect(40,25); pull(sk, 10)` };
const cases = [];
// arc peak vs top edge gap; negative bulge bows inward: edge 0 bottom, bow 25 reaches top edge
for (const gap of [0, 1e-7, 1e-6, 3e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1]) {
  const g = -(25 - gap) / 20;
  cases.push({ ...base, id: `touch-top-gap-${gap}`, edit: bul({ 0: g }) });
}
// arc crossing by tiny amount
for (const over of [1e-7, 1e-5, 1e-3]) cases.push({ ...base, id: `cross-top-over-${over}`, edit: bul({ 0: -(25 + over) / 20 }) });
// outward bulge arcs passing near neighbour corner (semi-circle on short edge near-touching other shapes n/a)

  return cases;
})();
// ---- attack6 (from the critic's attack6.mjs) ----
const attack6 = (() => {
const J = JSON.stringify;
const L = (id, a, b) => ({ k: 'line', id, a, b });
const coin = (a, aEnd, b, bEnd) => ({ k: 'coincident', a, aEnd, b, bEnd });
const RECT = (w, h) => [L(1, [0, 0], [w, 0]), L(2, [w, 0], [w, h]), L(3, [w, h], [0, h]), L(4, [0, h], [0, 0])];
const RR = [coin(1,'b',2,'a'), coin(2,'b',3,'a'), coin(3,'b',4,'a'), coin(4,'b',1,'a'), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const mk = (id, geoms, rules, extra = {}) => ({ id, script: `const sk = sketch('top'); sk.geom(${J(geoms)}); sk.rules(${J(rules)}); pull(sk, 10)`, ...extra });
const cases = [
  // rect drawn 20x25, width rule 10 shrinks it; hole at x=15 would be outside the shrunken rect if the left edge is the anchor
  mk('uc-shrink-hole-outside', [...RECT(20, 25), { k: 'circle', id: 5, c: [15, 12.5], r: 3 }], [...RR, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 10 }]),
  mk('uc-shrink-hole-edge', [...RECT(20, 25), { k: 'circle', id: 5, c: [9, 12.5], r: 3 }], [...RR, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 10 }]),
  mk('uc-grow-hole', [...RECT(20, 25), { k: 'circle', id: 5, c: [10, 12.5], r: 3 }], [...RR, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }, { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 8 }]),
  mk('uc-hole-radius-rule-big', [...RECT(20, 25), { k: 'circle', id: 5, c: [10, 12.5], r: 3 }], [...RR, { k: 'radius', a: 5, value: 14 }]),
  mk('uc-hole-diam-eq-width', [...RECT(20, 25), { k: 'circle', id: 5, c: [10, 12.5], r: 3 }], [...RR, { k: 'diameter', a: 5, value: 20 }]),
  mk('uc-two-circles-equal-radius', [...RECT(60, 25), { k: 'circle', id: 5, c: [15, 12.5], r: 3 }, { k: 'circle', id: 6, c: [40, 12.5], r: 9 }], [...RR, { k: 'equal', a: 5, b: 6 }]),
  mk('uc-equal-big-overlap', [...RECT(60, 25), { k: 'circle', id: 5, c: [15, 12.5], r: 3 }, { k: 'circle', id: 6, c: [25, 12.5], r: 9 }], [...RR, { k: 'equal', a: 5, b: 6 }]),
  mk('uc-hole-pointon-edge', [...RECT(40, 25), { k: 'circle', id: 5, c: [20, 12.5], r: 4 }], [...RR, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }, { k: 'pointOnObject', a: 5, aEnd: 'c', b: 1 }]),
];

  return cases;
})();
export const cases = [attack1, attack3b, attack4, attack5, attack6].flatMap((l) => l).map((c) => ({ feature: 'round-5 attack', what: c.id, ...c, id: 'a5-' + c.id }));
