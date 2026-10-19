import { L, out, save } from './common.mjs';
const R = (label, v) => { out.push({ label, ...v }); console.log(label.padEnd(54), JSON.stringify(v).slice(0, 460)); };
const run = (src, values) => { const r = L.rs.runScript(src, values ? { values } : {}); return r; };
const errs = (r) => r.errors.map(e => ({ message: e.message, line: e.line }));
let r = run(`const w = param('w', 40)\nbox(w, 30, 20)`);
R('param no opts', { errors: errs(r), namedParams: r.namedParams, box: r.doc.features[0].size });
r = run(`const w = param('w', 40, {min: 20, max: 80, step: 5, caption: 'Width'})\nbox(w, 30, 20)`);
R('param all opts', { errors: errs(r), namedParams: r.namedParams, params: r.params.filter(p => p.name === 'box1_width') });
r = run(`const w = param('w', 40)\nconst w2 = param('w', 50)\nbox(w, 30, 20)`);
R('duplicate name', { errors: errs(r) });
r = run(`const a = param('a', 10)\nconst s = param('s', 10)\nbox(a, s, s)`);
R('one param read into several slots', { errors: errs(r), slots: r.namedParams.map(p => [p.name, p.slots]) });
r = run(`const w = param('w', 40)\nbox(w, 30, 20)`, { box1_width: 55 });
R('values override (applyParam path)', { errors: errs(r), size: r.doc.features[0].size, namedParam: r.namedParams[0] });
r = run(`const w = param('w', 40, {min: 20, max: 80})\nbox(w, 30, 20)`, { box1_width: 500 });
R('values beyond declared max (500 > 80)', { errors: errs(r), size: r.doc.features[0].size });
r = run(`const w = param('w', 40, {min: 20, max: 80})\nbox(w, 30, 20)`, { box1_width: -5 });
R('values negative / below min', { errors: errs(r), size: r.doc.features[0].size });
r = run(`const w = param('w', 40, {min: 20, max: 80})\nbox(w, 30, 20)`, { nope_width: 5 });
R('values with an unknown key (ignored?)', { errors: errs(r), size: r.doc.features[0].size });
r = run(`const w = param('w', 10, {min: 2, max: 80})\nbox(w, 30, 20)`, { box1_width: Number.NaN });
R('values NaN', { errors: errs(r), size: r.doc.features[0].size });
// control flow is NOT re-evaluated
const cf = `const w = param('w', 20, {min: 5, max: 60})\nconst b = box(w, 30, 20)\nif (w > 30) { hole(b, { across: 6 }) } else { round(b.edge('top','right'), 2) }`;
const d0 = run(cf), d1 = run(cf, { box1_width: 50 });
R('control flow: branch pinned to the literal default', { kinds_default: d0.doc.features.map(f => f.kind), kinds_w50: d1.doc.features.map(f => f.kind), width_w50: d1.doc.features[0].size[0] });
// arithmetic on a param loses the link?
r = run(`const w = param('w', 20)\nbox(w * 2, 30, 20)`);
const rr = run(`const w = param('w', 20)\nbox(w * 2, 30, 20)`, { box1_width: 60 });
R('param in an expression (w*2)', { errors: errs(r), slots: r.namedParams.map(p => [p.name, p.slots]), sizeDefault: r.doc.features[0].size, sizeWithValues60: rr.doc.features[0].size, generated: L.cg.generatedParams(r.doc).filter(p => p.name === 'box1_width') });
r = run(`const w = param('w', 20)\nconst v = w + 5\nbox(v, 30, 20)`);
R('param in an expression (w+5)', { errors: errs(r), slots: r.namedParams.map(p => [p.name, p.slots]), size: r.doc.features[0].size });
r = run(`const n = param('n', 3, {min:1,max:8,step:1})\nconst b = box(10,10,10)\nrepeat(b,{count:n, step:[15,0,0]})`);
R('param as pattern count', { errors: errs(r), named: r.namedParams, pat: r.doc.features.find(f => f.kind === 'pattern') });
r = run(`const n = param('n', 3.5)\nconst b = box(10,10,10)\nrepeat(b,{count:n, step:[15,0,0]})`);
R('param count non-integer', { errors: errs(r) });
r = run(`const w = param('w', 'abc')\nbox(w, 30, 20)`);
R('param non-numeric value', { errors: errs(r) });
r = run(`const w = param(5, 40)\nbox(w, 30, 20)`);
R('param non-string name', { errors: errs(r) });
r = run(`const w = param('w', 40, {color: 'red'})\nbox(w, 30, 20)`);
R('param unknown option', { errors: errs(r) });
r = run(`const w = param('w', 40, {min: 50, max: 10})\nbox(w, 30, 20)`);
R('param min > max', { errors: errs(r), namedParams: r.namedParams });
r = run(`const w = param('w', 100, {min: 20, max: 80})\nbox(w, 30, 20)`);
R('param default outside [min,max]', { errors: errs(r), namedParams: r.namedParams });
// round trip text <-> params
r = run(`const w = param('w', 40, {min: 20, max: 80, caption: 'Width'})\nconst wall = param('wall', 2)\nconst b = box(w, 30, 20)\nhollow(b, {wall, open: 'top'})`);
const text = L.gen.toScript(r.doc, r.namedParams);
const back = run(text);
R('toScript(doc, namedParams) round trip', { text, backErrors: errs(back), sameDoc: JSON.stringify(back.doc.features) === JSON.stringify(r.doc.features), sameNamed: JSON.stringify(back.namedParams) === JSON.stringify(r.namedParams) });
// pocket depth param + named wall
r = run(`const d = param('d', 4)\nconst sk1 = sketch('top'); sk1.rect(40, 30, {at:[20,15]})\nconst plate = extrude(sk1, 10)\nconst sk2 = sketch('top', 10); sk2.rect(10, 10, {at:[20,15]})\nconst part = pocket(sk2, plate, d)\nround(part.edge('top', part.wall(sk2, 1)), 1)`);
R('pocket depth param + wall()', { errors: errs(r) });
// param used in the SAME slot as a rule value in a sketch
r = run(`const L1 = param('L1', 30, {min: 10, max: 60})\nconst sk = sketch('top')\nsk.geom([{k:'line',id:1,a:[0,0],b:[30,0]},{k:'line',id:2,a:[30,0],b:[30,20]},{k:'line',id:3,a:[30,20],b:[0,20]},{k:'line',id:4,a:[0,20],b:[0,0]}])\nsk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'},{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'},{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'},{k:'horizontal',a:1},{k:'vertical',a:2},{k:'horizontal',a:3},{k:'vertical',a:4},{k:'lock',a:1,aEnd:'a'},{k:'distance',a:1,aEnd:'a',b:1,bEnd:'b',value:L1}])\nextrude(sk, 5)`);
R('param bound to a sketch rule value', { errors: errs(r), named: r.namedParams?.map(p => [p.name, p.slots]) });
const rv = run(`const L1 = param('L1', 30, {min: 10, max: 60})\nconst sk = sketch('top')\nsk.geom([{k:'line',id:1,a:[0,0],b:[30,0]},{k:'line',id:2,a:[30,0],b:[30,20]},{k:'line',id:3,a:[30,20],b:[0,20]},{k:'line',id:4,a:[0,20],b:[0,0]}])\nsk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'},{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'},{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'},{k:'horizontal',a:1},{k:'vertical',a:2},{k:'horizontal',a:3},{k:'vertical',a:4},{k:'lock',a:1,aEnd:'a'},{k:'distance',a:1,aEnd:'a',b:1,bEnd:'b',value:L1}])\nextrude(sk, 5)`, { sk1_rule9_value: 45 });
if (!rv.errors.length) { const sd = L.cg.solveDoc(rv.doc); const ref = L.references(sd); const row = await L.scored(sd, { ref }); R('sketch-rule param value 45 -> SC vs OCCT', { outcome: row.outcome, sentence: row.sentence, score: row.score, truckV: row.truck?.volume, occtV: ref.occt?.volume, expected: 45 * 20 * 5 }); }
else R('sketch-rule param values run', { errors: errs(rv) });
save('resP.json');
