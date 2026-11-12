// gen.mjs <seed> <out.json>: drafts that come AFTER a draft the host leaves out of its second translation (a stale draft: the part was cut by a pocket whose result
// was not kept; or a draft on the pull of a sketch the sketch guard refuses). A = the later draft takes its neutral from a from: word on a part that has moved
// (must be refused by G-FROM, as it is when it stands alone); B = the later draft gives its neutral by number (must build, and equal the closed form); the left-out
// draft carries a from: word in half of the B cases (before the fix the later draft was judged by that word).
import fs from 'node:fs';
const seed = Number(process.argv[2]); let s = seed >>> 0;
const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)]; const r1 = (v) => Math.round(v * 10) / 10;
const BASE = "const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] }); const p = extrude(sk1, 10); const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });";
const BASE_V = 40 * 30 * 10 - 10 * 10 * 4;
const SOUP = `const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [38, 0] }, { k: 'line', id: 2, a: [38, 0], b: [38, 20] }, { k: 'line', id: 3, a: [38, 20], b: [0, 20] }, { k: 'line', id: 4, a: [0, 20], b: [0, 0] }]); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }, { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }]); const q = extrude(sk, 10);`;
const cases = []; let n = 0;
for (const cls of ['A', 'B']) for (const lead of ['stale', 'sketch']) for (let k = 0; k < 15; k++) {
  const W = pick([20, 30, 40]), D = pick([16, 20, 24]), H = pick([8, 10, 12]); const dz = pick([-12, -6, -3, 2, 5, 9, 15]); const a = pick([3, 5, 8, 10]); const face = pick(['right', 'front']); const word = pick(['bottom', 'top']);
  const z0 = -H / 2 + dz; const leadFrom = cls === 'B' && k % 2 === 0 ? pick(['bottom', 'top']) : null; const a1 = pick([3, 5]);
  const nB = r1(z0 + rnd() * H);
  const leadSrc = lead === 'stale' ? `${BASE} pocket(sk2, p, 4); draft(p.face('right'), ${a1}${leadFrom ? `, { from: '${leadFrom}' }` : ''});` : `${SOUP} draft(q.face('right'), ${a1}${leadFrom ? `, { from: '${leadFrom}' }` : ''});`;
  const later = cls === 'A' ? `draft(c.face('${face}'), ${a}, { from: '${word}' });` : `draft(c.face('${face}'), ${a}, { neutral: ${nB} });`;
  const script = `${leadSrc} const c = box(${W}, ${D}, ${H}); move(c, [100, 0, ${dz}]); ${later}`;
  const across = face === 'right' ? D : W; const tan = Math.tan(a * Math.PI / 180);
  const vol = (nn) => W * D * H - across * tan * H * (z0 + H / 2 - nn);
  cases.push({ id: `fu${seed}-${String(++n).padStart(3, '0')}-${cls}-${lead}-${face}-${cls === 'A' ? word : 'n' + nB}${leadFrom ? '-lead' + leadFrom : ''}`, cls, lead, script, model: null,
    expect: cls === 'A' ? 'refused G-FROM' : 'built', boxAsWritten: cls === 'B' ? vol(nB) : null, boxAtRootExtreme: cls === 'A' ? vol(word === 'bottom' ? -H / 2 : H / 2) : null, boxAtPartExtreme: cls === 'A' ? vol(word === 'bottom' ? z0 : z0 + H) : null, baseV: lead === 'stale' ? BASE_V : null });
}
fs.writeFileSync(process.argv[3], JSON.stringify(cases, null, 1)); console.log(cases.length, 'cases');
