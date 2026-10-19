// Round 5 (critic round 2). Pick on a stale handle after pocket()/groove()/hole() whose result was NOT captured.
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5a-stale.mjs        (page translator, unguarded)
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r3-run-sec.mjs r5a-stale.mjs   (with the contract-side guard)
import { T, save, L } from './common.mjs';
const base = `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const p = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
`;
const cases = {
  'stale pocket uncaptured + round top|front': base + `pocket(sk2, p, 4);\nround(p.edge('top','front'), 1);`,
  'captured pocket + round top|front (control)': base + `const q = pocket(sk2, p, 4);\nround(q.edge('top','front'), 1);`,
  'stale pocket uncaptured + hollow bottom': base + `pocket(sk2, p, 4);\nhollow(p, { wall: 1, open: 'bottom' });`,
  'captured pocket + hollow bottom (control)': base + `const q = pocket(sk2, p, 4);\nhollow(q, { wall: 1, open: 'bottom' });`,
  'stale pocket uncaptured + draft right 5': base + `pocket(sk2, p, 4);\ndraft(p.face('right'), 5);`,
  'captured pocket + draft right 5 (control)': base + `const q = pocket(sk2, p, 4);\ndraft(q.face('right'), 5);`,
  'stale hole uncaptured + round top|front': base + `hole(p, { across: 6, at: [20, 15], deep: 5 });\nround(p.edge('top','front'), 1);`,
  'captured hole + round top|front (control)': base + `const q = hole(p, { across: 6, at: [20, 15], deep: 5 });\nround(q.edge('top','front'), 1);`,
  'stale groove uncaptured + round top|front': `const b = box(40,40,20); const sk = sketch('front'); sk.polygon([[0,15],[8,15],[8,22],[0,22]]);\ngroove(sk, b, 180);\nround(b.edge('top','front'), 1);`,
  'captured groove + round top|front (control)': `const b = box(40,40,20); const sk = sketch('front'); sk.polygon([[0,15],[8,15],[8,22],[0,22]]);\nconst g = groove(sk, b, 180);\nround(g.edge('top','front'), 1);`,
  'stale join uncaptured + round (already guarded)': `const a = cuboid(20,20,10); const b = cuboid(10,10,10,{at:[15,0,0]}); join(a,b);\nround(a.edge('top','front'),1);`,
};
for (const [k, s] of Object.entries(cases)) await T(k, s, { control: false });
save('r5a-stale.json');
