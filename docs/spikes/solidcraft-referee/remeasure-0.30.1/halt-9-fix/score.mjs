// score1.mjs <before|after>: fu71 rows against what each case expects (A: the later draft refused by G-FROM; B: built and equal to the closed form)
import fs from 'node:fs';
const cases = JSON.parse(fs.readFileSync('fu71.json', 'utf8')); const n = process.argv[2];
const rows = new Map(fs.readFileSync(`fu71-${n}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const t = { A: { n: 0, refusedGFROM: 0, built: 0, other: 0, builtEqualsRootExtremeForm: 0, worstRelOffIntent: 0 }, B: { n: 0, builtRight: 0, refused: 0, builtOff: 0, worstRel: 0 } }; const ex = [];
for (const c of cases) {
  const r = rows.get(c.id); if (!r || !r.feats) { ex.push([c.id, 'no row', r?.scriptError]); continue; }
  const drafts = r.feats.filter((f) => f[1] === 'draft'); const later = drafts[drafts.length - 1]; const lead = drafts[0];
  const rest = r.scene ? r.scene.volume - (c.baseV ?? 0) : null; // the moved box alone: the stale base is the pocketed plate; a refused sketch leaves nothing
  if (c.cls === 'A') { t.A.n++;
    if (later[2] === 'refused' && later[3] === 'G-FROM') t.A.refusedGFROM++;
    else if (later[2] === 'built') { t.A.built++; if (Math.abs(rest - c.boxAtRootExtreme) <= 1e-9 * c.boxAtRootExtreme) t.A.builtEqualsRootExtremeForm++; const rel = Math.abs(rest - c.boxAtPartExtreme) / c.boxAtPartExtreme; t.A.worstRelOffIntent = Math.max(t.A.worstRelOffIntent, rel); if (ex.length < 4) ex.push([c.id, 'built', rest.toFixed(4), 'about the root extreme', c.boxAtRootExtreme.toFixed(4), 'what the word means now', c.boxAtPartExtreme.toFixed(4)]); }
    else { t.A.other++; ex.push([c.id, later[2], later[3], (later[4] ?? '').slice(0, 90)]); }
  } else { t.B.n++;
    if (later[2] === 'built') { const rel = Math.abs(rest - c.boxAsWritten) / c.boxAsWritten; t.B.worstRel = Math.max(t.B.worstRel, rel); if (rel <= 1e-9) t.B.builtRight++; else { t.B.builtOff++; ex.push([c.id, 'built off', rest, c.boxAsWritten]); } }
    else { t.B.refused++; if (ex.length < 12) ex.push([c.id, later[2], later[3], (later[4] ?? '').slice(0, 110)]); }
  }
  if (lead[2] !== 'refused') ex.push([c.id, 'LEAD NOT REFUSED', lead[2]]);
}
console.log('==', n, JSON.stringify(t)); for (const e of ex) console.log('   ', e.join(' | '));
