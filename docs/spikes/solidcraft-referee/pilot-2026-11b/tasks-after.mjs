// tasks-after.mjs: the second pilot's sticking points again after the changes of 2026-11-12 (Q1 to Q6), and the new whole: true option with closed forms.
import { TASKS as ALL } from './tasks.mjs';
const PI = Math.PI; const again = (id) => { const t = ALL.find((x) => x.id === id); return { ...t, id: id + '-after' }; };
const DRILLED = `const b = box(30, 20, 10)\nhole(b, { across: 6 })\n`;
export const TASKS = [
  again('p8a-row'), again('p3a-bracket-boss'), again('p3b-boss-at'), again('p5a-plate-forgot'), again('p6a-standoffs'), again('p9d-knob-alone-front'), again('p9c-knob-top-plane'),
  { id: 'w1-row-whole', title: 'A drilled block repeated three times as a whole', script: DRILLED + `const row = linearPattern(b, { count: 3, step: [40, 0, 0], whole: true })`, expect: 3 * (6000 - PI * 9 * 10) },
  { id: 'w2-row-counterbore', title: 'A counterbored block repeated three times', script: `const b = box(30, 20, 10)\nhole(b, { across: 6, counterbore: { across: 10, deep: 3 } })\nlinearPattern(b, { count: 3, step: [40, 0, 0], whole: true })`, expect: 3 * (6000 - PI * 9 * 10 - PI * 16 * 3) },
  { id: 'w3-row-pocket', title: 'A pocketed block repeated twice', script: `const b = box(40, 30, 10)\nconst sk = sketch('top', 5)\nsk.rect(6, 6)\npocket(sk, b, 3)\nlinearPattern(b, { count: 2, step: [50, 0, 0], whole: true })`, expect: 2 * (12000 - 108) },
  { id: 'w4-ring-whole', title: 'A drilled block repeated four times around', script: `const b = box(30, 20, 10, { at: [50, 0, 0] })\nhole(b, { across: 6 })\npolarPattern(b, { count: 4, axis: 'z', whole: true })`, expect: 4 * (6000 - PI * 9 * 10) },
  { id: 'w5-row-touching', title: 'Drilled blocks repeated so that they touch', script: DRILLED + `linearPattern(b, { count: 3, step: [30, 0, 0], whole: true })`, expect: 3 * (6000 - PI * 9 * 10) },
  { id: 'w6-row-two-holes', title: 'A block with two holes repeated along y', script: `const b = box(30, 20, 10)\nhole(b, { across: 6, at: [-8, 0] })\nhole(b, { across: 4, at: [8, 0] })\nlinearPattern(b, { count: 2, step: [0, 30, 0], whole: true })`, expect: 2 * (6000 - PI * 9 * 10 - PI * 4 * 10) },
  { id: 'w7-row-then-hole', title: 'After the repeat, one more hole in the row', script: DRILLED + `const row = linearPattern(b, { count: 3, step: [40, 0, 0], whole: true })\nhole(row, { across: 3, at: [10, 0] })`, expect: null },
  { id: 'w8-spin-side', title: 'A profile spun on the side plane', script: `const sk = sketch('side')\nsk.polygon([[0, 0], [12, 0], [12, 6], [6, 14], [0, 14]])\nconst k = revolve(sk, 360)`, expect: PI * 144 * 6 + PI * 8 / 3 * 252 },
];
