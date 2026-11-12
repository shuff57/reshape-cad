// score-tp.mjs: tp81 against (1) the closed form per body, (2) the same hole on A alone; and what the G-OTHERS check stopped (the same cases with it off)
import fs from 'node:fs';
const cases = JSON.parse(fs.readFileSync('tp81.json', 'utf8'));
const rd = (p) => new Map(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const on = rd('tp81-on.jsonl'), alone = rd('tp81-alone.jsonl'), off = fs.existsSync('tp81-off.jsonl') ? rd('tp81-off.jsonl') : new Map();
// the curved-volume bar of the project (a bore is facets: the worst here is 2.7e-5)
const BAR = 3e-4; const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const t = { cases: cases.length, built: 0, builtRight: 0, builtWrong: 0, refused: {}, aloneBuilt: 0, sameAsAlone: 0, aloneDiffers: 0, othersStopped: 0, othersStoppedWouldBeWrong: 0, othersStoppedWouldBeRight: 0, worstA: 0, worstB: 0 };
const byPlace = {}; const wrong = []; const diff = []; const stopped = [];
for (const c of cases) {
  const r = on.get(c.id), a = alone.get(c.id); if (!r?.feats) { wrong.push([c.id, 'no row', r?.scriptError]); continue; }
  const h = r.feats.find((f) => f[0] === 'hole1'); const ha = a?.feats?.find((f) => f[0] === 'hole1');
  const p = byPlace[`${c.place} ${c.hk}`] ??= { n: 0, built: 0, refused: {} }; p.n++;
  const vol = (row, name) => row.scene?.each?.find((e) => e[0] === name)?.[1];
  if (ha?.[2] === 'built') t.aloneBuilt++;
  if (h[2] === 'built' && r.feats.every((f) => f[2] === 'built')) {
    t.built++; p.built++;
    const vA = vol(r, c.nameA), vB = vol(r, c.nameB);
    const eA = rel(vA, c.wantA), eB = rel(vB, c.wantB); t.worstA = Math.max(t.worstA, eA); if (!c.bCurved && !c.both) t.worstB = Math.max(t.worstB, eB);
    const okB = c.bCurved || c.both ? eB <= 3e-4 : eB <= 1e-9;
    if (eA <= BAR && okB && r.scene.bodies === 2) t.builtRight++; else { t.builtWrong++; wrong.push([c.id, 'A', vA, c.wantA, eA.toExponential(2), 'B', vB, c.wantB, eB.toExponential(2)]); }
    if (ha?.[2] === 'built') { const vAl = a.scene.each[0][1]; if (Math.abs(vAl - vA) <= 1e-9 * vAl) t.sameAsAlone++; else { t.aloneDiffers++; diff.push([c.id, 'alone', vAl, 'here', vA]); } }
    else diff.push([c.id, 'built here, alone:', ha?.[2], ha?.[3]]);
  } else {
    const bad = r.feats.find((f) => f[2] === 'refused'); const g = bad?.[3] ?? '(none)'; t.refused[g] = (t.refused[g] ?? 0) + 1; p.refused[g] = (p.refused[g] ?? 0) + 1;
    if (g === 'G-OTHERS') { t.othersStopped++; const o = off.get(c.id);
      if (o?.feats) { const vA = vol(o, c.nameA), vB = vol(o, c.nameB); const bWrong = vB === undefined || rel(vB, c.VB0) > (c.bCurved ? 3e-4 : 1e-9);
        if (bWrong) t.othersStoppedWouldBeWrong++; else t.othersStoppedWouldBeRight++; stopped.push([c.id, 'A', vA?.toFixed(3), 'B', vB?.toFixed(3), 'B before', c.VB0.toFixed(3), bWrong ? 'B CUT' : 'B intact']); } }
    else if (ha?.[2] === 'built' && g !== 'G-OTHERS') diff.push([c.id, 'refused here', g, (bad?.[4] ?? '').slice(0, 90), '| alone: built']);
  }
}
console.log(JSON.stringify(t, null, 1));
console.table(Object.fromEntries(Object.entries(byPlace).map(([k, v]) => [k, { n: v.n, built: v.built, refused: Object.entries(v.refused).map(([g, n]) => `${g} ${n}`).join(', ') }])));
console.log('WRONG', wrong.length); for (const w of wrong.slice(0, 12)) console.log('  ', w.join(' | '));
console.log('DIFFERS FROM A ALONE', diff.length); for (const w of diff.slice(0, 16)) console.log('  ', w.join(' | '));
console.log('STOPPED BY G-OTHERS', stopped.length); for (const w of stopped.slice(0, 10)) console.log('  ', w.join(' | '));
