// SPIKE, referee only (contract / extrude-pocket group, round 3). A tiny loader for probes: reSHape Script -> ModelDoc -> contract translator -> SolidCraft rig.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun <probe>.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
export const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
export const arc = await load('packages/sketch/dist/sketch-arc.js');
export const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
export const contract = await import(pathToFileURL(path.join(HERE, process.env.EP_TRANSLATOR ?? 'translate-ep.mjs')).href);
export const runSC = async (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
export function docOf(script) { const r = runScript(script); if (r.errors.length) throw new Error(r.errors[0].message); return solveDoc(r.doc); }
export async function translate(script) {
  const doc = docOf(script);
  const t0 = Date.now();
  const tr = await contract.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  return { doc, tr, ms: Date.now() - t0 };
}
