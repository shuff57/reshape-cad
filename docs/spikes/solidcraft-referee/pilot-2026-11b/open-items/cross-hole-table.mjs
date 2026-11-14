// cross-hole-table.mjs <family.json>=<hr-*.jsonl> [more pairs...]: plan item 4, the table. One row per kind of case: how many, how many the engine cut,
// what the oracles say of those, the largest difference from the volume worked out by hand, how long a script took, and what refused the rest.
// The rows are the host route with G-CURVED switched off (GUARDS_OFF=G-CURVED): every other guard is as shipped.
import fs from 'node:fs';
const L = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rows = [];
for (const pair of process.argv.slice(2)) { const [fam, hr] = pair.split('=');
  const tags = new Map(JSON.parse(fs.readFileSync(fam, 'utf8')).map((c) => [c.id, c]));
  for (const r of L(hr)) { const c = tags.get(r.id); if (!c) continue;
    const holes = (r.feats ?? []).filter((f) => f.kind === 'hole'); const refused = holes.find((f) => f.status !== 'built');
    const v = r.final?.m?.volume ?? null; const rel = c.analytic != null && v != null && !refused ? (v - c.analytic) / c.analytic : null;
    rows.push({ id: r.id, tags: c.tags, hang: !!r.hang || !!r.crashed, built: !refused && !r.hang && !r.crashed, guard: refused ? (refused.guard ?? 'refused') : null, verdict: r.final?.verdict ?? (r.hang ? 'HANG' : null),
      okO: r.final?.okO ?? null, okB: r.final?.okB ?? null, rel, ms: r.ms ?? null, faces: r.final?.m?.faces ?? null });
  } }
const band = (x) => (x < 0.1 ? 'under 10%' : x < 0.25 ? '10 to 25%' : x < 0.5 ? '25 to 50%' : x < 0.75 ? '50 to 75%' : '75% and over');
const order = ['under 10%', '10 to 25%', '25 to 50%', '50 to 75%', '75% and over'];
function table(title, list, keyOf, keys) {
  const g = new Map(); for (const r of list) { const k = keyOf(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  console.log(`\n${title}\n| | cases | cut | of those RIGHT | not RIGHT | largest difference from the hand volume | script time, median / longest | not cut, and by what |\n|---|---|---|---|---|---|---|---|`);
  for (const k of (keys ?? [...g.keys()].sort())) { const a = g.get(k); if (!a) continue; const b = a.filter((r) => r.built); const right = b.filter((r) => r.verdict === 'RIGHT');
    const rels = b.map((r) => r.rel).filter((x) => x !== null).map(Math.abs); const ms = a.map((r) => r.ms).filter((x) => x !== null).sort((x, y) => x - y);
    const why = {}; for (const r of a.filter((r) => !r.built)) { const w = r.hang ? 'no answer' : r.guard; why[w] = (why[w] ?? 0) + 1; }
    const bad = b.filter((r) => r.verdict !== 'RIGHT').map((r) => `${r.verdict} ${r.id}`);
    console.log(`| ${k} | ${a.length} | ${b.length} | ${right.length} | ${bad.length ? bad.join('; ') : '0'} | ${rels.length ? Math.max(...rels).toExponential(1) + ` (${rels.length})` : 'no hand volume'} | ${ms.length ? (ms[ms.length >> 1] / 1000).toFixed(1) + ' / ' + (ms.at(-1) / 1000).toFixed(1) + ' s' : '-'} | ${Object.entries(why).map(([w, n]) => `${n} ${w}`).join(', ') || '-'} |`); }
}
const cyl = rows.filter((r) => r.tags.shape === 'cylinder' && ['axis', 'off', 'graze', 'break'].includes(r.tags.off));
table('A plain cylinder, one bore across it, by how wide the bore is against the cylinder', cyl, (r) => band(r.tags.ratio), order);
table('The same cases by where the bore is: through the axis, off it, its edge just inside the wall, breaking out of the side', cyl, (r) => r.tags.off, ['axis', 'off', 'graze', 'break']);
table('The same cases by whether the bore stays clear of the caps (the second family only records this)', cyl.filter((r) => r.tags.cap), (r) => (r.tags.cap === 'cap' ? 'reaches a cap' : 'clear of the caps'));
table('By the size of the cylinder (radius)', cyl, (r) => (r.tags.R < 8 ? 'under 8' : r.tags.R < 16 ? '8 to 16' : 'over 16'), ['under 8', '8 to 16', 'over 16']);
table('Everything else', rows.filter((r) => !cyl.includes(r)), (r) => `${r.tags.shape}${r.tags.off && !['axis', 'off'].includes(r.tags.off) ? ', ' + r.tags.off : ''}`);
const all = rows.filter((r) => r.built); const slow = rows.filter((r) => r.ms > 20000).sort((a, b) => b.ms - a.ms);
console.log(`\n${rows.length} cases; ${all.length} cut; of those ${all.filter((r) => r.verdict === 'RIGHT').length} RIGHT; OCCT agrees on ${all.filter((r) => r.okO === true).length}, disagrees on ${all.filter((r) => r.okO === false).length}, says nothing on ${all.filter((r) => r.okO === null).length}; brep-rs agrees on ${all.filter((r) => r.okB === true).length}, says nothing on ${all.filter((r) => r.okB === null).length}.`);
console.log(`scripts over 20 s: ${slow.length}` + slow.slice(0, 12).map((r) => `\n  ${(r.ms / 1000).toFixed(1)} s  ${r.id}  ${r.built ? 'cut' : r.guard}`).join(''));
const worst = all.filter((r) => r.rel !== null).sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 5);
console.log('furthest from the hand volume:' + worst.map((r) => `\n  ${r.rel.toExponential(2)}  ${r.id}`).join(''));
