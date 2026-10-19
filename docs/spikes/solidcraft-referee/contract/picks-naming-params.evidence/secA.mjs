import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = [];
async function T(label, src, { values, consumer, control = true, cmd } = {}) {
  const r = L.fromScript(src, values);
  if (r.errors.length) { const o = { label, src, scriptError: r.errors[0].message, line: r.errors[0].line }; out.push(o); console.log(label.padEnd(44), 'SCRIPT ERROR:', r.errors[0].message); return o; }
  const ref = L.references(r.doc);
  const row = await L.scored(r.doc, { ref });
  let ctl; 
  const cid = consumer ?? r.doc.features.filter(f=>['fillet','shell','draft'].includes(f.kind)).at(-1)?.id;
  if (control && cid && row.outcome !== 'REFUSED' && ref.occt?.bbox) ctl = L.mirrorControl(row, cid, ref);
  const o = { label, src, ...L.strip(row), control: ctl, namesText: r.doc.features.filter(f=>f.edge||f.open||f.face).map(f=>tn_text(f.edge??f.open??f.face)) };
  out.push(o);
  console.log(label.padEnd(44), L.brief(row), ctl ? `| ctl ${JSON.stringify({rej:ctl.rejected, dCom: ctl.dCom?.toExponential?.(1), refused: ctl.refused?.slice(0,60), skipped: ctl.skipped})}` : '');
  return o;
}
const tn_text = (n) => L.tn.formatName(n);
const words = ['top','bottom','front','back','left','right'];
const B = `const b = box(40, 30, 20, { at: [5, -3, 2] })\n`;
console.log('--- hollow open = each face word (asymmetric box off-centre)');
for (const w of words) await T(`hollow open ${w}`, B + `hollow(b, { wall: 2, open: '${w}' })`);
console.log('--- draft face(word)');
for (const w of words) await T(`draft face(${w}) 5deg`, B + `draft(b.face('${w}'), 5)`);
console.log('--- 12 edges between face words, round 2');
const pairs = [['top','front'],['top','back'],['top','left'],['top','right'],['bottom','front'],['bottom','back'],['bottom','left'],['bottom','right'],['front','left'],['front','right'],['back','left'],['back','right']];
for (const [a,b2] of pairs) await T(`round edge(${a},${b2})`, B + `round(b.edge('${a}','${b2}'), 2)`);
console.log('--- bevel 12 edges');
for (const [a,b2] of pairs) await T(`bevel edge(${a},${b2})`, B + `bevel(b.edge('${a}','${b2}'), 2)`);
writeFileSync('resA.json', JSON.stringify(out, null, 1));
