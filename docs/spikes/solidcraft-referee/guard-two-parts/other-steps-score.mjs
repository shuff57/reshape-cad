// score.mjs: tq91. Per case: is B intact (a body of 1547 mm3 with 6 faces), is A what the same step gives on A alone, and (where given) the closed form of A.
import fs from 'node:fs';
const cases = JSON.parse(fs.readFileSync('other-steps-tq91.json', 'utf8'));
const rd = (p) => new Map(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const two = rd('other-steps-tq91-two.jsonl'), alone = rd('other-steps-tq91-alone.jsonl');
const by = {}; const bad = []; const overRefused = []; const scriptErr = {}; const aloneRefused = {};
const stepOf = (row) => { const fs_ = row.feats.filter((f) => f[1] !== 'sketch'); return fs_; };
for (const c of cases) {
  const r = two.get(c.id), a = alone.get(c.id); const k = c.step; const t = by[k] ??= { n: 0, builtBoth: 0, sameAsAlone: 0, closedFormOk: 0, closedFormN: 0, refusedBoth: 0, refusedOnlyWithB: 0, builtOnlyWithB: 0, Bintact: 0, Bchanged: 0, worst: 0 };
  t.n++;
  if (!r || !a) { bad.push([c.id, 'row missing']); continue; }
  if (r.scriptError || a.scriptError) { scriptErr[k] = (r.scriptError ?? a.scriptError).slice(0, 110); continue; }
  const lastA = a.feats.filter((f) => f[1] !== 'sketch').at(-1), lastT = r.feats.filter((f) => f[1] !== 'sketch').at(-1);
  const allBuiltA = a.feats.every((f) => f[2] !== 'refused'), allBuiltT = r.feats.every((f) => f[2] !== 'refused');
  // B: a body of exactly 1547 mm3 with 6 faces must be in the scene
  const each = r.scene?.each ?? []; const B = each.find((e) => Math.abs(e[1] - c.VB) <= 1e-9 * c.VB && e[2] === 6);
  if (B) t.Bintact++; else { t.Bchanged++; bad.push([c.id, 'B NOT INTACT', JSON.stringify(each).slice(0, 200), allBuiltT ? 'all built' : lastT[3] ?? '']); }
  const vA = r.scene ? r.scene.volume - c.VB : null; const vAlone = a.scene?.volume ?? null;
  if (allBuiltA && allBuiltT) { t.builtBoth++;
    const d = Math.abs(vA - vAlone) / Math.max(1, Math.abs(vAlone)); t.worst = Math.max(t.worst, d);
    if (d <= 1e-9) t.sameAsAlone++; else bad.push([c.id, 'A DIFFERS FROM A ALONE', vA, vAlone, d.toExponential(2)]);
    if (c.wantA != null) { t.closedFormN++; if (Math.abs(vA - c.wantA) <= 3e-4 * c.wantA) t.closedFormOk++; else bad.push([c.id, 'A off the closed form', vA, c.wantA, ((vA - c.wantA) / c.wantA).toExponential(2)]); }
  } else if (!allBuiltA && !allBuiltT) { t.refusedBoth++; const g = a.feats.find((f) => f[2] === 'refused'); aloneRefused[k] = `${g[3] ?? ''} ${String(g[4]).slice(0, 110)}`;
    const gt = r.feats.find((f) => f[2] === 'refused' && f[1] !== 'box'); const ga = a.feats.find((f) => f[2] === 'refused');
    if ((gt?.[3] ?? null) !== (ga?.[3] ?? null)) overRefused.push([c.id, 'refused both, other guard', ga?.[3], '->', gt?.[3], String(gt?.[4]).slice(0, 120)]); }
  else if (allBuiltA) { t.refusedOnlyWithB++; const g = r.feats.find((f) => f[2] === 'refused'); overRefused.push([c.id, 'REFUSED ONLY WITH B', g[0], g[3], String(g[4]).slice(0, 150)]); }
  else { t.builtOnlyWithB++; bad.push([c.id, 'BUILT ONLY WITH B', JSON.stringify(a.feats.find((f) => f[2] === 'refused')).slice(0, 160)]); }
}
console.table(by);
console.log('SCRIPT ERRORS (my generator):', scriptErr);
console.log('REFUSED ALSO ALONE (the step itself):', aloneRefused);
console.log('BAD', bad.length); for (const b of bad.slice(0, 30)) console.log('  ', b.join(' | '));
console.log('REFUSED DIFFERENTLY', overRefused.length); const g = {}; for (const o of overRefused) { const key = o.slice(1).join(' | ').replace(/tq91-\d+-/g, '').replace(/\b(box|shell|draft|round|bevel|pocket|op|move|mirror|pattern|groove|hole|sk|pull)\d+\b/g, '$1N'); (g[key] ??= []).push(o[0]); }
for (const [key, v] of Object.entries(g).sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(String(v.length).padStart(4), key.slice(0, 260), '| e.g.', v[0]);
fs.writeFileSync('other-steps-tq91-score.json', JSON.stringify({ by, scriptErr, aloneRefused, bad, overRefused }, null, 1));
