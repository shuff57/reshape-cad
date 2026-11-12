// gen-tp.mjs <seed> <out.json>: a hole in part A while a second part B exists. A = a box centred on the origin. B = a box (or a peg) placed far away, beside A
// (touching or with a gap), on top of A, below A, overlapping A, or standing in the hole's path; made before or after A; sometimes drilled too.
// Closed form: A loses exactly the hole (bore, counterbore ring, countersink cone); B is unchanged (or loses its own plain through hole).
import fs from 'node:fs';
const seed = Number(process.argv[2]); let s = seed >>> 0;
const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)]; const PI = Math.PI;
const PLACES = ['far', 'beside-touch', 'beside-gap', 'top-touch', 'top-gap', 'below-touch', 'below-gap', 'overlap', 'in-path'];
const HOLES = ['through', 'blind', 'cbore', 'csink', 'through-x'];
const cases = []; let n = 0;
for (const place of PLACES) for (const hk of HOLES) for (const order of ['B-first', 'A-first']) for (let k = 0; k < 3; k++) {
  const W = pick([30, 40, 50]), D = pick([30, 40]), H = pick([12, 16, 20]); const r = pick([2, 3, 4]);
  const hx = hk === 'through-x' ? 0 : pick([0, 0, -6, 5]), hy = hk === 'through-x' ? 0 : pick([0, 0, 4, -5]);
  const deep = pick([4, 6, 8]); const Rm = r + pick([2, 3]); const cd = pick([2, 3]); const ang = pick([90, 90, 82, 100]);
  let holeOpt, removed;
  if (hk === 'through') { holeOpt = `{ across: ${2 * r}, at: [${hx}, ${hy}] }`; removed = PI * r * r * H; }
  else if (hk === 'blind') { holeOpt = `{ across: ${2 * r}, at: [${hx}, ${hy}], deep: ${deep} }`; removed = PI * r * r * deep; }
  else if (hk === 'cbore') { holeOpt = `{ across: ${2 * r}, at: [${hx}, ${hy}], counterbore: { across: ${2 * Rm}, deep: ${cd} } }`; removed = PI * r * r * H + PI * (Rm * Rm - r * r) * cd; }
  else if (hk === 'csink') { const h = (Rm - r) / Math.tan(ang / 2 * PI / 180); if (h > H - 1) continue; holeOpt = `{ across: ${2 * r}, at: [${hx}, ${hy}], countersink: { across: ${2 * Rm}, angle: ${ang} } }`; removed = PI * r * r * H + PI * h * (Rm * Rm + Rm * r + r * r) / 3 - PI * r * r * h; }
  else { holeOpt = `{ across: ${2 * r}, along: 'x' }`; removed = PI * r * r * W; }
  // B
  let bSrc, VB, bKind = 'box', bw = pick([10, 20, 30]), bd = pick([10, 20]), bh = pick([4, 8, 12]);
  const g = pick([0.5, 2, 5]);
  if (place === 'far') bSrc = `box(${bw}, ${bd}, ${bh}, { at: [${pick([200, -300, 500])}, ${pick([0, 250])}, ${pick([0, 40])}] })`;
  else if (place === 'beside-touch') bSrc = `box(${bw}, ${bd}, ${bh}, { at: [${W / 2 + bw / 2}, 0, 0] })`;
  else if (place === 'beside-gap') bSrc = `box(${bw}, ${bd}, ${bh}, { at: [${W / 2 + bw / 2 + g}, 0, 0] })`;
  else if (place === 'top-touch') { bw = W; bd = D; bSrc = `box(${bw}, ${bd}, ${bh}, { at: [0, 0, ${H / 2 + bh / 2}] })`; }
  else if (place === 'top-gap') { bw = W; bd = D; bSrc = `box(${bw}, ${bd}, ${bh}, { at: [0, 0, ${H / 2 + bh / 2 + g}] })`; }
  else if (place === 'below-touch') { bw = W + 10; bd = D + 10; bSrc = `box(${bw}, ${bd}, ${bh}, { at: [0, 0, ${-(H / 2 + bh / 2)}] })`; }
  else if (place === 'below-gap') { bw = W + 10; bd = D + 10; bSrc = `box(${bw}, ${bd}, ${bh}, { at: [0, 0, ${-(H / 2 + bh / 2 + g)}] })`; }
  else if (place === 'overlap') { bw = 10; bd = 10; bh = H; bSrc = `box(10, 10, ${H}, { at: [${W / 2 - 2}, ${D / 2 - 2}, 3] })`; }
  else { bKind = 'peg'; const pr = Math.max(1, r - 1); bh = H + 10; bSrc = `cylinder(${2 * pr}, ${bh}, { at: [${hx}, ${hy}, 0] })`; VB = PI * pr * pr * bh; }
  if (bKind === 'box') VB = bw * bd * bh;
  const both = bKind === 'box' && place !== 'overlap' && rnd() < 0.3; const r2 = 1.5;
  const aSrc = `box(${W}, ${D}, ${H})`;
  const script = (order === 'B-first' ? `const o = ${bSrc};\nconst a = ${aSrc};\n` : `const a = ${aSrc};\nconst o = ${bSrc};\n`) + `hole(a, ${holeOpt});` + (both ? `\nhole(o, { across: ${2 * r2} });` : '');
  const alone = `const a = ${aSrc};\nhole(a, ${holeOpt});`;
  const nameA = bKind === 'peg' ? 'b_box1' : order === 'B-first' ? 'b_box2' : 'b_box1'; const nameB = bKind === 'peg' ? 'b_cyl1' : order === 'B-first' ? 'b_box1' : 'b_box2';
  cases.push({ id: `tp${seed}-${String(++n).padStart(3, '0')}-${place}-${hk}-${order}${both ? '-both' : ''}`, place, hk, order, both, script, alone, model: null,
    nameA, nameB, VA0: W * D * H, wantA: W * D * H - removed, VB0: VB, wantB: both ? VB - PI * r2 * r2 * bh : VB, bCurved: bKind === 'peg' });
}
fs.writeFileSync(process.argv[3], JSON.stringify(cases, null, 1));
fs.writeFileSync(process.argv[3].replace(/\.json$/, '-alone.json'), JSON.stringify(cases.map((c) => ({ id: c.id, script: c.alone, model: null })), null, 1));
console.log(cases.length, 'cases');
