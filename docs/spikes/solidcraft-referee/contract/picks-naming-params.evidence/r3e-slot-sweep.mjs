// Round 3 E. Every generatedParams slot of the pick-consumer scripts at its own min and max (the values a student's slider can reach),
// on the PAGE translator and on the guarded translator (r3-guard.mjs), judged against live OCCT and brep-rs.
// A case where the page builds and BOTH oracles refuse is NOT passed over: it is recorded as BUILT-NO-ORACLE and then decided by the
// guard column (the guard refuses it with a sentence, or it is listed as unresolved).
//   bun r3e-slot-sweep.mjs [--out=file] [A B C ...]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { guardedTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3e-slot-sweep.json';
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const scripts = {
  A: 'const b=box(40,30,20)\nround(b.edge("top","front"),2)',
  B: 'const b=box(40,30,20)\nbevel(b.edge("top","front"),2)',
  C: 'const b=box(40,30,20)\nhollow(b,{wall:2,open:"top"})',
  D: 'const b=box(40,30,20)\ndraft(b.face("right"),5)',
  D2: 'const b=box(40,30,20)\ndraft(b.face("front"),5,{from:"bottom"})',
  E: 'const c=cylinder(24,30)\nround(c.edge("top","side"),3)',
  F: 'const sk1=sketch("top"); sk1.rect(40,30,{at:[20,15]}); const p=extrude(sk1,10); const sk2=sketch("top",10); sk2.rect(10,8,{at:[18,14]}); const q=pocket(sk2,p,4)\nround(q.edge("top",q.wall(sk2,1)),1)',
  G: 'const c=cylinder(24,30)\nhollow(c,{wall:2,open:"top"})',
  H: 'const b=box(40,30,20)\nhollow(b,{wall:2,open:"left"})',
};
const rows = [];
for (const [k, src] of Object.entries(scripts)) {
  if (only.length && !only.includes(k)) continue;
  const base = L.fromScript(src); if (base.errors.length) { console.log(k, 'ERR'); continue; }
  for (const p of L.cg.generatedParams(base.doc)) {
    if (/_(x|y|z)$/.test(p.name)) continue;
    for (const [lbl, v] of [['min', p.min], ['max', p.max]]) {
      if (Math.abs(v - p.value) < 1e-12) continue;
      const r = L.fromScript(src, { [p.name]: v }); if (r.errors.length) { rows.push({ k, slot: p.name, lbl, v, scriptError: r.errors[0].message }); continue; }
      const ref = L.references(r.doc); const row = await L.scored(r.doc, { ref });
      const g = await guardedTranslate(r.doc); const gm = g.features.find((f) => f.id === row.id);
      const oracleOK = !!(row.refs?.occtOK || row.refs?.brepOK);
      let page = row.outcome === 'NO-REFERENCE' ? 'BUILT-NO-ORACLE' : row.outcome;
      let guarded = gm.status === 'refused' ? 'REFUSED' : (row.truck && Math.abs(gm.measure.volume - row.truck.volume) < 1e-9 * Math.max(1, row.truck.volume) ? 'SAME-AS-PAGE' : 'CHANGED');
      rows.push({ k, slot: p.name, lbl, v, page, pageSentence: row.sentence?.slice(0, 120), scV: row.truck?.volume, scFaces: row.truck?.faces, dVol: row.score?.dVol, occtRef: Object.keys(ref.occtRefusals ?? {}).length ? Object.values(ref.occtRefusals)[0].slice(0, 90) : null, guarded, guardSentence: gm.status === 'refused' ? gm.refusal : null, unmapped: g.unmapped.length, unmappedRaw: g.unmapped.map((u) => u.raw.slice(0, 260)) });
      console.log(k, p.name.padEnd(16), lbl, String(v).padEnd(6), page.padEnd(16), guarded.padEnd(13), (gm.status === 'refused' ? gm.refusal : '').slice(0, 130));
    }
  }
}
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const c = {}; for (const r of rows) { const key = (r.page ?? 'ERR') + ' -> ' + (r.guarded ?? '-'); c[key] = (c[key] ?? 0) + 1; }
console.log(JSON.stringify(c, null, 1));
