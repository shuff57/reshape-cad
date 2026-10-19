// ROUND 4 cases, part A: the critic's reproductions, the grouped (rim / loop / list) forms, whole-shape sizes. See fc4-run.mjs.
import { mitreVolume } from './fc4-mitre.mjs';
export const CASES = [];
const add = (c) => CASES.push(c);
const PI = Math.PI;
// 40 x 30 x 10 plate (12000). front face 40 wide x 10 tall; top face 40 x 30; right face 30 x 10.
const PL = "const sk1 = sketch('top')\nsk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\n";
const E = (a, b) => `plate.edge('${a}','${b}')`;
const blend = (op, a, b, s) => `${op}(${E(a, b)}, ${s})`;
const cf = (V, faces) => ({ volume: V, faces });

// ---- A1. single-edge size cases (critic: chamfer 12 on the 10 thick plate, chamfer <= 0.002, near-radius cylinder rim)
for (const d of [5, 9, 9.99, 10, 10.001, 12, 20, 30, 35]) add({ id: `a1-plate-bevel-top-front-${d}`, group: 'a1-oversize', script: PL + blend('bevel', 'top', 'front', d), note: 'front face is 10 tall, top face 30 deep', closedForm: d < 10 ? cf(12000 - 0.5 * d * d * 40, 7) : d === 10 ? cf(12000 - 0.5 * d * d * 40, 6) : undefined, note: 'front face is 10 tall, top face 30 deep; d = 10 consumes the front face exactly (closed form, 6 faces)' });
for (const d of [5, 9.99, 10, 12]) add({ id: `a1-plate-bevel-front-right-${d}`, group: 'a1-oversize', script: PL + blend('bevel', 'front', 'right', d), note: 'vertical edge, legs 40 and 30', closedForm: d < 30 ? cf(12000 - 0.5 * d * d * 10, 7) : undefined });
for (const r of [4, 9, 9.99, 10, 10.001, 12]) add({ id: `a1-plate-round-top-front-${r}`, group: 'a1-oversize', script: PL + blend('round', 'top', 'front', r), closedForm: r < 10 ? cf(12000 - (1 - PI / 4) * r * r * 40, 7) : r === 10 ? cf(12000 - (1 - PI / 4) * r * r * 40, 6) : undefined });
for (const d of [0.001, 0.002, 0.005, 0.009, 0.01, 0.011, 0.02, 0.05]) add({ id: `a1-plate-bevel-tiny-${d}`, group: 'a1-tiny', script: PL + blend('bevel', 'top', 'front', d), closedForm: cf(12000 - 0.5 * d * d * 40, 7) });
for (const r of [0.001, 0.002, 0.005, 0.01, 0.02]) add({ id: `a1-plate-round-tiny-${r}`, group: 'a1-tiny', script: PL + blend('round', 'top', 'front', r), closedForm: cf(12000 - (1 - PI / 4) * r * r * 40, 7) });
const CYL = 'const c = cylinder(30, 20)\n'; // R15 H20
for (const d of [14, 14.5, 14.9, 14.95, 14.97, 14.99, 15]) add({ id: `a1-cyl-bevel-top-side-${d}`, group: 'a1-cyl-rim', script: CYL + `bevel(c.edge('top','side'), ${d})`, note: 'R15 H20; bbox is compared too' });
for (const r of [14, 14.9, 14.95, 14.99, 15]) add({ id: `a1-cyl-round-top-side-${r}`, group: 'a1-cyl-rim', script: CYL + `round(c.edge('top','side'), ${r})` });
for (const [d, e] of [[3, 'top'], [10, 'top']]) add({ id: `a1-cyl-bevel-${e}-side-${d}`, group: 'a1-cyl-rim', script: CYL + `bevel(c.edge('${e}','side'), ${d})` });
// second blend of the SAME edge, in every order
for (const [o1, o2] of [['round', 'round'], ['bevel', 'bevel'], ['round', 'bevel'], ['bevel', 'round']]) add({ id: `a1-same-edge-twice-${o1}-${o2}`, group: 'a1-same-edge', script: PL + `${o1}(${E('top', 'front')}, 2)\n${o2}(${E('top', 'front')}, 2)`, note: 'critic: a second round on the same edge is a silent no-op' });
add({ id: 'a1-same-edge-twice-r2-r3', group: 'a1-same-edge', script: PL + `round(${E('top', 'front')}, 2)\nround(${E('top', 'front')}, 3)` });

// ---- A2. sequential blends on touching edges (what the critic reproduced on the rig): different sizes, same sizes, mixed kinds
const MV = (a, b, style = 'fillet', styleB = style) => ({ volume: mitreVolume({ a, b, style, styleB }), faces: 8 });
for (const [a, b] of [[3, 5], [4, 5], [2, 6], [3, 3], [1, 1], [5, 3], [2, 2], [3, 4], [3, 6], [2, 3], [2, 4]]) add({ id: `a2-adj-round-${a}-${b}`, group: 'a2-adjacent', script: PL + `round(${E('top', 'front')}, ${a})\nround(${E('top', 'right')}, ${b})`, closedForm: MV(a, b), note: 'closed form = the literal mitre (fc4-mitre.mjs)' });
for (const [a, b] of [[3, 5], [2, 2], [4, 1]]) add({ id: `a2-adj-vert-round-${a}-${b}`, group: 'a2-adjacent', script: PL + `round(${E('top', 'front')}, ${a})\nround(${E('front', 'right')}, ${b})` });
for (const [a, b] of [[3, 5], [2, 2], [3, 1], [4, 6]]) add({ id: `a2-adj-bevel-${a}-${b}`, group: 'a2-adjacent', script: PL + `bevel(${E('top', 'front')}, ${a})\nbevel(${E('top', 'right')}, ${b})`, closedForm: MV(a, b, 'chamfer') });
for (const [o1, o2, a, b] of [['round', 'bevel', 2, 2], ['bevel', 'round', 3, 2], ['bevel', 'round', 2, 3], ['round', 'bevel', 3, 1]]) add({ id: `a2-adj-${o1}-then-${o2}-${a}-${b}`, group: 'a2-adjacent', script: PL + `${o1}(${E('top', 'front')}, ${a})\n${o2}(${E('top', 'right')}, ${b})`, closedForm: MV(a, b, o1 === 'round' ? 'fillet' : 'chamfer', o2 === 'round' ? 'fillet' : 'chamfer') });

// ---- A3. grouped forms: loops, lists, corners
const TOP4 = [['top', 'front'], ['top', 'right'], ['top', 'back'], ['top', 'left']];
const BOT4 = [['bottom', 'front'], ['bottom', 'right'], ['bottom', 'back'], ['bottom', 'left']];
const VERT4 = [['front', 'left'], ['front', 'right'], ['back', 'left'], ['back', 'right']];
const lines = (op, es, s) => es.map(([a, b]) => `${op}(${E(a, b)}, ${s})`).join('\n');
const list = (op, es, s) => `${op}([${es.map(([a, b]) => E(a, b)).join(', ')}], ${s})`;
for (const r of [1, 3, 5, 9, 9.99, 10, 12, 14.9, 15, 16]) add({ id: `a3-top4-round-${r}`, group: 'a3-loop', script: PL + lines('round', TOP4, r), note: 'four lines' });
for (const d of [1, 3, 9.99, 10, 12, 14.9, 15, 16]) add({ id: `a3-top4-bevel-${d}`, group: 'a3-loop', script: PL + lines('bevel', TOP4, d) });
add({ id: 'a3-top4-round-3-as-list', group: 'a3-loop', script: PL + list('round', TOP4, 3), note: 'round([e1,e2,e3,e4], 3)' });
add({ id: 'a3-top4-bevel-3-as-list', group: 'a3-loop', script: PL + list('bevel', TOP4, 3) });
add({ id: 'a3-vert4-round-3', group: 'a3-loop', script: PL + lines('round', VERT4, 3) });
add({ id: 'a3-vert4-round-14', group: 'a3-loop', script: PL + lines('round', VERT4, 14), note: 'two verticals 30 apart on a 40 wide front: 2*14 < 30' });
add({ id: 'a3-vert4-bevel-16', group: 'a3-loop', script: PL + lines('bevel', VERT4, 16) });
add({ id: 'a3-bot4-round-3', group: 'a3-loop', script: PL + lines('round', BOT4, 3) });
add({ id: 'a3-top4bot4-round-2', group: 'a3-loop', script: PL + lines('round', [...TOP4, ...BOT4], 2) });
add({ id: 'a3-top4bot4-round-4.9', group: 'a3-loop', script: PL + lines('round', [...TOP4, ...BOT4], 4.9), note: 'walls are 10 tall: 2*4.9 < 10' });
add({ id: 'a3-top4bot4-round-5', group: 'a3-loop', script: PL + lines('round', [...TOP4, ...BOT4], 5) });
add({ id: 'a3-top4bot4-bevel-4.9', group: 'a3-loop', script: PL + lines('bevel', [...TOP4, ...BOT4], 4.9) });
add({ id: 'a3-top4bot4-bevel-5', group: 'a3-loop', script: PL + lines('bevel', [...TOP4, ...BOT4], 5) });
const ALL12 = [...TOP4, ...BOT4, ...VERT4];
for (const r of [1, 2, 4]) add({ id: `a3-all12-round-${r}`, group: 'a3-all12', script: PL + lines('round', ALL12, r) });
for (const d of [1, 2, 4]) add({ id: `a3-all12-bevel-${d}`, group: 'a3-all12', script: PL + lines('bevel', ALL12, d), note: 'chamfer corner convention: OCCT adds corner triangles' });
for (const r of [1, 2, 3, 5, 8]) add({ id: `a3-adj2-round-${r}`, group: 'a3-corner', script: PL + lines('round', [['top', 'front'], ['top', 'right']], r), closedForm: MV(r, r), note: r === 2 ? 'critic: numeric integral of the mitre 11940.678' : undefined });
for (const d of [1, 3, 5]) add({ id: `a3-adj2-bevel-${d}`, group: 'a3-corner', script: PL + lines('bevel', [['top', 'front'], ['top', 'right']], d), closedForm: MV(d, d, 'chamfer') });
add({ id: 'a3-adj2-round-3-as-list', group: 'a3-corner', script: PL + list('round', [['top', 'front'], ['top', 'right']], 3) });
add({ id: 'a3-adj2-vert-round-3', group: 'a3-corner', script: PL + lines('round', [['top', 'front'], ['front', 'right']], 3) });
add({ id: 'a3-corner3-round-2', group: 'a3-corner', script: PL + lines('round', [['top', 'front'], ['top', 'right'], ['front', 'right']], 2) });
add({ id: 'a3-corner3-bevel-2', group: 'a3-corner', script: PL + lines('bevel', [['top', 'front'], ['top', 'right'], ['front', 'right']], 2) });
add({ id: 'a3-corner3-round-4', group: 'a3-corner', script: PL + lines('round', [['top', 'front'], ['top', 'right'], ['front', 'right']], 4) });
add({ id: 'a3-parallel2-round-3', group: 'a3-corner', script: PL + lines('round', [['top', 'front'], ['top', 'back']], 3) });
add({ id: 'a3-parallel2-bevel-14.9', group: 'a3-corner', script: PL + lines('bevel', [['top', 'front'], ['top', 'back']], 14.9) });
add({ id: 'a3-parallel2-bevel-15', group: 'a3-corner', script: PL + lines('bevel', [['top', 'front'], ['top', 'back']], 15) });
add({ id: 'a3-parallel2-bevel-16', group: 'a3-corner', script: PL + lines('bevel', [['top', 'front'], ['top', 'back']], 16), note: 'sum 32 > 30 deep top: OCCT refuses' });
add({ id: 'a3-parallel2-round-15', group: 'a3-corner', script: PL + lines('round', [['top', 'front'], ['top', 'back']], 15) });
add({ id: 'a3-two-disjoint-round-3', group: 'a3-corner', script: PL + lines('round', [['top', 'front'], ['bottom', 'back']], 3), note: 'two edges that do not touch stay two calls' });
// mixed: loop of 4 with a different size on the last one -> not one group
add({ id: 'a3-top3-then-other-size', group: 'a3-corner', script: PL + lines('round', TOP4.slice(0, 3), 3) + `\nround(${E('top', 'left')}, 2)` });

// ---- A4. pocket rims (round(part.rim(sk), r)) -- FreeCAD fillet-after-pocket is the saved reference
const FCB = (r, op = 'round') => `${PL}const sk2 = sketch('top', 10)\nsk2.rect(10, 10, { at: [20, 15] })\nconst part = pocket(sk2, plate, 4)\n${op}(part.rim(sk2), ${r})`;
add({ id: 'a4-fcb-rim-round-1', group: 'a4-rim', script: FCB(1), fc: { volume: 11591.03244517401, faces: 15, src: 'docs/replica/freecad/gauntlet/baseline/ref-fillet-after-pocket.json' }, note: '40x30x10 plate, 10x10 pocket 4 deep, rim r1' });
for (const r of [0.5, 2, 3.9, 4, 4.5]) add({ id: `a4-fcb-rim-round-${r}`, group: 'a4-rim', script: FCB(r), note: 'pocket depth 4, pocket 10 wide: r >= depth, 2r < 10' });
for (const d of [1, 2, 3.9, 4, 5]) add({ id: `a4-fcb-rim-bevel-${d}`, group: 'a4-rim', script: FCB(d, 'bevel') });
add({ id: 'a4-fcb-rim-round-4.9', group: 'a4-rim', script: FCB(4.9), note: 'sum of opposite blends 9.8 < 10 wide but r > depth 4' });
const PL60 = 'const plate = cuboid(60,40,12)\nconst sk2 = sketch(\'top\', 6)\n';
const rimOf = (geo, depth, r, op = 'round') => `${PL60}${geo}\nconst part = pocket(sk2, plate, ${depth})\n${op}(part.rim(sk2), ${r})`;
const RECT = 'sk2.rect(20,10,{at:[0,0]})';
for (const r of [0.5, 1, 2.5, 3.9, 4, 4.9, 5, 6]) add({ id: `a4-rect20x10-rim-round-${r}`, group: 'a4-rim', script: rimOf(RECT, 4, r) });
for (const d of [1, 3, 4, 4.9, 5, 6]) add({ id: `a4-rect20x10-rim-bevel-${d}`, group: 'a4-rim', script: rimOf(RECT, 4, d, 'bevel') });
const HEX = 'sk2.polygon([[10,0],[5,8.66],[-5,8.66],[-10,0],[-5,-8.66],[5,-8.66]])';
const TRI = 'sk2.polygon([[-10,-8],[10,-8],[0,10]])';
const LSH = 'sk2.polygon([[0,0],[16,0],[16,6],[6,6],[6,14],[0,14]])';
for (const [n, g] of [['hex', HEX], ['tri', TRI], ['L', LSH]]) for (const [op, s] of [['round', 1], ['bevel', 1], ['round', 3], ['bevel', 3]]) add({ id: `a4-${n}-rim-${op}-${s}`, group: 'a4-rim', script: rimOf(g, 4, s, op) });
add({ id: 'a4-through-rect-rim-round-1', group: 'a4-rim', script: rimOf(RECT, 12, 1) });
add({ id: 'a4-rect-rim-round-1-deep6', group: 'a4-rim', script: rimOf(RECT, 6, 1) });
add({ id: 'a4-circle-rim-round-1', group: 'a4-rim', script: rimOf('sk2.circle(20,{at:[0,0]})', 4, 1), note: 'circular pocket rim (swept name over a circle is not resolved by the pane)' });
add({ id: 'a4-two-pockets-rim', group: 'a4-rim', script: `${PL60}sk2.rect(10,10,{at:[-15,0]})\nconst p1 = pocket(sk2, plate, 4)\nconst sk3 = sketch('top', 6)\nsk3.rect(10,10,{at:[15,0]})\nconst p2 = pocket(sk3, p1, 4)\nround(p2.rim(sk3), 1)` });
add({ id: 'a4-rim-both-pockets', group: 'a4-rim', script: `${PL60}sk2.rect(10,10,{at:[-15,0]})\nconst p1 = pocket(sk2, plate, 4)\nround(p1.rim(sk2), 1)\nconst sk3 = sketch('top', 6)\nsk3.rect(10,10,{at:[15,0]})\nconst p2 = pocket(sk3, p1, 4)\nround(p2.rim(sk3), 1)`, note: 'two separate rims, the second after the first round' });
add({ id: 'a4-rim-then-other-size-edge', group: 'a4-rim', script: FCB(1) + `\nround(plate.edge('top','front'), 2)` });
add({ id: 'a4-rim-of-pocket-edge-near', group: 'a4-rim', script: `${PL}const sk2 = sketch('top', 10)\nsk2.rect(10, 10, { at: [8, 15] })\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 1)`, note: 'pocket 3 mm from the left edge, r1' });
add({ id: 'a4-rim-near-edge-r3', group: 'a4-rim', script: `${PL}const sk2 = sketch('top', 10)\nsk2.rect(10, 10, { at: [8, 15] })\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 3)` });

// ---- A5. whole-shape round sizes (box and cylinder), doc-level oracle
const W = (shape, s) => `const s = ${shape}\nround(s, ${s})`;
for (const s of [-2, -0.001, 0, 1e-7, 1e-6, 1e-5, 1e-4, 0.001, 0.005, 0.009, 0.01, 0.05, 1, 9.99, 10, 10.01]) add({ id: `a5-box-whole-${s}`, group: 'a5-whole', whole: true, script: W('cuboid(40,30,20)', s) });
for (const s of [-2, 0, 1e-6, 0.001, 0.009, 0.01, 1, 9.99, 10, 10.01, 15]) add({ id: `a5-cyl-whole-${s}`, group: 'a5-whole', whole: true, script: W('cylinder(30,20)', s) });
// primitive corner option
for (const s of [0.001, 0.009, 0.5, 9.99]) add({ id: `a5-box-corner-${s}`, group: 'a5-whole', whole: true, script: `const s = cuboid(40,30,20,{corner:${s}})` });
// ModelDoc-only roundStyle chamfer (script text cannot set it)
const BOXDOC = (round, style) => [{ id: 'box1', kind: 'box', size: [40, 30, 20], center: [0, 0, 0], round, roundStyle: style }];
for (const d of [0.001, 0.5, 2, 4, 9.99, 10, 12]) add({ id: `a5-box-doc-chamfer-${d}`, group: 'a5-whole', whole: true, doc: BOXDOC(d, 'chamfer'), note: 'ModelDoc only: roundStyle chamfer on a box' });
const CYLDOC = (round, style) => [{ id: 'cyl1', kind: 'cylinder', radius: 15, height: 20, center: [0, 0, 0], round, roundStyle: style }];
for (const d of [2, 9.99, 10, 12]) add({ id: `a5-cyl-doc-chamfer-${d}`, group: 'a5-whole', whole: true, doc: CYLDOC(d, 'chamfer') });
