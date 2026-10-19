// Round 2: a pick AFTER move()/turn(): which sentence the page gives, and what OCCT builds.
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const cases = [
  ['box, move, round edge(top,right)', `const b=box(40,30,20)\nmove(b,[10,5,0])\nround(b.edge('top','right'),2)`],
  ['box, turn, round edge(top,right)', `const b=box(40,30,20)\nturn(b,[0,0,30])\nround(b.edge('top','right'),2)`],
  ['box, move, bevel edge(top,right)', `const b=box(40,30,20)\nmove(b,[10,5,0])\nbevel(b.edge('top','right'),2)`],
  ['box+hole, move, round edge(top,right)', `const b=box(40,30,20)\nhole(b,{across:6})\nmove(b,[10,5,0])\nround(b.edge('top','right'),2)`],
  ['box+hole, turn, round edge(top,right)', `const b=box(40,30,20)\nhole(b,{across:6})\nturn(b,[0,0,20])\nround(b.edge('top','right'),2)`],
  ['box, move, hollow open top (control)', `const b=box(40,30,20)\nmove(b,[10,5,0])\nhollow(b,{wall:2,open:'top'})`],
  ['box, turn, hollow open top (control)', `const b=box(40,30,20)\nturn(b,[0,0,30])\nhollow(b,{wall:2,open:'top'})`],
  ['round first, then move (control: order the other way)', `const b=box(40,30,20)\nround(b.edge('top','right'),2)\nmove(b,[10,5,0])`],
];
const rows = [];
for (const [label, src] of cases) {
  const f = L.fromScript(src); if (f.errors.length) { console.log(label, 'ERR', f.errors[0].message); continue; }
  const ref = L.references(f.doc); const row = await L.scored(f.doc, { ref });
  const o = { label, src, outcome: row.outcome, sentence: row.sentence, sc: row.truck?.volume, dVol: row.score?.dVol, occt: ref.occt?.volume ?? ref.occt?.refused, occtRef: ref.occtRefusals, brep: ref.brep?.volume };
  rows.push(o); console.log(label.padEnd(54), row.outcome.padEnd(9), 'SC', row.truck?.volume?.toFixed(4), 'dVol', row.score?.dVol?.toExponential(1), '| OCCT', typeof o.occt === 'number' ? o.occt.toFixed(4) : o.occt, '| BREP', o.brep?.toFixed?.(4)); if (row.sentence) console.log('       ', row.sentence.slice(0, 330));
}
writeFileSync('r2h-move-turn.json', JSON.stringify(rows, null, 1));
