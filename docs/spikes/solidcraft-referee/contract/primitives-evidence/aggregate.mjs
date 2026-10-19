import fs from 'node:fs';
const all=[...JSON.parse(fs.readFileSync('primitives-measure.json','utf8')),...JSON.parse(fs.readFileSync('edge/primitives-measure.json','utf8')),...JSON.parse(fs.readFileSync('far/primitives-measure.json','utf8'))];
const by=Object.fromEntries(all.map(x=>[x.id,x]));
const groups=JSON.parse(process.argv[2]);
const e=v=>typeof v==='number'?v.toExponential(1):'-';
for(const [g,ids] of Object.entries(groups)){
  const rs=ids.flatMap(i=>by[i]?[by[i]]:(console.log('MISSING',i),[])).filter(r=>r.truck&&r.truck.dVolOcct!==undefined);
  const mx=k=>Math.max(...rs.map(r=>r.truck[k]??0));
  const fm=rs.filter(r=>r.truck.faces!==r.truck.facesOcct).map(r=>r.id);
  const an=Math.max(...rs.map(r=>r.truck.dVolAnalytic??0));
  const fc=rs.filter(r=>r.truck.freecad);
  console.log(g.padEnd(28),'n',rs.length,'/',ids.length,'maxdVolOcct',e(mx('dVolOcct')),'dBbox',e(mx('dBboxOcct')),'dCom',e(mx('dComOcct')),'dAn',e(an),'dBrep',e(mx('dVolBrep')),'faceMismatch',fm.join(',')||'none','FC',fc.map(r=>r.id+':'+e(r.truck.freecad.dVol)+'/'+e(r.truck.freecad.dBbox)+'/'+r.truck.freecad.facesEqual).join(' '));
}
