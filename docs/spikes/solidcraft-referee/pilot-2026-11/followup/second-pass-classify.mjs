// classify-go.mjs <seed dir>: every per-step difference between G (an unrelated block injected) and O, by class
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2] + '/diffs.json', 'utf8')).GO; const cls = {};
const norm = (s) => String(s ?? '').replace(/, so there is nothing to build on \(/, ' (').replace(/\b(Move|Turn|Copy|Box|Pocket|Cylinder|Pull|Hole) \d+/g, '$1 N').replace(/is \d+ separate pieces/, 'is N separate pieces');
for (const x of d) { if (!x.bad) { (cls['row missing or hung'] ??= []).push(x); continue; } for (const b of x.bad) { const o = b.O, g = b.G; let k;
  if (!g) k = 'step missing in G';
  else if (o[0] === 'built' && g[0] === 'built') k = `BUILT BOTH, DIFFERENT (${b.kind})`;
  else if (o[0] !== 'built' && g[0] === 'built') k = `NOT BUILT -> BUILT (${b.kind})`;
  else if (o[0] === 'built') k = `built -> refused ${b.kind} [${g[1] ?? '-'}]`;
  else if (o[1] === g[1]) k = `refused both, same guard, other words (${b.kind})`;
  else k = `refused both, other guard: ${b.kind} [${o[1] ?? '-'} -> ${g[1] ?? '-'}]`;
  (cls[k] ??= []).push({ c: x.c, id: x.id, step: b.id, gadget: x.gadget, o, g }); } }
for (const [k, v] of Object.entries(cls).sort((a, b) => b[1].length - a[1].length)) { console.log(String(v.length).padStart(5), k);
  if (!/same guard, other words/.test(k) || process.env.ALL) for (const e of v.slice(0, Number(process.env.N ?? 3))) console.log('        ', e.c, '|', e.id, '|', e.step, '|', e.gadget?.kind, '@', e.gadget?.at, '\n           O:', JSON.stringify(e.o).slice(0, 230), '\n           G:', JSON.stringify(e.g).slice(0, 230)); }
