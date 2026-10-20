// Rough-start sweeps, guarded vs unguarded vs brep-rs, same seeds as round 1 (`${id}#${k}#${frac}`).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun run-sweeps.mjs [--ids=a,b] [--fracs=0.035,0.15,0.4,0.8] [--n=40] [--out=out/sweeps.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, roughen, plainRules, soupScript, H } from './cases.mjs';
import { classify, expectedBox } from './score.mjs';
import { ladderSketch } from './guard.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const IDS = arg('ids', '').split(',').filter(Boolean);
const FR = arg('fracs', '0.035,0.15,0.4,0.8').split(',').map(Number), N = +arg('n', 40), OUTF = arg('out', 'out/sweeps.json');
import { oddPoint } from './util.mjs';
const SWEEP_IDS = IDS.length ? IDS : (await import('node:fs')).readFileSync('sweep-ids.txt', 'utf8').trim().split(',');
const brepOnStart = (cs, start, rules) => {
  try {
    const run = lib.runScript(soupScript(start, rules));
    if (run.errors?.length) return { cls: 'SCRIPT-ERROR' };
    const doc = lib.modelCodegen.solveDoc(run.doc);
    const b = lib.brepBuild(doc);
    if (b.outcome !== 'built') return { cls: 'REFUSED', sentence: b.refusal };
    const t = cs.curved ? 3e-4 : 1e-9;
    const eb = expectedBox(cs, start);
    const want = [eb[0], eb[1], 0, eb[2], eb[3], H];
    const ok = lib.rel(b.volume, cs.area * H) <= t && Math.max(...want.map((w, i) => lib.rel(b.bbox[i], w))) <= t;
    return { cls: ok ? 'MATCH' : 'WRONG', volume: b.volume };
  } catch (e) { return { cls: 'ERROR', sentence: String(e.message).slice(0, 100) }; }
};
const unguarded = (cs, start, rules) => {
  const r = lib.scSketch(start, rules, { extrudeExtra: cs.nested || cs.holePlate ? (() => { const p = oddPoint(start); return p ? { profiles: [{ point: p }] } : null; })() : null });
  if (r.mapperRefused) return { out: 'MAPPER-REFUSED', sentence: r.mapperRefused.join(' | ') };
  if (r.firstRefusal || r.extrudeError || !r.body) return { out: 'SC-REFUSED', sentence: r.firstRefusal?.error ?? r.extrudeError ?? 'no body' };
  const c = classify(cs, r.body, start);
  return { out: c.cls, dv: c.dv, db: c.db };
};
const results = [];
for (const id of SWEEP_IDS) {
  const cs = CASES.find((c) => c.id === id);
  for (const frac of FR) {
    const rec = { id, frac, N, feats: cs.feats, unguarded: {}, guarded: {}, brep: {}, wrongPassed: [], caught: 0, spurious: 0, stages: {}, rungs: {}, sentences: {}, tolMissMax: 0, comChecked: 0, comMax: 0, perSeed: [] };
    for (let k = 0; k < N; k++) {
      const start = roughen(cs.geoms, cs.rules, `${id}#${k}#${frac}`, frac);
      const rules = plainRules(cs.rules);
      const u = unguarded(cs, start, rules);
      rec.unguarded[u.out] = (rec.unguarded[u.out] ?? 0) + 1;
      const g = ladderSketch({ geoms: start, rules });
      let gc;
      if (g.ok) { const c = classify(cs, g.body, start); if (typeof c.dc === 'number') { rec.comChecked++; rec.comMax = Math.max(rec.comMax, c.dc); } gc = c.cls === 'MATCH' || c.cls === 'TOL-MISS' ? 'BUILT-MATCH' : c.cls === 'MATCH-OTHER-SIDE' ? 'BUILT-OTHER-SIDE' : 'BUILT-WRONG'; if (c.cls === 'TOL-MISS') rec.tolMissMax = Math.max(rec.tolMissMax, c.dv, c.db); if (gc !== 'BUILT-MATCH') rec.wrongPassed.push({ k, gc, cls: c.cls, image: c.image, dv: c.dv, db: c.db, volume: g.body.volume, bbox: g.body.bbox, rung: g.rung }); rec.rungs[g.rung] = (rec.rungs[g.rung] ?? 0) + 1; }
      else { gc = 'REFUSED'; rec.stages[g.stage] = (rec.stages[g.stage] ?? 0) + 1; const key = g.sentence.replace(/[-0-9.]+(e-?[0-9]+)?/g, '#').slice(0, 160); const cur = rec.sentences[key]; rec.sentences[key] = { n: (cur?.n ?? 0) + 1, raw: cur?.raw ?? g.sentence }; }
      rec.guarded[gc] = (rec.guarded[gc] ?? 0) + 1;
      if (!g.ok && ['POSE', 'VOLUME', 'MATCH-OTHER-SIDE'].includes(u.out)) rec.caught++;
      if (!g.ok && ['MATCH', 'TOL-MISS'].includes(u.out)) rec.spurious++;
      const b = brepOnStart(cs, start, rules);
      rec.brep[b.cls] = (rec.brep[b.cls] ?? 0) + 1;
      rec.perSeed.push([u.out, gc === 'REFUSED' ? 'R:' + g.stage : gc, b.cls]);
    }
    results.push(rec);
    console.log(`${id} ${frac}: unguarded ${JSON.stringify(rec.unguarded)} | guarded ${JSON.stringify(rec.guarded)} stages ${JSON.stringify(rec.stages)} caught ${rec.caught} spurious ${rec.spurious} | brep-rs ${JSON.stringify(rec.brep)}${rec.wrongPassed.length ? ' !!WRONG-PASSED ' + JSON.stringify(rec.wrongPassed.slice(0, 2)) : ''}`);
    writeFileSync(OUTF, JSON.stringify(results));
  }
}
