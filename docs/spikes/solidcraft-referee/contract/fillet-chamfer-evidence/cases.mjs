const PI = Math.PI;
const BOXD = [40, 30, 12];
const BOXAT = '{at:[15,-7,3]}';
const AX = { top: 2, bottom: 2, front: 1, back: 1, left: 0, right: 0 };
const edgeLen = (a, b, d = BOXD) => d[3 - AX[a] - AX[b]];
const boxFillet = (a, b, r, d = BOXD) => d[0] * d[1] * d[2] - (1 - PI / 4) * r * r * edgeLen(a, b, d);
const boxChamfer = (a, b, s, d = BOXD) => d[0] * d[1] * d[2] - 0.5 * s * s * edgeLen(a, b, d);
const rbox = (L, W, H, r) => (L - 2 * r) * (W - 2 * r) * (H - 2 * r) + 2 * r * ((L - 2 * r) * (W - 2 * r) + (L - 2 * r) * (H - 2 * r) + (W - 2 * r) * (H - 2 * r)) + PI * r * r * ((L - 2 * r) + (W - 2 * r) + (H - 2 * r)) + 4 / 3 * PI * r ** 3;
// one rim of a cylinder radius R filleted r (Pappus), chamfered d
const rimFillet = (R, r) => 2 * PI * (r * r * (R - r / 2) - (PI * r * r / 4) * (R - r + 4 * r / (3 * PI)));
const rimChamfer = (R, d) => 2 * PI * (d * d / 2) * (R - d / 3);
const cylV = (R, H) => PI * R * R * H;

// numeric helpers for independent closed forms
const lF = (r, w) => (w >= r ? 0 : r - Math.sqrt(Math.max(0, r * r - (r - w) * (r - w))));
const integ = (f, a, b, n = 200000) => { const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2); return s * h / 3; };
const Af = (r) => (1 - PI / 4) * r * r;
const V0 = BOXD[0] * BOXD[1] * BOXD[2];
// two fillets on adjacent top edges (lengths 40 front, 30 right), third edge sharp: box minus union of the two removal prisms
const mitre2 = (r1, r2) => V0 - Af(r1) * 40 - Af(r2) * 30 + integ((w) => lF(r1, w) * lF(r2, w), 0, Math.min(r1, r2));
const mitreFC = (r, d) => V0 - Af(r) * 40 - 0.5 * d * d * 30 + integ((w) => lF(r, w) * Math.max(0, d - w), 0, Math.min(r, d));
// three equal fillets at one vertex (spherical patch): V0 - sum(A*L) + r^3 (2 - 7 pi / 12)
const corner3 = (r) => V0 - Af(r) * (40 + 30 + 12) + r ** 3 * (2 - 7 * PI / 12);
// chamfer leg d on a 12-high face: removal = int_0^min(12,d) (d - w) dw * 40
const chamferClipped = (d) => V0 - integ((w) => d - w, 0, Math.min(12, d), 2000) * 40;
export const CASES = [];
const add = (c) => CASES.push(c);

// ---- R1 whole-shape round on box / cylinder --------------------------------------------------------------------------
add({ id: 'w-box-r4', row: 'whole', script: `const b = cuboid(40,40,20)\nround(b, 4)`, closed: () => rbox(40, 40, 20, 4) });
add({ id: 'w-box-offc-r2.5', row: 'whole', script: `const b = cuboid(40,30,12,${BOXAT})\nround(b, 2.5)`, closed: () => rbox(40, 30, 12, 2.5) });
add({ id: 'w-box-r5.9', row: 'whole', script: `const b = cuboid(40,30,12)\nround(b, 5.9)`, closed: () => rbox(40, 30, 12, 5.9) });
add({ id: 'w-box-r6-half', row: 'whole', script: `const b = cuboid(40,30,12)\nround(b, 6)` });
add({ id: 'w-box-r8-toobig', row: 'whole', script: `const b = cuboid(40,30,12)\nround(b, 8)` });
add({ id: 'w-box-r0.05', row: 'whole', script: `const b = cuboid(40,30,12)\nround(b, 0.05)`, closed: () => rbox(40, 30, 12, 0.05) });
add({ id: 'w-cyl-r3', row: 'whole', script: `const c = cylinder(24,30)\nround(c, 3)`, closed: () => cylV(12, 30) - 2 * rimFillet(12, 3) });
add({ id: 'w-cyl-offc-r3', row: 'whole', script: `const c = cylinder(24,30,{at:[5,3,2]})\nround(c, 3)`, closed: () => cylV(12, 30) - 2 * rimFillet(12, 3) });
add({ id: 'w-cyl-r11', row: 'whole', script: `const c = cylinder(24,30)\nround(c, 11)`, closed: () => cylV(12, 30) - 2 * rimFillet(12, 11) });
add({ id: 'w-cyl-r12-eqR', row: 'whole', script: `const c = cylinder(24,30)\nround(c, 12)` });
add({ id: 'w-cyl-r13-gtR', row: 'whole', script: `const c = cylinder(24,30)\nround(c, 13)` });
add({ id: 'w-cyl-r16-gtHalfH', row: 'whole', script: `const c = cylinder(60,30)\nround(c, 16)` });
add({ id: 'w-cyl-r0.05', row: 'whole', script: `const c = cylinder(24,30)\nround(c, 0.05)`, closed: () => cylV(12, 30) - 2 * rimFillet(12, 0.05) });
add({ id: 'w-box-then-turn', row: 'whole', script: `const b = cuboid(40,30,12,${BOXAT})\nround(b, 2.5)\nturn(b, [0,0,30])` });
add({ id: 'w-box-then-turn-x', row: 'whole', script: `const b = cuboid(40,30,12)\nround(b, 2.5)\nturn(b, [45,0,0])` });
add({ id: 'w-box-then-hole', row: 'whole', script: `const b = cuboid(40,40,20)\nround(b, 4)\nhole(b, {across: 8})` });
add({ id: 'w-box-then-subtract', row: 'whole', script: `const b = cuboid(40,40,20)\nround(b, 4)\nconst c = cylinder(10,40,{at:[0,0,0]})\nsubtract(b, c)` });
add({ id: 'w-box-then-join', row: 'whole', script: `const b = cuboid(40,40,20)\nround(b, 4)\nconst c = cylinder(10,40,{at:[0,0,0]})\njoin(b, c)` });
add({ id: 'w-cyl-then-subtract', row: 'whole', script: `const c = cylinder(24,30)\nround(c, 3)\nconst k = cuboid(10,10,40,{at:[0,0,0]})\nsubtract(c, k)` });

// ---- whole-shape round on other shapes (interpreter sentences) ---------------------------------------------------------
add({ id: 'wx-sphere', row: 'wholeOther', script: `const s = sphere(20)\nround(s, 2)` });
add({ id: 'wx-ring', row: 'wholeOther', script: `const s = ring(30, 8)\nround(s, 2)` });
add({ id: 'wx-cone', row: 'wholeOther', script: `const s = cone(20, 30)\nround(s, 2)` });
add({ id: 'wx-prism', row: 'wholeOther', script: `const s = prism(6, 20, 10)\nround(s, 2)` });
add({ id: 'wx-wedge', row: 'wholeOther', script: `const s = wedge(20, 10, 10)\nround(s, 2)` });
add({ id: 'wx-pull', row: 'wholeOther', script: `const sk = sketch('top')\nsk.rect(20,10)\nconst p = pull(sk, 8)\nround(p, 1)` });
add({ id: 'wx-spin', row: 'wholeOther', script: `const sk = sketch('front')\nsk.rect(10,20,{at:[20,0]})\nconst p = spin(sk, 360)\nround(p, 1)` });
add({ id: 'wx-subtract', row: 'wholeOther', script: `const b = cuboid(40,40,20)\nconst c = cylinder(10,40,{at:[0,0,0]})\nconst d = subtract(b,c)\nround(d, 2)` });
add({ id: 'wx-union', row: 'wholeOther', script: `const b = cuboid(40,40,20)\nconst c = cylinder(10,40,{at:[0,0,0]})\nconst d = join(b,c)\nround(d, 2)` });
add({ id: 'wx-intersect', row: 'wholeOther', script: `const b = cuboid(40,40,20)\nconst c = cylinder(30,40,{at:[0,0,0]})\nconst d = keep(b,c)\nround(d, 2)` });
add({ id: 'wx-hole', row: 'wholeOther', script: `const b = cuboid(40,40,20)\nhole(b,{across:8})\nround(b, 2)` });
add({ id: 'wx-hollow', row: 'wholeOther', script: `const b = cuboid(40,40,20)\nhollow(b,{wall:2})\nround(b, 2)` });
add({ id: 'wx-move', row: 'wholeOther', script: `const b = cuboid(40,40,20)\nmove(b,[5,0,0])\nround(b, 2)` });
add({ id: 'wx-mirror', row: 'wholeOther', script: `const b = cuboid(40,40,20,{at:[30,0,0]})\nmirror(b,{plane:'yz'})\nround(b, 2)` });
add({ id: 'wx-repeat', row: 'wholeOther', script: `const b = cuboid(10,10,10)\nrepeat(b,{count:3,step:[20,0,0]})\nround(b, 1)` });
add({ id: 'wx-circle-sketch', row: 'wholeOther', script: `const sk = sketch('top')\nsk.circle(20)\nround(sk, 1)` });
add({ id: 'wx-rect-sketch', row: 'wholeOther', script: `const sk = sketch('top')\nsk.rect(20,10)\nround(sk, 1)` });

// ---- R2/R5 round a named box edge: all 12 edges, both argument orders --------------------------------------------------
const PAIRS = [['top','front'],['top','back'],['top','left'],['top','right'],['bottom','front'],['bottom','back'],['bottom','left'],['bottom','right'],['front','left'],['front','right'],['back','left'],['back','right']];
for (const [a, b] of PAIRS) {
  add({ id: `e-fillet-${a}-${b}-r2`, row: 'edgeRound', control: true, script: `const b = cuboid(40,30,12,${BOXAT})\nround(b.edge('${a}','${b}'), 2)`, closed: () => boxFillet(a, b, 2) });
}
for (const [a, b] of PAIRS) {
  add({ id: `e-bevel-${a}-${b}-d2`, row: 'edgeBevel', control: true, script: `const b = cuboid(40,30,12,${BOXAT})\nbevel(b.edge('${a}','${b}'), 2)`, closed: () => boxChamfer(a, b, 2) });
}
add({ id: 'e-fillet-swapped-front-top', row: 'edgeArgs', control: true, script: `const b = cuboid(40,30,12,${BOXAT})\nround(b.edge('front','top'), 2)`, closed: () => boxFillet('top', 'front', 2) });
add({ id: 'e-fillet-swapped-right-back', row: 'edgeArgs', control: true, script: `const b = cuboid(40,30,12,${BOXAT})\nround(b.edge('right','back'), 2)`, closed: () => boxFillet('back', 'right', 2) });
add({ id: 'e-alias-fillet-chamfer', row: 'edgeArgs', script: `const b = cuboid(40,30,12,${BOXAT})\nfillet(b.edge('top','front'), 2)\nchamfer(b.edge('top','left'), 2)`, closed: () => mitreFC(2, 2) });
for (const r of [0.5, 3, 5.9, 11, 12, 13]) {
  add({ id: `e-fillet-top-front-r${r}`, row: 'edgeRoundSize', control: r <= 11, script: `const b = cuboid(40,30,12,${BOXAT})\nround(b.edge('top','front'), ${r})`, closed: r <= 12 ? () => boxFillet('top', 'front', r) : undefined });
}
for (const r of [0.5, 5, 11, 12, 13]) {
  add({ id: `e-bevel-top-front-d${r}`, row: 'edgeBevelSize', script: `const b = cuboid(40,30,12,${BOXAT})\nbevel(b.edge('top','front'), ${r})`, closed: () => chamferClipped(r) });
}
// edge between faces that share no edge
add({ id: 'e-opposite-top-bottom', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nround(b.edge('top','bottom'), 2)` });
add({ id: 'e-opposite-left-right-bevel', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nbevel(b.edge('left','right'), 2)` });
add({ id: 'e-same-face', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nround(b.edge('top','top'), 2)` });
add({ id: 'e-side-on-box', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nround(b.edge('top','side'), 2)` });
add({ id: 'e-front-on-cyl', row: 'edgeArgs', script: `const c = cylinder(24,30)\nround(c.edge('top','front'), 2)` });
add({ id: 'e-bad-word', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nround(b.edge('top','lid'), 2)` });
add({ id: 'e-neg-size', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), -2)` });
add({ id: 'e-zero-size', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), 0)` });
add({ id: 'e-bevel-zero', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nbevel(b.edge('top','front'), 0)` });
add({ id: 'e-bevel-neg', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nbevel(b.edge('top','front'), -1)` });
add({ id: 'e-extra-arg', row: 'edgeArgs', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), 2, 3)` });

// ---- cylinder rims --------------------------------------------------------------------------------------------------
const CYL = `const c = cylinder(24,30,{at:[5,3,2]})`;
for (const [a, b] of [['top', 'side'], ['bottom', 'side'], ['side', 'top'], ['side', 'bottom']]) {
  add({ id: `c-fillet-${a}-${b}-r3`, row: 'cylEdge', control: true, script: `${CYL}\nround(c.edge('${a}','${b}'), 3)`, closed: () => cylV(12, 30) - rimFillet(12, 3) });
  add({ id: `c-bevel-${a}-${b}-d3`, row: 'cylBevel', control: true, script: `${CYL}\nbevel(c.edge('${a}','${b}'), 3)`, closed: () => cylV(12, 30) - rimChamfer(12, 3) });
}
for (const r of [0.5, 11, 12, 13, 16]) {
  add({ id: `c-fillet-top-side-r${r}`, row: 'cylEdgeSize', script: `${CYL}\nround(c.edge('top','side'), ${r})`, closed: r <= 12 ? () => cylV(12, 30) - rimFillet(12, r) : undefined });
}
for (const r of [11, 12, 13, 31]) {
  add({ id: `c-bevel-top-side-d${r}`, row: 'cylBevelSize', script: `${CYL}\nbevel(c.edge('top','side'), ${r})`, closed: r < 12 ? () => cylV(12, 30) - rimChamfer(12, r) : undefined });
}
add({ id: 'c-fillet-top-and-bottom', row: 'cylEdge', script: `${CYL}\nround(c.edge('top','side'), 3)\nround(c.edge('bottom','side'), 3)`, closed: () => cylV(12, 30) - 2 * rimFillet(12, 3) });
add({ id: 'c-fillet-top-bevel-bottom', row: 'cylEdge', script: `${CYL}\nround(c.edge('top','side'), 3)\nbevel(c.edge('bottom','side'), 2)`, closed: () => cylV(12, 30) - rimFillet(12, 3) - rimChamfer(12, 2) });
add({ id: 'c-top-bottom-edge', row: 'cylEdge', script: `${CYL}\nround(c.edge('top','bottom'), 2)` });
add({ id: 'c-fillet-same-twice', row: 'cylEdge', script: `${CYL}\nround(c.edge('top','side'), 3)\nround(c.edge('top','side'), 1)` });
add({ id: 'c-rim-then-hole', row: 'cylEdge', script: `${CYL}\nround(c.edge('top','side'), 3)\nhole(c,{across:6})` });
// ---- chains of edges on one box ---------------------------------------------------------------------------------------
const B = `const b = cuboid(40,30,12,${BOXAT})`;
add({ id: 'ch-fillet-2adj-share-corner', row: 'chain', script: `${B}\nround(b.edge('top','front'), 2)\nround(b.edge('top','right'), 2)`, closed: () => mitre2(2, 2) });
add({ id: 'ch-fillet-2adj-diffR', row: 'chain', script: `${B}\nround(b.edge('top','front'), 2)\nround(b.edge('top','right'), 3)`, closed: () => mitre2(2, 3) });
add({ id: 'ch-fillet-2adj-reverse-bigfirst', row: 'chain', script: `${B}\nround(b.edge('top','front'), 3)\nround(b.edge('top','right'), 2)`, closed: () => mitre2(3, 2) });
add({ id: 'ch-fillet-3corner', row: 'chain', script: `${B}\nround(b.edge('top','front'), 2)\nround(b.edge('top','right'), 2)\nround(b.edge('front','right'), 2)`, closed: () => corner3(2) });
add({ id: 'ch-fillet-top-loop4', row: 'chain', script: `${B}\nround(b.edge('top','front'), 2)\nround(b.edge('top','right'), 2)\nround(b.edge('top','back'), 2)\nround(b.edge('top','left'), 2)` });
add({ id: 'ch-fillet-vertical4', row: 'chain', script: `${B}\nround(b.edge('front','left'), 2)\nround(b.edge('front','right'), 2)\nround(b.edge('back','left'), 2)\nround(b.edge('back','right'), 2)` });
add({ id: 'ch-fillet-parallel2', row: 'chain', script: `${B}\nround(b.edge('top','front'), 2)\nround(b.edge('bottom','back'), 2)`, closed: () => BOXD[0]*BOXD[1]*BOXD[2] - 2 * (1 - PI/4) * 4 * 40 });
add({ id: 'ch-fillet-all12-sequential', row: 'chain', script: `${B}\n` + PAIRS.map(([a, c]) => `round(b.edge('${a}','${c}'), 2)`).join('\n') });
add({ id: 'ch-fillet-overlap-r11', row: 'chain', script: `${B}\nround(b.edge('top','front'), 11)\nround(b.edge('top','right'), 11)`, closed: () => mitre2(11, 11) });
add({ id: 'ch-bevel-2adj', row: 'chain', script: `${B}\nbevel(b.edge('top','front'), 2)\nbevel(b.edge('top','right'), 2)` });
add({ id: 'ch-bevel-3corner', row: 'chain', script: `${B}\nbevel(b.edge('top','front'), 2)\nbevel(b.edge('top','right'), 2)\nbevel(b.edge('front','right'), 2)` });
add({ id: 'ch-bevel-top-loop4', row: 'chain', script: `${B}\nbevel(b.edge('top','front'), 2)\nbevel(b.edge('top','right'), 2)\nbevel(b.edge('top','back'), 2)\nbevel(b.edge('top','left'), 2)` });
add({ id: 'ch-bevel-all12-sequential', row: 'chain', script: `${B}\n` + PAIRS.map(([a, c]) => `bevel(b.edge('${a}','${c}'), 2)`).join('\n') });
add({ id: 'ch-bevel-parallel2', row: 'chain', script: `${B}\nbevel(b.edge('top','front'), 2)\nbevel(b.edge('bottom','back'), 2)`, closed: () => BOXD[0]*BOXD[1]*BOXD[2] - 2 * 0.5 * 4 * 40 });
add({ id: 'ch-mixed-round-then-bevel-adj', row: 'chain', script: `${B}\nround(b.edge('top','front'), 2)\nbevel(b.edge('top','right'), 2)`, closed: () => mitreFC(2, 2) });
add({ id: 'ch-mixed-bevel-then-round-adj', row: 'chain', script: `${B}\nbevel(b.edge('top','front'), 2)\nround(b.edge('top','right'), 2)`, closed: () => V0 - 0.5 * 4 * 40 - Af(2) * 30 + integ((w) => Math.max(0, 2 - w) * lF(2, w), 0, 2) });
add({ id: 'ch-mixed-bevel-then-round-same-edge', row: 'chain', script: `${B}\nbevel(b.edge('top','front'), 2)\nround(b.edge('top','front'), 1)` });
add({ id: 'ch-fillet-same-edge-twice', row: 'chain', script: `${B}\nround(b.edge('top','front'), 2)\nround(b.edge('top','front'), 1)` });
// ---- edge after other ops -------------------------------------------------------------------------------------------
add({ id: 'o-move-then-edge', row: 'afterOps', script: `${B}\nmove(b,[10,5,0])\nround(b.edge('top','front'), 2)` });
add({ id: 'o-edge-then-move', row: 'afterOps', script: `${B}\nround(b.edge('top','front'), 2)\nmove(b,[10,5,0])` });
add({ id: 'o-turn-then-edge', row: 'afterOps', script: `${B}\nturn(b,[0,0,30])\nround(b.edge('top','front'), 2)` });
add({ id: 'o-edge-then-turn', row: 'afterOps', script: `${B}\nround(b.edge('top','front'), 2)\nturn(b,[0,0,30])` });
add({ id: 'o-edge-then-hole', row: 'afterOps', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), 2)\nhole(b,{across:6})` });
add({ id: 'o-hole-then-edge', row: 'afterOps', script: `const b = cuboid(40,30,12)\nhole(b,{across:6})\nround(b.edge('top','right'), 2)` });
add({ id: 'o-edge-then-shell', row: 'afterOps', script: `const b = cuboid(40,30,12)\nround(b.edge('top','right'), 2)\nhollow(b,{wall:2,open:'top'})` });
add({ id: 'o-shell-then-edge', row: 'afterOps', script: `const b = cuboid(40,30,12)\nhollow(b,{wall:2,open:'top'})\nround(b.edge('bottom','right'), 2)` });
add({ id: 'o-shell-open-rim-edge', row: 'afterOps', script: `const b = cuboid(40,30,12)\nhollow(b,{wall:2,open:'top'})\nround(b.edge('top','right'), 0.5)` });
add({ id: 'o-edge-then-mirror', row: 'afterOps', script: `const b = cuboid(20,30,12,{at:[20,0,0]})\nround(b.edge('top','right'), 2)\nmirror(b,{plane:'yz'})` });
add({ id: 'o-edge-then-repeat', row: 'afterOps', script: `const b = cuboid(10,10,10)\nround(b.edge('top','front'), 1)\nrepeat(b,{count:3,step:[20,0,0]})` });
// ---- pocket rim and walls ------------------------------------------------------------------------------------------
const PK = `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10,{at:[0,0]})\nconst part = pocket(sk2, plate, 4)\n`;
for (const r of [0.5, 1, 2.5, 3.9, 4, 4.5, 5, 6]) add({ id: `p-rim-fillet-r${r}`, row: 'rim', script: `${PK}round(part.rim(sk2), ${r})` });
for (const r of [0.5, 1, 3, 4, 5, 6]) add({ id: `p-rim-bevel-d${r}`, row: 'rimBevel', script: `${PK}bevel(part.rim(sk2), ${r})` });
add({ id: 'p-rim-circle-fillet', row: 'rim', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.circle(20,{at:[0,0]})\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 2)` });
add({ id: 'p-rim-circle-bevel', row: 'rimBevel', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.circle(20,{at:[0,0]})\nconst part = pocket(sk2, plate, 4)\nbevel(part.rim(sk2), 2)` });
add({ id: 'p-rim-triangle-fillet', row: 'rim', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.polygon([[-10,-8],[10,-8],[0,10]])\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 1)` });
add({ id: 'p-rim-hex-fillet', row: 'rim', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.polygon([[10,0],[5,8.66],[-5,8.66],[-10,0],[-5,-8.66],[5,-8.66]])\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 1)` });
add({ id: 'p-rim-fillet-offcentre', row: 'rim', script: `const plate = cuboid(60,40,12,{at:[7,-3,2]})\nconst sk2 = sketch('top', 8)\nsk2.rect(20,10,{at:[12,-5]})\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 1.5)` });
add({ id: 'p-rim-through-pocket', row: 'rim', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10,{at:[0,0]})\nconst part = pocket(sk2, plate, 12)\nround(part.rim(sk2), 1)` });
add({ id: 'p-rim-no-pocket', row: 'rim', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10)\nround(plate.rim(sk2), 1)` });
add({ id: 'p-rim-front-plane', row: 'rim', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('front', 0)\nsk2.rect(20,5,{at:[0,0]})\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 1)` });
add({ id: 'p-rim-empty-list', row: 'rim', script: `const plate = cuboid(60,40,12)\nround([], 1)` });
add({ id: 'p-wall1-top-fillet', row: 'wall', control: true, script: `${PK}round(part.edge('top', part.wall(sk2, 1)), 1)` });
add({ id: 'p-wall3-top-fillet', row: 'wall', control: true, script: `${PK}round(part.edge('top', part.wall(sk2, 3)), 1)` });
add({ id: 'p-wall2-top-bevel', row: 'wall', script: `${PK}bevel(part.edge('top', part.wall(sk2, 2)), 1)` });
add({ id: 'p-wall-swapped-order', row: 'wall', script: `${PK}round(part.edge(part.wall(sk2, 1), 'top'), 1)` });
add({ id: 'p-wall-wall-corner-fillet', row: 'wall', script: `${PK}round(part.edge(part.wall(sk2, 1), part.wall(sk2, 2)), 1)` });
add({ id: 'p-wall-wall-corner-bevel', row: 'wall', script: `${PK}bevel(part.edge(part.wall(sk2, 1), part.wall(sk2, 2)), 1)` });
add({ id: 'p-wall-wall-all4-corners', row: 'wall', script: `${PK}round(part.edge(part.wall(sk2, 1), part.wall(sk2, 2)), 1)\nround(part.edge(part.wall(sk2, 2), part.wall(sk2, 3)), 1)\nround(part.edge(part.wall(sk2, 3), part.wall(sk2, 4)), 1)\nround(part.edge(part.wall(sk2, 4), part.wall(sk2, 1)), 1)` });
add({ id: 'p-wall-same', row: 'wall', script: `${PK}round(part.edge(part.wall(sk2, 1), part.wall(sk2, 1)), 1)` });
add({ id: 'p-wall-bottom-through', row: 'wall', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10,{at:[0,0]})\nconst part = pocket(sk2, plate, 12)\nround(part.edge('bottom', part.wall(sk2, 1)), 1)` });
add({ id: 'p-wall-front-nonadjacent', row: 'wall', script: `${PK}round(part.edge('front', part.wall(sk2, 1)), 1)` });
add({ id: 'p-wall-bad-n', row: 'wall', script: `${PK}round(part.edge('top', part.wall(sk2, 9)), 1)` });
add({ id: 'p-wall-no-pocket', row: 'wall', script: `const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10)\nround(plate.edge('top', plate.wall(sk2, 1)), 1)` });
add({ id: 'p-rim-then-plate-edge', row: 'wall', script: `${PK}round(part.rim(sk2), 1)\nround(part.edge('top','front'), 2)` });
add({ id: 'p-plate-edge-then-rim', row: 'wall', script: `${PK}round(part.edge('top','front'), 2)\nround(part.rim(sk2), 1)` });
add({ id: 'p-two-pockets-rim', row: 'rim', script: `const plate = cuboid(80,40,12)\nconst a = sketch('top', 6)\na.rect(20,10,{at:[-20,0]})\nconst p1 = pocket(a, plate, 4)\nconst c = sketch('top', 6)\nc.rect(20,10,{at:[20,0]})\nconst p2 = pocket(c, p1, 4)\nround(p2.rim(c), 1)` });
// ---- primitive corner option ----------------------------------------------------------------------------------------
add({ id: 'k-box-corner4', row: 'corner', script: `const b = cuboid(40,40,20,{corner:4})`, closed: () => rbox(40, 40, 20, 4) });
add({ id: 'k-box-corner-offc', row: 'corner', script: `const b = cuboid(40,30,12,{at:[15,-7,3],corner:2.5})`, closed: () => rbox(40, 30, 12, 2.5) });
add({ id: 'k-cyl-corner3', row: 'corner', script: `const c = cylinder(24,30,{corner:3})`, closed: () => cylV(12, 30) - 2 * rimFillet(12, 3) });
add({ id: 'k-box-corner-toobig', row: 'corner', script: `const b = cuboid(40,30,12,{corner:8})` });
add({ id: 'k-cyl-corner-toobig', row: 'corner', script: `const c = cylinder(24,30,{corner:13})` });
add({ id: 'k-sphere-corner', row: 'corner', script: `const s = sphere(20,{corner:2})` });
add({ id: 'k-cone-corner', row: 'corner', script: `const s = cone(20,30,{corner:2})` });
add({ id: 'k-prism-corner', row: 'corner', script: `const s = prism(6,20,10,{corner:2})` });
add({ id: 'k-box-corner-neg', row: 'corner', script: `const b = cuboid(40,30,12,{corner:-2})` });
add({ id: 'k-box-corner-zero', row: 'corner', script: `const b = cuboid(40,30,12,{corner:0})` });
add({ id: 'k-corner-then-edge', row: 'corner', script: `const b = cuboid(40,30,12,{corner:2})\nround(b.edge('top','front'), 1)` });
// ---- booleans (documented kernel refusals) --------------------------------------------------------------------------
const BC = `const b = cuboid(40,40,20)\nconst c = cylinder(8,40,{at:[0,0,0]})\nconst d = subtract(b, c)\n`;
add({ id: 'b-cut-then-fillet-edge', row: 'bool', control: true, script: `${BC}round(d.edge('top','right'), 2)` });
add({ id: 'b-cut-then-bevel-edge', row: 'bool', control: true, script: `${BC}bevel(d.edge('top','right'), 2)` });
add({ id: 'b-cut-then-fillet-edge-through-hole', row: 'bool', script: `const b = cuboid(40,40,20)\nconst c = cylinder(10,40,{at:[20,0,0]})\nconst d = subtract(b, c)\nround(d.edge('top','right'), 2)` });
add({ id: 'b-cut-then-bevel-edge-through-hole', row: 'bool', script: `const b = cuboid(40,40,20)\nconst c = cylinder(10,40,{at:[20,0,0]})\nconst d = subtract(b, c)\nbevel(d.edge('top','right'), 2)` });
add({ id: 'b-union-then-fillet-edge', row: 'bool', script: `const b = cuboid(40,40,20)\nconst k = cuboid(10,10,10,{at:[0,0,15]})\nconst d = join(b, k)\nround(d.edge('top','front'), 2)` });
add({ id: 'b-union-then-bevel-edge', row: 'bool', script: `const b = cuboid(40,40,20)\nconst k = cuboid(10,10,10,{at:[0,0,15]})\nconst d = join(b, k)\nbevel(d.edge('top','front'), 2)` });
add({ id: 'b-intersect-then-fillet-edge', row: 'bool', script: `const b = cuboid(40,40,20)\nconst k = cuboid(30,30,30,{at:[5,5,0]})\nconst d = keep(b, k)\nround(d.edge('top','front'), 2)` });
add({ id: 'b-cut-notch-corner-fillet', row: 'bool', script: `const b = cuboid(40,40,20)\nconst k = cuboid(10,10,30,{at:[20,20,0]})\nconst d = subtract(b, k)\nround(d.edge('top','front'), 2)` });
add({ id: 'b-hole-then-round-edge', row: 'bool', script: `const b = cuboid(40,40,20)\nhole(b,{across:8})\nround(b.edge('top','front'), 3)`, closed: undefined });
add({ id: 'b-hole-then-bevel-edge', row: 'bool', script: `const b = cuboid(40,40,20)\nhole(b,{across:8})\nbevel(b.edge('top','front'), 3)` });
add({ id: 'b-rounded-then-cut-corner-hit', row: 'bool', script: `const b = cuboid(40,40,20)\nround(b.edge('top','right'), 3)\nconst k = cuboid(10,10,30,{at:[20,0,0]})\nsubtract(b, k)` });

// ---- ModelDoc-only: primitive roundStyle chamfer (not reachable from script text) ------------------------------------
add({ id: 'd-box-round-chamfer', row: 'cornerChamfer', doc: [{ id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], round: 4, roundStyle: 'chamfer' }] });
add({ id: 'd-box-round-chamfer-offc', row: 'cornerChamfer', doc: [{ id: 'b1', kind: 'box', size: [40, 30, 12], center: [15, -7, 3], round: 2, roundStyle: 'chamfer' }] });
add({ id: 'd-cyl-round-chamfer', row: 'cornerChamfer', doc: [{ id: 'c1', kind: 'cylinder', radius: 12, height: 30, center: [0, 0, 0], round: 3, roundStyle: 'chamfer' }], closed: () => cylV(12, 30) - 2 * rimChamfer(12, 3) });
add({ id: 'd-box-round-fillet-explicit', row: 'cornerChamfer', doc: [{ id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], round: 4, roundStyle: 'fillet' }], closed: () => rbox(40, 40, 20, 4) });
add({ id: 'd-box-round-nostyle', row: 'cornerChamfer', doc: [{ id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], round: 4 }], closed: () => rbox(40, 40, 20, 4) });

// ---- more hazards ------------------------------------------------------------------------------------------------------
add({ id: 'ch-bevel-then-bevel-same-edge', row: 'consumed', script: `${B}\nbevel(b.edge('top','front'), 2)\nbevel(b.edge('top','front'), 1)` });
add({ id: 'ch-round-then-bevel-same-edge', row: 'consumed', script: `${B}\nround(b.edge('top','front'), 2)\nbevel(b.edge('top','front'), 1)` });
add({ id: 'x-prism-edge', row: 'beyondBox', script: `const s = prism(6,20,10)\nround(s.edge('top','front'), 1)` });
add({ id: 'x-wedge-edge', row: 'beyondBox', script: `const s = wedge(20,10,10)\nround(s.edge('top','front'), 1)` });
add({ id: 'x-sphere-edge', row: 'beyondBox', script: `const s = sphere(20)\nround(s.edge('top','front'), 1)` });
add({ id: 'x-cone-edge', row: 'beyondBox', script: `const s = cone(20,30)\nround(s.edge('top','side'), 1)` });
add({ id: 'x-ring-edge', row: 'beyondBox', script: `const s = ring(30,8)\nround(s.edge('top','side'), 1)` });
add({ id: 'x-pull-edge', row: 'beyondBox', script: `const sk = sketch('top')\nsk.rect(20,10)\nconst p = pull(sk, 8)\nround(p.edge('top','front'), 1)` });
add({ id: 'x-spin-edge', row: 'beyondBox', script: `const sk = sketch('front')\nsk.rect(10,20,{at:[20,0]})\nconst p = spin(sk, 360)\nround(p.edge('top','side'), 1)` });
add({ id: 'x-bevel-prism-edge', row: 'beyondBox', script: `const s = prism(6,20,10)\nbevel(s.edge('top','front'), 1)` });
add({ id: 'x-bevel-list-not-edges', row: 'beyondBox', script: `const b = cuboid(10,10,10)\nbevel([b], 1)` });
add({ id: 'x-bevel-face-ref', row: 'beyondBox', script: `const b = cuboid(10,10,10)\nbevel(b.face('top'), 1)` });
add({ id: 'x-round-face-ref', row: 'beyondBox', script: `const b = cuboid(10,10,10)\nround(b.face('top'), 1)` });
add({ id: 'x-round-nonnumber', row: 'beyondBox', script: `const b = cuboid(10,10,10)\nround(b.edge('top','front'), 'big')` });
add({ id: 'x-round-whole-cyl-then-rim', row: 'beyondBox', script: `const c = cylinder(24,30)\nround(c, 3)\nround(c.edge('top','side'), 1)` });
add({ id: 'x-round-twice-whole', row: 'beyondBox', script: `const b = cuboid(40,40,20)\nround(b, 4)\nround(b, 2)` });
// ---- round 2: size extremes, odd prisms, nonpositive whole-shape sizes -----------------------------------------------
add({ id: 'n-w-box-neg', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b, -2)` });
add({ id: 'n-w-box-zero', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b, 0)`, closed: () => 40 * 30 * 12 });
add({ id: 'n-w-cyl-neg', row: 'sizes', script: `const c = cylinder(24,30)\nround(c, -3)` });
add({ id: 'n-w-box-r1000', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b, 1000)` });
add({ id: 'n-w-box-r1e-6', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b, 0.000001)`, closed: () => rbox(40, 30, 12, 1e-6) });
add({ id: 'n-w-box-r0.001', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b, 0.001)`, closed: () => rbox(40, 30, 12, 0.001) });
add({ id: 'n-e-fillet-r1000', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), 1000)` });
add({ id: 'n-e-fillet-r1e-6', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), 0.000001)`, closed: () => boxFillet('top', 'front', 1e-6) });
add({ id: 'n-e-fillet-r0.001', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), 0.001)`, closed: () => boxFillet('top', 'front', 0.001) });
add({ id: 'n-e-bevel-d1e-6', row: 'sizes', script: `const b = cuboid(40,30,12)\nbevel(b.edge('top','front'), 0.000001)`, closed: () => boxChamfer('top', 'front', 1e-6) });
add({ id: 'n-e-bevel-d1000', row: 'sizes', script: `const b = cuboid(40,30,12)\nbevel(b.edge('top','front'), 1000)` });
add({ id: 'n-e-fillet-vertical-r14', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b.edge('front','left'), 14)`, closed: () => V0 - Af(14) * 12 });
add({ id: 'n-e-fillet-vertical-r16', row: 'sizes', script: `const b = cuboid(40,30,12)\nround(b.edge('front','left'), 16)`, closed: () => V0 - Af(16) * 12 });
add({ id: 'n-prism5-front', row: 'beyondBox', script: `const s = prism(5,20,10)\nround(s.edge('top','front'), 1)` });
add({ id: 'n-prism6-left', row: 'beyondBox', script: `const s = prism(6,20,10)\nround(s.edge('top','left'), 1)` });
add({ id: 'n-prism6-back', row: 'beyondBox', script: `const s = prism(6,20,10)\nround(s.edge('top','back'), 1)` });
add({ id: 'n-prism6-bottom-front', row: 'beyondBox', script: `const s = prism(6,20,10)\nbevel(s.edge('bottom','front'), 1)` });
add({ id: 'n-wedge-back', row: 'beyondBox', script: `const s = wedge(20,10,10)\nround(s.edge('top','back'), 1)` });
add({ id: 'n-wedge-front-left', row: 'beyondBox', script: `const s = wedge(20,10,10)\nround(s.edge('front','left'), 1)` });
add({ id: 'n-wedge-bottom-front', row: 'beyondBox', script: `const s = wedge(20,10,10)\nbevel(s.edge('bottom','front'), 1)` });
add({ id: 'n-pull-top-left', row: 'beyondBox', script: `const sk = sketch('top')\nsk.rect(20,10)\nconst p = pull(sk, 8)\nbevel(p.edge('top','left'), 1)` });
add({ id: 'n-pull-circle-rim', row: 'beyondBox', script: `const sk = sketch('top')\nsk.circle(20)\nconst p = pull(sk, 8)\nround(p.edge('top','side'), 1)` });
add({ id: 'n-pull-poly-front', row: 'beyondBox', script: `const sk = sketch('top')\nsk.polygon([[0,0],[20,0],[10,15]])\nconst p = pull(sk, 8)\nround(p.edge('top','front'), 1)` });
add({ id: 'n-hole-then-rim-edge', row: 'beyondBox', script: `const b = cuboid(40,30,12)\nhole(b,{across:10})\nround(b.edge('top','side'), 1)` });
add({ id: 'n-union-lap-edge', row: 'beyondBox', script: `const a = cuboid(40,30,12)\nconst b = cuboid(20,20,12,{at:[30,0,0]})\nconst u = join(a, b)\nround(u.edge('top','left'), 2)` });
add({ id: 'n-repeat-then-edge', row: 'afterOps', script: `const b = cuboid(10,10,10)\nrepeat(b,{count:3,step:[20,0,0]})\nround(b.edge('top','front'), 1)` });
add({ id: 'n-mirror-then-edge', row: 'afterOps', script: `const b = cuboid(20,30,12,{at:[20,0,0]})\nmirror(b,'left-right')\nround(b.edge('top','right'), 2)` });
add({ id: 'n-hollow-closed-then-edge', row: 'afterOps', script: `const b = cuboid(40,30,12)\nhollow(b,{wall:2})\nround(b.edge('top','front'), 1)` });
add({ id: 'n-edge-then-hollow-r1-wall2', row: 'afterOps', script: `const b = cuboid(40,30,12)\nround(b.edge('top','right'), 1)\nhollow(b,{wall:2,open:'top'})` });
add({ id: 'n-edge-then-hollow-vertical-r1', row: 'afterOps', script: `const b = cuboid(40,30,12)\nround(b.edge('front','left'), 1)\nhollow(b,{wall:2,open:'top'})` });
add({ id: 'n-draft-then-edge', row: 'afterOps', script: `const b = cuboid(40,30,12)\ndraft(b.face('right'), 5, {neutral: -6})\nround(b.edge('top','front'), 2)` });
add({ id: 'n-edge-then-draft', row: 'afterOps', script: `const b = cuboid(40,30,12)\nround(b.edge('top','front'), 2)\ndraft(b.face('right'), 5, {neutral: -6})` });
// ---- round 3: stale-pick hazard after move/turn (brep-rs resolve answers in the named feature's own frame) -------------
for (const [k, mv] of [['z-4', [0, 0, -4]], ['y3', [0, 3, 0]], ['x-3', [-3, 0, 0]], ['xyz5', [5, 5, 5]], ['x20', [20, 0, 0]], ['y20', [0, 20, 0]], ['z-6', [0, 0, -6]], ['y-3z-3', [0, -3, -3]], ['x2y2', [2, 2, 0]]]) {
  add({ id: `m-move-${k}-then-top-front`, row: 'moveHazard', script: `const b = cuboid(40,30,12)\nmove(b,[${mv}])\nround(b.edge('top','front'), 2)`, closed: () => boxFillet('top', 'front', 2) });
  add({ id: `m-move-${k}-then-front-right-bevel`, row: 'moveHazard', script: `const b = cuboid(40,30,12)\nmove(b,[${mv}])\nbevel(b.edge('front','right'), 2)`, closed: () => boxChamfer('front', 'right', 2) });
}
for (const [k, tn] of [['z90', [0, 0, 90]], ['z45', [0, 0, 45]], ['x90', [90, 0, 0]], ['y90', [0, 90, 0]], ['x30y20', [30, 20, 0]]]) {
  add({ id: `m-turn-${k}-then-top-front`, row: 'moveHazard', script: `const b = cuboid(40,30,12)\nturn(b,[${tn}])\nround(b.edge('top','front'), 2)`, closed: () => boxFillet('top', 'front', 2) });
  add({ id: `m-turn-${k}-then-left-back-bevel`, row: 'moveHazard', script: `const b = cuboid(40,30,12)\nturn(b,[${tn}])\nbevel(b.edge('left','back'), 2)`, closed: () => boxChamfer('left', 'back', 2) });
}
add({ id: 'm-move-then-edge-then-move', row: 'moveHazard', script: `const b = cuboid(40,30,12)\nmove(b,[10,5,0])\nround(b.edge('top','front'), 2)\nmove(b,[-4,0,3])\nbevel(b.edge('top','right'), 2)` });
add({ id: 'm-at-offset-edge', row: 'moveHazard', script: `const b = cuboid(40,30,12,{at:[100,-50,30]})\nround(b.edge('top','front'), 2)\nbevel(b.edge('bottom','left'), 2)` });
// ---- round 4: cylinder rim pick robustness (rotated axis, short disc, thin rod, tiny rim) ------------------------------
for (const [k, tn] of [['x90', [90, 0, 0]], ['y90', [0, 90, 0]], ['z30', [0, 0, 30]]]) {
  add({ id: `r-cyl-turn-${k}-top-rim`, row: 'rimPick', script: `const c = cylinder(24,30)\nturn(c,[${tn}])\nround(c.edge('top','side'), 3)`, closed: () => cylV(12, 30) - rimFillet(12, 3) });
  add({ id: `r-cyl-turn-${k}-bottom-rim-bevel`, row: 'rimPick', script: `const c = cylinder(24,30)\nturn(c,[${tn}])\nbevel(c.edge('bottom','side'), 3)`, closed: () => cylV(12, 30) - rimChamfer(12, 3) });
}
add({ id: 'r-disc-R20-H2-top', row: 'rimPick', script: `const c = cylinder(40,2)\nround(c.edge('top','side'), 0.5)`, closed: () => cylV(20, 2) - rimFillet(20, 0.5) });
add({ id: 'r-disc-R20-H2-bottom', row: 'rimPick', script: `const c = cylinder(40,2)\nround(c.edge('bottom','side'), 0.5)`, closed: () => cylV(20, 2) - rimFillet(20, 0.5) });
add({ id: 'r-rod-R1-H30-top', row: 'rimPick', script: `const c = cylinder(2,30)\nround(c.edge('top','side'), 0.3)`, closed: () => cylV(1, 30) - rimFillet(1, 0.3) });
add({ id: 'r-rod-R1-H30-bottom', row: 'rimPick', script: `const c = cylinder(2,30)\nbevel(c.edge('bottom','side'), 0.3)`, closed: () => cylV(1, 30) - rimChamfer(1, 0.3) });
add({ id: 'r-cyl-far-from-origin', row: 'rimPick', script: `const c = cylinder(24,30,{at:[200,-150,80]})\nround(c.edge('top','side'), 3)\nbevel(c.edge('bottom','side'), 2)`, closed: () => cylV(12, 30) - rimFillet(12, 3) - rimChamfer(12, 2) });
add({ id: 'r-cyl-tall-thin-top', row: 'rimPick', script: `const c = cylinder(6,100)\nround(c.edge('top','side'), 1)`, closed: () => cylV(3, 100) - rimFillet(3, 1) });
