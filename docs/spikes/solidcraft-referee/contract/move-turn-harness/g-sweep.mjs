import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const tally = {};
const go = (group, name, script) => {
  const r = runCase({ script });
  if (r.errors.length) { console.log(group, name, 'SCRIPT ERROR', r.errors[0]); return; }
  const id = r.features.at(-1).id; const v = verdict(r, id); const t = r.truck[id];
  tally[group] = tally[group] ?? {}; tally[group][v] = (tally[group][v] ?? 0) + 1;
  console.log(group.padEnd(22), name.padEnd(18), v.padEnd(8), v === 'REFUSED' ? t.refused.slice(0, 90) : `dVol=${f(t.dVol)} dCom=${f(t.dCom)} brepDVol=${f(r.brep[id]?.dVol)}`);
};
for (const a of [[0,0,90],[0,0,180],[0,0,270],[180,0,0],[0,180,0],[0,0,45],[90,0,0],[0,90,0],[180,180,0],[10,20,30]]) {
  go('turn-derived+round', JSON.stringify(a), `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nturn(a, [${a}]);\nround(a.edge('top', 'front'), 2);`);
}
for (const a of [[0,0,180],[10,20,30]]) go('turn-prim+round', JSON.stringify(a), `const a = box(30, 20, 10);\nturn(a, [${a}]);\nround(a.edge('top', 'front'), 2);`);
for (const o of [[0,-30,0],[0,30,0],[30,0,0],[0,0,10],[0,0,-10],[5,5,5],[0,-15,0],[0,-30,5],[-30,-30,0],[0,0,0]]) {
  go('move+round', JSON.stringify(o), `const a = box(30, 30, 10);\nmove(a, [${o}]);\nround(a.edge('top', 'front'), 2);`);
}
console.log(JSON.stringify(tally));
