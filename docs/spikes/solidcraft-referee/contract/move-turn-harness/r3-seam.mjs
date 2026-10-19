// face-count mismatch of a cylinder tool that splits a box into two pieces: is it the cylinder seam? Turn the tool about z so the two cut patches
// no longer straddle angle 0 / 180 and compare face-type counts (SC vs live OCCT vs brep-rs).
import { runCase } from './runner.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
import { writeFileSync } from 'node:fs';
const out = [];
for (const rz of [0, 15, 45, 90, 135, 180]) {
  const script = `const a = box(60, 20, 10, { at: [0, 0, 0] });\nconst b = cylinder(30, 30, { at: [0, 0, 0] });\nturn(b, [0, 0, ${rz}]);\ncut(a, b);`;
  const r = runCase({ script, translateFn: guard });
  const id = r.features.at(-1).id; const t = r.truck[id];
  const row = { rz, scCylFaces: t.faceTypes?.cylinder, occtCylFaces: t.occtTypes?.cylinder, scFaces: t.faces, occtFaces: t.occtFaces, brepFaces: r.brep[id]?.faces, dVol: t.dVol, faceOk: t.faceOk };
  out.push(row); console.log(JSON.stringify(row));
}
writeFileSync('r3-seam-results.json', JSON.stringify(out, null, 1));
