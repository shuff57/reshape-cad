// Round 5: how does the guard's own solver (contract/sketch-geometry.solve.mjs, no kernel) compare with the brep-rs sketch session that round 4 used as a stand-in?
// For every soup sketch of every guarded case: did the rules move the typed rows (moved > 1e-6), by how much, how many freedoms are left in what moved (dofMoved),
// and where both solvers moved the rows, how far apart their solved rows are. brep-rs is used HERE ONLY, as a comparison; the guard does not call it.
// Output: results-guarded/solve-check.json (read by build-rows.mjs).   SOLIDCRAFT_REFEREE_PKG=<pkg> bun solve-check.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { SketchSession2D, brep } from './sg-core.mjs';
import { solveSoup } from '../sketch-geometry.solve.mjs';
const dir = new URL('./results-guarded/', import.meta.url).pathname;
const brepSolve = (soup) => {
  try {
    const s = new SketchSession2D(); s.loadFromBytes(brep);
    const err = s.open(JSON.parse(JSON.stringify(soup.geoms)), JSON.parse(JSON.stringify(soup.rules ?? [])));
    let out = null; let dof = null;
    if (!err && s.solve()) { try { out = s.solvedGeoms(); } catch { /* none */ } try { dof = s.diagnose()?.dof ?? null; } catch { /* none */ } }
    s.close();
    return { rows: out, dof };
  } catch { return { rows: null, dof: null }; }
};
const dist = (A, B) => { let m = 0; A.forEach((g, i) => { const s = B[i]; if (!s) return; for (const k of ['a', 'b', 'c', 'p']) if (g[k] && s[k]) m = Math.max(m, Math.hypot(g[k][0] - s[k][0], g[k][1] - s[k][1])); if (typeof g.r === 'number' && typeof s.r === 'number') m = Math.max(m, Math.abs(g.r - s.r)); }); return m; };
const out = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('solve-') && !x.startsWith('pkg-'))) {
  for (const r of JSON.parse(readFileSync(dir + f, 'utf8'))) {
    const feats = Array.isArray(r.doc) ? r.doc : r.doc?.features;
    for (const sk of feats ?? []) {
      if (sk.kind !== 'sketch' || !Array.isArray(sk.geoms) || !sk.geoms.length || sk.shape === 'circle') continue;
      const soup = { geoms: JSON.parse(JSON.stringify(sk.geoms)), rules: JSON.parse(JSON.stringify(sk.rules ?? [])) };
      let mine; try { mine = solveSoup(soup); } catch (e) { mine = { unsupported: e.message }; }
      const b = brepSolve(soup);
      const rec = { sketch: sk.id, outcome: r.outcome, rules: soup.rules.length };
      if (mine.unsupported) rec.mine = { unsupported: mine.unsupported };
      else {
        rec.mine = { residual: mine.residual, moved: mine.moved, dof: mine.dof, dofMoved: mine.dofMoved, converged: mine.converged };
        rec.brepMoved = b.rows ? dist(soup.geoms, b.rows) : null; rec.brepDof = b.dof;
        rec.apartFromBrep = b.rows ? dist(mine.solved, b.rows) : null;
      }
      out[r.id] = rec;
    }
  }
}
writeFileSync(dir + 'solve-check.json', JSON.stringify(out, null, 1));
const v = Object.values(out).filter((x) => x.mine && !x.mine.unsupported);
const movedMine = v.filter((x) => x.mine.moved > 1e-6); const movedBrep = v.filter((x) => (x.brepMoved ?? 0) > 1e-6);
console.log('soup sketches', Object.keys(out).length, 'unsupported', Object.values(out).filter((x) => x.mine?.unsupported).length, 'not converged', v.filter((x) => !x.mine.converged).length);
console.log('moved by my solver', movedMine.length, 'moved by brep-rs session', movedBrep.length, 'moved-flag differs', v.filter((x) => (x.mine.moved > 1e-6) !== ((x.brepMoved ?? 0) > 1e-6)).length);
console.log('moved and dofMoved>0 (guard refuses)', movedMine.filter((x) => x.mine.dofMoved > 0).length);
