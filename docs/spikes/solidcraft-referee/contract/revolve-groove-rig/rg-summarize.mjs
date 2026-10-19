#!/usr/bin/env node
// One line per case of an rg-run result file: bun rg-summarize.mjs <results.json> [idPrefix...]
import { readFileSync } from 'node:fs';
const [file, ...pre] = process.argv.slice(2);
const E = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
for (const r of JSON.parse(readFileSync(file, 'utf8'))) {
  if (pre.length && !pre.some((p) => r.id.startsWith(p))) continue;
  if (r.scriptRefusal || r.scriptThrew) { console.log(r.id, '| SCRIPT-REFUSAL |', r.scriptRefusal ?? r.scriptThrew); continue; }
  const f = r.fixture; const t = f.truck; const n = r.noOcct;
  if (f.invalid) {
    const x = n.truck;
    console.log(r.id, '| NO-OCCT |', x.volume !== undefined ? `truck V ${x.volume.toFixed(4)} F ${x.faces} ${JSON.stringify(x.faceTypes)} bodies ${x.bodies} bbox ${x.bbox.map((v) => +v.toFixed(3))}` : `truck REFUSED: ${x.refused}`, '| brep', n.brep.volume !== undefined ? `V ${n.brep.volume.toFixed(4)} F ${n.brep.faces}` : `REFUSED ${n.brep.refused?.slice(0, 90)}`, r.analytic ? `| analytic ${r.analytic.volume.toFixed(4)} dTruck ${E(r.analytic.dTruck)}` : '', '| ms', n.ms, 'cpu', n.cpuMs);
    continue;
  }
  const o = f.occt;
  console.log(r.id, '|', f.outcome, '|', t?.volume !== undefined ? `dV ${E(t.dVol)} dBb ${E(t.dBbox)} dCom ${E(t.dCom)} F o/b/t ${o.faces}/${f.brep?.faces ?? '-'}/${t.faces} bodies ${t.bodies} faceKey ${t.faceKey ?? 'UNEXPLAINED'} types ${JSON.stringify(t.faceTypes)}` : `TRUCK REFUSED: ${t?.refused}`, '| occtV', o.volume.toFixed(4), '| brep', f.brep?.refused ? `REFUSED ${f.brep.refused.slice(0, 80)}` : `dV ${E(f.brep?.dVol)}`, r.vsFc ? `| FC truck dV ${E(r.vsFc.truck.dVol)} dCom ${E(r.vsFc.truck.dCom)} F ${r.fc.faces}` : '', r.analytic ? `| analytic dTruck ${E(r.analytic.dTruck)}` : '', '| ms', f.ms, 'cpu', f.cpuMs);
}
