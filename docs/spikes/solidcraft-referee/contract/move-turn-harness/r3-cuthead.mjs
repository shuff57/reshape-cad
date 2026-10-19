// round 3: pocket()/groove() on a shape that is LATER moved or turned. OCCT/brep-rs move the shape stored under the doc target (the uncut one);
// the round-2 translator moved the cut body (head-advance). Every top-level shape is measured. MT_NOCUTGUARD=1 = round-2 behaviour.
import { writeFileSync } from 'node:fs';
import { runCase, runScript, mt } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const B = `const a = box(30, 20, 10);\nconst k = sketch('top');\nk.circle(8);`;
const P = `const b1 = box(30, 20, 10, { at: [0, 0, 0] });\nconst b2 = box(10, 10, 10, { at: [0, 0, 8] });\nconst a = join(b1, b2);\nconst k = sketch('top');\nk.circle(8);`;
const C = {
  'box;pocket;move(a)': `${B}\npocket(k, a, 5);\nmove(a, [5, 5, 5]);`,
  'box;pocket;move(a,copy)': `${B}\npocket(k, a, 5);\nmove(a, [40, 0, 0], { copy: true });`,
  'box;pocket;move(pocket result)': `${B}\nconst p = pocket(k, a, 5);\nmove(p, [5, 5, 5]);`,
  'box;pocket;turn(a) [own rotate]': `${B}\npocket(k, a, 5);\nturn(a, [0, 0, 30]);`,
  'join;pocket;turn(a) [RotateFeature]': `${P}\npocket(k, a, 5);\nturn(a, [0, 0, 30]);`,
  'join;pocket;turn(pocket result)': `${P}\nconst p = pocket(k, a, 5);\nturn(p, [0, 0, 30]);`,
  'join;pocket;move(a)': `${P}\npocket(k, a, 5);\nmove(a, [5, 5, 5]);`,
  'box;groove;move(a)': `const a = box(40, 40, 20);\nconst g = sketch('front');\ng.rect(4, 8, { at: [7, 0] });\ngroove(g, a, 360);\nmove(a, [5, 5, 5]);`,
  'box;groove control (no move)': `const a = box(40, 40, 20);\nconst g = sketch('front');\ng.rect(4, 8, { at: [7, 0] });\ngroove(g, a, 360);`,
  'box;hole;move(a) control': `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nmove(a, [5, 5, 5]);`,
  'box;hole;pocket;move(a)': `${B}\nhole(a, { across: 4 });\npocket(k, a, 5);\nmove(a, [5, 5, 5]);`,
  'box;pocket;pocket;move(a)': `${B}\npocket(k, a, 3);\npocket(k, a, 5);\nmove(a, [5, 5, 5]);`,
  'box;move;pocket control': `const a = box(30, 20, 10);\nmove(a, [5, 5, 5]);\nconst k = sketch('top');\nk.circle(8);\npocket(k, a, 5);`,
  'box;pocket control (no move)': `${B}\npocket(k, a, 5);`,
};
const out = [];
for (const [name, script] of Object.entries(C)) {
  const r0 = runScript(script);
  if (r0.errors.length) { console.log(name, 'SCRIPT ERROR', r0.errors[0].message); out.push({ name, script, errors: r0.errors.map((e) => e.message) }); continue; }
  const ids = r0.doc.features.filter((x) => !['sketch', 'datum'].includes(x.kind)).map((x) => x.id);
  const g = runCase({ script, ids, translateFn: guard });
  const top = mt.topLevel(r0.doc).map((x) => x.id);
  const per = ids.map((id) => ({ id, top: top.includes(id), v: verdict(g, id), t: g.truck[id], b: g.brep[id] }));
  console.log(name.padEnd(38), 'kinds', r0.doc.features.map((x) => x.kind + (x.target ? '>' + x.target : '')).join(' ').padEnd(60), '|', per.filter((p) => p.top).map((p) => `${p.id}:${p.v}${p.t.refused ? '(' + p.t.refused.slice(0, 200) + ')' : ` dVol=${f(p.t.dVol)} dCom=${f(p.t.dCom)}`}`).join(' | '), '| OCCT-refuses', JSON.stringify(g.occtRefusals));
  out.push({ name, script, top, per: per.map((p) => ({ id: p.id, top: p.top, v: p.v, refused: p.t.refused, occtVolume: p.t.occtVolume, scVolume: p.t.volume, dVol: p.t.dVol, dBbox: p.t.dBbox, dCom: p.t.dCom, faces: p.t.faces, occtFaces: p.t.occtFaces, brepVol: p.b?.volume, brepRefused: p.b?.refused })), occtRefusals: g.occtRefusals });
}
writeFileSync(process.env.MT_NOCUTGUARD === '1' ? 'r3-cuthead-control-results.json' : 'r3-cuthead-results.json', JSON.stringify(out, null, 1));
