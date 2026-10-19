// SPIKE, referee only (round 4). The recorded UNGUARDED kernel truth for the primitives group, and the guard applied offline.
// Every number quoted by primitives-build-rows-r4.mjs comes from here.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTRACT = path.join(HERE, '..');
export const G = await import(pathToFileURL(path.join(CONTRACT, 'primitives.guard.mjs')).href);
export const L = await import(pathToFileURL(path.join(CONTRACT, 'primitives.call-lint.mjs')).href);
const { runScript } = await import(pathToFileURL(path.join(CONTRACT, '..', '..', '..', '..', 'packages/script/dist/reshape-script.js')).href);
export const runSides = (src) => { const r = runScript(src); return r.errors.length ? null : r.doc.features.filter((f) => f.kind === 'prism').map((f) => f.sides); };

const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/primitives-measure\.json$|^main\.json$|^far\.json$|^edge\.json$/.test(n)) files.push(p); } };
walk(path.join(CONTRACT, 'primitives-evidence'));
for (const dir of ['primitives-r3', 'primitives-r4']) { const d = path.join(CONTRACT, dir, 'results'); if (existsSync(d)) for (const n of readdirSync(d)) if (n.endsWith('.json') && n !== 'fuzz-spec.json' && !/g-guard-check/.test(n)) files.push(path.join(d, n)); }

export function outcome(r) {
  const t = r.truck;
  if (r.status === 'script-refused' || r.status === 'refused-by-script' || r.scriptRefusal) return 'interp';
  if (r.status === 'truck-refused' || r.status === 'refused-by-solidcraft' || r.status === 'harness-error') return 'kernel';
  if (!t || t.refused !== undefined) return 'kernel';
  const planar = !t.curved;
  const volBar = planar ? 1e-9 : 3e-4; const bboxBar = planar ? 1e-6 : 1e-4; const comBar = planar ? 1e-6 : 1e-4;
  const dv = t.dVolOcct ?? t.dVolAn ?? t.dVolAnalytic;
  if (dv === undefined) return 'unverified';
  if (!(dv <= volBar)) return 'wrong';
  if (t.dBboxOcct !== undefined && !(t.dBboxOcct <= bboxBar)) return 'wrong';
  if (t.dComOcct !== undefined && !(t.dComOcct <= comBar)) return 'wrong';
  if (t.facesOcct !== undefined && t.facesOcct !== t.faces) return 'wrong';
  if (t.bodies !== undefined && t.bodies !== 1) return 'wrong';
  return 'good';
}
const byKey = new Map();
for (const f of files) {
  let j; try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  if (!Array.isArray(j)) continue;
  for (const r of j) if (r && r.doc && r.id && r.status !== 'guard-refused') {
    const k = r.script ?? JSON.stringify(r.doc); const o = byKey.get(k);
    r._file = path.relative(CONTRACT, f);
    if (!o || (!o.truck && r.truck)) byKey.set(k, r);
  }
}
export const DB = [...byKey.values()].map((r) => {
  let g = G.guardFirst(r.doc);
  if (!g && r.script) { const l = [...L.lintSurplusArgs(r.script), ...(/prism\s*\(/.test(r.script) ? L.lintPrismSides(r.script, runSides) : []), ...L.lintConeSecondRadius(r.script)]; if (l.length) g = l[0]; }
  return { r, o: outcome(r), g };
});
/** summary of a set of DB entries as shipped: counts per outcome, with examples */
export function ship(entries) {
  const by = (o) => entries.filter((e) => e.o === o);
  const s = { n: entries.length, wrong: by('wrong'), unverified: by('unverified'), good: by('good'), kernel: by('kernel'), interp: by('interp') };
  s.status = (s.wrong.length || s.unverified.length) ? 'wrong' : s.kernel.length ? 'unsupported' : s.interp.length ? 'refused' : 'refused';
  return s;
}
export const refusedBy = (...codes) => DB.filter((e) => e.g && codes.includes(e.g.code));
export function kernelText(e) {
  const r = e.r;
  const t = String(r.refusal ?? r.truck?.refused ?? r.scriptRefusal ?? '').replace(/^.*solidcraft refused it -- /, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 90);
}
/** which bars a built case failed, from its numbers (round 1/2 records have no `why`) */
export function why(e) {
  const r = e.r; const t = r.truck;
  if (e.o === 'kernel' || e.o === 'interp') return kernelText(e);
  if (!t) return r.why || '';
  const planar = !t.curved; const x = (v) => v.toExponential(1);
  const out = [];
  const dv = t.dVolOcct ?? t.dVolAn ?? t.dVolAnalytic;
  if (dv !== undefined && dv > (planar ? 1e-9 : 3e-4)) out.push(`vol ${x(dv)}`);
  if (t.dBboxOcct !== undefined && t.dBboxOcct > (planar ? 1e-6 : 1e-4)) out.push(`bbox ${x(t.dBboxOcct)}`);
  if (t.dComOcct !== undefined && t.dComOcct > (planar ? 1e-6 : 1e-4)) out.push(`com ${x(t.dComOcct)}`);
  if (t.facesOcct !== undefined && t.facesOcct !== t.faces) out.push(`faces ${t.faces}/${t.facesOcct}`);
  return out.join('; ') || r.why || '';
}
