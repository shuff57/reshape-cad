// Pick-bearing features after move/turn: shipped phase0 translator vs the guarded prototype (translate-guard.mjs), against live OCCT + brep-rs.
// Run: cd contract/move-turn-harness && SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 bun k-pickguard.mjs
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const rows = [];
const tally = {};
function go(group, name, script, expect) {
  let a, b;
  try { a = runCase({ script }); b = runCase({ script, translateFn: guard }); } catch (e) { console.log(group, name, 'THROW', e.message); return; }
  if (a.errors.length) { console.log(group, name, 'SCRIPT ERROR', a.errors[0]); return; }
  const id = a.features.at(-1).id;
  const cls = (r) => { const v = verdict(r, id); return v === 'FAIL' ? 'WRONG' : v; };
  const va = cls(a), vb = cls(b);
  const ta = a.truck[id], tb = b.truck[id];
  const rec = { group, name, script, id, occtRefused: a.occtRefusals, brepDVol: a.brep[id]?.dVol, brepRefused: a.brep[id]?.refused,
    shipped: { v: va, dVol: ta.dVol, dBbox: ta.dBbox, dCom: ta.dCom, faces: ta.faces, occtFaces: ta.occtFaces, refused: ta.refused },
    guard: { v: vb, dVol: tb.dVol, dBbox: tb.dBbox, dCom: tb.dCom, faces: tb.faces, refused: tb.refused } };
  rows.push(rec);
  tally[group] = tally[group] ?? { shipped: {}, guard: {} };
  tally[group].shipped[va] = (tally[group].shipped[va] ?? 0) + 1;
  tally[group].guard[vb] = (tally[group].guard[vb] ?? 0) + 1;
  console.log(group.padEnd(26), name.padEnd(34), 'shipped', va.padEnd(8), va === 'WRONG' ? `dCom=${f(ta.dCom)} dVol=${f(ta.dVol)}` : va === 'REFUSED' ? '' : `dCom=${f(ta.dCom)}`, '| guard', vb.padEnd(8), vb === 'REFUSED' ? tb.refused.slice(0, 70) : `dVol=${f(tb.dVol)}`, a.occtRefusals && Object.keys(a.occtRefusals).length ? '| OCCT-REFUSES' : '');
}
const OFF = [[0,-30,0],[0,30,0],[30,0,0],[0,0,10],[0,0,-10],[5,5,5],[0,-15,0],[0,-30,5],[-30,-30,0],[0,0,0]];
for (const o of OFF) go('move+round', JSON.stringify(o), `const a = box(30, 30, 10);\nmove(a, [${o}]);\nround(a.edge('top', 'front'), 2);`);
for (const o of OFF.slice(0, 4)) go('move+bevel', JSON.stringify(o), `const a = box(30, 30, 10);\nmove(a, [${o}]);\nbevel(a.edge('top', 'front'), 2);`);
const OFFH = [[0,0,-10],[0,0,0],[0,0,4],[0,-30,4],[-30,0,0],[30,0,0],[5,5,5],[0,0,10],[100,0,0]];
for (const face of ['top', 'bottom', 'right', 'left', 'front', 'back']) {
  for (const o of OFFH) go(`move+hollow(${face})`, JSON.stringify(o), `const a = box(30, 20, 10);\nmove(a, [${o}]);\nhollow(a, { wall: 2, open: '${face}' });`);
}
const ANG = [[0,0,0],[180,0,0],[90,0,0],[0,0,90],[0,0,180],[0,180,0],[0,90,0],[10,20,30],[0,0,45]];
for (const face of ['top', 'bottom']) {
  for (const a of ANG) go(`turnD(pull)+hollow(${face})`, JSON.stringify(a), `const s = sketch('top');\ns.rect(30, 20);\nconst v = pull(s, 10);\nturn(v, [${a}]);\nhollow(v, { wall: 2, open: '${face}' });`);
}
for (const a of ANG.slice(1)) go('turnD(hole)+round', JSON.stringify(a), `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nturn(a, [${a}]);\nround(a.edge('top', 'front'), 2);`);
for (const a of ANG.slice(1)) go('turnD(join)+round', JSON.stringify(a), `const a = box(30, 20, 10);\nconst c = box(10, 10, 10, { at: [0, 0, 10] });\nconst v = join(a, c);\nturn(v, [${a}]);\nround(v.edge('top', 'front'), 1);`);
for (const o of [[0,0,0],[10,0,0],[0,0,-10],[30,0,0]]) go('move+draft(face)', JSON.stringify(o), `const a = box(30, 20, 10);\nmove(a, [${o}]);\ndraft(a.face('right'), 5);`);
for (const a of [[0,0,180],[90,0,0],[10,20,30]]) go('turnD+draft(face)', JSON.stringify(a), `const s = sketch('top');\ns.rect(30, 20);\nconst v = pull(s, 10);\nturn(v, [${a}]);\ndraft(v.face('right'), 5);`);
// controls: pick BEFORE the move/turn, and primitive's own turn
for (const o of [[10, 5, 3], [0, -30, 0]]) go('CTRL round->move', JSON.stringify(o), `const a = box(30, 20, 10);\nround(a.edge('top', 'front'), 2);\nmove(a, [${o}]);`);
for (const a of [[10,20,30], [0,0,180]]) go('CTRL round->turn', JSON.stringify(a), `const a = box(30, 20, 10);\nround(a.edge('top', 'front'), 2);\nturn(a, [${a}]);`);
for (const o of [[0,0,-10], [30,0,0], [5,5,5]]) go('CTRL hollow->move', JSON.stringify(o), `const a = box(30, 20, 10);\nhollow(a, { wall: 2, open: 'top' });\nmove(a, [${o}]);`);
for (const a of [[180,0,0], [90,0,0], [10,20,30]]) go('CTRL hollow->turn', JSON.stringify(a), `const a = box(30, 20, 10);\nhollow(a, { wall: 2, open: 'top' });\nturn(a, [${a}]);`);
for (const a of [[0,0,180],[10,20,30],[180,0,0],[90,0,0]]) go('CTRL turnPrim+round', JSON.stringify(a), `const a = box(30, 20, 10);\nturn(a, [${a}]);\nround(a.edge('top', 'front'), 2);`);
for (const a of [[180,0,0],[90,0,0],[10,20,30]]) go('CTRL turnPrim+hollow(top)', JSON.stringify(a), `const a = box(30, 20, 10);\nturn(a, [${a}]);\nhollow(a, { wall: 2, open: 'top' });`);
for (const a of [[0,0,90],[10,20,30]]) go('CTRL turnPrim+draft', JSON.stringify(a), `const a = box(30, 20, 10);\nturn(a, [${a}]);\ndraft(a.face('right'), 5);`);
// picks on the untouched original / on the moved copy
go('copy+pick-original', '[30,0,0]', `const a = box(30, 20, 10);\nconst b = move(a, [60, 0, 0], { copy: true });\nround(a.edge('top', 'front'), 2);`);
go('copy+pick-copy', '[60,0,0]', `const a = box(30, 20, 10);\nconst b = move(a, [60, 0, 0], { copy: true });\nround(b.edge('top', 'front'), 2);`);
writeFileSync('k-pickguard-results.json', JSON.stringify({ tally, rows }, null, 1));
console.log(JSON.stringify(tally, null, 0));
