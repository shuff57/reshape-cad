// Is a deliberate rect(40, 25, { at: [20, 12.5] }) distinguishable from an undrawn sketch in the document? (round 3)  bun rg3-starter-probe.mjs > ../revolve-groove-results/r3/starter-probe.txt
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const { runScript } = await import(pathToFileURL(path.join(REPO, 'packages/script/dist/reshape-script.js')).href);
const a = runScript("const s = sketch('front'); spin(s, 90);");
const b = runScript("const s = sketch('front'); s.rect(40, 25, { at: [20, 12.5] }); spin(s, 90);");
const c = runScript("const s = sketch('front'); s.rect(40, 25, { at: [20.01, 12.5] }); spin(s, 90);");
console.log('result keys:', Object.keys(a).join(','));
console.log('undrawn   sketch:', JSON.stringify(a.doc.features[0]));
console.log('deliberate sketch:', JSON.stringify(b.doc.features[0]));
console.log('moved 0.01 sketch:', JSON.stringify(c.doc.features[0]));
console.log('undrawn doc === deliberate doc:', JSON.stringify(a.doc) === JSON.stringify(b.doc), '| params equal:', JSON.stringify(a.params) === JSON.stringify(b.params));
