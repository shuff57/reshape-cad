// ROUND 2, section B: a param() slider on a legacy length rule across the 25% collapse cliff. A slider drag re-runs the script with the new default (ReshapeStudio bindSlot -> param('w', v)).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/r2b.mjs   (writes r2b.json)
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const rows = [];
for (const v of [40, 30, 20, 12, 10.5, 10.1, 10, 9.9, 8, 5, 2]) {
  const src = `const w = param('w', ${v}, {min:1,max:100}); const s=sketch('top'); s.rect(40,30); s.length(1,w); pull(s,10)`;
  const P = L.pipeline(src);
  const pts = P.doc.features[0].points; const W = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const closed = v * 30 * 10;
  rows.push({ slider: v, docWidth: +W.toFixed(4), closedForm: closed, occt: +P.occt.volume.toFixed(4), brep: +P.brep.volume.toFixed(4), sc: +P.sc.volume.toFixed(4), relErr: +(Math.abs(P.occt.volume - closed) / closed).toPrecision(4), warnings: P.warnings });
  console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(new URL('./r2b.json', import.meta.url), JSON.stringify(rows, null, 1));
