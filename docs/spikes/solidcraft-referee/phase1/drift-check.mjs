#!/usr/bin/env node
// SPIKE, referee only. translate-browser.mjs is a COPY of ../phase0/translate.mjs; this runs both translators on every
// parity fixture with the same solidcraft wasm and the same brep-rs resolve, and diffs commands, statuses, refusals.
//   SOLIDCRAFT_REFEREE_PKG=<nodejs wasm-bindgen pkg> node docs/spikes/solidcraft-referee/phase1/drift-check.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc as translateP0 } from '../phase0/translate.mjs';
import { translateDoc as translateBrowser } from './host/translate-browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { fixtures } = await load('scripts/brep-parity-fixtures.mjs');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { error: `WASM TRAP: ${e.message}` } }; } };
const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
const sig = (tr) => JSON.stringify({ commands: tr.commands, features: tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, commands: f.commands, volumes: f.measure ? Number(f.measure.volume.toPrecision(12)) : null })) });

let same = 0; const diffs = []; let built = 0; let refused = 0;
const list = fixtures().map((fx) => ({ id: fx.id, features: fx.doc(mt).features }));
for (const fx of list) {
  const doc = solveDoc({ version: 1, features: fx.features });
  const a = translateP0(doc, { arc, mt, runSC, resolveAt });
  const b = await translateBrowser(doc, { arc, mt, runSC: async (c) => runSC(c), resolveAt });
  built += a.features.filter((f) => f.status === 'built').length;
  refused += a.features.filter((f) => f.status === 'refused').length;
  if (sig(a) === sig(b)) same++; else diffs.push({ id: fx.id, volA: a.features.map((f) => f.measure?.volume), volB: b.features.map((f) => f.measure?.volume), a: a.features.map((f) => `${f.id}:${f.status}`), b: b.features.map((f) => `${f.id}:${f.status}`) });
}
console.log(`fixtures ${list.length}  identical ${same}  different ${diffs.length}  (features built ${built}, refused ${refused} in phase0 run)`);
for (const d of diffs) console.log('DIFF', JSON.stringify(d));
process.exit(diffs.length ? 1 : 0);
