// More probes: precision/scale, datum follow-through with param, arc radius param WITH a radius rule, invalid arc rows.
const H = 10;
const P = Math.PI;
const N200 = Array.from({ length: 200 }, (_, i) => [50 * Math.cos((2 * P * i) / 200), 50 * Math.sin((2 * P * i) / 200)]);
const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; };
// minor circular segment, radius r, chord c
const segMinor = (r, c) => { const th = 2 * Math.asin(c / (2 * r)); return (r * r / 2) * (th - Math.sin(th)); };
export const cases = [
  { id: 'poly-200gon', feature: '.polygon', what: '200-vertex polygon (circle approximation)', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(N200)}); extrude(sk, 10)`, exact: { volume: polyArea(N200) * H } },
  { id: 'rect-micro', feature: '.rect', what: 'rect 0.002 x 0.002', script: "const sk = sketch('top'); sk.rect(0.002, 0.002); extrude(sk, 10)", exact: { volume: 0.002 * 0.002 * H } },
  { id: 'rect-nano', feature: '.rect', what: 'rect 1e-5 x 1e-5', script: "const sk = sketch('top'); sk.rect(0.00001, 0.00001); extrude(sk, 10)", exact: { volume: 1e-10 * H } },
  { id: 'rect-far-offset', feature: 'sketch(plane)', what: 'top plane offset 1e5, rect 30 x 20', script: "const sk = sketch('top', 100000); sk.rect(30, 20); extrude(sk, 10)", exact: { volume: 6000, bbox: [-15, -10, 100000, 15, 10, 100010] } },
  { id: 'rect-far-in-plane', feature: '.rect', what: 'rect 30 x 20 centred at (50000, -80000)', script: "const sk = sketch('top'); sk.rect(30, 20, { at: [50000, -80000] }); extrude(sk, 10)", exact: { volume: 6000, bbox: [49985, -80010, 0, 50015, -79990, 10] } },
  { id: 'circle-micro', feature: '.circle', what: 'circle across 0.002', script: "const sk = sketch('top'); sk.circle(0.002); extrude(sk, 10)", exact: { volume: P * 1e-6 * H }, curved: true },
  { id: 'slot-short', feature: '.slot', what: 'slot centres 0.001 apart, r5 (almost a disc)', script: "const sk = sketch('top'); sk.slot([0,0],[0.001,0],5); extrude(sk, 10)", exact: { volume: (2 * 5 * 0.001 + P * 25) * H }, curved: true },
  // datum follows? plane('top', param) then slider moves the datum
  { id: 'datum-param-follow', feature: 'plane(datum)', what: 'plane offset from param(); slider 5 -> 12 must move the sketch on it', script: "const o = param('o', 5); const p = plane('top', o); const sk = sketch(p); sk.rect(30, 20); extrude(sk, 10)", values: { pl1_offset: 12 }, exact: { volume: 6000, bbox: [-15, -10, 12, 15, 10, 22] } },
  { id: 'sketch-offset-param', feature: 'sketch(plane)', what: 'sketch offset from param(); slider 5 -> 12', script: "const o = param('o', 5); const sk = sketch('top', o); sk.rect(30, 20); extrude(sk, 10)", values: { sk1_offset: 12 }, exact: { volume: 6000, bbox: [-15, -10, 12, 15, 10, 22] } },
  // arc radius param WITH a radius rule: locks pin the chord, the rule value (param) sets r
  {
    id: 'param-values-arc-rule', feature: 'param circle/arc radius', what: 'D shape, chord (0,-10)-(0,10) locked, radius RULE from param (r0=sqrt(109), slider -> 12); start centre (-3,0)', curved: true,
    script: "const r = param('r', Math.sqrt(109)); const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,-10],b:[0,10]},{k:'arc',id:2,c:[-3,0],r:Math.sqrt(109),a:[0,10],b:[0,-10],sense:'cw'}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'},{k:'radius',a:2,value:r},{k:'lock',a:1,aEnd:'a'},{k:'lock',a:1,aEnd:'b'}]); extrude(sk, 10)",
    values: { 'sk1_rule2-value': 12 }, exact: { volume: segMinor(12, 20) * H },
  },
  {
    id: 'param-arc-rule-default', feature: 'param circle/arc radius', what: 'same sketch at the script default r = sqrt(109)', curved: true,
    script: "const r = param('r', Math.sqrt(109)); const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,-10],b:[0,10]},{k:'arc',id:2,c:[-3,0],r:Math.sqrt(109),a:[0,10],b:[0,-10],sense:'cw'}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'},{k:'radius',a:2,value:r},{k:'lock',a:1,aEnd:'a'},{k:'lock',a:1,aEnd:'b'}]); extrude(sk, 10)",
    exact: { volume: segMinor(Math.sqrt(109), 20) * H },
  },
  // invalid arc rows the script layer lets through
  { id: 'geom-arc-off-circle-b', feature: '.geom', what: 'arc row whose end b is 12 from the centre (r 10), closed by a line', script: "const sk = sketch('top'); sk.geom([{k:'arc',id:1,c:[0,0],r:10,a:[10,0],b:[0,12],sense:'ccw'},{k:'line',id:2,a:[0,12],b:[10,0]}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)" },
  { id: 'geom-arc-r-mismatch', feature: '.geom', what: 'arc row r=7 but both ends 10 from the centre', script: "const sk = sketch('top'); sk.geom([{k:'arc',id:1,c:[0,0],r:7,a:[10,0],b:[0,10],sense:'ccw'},{k:'line',id:2,a:[0,10],b:[10,0]}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)" },
  { id: 'geom-no-rules-gap', feature: '.geom', what: 'rect rows, a 0.01 gap between line 3 and 4, no rules', script: "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[20,0]},{k:'line',id:2,a:[20,0],b:[20,10]},{k:'line',id:3,a:[20,10],b:[0,10]},{k:'line',id:4,a:[0,9.99],b:[0,0]}]); extrude(sk, 10)" },
  { id: 'geom-no-rules-tiny-gap', feature: '.geom', what: 'rect rows, a 1e-7 gap, no rules', script: "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[20,0]},{k:'line',id:2,a:[20,0],b:[20,10]},{k:'line',id:3,a:[20,10],b:[0,10]},{k:'line',id:4,a:[0,9.9999999],b:[0,0]}]); extrude(sk, 10)", exact: { volume: 2000 } },
  { id: 'geom-T-junction', feature: '.geom', what: 'line 4 ends on the MIDDLE of line 1 (T junction), no vertex: open loop', script: "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[20,0]},{k:'line',id:2,a:[20,0],b:[20,10]},{k:'line',id:3,a:[20,10],b:[10,10]},{k:'line',id:4,a:[10,10],b:[10,0]}]); extrude(sk, 10)" },
  { id: 'geom-cross-lines', feature: '.geom', what: 'closed loop whose lines cross (bowtie as rows)', script: "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[10,10]},{k:'line',id:2,a:[10,10],b:[10,0]},{k:'line',id:3,a:[10,0],b:[0,10]},{k:'line',id:4,a:[0,10],b:[0,0]}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'},{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'},{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)" },
];
