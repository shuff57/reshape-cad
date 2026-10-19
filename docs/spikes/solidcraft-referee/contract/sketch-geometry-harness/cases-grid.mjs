// Calibration grid for the curve-size rule (sketch-geometry.guard.mjs tessError / guardPull): the truck mesh tolerance follows the size of the WHOLE part,
// so the volume error of a curved shape depends on (radius / part diagonal), not on its volume. Measured: circle d=0.1 pulled 10 is 0.18% off, pulled 1000 is 58% off.
// circles (area fraction 1), a hole in a 100 x 100 plate, and a round on a 100 x 100 plate; each pulled H.
const P = Math.PI;
const D = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
const Hs = [1, 10, 100, 1000];
export const cases = [
  ...D.flatMap((d) => Hs.map((h) => ({ id: `grid-circle-d${d}-h${h}`, feature: 'curve size grid', what: `circle across ${d} pulled ${h}`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, ${h})`, exact: { volume: P * d * d / 4 * h }, curved: true }))),
  ...[0.2, 0.5, 1, 2, 5].flatMap((d) => [10, 100].map((h) => ({ id: `grid-hole-d${d}-h${h}`, feature: 'curve size grid', what: `100 x 100 plate with a hole across ${d} pulled ${h}`, script: `const sk = sketch('top'); sk.rect(100, 100); sk.circle(${d}, { at: [20, 20] }); extrude(sk, ${h})`, exact: { volume: (10000 - P * d * d / 4) * h }, curved: true }))),
  ...[0.1, 0.5, 1, 5].flatMap((r) => [10, 100].map((h) => ({ id: `grid-round-r${r}-h${h}`, feature: 'curve size grid', what: `100 x 100 plate with corner 1 rounded r=${r} pulled ${h}`, script: `const sk = sketch('top'); sk.rect(100, 100); sk.round(1, ${r}); extrude(sk, ${h})`, exact: { volume: (10000 - r * r * (1 - P / 4)) * h }, curved: true }))),
  ...[0.25, 1].flatMap((r) => [10, 100].map((h) => ({ id: `grid-slot-r${r}-h${h}`, feature: 'curve size grid', what: `slot (0,0)-(20,0) r=${r} pulled ${h}`, script: `const sk = sketch('top'); sk.slot([0,0],[20,0],${r}); extrude(sk, ${h})`, exact: { volume: (2 * r * 20 + P * r * r) * h }, curved: true }))),
];
