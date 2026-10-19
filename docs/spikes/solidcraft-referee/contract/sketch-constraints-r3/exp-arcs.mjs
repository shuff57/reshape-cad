// Hand-typed arc rows whose ends are NOT on the circle the row's c and r describe: guarded (arcTol off / 1e-6) vs brep-rs vs closed form.
//   bun exp-arcs.mjs [--out=out/arcs.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as lib from './lib.mjs';
import { refsOfScript } from './refs.mjs';
import { H, soupScript, clone, slotArea, A, L, tj, len, dX, dY } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/arcs.json').slice(6);
const { OWN } = await lib.imp(path.join(lib.REPO, 'docs/spikes/solidcraft-referee/phase2/fixtures-p2.mjs'));
const own = OWN.find((o) => o.id === 'own-slot-dims-from-points');
const rel = lib.rel;
const arcOff = (g, ea, eb) => { // push end a out by ea and end b by eb along the radius
  const mv = (p, e) => { const d = Math.hypot(p[0] - g.c[0], p[1] - g.c[1]); return [g.c[0] + (p[0] - g.c[0]) * (d + e) / d, g.c[1] + (p[1] - g.c[1]) * (d + e) / d]; };
  return { ...g, a: mv(g.a, ea), b: mv(g.b, eb) };
};
const slot = (eps, lock) => ({
  geoms: [arcOff(A(1, [0, 10], 10, [0, 0], [0, 20], 'cw'), eps, -eps), arcOff(A(2, [40, 10], 10, [40, 20], [40, 0], 'cw'), -eps, eps), L(3, [0, 20], [40.2, 19.9]), L(4, [40, 0.1], [0, 0])],
  rules: [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'), { k: 'radius', a: 1, value: 10 }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, 40),
    ...(lock ? [{ k: 'lock', a: 1, aEnd: 'c' }] : [{ k: 'lock', a: 3, aEnd: 'a' }])],
  area: slotArea(40, 10), bbox: [-10, 0, 50, 20],
});
const cases = [];
for (const eps of [1e-5, 1e-4, 1e-3, 0.01, 0.05, 0.29, 1, 2]) for (const lock of [true, false]) cases.push({ id: `slot-R10-L40 ends off by ${eps} mm, ${lock ? 'lock on c' : 'lock on a line end (not on c)'}`, eps, lock, ...slot(eps, lock) });
cases.push({ id: 'phase2 own-slot-dims-from-points (hand-typed, ends off the circle by up to 0.29 mm)', eps: 0.29, lock: false, geoms: own.geoms, rules: own.rules, area: 25 * 10 + Math.PI * 25, bbox: [-5, -5, 30, 5] });
const offBy = (geoms) => Math.max(...geoms.filter((g) => g.k === 'arc').map((g) => Math.max(Math.abs(Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]) - g.r), Math.abs(Math.hypot(g.b[0] - g.c[0], g.b[1] - g.c[1]) - g.r))));
const out = [];
const score = (b, cs) => b ? { volRel: rel(b.volume, cs.area * H), bboxMax: Math.max(...[cs.bbox[0], cs.bbox[1], 0, cs.bbox[2], cs.bbox[3], H].map((w, i) => Math.abs(b.bbox[i] - w))) } : null;
for (const cs of cases) {
  const rec = { id: cs.id, lock: cs.lock, offBy: offBy(cs.geoms) };
  const b = refsOfScript(soupScript(cs.geoms, cs.rules));
  rec.brep = b.brep?.volume !== undefined ? { volume: b.brep.volume, ...score(b.brep, { ...cs, bbox: cs.bbox }) } : { refused: b.brep?.refused ?? b.scriptError ?? b.error };
  for (const [name, arcTol] of [['strict1e-6', 1e-6], ['off', Infinity]]) {
    const g = ladderSketch({ geoms: cs.geoms, rules: cs.rules }, { arcTol });
    if (!g.ok) rec[name] = { refused: g.sentence, stage: g.stage };
    else { const sc = score(g.body, cs); rec[name] = { volume: g.body.volume, ...sc, built: sc.volRel <= 3e-4 && sc.bboxMax <= 2e-3 ? 'RIGHT' : 'WRONG' }; }
  }
  out.push(rec);
  const f = (x) => (x.refused ? 'REFUSED[' + x.stage + ']' : `${x.built ?? 'built'} vol rel ${x.volRel.toExponential(1)} bboxΔ ${x.bboxMax.toExponential(1)}`);
  console.log(cs.id.padEnd(95), 'offBy', rec.offBy.toExponential(1), '| brep-rs', rec.brep.refused ? 'REFUSED ' + String(rec.brep.refused).slice(0, 50) : `vol rel ${rec.brep.volRel.toExponential(1)} bboxΔ ${rec.brep.bboxMax.toExponential(1)}`, '| strict', f(rec.strict1e6 ?? rec['strict1e-6']), '| off', f(rec.off));
}
writeFileSync(OUTF, JSON.stringify(out, null, 1));
