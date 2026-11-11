// gen-cross.mjs <seed> <out.json>: two holes drilled in different directions through different legs of an extruded L, U or T outline.
//   air:   the two drills' centre lines meet only outside the material (what G-CROSS refuses today although the holes never meet in the part)
//   solid: both drills pass through the same block of material and meet inside it (a true crossing: must stay refused)
// Closed form: outline area x height minus, for each hole, pi r^2 x the length of material its centre line passes through (valid for `air`, where the bores do not meet).
import { writeFileSync } from 'node:fs';
const seed = Number(process.argv[2] ?? 1); const OUT = process.argv[3];
let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)]; const r1 = (v) => Math.round(v * 10) / 10;
const PI = Math.PI; const cases = []; let n = 0;
const rec = (h) => (h.cb ? `, counterbore: { across: ${h.cb.across}, deep: ${h.cb.deep} }` : '');
for (const shape of ['L', 'U', 'T']) for (const kind of ['air', 'air', 'air', 'air', 'air', 'solid']) for (let rep = 0; rep < 4; rep++) {
  const W = pick([50, 60, 70, 80]), D = pick([40, 50, 60]), Hh = pick([20, 30, 40]), t1 = pick([8, 10, 12]), t2 = pick([8, 10, 12]);
  const rA = pick([1.5, 2, 2.5, 3]), rB = pick([1.5, 2, 2.5, 3]);
  // outline (x right, y up), legs: a base along x (0..W, 0..t1) and one or two uprights along y of width t2
  const poly = shape === 'L' ? [[0, 0], [W, 0], [W, t1], [t2, t1], [t2, D], [0, D]]
    : shape === 'U' ? [[0, 0], [W, 0], [W, D], [W - t2, D], [W - t2, t1], [t2, t1], [t2, D], [0, D]]
    : [[0, 0], [W, 0], [W, t1], [W / 2 + t2 / 2, t1], [W / 2 + t2 / 2, D], [W / 2 - t2 / 2, D], [W / 2 - t2 / 2, t1], [0, t1]];
  const area = shape === 'L' ? W * t1 + t2 * (D - t1) : shape === 'U' ? W * t1 + 2 * t2 * (D - t1) : W * t1 + t2 * (D - t1);
  const up = shape === 'T' ? [W / 2 - t2 / 2, W / 2 + t2 / 2] : [0, t2]; // the upright that hole B goes through
  const m = 1.5; // clearance from every edge
  const zA = r1(rA + m + rnd() * (Hh - 2 * (rA + m))); const zB = kind === 'air' && rep === 3 ? r1(Math.min(Hh - rB - m, Math.max(rB + m, zA + (rA + rB) * 0.6))) : zA; // rep 3: the drills overlap only partly in z
  const yB = r1(t1 + rB + m + rnd() * (D - t1 - 2 * (rB + m)));
  let xA, lenA;
  if (kind === 'air') { // hole A through the base, clear of the upright B goes through; in U also clear of the other upright
    const lo = shape === 'T' ? rA + m : up[1] + rA + m, hi = shape === 'T' ? up[0] - rA - m : (shape === 'U' ? W - t2 : W) - rA - m; xA = r1(lo + rnd() * (hi - lo)); lenA = t1;
  } else { xA = r1(up[0] + rA + m + rnd() * Math.max(0, up[1] - up[0] - 2 * (rA + m))); lenA = D; if (xA - rA < up[0] + 0.5 || xA + rA > up[1] - 0.5) continue; } // through the upright's whole height: meets B inside it
  const cb = kind === 'air' && rep === 2 ? { across: r1(2 * rA + 3), deep: 2 } : null;
  // B's material: the upright it starts in; in U it also passes the far upright; A (air) is in the base only
  const lenB = shape === 'U' ? 2 * t2 : t2;
  const closed = area * Hh - PI * rA * rA * lenA - PI * rB * rB * lenB - (cb ? PI * ((cb.across / 2) ** 2 - rA * rA) * cb.deep : 0);
  const script = `const sk = sketch('top')\nsk.polygon(${JSON.stringify(poly)})\nconst part = extrude(sk, ${Hh})\nhole(part, { across: ${2 * rA}, along: 'y', at: [${r1(xA - W / 2)}, ${r1(zA - Hh / 2)}]${rec({ cb })} })\nhole(part, { across: ${2 * rB}, along: 'x', at: [${r1(yB - D / 2)}, ${r1(zB - Hh / 2)}] })`;
  cases.push({ id: `cx${seed}-${String(++n).padStart(3, '0')}-${shape}-${kind}${cb ? '-cbore' : ''}${zB !== zA ? '-zpart' : ''}`, shape, kind, W, D, Hh, t1, t2, rA, rB, xA, zA, yB, zB, cb, model: null, closed: { P: closed }, script });
}
writeFileSync(OUT, JSON.stringify(cases, null, 1)); console.log(cases.length, 'cases');
