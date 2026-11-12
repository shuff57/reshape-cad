// compare.mjs <seed dir> [corpora...]: G against R (the page's second translation against the same doc with the left-out steps deleted by hand: every other step
// and the command list must be identical) and G against O (the injected block is self-contained and far away: every step of the original doc must come out as
// it does without the block). O_DIR = where the O rows are (default: <seed dir>/../O).
import fs from 'node:fs'; import path from 'node:path';
const D = process.argv[2]; const want = process.argv.slice(3);
const rd = (p) => (fs.existsSync(p) ? new Map(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; })) : null);
const HOST = /^(G-STALE|SG-RULES-|HOST-PREFLIGHT-DEP|PILOT-NOT-YET)/;
const same = (a, b) => a.status === b.status && (a.guard ?? null) === (b.guard ?? null) && (a.refusal ?? null) === (b.refusal ?? null) && a.faces === b.faces
  && (a.volume == null ? b.volume == null : b.volume != null && Math.abs(a.volume - b.volume) <= 1e-12 * Math.max(1, Math.abs(a.volume)))
  && (a.bbox == null ? b.bbox == null : b.bbox != null && a.bbox.every((v, i) => Math.abs(v - b.bbox[i]) <= 1e-9 * Math.max(1, Math.abs(v))));
const tab = {}; const diffs = { GR: [], GO: [] }; const kinds = {};
for (const f of fs.readdirSync(path.join(D, 'G')).filter((x) => /^hr-.*\.jsonl$/.test(x))) {
  const c = f.replace(/^hr-|\.jsonl$/g, ''); if (want.length && !want.includes(c)) continue;
  const G = rd(path.join(D, 'G', f)), R = rd(path.join(D, 'R', f)), O = rd(path.join(process.env.O_DIR ?? path.join(D, '..', 'O'), f)); if (!R || !O) continue;
  const t = tab[c] = { rows: G.size, secondPass: 0, stepsAfterLeftOut: 0, GRrowsDiffer: 0, GRcmdDiffer: 0, GOrowsDiffer: 0, hang: 0 };
  for (const [id, g] of G) {
    if (!g.feats) { t.hang++; continue; }
    const pre = new Set(g.feats.filter((x) => HOST.test(x.guard ?? '')).map((x) => x.id));
    if (g.gadget) { kinds[g.gadget.kind] ??= { rows: 0, secondPass: 0 }; kinds[g.gadget.kind].rows++; if (pre.size) kinds[g.gadget.kind].secondPass++; }
    if (pre.size) { t.secondPass++; const first = g.feats.findIndex((x) => pre.has(x.id)); t.stepsAfterLeftOut += g.feats.slice(first + 1).filter((x) => !pre.has(x.id) && x.kind !== 'sketch').length;
      const r = R.get(id);
      if (!r || !r.feats) { t.GRrowsDiffer++; diffs.GR.push({ c, id, why: 'R row missing or hung', gadget: g.gadget }); }
      else { const bad = g.feats.filter((x) => !pre.has(x.id)).filter((x) => { const y = r.feats.find((z) => z.id === x.id); return !y || !same(x, y); });
        const extra = r.feats.filter((y) => !g.feats.some((x) => x.id === y.id));
        if (bad.length || extra.length) { t.GRrowsDiffer++; diffs.GR.push({ c, id, gadget: g.gadget, bad: bad.map((x) => { const y = r.feats.find((z) => z.id === x.id); return { id: x.id, kind: x.kind, G: [x.status, x.guard, x.volume, (x.refusal ?? '').slice(0, 110)], R: y && [y.status, y.guard, y.volume, (y.refusal ?? '').slice(0, 110)] }; }) }); }
        else if (g.cmdHash !== r.cmdHash) { t.GRcmdDiffer++; diffs.GR.push({ c, id, gadget: g.gadget, why: `commands differ (${g.nCmds} vs ${r.nCmds})` }); } } }
    const o = O.get(id);
    if (!o || !o.feats) { if (o && (o.hang || o.crashed)) continue; t.GOrowsDiffer++; diffs.GO.push({ c, id, why: 'O row missing', gadget: g.gadget }); continue; }
    const zz = new Set(g.gadget?.ids ?? []);
    const bad = o.feats.filter((x) => { const y = g.feats.find((z) => z.id === x.id); return !y || !same(x, y); });
    if (bad.length) { t.GOrowsDiffer++; diffs.GO.push({ c, id, gadget: g.gadget, bad: bad.map((x) => { const y = g.feats.find((z) => z.id === x.id); return { id: x.id, kind: x.kind, O: [x.status, x.guard, x.volume, (x.refusal ?? '').slice(0, 110)], G: y && [y.status, y.guard, y.volume, (y.refusal ?? '').slice(0, 110)] }; }) }); }
  }
}
console.table(tab); console.table(kinds);
fs.writeFileSync(path.join(D, 'diffs.json'), JSON.stringify(diffs, null, 1));
for (const k of ['GR', 'GO']) { console.log(`== ${k}: ${diffs[k].length} rows differ`); for (const d of diffs[k].slice(0, Number(process.env.SHOW ?? 12))) console.log('  ', d.c, '|', d.id, '|', d.gadget?.kind, '@', d.gadget?.at, '|', d.why ?? d.bad.map((b) => `${b.id}(${b.kind}) ${JSON.stringify(b.O ?? b.G)} -> ${JSON.stringify(b.O ? b.G : b.R)}`).join(' ;; ').slice(0, 520)); }
