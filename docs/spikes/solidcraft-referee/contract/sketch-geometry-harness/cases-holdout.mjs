// Hold-out for the curve-size rule: circle sizes and heights that were NOT in cases-grid.mjs (the grid fixed the envelope in sketch-geometry.guard.mjs; these points
// check it). Any case the guard accepts must be within the curved bar 3e-4 of the closed form with no volume floor (build-rows.mjs checks it and fails if not).
const P = Math.PI;
const D = [0.3, 0.7, 1.5, 3, 7, 15];
const Hs = [3, 30, 300, 3000];
export const cases = [
  ...D.flatMap((d) => Hs.map((h) => ({ id: `holdout-circle-d${d}-h${h}`, feature: 'curve size hold-out', what: `circle across ${d} pulled ${h}`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, ${h})`, exact: { volume: P * d * d / 4 * h }, curved: true }))),
  ...[3, 8].flatMap((r) => [50, 500].map((h) => ({ id: `holdout-slot-r${r}-h${h}`, feature: 'curve size hold-out', what: `slot (0,0)-(30,0) r=${r} pulled ${h}`, script: `const sk = sketch('top'); sk.slot([0,0],[30,0],${r}); extrude(sk, ${h})`, exact: { volume: (2 * r * 30 + P * r * r) * h }, curved: true }))),
  ...[0.3, 2].flatMap((r) => [30, 300].map((h) => ({ id: `holdout-round-r${r}-h${h}`, feature: 'curve size hold-out', what: `60 x 40 plate with all four corners rounded r=${r} pulled ${h}`, script: `const sk = sketch('top'); sk.rect(60, 40); sk.round(1, ${r}); sk.round(2, ${r}); sk.round(3, ${r}); sk.round(4, ${r}); extrude(sk, ${h})`, exact: { volume: (2400 - 4 * r * r * (1 - P / 4)) * h }, curved: true }))),
];
