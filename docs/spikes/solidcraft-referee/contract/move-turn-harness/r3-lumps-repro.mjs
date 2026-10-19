// round 3: multi-lump booleans after a copied/moved/turned tool. Reproduces the dropped second body with the round-2 guard translator.
import { runCase, runScript, mt } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(2) : v);
const C = {
  'cut:copy-at-origin': `const a = box(60, 20, 10, { at: [0, 0, 0] });\nconst b = box(10, 40, 20, { at: [0, 0, 0] });\nconst c = move(b, [0, 0, 0], { copy: true });\ncut(a, c);`,
  'cut:x07': `const a = box(60, 20, 10, { at: [0, 0, 0] });\nconst b = box(10, 40, 20, { at: [-20, 0, 0] });\nconst c = move(b, [20, 0, 0], { copy: true });\ncut(a, c);`,
  'cut:turned-self': `const a = box(60, 20, 10, { at: [0, 0, 0] });\nconst b = box(60, 20, 10, { at: [0, 0, 0] });\nturn(b, [0, 0, 90]);\ncut(a, b);`,
};
for (const [k, script] of Object.entries(C)) {
  const r0 = runScript(script);
  if (r0.errors.length) { console.log(k, 'SCRIPT ERROR', r0.errors[0].message); continue; }
  const id = r0.doc.features.at(-1).id;
  const g = runCase({ script, ids: [id], translateFn: guard });
  const t = g.truck[id];
  console.log(k.padEnd(22), verdict(g, id), t.refused ? 'REFUSED ' + t.refused : `occt=${t.occtVolume} sc=${t.volume} dVol=${f(t.dVol)} dCom=${f(t.dCom)} bodies=${JSON.stringify(t.bodies)} faces=${t.faces}/${t.occtFaces}`, '| brep', JSON.stringify(g.brep[id]).slice(0, 120));
}
