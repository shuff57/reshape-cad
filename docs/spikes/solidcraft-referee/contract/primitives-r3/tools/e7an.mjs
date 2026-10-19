const r = JSON.parse(require('fs').readFileSync(process.argv[2]));
const pre = process.argv[3] || 'e7';
const g = new Map();
for (const x of r) { const m = new RegExp(`${pre}-(\\w+)-s([\\d.]+)-e([\\de+.]+)`).exec(x.id); if (!m) continue; const k = m[1] + ' s' + m[2]; if (!g.has(k)) g.set(k, []); const t = x.truck; g.get(k).push(`${(+m[3]).toExponential(0)}:${x.status !== 'built' ? 'R' : x.good ? 'g' : 'B'}${t ? (t.dVolOcct ?? t.dVolAn ?? 0).toExponential(0) + '/' + (t.dComOcct ?? 0).toExponential(0) : ''}`); }
for (const [k, v] of g) console.log(k.padEnd(12), v.join(' '));
