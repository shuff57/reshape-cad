// prints a good/bad/refused grid: rows shape-size, columns offsets. usage: bun tools-grid.mjs results/e12.json [prefix]
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const g = {};
for (const r of rows) {
  const m = /^(\w+?)-(.+?)-s([\d.e-]+)-e([\d.e+]+)$/.exec(r.id); if (!m) continue;
  const k = `${m[2]} s${m[3]}`;
  const c = r.status === 'built' ? (r.good ? 'ok ' : 'BAD') : r.status === 'guard-refused' ? 'grd' : r.status === 'truck-refused' ? 'REF' : r.status.slice(0, 3);
  (g[k] ??= {})[m[4]] = c;
}
const cols = [...new Set(rows.map((r) => /-e([\d.e+]+)$/.exec(r.id)?.[1]))].filter(Boolean);
console.log('case'.padEnd(18), cols.map((c) => c.padStart(8)).join(''));
for (const [k, v] of Object.entries(g)) console.log(k.padEnd(18), cols.map((c) => (v[c] ?? '-').padStart(8)).join(''));
