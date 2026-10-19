// round 3: booleans/cuts that leave SEVERAL pieces (solidcraft names them "<body>", "<body> (1)"), with copied / moved / turned tools, then rigid transforms of the pieces.
// Every top-level shape is measured against live OCCT and brep-rs. Run: SOLIDCRAFT_REFEREE_PKG=<pkg> bun r3-lumps.mjs   (MT_NOEXTRA=1 = round-2 negative control)
import { writeFileSync } from 'node:fs';
import { runCase, runScript, mt } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guardT } from './translate-guard.mjs';
import { translateDoc as shippedT } from '../../phase0/translate.mjs';
// MT_SHIPPED=1: run the UNPATCHED phase0 translator (negative control for the shipped behaviour; it refuses move copy:true outright)
const guard = process.env.MT_SHIPPED === '1' ? shippedT : guardT;
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const A = `const a = box(60, 20, 10, { at: [0, 0, 0] });`;
const C = {
  'cut/copy-at-origin': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\ncut(a, c);`,
  'cut/x07 copy moved +20': `${A}\nconst b = box(10, 40, 20, { at: [-20, 0, 0] });\nconst c = move(b, [20, 0, 0], { copy: true });\ncut(a, c);`,
  'cut/tool moved (no copy)': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nmove(b, [5, 0, 0]);\ncut(a, b);`,
  'cut/turned tool 90': `${A}\nconst b = box(60, 20, 10, { at: [0, 0, 0] });\nturn(b, [0, 0, 90]);\ncut(a, b);`,
  'cut/turned tool 45': `${A}\nconst b = box(10, 60, 20, { at: [0, 0, 0] });\nturn(b, [0, 0, 45]);\ncut(a, b);`,
  'cut-split then move result': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nmove(r, [0, 30, 5]);`,
  'cut-split then turn result': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nturn(r, [10, 20, 30]);`,
  'cut-split then copy-move result': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nmove(r, [0, 40, 0], { copy: true });`,
  'cut-split then hole': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nhole(r, { across: 4 });`,
  'cut-split then round edge': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nround(r.edge('top', 'front'), 1);`,
  'cut-split then mirror': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nmirror(r, 'top-bottom');`,
  'cut-split then repeat': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nrepeat(r, { count: 2, step: [0, 40, 0] });`,
  'cut-split then join with box': `${A}\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nconst d = box(70, 4, 4, { at: [0, 0, 0] });\njoin(r, d);`,
  'cut by round tool (2 pieces)': `${A}\nconst b = cylinder(30, 30, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\ncut(a, c);`,
  'cut by round tool, then move result': `${A}\nconst b = cylinder(30, 30, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nmove(r, [0, 30, 0]);`,
  'cut by round tool, then turn result': `${A}\nconst b = cylinder(30, 30, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\nconst r = cut(a, c);\nturn(r, [0, 0, 30]);`,
  'cut by joined disjoint tools (3 pieces)': `${A}\nconst c1 = box(10, 40, 20, { at: [-20, 0, 0] });\nconst c2 = move(c1, [40, 0, 0], { copy: true });\nconst u = join(c1, c2);\ncut(a, u);`,
  'cut by joined disjoint tools, then turn result': `${A}\nconst c1 = box(10, 40, 20, { at: [-20, 0, 0] });\nconst c2 = move(c1, [40, 0, 0], { copy: true });\nconst u = join(c1, c2);\nconst r = cut(a, u);\nturn(r, [0, 0, 90]);`,
  'cut by one of two copies (2 pieces; second copy stays a separate shape)': `${A}\nconst b = box(6, 40, 20, { at: [-15, 0, 0] });\nmove(b, [30, 0, 0], { copy: true });\ncut(a, b);`,
  'pocket-split': `${A}\nconst k = sketch('top', 5);\nk.rect(10, 40);\nconst p = pocket(k, a, 10);\nmove(p, [0, 30, 0]);`,
  'pocket-split then turn': `${A}\nconst k = sketch('top', 5);\nk.rect(10, 40);\nconst p = pocket(k, a, 10);\nturn(p, [0, 0, 30]);`,
  'pocket-split alone': `${A}\nconst k = sketch('top', 5);\nk.rect(10, 40);\npocket(k, a, 10);`,
  'keep(a, two disjoint tools) 2 pieces': `${A}\nconst c1 = box(10, 40, 20, { at: [-20, 0, 0] });\nconst c2 = move(c1, [40, 0, 0], { copy: true });\nconst u = join(c1, c2);\nkeep(a, u);`,
  'join disjoint copy': `${A}\nconst b = move(a, [0, 40, 0], { copy: true });\njoin(a, b);`,
  'join disjoint copy then move': `${A}\nconst b = move(a, [0, 40, 0], { copy: true });\nconst u = join(a, b);\nmove(u, [10, 0, 0]);`,
  'join disjoint copy then turn': `${A}\nconst b = move(a, [0, 40, 0], { copy: true });\nconst u = join(a, b);\nturn(u, [0, 0, 20]);`,
  'cut (no split) by copy: control': `${A}\nconst b = cylinder(4, 30, { at: [0, 0, 0] });\nconst c = move(b, [5, 0, 0], { copy: true });\ncut(a, c);`,
  'cut by overlapping copies 1 piece: control': `${A}\nconst b = box(10, 10, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\ncut(a, c);`,
};
// OCCT's centre of mass of a two-solid compound is not trustworthy (keep case: OCCT com [0.94, 0.63, 0] for two pieces placed symmetrically
// about the origin). Closed forms override the oracle where noted.
const ANALYTIC = {
  'keep(a, two disjoint tools) 2 pieces': { vol: 4000, com: [0, 0, 0], diag: Math.hypot(50, 20, 10) },
};
// Round tool (diameter 30) splitting the box: the two cut patches straddle the cylinder seam, which truck splits at 0 AND 180 degrees and OCCT only at 0
// (r3-seam.mjs: turning the tool by 45/90/135 degrees gives SC 2 = OCCT 2 cylinder faces; 0 and 180 give SC 4 vs OCCT 3). Volume checked against the closed form.
const SEAM = new Set(['cut by round tool (2 pieces)', 'cut by round tool, then move result']);
const roundCut = 12000 - 10 * 2 * (10 * Math.sqrt(125) + 225 * Math.asin(10 / 15));
const out = [];
let nWrong = 0;
for (const [k, script] of Object.entries(C)) {
  const r0 = runScript(script);
  if (r0.errors.length) { console.log(k, 'SCRIPT ERROR', r0.errors[0].message); out.push({ name: k, script, errors: r0.errors.map((e) => e.message) }); continue; }
  const ids = mt.topLevel(r0.doc).map((x) => x.id);
  const g = runCase({ script, ids, translateFn: guard });
  const per = ids.map((id) => ({ id, v: verdict(g, id), t: g.truck[id], b: g.brep[id] }));
  const an = ANALYTIC[k];
  if (an) for (const p of per.filter((q) => q.v === 'FAIL')) {
    const m = g.measures[p.id];
    const dc = Math.max(...m.com.map((c, i) => Math.abs(c - an.com[i]))) / an.diag;
    p.analytic = { vol: an.vol, dVol: Math.abs(m.volume - an.vol) / an.vol, dCom: dc, comOcct: g.occt[p.id].com };
    if (p.analytic.dVol < 1e-9 && dc < 1e-9) p.v = 'PASS(analytic)';
  }
  if (SEAM.has(k)) for (const p of per.filter((q) => q.v === 'FAIL')) {
    const dClosed = Math.abs(p.t.volume - roundCut) / roundCut;
    p.seam = { closedFormVol: roundCut, dVolClosed: dClosed };
    if (p.t.dVol <= 3e-4 && p.t.dBbox <= 3e-4 && p.t.dCom <= 3e-5 && dClosed <= 3e-4 && p.t.faces === p.t.occtFaces + 1) p.v = 'PASS(seam-face-split)';
  }
  const worst = per.some((p) => p.v === 'FAIL') ? 'WRONG' : per.some((p) => p.v === 'REFUSED') ? 'REFUSED-some' : per.every((p) => p.v.startsWith('PASS')) ? 'ALL-PASS' : 'other';
  if (worst === 'WRONG') nWrong++;
  console.log(k.padEnd(44), worst.padEnd(13), per.map((p) => `${p.id}:${p.v}` + (p.t.refused ? `(${p.t.refused.slice(0, 150)})` : ` occt=${p.t.occtVolume?.toFixed(3)} dVol=${f(p.t.dVol)} dCom=${f(p.t.dCom)} f=${p.t.faces}/${p.t.occtFaces} bodies=${p.t.bodies?.length}`)).join(' | '));
  out.push({ name: k, script, worst, top: ids, per: per.map((p) => ({ id: p.id, v: p.v, refused: p.t.refused, occtVolume: p.t.occtVolume, scVolume: p.t.volume, dVol: p.t.dVol, dBbox: p.t.dBbox, dCom: p.t.dCom, faces: p.t.faces, occtFaces: p.t.occtFaces, bodies: p.t.bodies, brepDVol: p.b?.dVol, brepRefused: p.b?.refused, brepFaces: p.b?.faces, analytic: p.analytic, seam: p.seam })), cmds: g.commands.length });
}
console.log('WRONG scenarios:', nWrong);
writeFileSync(process.env.MT_SHIPPED === '1' ? 'r3-lumps-shipped-results.json' : process.env.MT_NOEXTRA === '1' ? 'r3-lumps-control-results.json' : 'r3-lumps-results.json', JSON.stringify(out, null, 1));
