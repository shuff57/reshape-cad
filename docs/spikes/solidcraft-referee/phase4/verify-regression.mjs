#!/usr/bin/env node
// SPIKE (phase 4), referee only. Runs regression-fixtures.mjs through the real page and scores against live OCCT, with the
// OCCT no-op guard (a shell that returns the un-hollowed volume is "no reference", never a match). Exit 1 on any miss.
//   PW_CWD=$PWD node .../phase4/verify-regression.mjs     (cwd outside the repo; run.sh serving; session `spike`)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REGRESSIONS } from './regression-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const URL_ = 'http://127.0.0.1:8796/';
const pw = (...a) => execFileSync('playwright-cli', ['-s=spike', ...a], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: process.env.PW_CWD ?? process.cwd() });
const evalJson = (fn) => { const m = pw('eval', fn).match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error('no result'); const v = JSON.parse(m[1]); return typeof v === 'string' ? JSON.parse(v) : v; };
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import(pathToFileURL(path.join(REPO, 'packages/brep-adapter/dist/occt-build.js')).href);
const arc = await import(pathToFileURL(path.join(REPO, 'packages/sketch/dist/sketch-arc.js')).href);
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
const vol = (sh) => { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(sh, g, 1e-7, false, false); return g.Mass(); };
try { pw('open', URL_); } catch { pw('goto', URL_); }
await new Promise((r) => setTimeout(r, 4000));
const out = []; let bad = 0;
for (const fx of REGRESSIONS) {
  const doc = { version: 1, features: fx.features };
  let occtV = null; let targetV = null; let occtNoOp = false;
  try {
    const b = buildDoc(oc, doc, arc);
    const sh = b.shapes.get(fx.measure); if (sh) occtV = vol(sh);
    const tf = fx.features.find((x) => x.id === fx.measure);
    const ts = tf?.target && b.shapes.get(tf.target); if (ts) targetV = vol(ts);
    occtNoOp = occtV !== null && targetV !== null && Math.abs(occtV - targetV) <= 1e-9 * Math.max(1, targetV);
  } catch { /* no reference */ }
  let brepV = null; let brepNote = null;
  try { const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))); const s = m.shapes?.[fx.measure]; brepV = s?.volume ?? null; if (m.refusals?.[fx.measure]) brepNote = String(m.refusals[fx.measure]).slice(0, 100); } catch (e) { brepNote = e.message; }
  const page = evalJson(`async () => JSON.stringify(await window.__host.translateRaw(${JSON.stringify(doc)}, []))`);
  const f = page.features.find((x) => x.id === fx.measure);
  const row = { id: fx.id, expect: fx.expect, status: f?.status, sentence: f?.refusal ?? null, volume: f?.measure?.volume ?? null, occt: occtV, occtNoOp, brep: brepV, brepNote, evidence: f?.evidence?.target ?? null };
  let ok;
  if (fx.expect === 'refuse') ok = f?.status === 'refused' && String(f.refusal).includes(fx.contains);
  else {
    const match = row.volume !== null && occtV !== null && !occtNoOp && Math.abs(row.volume - occtV) / Math.max(1, occtV) <= (fx.bar ?? 3e-4);
    const brepMatch = row.volume !== null && brepV !== null && Math.abs(row.volume - brepV) / Math.max(1, brepV) <= (fx.bar ?? 3e-4);
    row.brepMatch = brepMatch;
    row.match = match; row.reference = occtNoOp ? 'none (OCCT no-op)' : occtV === null ? 'none (OCCT built nothing)' : 'OCCT';
    if (fx.expect === 'build') ok = f?.status === 'built' && match;
    else ok = f?.status === 'refused' ? /matches \d+ faces|no safe pick|no longer|no face of|not resolved/.test(String(f.refusal)) || /solidcraft refused/.test(String(f.refusal)) : (match || (occtNoOp || occtV === null));
    row.class = f?.status === 'refused' ? (/matches \d+ faces/.test(f.refusal) ? 'resolver refusal with a count' : /solidcraft refused/.test(f.refusal) ? 'solidcraft refused the command' : 'resolver refusal') : (match ? 'built, equals OCCT' : occtNoOp ? `built, OCCT no-op; brep-rs ${brepV === null ? 'none' : brepMatch ? 'AGREES' : 'DIFFERS (' + brepV.toFixed(3) + ')'}` : 'BUILT BUT DIFFERS FROM OCCT');
  }
  row.ok = !!ok; if (!ok) bad++;
  out.push(row);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${fx.id.padEnd(26)} ${String(f?.status).padEnd(8)} vol ${row.volume?.toFixed?.(3) ?? '-'} occt ${occtV?.toFixed?.(3) ?? '-'}${occtNoOp ? ' (NO-OP)' : ''} brep ${brepV?.toFixed?.(3) ?? '-'} ${row.class ?? ''} ${row.sentence ? '-- ' + row.sentence.slice(0, 150) : ''}`);
}
writeFileSync(path.join(HERE, 'regression-results.json'), JSON.stringify(out, null, 1) + '\n');
process.exit(bad ? 1 : 0);
