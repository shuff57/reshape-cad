// across-switch-check.mjs <the final sweep (sweep-all.sh output, without the switch)> <run with the switch>...: the page sets probeBlockedNoAcrossCut since
// 2026-11-15 (owner decision "keep, skip the test cut"): a blocked plain through bore across a cylinder has its guards asked and is not test-cut.
// The runs with the switch hold, between them, every case with a hole the curved-wall guard refused before the allowance (288: 280 generated
// documents in one run, 8 corpus scripts in another), run again on the tree with the switch set: node/hr-across.jsonl (sweep/host-route-sweep.mjs, the page's settings, no oracles) and page.jsonl (sweep/page-run.mjs, mode off).
// Each is compared step by step with the same document in the final sweep: status, guard, sentence, volume; and the time.
import fs from 'node:fs';
const [FINAL, ...RUNS] = process.argv.slice(2); const all = (f) => RUNS.flatMap((r) => (fs.existsSync(`${r}/${f}`) ? L(`${r}/${f}`) : []));
const L = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); const strip = (id) => id.replace(/^[a-z]+#\d+ /, ''); const s1 = (ms) => (ms / 1000).toFixed(1);
const cache = new Map(); const ref = (kind, d, c) => { const k = `${kind}/${d}/${c}`; if (!cache.has(k)) cache.set(k, new Map(L(kind === 'node' ? `${FINAL}/${d}/full/hr-${c}.jsonl` : `${FINAL}/${d}/page/${c}.jsonl`).map((r) => [strip(r.id), r]))); return cache.get(k); };
const split = (id) => { const [d, c, ...rest] = id.split('/'); return [d, c, rest.join('/')]; };
const close = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));

console.log('Node, the page\'s settings');
{ let n = 0, same = 0, tA = 0, tB = 0; const diff = []; const faster = [];
  for (const a of all('node/hr-across.jsonl')) { const [d, c, id] = split(a.id); const b = ref('node', d, c).get(id); n++; if (!b || !a.feats || !b.feats) { diff.push(`${a.id}: no steps on one side`); continue; }
    tA += a.ms; tB += b.ms; if (b.ms - a.ms > 3000) faster.push([b.ms - a.ms, `${a.id} ${s1(b.ms)} -> ${s1(a.ms)} s`]);
    const dd = a.feats.filter((f, i) => { const g = b.feats[i]; return !g || f.id !== g.id || f.status !== g.status || f.guard !== g.guard || f.refusal !== g.refusal || !close(f.m?.volume, g.m?.volume); });
    if (dd.length) diff.push(`${a.id}: ${dd.map((f) => { const g = b.feats.find((x) => x.id === f.id); return `${f.id} was ${g?.status}/${g?.guard ?? '-'} "${(g?.refusal ?? '').slice(0, 70)}" now ${f.status}/${f.guard ?? '-'} "${(f.refusal ?? '').slice(0, 70)}"`; }).join('; ')}`); else same++; }
  console.log(`  ${n} documents; every step the same (status, guard, sentence, volume) in ${same}; differ in ${diff.length}`); for (const x of diff) console.log(`    ${x}`);
  console.log(`  time in all: ${s1(tB)} s without the switch, ${s1(tA)} s with it; ${faster.length} documents more than 3 s faster (${faster.sort((x, y) => y[0] - x[0]).slice(0, 4).map((x) => x[1]).join('; ')}${faster.length > 4 ? '; ...' : ''})`); }

console.log('\nthe real page');
{ let n = 0, same = 0, tA = 0, tB = 0; const diff = []; const moved = []; const over = (rows, t) => rows.filter((x) => x > t).length; const wa = [], wb = [];
  for (const a of all('page.jsonl')) { const [d, c, id] = split(a.id); const b = ref('page', d, c).get(id); n++; if (!b || a.threw || a.error) { diff.push(`${a.id}: ${a.threw ?? a.error ?? 'no earlier row'}`); continue; }
    tA += a.wallMs; tB += b.wallMs; wa.push(a.wallMs); wb.push(b.wallMs); if (Math.abs(a.wallMs - b.wallMs) > 3000) moved.push([b.wallMs - a.wallMs, `${a.id} ${s1(b.wallMs)} -> ${s1(a.wallMs)} s`]);
    const dd = a.steps.filter((s, i) => { const t = b.steps[i]; return !t || s.id !== t.id || s.status !== t.status || s.refusal !== t.refusal; });
    if (dd.length || a.status !== b.status || !close(a.volume, b.volume)) diff.push(`${a.id}: ${dd.map((s) => { const t = b.steps.find((x) => x.id === s.id); return `${s.id} was ${t?.status} "${(t?.refusal ?? '').slice(0, 70)}" now ${s.status} "${(s.refusal ?? '').slice(0, 70)}"`; }).join('; ') || `volume ${b.volume} -> ${a.volume}`}`); else same++; }
  console.log(`  ${n} documents; every step, sentence and the final volume the same in ${same}; differ in ${diff.length}`); for (const x of diff) console.log(`    ${x}`);
  console.log(`  the page's time in all: ${s1(tB)} s without the switch, ${s1(tA)} s with it; over 10 s: ${over(wb, 10000)} -> ${over(wa, 10000)}, over 20 s: ${over(wb, 20000)} -> ${over(wa, 20000)}, over 45 s: ${over(wb, 45000)} -> ${over(wa, 45000)}`);
  const faster = moved.filter((m) => m[0] > 0).sort((x, y) => y[0] - x[0]); const slower = moved.filter((m) => m[0] < 0).sort((x, y) => x[0] - y[0]);
  console.log(`  more than 3 s faster: ${faster.length}`); for (const m of faster) console.log(`    ${m[1]}`);
  console.log(`  more than 3 s slower: ${slower.length}`); for (const m of slower) console.log(`    ${m[1]}`); }
