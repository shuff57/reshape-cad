import { L, T, D, save } from './common.mjs';
const SOUP = `const sk = sketch('top')
sk.geom([{k:'line',id:1,a:[0,0],b:[30,0]},{k:'line',id:2,a:[30,0],b:[30,20]},{k:'line',id:3,a:[30,20],b:[0,20]},{k:'line',id:4,a:[0,20],b:[0,0]}])
sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'},{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'},{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'},{k:'horizontal',a:1},{k:'vertical',a:2},{k:'horizontal',a:3},{k:'vertical',a:4},{k:'lock',a:1,aEnd:'a'},{k:'distance',a:1,aEnd:'a',b:1,bEnd:'b',value:30},{k:'distance',a:2,aEnd:'a',b:2,bEnd:'b',value:20}])
const e = extrude(sk, 12)
`;
const r = L.fromScript(SOUP);
console.log('soup doc', r.errors.length ? r.errors[0].message : r.doc.features.map(f => f.id + ':' + f.kind).join(' '));
if (!r.errors.length) {
  const skid = r.doc.features.find(f => f.kind === 'sketch').id, ex = r.doc.features.find(f => f.kind === 'extrude').id;
  const doc = { ...r.doc, features: [...r.doc.features, { id: 'sh1', kind: 'shell', target: ex, thickness: 2, open: { cause: 'swept', feature: ex, kind: 'face', from: skid, edge: 1 } }] };
  await D('rows-and-rules sketch extrude: swept edge1 shell open', doc);
  await D('rows-and-rules sketch extrude: cap top shell open', { ...r.doc, features: [...r.doc.features, { id: 'sh1', kind: 'shell', target: ex, thickness: 2, open: { cause: 'cap', feature: ex, kind: 'face', end: 'top' } }] });
}
await T('hole, turn, then round edge(top,right)', `const b = box(40,30,20)\nhole(b,{across:6})\nturn(b,[0,0,20])\nround(b.edge('top','right'), 2)`);
await T('turn built part then hollow open top', `const b = box(40,30,20)\nhole(b,{across:6})\nturn(b,[0,0,20])\nhollow(b,{wall:2, open:'top'})`);
save('resN.json');
