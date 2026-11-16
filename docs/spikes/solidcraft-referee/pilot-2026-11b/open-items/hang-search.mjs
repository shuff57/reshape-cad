// hang-search.mjs <dir of the search> <trace.log>: plan item 5, a step that hangs without a crash.
//   <dir of the search>  ten slices s0..s9, each with cases.json (awkward-family.mjs) and hr-awkward.jsonl: sweep/host-route-sweep.mjs --no-oracle
//                        --timeout=120 with the page's settings (PROBE_BLOCKED=1 PROBE_STEPS=1). A case without an answer in 120 s is a HANG row.
//   <trace.log>          the cases over 20 s again with TRACE_CALLS=1 and --timeout=900: one line before and after every engine call.
// Prints the size of the search, the time of a script, and for every traced case: how long it took, which engine call first took long (the
// call's last command is the one a step added; the commands before it were run before, in a shorter list), whether that call ran under a
// budget, and the longest call WITHOUT a budget (the page makes those on its own thread, where nothing can stop them).
import fs from 'node:fs';
const [DIR, TRACE] = process.argv.slice(2); const s1 = (ms) => (ms / 1000).toFixed(1);
const rows = []; let cases = 0; const docs = new Map();
for (let k = 0; k < 10; k++) { for (const c of JSON.parse(fs.readFileSync(`${DIR}/s${k}/cases.json`, 'utf8'))) { cases++; docs.set(c.id, c.doc); }
  for (const l of fs.readFileSync(`${DIR}/s${k}/hr-awkward.jsonl`, 'utf8').split('\n').filter(Boolean)) rows.push(JSON.parse(l)); }
const none = rows.filter((r) => r.hang || r.crashed || r.threw); const ms = rows.filter((r) => !none.includes(r)).map((r) => r.ms ?? 0).sort((a, b) => a - b); const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
const kinds = {}; let steps = 0, built = 0; for (const r of rows) for (const f of r.feats ?? []) { steps++; if (f.status === 'built') built++; if (f.kind !== 'sketch') kinds[f.kind] = (kinds[f.kind] ?? 0) + 1; }
console.log(`the search: ${cases} documents, ${rows.length} rows; ${steps} steps, ${built} built; no hole in any (${JSON.stringify(kinds)})`);
console.log(`a crash: ${rows.filter((r) => r.crashed).length}; threw: ${rows.filter((r) => r.threw).length}; no answer in 120 s: ${rows.filter((r) => r.hang).length}`);
console.log(`a script's time (the ${ms.length} with an answer): median ${(q(0.5) / 1000).toFixed(2)} s, 90% under ${s1(q(0.9))} s, 99% under ${s1(q(0.99))} s, the longest ${s1(ms.at(-1))} s; over 5 s ${ms.filter((x) => x > 5000).length}, over 10 s ${ms.filter((x) => x > 10000).length}, over 20 s ${ms.filter((x) => x > 20000).length}`);
if (!TRACE) process.exit(0);

// ---- the trace. A case's calls are numbered from #1; its result line is printed by the parent and can come a line late, so the calls are cut
// into cases at every "#1" and the result lines are matched to them in order ----
const was = new Map(rows.map((r) => [r.id, r.hang ? 'no answer in 120 s' : `${s1(r.ms)} s`])); const segs = []; const results = []; let open = null;
for (const line of fs.readFileSync(TRACE, 'utf8').split('\n')) {
  let m;
  if ((m = /^CALL start (#\d+|topology reading,) (\d+) commands, last (\S+) (.*?)(budget ([\d.]+) s|no budget)$/.exec(line))) {
    if (open) { segs.at(-1).push(open); open = null; } // a call that never came back: the child was stopped
    if (m[1] === '#1') segs.push([]); if (!segs.length) segs.push([]);
    open = { topo: m[1].startsWith('topology'), n: +m[2], last: m[3], params: m[4].trim(), budget: m[6] ? +m[6] : null, ms: null, how: 'never came back' }; }
  else if ((m = /^CALL end\s+(#\d+|topology reading) (\d+) ms (.*)$/.exec(line))) { if (open) { open.ms = +m[2]; open.how = m[3]; segs.at(-1).push(open); open = null; } }
  else if ((m = /^(awkward [^\t]+)\t([^\t]*)\t([^\t]*)\t(\d+)r (\d+)ms/.exec(line))) results.push({ id: m[1], verdict: m[2], guard: m[3], ms: +m[5] });
  else if ((m = /^(awkward [^\t]+)\t(HANG|CRASH)/.exec(line))) results.push({ id: m[1], verdict: m[2], guard: '', ms: null });
}
if (open) segs.at(-1).push(open);
if (segs.length !== results.length) console.log(`NOTE: ${segs.length} groups of calls for ${results.length} result lines (a run still going, or a case that asked the engine for nothing)`);
const traced = results.map((r, i) => ({ ...r, calls: segs[i] ?? [] }));
console.log(`\nthe ${traced.length} documents over 20 s, traced call by call (limit 900 s a document)`);
const SLOW = 5000; const tally = {}; let worstNoBudget = { ms: 0 }; let anyLost = 0;
for (const t of traced.sort((a, b) => (b.ms ?? 9e9) - (a.ms ?? 9e9))) {
  const lost = t.calls.filter((c) => c.ms === null); anyLost += lost.length;
  // the first long call: its last command is new in that list (every shorter list was run before and was quick, or it is the first call)
  const first = t.calls.find((c) => (c.ms ?? Infinity) > SLOW); const noB = t.calls.filter((c) => c.budget === null && c.ms !== null).sort((a, b) => b.ms - a.ms)[0];
  const long = t.calls.filter((c) => (c.ms ?? Infinity) > SLOW); const stopped = t.calls.filter((c) => /STOPPED/.test(c.how)).length;
  if (noB && noB.ms > worstNoBudget.ms) worstNoBudget = { ...noB, id: t.id };
  const kind = first ? `${first.topo ? 'a topology reading after ' : ''}${first.last}` : 'no single call over 5 s'; tally[kind] = (tally[kind] ?? 0) + 1;
  const doc = docs.get(t.id); const sizes = first && doc ? '' : '';
  console.log(`  ${t.ms === null ? 'no answer in 900 s' : s1(t.ms) + ' s'} (in the search: ${was.get(t.id)})  ${t.id}: ${t.calls.length} engine calls, ${long.length} over 5 s${stopped ? `, ${stopped} stopped by the budget` : ''}${lost.length ? `, ${lost.length} NEVER CAME BACK` : ''}`
    + (first ? `; first long call ${first.ms === null ? '(never came back)' : s1(first.ms) + ' s'}: ${first.n} commands ending in ${first.last} ${first.params.slice(0, 110)}, ${first.budget ? `budget ${Math.round(first.budget)} s` : 'NO BUDGET'}` : '')
    + `; longest call without a budget: ${noB ? `${s1(noB.ms)} s (${noB.topo ? 'topology reading after ' : ''}${noB.last})` : 'none made'}${sizes}`);
}
console.log(`\nwhat the first long call ends in: ${JSON.stringify(tally)}`);
console.log(`calls that never came back: ${anyLost}`);
console.log(`the longest call without a budget in these documents: ${worstNoBudget.ms ? `${s1(worstNoBudget.ms)} s, ${worstNoBudget.topo ? 'a topology reading after ' : ''}${worstNoBudget.last}, ${worstNoBudget.n} commands, in ${worstNoBudget.id}` : 'none'}`);
const allNoB = traced.flatMap((t) => t.calls.filter((c) => c.budget === null && c.ms !== null).map((c) => c.ms)); const allB = traced.flatMap((t) => t.calls.filter((c) => c.budget !== null && c.ms !== null).map((c) => c.ms));
console.log(`engine calls in the traced documents: ${allNoB.length} without a budget (over 5 s: ${allNoB.filter((x) => x > 5000).length}, over 20 s: ${allNoB.filter((x) => x > 20000).length}), ${allB.length} under one (over 5 s: ${allB.filter((x) => x > 5000).length}, over 45 s: ${allB.filter((x) => x > 45000).length})`);
