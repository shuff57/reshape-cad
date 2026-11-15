// cross-hole-before-after.mjs <after> <before>: two outputs of sweep/sweep-all.sh (with PAGE), one from before the plain through bore across a
// cylinder was allowed and one from after (plan item 4). Prints
//   1. every step that is built after and was refused before (and the other way round), with how its document is judged;
//   2. the page's time for every document whose time moved by more than 5 s, and what changed in it;
//   3. how many documents the page takes long over, before and after.
// sweep/compare-sweeps.mjs prints the same two sweeps step by step, classed; this file adds the verdicts and the page's clock.
import fs from 'node:fs';
const [AFTER, BEFORE] = process.argv.slice(2);
const L = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const strip = (id) => id.replace(/^[a-z]+#\d+ /, ''); const s1 = (ms) => (ms / 1000).toFixed(1);
const SETS = [['corpora', ['holes', 'sd', 'mt', 'combined', 'rgcombined', 'fccombined']], ['new', ['combined', 'rgcombined', 'fccombined']]];

console.log('1. steps built now and refused before');
let nUp = 0, nDown = 0, docsUp = 0; const verdicts = {};
for (const [d, cs] of SETS) for (const c of cs) {
  const before = new Map(L(`${BEFORE}/${d}/full/hr-${c}.jsonl`).map((r) => [r.id, r])); const judged = new Map(L(`${AFTER}/${d}/built/hr-${c}.jsonl`).map((r) => [r.id, r]));
  for (const a of L(`${AFTER}/${d}/full/hr-${c}.jsonl`)) { const b = before.get(a.id); if (!b?.feats || !a.feats) continue;
    const was = (f) => b.feats.find((g) => g.id === f.id);
    const up = a.feats.filter((f) => f.status === 'built' && was(f)?.status === 'refused'); const down = a.feats.filter((f) => f.status === 'refused' && was(f)?.status === 'built');
    if (!up.length && !down.length) continue; nUp += up.length; nDown += down.length; if (up.length) docsUp++; const j = judged.get(a.id); const v = j?.final?.verdict ?? 'not judged'; verdicts[v] = (verdicts[v] ?? 0) + 1;
    console.log(`  ${d}/${c} ${a.id}: ${up.map((f) => `${f.id} (${f.kind}, was ${was(f).guard})`).join(', ')}${down.length ? ' | NOW REFUSED: ' + down.map((f) => `${f.id} ${f.guard}`).join(', ') : ''} | the document as built: ${j ? `${j.measureId} ${v}` : 'no row'}${(j?.others ?? []).length ? ', other parts ' + j.others.map((o) => `${o.id} ${o.verdict}`).join(', ') : ''} | Node ${s1(a.ms)} s (was ${s1(b.ms)})`); }
}
console.log(`  ${nUp} steps in ${docsUp} documents built now and refused before; ${nDown} the other way round; the documents as built: ${JSON.stringify(verdicts)}`);

console.log('\n2. the page: documents whose time moved by more than 5 s');
const all = { before: [], after: [] }; const moved = []; let sumA = 0, sumB = 0, n = 0;
for (const [d, cs] of SETS) for (const c of cs) {
  const before = new Map(L(`${BEFORE}/${d}/page/${c}.jsonl`).map((r) => [r.id, r]));
  for (const a of L(`${AFTER}/${d}/page/${c}.jsonl`)) { const b = before.get(a.id); if (!b) continue; n++; sumA += a.wallMs; sumB += b.wallMs; all.after.push([a.wallMs, strip(a.id)]); all.before.push([b.wallMs, strip(b.id)]);
    if (Math.abs(a.wallMs - b.wallMs) < 5000) continue; const was = (s) => b.steps.find((t) => t.id === s.id);
    const up = a.steps.filter((s) => s.status === 'built' && was(s)?.status === 'refused').map((s) => s.id);
    const blocked = a.steps.filter((s) => s.kind === 'hole' && s.status === 'refused' && /^.*\(hole\): it comes after /.test(s.refusal ?? '') && /curved wall/.test(was(s)?.refusal ?? '')).map((s) => s.id);
    moved.push([a.wallMs - b.wallMs, `  ${s1(a.wallMs)} s (was ${s1(b.wallMs)})  ${d}/${strip(a.id)}: ${up.length ? `cuts ${up.join(', ')} now` : blocked.length ? `${blocked.join(', ')} is refused as blocked now, after a test cut` : 'no step changed'}; runs in the page's engine ${a.runs}, runs in the worker under the budget ${a.probes} (${s1(a.probeMs)} s)`, up.length ? 'cut' : blocked.length ? 'blocked' : 'other']); }
}
moved.sort((x, y) => y[0] - x[0]); for (const m of moved) console.log(m[1]);
const cls = (k) => moved.filter((m) => m[2] === k); const rng = (a) => (a.length ? `${s1(Math.min(...a.map((m) => m[0])))} to ${s1(Math.max(...a.map((m) => m[0])))} s more` : '-');
console.log(`  ${moved.length} documents: ${cls('cut').length} cut a bore now (${rng(cls('cut'))}), ${cls('blocked').length} test-cut a blocked bore and refuse it as blocked (${rng(cls('blocked'))}), ${cls('other').length} with no step changed (the clock)`);

console.log('\n3. the page: slow documents');
for (const h of ['before', 'after']) { const s = all[h].sort((x, y) => y[0] - x[0]); const over = (t) => s.filter((x) => x[0] > t).length;
  console.log(`  ${h}: ${s.length} documents; over 10 s ${over(10000)}, over 20 s ${over(20000)}, over 45 s ${over(45000)}, over 90 s ${over(90000)}; the five slowest: ${s.slice(0, 5).map((x) => `${(x[0] / 1000).toFixed(0)} s ${x[1]}`).join('; ')}`); }
console.log(`  ${n} documents; the page's time in all: ${(sumB / 60000).toFixed(1)} min before, ${(sumA / 60000).toFixed(1)} min after`);
