// before (results/) vs after (results-guarded/), case by case. Usage: bun cmp-guard.mjs [changed|all|regress]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const load = (dir) => { const m = new Map(); const d = new URL(`./${dir}/`, import.meta.url).pathname; if (!existsSync(d)) return m; for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) { const rows = JSON.parse(readFileSync(d + f, 'utf8')); if (!Array.isArray(rows)) continue; /* solve-moves, solve-check and pkg-probe are objects, not case rows */ for (const r of rows) if (r && typeof r.id === 'string') m.set(r.id, { file: f.replace('.json', ''), ...r }); } return m; };
export const before = load('results');
export const after = load('results-guarded');
const kind = (r) => {
  if (!r) return 'absent';
  if (r.custom) return r.outcome;
  if (r.outcome === 'SCRIPT-REFUSED') return 'SCRIPT-REFUSED';
  if (r.truck?.refused !== undefined) return 'REFUSED';
  return r.outcome;
};
const want = process.argv[2] ?? 'changed';
const lines = [];
if (import.meta.main) {
for (const [id, a] of after) {
  const b = before.get(id);
  const kb = kind(b); const ka = kind(a);
  const changed = kb !== ka;
  const regress = (kb === 'PASS' || kb === 'PASS-FACES-DIFFER') && ka !== kb;
  if (want === 'all' || (want === 'changed' && changed) || (want === 'regress' && regress)) {
    const s = a.truck?.refused ?? (a.truck?.volume !== undefined ? `built ${a.truck.volume.toPrecision(8)}` : '') ?? '';
    lines.push(`${a.file.padEnd(9)} ${id.padEnd(34)} ${kb.padEnd(16)} -> ${ka.padEnd(16)} ${String(s).slice(0, 230)}`);
  }
}
console.log(lines.join('\n'));
console.log(`(${lines.length} of ${after.size} guarded cases)`);
}
