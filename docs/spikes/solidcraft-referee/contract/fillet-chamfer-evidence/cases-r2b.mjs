// TURN and MOVE grids on box(30,20,20) (the 20-long front/back edges are the decoys for the 30-long top/front edge).
// A case where SolidCraft builds and BOTH OCCT and brep-rs report the edge not found is a solid nobody can confirm: listed, not trusted.
const PI = Math.PI;
const Af = (r) => (1 - PI / 4) * r * r;
const Ac = (d) => d * d / 2;
export const CASES = [];
const add = (c) => CASES.push(c);
for (const [k, tn] of [['z10', [0, 0, 10]], ['z45', [0, 0, 45]], ['z90', [0, 0, 90]], ['x90', [90, 0, 0]], ['y90', [0, 90, 0]], ['x30y20', [30, 20, 0]], ['x30y40z50', [30, 40, 50]], ['x45', [45, 0, 0]]]) {
  add({ id: `tu-${k}-round-top-front`, row: 'turnGrid', script: `const b = box(30,20,20)\nturn(b,[${tn}])\nround(b.edge('top','front'), 2)` });
  add({ id: `tu-${k}-bevel-top-front`, row: 'turnGrid', script: `const b = box(30,20,20)\nturn(b,[${tn}])\nbevel(b.edge('top','front'), 2)` });
  add({ id: `tu-${k}-bevel-left-back`, row: 'turnGrid', script: `const b = box(30,20,20)\nturn(b,[${tn}])\nbevel(b.edge('left','back'), 2)` });
}
for (const mv of [[15, 0, 0], [-15, 0, 0], [0, 10, 0], [0, -10, 0], [0, 0, 10], [0, 0, -10], [1, 1, 1], [5, 5, 5], [-7, 3, 2], [0, 0, 2], [0, 2, 0], [2, 0, 0], [30, 0, 0], [0, 20, 0], [-15, -10, 0], [15, 10, 10]]) {
  const k = mv.join('_').replace(/-/g, 'm');
  add({ id: `mo-${k}-round`, row: 'moveGrid', script: `const b = box(30,20,20)\nmove(b,[${mv}])\nround(b.edge('top','front'), 2)`, closed: () => 12000 - Af(2) * 30 });
  add({ id: `mo-${k}-bevel`, row: 'moveGrid', script: `const b = box(30,20,20)\nmove(b,[${mv}])\nbevel(b.edge('top','front'), 2)`, closed: () => 12000 - Ac(2) * 30 });
}
