// hang-search-page.mjs <page.jsonl> [<page-budget-all.jsonl>]: plan item 5, the 31 awkward documents over 20 s in the REAL page (sweep/page-run.mjs,
// mode off): as shipped, and (second file) with BUDGET_ALL=1, where every run the layer sends without a time budget is given one of 45 s and so goes
// through the worker first. A run without a budget is made on the page's own thread: nothing is drawn and nothing can stop it until it comes back.
import fs from 'node:fs';
const L = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); const s1 = (ms) => (ms / 1000).toFixed(1);
const [A, B] = process.argv.slice(2); const a = L(A); const b = B ? new Map(L(B).map((r) => [r.id, r])) : null;
const built = (r) => r.steps.filter((s) => s.status === 'built').length;
console.log(`${a.length} documents in the page as shipped${b ? `, ${b.size} with a 45 s budget on every run` : ''}`);
console.log('  as shipped: the page\'s time | its longest run without a budget (the last command of that run) | runs without a budget'
  + (b ? '   ||   budget on every run: the page\'s time | steps built, against as shipped' : ''));
for (const r of [...a].sort((x, y) => (y.slowestNoBudgetMs ?? 0) - (x.slowestNoBudgetMs ?? 0))) { const q = b?.get(r.id);
  console.log(`  ${r.id.padEnd(24)} ${r.threw || r.error ? 'NO ANSWER: ' + String(r.threw ?? r.error).slice(0, 60) : s1(r.wallMs).padStart(6) + ' s'} | ${s1(r.slowestNoBudgetMs ?? 0).padStart(5)} s (${r.slowestNoBudget ?? '-'}) | ${r.noBudgetRuns}`
    + (q ? `   ||   ${q.threw || q.error ? 'NO ANSWER: ' + String(q.threw ?? q.error).slice(0, 60) : s1(q.wallMs).padStart(6) + ' s'} | ${built(q)} against ${built(r)}` : '')); }
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) ?? 0), 0); const slow = a.map((r) => r.slowestNoBudgetMs ?? 0);
console.log(`as shipped: no answer ${a.filter((r) => r.threw || r.error).length}; the page's time ${s1(sum(a, (r) => r.wallMs))} s in all, the longest ${s1(Math.max(...a.map((r) => r.wallMs)))} s; documents whose longest run without a budget is over 5 s ${slow.filter((x) => x > 5000).length}, over 20 s ${slow.filter((x) => x > 20000).length}, over 45 s ${slow.filter((x) => x > 45000).length}; the longest ${s1(Math.max(...slow))} s`);
if (b) { const both = a.filter((r) => b.has(r.id)); const q = both.map((r) => b.get(r.id)); const slowQ = q.map((r) => r.slowestNoBudgetMs ?? 0);
  console.log(`with a budget on every run (${both.length} documents): no answer ${q.filter((r) => r.threw || r.error).length}; the page's time ${s1(sum(q, (r) => r.wallMs))} s in all against ${s1(sum(both, (r) => r.wallMs))} s as shipped, the longest ${s1(Math.max(...q.map((r) => r.wallMs)))} s; steps built ${sum(q, built)} against ${sum(both, built)}; the longest run still made without a budget ${s1(Math.max(...slowQ))} s (${q.find((r) => (r.slowestNoBudgetMs ?? 0) === Math.max(...slowQ))?.slowestNoBudget ?? '-'})`); }
if (b) for (const r of a) { const q = b.get(r.id); if (!q) continue; // a step that is built as shipped and not with the budget: the 45 s limit stopped it
  for (const s of q.steps) { const o = r.steps.find((t) => t.id === s.id); if (o && o.status === 'built' && s.status !== 'built') console.log(`  not built with the budget: ${r.id} ${s.id} (${s.kind}): ${(s.refusal ?? '').slice(0, 150)}`); } }
