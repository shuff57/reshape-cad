// Round 5 extras (critic's list): construction geometry, a tangent to a built-in axis, huge / tiny dimension values, crossing / touching / self-crossing outlines.
//   For each: the SHIPPED route (phase2/sketch-map.mjs mapper -> SolidCraft, every profile extruded), the GUARDED route (guard.mjs), the closed form, and live brep-rs / OCCT where they can referee.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun extras.mjs [--out=out/extras.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { H, L, C, A, loopJoins, len, rectG, rectShape, atOrigin, dX, dY, soupScript, arcLoopArea } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
import { refsOfScript } from './refs.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/extras.json').slice(6);
const out = { construction: [], axisTangent: [], huge: [], crossing: [] };
const rel = lib.relT;
const lock = (a, aEnd) => ({ k: 'lock', a, aEnd });
const shipped = (geoms, rules, extra = {}) => {
  const r = lib.scSketch(geoms, rules, extra);
  if (r.mapperRefused) return { out: 'MAPPER-REFUSED', sentence: r.mapperRefused.join(' | ') };
  if (r.firstRefusal || r.extrudeError || !r.body) return { out: 'SC-REFUSED', sentence: r.firstRefusal?.error ?? r.extrudeError ?? 'no body' };
  return { out: 'BUILT', volume: r.body.volume, bodies: r.body.bodies, bbox: r.body.bbox, faces: r.body.faces, ruleMap: r.map.ruleMap };
};
const guarded = (geoms, rules, opts = {}) => {
  const g = ladderSketch({ geoms, rules }, opts);
  return g.ok ? { out: 'BUILT', volume: g.body.volume, bodies: g.body.bodies, bbox: g.body.bbox, faces: g.body.faces, rung: g.rung, dof: g.report.dof } : { out: 'REFUSED', stage: g.stage, sentence: g.sentence };
};
const brepOf = (geoms, rules) => { const r = refsOfScript(soupScript(geoms, rules)); return r.brep ?? r; };
const verdict = (res, wantVol, wantBox, tol = 1e-9) => (res.out !== 'BUILT' ? res.out : rel(res.volume, wantVol) <= tol && Math.max(...wantBox.map((w, i) => Math.abs(res.bbox[i] - w))) <= Math.max(1e-6, tol * 10) ? 'RIGHT' : 'WRONG');

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A. construction geometry: arc / circle / line marked construction must never become a profile edge
{
  const tri = () => [L(1, [0, 0], [30, 0]), L(2, [30, 0], [15, 20]), L(3, [15, 20], [0, 0])];
  const base = () => [...loopJoins(3), lock(1, 'a'), lock(1, 'b'), lock(2, 'b')];
  const arcEnds = [{ k: 'coincident', a: 4, aEnd: 'a', b: 1, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'b' }];
  const sag = 6, R = (15 * 15 + sag * sag) / (2 * sag), cy = sag - R; // arc through (0,0) and (30,0) with sagitta 6
  const lensArea = (R * R) / 2 * (2 * Math.asin(15 / R) - Math.sin(2 * Math.asin(15 / R)));
  const cases = [
    { id: 'triangle + construction ARC below the base (outside the outline, ends on the base corners)', geoms: [...tri(), A(4, [15, -cy], R, [0, 0], [30, 0], 'ccw', { construction: true })], rules: [...base(), ...arcEnds], want: 300 * H, note: `lens outside = ${(lensArea * H).toFixed(1)} mm3 if the arc is treated as a profile edge` },
    { id: 'triangle + construction ARC inside the triangle (a chord arc splitting it in two)', geoms: [...tri(), A(4, [15, cy], R, [0, 0], [30, 0], 'cw', { construction: true })], rules: [...base(), ...arcEnds], want: 300 * H, note: 'splits the triangle into two profiles' },
    { id: 'triangle + construction CIRCLE across the base', geoms: [...tri(), C(4, [15, 2], 6, { construction: true })], rules: [...base(), lock(4, 'c'), { k: 'radius', a: 4, value: 6 }], want: 300 * H, note: 'cuts the triangle and sticks out below it' },
    { id: 'triangle + construction LINE from the apex to the base', geoms: [...tri(), L(4, [15, 20], [15, 0], { construction: true })], rules: [...base(), lock(4, 'a'), lock(4, 'b')], want: 300 * H, note: 'splits the triangle in two' },
  ];
  for (const c of cases) {
    const wantBox = [0, 0, 0, 30, 20, H];
    const sh = shipped(c.geoms, c.rules);
    const gd = guarded(c.geoms, c.rules);
    const gdCtl = guarded(c.geoms, c.rules, { noMarkConstruction: true });
    const gdPick = guarded(c.geoms, c.rules, { alwaysPick: true });
    const gdPickCtl = guarded(c.geoms, c.rules, { alwaysPick: true, noMarkConstruction: true });
    const row = { id: c.id, note: c.note, wantVolume: c.want, shipped: { ...sh, ruleMap: undefined, verdict: verdict(sh, c.want, wantBox) }, guarded: { ...gd, verdict: verdict(gd, c.want, wantBox, 3e-4) },
      controlGuardWithoutMarkingConstruction: { ...gdCtl, verdict: verdict(gdCtl, c.want, wantBox, 3e-4) }, guardedAlwaysPickProfiles: { ...gdPick, verdict: verdict(gdPick, c.want, wantBox, 3e-4) }, controlAlwaysPickWithoutMarking: { ...gdPickCtl, verdict: verdict(gdPickCtl, c.want, wantBox, 3e-4) } };
    out.construction.push(row);
    console.log('CONSTRUCTION', c.id, '\n   want', c.want, '| shipped', sh.out, sh.volume?.toFixed(3), row.shipped.verdict, '| guarded', gd.out, gd.volume?.toFixed(3), row.guarded.verdict, gd.sentence ?? '', '| guard without marking', gdCtl.out, gdCtl.volume?.toFixed(3), row.controlGuardWithoutMarkingConstruction.verdict, '| always-pick', gdPick.out, gdPick.volume?.toFixed(3), row.guardedAlwaysPickProfiles.verdict, '| always-pick w/o marking', gdPickCtl.out, gdPickCtl.volume?.toFixed(3), row.controlAlwaysPickWithoutMarking.verdict);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B. tangent to a built-in axis (-2 = X axis, -3 = Y axis): the shipped mapper drops the row without a word
{
  for (const axis of [-2, -3]) for (const off of [0, 0.06, 0.2, 0.4, 0.79, 2]) {
    // circle r6 whose centre x (for the X axis) is held 8 from the origin; its y is only held by the tangent row. Drawn off the axis by `off`.
    const geoms = axis === -2 ? [C(1, [8, 6 + off], 6)] : [C(1, [6 + off, 8], 6)];
    const rules = axis === -2 ? [{ k: 'radius', a: 1, value: 6 }, dX(-1, 'a', 1, 'c', 8), { k: 'tangent', a: 1, b: -2 }] : [{ k: 'radius', a: 1, value: 6 }, dY(-1, 'a', 1, 'c', 8), { k: 'tangent', a: 1, b: -3 }];
    const want = Math.PI * 36 * H;
    const wantBox = axis === -2 ? [2, 0, 0, 14, 12, H] : [0, 2, 0, 12, 14, H];
    const sh = shipped(geoms, rules);
    const gd = guarded(geoms, rules);
    const bx = sh.bbox ? (axis === -2 ? sh.bbox[1] - 0 : sh.bbox[0] - 0) : null;
    const row = { axis, offFromAxisMm: off, wantBbox: wantBox, shipped: { ...sh, ruleMap: undefined, verdict: verdict(sh, want, wantBox, 3e-4), gapFromAxisMm: bx }, guarded: gd };
    out.axisTangent.push(row);
    console.log('AXIS-TANGENT axis', axis, 'drawn off by', off, '| shipped', sh.out, 'bbox', sh.bbox?.map((v) => +v.toFixed(4)).join(','), row.shipped.verdict, '| guarded', gd.out, gd.sentence ?? gd.volume);
  }
  // does the mapper hold the row at all? (ruleMap of the tangent row)
  const m = lib.mapper.mapSketch({ id: 'p', plane: 'xy', geoms: [C(1, [8, 6.4], 6)], rules: [{ k: 'radius', a: 1, value: 6 }, dX(-1, 'a', 1, 'c', 8), { k: 'tangent', a: 1, b: -2 }] }, { name: 'sk' });
  out.axisTangentMapper = { ok: m.ok, commands: m.commands?.map((c) => c.command), ruleMapOfTangentRow: m.ruleMap?.[2] ?? null, notes: m.notes, refusals: m.refusals };
  console.log('AXIS-TANGENT mapper:', JSON.stringify(out.axisTangentMapper));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// C. huge and tiny dimension values on a 30 x 20 rectangle (the length of line 1 is the value)
{
  for (const V of [1e3, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e-2, 1e-3, 1e-4, 1e-6]) {
    const geoms = rectG(0.3, 0.2, 28.4, 17.1);
    const rules = [...rectShape(), atOrigin(1), len(1, V), len(2, 20)];
    const want = V * 20 * H, wantBox = [0, 0, 0, V, 20, H];
    const sh = shipped(geoms, rules);
    const gd = guarded(geoms, rules);
    const br = brepOf(geoms, rules);
    const row = { V, wantVolume: want, shipped: { ...sh, ruleMap: undefined, verdict: verdict(sh, want, wantBox, 1e-9) }, guarded: { ...gd, verdict: verdict(gd, want, wantBox, 1e-6) }, brep: br };
    out.huge.push(row);
    console.log('HUGE', String(V).padEnd(7), 'want', want.toExponential(3), '| shipped', sh.out, sh.volume?.toExponential(3), row.shipped.verdict, '| guarded', gd.out, gd.volume?.toExponential(3), row.guarded.verdict, gd.sentence?.slice(0, 120) ?? '', '| brep-rs', br.volume?.toExponential(3) ?? JSON.stringify(br).slice(0, 80));
  }
  // a huge radius on a circle and a huge distanceX
  for (const [name, geoms, rules, want, wantBox] of [
    ['circle radius 1e6', [C(1, [0.4, -0.2], 5)], [{ k: 'radius', a: 1, value: 1e6 }, { k: 'coincident', a: 1, aEnd: 'c', b: -1, bEnd: 'a' }], Math.PI * 1e12 * H, [-1e6, -1e6, 0, 1e6, 1e6, H]],
    ['circle radius 1e9', [C(1, [0.4, -0.2], 5)], [{ k: 'radius', a: 1, value: 1e9 }, { k: 'coincident', a: 1, aEnd: 'c', b: -1, bEnd: 'a' }], Math.PI * 1e18 * H, [-1e9, -1e9, 0, 1e9, 1e9, H]],
    ['rectangle corner distanceX 1e9', rectG(4.2, 2.1, 32.4, 19.1), [...rectShape(), dX(-1, 'a', 1, 'a', 1e9), dY(-1, 'a', 1, 'a', 3), len(1, 30), len(2, 20)], 600 * H, [1e9, 3, 0, 1e9 + 30, 23, H]],
  ]) {
    const sh = shipped(geoms, rules), gd = guarded(geoms, rules);
    const tol = name.startsWith('circle') ? 3e-4 : 1e-9;
    const row = { name, wantVolume: want, shipped: { ...sh, ruleMap: undefined, verdict: verdict(sh, want, wantBox, tol) }, guarded: { ...gd, verdict: verdict(gd, want, wantBox, Math.max(tol, 1e-6)) } };
    out.huge.push(row);
    console.log('HUGE', name.padEnd(34), 'want', want.toExponential(3), '| shipped', sh.out, sh.volume?.toExponential(3), row.shipped.verdict, '| guarded', gd.out, gd.volume?.toExponential(3), row.guarded.verdict, gd.sentence?.slice(0, 120) ?? '');
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// D. outlines that cross, touch or cross themselves: SolidCraft builds them; brep-rs refuses them
{
  const rectA = rectG(0, 0, 30, 20), rectB = (x0) => rectG(x0, 0, x0 + 20, 20).map((g) => ({ ...g, id: g.id + 4 }));
  const rj = (first) => [...loopJoins(4, first), { k: 'horizontal', a: first }, { k: 'vertical', a: first + 1 }, { k: 'horizontal', a: first + 2 }, { k: 'vertical', a: first + 3 }];
  const pinAll = (ids) => ids.flatMap((i) => [lock(i, 'a'), lock(i, 'b')]);
  const cases = [
    { id: 'circle r6 crossing the right edge of a 30 x 20 rectangle', geoms: [...rectA, C(5, [28, 10], 6)], rules: [...rj(1), ...pinAll([1, 2, 3, 4]).slice(0, 2), { k: 'radius', a: 5, value: 6 }, lock(5, 'c')], note: 'union area would be 600 + 113.1 - lens' },
    { id: 'two rectangles sharing the edge x = 30', geoms: [...rectA, ...rectB(30)], rules: [...rj(1), ...rj(5), lock(1, 'a'), lock(5, 'a')], note: 'two bodies touching along a face' },
    { id: 'two rectangles overlapping by 5 mm', geoms: [...rectA, ...rectB(25)], rules: [...rj(1), ...rj(5), lock(1, 'a'), lock(5, 'a')], note: 'overlap' },
    { id: 'bowtie: a four-sided outline that crosses itself', geoms: [L(1, [0, 0], [30, 20]), L(2, [30, 20], [30, 0]), L(3, [30, 0], [0, 20]), L(4, [0, 20], [0, 0])], rules: [...loopJoins(4), lock(1, 'a'), lock(1, 'b'), lock(2, 'b'), lock(3, 'b')], note: 'figure-eight outline' },
    { id: 'control: two rectangles 5 mm apart', geoms: [...rectA, ...rectB(35)], rules: [...rj(1), ...rj(5), lock(1, 'a'), lock(5, 'a')], note: 'valid, two separate bodies', valid: true, want: (600 + 400) * H, bodies: 2 },
  ];
  for (const c of cases) {
    const sh = shipped(c.geoms, c.rules);
    const gd = guarded(c.geoms, c.rules);
    const br = brepOf(c.geoms, c.rules);
    const row = { id: c.id, note: c.note, valid: !!c.valid, shipped: { ...sh, ruleMap: undefined }, guarded: gd, brep: br, wantVolume: c.want ?? null };
    out.crossing.push(row);
    console.log('CROSSING', c.id, '\n   shipped', sh.out, sh.volume?.toFixed(3), 'bodies', sh.bodies, '| guarded', gd.out, gd.volume?.toFixed(3) ?? '', gd.sentence ?? '', '| brep-rs', br.volume?.toFixed(3) ?? JSON.stringify(br.refused ?? br).slice(0, 140));
  }
}
writeFileSync(OUTF, JSON.stringify(out, null, 1));
