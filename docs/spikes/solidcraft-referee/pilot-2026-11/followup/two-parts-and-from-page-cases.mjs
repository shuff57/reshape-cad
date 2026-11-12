const B = `const b = box(40, 40, 20)\n`;
const LID = `const lid = box(40, 40, 4, { at: [0, 0, 12] })\n`;
const PULL = `const sk = sketch('top')\nsk.rect(40, 30, { at: [20, 15] })\nconst p = extrude(sk, 10)\n`;
export const CASES = [
  { id: 'two-parts-plain-hole', script: B + LID + `hole(b, { across: 6 })`, want: 32000 - Math.PI * 9 * 20 + 6400 },
  { id: 'two-parts-far-counterbore', script: B + `const o = box(10, 10, 10, { at: [200, 0, 0] })\nhole(b, { across: 6, counterbore: { across: 12, deep: 4 } })`, want: 32000 - Math.PI * 9 * 20 - Math.PI * 27 * 4 + 1000 },
  { id: 'lid-after-box-counterbore', script: B + LID + `hole(b, { across: 6, counterbore: { across: 12, deep: 4 } })`, want: null },
  { id: 'lid-before-box-counterbore', script: LID + B + `hole(b, { across: 6, counterbore: { across: 12, deep: 4 } })`, want: 32000 - Math.PI * 9 * 20 - Math.PI * 27 * 4 + 6400 },
  { id: 'hole-then-lid-counterbore', script: B + `hole(b, { across: 6, counterbore: { across: 12, deep: 4 } })\n` + LID, want: 32000 - Math.PI * 9 * 20 - Math.PI * 27 * 4 + 6400 },
  { id: 'both-parts-drilled', script: B + `const o = box(20, 20, 10, { at: [100, 0, 0] })\nhole(b, { across: 6 })\nhole(o, { across: 4 })`, want: 32000 - Math.PI * 9 * 20 + 4000 - Math.PI * 4 * 10 },
  { id: 'pattern-copies-hole', script: B + `const p = linearPattern(b, { count: 3, step: [60, 0, 0] })\nhole(p, { across: 6 })`, want: null },
  { id: 'pull-draft-from-top', script: PULL + `draft(p.face('right'), 5, { from: 'top' })`, want: 12000 + 30 * Math.tan(5 * Math.PI / 180) * 50 },
  { id: 'pull-draft-from-bottom', script: PULL + `draft(p.face('right'), 5, { from: 'bottom' })`, want: 12000 - 30 * Math.tan(5 * Math.PI / 180) * 50 },
  { id: 'pull-moved-draft-from-top', script: PULL + `move(p, [0, 0, 5])\ndraft(p.face('right'), 5, { from: 'top' })`, want: null },
  { id: 'box-draft-from-top', script: `const b = box(30, 20, 10)\ndraft(b.face('right'), 5, { from: 'top' })`, want: 6000 + 20 * Math.tan(5 * Math.PI / 180) * 50 },
];
