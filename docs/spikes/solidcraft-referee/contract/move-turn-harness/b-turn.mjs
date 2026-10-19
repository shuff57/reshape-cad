import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { line, verdict } from './cases.mjs';
const P = {
  box: (at) => `box(20, 10, 6${at})`,
  cylinder: (at) => `cylinder(12, 20${at})`,
  cone: (at) => `cone(14, 18${at})`,
  ring: (at) => `ring(30, 6${at})`,
  prism: (at) => `prism(6, 20, 12${at})`,
  wedge: (at) => `wedge(20, 10, 8${at})`,
};
const ANG = [[90,0,0],[0,90,0],[0,0,90],[30,0,0],[0,40,0],[0,0,50],[30,40,50],[-30,-40,-50],[360,0,0],[0,0,0],[180,180,180],[45,45,45],[10,20,300],[0,-90,0]];
const AT = [['', ''], [', { at: [5, 2, -1] }', 'at']];
const rows = [];
let n = 0;
const summary = {};
for (const [k, mk] of Object.entries(P)) for (const [atS, atN] of AT) for (const a of ANG) {
  const script = `const s = ${mk(atS)};\nturn(s, [${a.join(', ')}]);`;
  const t0 = Date.now();
  const r = runCase({ script });
  if (r.errors.length) { rows.push({ k, at: atN, a, error: r.errors }); continue; }
  const id = r.features.at(-1).id;
  console.error(`${k}${atN} ${JSON.stringify(a)} ${Date.now() - t0}ms`);
  const v = verdict(r, id);
  const t = r.truck[id];
  const kinds = r.features.map((x) => x.kind).join('>');
  rows.push({ k, at: atN, a, kinds, v, dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom, faces: t.faces, occtFaces: t.occtFaces, brepDVol: r.brep[id]?.dVol, brepDBbox: r.brep[id]?.dBbox, brepRefused: r.brep[id]?.refused, tr: t.refused, occtVol: t.occtVolume });
  const key = `${k}${atN ? '@' : ''}/${kinds}`;
  summary[key] = summary[key] ?? { n: 0, PASS: 0, FAIL: 0, REFUSED: 0 };
  summary[key].n++; summary[key][v] = (summary[key][v] ?? 0) + 1;
  if (v !== 'PASS') console.log(line(`turn/${k}${atN ? '@' : ''}${JSON.stringify(a)}`, r, [id]));
  n++;
}
writeFileSync('b-turn-results.json', JSON.stringify({ rows, summary }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('cases', n);
const worst = (f) => Math.max(...rows.filter((r) => r.v === 'PASS').map((r) => r[f] ?? 0));
console.log('worst PASS dVol', worst('dVol'), 'dBbox', worst('dBbox'), 'dCom', worst('dCom'), 'brep dVol', Math.max(...rows.map(r=>r.brepDVol??0)), 'brep dBbox', Math.max(...rows.map(r=>r.brepDBbox??0)));
