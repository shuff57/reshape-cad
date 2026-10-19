// SPIKE, referee only. Runs a spec module (default export: [{id, script|doc, occt?, brep?, measure?}]) through primitives-lib measureCase.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/primitives-sweep.mjs --spec=<module.mjs> --out=<results.json> [--only=id,prefix*] [--guard]
// With --guard the pre-flight guard (primitives.guard.mjs) is applied before the translator: refused features never reach truck.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const specPath = path.resolve(arg('spec'));
const out = path.resolve(arg('out') || 'results.json');
const only = arg('only').split(',').filter(Boolean);
const useGuard = process.argv.includes('--guard');
const lib = await import('./primitives-lib.mjs');
const specs = (await import(pathToFileURL(specPath).href)).default;
let guard = null; let lint = null;
if (useGuard) {
  const G = await import('./primitives.guard.mjs'); const L = await import('./primitives.call-lint.mjs');
  guard = (doc) => G.guardFirst(doc);
  const runSides = (s) => { const r = lib.runScript(s); return r.errors.length ? null : r.doc.features.filter((f) => f.kind === 'prism').map((f) => f.sides); };
  lint = (script) => L.lintScript(script, runSides);
}
const match = (id) => !only.length || only.some((o) => (o.endsWith('*') ? id.startsWith(o.slice(0, -1)) : id === o));
mkdirSync(path.dirname(out), { recursive: true });
const rows = existsSync(out) && process.argv.includes('--resume') ? JSON.parse(readFileSync(out, 'utf8')) : [];
const done = new Set(rows.map((r) => r.id));
for (const c of specs) {
  if (!match(c.id) || done.has(c.id)) continue;
  if (!useGuard && c.skipUnguarded) continue;
  const t0 = Date.now();
  let r;
  try { r = lib.measureCase({ ...c, guard, lint }); } catch (e) { r = { id: c.id, script: c.script, status: 'harness-error', refusal: String(e.stack ?? e).slice(0, 400) }; }
  r.load = os.loadavg()[0]; r.row = c.row; r.expect = c.expect; r.code = c.code;
  rows.push(r);
  const t = r.truck;
  console.log(`${c.id.padEnd(34)} ${String(r.status).padEnd(14)} ${r.good === undefined ? '    ' : r.good ? 'GOOD' : 'BAD '} ${String(r.ms ?? '').padStart(8)}ms cpu${String(r.cpuMs ?? '').padStart(8)} f=${t?.faces ?? '-'}/${t?.facesOcct ?? '-'} dV=${(t?.dVolOcct ?? t?.dVolAn)?.toExponential?.(1) ?? '-'} ${r.why || ''} ${r.refusal ? r.refusal.slice(0, 110) : ''} ${r.guard ? 'G:' + r.guard.sentence.slice(0, 100) : ''}`);
  writeFileSync(out, JSON.stringify(rows));
}
console.log(`wrote ${out} (${rows.length} rows)`);
