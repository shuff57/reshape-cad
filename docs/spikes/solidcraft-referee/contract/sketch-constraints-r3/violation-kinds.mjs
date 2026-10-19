import * as lib from './lib.mjs';
import { CASES, roughen, plainRules } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const [id, frac, N] = [process.argv[2], +process.argv[3], +process.argv[4]];
const cs = CASES.find(c=>c.id===id);
const kinds = {};
for (let k=0;k<N;k++){
  const st = roughen(cs.geoms, cs.rules, `${id}#${k}#${frac}`, frac);
  const g = ladderSketch({geoms: st, rules: plainRules(cs.rules)});
  if (!g.ok && g.stage==='branch') { const ks = [...new Set(g.detail.violations.map(v=>v.kind))].join('+'); kinds[ks]=(kinds[ks]??0)+1; if (kinds[ks]<=1) console.log(k, ks, g.detail.violations.map(v=>v.text).slice(0,2)); }
  else if (!g.ok) kinds['stage:'+g.stage]=(kinds['stage:'+g.stage]??0)+1;
}
console.log(JSON.stringify(kinds));
