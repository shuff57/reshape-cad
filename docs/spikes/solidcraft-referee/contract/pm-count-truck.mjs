// SPIKE, referee only. Round 5: the large-count cases of the patterns-mirror group run on SolidCraft ALONE (no OCCT, no brep-rs), because the OCCT oracle build of
// 1000 or 1001 copies exceeds the 1500 MB cap (and corrupts the OCCT wasm heap even without a cap). The oracle for count 1000 is the closed form of the union of
// 1000 boxes 4 x 4 x 4 stepped by 3 along x: 16 x (3 x 1000 + 1) = 48016 mm3. The refused counts have no volume, only the sentence.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 timeout 900 bun pm-count-truck.mjs --out=pm-count-truck.json [--only=id,id]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from './pm-translate.mjs';
import { CASES3 } from './pm-cases-r3.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const only = arg('only', '').split(',').filter(Boolean); const OUT = arg('out', '');
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const ALL = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver'];
const PATCHES = new Set([...ALL, '__explicit']);
const CLOSED = { 'r3-box-count-200': 16 * (3 * 200 + 1), 'r3-box-count-1000': 16 * (3 * 1000 + 1) };
const res = [];
for (const c of CASES3.filter((x) => x.row === 'count' && (!only.length || only.includes(x.id)))) {
  const run = runScript(c.src); const rec = { id: c.id, src: c.src };
  if (run.errors?.length) { rec.verdict = 'script-refused'; rec.sentence = run.errors.map((e) => e.message).join(' | '); res.push(rec); console.log(c.id, rec.verdict); continue; }
  const t0 = Date.now();
  const tr = translateDoc(solveDoc(run.doc), { arc, mt, runSC, resolveAt: () => null, patches: PATCHES, inProcess: true });
  const last = tr.features.at(-1); rec.ms = Date.now() - t0; rec.status = last.status;
  if (last.status === 'built') { rec.truck = { volume: last.measure.volume, faces: last.measure.faces, bodies: last.measure.bodies?.length }; if (CLOSED[c.id]) { rec.closedForm = CLOSED[c.id]; rec.rel = Math.abs(rec.truck.volume - rec.closedForm) / rec.closedForm; } rec.verdict = rec.rel === undefined ? 'built (no closed form)' : rec.rel <= 1e-9 ? 'ok' : 'WRONG'; }
  else { rec.verdict = 'refused'; rec.raw = last.refusal; rec.student = last.student; }
  res.push(rec); console.log(c.id, rec.verdict, rec.ms + ' ms', rec.rel ?? '', (rec.student ?? '').slice(0, 160));
}
if (OUT) writeFileSync(OUT, JSON.stringify(res, null, 1));
