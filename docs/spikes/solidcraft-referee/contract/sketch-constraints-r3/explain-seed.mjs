import * as lib from './lib.mjs';
import { CASES, roughen, plainRules } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch } from './guard.mjs';
import { loopsOf, loopSignature } from './branch.mjs';
const [id, frac, k] = [process.argv[2], +process.argv[3], +process.argv[4]];
const cs = CASES.find(c=>c.id===id);
const st = roughen(cs.geoms, cs.rules, `${id}#${k}#${frac}`, frac);
const g = ladderSketch({geoms: st, rules: plainRules(cs.rules)});
const f = (p)=>p.map(v=>+v.toFixed(2));
console.log('tried', JSON.stringify(g.tried), g.ok, g.sentence);
console.log('start'); for (const x of st) console.log(' ', x.k, x.id, JSON.stringify(x.a?f(x.a):x.c), x.b?JSON.stringify(f(x.b)):'');
if (g.ok) { console.log('solved'); for (const x of g.solved) console.log(' ', x.k, x.id, JSON.stringify(x.a?f(x.a):x.c), x.b?JSON.stringify(f(x.b)):''); console.log(classify(cs,g.body,st), g.body.volume, g.body.bbox);}
const L = loopSignature(st, loopsOf(st, plainRules(cs.rules))); console.log('S loops', JSON.stringify(L.map(l=>({closed:l.closed, area:l.area, simple:l.simple, joints:l.joints.map(j=>+j.turn.toFixed(2))}))));
