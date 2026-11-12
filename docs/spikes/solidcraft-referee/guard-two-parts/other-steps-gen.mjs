// gen.mjs <seed> <out.json>: a step on part A (a box centred on the origin) while a second part B exists. B is always box(17, 13, 7) (1547 mm3, 6 faces), placed far
// away, beside A (touching, gap), on top of A (touching), under A (touching), overlapping A, made before or after A. The step: hollow, draft, round, bevel,
// pocket, join, cut, move, mirror, repeat, groove. Two references: B must come back exactly as it was (1547, 6 faces), and A must come out exactly as the same
// step gives on A alone. Where it is simple the closed form of A is given too.
import fs from 'node:fs';
const seed = Number(process.argv[2]); let s = seed >>> 0;
const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)]; const PI = Math.PI; const tan = (d) => Math.tan(d * PI / 180);
const BW = 17, BD = 13, BH = 7; const VB = BW * BD * BH;
const PLACES = ['far', 'beside-touch', 'beside-gap', 'top-touch', 'below-touch', 'overlap', 'behind-touch'];
const STEPS = ['hollow-top', 'hollow-bottom', 'hollow-right', 'draft-right', 'draft-front-from', 'round', 'bevel', 'pocket', 'join', 'cut', 'move', 'mirror', 'repeat', 'groove', 'hollow-closed'];
const cases = []; let n = 0;
for (const step of STEPS) for (const place of PLACES) for (const order of ['B-first', 'A-first']) for (let k = 0; k < 2; k++) {
  const W = pick([30, 40, 50]), D = pick([30, 40]), H = pick([12, 16, 20]); const V = W * D * H;
  const g = pick([0.5, 2, 5]);
  const at = place === 'far' ? [pick([200, -300]), pick([0, 250]), pick([0, 40])]
    : place === 'beside-touch' ? [W / 2 + BW / 2, 0, 0] : place === 'beside-gap' ? [W / 2 + BW / 2 + g, 0, 0]
      : place === 'top-touch' ? [0, 0, H / 2 + BH / 2] : place === 'below-touch' ? [0, 0, -(H / 2 + BH / 2)]
        : place === 'overlap' ? [W / 2 - 3, D / 2 - 3, 2] : [0, D / 2 + BD / 2, 0];
  const bSrc = `const o = box(${BW}, ${BD}, ${BH}, { at: [${at.join(', ')}] });`;
  const aSrc = `const a = box(${W}, ${D}, ${H}, { at: [0, 0, 0] });`; // explicit: a shape with no at: is placed beside the one before it
  let stepSrc, wantA = null, bodiesA = 1;
  const t = pick([1.5, 2, 3]), ang = pick([3, 5, 8]), r = pick([1, 2, 3]);
  if (step === 'hollow-top') { stepSrc = `hollow(a, { wall: ${t}, open: 'top' });`; wantA = V - (W - 2 * t) * (D - 2 * t) * (H - t); }
  else if (step === 'hollow-bottom') { stepSrc = `hollow(a, { wall: ${t}, open: 'bottom' });`; wantA = V - (W - 2 * t) * (D - 2 * t) * (H - t); }
  else if (step === 'hollow-right') { stepSrc = `hollow(a, { wall: ${t}, open: 'right' });`; wantA = V - (W - t) * (D - 2 * t) * (H - 2 * t); }
  else if (step === 'hollow-closed') { stepSrc = `hollow(a, { wall: ${t} });`; wantA = V - (W - 2 * t) * (D - 2 * t) * (H - 2 * t); }
  else if (step === 'draft-right') { stepSrc = `draft(a.face('right'), ${ang});`; wantA = V; /* tilt about the mid height: what is added below equals what is removed above */ }
  else if (step === 'draft-front-from') { stepSrc = `draft(a.face('front'), ${ang}, { from: 'bottom' });`; wantA = V - W * tan(ang) * H * H / 2; }
  else if (step === 'round') { stepSrc = `round(a.edge('top', 'front'), ${r});`; wantA = V - (1 - PI / 4) * r * r * W; }
  else if (step === 'bevel') { stepSrc = `chamfer(a.edge('top', 'right'), ${r});`; wantA = V - r * r / 2 * D; }
  else if (step === 'pocket') { const pw = pick([8, 10]), pd = pick([6, 8]), dp = pick([3, 5]); stepSrc = `const sk = sketch('top', ${H / 2}); sk.rect(${pw}, ${pd}, { at: [-5, -4] }); pocket(sk, a, ${dp});`; wantA = V - pw * pd * dp; }
  else if (step === 'join') { stepSrc = `const c = box(10, 10, ${H}, { at: [${-W / 2}, 0, 0] }); union(a, c);`; wantA = V + 5 * 10 * H; }
  else if (step === 'cut') { stepSrc = `const c = box(10, 10, ${H + 10}, { at: [${-W / 2}, 0, 0] }); subtract(a, c);`; wantA = V - 5 * 10 * H; }
  else if (step === 'move') { stepSrc = `move(a, [${pick([-60, -80])}, ${pick([0, -50])}, ${pick([0, 3])}]);`; wantA = V; }
  else if (step === 'mirror') { stepSrc = `mirror(a, 'left-right');`; }
  else if (step === 'repeat') { stepSrc = `linearPattern(a, { count: 3, step: [${-(W + 10)}, 0, 0] });`; wantA = 3 * V; bodiesA = null; }
  else { stepSrc = `const sg = sketch('front'); sg.polygon([[${-W / 2}, ${H / 2 - 4}], [${-W / 2 + 6}, ${H / 2 - 4}], [${-W / 2 + 6}, ${H / 2 + 2}], [${-W / 2}, ${H / 2 + 2}]]); groove(sg, a, 180);`; }
  const script = (order === 'B-first' ? `${bSrc}\n${aSrc}\n` : `${aSrc}\n${bSrc}\n`) + stepSrc;
  cases.push({ id: `tq${seed}-${String(++n).padStart(3, '0')}-${step}-${place}-${order}`, step, place, order, script, alone: `${aSrc}\n${stepSrc}`, model: null, VA0: V, wantA, VB, bodiesA });
}
fs.writeFileSync(process.argv[3], JSON.stringify(cases, null, 1));
fs.writeFileSync(process.argv[3].replace(/\.json$/, '-alone.json'), JSON.stringify(cases.map((c) => ({ id: c.id, script: c.alone, model: null })), null, 1));
console.log(cases.length, 'cases');
