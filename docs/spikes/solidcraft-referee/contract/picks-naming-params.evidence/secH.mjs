import { L, out, save } from './common.mjs';
const log = (...a) => console.log(...a);
const R = (label, v) => { out.push({ label, ...v }); log(label.padEnd(52), JSON.stringify(v).slice(0, 330)); };
const run = (src) => { const r = L.fromScript(src); if (r.errors.length) throw new Error(r.errors[0].message); return r.doc; };
const doc = run(`const b = box(40, 30, 20, { at: [5, -3, 2] })
hole(b, { across: 6 })
round(b.edge('top', 'right'), 2)
hollow(b, { wall: 2, open: 'bottom' })`);
log(doc.features.map(f => f.id + ':' + f.kind).join(' '));
const mc = L.mc;
R('null doc', mc.checkModel({ expect: [{ kind: 'box' }] }, null));
R('box width/depth/height derived', mc.checkModel({ expect: [{ kind: 'box', width: 40, depth: 30, height: 20 }] }, doc));
R('box size tuple', mc.checkModel({ expect: [{ kind: 'box', size: [40, 30, 20] }] }, doc));
R('box wrong width', mc.checkModel({ expect: [{ kind: 'box', width: 41 }] }, doc));
R('tolerance default .01: 40.005 pass', mc.checkModel({ expect: [{ kind: 'box', width: 40.005 }] }, doc));
R('tolerance default .01: 40.02 fail', mc.checkModel({ expect: [{ kind: 'box', width: 40.02 }] }, doc));
R('tolerance custom .05: 40.02 pass', mc.checkModel({ expect: [{ kind: 'box', width: 40.02 }], tolerance: 0.05 }, doc));
R('hole across', mc.checkModel({ expect: [{ kind: 'hole', across: 6 }] }, doc));
R('hole across wrong', mc.checkModel({ expect: [{ kind: 'hole', across: 8 }] }, doc));
R('fillet round radius 2 + edge text', mc.checkModel({ expect: [{ kind: 'fillet', style: 'fillet', size: 2, edge: 'box1.edge[box1.face[+x] ^ box1.face[+z]]' }] }, doc));
R('fillet wrong edge text', mc.checkModel({ expect: [{ kind: 'fillet', edge: 'box1.edge[box1.face[+x] ^ box1.face[+y]]' }] }, doc));
R('fillet style chamfer missing', mc.checkModel({ expect: [{ kind: 'fillet', style: 'chamfer' }] }, doc));
R('shell open:true', mc.checkModel({ expect: [{ kind: 'shell', open: true }] }, doc));
R('shell open text bottom', mc.checkModel({ expect: [{ kind: 'shell', open: 'box1.face[-z]' }] }, doc));
R('shell open text top (wrong)', mc.checkModel({ expect: [{ kind: 'shell', open: 'box1.face[+z]' }] }, doc));
R('shell thickness', mc.checkModel({ expect: [{ kind: 'shell', thickness: 2 }] }, doc));
R('two holes needed, one present (greedy distinct)', mc.checkModel({ expect: [{ kind: 'hole' }, { kind: 'hole' }] }, doc));
R('sketch width/depth + circle across', (() => { const d = run(`const s = sketch('top'); s.rect(30, 20, {at:[15,10]})\nconst c = sketch('top'); c.circle(12, {at:[0,0]})\nextrude(s, 5)\nextrude(c, 5)`); return mc.checkModel({ expect: [{ kind: 'sketch', width: 30, depth: 20 }, { kind: 'sketch', across: 12 }] }, d); })());
// SolidCraft refusals fed in: build a doc SC refuses (round on a wedge face), pass the translator's refusals
const bad = run(`const w = wedge(30, 20, 10)\nround(w.edge('bottom','front'), 2)`);
const tr = await L.translateDoc(L.cg.solveDoc(bad), { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {} });
const refusals = Object.fromEntries(tr.features.filter(f => f.status === 'refused').map(f => [f.id, f.refusal]));
R('SC refusal map', refusals);
R('lesson wants a round; no refusals passed (fail-open)', mc.checkModel({ expect: [{ kind: 'fillet', size: 2 }] }, bad));
R('lesson wants a round; SC refusals passed', mc.checkModel({ expect: [{ kind: 'fillet', size: 2 }] }, bad, refusals));
R('lesson wants a round; OCCT refusals passed (what the product feeds today)', (() => { const ref = L.references(L.cg.solveDoc(bad)); return mc.checkModel({ expect: [{ kind: 'fillet', size: 2 }] }, bad, ref.occtRefusals); })());
// wrong-geometry: a refused feature that SC refuses but the lesson check passes anyway when refusals are not supplied is the gap
R('studentWord map', ['fillet:fillet','fillet:chamfer','shell','extrude','revolve','combine','datum'].map(s => { const [k, st] = s.split(':'); return mc.studentWord(k, st); }));
save('resH.json');
