// Round 4: where does a spin() tube (profile with an edge ON the sketch axis line) as the TARGET of a cut stop building? Raw SolidCraft (no oracle), one child process per case with a cpu limit.
// The command list comes from the phase0 translator with a stub kernel (commands only), so nothing can hang in this process. Output: ring-sweep.jsonl.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r4/ring-sweep.mjs [--prof=[[10,0],[20,0],[20,15],[10,15]]]
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { timeRun } from './cost-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { translateDoc } = await load('docs/spikes/solidcraft-referee/phase0/translate.mjs');
const stub = (cmds) => {
  const names = new Set();
  for (const c of cmds) if (c.params.body_name) names.add(c.params.body_name);
  return { ok: true, measure: { bodies: [...names].map((n) => ({ name: n, volume_mm3: 1, faces: 1, kernel: { faces: 1 }, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, center_of_mass: [0, 0, 0], face_types: { plane: 1 } })) } };
};
const B = (w, d, h, at) => `box(${w},${d},${h},{at:[${at}]})`;
const prof = process.argv.find((a) => a.startsWith('--prof='))?.slice(7) ?? '[[10,0],[20,0],[20,15],[10,15]]';
const OUT = path.join(HERE, 'ring-sweep.jsonl');
writeFileSync(OUT, '');
let n = 0;
let bad = 0;
for (const L of [30, 60]) {
  for (const w of [2, 4, 4.9, 5, 8, 14]) {
    for (const dir of ['y', 'x']) {
      for (const [zn, h, zc] of [['tall', 40, 7.5], ['flush', 15, 7.5], ['half', 7.5, 3.75]]) {
        const size = dir === 'y' ? [L, w, h] : [w, L, h];
        const script = `const s = sketch('front', 0); s.polygon(${prof}); const t = spin(s,360); const b = ${B(...size, [0, 0, zc])}; cut(t,b)`;
        const r = runScript(script);
        if (r.errors.length) { appendFileSync(OUT, JSON.stringify({ L, w, dir, zn, err: r.errors[0].message }) + '\n'); continue; }
        const doc = solveDoc({ version: 1, features: r.doc.features });
        const tr = translateDoc(doc, { arc, mt, runSC: stub, resolveAt: () => null });
        const t = timeRun(tr.commands, { cpuLimitS: 25 });
        n++;
        if (!t.ok) bad++;
        appendFileSync(OUT, JSON.stringify({ L, w, dir, zn, ok: t.ok, cpuS: t.cpuS, killed: t.killed, err: t.error, vol: t.bodies?.map((b) => b.v).join(',') }) + '\n');
      }
    }
  }
}
console.log('cases', n, 'not built', bad);
