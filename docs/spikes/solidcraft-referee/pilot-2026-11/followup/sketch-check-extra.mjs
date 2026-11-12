const rect = `const sk = sketch('top')\nconst r = sk.rectangle([4.2, 2.1], [32.4, 19.1])\n`;
const exact = `const sk = sketch('top')\nconst r = sk.rectangle([5, 3], [35, 23])\n`;
export const EXTRA = [
  // drawn exactly at size, so the rules do not move it: built with freedom left
  { id: 'x-exact-no-height', script: exact + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nconst part = extrude(sk, 10)` },
  { id: 'x-exact-not-placed', script: exact + `sk.length(r.bottom, 30)\nsk.length(r.right, 20)\nconst part = extrude(sk, 10)` },
  { id: 'x-exact-full', script: exact + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nconst part = extrude(sk, 10)` },
  { id: 'x-circle-only', script: `const sk = sketch('top')\nconst c = sk.circle([10, 10], { r: 5 })\nconst part = extrude(sk, 10)` },
  { id: 'x-circle-dia', script: `const sk = sketch('top')\nconst c = sk.circle([10, 10], { r: 5 })\nsk.diameter(c, 10)\nconst part = extrude(sk, 10)` },
  { id: 'x-circle-full', script: `const sk = sketch('top')\nconst c = sk.circle([10, 10], { r: 5 })\nsk.diameter(c, 10)\nsk.at(c.c, [10, 10])\nconst part = extrude(sk, 10)` },
  { id: 'x-plate-hole-exact-free', script: `const sk = sketch('top')\nconst plate = sk.rectangle([0, 0], [40, 25])\nconst hole = sk.circle([20, 12.5], { r: 5 })\nsk.at(plate.bottom.a, [0, 0])\nsk.length(plate.bottom, 40)\nsk.length(plate.right, 25)\nsk.diameter(hole, 10)\nconst part = extrude(sk, 10)` },
  { id: 'x-box-then-clash', script: `const b = box(10, 10, 5)\n` + rect + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nsk.dx(r.bottom.a, r.bottom.b, 44)\nconst part = extrude(sk, 10)` },
  { id: 'x-clash-dy', script: rect + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nsk.dy(r.bottom.a, r.top.a, 7)\nconst part = extrude(sk, 10)` },
  { id: 'x-clash-horizontal', script: `const sk = sketch('top')\nconst base = sk.line([0, 0], [40, 0])\nconst side = sk.line(base.b, [25, 26])\nconst back = sk.line(side.b, base.a)\nsk.horizontal(base)\nsk.at(base.a, [0, 0])\nsk.length(base, 40)\nsk.length(side, 30)\nsk.angle(base, side, 120)\nsk.horizontal(side)\nconst part = extrude(sk, 10)` },
  { id: 'x-clash-angle', script: `const sk = sketch('top')\nconst base = sk.line([0, 0], [40, 0])\nconst side = sk.line(base.b, [25, 26])\nconst back = sk.line(side.b, base.a)\nsk.horizontal(base)\nsk.at(base.a, [0, 0])\nsk.length(base, 40)\nsk.length(side, 30)\nsk.length(back, 36)\nsk.angle(base, side, 100)\nconst part = extrude(sk, 10)` },
  { id: 'x-pocket-clash', script: `const b = box(60, 40, 10)\nconst sk = sketch('top')\nconst r = sk.rectangle([4.2, 2.1], [32.4, 19.1])\nsk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nsk.length(r.top, 40)\nconst part = extrude(sk, 10)` },
];
