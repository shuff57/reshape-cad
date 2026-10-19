// Slider-style param drags, enumerated by family (critic, round 3). Each family changes ONE dimension value along a path; a step starts from the LAST BUILT solved geometry
// (what a slider does) and, separately, every target value is also tried as one jump from the stored geometry.
//   per step: RIGHT (closed form, planar 1e-9 / curved 3e-4), REFUSED (sentence) or WRONG (built, disagrees); and whether the target is a valid sketch at all
//   (valid-but-refused = a capability gap of the route, invalid-and-refused = correct).   brep-rs on the same jumps for comparison.
//   bun param-drags.mjs [--out=out/param-drags.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { refsOfScript } from './refs.mjs';
import { H, L, C, A, tj, loopJoins, len, rectG, rectShape, atOrigin, dX, dY, soupScript, slotArea } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/param-drags.json').slice(6);
const rad = (d) => (d * Math.PI) / 180;
const shoelace = (p) => Math.abs(p.reduce((s, q, i) => s + (q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1]), 0) / 2);
const FAM = [];
const fam = (f) => FAM.push(f);
// ---- A. rectangle width (control: the plain case) ----------------------------------------------------------------------
fam({ id: 'rect width param 30 -> 5..120', geoms: rectG(0.3, 0.2, 28.4, 17.1), rulesAt: (v) => [...rectShape(), atOrigin(1), len(1, v), len(2, 20)], start: 30, paths: [[30, 40, 50, 60, 80, 100, 120], [30, 25, 20, 15, 10, 5]],
  expect: (v) => ({ valid: true, area: v * 20, bbox: [0, 0, v, 20], bodies: 1 }) });
// ---- B. hole diameter in a 40 x 25 plate (centre (20, 12.5)): valid below 25, touching at 25, crossing the outline above ------
const plate = rectG(0.3, 0.2, 39, 25.6).concat([C(5, [19, 13.5], 4.4)]);
fam({ id: 'hole diameter param 10 in a 40x25 plate, centre (20,12.5)', geoms: plate, rulesAt: (v) => [...rectShape(), atOrigin(1), len(1, 40), len(2, 25), { k: 'diameter', a: 5, value: v }, dX(1, 'a', 5, 'c', 20), dY(1, 'a', 5, 'c', 12.5)], start: 10, curved: true,
  paths: [[10, 12, 14, 16, 18, 20, 22, 24, 24.5, 25, 25.5, 26, 28, 30, 38], [10, 8, 6, 4, 2, 1]],
  expect: (v) => (v < 25 - 1e-9 ? { valid: true, area: 1000 - Math.PI * (v / 2) ** 2, bbox: [0, 0, 40, 25], bodies: 1 } : Math.abs(v - 25) < 1e-9 ? { valid: 'touching', area: 1000 - Math.PI * (v / 2) ** 2, bbox: [0, 0, 40, 25], bodies: 1 } : { valid: false, why: 'the hole crosses the outline' }) });
// ---- C. hole centre dx (signed) across the plate's left edge (hole radius 5) -------------------------------------------------
fam({ id: 'hole centre distanceX param 20 -> -12 (hole r5, plate x 0..40)', geoms: plate, rulesAt: (v) => [...rectShape(), atOrigin(1), len(1, 40), len(2, 25), { k: 'diameter', a: 5, value: 10 }, dX(1, 'a', 5, 'c', v), dY(1, 'a', 5, 'c', 12.5)], start: 20, curved: true,
  paths: [[20, 18, 16, 14, 12, 10, 8, 6, 5.5, 5, 4.5, 4, 2, 1, 0.5, 0, -0.5, -2, -4, -5, -5.5, -6, -8, -12], [20, 25, 30, 34, 34.5, 35, 35.5, 36, 38, 40, 44, 46]],
  expect: (v) => (v - 5 > 1e-9 && v + 5 < 40 - 1e-9 ? { valid: true, area: 1000 - Math.PI * 25, bbox: [0, 0, 40, 25], bodies: 1 }
    : Math.abs(v - 5) < 1e-9 || Math.abs(v - 35) < 1e-9 ? { valid: 'touching', area: 1000 - Math.PI * 25, bbox: [0, 0, 40, 25], bodies: 1 } : Math.abs(v + 5) < 1e-9 || Math.abs(v - 45) < 1e-9 ? { valid: 'touching', area: 1000 + Math.PI * 25, bbox: [Math.min(0, v - 5), 0, Math.max(40, v + 5), 25], bodies: 2 }
    : v + 5 < 0 || v - 5 > 40 ? { valid: true, area: 1000 + Math.PI * 25, bbox: [Math.min(0, v - 5), 0, Math.max(40, v + 5), 25], bodies: 2, note: 'the hole is wholly outside the plate: two separate loops = two bodies' }
    : { valid: false, why: 'the hole crosses the outline' }) });
// ---- D. circle-circle tangent: small circle radius (big r8 locked at the origin, small centre on the X axis) -----------------------
const cc = (mode, startC, r) => ({ geoms: [C(1, [0, 0], 8), C(2, startC, r)], rulesAt: (v) => [{ k: 'lock', a: 1, aEnd: 'c' }, { k: 'radius', a: 1, value: 8 }, { k: 'radius', a: 2, value: v }, { k: 'pointOnObject', a: 2, aEnd: 'c', b: -2 }, { k: 'tangent', a: 1, b: 2, mode }], curved: true });
fam({ id: 'circle-circle EXTERNAL tangent, small radius param 5 -> 1..14', ...cc('external', [13.4, 0.2], 5), start: 5, paths: [[5, 6, 7, 8, 9, 10, 12, 14], [5, 4, 3, 2, 1]],
  expect: (v) => ({ valid: true, area: Math.PI * (64 + v * v), bbox: [-8, -Math.max(8, v), 8 + 2 * v, Math.max(8, v)], bodies: 2 }) });
fam({ id: 'circle-circle INTERNAL tangent, small radius param 5 -> 1..7.5 and past 8', ...cc('internal', [3.3, 0.2], 5), start: 5, paths: [[5, 4, 3, 2, 1], [5, 6, 7, 7.5, 7.9, 8, 8.1, 9, 10, 12]],
  expect: (v) => (v < 8 - 1e-9 ? { valid: true, area: Math.PI * (64 - v * v), bbox: [-8, -8, 8, 8], bodies: 1 } : Math.abs(v - 8) < 1e-9 ? { valid: false, why: 'two equal circles on top of each other' } : { valid: true, area: Math.PI * (v * v - 64), bbox: [8 - 2 * v, -v, 8, v], bboxAlt: [[-8, -v, 2 * v - 8, v]], bodies: 1, note: 'the small circle has become the big one: the centre has to cross to the other side (either mirror image about the Y axis meets every rule)' }) });
// ---- E. slot radius (centre of the left cap locked) ---------------------------------------------------------------------------
const slotG = [A(1, [0, 10], 10, [0, 0], [0, 20], 'cw'), A(2, [40, 10], 10, [40, 20], [40, 0], 'cw'), L(3, [0, 20], [40.2, 19.9]), L(4, [40, 0.1], [0, 0])];
fam({ id: 'slot cap radius param 10 -> 1..25 (left cap centre locked at (0,10), length 40)', geoms: slotG, rulesAt: (v) => [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'), { k: 'radius', a: 1, value: v }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, 40), { k: 'lock', a: 1, aEnd: 'c' }], start: 10, curved: true,
  paths: [[10, 9, 8, 6, 4, 3, 2, 1], [10, 12, 14, 16, 18, 20, 25]],
  expect: (v) => ({ valid: true, area: slotArea(40, v), bbox: [-v, 10 - v, 40 + v, 10 + v], bodies: 1 }) });
// ---- F. angle (triangle 40 / 30, angle between line 1 and line 2), small steps -----------------------------------------------
const triAt = (deg) => [[0, 0], [40, 0], [40 + 30 * Math.cos(rad(deg)), 30 * Math.sin(rad(deg))]];
const triG = (deg) => { const p = triAt(deg); return [L(1, p[0], p[1]), L(2, p[1], p[2]), L(3, p[2], p[0])]; };
fam({ id: 'triangle angle param 120 -> 10 and 120 -> 175 (steps of 5 degrees)', geoms: triG(120), rulesAt: (v) => [...loopJoins(3), { k: 'horizontal', a: 1 }, atOrigin(1), len(1, 40), len(2, 30), { k: 'angle', a: 1, b: 2, value: v }], start: 120,
  paths: [[120, 115, 110, 105, 100, 95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 10], [120, 125, 130, 140, 150, 160, 170, 175]],
  expect: (v) => { const p = triAt(v); return { valid: true, area: shoelace(p), bbox: [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))], bodies: 1 }; } });
// ---- G. signed distanceX of a rectangle corner from the origin, stepped across 0 ----------------------------------------------
fam({ id: 'rect corner distanceX param +12 -> -12 (steps of 2)', geoms: rectG(12.2, 2.1, 42.2, 22.1), rulesAt: (v) => [...rectShape(), dX(-1, 'a', 1, 'a', v), dY(-1, 'a', 1, 'a', 2), len(1, 30), len(2, 20)], start: 12,
  paths: [[12, 10, 8, 6, 4, 2, 0, -2, -4, -6, -8, -10, -12]],
  expect: (v) => ({ valid: true, area: 600, bbox: [v, 2, v + 30, 22], bodies: 1 }) });
// ---- H. a length driven to zero or below -------------------------------------------------------------------------------------
fam({ id: 'rect height param 20 -> 0.1, 0, -5', geoms: rectG(0.3, 0.2, 28.4, 17.1), rulesAt: (v) => [...rectShape(), atOrigin(1), len(1, 30), len(2, v)], start: 20, paths: [[20, 10, 5, 1, 0.1, 0, -5]],
  expect: (v) => (v > 0 ? { valid: true, area: 30 * v, bbox: [0, 0, 30, v], bodies: 1 } : { valid: false, why: 'a length of zero or less' }) });

const rel = lib.rel;
const bboxErr = (b, want) => Math.max(...[want[0], want[1], 0, want[2], want[3], H].map((w, i) => Math.abs(b.bbox[i] - w)));
function judge(f, v, g) {
  const e = f.expect(v);
  const tol = f.curved ? 3e-4 : 1e-9, btol = f.curved ? 2e-3 : 1e-6;
  if (!g.ok) return { cls: e.valid === true ? 'REFUSED-VALID' : e.valid === 'touching' ? 'REFUSED-TOUCHING' : 'REFUSED-INVALID', valid: e.valid, why: e.why };
  if (e.valid === 'touching') { const okT = rel(g.body.volume, e.area * H) <= tol && bboxErr(g.body, e.bbox) <= btol; return { cls: okT ? 'BUILT-TOUCHING' : 'WRONG', valid: 'touching', dv: rel(g.body.volume, e.area * H), bodies: g.body.bodies }; }
  if (e.valid !== true) return { cls: 'WRONG', valid: e.valid, why: e.why };
  const bbErr = Math.min(bboxErr(g.body, e.bbox), ...(e.bboxAlt ?? []).map((b) => bboxErr(g.body, b)));
  const ok = rel(g.body.volume, e.area * H) <= tol && bbErr <= btol && (!e.bodies || g.body.bodies === e.bodies);
  return { cls: ok ? 'RIGHT' : 'WRONG', valid: true, dv: rel(g.body.volume, e.area * H), db: bbErr };
}
const out = [];
const T = { RIGHT: 0, 'REFUSED-VALID': 0, 'REFUSED-INVALID': 0, WRONG: 0, 'BUILT-TOUCHING': 0, 'REFUSED-TOUCHING': 0 };
for (const f of FAM) {
  const rec = { id: f.id, curved: !!f.curved, paths: [], jumps: [] };
  for (const path of f.paths) {
    const steps = []; let last = f.geoms;
    for (const v of path.slice(f.paths.indexOf(path) >= 0 ? 1 : 0)) {
      const g = ladderSketch({ geoms: last, rules: f.rulesAt(v) });
      const j = judge(f, v, g);
      T[j.cls]++;
      steps.push({ v, ...j, sentence: g.ok ? null : g.sentence, stage: g.ok ? null : g.stage });
      if (g.ok && j.cls === 'RIGHT') last = g.solved;
    }
    rec.paths.push({ path, steps });
  }
  // jumps: stored geometry -> target value
  const targets = [...new Set(f.paths.flat())].filter((v) => v !== f.start);
  for (const v of targets) {
    const g = ladderSketch({ geoms: f.geoms, rules: f.rulesAt(v) });
    const j = judge(f, v, g);
    const e = f.expect(v);
    const rb = refsOfScript(soupScript(f.geoms, f.rulesAt(v)));
    let brep = 'n/a';
    if (rb.brep?.volume !== undefined) brep = e.valid === true && rel(rb.brep.volume, e.area * H) <= (f.curved ? 3e-4 : 1e-9) ? 'RIGHT' : e.valid === true ? 'WRONG' : 'BUILT-INVALID'; else if (rb.brep) brep = 'REFUSED';
    rec.jumps.push({ v, ...j, sentence: g.ok ? null : g.sentence, stage: g.ok ? null : g.stage, brep });
    T[j.cls]++;
  }
  out.push(rec);
  const line = (xs) => xs.map((s) => `${s.v}:${{ RIGHT: 'ok', 'REFUSED-VALID': 'REF(valid)', 'REFUSED-INVALID': 'ref(invalid)', WRONG: 'WRONG', 'BUILT-TOUCHING': 'built(touching)', 'REFUSED-TOUCHING': 'ref(touching)' }[s.cls]}`).join(' ');
  console.log(`\n== ${f.id}`); rec.paths.forEach((p) => console.log('  drag :', line(p.steps))); console.log('  jump :', line(rec.jumps), '\n  brep :', rec.jumps.map((s) => `${s.v}:${s.brep}`).join(' '));
  writeFileSync(OUTF, JSON.stringify({ tally: T, rows: out }, null, 1));
}
console.log('\nTALLY (steps + jumps)', JSON.stringify(T));
writeFileSync(OUTF, JSON.stringify({ tally: T, rows: out }, null, 1));
