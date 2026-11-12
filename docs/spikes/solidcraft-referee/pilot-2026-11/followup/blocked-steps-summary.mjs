// summary.mjs: oo2 (off vs on, the rows that hold a blocked hollow, draft or round) -> a compact record: per corpus counts, every step that got its own sentence
import fs from 'node:fs';
const rd = (p) => new Map(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const BL = /it needs \S+, which could not be built|builds on \S+, which could not be built/;
const flukes = JSON.parse(fs.readFileSync('oo2/rerun.json', 'utf8'));
const out = { corpora: {}, own: [], flukeRows: flukes };
for (const c of ['sd', 'combined', 'rgcombined', 'fccombined', 'mt']) {
  let off = rd(`oo2/off/hr-${c}.jsonl`), on = rd(`oo2/on/hr-${c}.jsonl`);
  // a row that differed in the first run for a reason that was not the probe (a 45 s stall of the rig) is read from its first rerun
  if (flukes[c]?.length) { const o1 = rd(`oo2r/off1/hr-${c}.jsonl`), n1 = rd(`oo2r/on1/hr-${c}.jsonl`); for (const id of flukes[c]) { off.set(id, o1.get(id)); on.set(id, n1.get(id)); } }
  const t = out.corpora[c] = { rows: off.size, steps: 0, statusChanges: 0, otherTextChanges: 0, blocked: { shell: 0, draft: 0, fillet: 0 }, own: { shell: 0, draft: 0, fillet: 0 }, secondsOff: 0, secondsOn: 0 };
  for (const [id, a] of off) { const b = on.get(id); t.secondsOff += (a.ms ?? 0) / 1000; t.secondsOn += (b.ms ?? 0) / 1000;
    for (const fa of a.feats) { const fb = b.feats.find((x) => x.id === fa.id); t.steps++;
      const sameVol = fa.volume == null ? fb?.volume == null : fb?.volume != null && Math.abs(fb.volume - fa.volume) <= 1e-12 * Math.abs(fa.volume);
      if (!fb || fb.status !== fa.status || !sameVol) { t.statusChanges++; continue; }
      const blocked = ['shell', 'draft', 'fillet'].includes(fa.kind) && fa.status === 'refused' && BL.test(fa.refusal ?? '');
      if (blocked) t.blocked[fa.kind]++;
      if (fb.probed && blocked) { t.own[fa.kind]++; out.own.push({ corpus: c, row: id, id: fa.id, kind: fa.kind, guard: fb.guard ?? null, before: fa.refusal, after: fb.refusal }); }
      else if (fb.refusal !== fa.refusal || fb.guard !== fa.guard) t.otherTextChanges++;
    } }
  t.secondsOff = Math.round(t.secondsOff); t.secondsOn = Math.round(t.secondsOn);
}
const g = {}; for (const o of out.own) { const k = `${o.kind} ${o.guard ?? '(no code)'}`; g[k] = (g[k] ?? 0) + 1; }
out.byGuard = Object.fromEntries(Object.entries(g).sort((a, b) => b[1] - a[1]));
fs.writeFileSync('blocked-steps.json', JSON.stringify(out, null, 1));
console.table(Object.fromEntries(Object.entries(out.corpora).map(([c, t]) => [c, { rows: t.rows, steps: t.steps, statusChanges: t.statusChanges, otherText: t.otherTextChanges, blocked: t.blocked.shell + t.blocked.draft + t.blocked.fillet, own: t.own.shell + t.own.draft + t.own.fillet, 'hollow own/blocked': `${t.own.shell}/${t.blocked.shell}`, 'draft': `${t.own.draft}/${t.blocked.draft}`, 'round': `${t.own.fillet}/${t.blocked.fillet}`, sOff: t.secondsOff, sOn: t.secondsOn }])));
console.log(JSON.stringify(out.byGuard));
