#!/usr/bin/env node
// Confusion matrix of the static cost rule (revolve-groove.guard.mjs costRefusal) against measured cost records written by rg3-cost.mjs (run with RG_OFF=G8, so every case
// that is not refused for another reason was actually computed).  slow = CPU > SUPPORT_S (30 s) or killed at the timeout; flagged = the rule refuses it.
//   bun rg3-cost-eval.mjs <records.json> [<records.json> ...] [--list]
import { readFileSync } from 'node:fs';
import { costRefusal, COST_SUPPORT_S } from '../revolve-groove.guard.mjs';
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const featFile = (process.argv.find((a) => a.startsWith('--features=')) ?? '').slice(11);
const list = process.argv.includes('--list');
const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
// --features=<rg3-featurize output>: recompute the cost features with the CURRENT guard (the records may predate a feature), keyed by case id
if (featFile) { const F = new Map(JSON.parse(readFileSync(featFile, 'utf8')).map((x) => [x.id, x])); for (const r of rows) { const g = F.get(r.id)?.grooves?.at(-1); if (g?.cost) r.cost = g.cost; } }
const m = { slowFlagged: [], slowHole: [], fastFlagged: [], fastOk: [], skipped: [] };
for (const r of rows) {
  const timedOut = r.status === 'TIMEOUT';
  const built = r.status === 'built';
  const cpu = r.cpuMs != null ? r.cpuMs / 1000 : null;
  // a case refused/failed AFTER a long computation still cost that time (the engine failed at the end): count its cpu as well
  if (!r.cost || (!timedOut && cpu === null)) { m.skipped.push(r); continue; }
  if (!timedOut && !built && cpu < 1) { m.skipped.push(r); continue; }       // refused by a static guard before any engine work
  const slow = timedOut || cpu > COST_SUPPORT_S;
  const flagged = !!costRefusal(r.cost);
  (slow ? (flagged ? m.slowFlagged : m.slowHole) : (flagged ? m.fastFlagged : m.fastOk)).push(r);
}
const f = (r) => `${r.id} ${r.status} cpu=${r.cpuMs != null ? (r.cpuMs / 1000).toFixed(1) : '-'} ${r.cost.tool}/${r.cost.partial ? 'part' : 'full'} curved=${r.cost.curved} coax=${r.cost.coaxial} reach=${r.cost.reachesWall} axisW=${r.cost.worldAxis}`;
console.log(`records ${rows.length}; scored ${rows.length - m.skipped.length} (skipped ${m.skipped.length}: no engine work or no features)`);
console.log(`slow & refused ${m.slowFlagged.length} | slow & NOT refused (HOLES) ${m.slowHole.length} | fast & refused (over-refusal) ${m.fastFlagged.length} | fast & built ${m.fastOk.length}`);
console.log('max cpu of unrefused scored cases:', Math.max(0, ...[...m.fastOk, ...m.slowHole].map((r) => (r.cpuMs ?? 0) / 1000)).toFixed(1), 's');
if (list || m.slowHole.length) { console.log('HOLES:'); m.slowHole.forEach((r) => console.log('  ' + f(r))); }
if (list) { console.log('OVER-REFUSALS:'); m.fastFlagged.forEach((r) => console.log('  ' + f(r))); console.log('SLOW & REFUSED:'); m.slowFlagged.forEach((r) => console.log('  ' + f(r))); console.log('FAST & BUILT (top 15 by cpu):'); m.fastOk.sort((a, b) => b.cpuMs - a.cpuMs).slice(0, 15).forEach((r) => console.log('  ' + f(r))); }
