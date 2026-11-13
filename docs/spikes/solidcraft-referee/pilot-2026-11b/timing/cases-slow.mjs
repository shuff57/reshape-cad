const KNOB = `const sk = sketch('front', 0)\nsk.polygon([[0, 0], [12, 0], [12, 6], [6, 14], [0, 14]])\nconst knob = revolve(sk, 360)\nconst base = box(30, 30, 4, { at: [0, 0, -2] })\nconst part = union(knob, base)\n`;
const STALE = `const s1 = sketch('top'); s1.rect(40, 30, { at: [520, 515] }); const p = extrude(s1, 10); const s2 = sketch('top', 10); s2.rect(10, 10, { at: [520, 515] }); pocket(s2, p, 4); draft(p.face('right'), 5)\n`;
const BLOCKED = `const b = box(30, 20, 10, { at: [200, 0, 0] })\nhole(b, { across: 35 })\nhollow(b, { wall: 12, open: 'top' })\n`;
export const CASES = [
  { id: 'slow-join-alone', script: KNOB },
  { id: 'slow-join-then-stale', script: KNOB + STALE },
  { id: 'slow-join-then-blocked', script: KNOB + BLOCKED },
  { id: 'slow-join-stale-blocked', script: KNOB + STALE + BLOCKED },
  { id: 'stale-blocked-then-slow-join', script: STALE + BLOCKED + KNOB },
];
