// Round 3 follow-ups: bisect the refusal band, bbox detail of the frame tolerance cases, tessellate area error on the SolidCraft path.
import { measureCase } from './sg-core.mjs';
const P = Math.PI; const H = 10;
const rr = (r) => r * r * (1 - Math.PI / 4);
const poly10x30 = '[[0,0],[10,0],[10,30],[0,30]]';
const sq40 = '[[0,0],[40,0],[40,30],[0,30]]';
export const cases = [
  ...[1e-5, 5e-6, 3e-6].map((flat) => { const r = 5 - flat / 2; return { id: `band-round-pair-flat${flat}`, feature: '.round', what: `two adjacent corners of a 10-wide plate, flat left ${flat}`, script: `const sk = sketch('top'); sk.polygon(${poly10x30}); sk.round(1, ${r}); sk.round(2, ${r}); extrude(sk, 10)`, exact: { volume: (300 - 2 * rr(r)) * H }, curved: true }; }),
  ...[5e-6, 3e-6, 2e-6].map((r) => ({ id: `band-round-single-r${r}`, feature: '.round', what: `one corner of a 40x30 plate, r=${r}`, script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.round(1, ${r}); extrude(sk, 10)`, exact: { volume: (1200 - rr(r)) * H }, curved: true })),
  ...[1e-5, 5e-6, 3e-6].map((flat) => ({ id: `band-chamfer-ceiling-flat${flat}`, feature: '.chamfer', what: `corner 1 of 40x30, chamfer leaving ${flat} of the 30 edge`, script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.chamfer(1, ${30 - flat}); extrude(sk, 10)`, exact: { volume: (1200 - (30 - flat) ** 2 / 2) * H } })),
  ...[5e-6, 3e-6, 2e-6].map((d) => ({ id: `band-chamfer-single-d${d}`, feature: '.chamfer', what: `one corner of a 40x30 plate, chamfer ${d}`, script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.chamfer(1, ${d}); extrude(sk, 10)`, exact: { volume: (1200 - d * d / 2) * H } })),
  ...[0.004, 0.003].map((r) => ({ id: `band-slot-r${r}`, feature: '.slot', what: `slot (0,0)-(10,0), r=${r}`, script: `const sk = sketch('top'); sk.slot([0,0],[10,0],${r}); extrude(sk, 10)`, exact: { volume: (2 * r * 10 + P * r * r) * H }, curved: true })),
  ...[0.002, 0.003, 0.005].map((d) => ({ id: `band-circle-across-${d}`, feature: '.circle', what: `circle across ${d}`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, 10)`, exact: { volume: P * d * d / 4 * 10 }, curved: true })),
  { id: 'slot-short-micro-r0.001', feature: '.slot', what: 'slot centres 0.003 apart, r=0.001', script: "const sk = sketch('top'); sk.slot([0,0],[0.003,0],0.001); extrude(sk, 10)", exact: { volume: (2 * 0.001 * 0.003 + P * 1e-6) * 10 }, curved: true },
];
