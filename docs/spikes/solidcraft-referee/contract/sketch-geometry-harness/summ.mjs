// compact view of final/*.json
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('./results/', import.meta.url).pathname;
const all = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'solve-moves.json')) for (const r of JSON.parse(readFileSync(dir + f, 'utf8'))) all.push({ file: f, ...r });
export { all };
const e = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
const want = process.argv[2];
if (import.meta.main && want !== 'quiet') {
  const counts = {};
  for (const r of all) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  console.log(JSON.stringify(counts), 'total', all.length);
  for (const r of all) {
    if (want && !(r.id.includes(want) || r.outcome === want || r.file.startsWith(want))) continue;
    const t = r.truck;
    console.log(`${r.file.replace('.json', '').padEnd(9)} ${r.id.padEnd(36)} ${String(r.outcome).padEnd(18)}`,
      t?.volume !== undefined ? `vol ${t.volume.toPrecision(8)} O ${r.occt?.volume?.toPrecision?.(8) ?? '-'} B ${r.brep?.volume?.toPrecision?.(8) ?? '-'} X ${r.exact?.volume?.toPrecision?.(8) ?? '-'} dO ${e(t.dVolOcct)} dB ${e(t.dVolBrep)} dX ${e(t.dVolExact)} bbX ${e(t.dBboxExact)} com ${e(t.dComOcct)} bodies ${t.bodies}` : (r.custom ? JSON.stringify(r.summary).slice(0, 160) : `${(t?.refused ?? r.scriptErrors?.join(' | ') ?? '').slice(0, 200)} || O:${(r.occt?.refused ?? r.occt?.volume)?.toString().slice(0, 60)} B:${(r.brep?.refused ?? r.brep?.volume)?.toString().slice(0, 100)}`));
  }
}
