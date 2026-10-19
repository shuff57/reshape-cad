import { L, out, save } from './common.mjs';
const log = (...a) => console.log(...a);
const R = (label, v) => { out.push({ label, ...v }); log(label.padEnd(56), JSON.stringify(v).slice(0, 420)); };
const run = (src) => { const r = L.fromScript(src); if (r.errors.length) throw new Error(r.errors[0].message); return r.doc; };
const face = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });
const btw = (feature, a, b) => ({ cause: 'between', feature, kind: 'edge', of: [a, b] });
const doc = run(`const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })
const plate = extrude(sk1, 10)
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] })
const part = pocket(sk2, plate, 4)
round(part.edge('top', part.wall(sk2, 2)), 1)
hollow(part, {wall: 1, open: 'bottom'})`);
log(doc.features.map(f => f.id + ':' + f.kind).join(' '));
for (const f of doc.features.filter(f => ['fillet','shell','draft'].includes(f.kind))) {
  const nm = f.edge ?? f.open ?? f.face;
  R(`topoRefs(${f.id})`, { name: L.tn.formatName(nm), topoRefs: L.mt.topoRefs(f), dependsOn: L.mt.dependsOn(f), rootFeature: L.tn.rootFeature(nm), featureChain: L.tn.featureChain(nm) });
}
R('orphanedBy(pull1) cascade', [...L.md.orphanedBy(doc, ['pull1'])]);
R('orphanedBy(sk2) cascade', [...L.md.orphanedBy(doc, ['sk2'])]);
R('withoutFeatures(pull2) -> features left', L.md.withoutFeatures(doc, ['pull2']).features.map(f => f.id));
R('danglingRefs on intact doc', L.md.danglingRefs(doc));
const broken = { ...doc, features: doc.features.filter(f => f.id !== 'pull2') };
R('danglingRefs after raw removal of pull2', L.md.danglingRefs(broken));
R('firstOrderViolation moved fillet to front', L.md.firstOrderViolation([doc.features.find(f => f.kind === 'fillet'), ...doc.features.filter(f => f.kind !== 'fillet')]));
R('whyDeletingCosts(pull2)', L.md.whyDeletingCosts ? L.md.whyDeletingCosts(doc, ['pull2'], (id)=>id) : 'n/a');
// structural validity / whyNameLost
const nm = doc.features.find(f => f.kind === 'fillet').edge;
const exists = (id) => doc.features.some(f => f.id === id);
const sketchEdges = (id) => { const s = doc.features.find(f => f.id === id && f.kind === 'sketch'); return s ? (s.shape === 'circle' ? 1 : s.points.length) : null; };
R('nameIsStructurallyValid intact', { v: L.tn.nameIsStructurallyValid(nm, exists, sketchEdges), why: L.tn.whyNameLost(nm, exists, sketchEdges, (id) => id) });
const exists2 = (id) => id !== 'pull2' && exists(id);
R('after deleting pull2', { v: L.tn.nameIsStructurallyValid(nm, exists2, sketchEdges), why: L.tn.whyNameLost(nm, exists2, sketchEdges, (id) => id) });
const tri = (id) => (id === 'sk2' ? 3 : sketchEdges(id));
const nm4 = { cause: 'swept', feature: 'pull2', kind: 'face', from: 'sk2', edge: 3 };
R('swept edge 3 after sketch lost a corner', { v: L.tn.nameIsStructurallyValid(nm4, exists, tri), why: L.tn.whyNameLost(nm4, exists, tri, (id) => id) });
// SC: the same lost swept name in the translator
const lost = JSON.parse(JSON.stringify(doc));
lost.features.find(f => f.id === 'sk2').points = [[15, 10], [25, 10], [20, 20]];
R('SC translator, swept edge 3 on a triangle (name lost)', await (async () => {
  const d = JSON.parse(JSON.stringify(lost)); const fl = d.features.find(f => f.kind === 'fillet');
  fl.edge = { ...fl.edge, of: fl.edge.of.map(n => (n.cause === 'swept' ? { ...n, edge: 3 } : n)) };
  const tr = await L.translateDoc(L.cg.solveDoc(d), { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {} });
  const ref = L.references(L.cg.solveDoc(d), fl.id);
  return { fillet: tr.features.find(f => f.id === fl.id)?.status, sentence: tr.features.find(f => f.id === fl.id)?.refusal, occtRefusals: ref.occtRefusals, brepRefusals: ref.brepRefusals };
})());
// a refused upstream feature takes its dependents with it, with a pointer
R('SC cascade: refused upstream -> dependents', await (async () => {
  const d = run(`const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10, { midplane: true })\nround(plate.edge('top','right'), 1)`.replace("round(plate.edge('top','right'), 1)", "hollow(plate, {wall: 2, open: 'top'})"));
  const tr = await L.translateDoc(L.cg.solveDoc(d), { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {} });
  return tr.features.filter(f => f.status === 'refused').map(f => ({ id: f.id, refusal: f.refusal }));
})());
save('resJ.json');
