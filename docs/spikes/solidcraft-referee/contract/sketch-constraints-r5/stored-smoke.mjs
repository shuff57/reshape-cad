import * as lib from './lib.mjs';
import { CASES, plainRules, H } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch as guardedSketch, residualViolations } from './guard.mjs';
const only = process.argv[2]?.split(',');
for (const cs of CASES) {
  if (!cs.geoms || cs.legacy || cs.probe || (only && !only.some(o=>cs.id.includes(o)))) continue;
  const rules = plainRules(cs.rules);
  const t0 = Date.now();
  const g = guardedSketch({ geoms: cs.geoms, rules });
  if (!g.ok) { console.log(`${cs.expect==='refuse'?'EXP-REFUSE':'REFUSED'} ${cs.id} [${g.stage}] ${g.sentence}`); continue; }
  const c = classify(cs, g.body);
  const rv = residualViolations(cs.geoms, g.solved, rules);
  const worst = rv.all.filter(x=>x.driving&&x.residual!=null).sort((a,b)=>b.residual-a.residual)[0];
  console.log(`${c.cls.padEnd(8)} ${cs.id.padEnd(55)} dv ${c.dv.toExponential(1)} db ${c.db.toExponential(1)} worstRes ${worst?.kind} ${worst?.residual.toExponential(1)} profiles ${g.profiles}/${g.chosen?.length ?? '-'} ${Date.now()-t0}ms`);
}
