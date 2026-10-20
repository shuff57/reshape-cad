// SPIKE, referee only (round 6). Two spheres or two cylinders a hair apart: what does the layer say? (critic round 3, minor: the sentence "meet only along an edge or at a point" was FALSE for
// copies that are in fact apart.) Truck alone through the contract translator, no OCCT (a sphere pair under the OCCT oracle exceeds the 1500 MB cap in one case).
// Oracle for a BUILT pair: the sum of the two closed-form volumes within the curved bar 3e-4. A built pair must also be 2 separate bodies' worth of volume (never a lost sliver).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 timeout 900 bun pm-gap-probe.mjs --out=pm-gap-probe.json
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from './pm-translate.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const OUT = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const ALL = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver', 'web'];
const PATCHES = new Set([...ALL, '__explicit']);
const SHAPES = { sphere: { call: 'sphere(10)', vol: (4 / 3) * Math.PI * 125 }, cylinder: { call: 'cylinder(10, 10)', vol: Math.PI * 25 * 10 } };
const rows = [];
for (const [name, sh] of Object.entries(SHAPES)) for (const gap of [1e-6, 1e-5, 1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.1, 0.5, 5]) {
  const step = +(10 + gap).toPrecision(10);
  const src = `const a = ${sh.call}; repeat(a, { count: 2, step: [${step}, 0, 0] });`;
  const run = runScript(src); const doc = solveDoc(run.doc);
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, patches: PATCHES, inProcess: true });
  const last = tr.features.at(-1);
  const rec = { shape: name, gap, src, status: last.status };
  if (last.status === 'built') { rec.volume = last.measure.volume; rec.exact = 2 * sh.vol; rec.rel = Math.abs(rec.volume - rec.exact) / rec.exact; rec.within3e4 = rec.rel <= 3e-4; }
  else { rec.sentence = last.student; rec.raw = last.refusal; }
  rows.push(rec); console.log(name.padEnd(9), String(gap).padEnd(7), rec.status.padEnd(8), rec.rel !== undefined ? rec.rel.toExponential(1) : '', rec.sentence ?? '');
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
