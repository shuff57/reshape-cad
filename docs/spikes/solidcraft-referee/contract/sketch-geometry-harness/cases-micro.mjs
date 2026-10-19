const P = Math.PI;
export const cases = [0.5, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002].flatMap((d) => [
  { id: `circle-across-${d}`, feature: '.circle', what: `circle across ${d} (h 10)`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, 10)`, exact: { volume: P * d * d / 4 * 10 }, curved: true },
  { id: `circle-across-${d}-h1`, feature: '.circle', what: `circle across ${d} (h ${d})`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, ${d})`, exact: { volume: P * d * d / 4 * d }, curved: true },
]);
