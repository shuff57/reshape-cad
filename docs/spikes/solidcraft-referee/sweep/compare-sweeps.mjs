// every step that differs between two sweeps, classed
import fs from 'node:fs';
const L = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const [AFTER, ...BEFORE] = process.argv.slice(2); const t = {}; const ex = {}; let rows = 0, steps = 0, noBefore = 0; const add = (k, s) => { t[k] = (t[k] ?? 0) + 1; (ex[k] ??= []).push(s); };
const st = (x) => (x.status === 'refused' ? 'refused' : 'built');
for (const c of ['holes', 'sd', 'mt', 'combined', 'rgcombined', 'fccombined']) {
  const before = new Map(); for (const d of BEFORE) for (const r of L(`${d}/hr-${c}.jsonl`)) if (!before.has(r.id)) before.set(r.id, r);
  for (const a of L(`${AFTER}/hr-${c}.jsonl`)) { rows++; const b = before.get(a.id); if (!b) { noBefore++; continue; } if (!b.feats || !a.feats) { add('no steps on one side (hang)', `${a.id}`); continue; }
    const B = new Map(b.feats.map((f) => [f.id, f])); let curvedHit = false;
    for (const f of a.feats) { steps++; const g = B.get(f.id); if (!g) { add('step missing before', a.id + ' ' + f.id); continue; }
      const where = `${a.id} ${f.id}`;
      if (st(f) === 'built' && st(g) === 'built') { if (f.volume != null && g.volume != null && Math.abs(f.volume - g.volume) > 1e-9 * Math.max(1, Math.abs(g.volume))) add(curvedHit ? 'built both, another volume, after a hole now refused' : 'BUILT BOTH, ANOTHER VOLUME', `${where} ${g.volume} -> ${f.volume}`); continue; }
      if (st(g) === 'built' && st(f) === 'refused') { if (f.guard === 'G-CURVED') { curvedHit = true; add('built -> refused by G-CURVED', where); } else if (curvedHit) add('built -> refused, after a hole now refused', `${where} [${f.guard}] ${(f.refusal ?? '').slice(0, 80)}`); else add('BUILT -> REFUSED, OTHER', `${where} [${f.guard}] ${(f.refusal ?? '').slice(0, 100)}`); continue; }
      if (st(g) === 'refused' && st(f) === 'built') { add(curvedHit ? 'refused -> built, after a hole now refused' : 'REFUSED -> BUILT', `${where} was [${g.guard}] ${(g.refusal ?? '').slice(0, 90)}`); continue; }
      if ((f.refusal ?? '') === (g.refusal ?? '')) continue;
      if (f.guard === 'G-CURVED') { curvedHit = curvedHit || false; add(`refused [${g.guard}] -> refused [G-CURVED]`, where); }
      else if (/a hole drilled across/.test(f.refusal ?? '')) add('refused both: the sentence now quotes the G-CURVED reason of the step it rests on', where);
      else if (f.guard === g.guard) add(`refused both, same guard [${f.guard}], other words`, `${where} | ${(g.refusal ?? '').slice(-70)} | ${(f.refusal ?? '').slice(-70)}`);
      else add(`refused [${g.guard}] -> refused [${f.guard}]`, `${where} | ${(f.refusal ?? '').slice(0, 90)}`); }
  }
}
console.log(`rows ${rows} (no earlier row ${noBefore}), steps ${steps}`); for (const k of Object.keys(t).sort()) console.log(String(t[k]).padStart(5), k, '\n        e.g.', ex[k].slice(0, 2).join('\n             '));
