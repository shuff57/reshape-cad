// Round 2: the script-text counterpart of the ModelDoc-only cap/swept rows: face words on the result of pull()/extrude().
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const R = `const sk = sketch('top'); sk.rect(40, 30, { at: [20, 15] })\nconst p = pull(sk, 20)\n`;
const C = `const sk = sketch('top'); sk.circle(20, { at: [20, 15] })\nconst p = pull(sk, 20)\n`;
const T3 = `const sk = sketch('top'); sk.polygon([[0,0],[40,0],[20,30]])\nconst p = pull(sk, 20)\n`;
const FR = `const sk = sketch('front'); sk.rect(40, 30, { at: [20, 15] })\nconst p = pull(sk, 20)\n`;
const cases = [];
for (const w of ['top', 'bottom', 'front', 'back', 'left', 'right']) cases.push([`rect pull: hollow open ${w}`, R + `hollow(p,{wall:2,open:'${w}'})`]);
for (const w of ['front', 'back', 'left', 'right']) cases.push([`rect pull: draft ${w} 5`, R + `draft(p.face('${w}'),5)`]);
for (const [a, b] of [['top', 'right'], ['top', 'front'], ['bottom', 'left'], ['front', 'right']]) cases.push([`rect pull: round edge(${a},${b}) 2`, R + `round(p.edge('${a}','${b}'),2)`]);
cases.push(['rect pull: bevel edge(top,back) 2', R + `bevel(p.edge('top','back'),2)`]);
for (const w of ['top', 'bottom']) cases.push([`circle pull: hollow open ${w}`, C + `hollow(p,{wall:2,open:'${w}'})`]);
cases.push(['circle pull: round edge(top,side)', C + `round(p.edge('top','side'),2)`]);
cases.push(['circle pull: draft face(side)', C + `draft(p.face('side'),5)`]);
cases.push(['triangle pull: hollow open top', T3 + `hollow(p,{wall:2,open:'top'})`]);
cases.push(['triangle pull: hollow open bottom', T3 + `hollow(p,{wall:2,open:'bottom'})`]);
cases.push(['triangle pull: draft face(left)', T3 + `draft(p.face('left'),5)`]);
cases.push(['triangle pull: draft face(right)', T3 + `draft(p.face('right'),5)`]);
cases.push(['triangle pull: draft face(front)', T3 + `draft(p.face('front'),5)`]);
cases.push(['front-plane rect pull: hollow open front', FR + `hollow(p,{wall:2,open:'front'})`]);
cases.push(['front-plane rect pull: hollow open back', FR + `hollow(p,{wall:2,open:'back'})`]);
cases.push(['front-plane rect pull: round edge(front,top)', FR + `round(p.edge('front','top'),2)`]);
const rows = [];
for (const [label, src] of cases) {
  const f = L.fromScript(src); if (f.errors.length) { console.log(label.padEnd(44), 'SCRIPT ERR', f.errors[0].message); rows.push({ label, src, scriptError: f.errors[0].message }); continue; }
  const ref = L.references(f.doc); const row = await L.scored(f.doc, { ref });
  const o = { label, src, outcome: row.outcome, sentence: row.sentence, sc: row.truck?.volume, dVol: row.score?.dVol, dCom: row.score?.dCom, ref: row.score?.reference, faces: row.score?.faces, occt: ref.occt?.volume ?? ref.occt?.refused, brep: ref.brep?.volume ?? ref.brep?.refused };
  rows.push(o);
  console.log(label.padEnd(44), row.outcome.padEnd(12), 'SC', row.truck?.volume?.toFixed(4), 'dVol', row.score?.dVol?.toExponential(1), 'dCom', row.score?.dCom?.toExponential(1), row.score?.reference ?? '', '| OCCT', typeof o.occt === 'number' ? o.occt.toFixed(4) : String(o.occt).slice(0, 40), row.sentence ? '| ' + row.sentence.slice(0, 140) : '');
}
writeFileSync('r2j-pull-words.json', JSON.stringify(rows, null, 1));
