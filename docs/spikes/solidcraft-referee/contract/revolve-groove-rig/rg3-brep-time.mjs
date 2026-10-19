// brep-rs wall time (ms) of measure_doc for a few groove scripts, to put next to truck's CPU seconds (round 3).  bun rg3-brep-time.mjs
import { init } from './rg3-lib.mjs';
const L = await init({ brep: true });
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const dir = [path.join(REPO, 'packages', 'brep-rs', 'pkg'), path.join(REPO, 'archive', 'brep-rs', 'pkg')].find((d) => existsSync(path.join(d, 'brep_rs.js')));
const brep = await import(pathToFileURL(path.join(dir, 'brep_rs.js')).href); brep.initSync({ module: readFileSync(path.join(dir, 'brep_rs_bg.wasm')) });
const CYL = `const sk1 = sketch('top'); sk1.circle(40); const cyl = extrude(sk1, 30);`;
const cases = { 'groove-half-turn-180': `${CYL} const sk2 = sketch('top'); sk2.rect(2, 5, { at: [19, 12.5] }); groove(sk2, cyl, 180);`, 'groove-90': `${CYL} const sk2 = sketch('top'); sk2.rect(2, 5, { at: [19, 12.5] }); groove(sk2, cyl, 90);`, 'groove-270': `${CYL} const sk2 = sketch('top'); sk2.rect(2, 5, { at: [19, 12.5] }); groove(sk2, cyl, 270);`, 'groove-coaxial-360': `${CYL} const sk2 = sketch('top'); sk2.rect(2, 5, { at: [19, 12.5] }); groove(sk2, cyl, 360);` };
for (const [id, src] of Object.entries(cases)) {
  const doc = L.runScript(src).doc; const t0 = performance.now(); const got = JSON.parse(brep.measure_doc(JSON.stringify({ version: 1, features: doc.features }))); const ms = performance.now() - t0;
  const last = doc.features.at(-1).id; const s = got.shapes?.[last];
  console.log(JSON.stringify({ id, ms: +ms.toFixed(1), volume: s?.volume ?? null, faces: s?.faces ?? null, refused: got.refusals?.[last] ?? null }));
}
