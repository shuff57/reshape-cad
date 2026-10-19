// Two fillets on adjacent edges of a 40x30x10 plate, every (first, second) radius in {1,2,3,4,5,6}.
//   V: top/front then front/right (the second edge is vertical, length 10, shares the FRONT face with the first)
//   H: top/front then top/right   (the second edge is 30 long, shares the TOP face with the first)
// closed = box minus the union of the two removal prisms (the literal mitre), independent of every kernel.
const PI = Math.PI;
const integ = (f, a, b, n = 100000) => { const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2); return s * h / 3; };
const Af = (r) => (1 - PI / 4) * r * r;
const ext = (s, w) => (w >= s ? 0 : s - Math.sqrt(Math.max(0, s * s - (s - w) * (s - w))));
const VP = 40 * 30 * 10;
const mitre = (a, b, Lb) => VP - Af(a) * 40 - Af(b) * Lb + integ((w) => ext(a, w) * ext(b, w), 0, Math.min(a, b));
const PLATE = "const sk = sketch('top')\nsk.rect(40, 30, { at: [20, 15] })\nconst pad = extrude(sk, 10)\n";
export const CASES = [];
for (const a of [1, 2, 3, 4, 5, 6]) for (const b of [1, 2, 3, 4, 5, 6]) {
  CASES.push({ id: `sg-V-a${a}-b${b}`, row: 'seqgrid', a, b, kind: 'V', script: `${PLATE}round(pad.edge('top','front'), ${a})\nround(pad.edge('front','right'), ${b})`, closed: () => mitre(a, b, 10) });
  CASES.push({ id: `sg-H-a${a}-b${b}`, row: 'seqgrid', a, b, kind: 'H', script: `${PLATE}round(pad.edge('top','front'), ${a})\nround(pad.edge('top','right'), ${b})`, closed: () => mitre(a, b, 30) });
}
