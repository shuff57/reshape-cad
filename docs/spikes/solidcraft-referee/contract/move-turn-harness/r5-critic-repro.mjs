// round 5: the critic's exact cone repro, shipped phase0 translator vs the guard (rigid-motion invariant + chain repair), vs live OCCT and brep-rs.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5-critic-repro.mjs
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const e = (v) => (typeof v === 'number' ? v.toExponential(2) : String(v));
const CASES = {
  'critic chain: cone at, turn, move, move': `let a = cone(6, 15, { at: [-15, 13, 6] });\nturn(a, [45, 30, 135]);\nmove(a, [-15, 30, -13]);\nmove(a, [14, -8, -4]);`,
  'fz7-18 style: copy of a copy of a cone': `let a = cone(8, 15);\nlet c1 = move(a, [20, 0, 0], { copy: true });\nlet c2 = move(c1, [0, 20, 0], { copy: true });\nlet c3 = move(c2, [0, 0, 20], { copy: true });\nlet c4 = move(c3, [-20, 0, 0], { copy: true });\nlet c5 = move(c4, [0, -20, 0], { copy: true });\nlet c6 = move(c5, [0, 0, -20], { copy: true });`,
  'six plain moves of a cone': `let a = cone(8, 15);\nmove(a, [1, 0, 0]);\nmove(a, [0, 1, 0]);\nmove(a, [0, 0, 1]);\nmove(a, [1, 0, 0]);\nmove(a, [0, 1, 0]);\nmove(a, [0, 0, 1]);`,
  'one move to the same place (control)': `let a = cone(8, 15);\nmove(a, [2, 2, 2]);`,
  'cylinder, six moves (control)': `let a = cylinder(8, 15);\nmove(a, [1, 0, 0]);\nmove(a, [0, 1, 0]);\nmove(a, [0, 0, 1]);\nmove(a, [1, 0, 0]);\nmove(a, [0, 1, 0]);\nmove(a, [0, 0, 1]);`,
};
const out = {};
for (const [name, script] of Object.entries(CASES)) {
  const s = runCase({ script }); const g = runCase({ script, translateFn: guard });
  const ids = s.features.map((x) => x.id).filter((id) => s.truck[id]);
  const last = s.features.at(-1).id;
  const show = (r, id) => { const t = r.truck[id]; return t.refused ? `REFUSED "${t.refused}"` : `${verdict(r, id)} vol=${t.volume.toFixed(4)} occt=${t.occtVolume.toFixed(4)} dVol=${e(t.dVol)} dCom=${e(t.dCom)} dBbox=${e(t.dBbox)} faces=${t.faces}/${t.occtFaces}`; };
  out[name] = { script, shipped: show(s, last), guard: show(g, last), brep: s.brep[last] };
  console.log('##', name, '\n  shipped:', out[name].shipped, '\n  guard  :', out[name].guard, '\n  brep   :', e(s.brep[last].dVol), 'faces', s.brep[last].faces);
  if (name.startsWith('fz7')) for (const id of ids) console.log('    ', id, 'shipped', show(s, id).slice(0, 110), '| guard', show(g, id).slice(0, 110));
}
writeFileSync('r5-critic-repro-results.json', JSON.stringify(out, null, 1));
