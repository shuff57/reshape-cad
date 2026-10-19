// Case list of the revolve-groove contract. base() = the 34 FreeCAD-ref revolutions + groove/angle cases of round 1 (moved here
// from run-rg2.mjs), then extra-cases.mjs (X-, P-, Y- cases of round 1), then round-2 cases (Z-) below.
import path from 'node:path';
import { extra, extra2 } from './extra-cases.mjs';
import { round2 } from './cases-r2.mjs';
export function allCases(RG, VARIANTS) {
const cases = [];
for (const v of VARIANTS.filter((v) => v.piece === 'revolution')) cases.push({ id: v.id, src: v.ours, ref: path.join(RG, 'variants/refs', `ref-${v.id}.json`) });
const CYL = `const sk1 = sketch('top'); sk1.circle(40); const cyl = extrude(sk1, 30);`;
const G = (id, plane, rect, ang, ref, extra = '') => cases.push({ id, src: `${CYL} const sk2 = sketch('${plane}'${extra}); sk2.rect(${rect}); groove(sk2, cyl, ${ang});`, ref });
G('groove-coaxial-360', 'top', '2, 5, { at: [19, 12.5] }', 360, path.join(RG, 'baseline/ref-groove-coaxial.json'));
G('groove-half-turn-180', 'top', '2, 5, { at: [19, 12.5] }', 180, path.join(RG, 'baseline/ref-groove-half-turn.json'));
// groove on the top plane: the profile is laid in (u, n) = (x, z); the rect centre [19,12.5] means x 18..20, z 11..14? (sketch v -> the n coordinate)
G('groove-90', 'top', '2, 5, { at: [19, 12.5] }', 90);
G('groove-270', 'top', '2, 5, { at: [19, 12.5] }', 270);
G('groove-45-inner', 'top', '4, 6, { at: [12, 15] }', 45);
G('groove-180-interior-ring', 'top', '4, 6, { at: [10, 15] }', 180);
cases.push({ id: 'groove-box-yz-half', src: `const b = box(60,60,40); const s = sketch('side', 4); s.polygon([[5,-10],[12,-10],[12,6],[5,6]]); groove(s, b, 270);` });
cases.push({ id: 'groove-box-front-180', src: `const b = box(60,60,40); const s = sketch('front'); s.polygon([[5,-10],[12,-10],[12,6],[5,6]]); groove(s, b, 180);` });
cases.push({ id: 'groove-box-top-360-full', src: `const b = box(60,60,40); const s = sketch('top'); s.polygon([[5,-10],[12,-10],[12,6],[5,6]]); groove(s, b, 360);` });
cases.push({ id: 'groove-box-top-90-straddle', src: `const b = box(60,60,40); const s = sketch('top'); s.polygon([[5,-10],[12,-10],[12,6],[5,6]]); groove(s, b, 90);` });
// angle validation (script layer), expect sentences
for (const [id, src] of [
  ['spin-0', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 0);`],
  ['spin-721', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 721);`],
  ['spin--721', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, -721);`],
  ['spin-720', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 720);`],
  ['spin--720', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, -720);`],
  ['spin-400-script', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 400);`],
  ['spin--400', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, -400);`],
  ['spin-1', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 1);`],
  ['spin-90-asym', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 90);`],
  ['spin--90-asym', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, -90);`],
  ['spin-360-script', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 360);`],
  ['spin-180-script', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, 180);`],
  ['spin-string', `const s = sketch('top'); s.rect(10,30,{at:[15,15]}); spin(s, '90');`],
  ['groove-0', `${CYL} const s2 = sketch('top'); s2.rect(2,5,{at:[19,12.5]}); groove(s2, cyl, 0);`],
  ['groove--90', `${CYL} const s2 = sketch('top'); s2.rect(2,5,{at:[19,12.5]}); groove(s2, cyl, -90);`],
  ['groove-361', `${CYL} const s2 = sketch('top'); s2.rect(2,5,{at:[19,12.5]}); groove(s2, cyl, 361);`],
  ['groove-400', `${CYL} const s2 = sketch('top'); s2.rect(2,5,{at:[19,12.5]}); groove(s2, cyl, 400);`],
]) cases.push({ id, src, scriptOnly: !/spin-(1|90|-90|360|180|400|720|-720|-400)-?|spin-400-script|spin--400|spin-720|spin--720|spin-1$|spin-90-asym|spin--90-asym|spin-360-script|spin-180-script/.test(id) });

  cases.push(...extra(RG), ...extra2(), ...round2(RG));
  return cases;
}
