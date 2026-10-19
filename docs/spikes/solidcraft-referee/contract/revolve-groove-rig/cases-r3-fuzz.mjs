// Round-3 seeded groove fuzz for the COST model (and the held-out check of it): targets x planes x tool shapes x angles, every case a script.
//   RG3_SEED=<n> RG3_N=<count> is read when the module loads (defaults 1 and 120).  Ids: fzc<seed>-<i>.  Deterministic.
let seed = Number(process.env.RG3_SEED ?? 1) >>> 0;
const N = Number(process.env.RG3_N ?? 120);
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const rf = (a, b, d = 1) => +(a + rnd() * (b - a)).toFixed(d);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const tag = Number(process.env.RG3_SEED ?? 1);
const TARGETS = {
  post: { decl: `const k = sketch('top'); k.circle(40); const t = extrude(k, 30);`, R: 20, h: 30, curved: true },
  boxG: { decl: `const k = sketch('top'); k.rect(60, 40, { at: [0, 0] }); const t = extrude(k, 30);`, R: 36, h: 30, curved: false },
  boxC: { decl: `const t = box(60, 40, 30);`, R: 36, h: 30, curved: false, centred: true },
  tube: { decl: `const k = sketch('top'); k.rect(10, 30, { at: [15, 15] }); const t = spin(k, 360);`, R: 20, h: 30, curved: true },
  join: { decl: `const k = sketch('top'); k.circle(40); const a = extrude(k, 30); const k2 = sketch('top', 30); k2.circle(20); const b = extrude(k2, 20); const t = union(a, b);`, R: 20, h: 50, curved: true },
};
const prof = (T, kind) => {
  const neg = rnd() < 0.15 ? -1 : 1;
  const u0 = rf(1, T.R - 1); const w = rf(1.5, 9); const v0 = rf(-3, T.h - 2); const h = rf(2, 14);
  const U = (x) => +(neg * x).toFixed(1);
  if (kind === 'flat') return `sk.rect(${w}, ${h}, { at: [${U(u0 + w / 2)}, ${+(v0 + h / 2).toFixed(1)}] });`;
  if (kind === 'cone') {
    const poly = rnd() < 0.5
      ? [[u0, v0], [u0 + w, v0], [u0, v0 + h]]
      : [[u0, v0], [u0 + w, v0], [u0 + w * 0.6, v0 + h], [u0, v0 + h]];
    return `sk.polygon(${JSON.stringify(poly.map(([x, y]) => [U(x), +y.toFixed(1)]))});`;
  }
  if (kind === 'circle') return `sk.circle(${+Math.max(2, w).toFixed(1)}, { at: [${U(u0 + w / 2)}, ${+(v0 + h / 2).toFixed(1)}] });`;
  // rounded: a rectangle with two corners rounded (arcs about off-axis centres: torus faces)
  return `sk.polygon(${JSON.stringify([[u0, v0], [u0 + w, v0], [u0 + w, v0 + h], [u0, v0 + h]].map(([x, y]) => [U(x), +y.toFixed(1)]))}); sk.round(${pick([1, 2, 3, 4])}, ${Math.max(0.5, +(Math.min(w, h) / 2.5).toFixed(1))});`;
};
export const cases = [];
for (let i = 0; i < N; i++) {
  const tkRaw = pick(['post', 'post', 'boxG', 'boxC', 'tube', 'join']);
  const tk = process.env.RG3_TARGETS ? pick(process.env.RG3_TARGETS.split(',')) : tkRaw;      // RG3_TARGETS=post,boxG,boxC restricts the targets (e.g. the cone accuracy fuzz)
  const T = TARGETS[tk];
  const plane = pick(['top', 'top', 'top', 'front', 'side']);
  const kindRaw = pick(['flat', 'flat', 'cone', 'circle', 'round']);
  const kind = process.env.RG3_KIND ?? kindRaw;                                                 // RG3_KIND=cone forces slanted-side rings
  const ang = pick([360, 360, 360, 180, 90, 270, 45, 135]);
  const off = plane === 'top' ? pick([0, 0, 0, rf(-4, 6)]) : pick([0, 0, rf(-5, 5)]);
  const src = `${T.decl} const sk = sketch('${plane}'${off ? ', ' + off : ''}); ${prof(T, kind)} groove(sk, t, ${ang});`;
  cases.push({ id: `fzc${tag}-${i}-${tk}-${plane}-${kind}-${ang}`, src, tag: { target: tk, plane, kind, ang } });
}
