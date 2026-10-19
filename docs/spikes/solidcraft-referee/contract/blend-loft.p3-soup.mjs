import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { translateDoc } = await load('docs/spikes/solidcraft-referee/phase3/host/translate-p3.mjs');
const runSC = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
for (const src of [
  `const a = sketch('top'); a.slot([-10,0],[10,0],5); const b = sketch('top'); b.rect(10,10); blend(a, b, 30);`,
  `const a = sketch('top'); a.geom([{k:'circle',id:1,c:[0,0],r:10}]); const b = sketch('top'); b.rect(10,10); blend(a, b, 30);`,
  `const a = sketch('top'); a.rect(40, 30); a.length(1, 36); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30);`,
]) {
  const run = runScript(src);
  const doc = solveDoc({ version: 1, features: run.doc.features });
  const tr = await translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, soups: {} });
  console.log(JSON.stringify(tr.features.map((f) => ({ id: f.id, status: f.status, refusal: f.refusal, vol: f.measure?.volume })), null, 0));
}
