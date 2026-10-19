// round 5: hole in a cone before and after move/turn. The critic: "Move or turn followed by hole on a cone is refused generically". Characterise it, then see if one plain sentence is true.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5-conehole.mjs
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const NL = String.fromCharCode(10);
const base = [['cone(14, 18)', 'across 3'], ['cone(20, 24)', 'across 4'], ['cone(10, 30)', 'across 2'], ['cone(14, 18, { at: [5, 5, 5] })', 'across 3 (cone built at a point)']];
const MODS = { none: [], 'move [5,5,5]': ['move(a, [5, 5, 5])'], 'move [0,0,0.5]': ['move(a, [0, 0, 0.5])'], 'turn [0,30,0]': ['turn(a, [0, 30, 0])'], 'turn [90,0,0]': ['turn(a, [90, 0, 0])'], 'turn [0,0,45] (about its own axis)': ['turn(a, [0, 0, 45])'] };
const rows = [];
for (const [mk, label] of base) {
  const across = label.match(/across (\d+)/)[1];
  for (const [mname, mods] of Object.entries(MODS)) {
    for (const order of ['hole-then-mod', 'mod-then-hole']) {
      if (mname === 'none' && order === 'mod-then-hole') continue;
      const L = [`const a = ${mk};`, ...(order === 'hole-then-mod' ? [`hole(a, { across: ${across} });`, ...mods.map((m) => m + ';')] : [...mods.map((m) => m + ';'), `hole(a, { across: ${across} });`])];
      const script = L.join(NL);
      const s = runCase({ script }); const g = runCase({ script, translateFn: guard });
      const id = s.features.at(-1).id; const t = s.truck[id];
      const rec = { mk, across, mod: mname, order, shipped: verdict(s, id), shippedWhy: t.refused ? t.refused.replace(/\s+/g, ' ').slice(0, 140) : null, guard: verdict(g, id), guardSentence: g.truck[id].refused ?? null, dVol: t.dVol, dCom: t.dCom, occtRefused: s.occtRefusals, brepRefused: s.brep[id]?.refused ?? null };
      rows.push(rec);
      console.log(mk.padEnd(32), across, mname.padEnd(36), order.padEnd(14), 'shipped', rec.shipped.padEnd(8), rec.shippedWhy ? '(engine refused)' : `dVol=${t.dVol.toExponential(1)}`, '| guard', rec.guard, Object.keys(rec.occtRefused).length ? '| OCCT-REFUSES' : '', rec.brepRefused ? '| brep-rs refuses' : '');
    }
  }
}
writeFileSync('r5-conehole-results.json', JSON.stringify(rows, null, 1));
