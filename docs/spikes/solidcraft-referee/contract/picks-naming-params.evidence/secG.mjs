import { L, out, save } from './common.mjs';
const docs = [
 ['box+turn+whole round', `const b = box(40,30,20,{at:[5,-3,2]})\nround(b, 2)\nturn(b,[0,0,15])`],
 ['cylinder+round+turn', `const c = cylinder(20,30,{at:[4,-2,1]})\nround(c, 2)\nturn(c,[10,0,0])`],
 ['cone+turn', `const c = cone(20,30,{at:[4,-2,1]})\nturn(c,[0,20,0])`],
 ['ring', `ring(40,10,{at:[3,2,1]})`],
 ['sphere', `sphere(30,{at:[3,2,1]})`],
 ['prism+turn', `const p = prism(6,30,20,{at:[3,2,1]})\nturn(p,[0,0,20])`],
 ['wedge+turn', `const w = wedge(30,20,10,{at:[3,2,1]})\nturn(w,[0,0,20])`],
 ['plate sketch extrude pocket', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\nconst sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] })\npocket(sk2, plate, 4)`],
 ['circle sketch extrude', `const sk1 = sketch('top'); sk1.circle(20, { at: [5, 3] })\nextrude(sk1, 15)`],
 ['rounded rect sketch extrude', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] }); sk1.round(1, 4)\nextrude(sk1, 10)`],
 ['polygon sketch extrude', `const sk1 = sketch('top'); sk1.polygon([[0,0],[40,0],[30,25],[0,20]])\nextrude(sk1, 10)`],
 ['revolve', `const sk = sketch('front'); sk.polygon([[5,0],[15,0],[15,20],[5,20]])\nspin(sk, 270)`],
 ['groove', `const b = box(40,40,20)\nconst sk = sketch('front'); sk.polygon([[0,15],[8,15],[8,22],[0,22]])\ngroove(sk, b, 180)`],
 ['hole', `const b = box(40,30,20,{at:[5,-3,2]})\nhole(b,{across:6, deep:10, at:[3,2]})`],
 ['hole counterbore', `const b = box(40,30,20,{at:[5,-3,2]})\nhole(b,{across:6, counterbore:{across:12, deep:4}})`],
 ['hole countersink', `const b = box(40,30,20,{at:[5,-3,2]})\nhole(b,{across:6, countersink:{across:12, angle:90}})`],
 ['holes corners', `const b = box(50,40,20,{at:[5,-3,2]})\nholes(b,{across:5, apart:[30,20]})`],
 ['hollow', `const b = box(40,30,20,{at:[5,-3,2]})\nhollow(b,{wall:2, open:'top'})`],
 ['round edge', `const b = box(40,30,20,{at:[5,-3,2]})\nround(b.edge('top','right'), 2)`],
 ['bevel edge', `const b = box(40,30,20,{at:[5,-3,2]})\nbevel(b.edge('top','right'), 2)`],
 ['draft face', `const b = box(40,30,20,{at:[5,-3,2]})\ndraft(b.face('right'), 5)`],
 ['move', `const b = box(40,30,20)\nmove(b,[10,5,3])`],
 ['turn of built part', `const b = box(40,30,20)\nhole(b,{across:6})\nturn(b,[0,0,25])`],
 ['repeat linear', `const b = box(10,10,10)\nrepeat(b,{count:3, step:[15,0,0]})`],
 ['repeatAround', `const b = box(10,10,10,{at:[20,0,0]})\nrepeatAround(b,{count:4, axis:'z'})`],
 ['union', `const a = box(30,30,10)\nconst b = box(20,20,20,{at:[10,0,5]})\njoin(a,b)`],
 ['subtract', `const a = box(30,30,10)\nconst b = cylinder(10,30,{at:[5,0,0]})\ncut(a,b)`],
 ['intersect', `const a = box(30,30,10)\nconst b = sphere(30,{at:[5,0,0]})\nkeep(a,b)`],
 ['mirror', `const b = box(20,10,10,{at:[15,0,0]})\nmirror(b,'left-right')`],
 ['datum plane sketch', `const p = plane('top', 7)\nconst sk = sketch(p); sk.rect(20,10,{at:[0,0]})\nextrude(sk, 6)`],
];
const summary = [];
let nSlots = 0;
for (const [label, src] of docs) {
  const r = L.fromScript(src);
  if (r.errors.length) { console.log('SCRIPT ERROR', label, r.errors[0].message); out.push({label, scriptError: r.errors[0].message}); continue; }
  const gp = L.cg.generatedParams(r.doc);
  const base = JSON.stringify(r.doc.features);
  for (const p of gp) {
    nSlots++;
    let nv;
    const nm = p.name;
    if (/_r[xyz]$/.test(nm) || /angle|totalangle/i.test(nm)) nv = p.value + 10;
    else if (/_[xyz]$/.test(nm) || /offset|step[xyz]|p\d+[uv]$/.test(nm)) nv = p.value + 3;
    else if (/count/.test(nm)) nv = p.value + 1;
    else nv = p.value * 1.25;
    nv = Math.min(p.max, Math.max(p.min, nv));
    if (Math.abs(nv - p.value) < 1e-12) nv = Math.min(p.max, Math.max(p.min, p.value - Math.max(1, Math.abs(p.value) * 0.1)));
    const d2 = L.cg.applyParam(r.doc, nm, nv);
    const changed = JSON.stringify(d2.features) !== base;
    const back = L.cg.generatedParams(d2).find(q => q.name === nm)?.value;
    const rt = typeof back === 'number' && Math.abs(back - nv) < 1e-9;
    const rec = { label, slot: nm, from: p.value, to: nv, changed, roundTrip: rt, back };
    if (!changed) { rec.cls = 'NOOP-applyParam'; out.push(rec); summary.push(rec); console.log(label.padEnd(30), nm.padEnd(22), 'applyParam changed nothing'); continue; }
    const doc2 = L.cg.solveDoc(d2);
    const ref = L.references(doc2);
    const row = await L.scored(doc2, { ref });
    const refRef = Object.keys(ref.occtRefusals ?? {}).length + Object.keys(ref.brepRefusals ?? {}).length;
    rec.cls = row.outcome === 'PASS' ? 'PASS' : row.outcome === 'REFUSED' ? (refRef || ref.occt?.refused ? 'REFUSED(refs also refuse)' : 'REFUSED(refs build)') : row.outcome;
    rec.sentence = row.sentence; rec.score = row.score; rec.truckV = row.truck?.volume; rec.occtV = ref.occt?.volume; rec.brepV = ref.brep?.volume;
    out.push(rec); summary.push(rec);
    const flag = rec.cls === 'PASS' ? '' : '  <<<<';
    console.log(label.padEnd(30), nm.padEnd(22), `${p.value} -> ${nv}`.padEnd(22), rt ? 'rt-ok' : `RT-BAD(${back})`, rec.cls, row.score ? `dVol ${L.sci(row.score.dVol)} dCOM ${L.sci(row.score.dCom)}` : (row.sentence ?? '').slice(0, 160), flag);
  }
}
console.log('slots', nSlots);
const by = {}; for (const s of summary) by[s.cls] = (by[s.cls] ?? 0) + 1;
console.log(JSON.stringify(by));
console.log('roundtrip bad:', summary.filter(s => !s.roundTrip && s.changed).map(s=>s.label+':'+s.slot+'('+s.to+'->'+s.back+')').join(', '));
save('resG.json');
