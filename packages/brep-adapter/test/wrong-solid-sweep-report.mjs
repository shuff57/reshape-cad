// Aggregate the JSONL a sweep left behind.  node wrong-solid-sweep-report.mjs <dir> [--wrong] [--json out.json]
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const recs = [];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : f.endsWith('.jsonl') ? [path.join(d, f)] : []));
for (const f of walk(dir))
  for (const l of readFileSync(f, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));

const TOLG = 0.015;
for (const r of recs) {
  if (r.cls !== 'WRONG' || !r.wrong || !r.wrong.every((w) => w.startsWith('WRONG-VOLUME')) || r.analytic?.kind !== 'grid' || !r.occt) continue;
  const g = r.analytic.volume, b = r.brep.volume, o = r.occt.volume;
  if (Math.abs(b - g) <= TOLG * Math.max(1, g) && Math.abs(o - g) > 0.05 * Math.max(1, g)) {
    r.cls = 'OCCT-WRONG'; r.wrong = [`brep ${b} within ${TOLG * 100}% of grid oracle ${g.toFixed(2)}; OCCT ${o} is not`];
  }
}
for (const r of recs) {
  if (r.cls === 'WRONG' && r.wrong && r.wrong.every((w) => w.startsWith('WRONG-VOLUME')) && r.occt && r.occt.volume <= 0 && r.brep.volume > 0) {
    r.cls = 'OCCT-WRONG'; r.wrong = [`OCCT reports volume ${r.occt.volume} (negative) for a solid brep-rs measures at ${r.brep.volume}`];
  }
}
const byFam = {};
for (const r of recs) { const k = `${r.family}/seed${r.seed}`; ((byFam[k] ??= {})[r.cls] = (byFam[k][r.cls] ?? 0) + 1); }
console.log(`scripts: ${recs.length}`);
for (const [fam, c] of Object.entries(byFam)) console.log(fam.padEnd(8), JSON.stringify(c));
const tot = {};
for (const r of recs) tot[r.cls] = (tot[r.cls] ?? 0) + 1;
console.log('TOTAL   ', JSON.stringify(tot));

// refusal sentences, ids stripped
const norm = (s) => s.replace(/\b(box|cyl|cylinder|sphere|cone|torus|ring|prism|wedge|hole|round|bevel|fillet|shell|hollow|op|move|mirror|pattern|rep|rev|ext|combine)\d+\b/g, '<id>').replace(/-?\d+(\.\d+)?/g, '#');
const freq = new Map();
for (const r of recs) {
  if (r.cls !== 'REFUSED') continue;
  const s = norm(Object.values(r.refusals ?? {}).join(' | '));
  freq.set(s, (freq.get(s) ?? 0) + 1);
}
console.log('\nREFUSAL SENTENCES (normalised)');
for (const [s, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(n).padStart(6), s.slice(0, 230));

const ser = {};
for (const r of recs) if (r.cls === 'SCRIPT-ERROR') ser[norm(r.scriptError ?? '').slice(0, 110)] = (ser[norm(r.scriptError ?? '').slice(0, 110)] ?? 0) + 1;
console.log('\nSCRIPT ERRORS (not kernel)');
for (const [s, n] of Object.entries(ser).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(String(n).padStart(6), s);

// chain-level refusal rate
const chain = {};
for (const r of recs) { const k = r.tags?.chain; if (!k || r.cls === 'SCRIPT-ERROR') continue; (chain[k] ??= { n: 0, ref: 0, ok: 0 }); chain[k].n++; if (r.cls === 'REFUSED') chain[k].ref++; else if (r.cls.startsWith('AGREE')) chain[k].ok++; }

const bad = recs.filter((r) => /^(WRONG|SUSPECT|BREP-|OCCT-HANG|OCCT-CRASH|NO-SHAPE)/.test(r.cls));
console.log(`\nNON-CLEAN: ${bad.length}`);
if (process.argv.includes('--wrong')) for (const r of bad) {
  console.log(`\n[${r.cls}] ${r.family}#${r.i} seed ${r.seed} chain ${r.tags?.chain}${r.tags?.cat ? ' cat ' + r.tags.cat : ''}`);
  console.log(r.code.split('\n').map((l) => '    ' + l).join('\n'));
  for (const w of r.wrong ?? [r.detail]) console.log('  -> ' + w);
}
const j = process.argv.indexOf('--json');
if (j > -1) writeFileSync(process.argv[j + 1], JSON.stringify({ totals: tot, byFam, bad, chain }, null, 1));
