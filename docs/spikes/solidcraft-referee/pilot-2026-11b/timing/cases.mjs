import { TASKS } from '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/pilot-2026-11b/tasks.mjs';
const pick = (id) => { const t = TASKS.find((x) => x.id === id); return { id, script: t.script }; };
export const CASES = [
  { id: 'one-box', script: `const b = box(30, 20, 10)` },
  { id: 'box-hole', script: `const b = box(30, 20, 10)\nhole(b, { across: 6 })` },
  { id: 'box-hole-hollow', script: `const b = box(40, 30, 10)\nhole(b, { across: 6 })\nhollow(b, { wall: 2, open: 'top' })` },
  pick('p2b-peg-at'), pick('p3c-boss-hole-first'), pick('p6a-standoffs'), pick('p6b-standoffs-drilled-first'), pick('p9b-knob-base-at'), pick('p9c-knob-top-plane'),
  { id: 'blocked-chain', script: `const b = box(30, 20, 10)\nhole(b, { across: 35 })\nhollow(b, { wall: 12, open: 'top' })\ndraft(b.face('right'), 5)\nround(b.edge('top', 'front'), 2)` },
  { id: 'second-pass', script: `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] }); const p = extrude(sk1, 10); const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] }); pocket(sk2, p, 4); draft(p.face('right'), 5);\nconst c = box(30, 20, 10, { at: [100, 0, 0] })\nhole(c, { across: 6 })\nhollow(c, { wall: 2, open: 'top' })` },
];
