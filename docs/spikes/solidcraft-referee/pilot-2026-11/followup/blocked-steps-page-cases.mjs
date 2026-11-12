const B = `const b = box(30, 20, 10)\nhole(b, { across: 35 })\n`;           // the hole is wider than the part: not built
export const CASES = [
  { id: 'hollow-too-thick', script: B + `hollow(b, { wall: 12, open: 'top' })` },
  { id: 'hollow-fine', script: B + `hollow(b, { wall: 2, open: 'top' })` },
  { id: 'hollow-twice', script: `const b = box(30, 20, 10)\nhollow(b, { wall: 2, open: 'top' })\nhole(b, { across: 35 })\nhollow(b, { wall: 1, open: 'top' })` },
  { id: 'draft-too-steep', script: B + `draft(b.face('right'), 60)` },
  { id: 'draft-fine', script: B + `draft(b.face('right'), 5)` },
  { id: 'draft-top-face', script: B + `draft(b.face('top'), 5)` },
  { id: 'round-too-big', script: B + `round(b.edge('top', 'front'), 25)` },
  { id: 'round-fine', script: B + `round(b.edge('top', 'front'), 2)` },
  { id: 'bevel-too-big', script: B + `bevel(b.edge('top', 'front'), 25)` },
  { id: 'chain', script: B + `hollow(b, { wall: 12, open: 'top' })\ndraft(b.face('right'), 5)\nround(b.edge('top', 'front'), 2)` },
  { id: 'chain-fine-then-bad', script: B + `round(b.edge('top', 'front'), 2)\nhollow(b, { wall: 12, open: 'top' })` },
  { id: 'sphere-hollow-after-bad-hole', script: `const s = sphere(20)\nhole(s, { across: 50 })\nhollow(s, { wall: 2, open: 'top' })` },
  { id: 'cylinder-open-left', script: `const c = cylinder(20, 30)\nhole(c, { across: 40 })\nhollow(c, { wall: 2, open: 'left' })` },
  { id: 'nothing-blocked', script: `const b = box(30, 20, 10)\nhole(b, { across: 6 })\nhollow(b, { wall: 2, open: 'bottom' })` },
];
