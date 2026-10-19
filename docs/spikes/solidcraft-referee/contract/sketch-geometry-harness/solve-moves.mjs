// For every soup sketch of every guarded case: how far does the brep-rs sketch session (the rig's stand-in for SolidCraft's own solver, which this wasm
// package cannot read back) move the rows the case WRITES? Where it moves nothing (<= 1e-9) the profile selection is made from the written rows, not from
// brep-rs; only the cases where rules drive the geometry depend on the brep-rs solution. Output: results-guarded/solve-moves.json
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun solve-moves.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { solvedGeoms } from './sg-core.mjs';
const dir = new URL('./results-guarded/', import.meta.url).pathname;
const out = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'solve-moves.json')) {
  for (const r of JSON.parse(readFileSync(dir + f, 'utf8'))) {
    const feats = Array.isArray(r.doc) ? r.doc : r.doc?.features;
    for (const sk of feats ?? []) {
      if (sk.kind !== 'sketch' || !Array.isArray(sk.geoms) || !sk.geoms.length || sk.shape === 'circle') continue;
      let solved;
      try { solved = solvedGeoms({ geoms: JSON.parse(JSON.stringify(sk.geoms)), rules: JSON.parse(JSON.stringify(sk.rules ?? [])) }); } catch { continue; }
      let move = 0; let unchanged = solved === sk.geoms;
      sk.geoms.forEach((g, i) => {
        const s = solved[i]; if (!s) return;
        for (const k of ['a', 'b', 'c', 'p']) if (g[k] && s[k]) move = Math.max(move, Math.hypot(g[k][0] - s[k][0], g[k][1] - s[k][1]));
        if (typeof g.r === 'number' && typeof s.r === 'number') move = Math.max(move, Math.abs(g.r - s.r));
      });
      out[r.id] = { move, rules: (sk.rules ?? []).length, outcome: r.outcome, sketch: sk.id, brepSessionOpened: !unchanged };
    }
  }
}
writeFileSync(dir + 'solve-moves.json', JSON.stringify(out, null, 1));
const v = Object.values(out);
console.log('soup sketches', v.length, 'moved <=1e-9:', v.filter((x) => x.move <= 1e-9).length, 'moved more:', v.filter((x) => x.move > 1e-9).length);
