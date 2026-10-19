import { runCase, f } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const script = process.argv[2].replace(/\\n/g, '\n');
for (const [nm, tf] of [['shipped', undefined], ['guard', guard]]) {
  const r = runCase({ script, translateFn: tf, ids: process.argv[3] ? process.argv[3].split(',') : undefined });
  if (r.errors.length) { console.log(nm, r.errors); continue; }
  for (const id of Object.keys(r.truck)) { const t = r.truck[id]; console.log(nm.padEnd(8), id, verdict(r, id), t.refused ?? `dVol ${f(t.dVol)} dBbox ${f(t.dBbox)} dCom ${f(t.dCom)} faces ${t.faces}/${t.occtFaces} vol ${t.volume?.toFixed(3)} occt ${t.occtVolume?.toFixed(3)} brepDVol ${f(r.brep[id]?.dVol)}`); }
  console.log(nm, r.truckFeatures.map(x => x.id + ':' + x.status).join(' '), 'cmds', r.commands?.length);
}
