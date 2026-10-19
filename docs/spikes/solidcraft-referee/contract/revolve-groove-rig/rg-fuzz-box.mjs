#!/usr/bin/env node
// Truck-only fuzz of box grooves (no OCCT): which random ring profiles on a 40x40x20 box does the AS-SHIPPED phase0 translator refuse, with which
// kernel text, and what plain sentence the guard maps that text to. Seeded; deterministic.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg-fuzz-box.mjs [--n=300] [--seed=7] [--raw=0|1] [--out=<file.json>]   (--raw=0 skips the as-shipped translator: half the time)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..', '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const N = +arg('n', 300); let seed = +arg('seed', 7);
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { runScript } = await load('packages/script/dist/reshape-script.js');
const arc = await load('packages/sketch/dist/sketch-arc.js'); const mt = await load('packages/script/dist/model-types.js'); const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const raw = await import(pathToFileURL(path.join(HERE, '../../phase0/translate.mjs')).href);
const g0 = await import(pathToFileURL(path.join(HERE, 'rg-translate-p0.mjs')).href);
const RG = await import(pathToFileURL(path.join(HERE, '../revolve-groove.guard.mjs')).href);
const rows = [];
for (let i = 0; i < N; i++) {
  const plane = pick(['top', 'front', 'side']); const ang = pick([360, 90, 180, 270, 45, 135, 225, 315]);
  const u0 = pick([2, 5, 8, 10, 12, 15, 18, 20, 22, 25]); const w = pick([1, 2, 4, 6, 10]); const c = pick([-5, 0, 5, 10]); const h = pick([2, 4, 8, 12, 24, 30]);
  const src = `const b = box(40,40,20); const s = sketch('${plane}'); s.rect(${w},${h},{at:[${u0 + w / 2},${c}]}); groove(s, b, ${ang});`;
  const run = runScript(src); if (run.errors?.length) continue;
  const doc = solveDoc(run.doc); const id = doc.features.at(-1).id;
  const t0 = Date.now();
  const a = arg('raw', '1') === '0' ? { status: 'skipped' } : raw.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null }).features.find((f) => f.id === id);
  const b = g0.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null }).features.find((f) => f.id === id);
  const row = { plane, ang, u0, w, c, h, src, raw: a.status === 'built' ? { vol: a.measure.volume, faces: a.measure.faces, bodies: a.measure.bodies.length } : a.status === 'skipped' ? { skipped: true } : { refused: a.refusal }, guarded: b.status === 'built' ? { vol: b.measure.volume, faces: b.measure.faces, bodies: b.measure.bodies.length } : { refused: b.refusal }, ms: Date.now() - t0 };
  rows.push(row);
  console.error(`${i} ${plane} ${ang} u0=${u0} w=${w} c=${c} h=${h} raw=${a.status} guard=${b.status} ${row.ms}ms`);
  if (arg('out', '') && i % 10 === 9) writeFileSync(arg('out', ''), JSON.stringify(rows, null, 1));
}
const kinds = {};
for (const r of rows) { const k = r.raw.skipped ? (r.guarded.refused ? 'guard refused' : 'guard built') : r.raw.refused ? (r.guarded.refused ? 'refused both' : 'raw refused, guard built') : (r.guarded.refused ? 'guard refused, raw built' : 'built both'); kinds[k] = (kinds[k] ?? 0) + 1; }
const dirty = rows.filter((r) => r.guarded.refused && RG.JARGON.test(r.guarded.refused));
console.log(JSON.stringify({ n: rows.length, kinds, guardSentenceWithEngineWords: dirty.length }));
const sent = {}; for (const r of rows) if (r.guarded.refused) sent[r.guarded.refused.replace(/^groove\d+ \(groove\): /, '')] = (sent[r.guarded.refused.replace(/^groove\d+ \(groove\): /, '')] ?? 0) + 1;
console.log(JSON.stringify(sent, null, 1));
const out = arg('out', '');
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
