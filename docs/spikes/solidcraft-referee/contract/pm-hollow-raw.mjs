// SPIKE, referee only. What the RAW engine does with a CLOSED hollow (outer box minus an inner box = a part with an internal cavity) that is repeated or mirrored,
// against exact volumes. No translator in the loop. This is the evidence behind the "closed hollow" rows of patterns-mirror.json: the contract translator refuses a
// hollow with no open side before any pattern or mirror is built (hollow-open parts are measured in the r4-hollow-open-* cases), and this file says whether that refusal
// is needed.   usage: SOLIDCRAFT_REFEREE_PKG=<pkg> bun pm-hollow-raw.mjs > pm-hollow-raw.txt
import { createRequire } from 'node:module';
const sc = createRequire(import.meta.url)(process.env.SOLIDCRAFT_REFEREE_PKG + '/solidcraft_referee.js');
const run = (c) => JSON.parse(sc.run(JSON.stringify({ commands: c })));
const hollow = (L, w, center, name = 'b') => [
  { command: 'solid.box', params: { length: L, width: L, height: L, center, body_name: name } },
  { command: 'solid.box', params: { length: L - 2 * w, width: L - 2 * w, height: L - 2 * w, center, operation: 'cut', targets: [name] } },
];
// exact volume of a set of closed hollow cubes (solid = outer minus cavity), by coordinate compression
const exact = (cubes) => {
  const cuts = [0, 1, 2].map((i) => [...new Set(cubes.flatMap((c) => [c.c[i] - c.L / 2, c.c[i] + c.L / 2, c.c[i] - c.L / 2 + c.w, c.c[i] + c.L / 2 - c.w]))].sort((a, b) => a - b));
  let v = 0;
  for (let i = 0; i + 1 < cuts[0].length; i++) for (let j = 0; j + 1 < cuts[1].length; j++) for (let k = 0; k + 1 < cuts[2].length; k++) {
    const m = [(cuts[0][i] + cuts[0][i + 1]) / 2, (cuts[1][j] + cuts[1][j + 1]) / 2, (cuts[2][k] + cuts[2][k + 1]) / 2];
    const inside = cubes.some((c) => m.every((x, d) => Math.abs(x - c.c[d]) < c.L / 2) && !m.every((x, d) => Math.abs(x - c.c[d]) < c.L / 2 - c.w));
    if (inside) v += (cuts[0][i + 1] - cuts[0][i]) * (cuts[1][j + 1] - cuts[1][j]) * (cuts[2][k + 1] - cuts[2][k]);
  }
  return v;
};
const show = (name, cmds, cubes) => {
  const r = run(cmds);
  if (!r.ok) { console.log(`${name.padEnd(34)} ENGINE ERROR ${JSON.stringify(r.failed).slice(0, 160)}`); return; }
  const bs = r.measure.bodies; const vol = bs.reduce((t, b) => t + b.volume_mm3, 0); const ex = exact(cubes);
  console.log(`${name.padEnd(34)} truck ${vol.toFixed(4)} (${bs.length} body, ${bs.reduce((t, b) => t + b.kernel.shells, 0)} shells) exact ${ex.toFixed(4)} rel ${(Math.abs(vol - ex) / ex).toExponential(2)}`);
};
const L = 30, w = 3;
const join = (n) => ({ command: 'solid.combine', params: { target: 'b', tools: Array.from({ length: n - 1 }, (_, i) => `b (${i + 2})`), operation: 'join' } });
const rect = (n, s) => ({ command: 'solid.pattern.rectangular', params: { bodies: ['b'], dir1: [1, 0, 0], count1: n, spacing1: s } });
show('closed hollow alone', hollow(L, w, [0, 0, 0]), [{ c: [0, 0, 0], L, w }]);
show('repeat x2 step 50 (apart)', [...hollow(L, w, [0, 0, 0]), rect(2, 50), join(2)], [0, 50].map((x) => ({ c: [x, 0, 0], L, w })));
show('repeat x2 step 30 (face contact)', [...hollow(L, w, [0, 0, 0]), rect(2, 30), join(2)], [0, 30].map((x) => ({ c: [x, 0, 0], L, w })));
show('repeat x2 step 15 (overlap)', [...hollow(L, w, [0, 0, 0]), rect(2, 15), join(2)], [0, 15].map((x) => ({ c: [x, 0, 0], L, w })));
show('repeat x2 step 8 (walls cross cavity)', [...hollow(L, w, [0, 0, 0]), rect(2, 8), join(2)], [0, 8].map((x) => ({ c: [x, 0, 0], L, w })));
show('repeat x3 step 12 (cavities cut)', [...hollow(L, w, [0, 0, 0]), rect(3, 12), join(3)], [0, 12, 24].map((x) => ({ c: [x, 0, 0], L, w })));
show('mirror left-right (face contact)', [...hollow(L, w, [40, 0, 0]), { command: 'solid.mirror', params: { bodies: ['b'], plane: { origin: [25, 0, 0], normal: [1, 0, 0] }, combine: true } }], [40, 10].map((x) => ({ c: [x, 0, 0], L, w })));
const ring = (n, R) => [
  ...hollow(20, 2, [R, 0, 0]),
  { command: 'solid.pattern.circular', params: { bodies: ['b'], axis: 'Z', count: n } },
  join(n),
];
const ringCubes = (n, R) => null;
show('repeatAround x4 (apart)', ring(4, 40), [[40, 0], [0, 40], [-40, 0], [0, -40]].map(([x, y]) => ({ c: [x, y, 0], L: 20, w: 2 })));
