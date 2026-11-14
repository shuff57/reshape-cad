// awkward-family.mjs <out.json> [count per generator, default 1700] [first seed, default 2000]: plan item 5, looking for a step that HANGS.
// In the page a step without a time budget (a pull, a pocket, a draft, a round, a move, a plain shape, in a script that drills no hole) cannot be
// stopped. These are documents made to be awkward for exactly those steps: the three generators' documents with every hole taken out (so nothing in
// them is budgeted) and their numbers pushed to the edges. Run in Node, where a case that does not answer is killed:
//   sh ../../sweep/score-built.sh <out dir> file=<out.json>     (or one pass: node ../../sweep/host-route-sweep.mjs --corpus=file --cases=... --no-oracle --timeout=120)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const T = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../packages/layer/test');
const imp = (f) => import(pathToFileURL(path.join(T, f)).href);
const { combinedDoc } = await imp('unified-docs.mjs'); const { rgCombinedDoc } = await imp('rg-docs.mjs'); const { fcCombinedDoc } = await imp('fc-docs.mjs');
const [OUT, N = '1700', FIRST = '2000'] = process.argv.slice(2);
const rng = (seed) => { let s = seed >>> 0; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
/** take the holes out: a step that targeted a hole targets what the hole drilled */
function withoutHoles(features) {
  const by = new Map(features.map((f) => [f.id, f])); const gone = new Set(features.filter((f) => f.kind === 'hole').map((f) => f.id));
  const res = (id) => { const seen = new Set(); while (gone.has(id) && !seen.has(id)) { seen.add(id); id = by.get(id).target; } return id; };
  return features.filter((f) => !gone.has(f.id)).map((f) => { const g = structuredClone(f); for (const k of ['target', 'into']) if (typeof g[k] === 'string') g[k] = res(g[k]); if (Array.isArray(g.targets)) g.targets = g.targets.map(res); return g; });
}
/** push the numbers to the edges: each step, with some chance, gets the awkward value of its kind */
function awkward(features, r) {
  const sizeOf = (f) => (f.kind === 'box' ? Math.min(...f.size) : f.kind === 'cylinder' || f.kind === 'cone' || f.kind === 'prism' ? Math.min(2 * f.radius, f.height) : f.kind === 'sphere' ? 2 * f.radius : null);
  const by = new Map(features.map((f) => [f.id, f])); const notes = [];
  const rootSize = (id) => { const seen = new Set(); let cur = by.get(id); while (cur && !seen.has(cur.id)) { seen.add(cur.id); const s = sizeOf(cur); if (s) return s; cur = by.get(cur.target ?? cur.into); } return 10; };
  for (const f of features) { if (r() > 0.6) continue; const p = r();
    if (f.kind === 'shell') { const s = rootSize(f.target); f.thickness = p < 0.4 ? +(s / 2 - 0.05).toFixed(3) : p < 0.7 ? 0.05 : +(s / 2 - 0.5).toFixed(3); notes.push(`${f.id} wall ${f.thickness}`); }
    else if (f.kind === 'fillet') { const s = rootSize(f.target); f.size = p < 0.5 ? +(s / 2 - 0.02).toFixed(3) : p < 0.8 ? 0.02 : +(s / 2).toFixed(3); notes.push(`${f.id} size ${f.size}`); }
    else if (f.kind === 'draft') { f.angle = p < 0.5 ? 44 : p < 0.8 ? 0.01 : 30; notes.push(`${f.id} angle ${f.angle}`); }
    else if (f.kind === 'extrude') { if (p < 0.35) { f.taper = p < 0.15 ? 30 : -20; notes.push(`${f.id} taper ${f.taper}`); } else if (p < 0.55) { f.height = 0.02; notes.push(`${f.id} height 0.02`); } else if (p < 0.75) { f.midplane = true; f.taper = 15; notes.push(`${f.id} midplane taper 15`); } }
    else if (f.kind === 'pocket') { if (p < 0.4) { f.depth = 0.01; notes.push(`${f.id} depth 0.01`); } else if (p < 0.7) { f.taper = 25; notes.push(`${f.id} taper 25`); } else { f.through = true; f.taper = -15; notes.push(`${f.id} through taper -15`); } }
    else if (f.kind === 'sketch' && Array.isArray(f.points) && f.shape !== 'circle' && f.points.length >= 4) { if (p < 0.5) { f.rounds = { 0: 1e-3, 1: 1e-3 }; notes.push(`${f.id} rounds 0.001`); } else { const [a, b] = [f.points[0], f.points[1]]; const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2; f.rounds = { 0: +(half - 1e-3).toFixed(4), 1: +(half - 1e-3).toFixed(4) }; notes.push(`${f.id} rounds ${f.rounds[0]} (two that all but meet)`); } }
    else if (f.kind === 'move') { f.offset = p < 0.5 ? [1e-4, 0, 0] : [0, 0, 1e5]; notes.push(`${f.id} offset ${f.offset}`); }
    else if (f.kind === 'rotate') { f.angles = p < 0.5 ? [0.001, 0, 0] : [89.999, 0.001, 45]; notes.push(`${f.id} angles ${f.angles}`); }
    else if (f.kind === 'pattern') { if (p < 0.5 && typeof f.count === 'number') { f.count = Math.min(12, f.count + 6); notes.push(`${f.id} count ${f.count}`); } else if (Array.isArray(f.step)) { f.step = f.step.map((v) => v * 0.02); notes.push(`${f.id} step x 0.02 (copies overlap)`); } }
    else if (f.kind === 'revolve' || f.kind === 'groove') { f.angle = p < 0.5 ? 359.999 : 0.01; notes.push(`${f.id} angle ${f.angle}`); }
    else if (f.kind === 'cylinder' || f.kind === 'cone') { if (p < 0.3) { f.height = 0.02; notes.push(`${f.id} height 0.02`); } else if (p < 0.5) { f.radius = 0.02; notes.push(`${f.id} radius 0.02`); } }
    else if (f.kind === 'box') { if (p < 0.3) { f.size = [f.size[0], f.size[1], 0.02]; notes.push(`${f.id} 0.02 thick`); } }
  }
  return notes;
}
const cases = []; const kinds = {};
for (const [name, gen] of [['combined', combinedDoc], ['rg', rgCombinedDoc], ['fc', fcCombinedDoc]]) for (let i = 0; i < Number(N); i++) {
  const seed = Number(FIRST) + i; const features = withoutHoles(gen(seed).features); if (!features.some((f) => f.kind !== 'sketch')) continue;
  const notes = awkward(features, rng(seed * 2654435761 + name.length));
  for (const f of features) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  cases.push({ id: `awkward ${name} ${seed}`, doc: { version: 1, features }, notes });
}
fs.writeFileSync(OUT, JSON.stringify(cases)); console.log(cases.length, 'documents, steps by kind:', JSON.stringify(kinds));
