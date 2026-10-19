// SPIKE, referee only. Checks the guarded rig runs of primitives-r3/g-supported.mjs (g1) and g-refused.mjs (g2):
//   g1 (guarded)   : every case must be status built AND good  (the guard must not take a supported row away)
//   g2 (guarded)   : every case must be status guard-refused with the expected code and a sentence that passes the lint
//   g2 (unguarded) : what a student gets today (wrong solid / truck's own text / interpreter text), printed beside the guard sentence
//   bun contract/primitives-regress-check.mjs <g1.json> <g2-guarded.json> <g2-unguarded.json> [--out=<summary.txt>]
import { readFileSync, writeFileSync } from 'node:fs';
import * as G from './primitives.guard.mjs';
const [f1, f2, f3] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outP = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const j = (f) => JSON.parse(readFileSync(f, 'utf8'));
const lines = []; const log = (s) => { lines.push(s); console.log(s); };
let fail = 0;
const g1 = j(f1);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const by = new Map();
for (const r of g1) { const k = r.id.replace(/-r\d$/, ''); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
log('== g1: supported representatives through the guard (3 repeats each) ==');
log('id'.padEnd(22) + 'row'.padEnd(20) + 'status'.padEnd(10) + 'dVol(oracle)'.padEnd(14) + 'faces'.padEnd(8) + 'wall ms med/max'.padEnd(18) + 'cpu ms med' + '  load');
for (const [k, rs] of by) {
  const ok = rs.every((r) => r.status === 'built' && r.good);
  if (!ok) fail++;
  const t = rs[0].truck;
  log(k.padEnd(22) + String(rs[0].row).padEnd(20) + (ok ? 'ok' : 'FAIL ' + rs.map((r) => r.status + ':' + (r.why ?? r.refusal ?? r.guard?.sentence ?? '')).join('|')).padEnd(10)
    + (t ? (t.dVolOcct ?? t.dVolAn)?.toExponential(1) : '-').padEnd(14) + (t ? `${t.faces}/${t.facesOcct ?? '-'}` : '-').padEnd(8)
    + `${med(rs.map((r) => r.ms ?? 0))}/${Math.max(...rs.map((r) => r.ms ?? 0))}`.padEnd(18) + `${med(rs.map((r) => r.cpuMs ?? 0))}`.padEnd(8) + `  ${med(rs.map((r) => r.load)).toFixed(0)}`);
}
log(`g1: ${by.size} representatives, ${fail} failing`);
let f2n = 0; let f2fail = 0;
const un = f3 ? new Map(j(f3).map((r) => [r.id, r])) : new Map();
log('\n== g2: refused representatives: guard sentence vs what the rig does without the guard ==');
for (const r of j(f2)) {
  f2n++;
  const bad = [];
  if (r.status !== 'guard-refused') bad.push(`status ${r.status}`);
  else {
    if (r.guard.code !== r.code) bad.push(`code ${r.guard.code} != ${r.code}`);
    const p = G.sentenceProblems(r.guard.sentence);
    if (p.length) bad.push('sentence ' + p.join(','));
  }
  if (bad.length) f2fail++;
  const u = un.get(r.id);
  const before = !u ? '(not run unguarded)' : u.status === 'built' ? `BUILT ${u.good ? 'good??' : 'WRONG'} ${u.why ?? ''} ${u.truck ? 'vol ' + u.truck.volume.toExponential(4) + ' faces ' + u.truck.faces : ''}`.trim()
    : u.status === 'truck-refused' ? 'truck text: ' + String(u.refusal).replace(/^.*solidcraft refused it -- /, '') : u.status === 'script-refused' ? 'interpreter: ' + u.refusal : u.status;
  log(`${bad.length ? 'FAIL ' + bad.join(';') + ' ' : ''}${r.id.replace('g2-', '')} [${r.code}]\n    guard : ${r.guard?.sentence ?? '-'}\n    before: ${before}`);
}
log(`g2: ${f2n} cases, ${f2fail} failing`);
if (outP) writeFileSync(outP, lines.join('\n') + '\n');
process.exitCode = fail || f2fail ? 1 : 0;
