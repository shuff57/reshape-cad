// Off-circle arc rows under rough starts: hand-drawn centre/radius/ends (roughen) and then every arc end pushed radially off its circle by up to `eps`.
//   guarded = ladderSketch (r3 preflight: only an arc whose centre a lock row pins is refused);  unguarded = mapper + SolidCraft as shipped;  brep-rs = script -> solveDoc -> build.
//   bun arcs-fuzz.mjs [--out=out/arcs-fuzz.json] [--n=30]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, roughen, plainRules, soupScript, clone, mulberry, seedOf } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/arcs-fuzz.json').slice(6);
const N = +(process.argv.find((a) => a.startsWith('--n=')) ?? '--n=30').slice(4);
const IDS = ['slot-hand-rows-R10-L40', 'slot-dims-from-points', 'oval-four-arcs-endpoint-tangent', 'gauntlet:sk-circle-arc-tangent__slot-r6-L30-anchored', 'gauntlet:sk-circle-arc-tangent__slot-r12-L18-anchored', 'gauntlet:sk-circle-arc-tangent__slot-arc-first-order'];
const push = (g, rnd, eps) => { // push each end radially by a signed amount up to eps
  const mv = (p) => { const d = Math.hypot(p[0] - g.c[0], p[1] - g.c[1]) || 1; const e = (rnd() * 2 - 1) * eps; return [g.c[0] + (p[0] - g.c[0]) * (d + e) / d, g.c[1] + (p[1] - g.c[1]) * (d + e) / d]; };
  return { ...g, a: mv(g.a), b: mv(g.b) };
};
const hasCLock = (rules, id) => rules.some((r) => r.k === 'lock' && r.a === id && (r.aEnd === undefined || r.aEnd === 'c'));
const out = [];
const add = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
for (const id of IDS) {
  const cs = CASES.find((c) => c.id === id); if (!cs) { console.log('missing', id); continue; }
  const rules0 = plainRules(cs.rules);
  const lockC = cs.geoms.some((g) => g.k === 'arc' && hasCLock(rules0, g.id));
  for (const eps of [1e-3, 0.05, 0.3, 1.0]) {
    const t = { id, eps, lockOnArcCentre: lockC, N, guarded: {}, unguarded: {}, brep: {}, sentences: {}, worstGuardedDv: 0 };
    for (let k = 0; k < N; k++) {
      const rnd = mulberry(seedOf(`${id}#arcs#${eps}#${k}`));
      const base = roughen(cs.geoms, cs.rules, `${id}#arcs-rough#${k}`, 0.035);
      const start = base.map((g) => (g.k === 'arc' ? push(g, rnd, eps) : g));
      const g = ladderSketch({ geoms: start, rules: rules0 });
      if (!g.ok) { add(t.guarded, 'REFUSED'); const key = g.sentence.replace(/[0-9.e+-]+/g, '#'); t.sentences[key] = (t.sentences[key] ?? { n: 0, raw: g.sentence }); t.sentences[key].n++; }
      else { const c = classify(cs, g.body, start); add(t.guarded, c.cls === 'MATCH' || c.cls === 'TOL-MISS' ? 'BUILT-MATCH' : c.cls === 'MATCH-OTHER-SIDE' ? 'BUILT-OTHER-SIDE' : 'BUILT-WRONG'); t.worstGuardedDv = Math.max(t.worstGuardedDv, c.dv); }
      const u = lib.scSketch(start, rules0);
      if (u.mapperRefused || u.firstRefusal || u.extrudeError || !u.body) add(t.unguarded, 'REFUSED'); else { const c = classify(cs, u.body, start).cls; add(t.unguarded, c === 'TOL-MISS' ? 'MATCH' : c); }
      try { const run = lib.runScript(soupScript(start, rules0)); const b = lib.brepBuild(lib.modelCodegen.solveDoc(run.doc)); if (b.outcome !== 'built') add(t.brep, 'REFUSED'); else { const c = classify(cs, { volume: b.volume, bbox: b.bbox, bodies: cs.bodies ?? 1 }, start).cls; add(t.brep, c === 'TOL-MISS' ? 'MATCH' : c); } } catch { add(t.brep, 'ERROR'); }
    }
    out.push(t);
    console.log(`${id.replace('gauntlet:sk-circle-arc-tangent__', 'FC:').padEnd(44)} eps ${String(eps).padEnd(6)} lockC ${lockC ? 'Y' : 'n'} guarded ${JSON.stringify(t.guarded)} | shipped route ${JSON.stringify(t.unguarded)} | brep-rs ${JSON.stringify(t.brep)}`);
    writeFileSync(OUTF, JSON.stringify(out, null, 1));
  }
}
