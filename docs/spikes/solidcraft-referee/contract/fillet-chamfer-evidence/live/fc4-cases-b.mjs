// ROUND 4 cases, part B: shape coverage and operation order (turned / moved / mirrored parts, prism / wedge / sphere / pulled disc rims, edge-then-whole and whole-then-edge, draft, hollow).
export const CASES = [];
const add = (c) => CASES.push(c);
const PI = Math.PI;
const BOX = 'const b = cuboid(40,30,12)\n';
const CYL = 'const c = cylinder(24,30)\n';
// ---- turned cylinder rim (critic: row 13 said "upright or turned", the pane refuses every named edge after turn())
for (const [k, a] of [['x90', '90,0,0'], ['y90', '0,90,0'], ['z30', '0,0,30'], ['x45', '45,0,0'], ['x30y40', '30,40,0'], ['x30y40z50', '30,40,50']]) {
  add({ id: `b-cyl-turn-${k}-top-rim-round3`, group: 'b-turn', script: `${CYL}turn(c,[${a}])\nround(c.edge('top','side'), 3)`, note: 'turned cylinder, rim fillet' });
  add({ id: `b-cyl-turn-${k}-bottom-rim-bevel3`, group: 'b-turn', script: `${CYL}turn(c,[${a}])\nbevel(c.edge('bottom','side'), 3)` });
}
add({ id: 'b-cyl-upright-top-rim-round3', group: 'b-turn', script: `${CYL}round(c.edge('top','side'), 3)`, note: 'upright control' });
add({ id: 'b-cyl-moved-top-rim-round3', group: 'b-turn', script: `${CYL}move(c,[10,5,2])\nround(c.edge('top','side'), 3)` });
// box after turn / move
for (const [k, a] of [['z90', '0,0,90'], ['x90', '90,0,0'], ['z30', '0,0,30'], ['x45', '45,0,0']]) add({ id: `b-box-turn-${k}-edge`, group: 'b-turn', script: `${BOX}turn(b,[${a}])\nround(b.edge('top','front'), 2)` });
for (const m of ['10,5,0', '-15,0,0', '0,0,7']) add({ id: `b-box-move-${m.replace(/,/g, '_')}-edge`, group: 'b-turn', script: `${BOX}move(b,[${m}])\nround(b.edge('top','front'), 2)` });
add({ id: 'b-box-mirror-edge', group: 'b-turn', script: 'const b = cuboid(20,30,12,{at:[20,0,0]})\nmirror(b,\'left-right\')\nround(b.edge(\'top\',\'right\'), 2)' });
add({ id: 'b-box-edge-then-move', group: 'b-turn', script: `${BOX}round(b.edge('top','front'), 2)\nmove(b,[10,5,0])`, note: 'blend first, then move: fine' });
add({ id: 'b-box-edge-then-turn', group: 'b-turn', script: `${BOX}round(b.edge('top','front'), 2)\nturn(b,[0,0,30])` });
// ---- other shapes: prism / wedge / sphere / ring / cone / spin / pulled disc
add({ id: 'b-prism-edge-top-front', group: 'b-shapes', script: 'const s = prism(6,20,10)\nround(s.edge(\'top\',\'front\'), 1)' });
add({ id: 'b-prism-edge-top-left', group: 'b-shapes', script: 'const s = prism(6,20,10)\nround(s.edge(\'top\',\'left\'), 1)' });
add({ id: 'b-prism-bevel-top-front', group: 'b-shapes', script: 'const s = prism(6,20,10)\nbevel(s.edge(\'top\',\'front\'), 1)' });
add({ id: 'b-wedge-edge-top-front', group: 'b-shapes', script: 'const s = wedge(20,10,10)\nround(s.edge(\'top\',\'front\'), 1)' });
add({ id: 'b-wedge-bevel-bottom-front', group: 'b-shapes', script: 'const s = wedge(20,10,10)\nbevel(s.edge(\'bottom\',\'front\'), 1)' });
add({ id: 'b-sphere-edge', group: 'b-shapes', script: 'const s = sphere(20)\nround(s.edge(\'top\',\'front\'), 1)' });
add({ id: 'b-ring-edge-top-side', group: 'b-shapes', script: 'const s = ring(30,8)\nround(s.edge(\'top\',\'side\'), 1)' });
add({ id: 'b-cone-edge-top-side', group: 'b-shapes', script: 'const s = cone(20,30)\nround(s.edge(\'top\',\'side\'), 1)' });
add({ id: 'b-spin-edge-top-side', group: 'b-shapes', script: 'const sk = sketch(\'front\')\nsk.rect(10,20,{at:[20,0]})\nconst p = spin(sk, 360)\nround(p.edge(\'top\',\'side\'), 1)' });
add({ id: 'b-pulled-disc-rim-top-side', group: 'b-shapes', script: 'const sk = sketch(\'top\')\nsk.circle(20)\nconst p = pull(sk, 8)\nround(p.edge(\'top\',\'side\'), 1)', note: 'critic: a pulled disc has no row; the interpreter text names a box' });
add({ id: 'b-pulled-disc-rim-bevel', group: 'b-shapes', script: 'const sk = sketch(\'top\')\nsk.circle(20)\nconst p = pull(sk, 8)\nbevel(p.edge(\'bottom\',\'side\'), 1)' });
add({ id: 'b-pulled-disc-top-front', group: 'b-shapes', script: 'const sk = sketch(\'top\')\nsk.circle(20)\nconst p = pull(sk, 8)\nround(p.edge(\'top\',\'front\'), 1)' });
add({ id: 'b-box-edge-top-side', group: 'b-shapes', script: `${BOX}round(b.edge('top','side'), 1)` });
add({ id: 'b-pulled-rect-top-front', group: 'b-shapes', script: 'const sk = sketch(\'top\')\nsk.rect(30,20)\nconst p = pull(sk, 8)\nround(p.edge(\'top\',\'front\'), 1)' });
add({ id: 'b-pulled-tri-top-front', group: 'b-shapes', script: 'const sk = sketch(\'top\')\nsk.polygon([[0,0],[30,0],[10,20]])\nconst p = pull(sk, 8)\nround(p.edge(\'top\',\'front\'), 1)' });
// ---- order: edge then whole, whole then edge, primitive corner then edge
add({ id: 'b-edge-round-then-whole', group: 'b-order', script: `${BOX}round(b.edge('top','front'), 2)\nround(b, 1)`, note: 'critic: edge-then-whole, the interpreter text does not say why' });
add({ id: 'b-edge-bevel-then-whole', group: 'b-order', script: `${BOX}bevel(b.edge('top','front'), 2)\nround(b, 1)` });
add({ id: 'b-whole-then-edge-round', group: 'b-order', script: `${BOX}round(b, 2)\nround(b.edge('top','front'), 1)` });
add({ id: 'b-whole-then-edge-bevel', group: 'b-order', script: `${BOX}round(b, 2)\nbevel(b.edge('top','front'), 1)` });
add({ id: 'b-corner-then-edge', group: 'b-order', script: 'const b = cuboid(40,30,12,{corner:2})\nround(b.edge(\'top\',\'front\'), 1)' });
add({ id: 'b-cyl-edge-then-whole', group: 'b-order', script: `${CYL}round(c.edge('top','side'), 2)\nround(c, 1)` });
add({ id: 'b-draft-then-edge', group: 'b-order', script: `${BOX}draft(b.face('right'), 5, {neutral: -6})\nround(b.edge('top','front'), 2)`, note: 'critic: the edge-changed sentence names round/bevel/cut/hole, a draft is not among them' });
add({ id: 'b-edge-then-draft', group: 'b-order', script: `${BOX}round(b.edge('top','front'), 2)\ndraft(b.face('right'), 5, {neutral: -6})` });
add({ id: 'b-hole-then-edge-far', group: 'b-order', script: `${BOX}hole(b,{across:6,at:[0,-9]})\nround(b.edge('top','right'), 2)` });
add({ id: 'b-hole-then-edge-near', group: 'b-order', script: `${BOX}hole(b,{across:6,at:[0,-9]})\nround(b.edge('top','front'), 2)`, note: 'hole 6 across 6 mm from the front edge, r2 reaches 2 mm' });
add({ id: 'b-hole-then-edge-near-r4', group: 'b-order', script: `${BOX}hole(b,{across:6,at:[0,-9]})\nround(b.edge('top','front'), 4)` });
add({ id: 'b-edge-then-hole', group: 'b-order', script: `${BOX}round(b.edge('top','front'), 4)\nhole(b,{across:6,at:[0,-9]})` });
add({ id: 'b-hollow-then-edge', group: 'b-order', script: `${BOX}hollow(b,{wall:2,open:'top'})\nround(b.edge('top','right'), 0.5)` });
add({ id: 'b-edge-then-hollow-r1', group: 'b-order', script: `${BOX}round(b.edge('top','right'), 1)\nhollow(b,{wall:2,open:'top'})` });
add({ id: 'b-edge-then-hollow-r2', group: 'b-order', script: `${BOX}round(b.edge('top','right'), 2)\nhollow(b,{wall:2,open:'top'})`, note: 'radius equals the wall: knife-edge rim' });
add({ id: 'b-edge-then-hollow-r3', group: 'b-order', script: `${BOX}round(b.edge('top','right'), 3)\nhollow(b,{wall:2,open:'top'})` });
add({ id: 'b-edge-then-hollow-bevel2', group: 'b-order', script: `${BOX}bevel(b.edge('top','right'), 2)\nhollow(b,{wall:2,open:'top'})` });
// ---- the interpreter's list / rim forms
add({ id: 'b-list-empty', group: 'b-order', script: `${BOX}round([], 2)` });
add({ id: 'b-circle-sketch', group: 'b-order', script: 'const sk = sketch(\'top\')\nsk.circle(20)\nround(sk, 1)' });
