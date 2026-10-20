// Round 5 (critic): under-constrained sketches (dof > 0). The 8 saved FreeCAD sk-rect-underconstrained refs.
//   dof: independent solver vs FreeCAD ref vs brep-rs diagnosis.  stored geometry (it obeys every rule): shipped / guarded / brep-rs vs the closed form + the FreeCAD bbox.
//   rough starts (3.5% and 15%): the SET of solids each route builds (distinct volumes), so "start-dependent solid with no sentence" is a number; the guard must refuse or build the stored solid.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun underconstrained.mjs [--n=20] [--out=out/underconstrained.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, H, roughen, plainRules, soupScript } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const N = +arg('n', 20), OUTF = arg('out', 'out/underconstrained.json');
const rel = lib.rel;
const out = [];
const spread = (vs) => { const xs = vs.filter((v) => typeof v === 'number'); if (!xs.length) return null; const d = [...new Set(xs.map((v) => +v.toFixed(2)))].sort((a, b) => a - b); return { n: xs.length, distinct: d.length, min: Math.min(...xs), max: Math.max(...xs), values: d.slice(0, 8) }; };
for (const cs of CASES.filter((c) => c.underconstrained)) {
  const rules = plainRules(cs.rules);
  const ind = lib.indepSolve(cs.geoms, rules);
  const b0 = lib.brepSolve(cs.geoms, rules);
  const rec = { id: cs.id, dof: { independent: ind.dof, freecad: cs.fc?.dof ?? null, brepRs: b0.diag?.dof ?? (b0.open ? 'open: ' + b0.open : null) }, closedVolume: cs.area ? cs.area * H : null, fcBbox: cs.fc?.bbox ?? null };
  const wantVol = cs.area ? cs.area * H : null, tol = cs.curved ? 3e-4 : 1e-9;
  const right = (body) => body && wantVol != null && rel(body.volume, wantVol) <= tol && body.bbox.slice(0, 2).every((v, i) => Math.abs(v - cs.bbox[i]) <= 2e-3) && Math.abs(body.bbox[3] - cs.bbox[2]) <= 2e-3 && Math.abs(body.bbox[4] - cs.bbox[3]) <= 2e-3;
  // round 6 (critic): a circle with NO rules has nothing to solve, so building the circle AS DRAWN is the correct build of a rough start, not "a different solid" than the stored one.
  // For that one fixture the measure is the drawn circle itself, closed form pi r^2 H and bbox c +- r, at the fixed curved bar 3e-4 (chosen before the run, not tuned).
  const freeCircle = rules.length === 0 && cs.geoms.length === 1 && cs.geoms[0].k === 'circle';
  const asDrawn = (start, body) => { if (!freeCircle || !body) return false; const c = start[0]; return rel(body.volume, Math.PI * c.r * c.r * H) <= 3e-4 && Math.abs(body.bbox[0] - (c.c[0] - c.r)) <= 2e-3 && Math.abs(body.bbox[1] - (c.c[1] - c.r)) <= 2e-3 && Math.abs(body.bbox[3] - (c.c[0] + c.r)) <= 2e-3 && Math.abs(body.bbox[4] - (c.c[1] + c.r)) <= 2e-3; };
  const lab = (start, body) => (right(body) ? 'stored-solid' : asDrawn(start, body) ? 'built-as-drawn (free circle, no rules)' : 'different-solid');
  const stored = { shipped: null, guarded: null, brep: null };
  const u = lib.scSketch(cs.geoms, rules); stored.shipped = u.body ? { volume: u.body.volume, right: right(u.body) } : { refused: u.mapperRefused?.join(' | ') ?? u.firstRefusal?.error ?? u.extrudeError ?? 'no body' };
  const g = ladderSketch({ geoms: cs.geoms, rules }); stored.guarded = g.ok ? { volume: g.body.volume, right: right(g.body) } : { refused: g.sentence, stage: g.stage };
  try { const run = lib.runScript(soupScript(cs.geoms, rules)); const b = lib.brepBuild(lib.modelCodegen.solveDoc(run.doc)); stored.brep = b.outcome === 'built' ? { volume: b.volume, right: right({ volume: b.volume, bbox: b.bbox }) } : { refused: b.refusal }; } catch (e) { stored.brep = { error: String(e).slice(0, 100) }; }
  rec.stored = stored;
  rec.rough = {};
  for (const frac of [0.035, 0.15]) {
    const sv = [], gv = [], bv = [], gt = {}, st = {}, bt = {}, sent = {};
    for (let k = 0; k < N; k++) {
      const start = roughen(cs.geoms, cs.rules, `${cs.id}#ucr#${k}#${frac}`, frac);
      const us = lib.scSketch(start, rules);
      if (us.body) { sv.push(us.body.volume); const k0 = lab(start, us.body); st[k0] = (st[k0] ?? 0) + 1; } else st.REFUSED = (st.REFUSED ?? 0) + 1;
      const gg = ladderSketch({ geoms: start, rules });
      if (gg.ok) { gv.push(gg.body.volume); const key = lab(start, gg.body); gt[key] = (gt[key] ?? 0) + 1; } else { gt.REFUSED = (gt.REFUSED ?? 0) + 1; const key = gg.stage; sent[key] = (sent[key] ?? { n: 0, sentence: gg.sentence }); sent[key].n++; }
      try { const run = lib.runScript(soupScript(start, rules)); const b = lib.brepBuild(lib.modelCodegen.solveDoc(run.doc)); if (b.outcome === 'built') { bv.push(b.volume); { const k1 = lab(start, { volume: b.volume, bbox: b.bbox }); bt[k1] = (bt[k1] ?? 0) + 1; } } else bt.REFUSED = (bt.REFUSED ?? 0) + 1; } catch { bt.ERROR = (bt.ERROR ?? 0) + 1; }
    }
    rec.rough[frac] = { N, shipped: { tally: st, volumes: spread(sv) }, guarded: { tally: gt, volumes: spread(gv), sentences: sent }, brep: { tally: bt, volumes: spread(bv) } };
  }
  out.push(rec);
  console.log(rec.id.replace('underconstrained:sk-rect-underconstrained__', '').padEnd(24), 'dof ind/fc/brep', JSON.stringify(rec.dof), '| stored shipped', JSON.stringify(stored.shipped).slice(0, 80), 'guarded', JSON.stringify(stored.guarded).slice(0, 90), 'brep', JSON.stringify(stored.brep).slice(0, 70));
  for (const f of [0.035, 0.15]) console.log('    rough', f, 'shipped', JSON.stringify(rec.rough[f].shipped.tally), JSON.stringify(rec.rough[f].shipped.volumes?.values), '| guarded', JSON.stringify(rec.rough[f].guarded.tally), '| brep-rs', JSON.stringify(rec.rough[f].brep.tally), JSON.stringify(rec.rough[f].brep.volumes?.values));
  writeFileSync(OUTF, JSON.stringify(out, null, 1));
}
