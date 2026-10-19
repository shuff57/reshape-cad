// Round 6 hold-out for the arc error estimate (arcError in sketch-geometry.guard.mjs): 120 random rectangles w x h with 1 to 4 bulged edges, bulge magnitude log-uniform in
// [1e-5, 0.5] with a random sign, pull 2 to 200. Seeded (mulberry32, seed 20261018) so the set is reproducible. NOT used to fit DEFLECTION (that was cases-shallow.mjs).
// The oracle is live OCCT (exact arcs); the curved bar is 3e-4.
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = mulberry32(20261018);
const U = (a, b) => a + (b - a) * rnd();
const sig = (v) => Number(v.toPrecision(3));
export const cases = [];
for (let i = 0; i < 120; i++) {
  const w = sig(U(8, 80)); const h = sig(U(8, 80)); const H = sig(U(2, 200));
  const n = 1 + Math.floor(rnd() * 4); const edges = [0, 1, 2, 3].sort(() => rnd() - 0.5).slice(0, n);
  const bulges = {};
  for (const e of edges) { const mag = sig(10 ** U(-5, Math.log10(0.5))); bulges[e] = rnd() < 0.5 ? mag : -mag; }
  const edit = (d) => { const sk = d.features.find((f) => f.kind === 'sketch'); sk.bulges = JSON.parse(JSON.stringify(bulges)); return d; };
  cases.push({ id: `shh-${String(i).padStart(3, '0')}`, feature: 'edge bulges', what: `${w} x ${h} rectangle, bulges ${JSON.stringify(bulges)}, pulled ${H}`, curved: true, script: `const sk = sketch('top'); sk.polygon([[0,0],[${w},0],[${w},${h}],[0,${h}]]); pull(sk, ${H})`, edit });
}
