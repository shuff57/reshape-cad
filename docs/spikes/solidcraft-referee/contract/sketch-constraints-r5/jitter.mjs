// Round 5 (critic): hand-drawn tangent chains whose arc ends are NOT on their circles and whose joints are not coincident, with NO pinned arc centre.
// Every endpoint of every line and arc that no lock row pins is moved by a random vector of length <= amp (amp 0.05 / 0.3 / 0.8 mm on a 40 x 20 slot, a 40 x 24 rounded rectangle),
// so the typed rows are an invalid input for the arc rows (ends off the circle) and for every joint. N starts per amplitude.
//   shipped = mapper -> SolidCraft, every profile; guarded = ladderSketch; brep-rs = script -> solveDoc -> build.   Scored against the closed form (start-aware: every mirror image that satisfies the rules).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun jitter.mjs [--n=20] [--out=out/jitter.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, plainRules, soupScript, clone, mulberry, seedOf } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch } from './guard.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const N = +arg('n', 20), OUTF = arg('out', 'out/jitter.json');
const IDS = ['slot-line-pinned-R10-L40', 'rounded-rect-line-pinned', 'oval-four-arcs-endpoint-tangent'];
const AMPS = [0.05, 0.3, 0.8];
function jitterEnds(geoms, rules, key, amp) {
  const rnd = mulberry(seedOf(key));
  const locked = new Set(rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const v = () => { const th = rnd() * Math.PI * 2, m = amp * Math.sqrt(rnd()); return [m * Math.cos(th), m * Math.sin(th)]; };
  const mv = (p, id, e) => (locked.has(`${id}:${e}`) ? p : (() => { const d = v(); return [p[0] + d[0], p[1] + d[1]]; })());
  return geoms.map((g) => {
    const o = clone(g);
    if (g.k === 'line' || g.k === 'arc') { o.a = mv(g.a, g.id, 'a'); o.b = mv(g.b, g.id, 'b'); }
    return o;
  });
}
const tally = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const out = [];
for (const id of IDS) {
  const cs = CASES.find((c) => c.id === id);
  const rules = plainRules(cs.rules);
  for (const amp of AMPS) {
    const t = { id, amp, N, shipped: {}, guarded: {}, brep: {}, sentences: {}, wrongPassed: [], shippedWrong: [] };
    for (let k = 0; k < N; k++) {
      const start = jitterEnds(cs.geoms, rules, `${id}#jit#${amp}#${k}`, amp);
      const u = lib.scSketch(start, rules);
      let uc;
      if (u.mapperRefused) uc = 'REFUSED'; else if (u.firstRefusal || u.extrudeError || !u.body) uc = 'REFUSED';
      else { const c = classify(cs, u.body, start); uc = c.cls === 'TOL-MISS' ? 'MATCH' : c.cls; if (!['MATCH', 'MATCH-OTHER-SIDE'].includes(uc)) t.shippedWrong.push({ k, cls: uc, volume: u.body.volume, bodies: u.body.bodies }); }
      tally(t.shipped, uc);
      const g = ladderSketch({ geoms: start, rules });
      if (g.ok) {
        const c = classify(cs, g.body, start);
        const gc = c.cls === 'MATCH' || c.cls === 'TOL-MISS' ? 'BUILT-MATCH' : c.cls === 'MATCH-OTHER-SIDE' ? 'BUILT-OTHER-SIDE' : 'BUILT-WRONG';
        tally(t.guarded, gc);
        if (gc === 'BUILT-WRONG') t.wrongPassed.push({ k, cls: c.cls, dv: c.dv, db: c.db, volume: g.body.volume, bodies: g.body.bodies });
      } else { tally(t.guarded, 'REFUSED'); const key = g.stage + ': ' + g.sentence.replace(/[-0-9.e+]+/g, '#').slice(0, 150); t.sentences[key] = (t.sentences[key] ?? 0) + 1; }
      try {
        const run = lib.runScript(soupScript(start, rules));
        const b = lib.brepBuild(lib.modelCodegen.solveDoc(run.doc));
        if (b.outcome !== 'built') tally(t.brep, 'REFUSED'); else { const c = classify(cs, { volume: b.volume, bbox: b.bbox, bodies: 1 }, start).cls; tally(t.brep, c === 'TOL-MISS' ? 'MATCH' : c); }
      } catch (e) { tally(t.brep, 'ERROR'); }
    }
    out.push(t);
    console.log(`${id.padEnd(34)} amp ${String(amp).padEnd(5)} shipped ${JSON.stringify(t.shipped)} | guarded ${JSON.stringify(t.guarded)} | brep-rs ${JSON.stringify(t.brep)}${t.wrongPassed.length ? ' !!WRONG-PASSED ' + JSON.stringify(t.wrongPassed.slice(0, 3)) : ''}`);
    writeFileSync(OUTF, JSON.stringify(out, null, 1));
  }
}
