const rect = `const sk = sketch('top')\nconst r = sk.rectangle([4.2, 2.1], [32.4, 19.1])\n`;
export const CASES = [
  { id: 'full', script: rect + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nconst part = extrude(sk, 10)` },
  { id: 'no-height', script: rect + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nconst part = extrude(sk, 10)` },
  { id: 'not-placed', script: rect + `sk.length(r.bottom, 30)\nsk.length(r.right, 20)\nconst part = extrude(sk, 10)` },
  { id: 'nothing', script: rect + `const part = extrude(sk, 10)` },
  { id: 'clash', script: rect + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nsk.length(r.top, 40)\nconst part = extrude(sk, 10)` },
  { id: 'twice', script: rect + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nsk.length(r.top, 30)\nconst part = extrude(sk, 10)` },
  { id: 'same-twice', script: rect + `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nsk.length(r.bottom, 30)\nconst part = extrude(sk, 10)` },
  { id: 'hole-free', script: `const sk = sketch('top')\nconst plate = sk.rectangle([0.3, 0.2], [39, 25.6])\nconst hole = sk.circle([19, 13.5], { r: 4.4 })\nsk.at(plate.bottom.a, [0, 0])\nsk.length(plate.bottom, 40)\nsk.length(plate.right, 25)\nsk.diameter(hole, 10)\nconst part = extrude(sk, 10)` },
  { id: 'handle-api', script: `const sk = sketch('top')\nsk.polygon([[0, 0], [40, 0], [40, 25], [0, 25]])\nsk.across(1)\nsk.up(2)\nsk.length(1, 40)\nconst shape = extrude(sk, 12)` },
  { id: 'plain-polygon', script: `const sk = sketch('top')\nsk.polygon([[0, 0], [40, 0], [40, 25], [0, 25]])\nconst shape = extrude(sk, 12)` },
  { id: 'two-sketches', script: `const a = sketch('top')\nconst r = a.rectangle([0, 0], [30, 20])\na.at(r.bottom.a, [0, 0])\na.length(r.bottom, 30)\na.length(r.right, 20)\nconst p = extrude(a, 10)\nconst b = sketch('top')\nconst c = b.circle([60, 10], { r: 5 })\nconst q = extrude(b, 10)` },
  { id: 'box-only', script: `const b = box(30, 20, 10)\nhole(b, { across: 6 })` },
  { id: 'triangle-no-angle', script: `const sk = sketch('top')\nconst base = sk.line([0.5, 0.4], [39, 1])\nconst side = sk.line(base.b, [25, 26.5])\nconst back = sk.line(side.b, base.a)\nsk.horizontal(base)\nsk.at(base.a, [0, 0])\nsk.length(base, 40)\nsk.length(side, 30)\nconst part = extrude(sk, 10)` },
  { id: 'angle-clash', script: `const sk = sketch('top')\nconst base = sk.line([0.5, 0.4], [39, 1])\nconst side = sk.line(base.b, [25, 26.5])\nconst back = sk.line(side.b, base.a)\nsk.horizontal(base)\nsk.at(base.a, [0, 0])\nsk.length(base, 40)\nsk.length(side, 30)\nsk.length(back, 100)\nconst part = extrude(sk, 10)` },
];
