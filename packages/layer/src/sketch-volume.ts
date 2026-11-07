// The built solid of a pull against its sketch: a port of `reconcileExtrude` (docs/spikes/solidcraft-referee/contract/sketch-geometry.guard.mjs, round 6).
//
// A pull of a sketch makes (the even-odd area of the sketch) x (the pull length) of material, in as many separate pieces as the sketch has solid regions. The area
// is computed here from the sketch itself (Green's theorem on the outline the layer hands the engine, or on the soup's rows); the volume and the pieces are read
// from the engine's reply. A build that disagrees is refused, whichever planner set pulled the sketch. No kernel is named; nothing here calls the engine.
//
// Why it is in the layer (docs/spikes/solidcraft-referee/GUARD-SKETCH-VOLUME.md): `rect(40, 30)` with `chamfer(1, 0.0001)` pulled 10 builds 11999.99499995 mm3
// on the pinned kernel where the closed form, OCCT and brep-rs give 11999.99999995 (4.2e-7 off, the planar bar is 1e-9), with the right commands and no refusal.
//
// Skipped for pulls this arithmetic does not describe, as in the contract: a taper, a custom direction whose length is measured along the direction itself
// (alongNormal false), a height that is not a number, and a sketch whose area cannot be computed here (an outline that does not come back, a soup whose rows do
// not close into loops, a soup whose rules move its rows).
//
// Tolerances: the bars every referee of this repo scores a built solid against (1e-9 of the volume on a straight-edged sketch, 3e-4 on one with an arc or a circle),
// not the contract's 1e-7 / 5e-4. Measured on the sketch-geometry corpus through 'unified' on the corrected 0.21.0 rig (GUARD-SKETCH-VOLUME.md): at the contract's
// tolerances 10 pulls the rig scores wrong stay built (7 curved, 3.6e-4 to 4.9e-4 off OCCT; 3 soups with a gap, 2.5e-9 to 2.5e-8 off the closed form), because the
// contract had other guards for those bands (the curve-size rule, the gap rule) that the layer does not; at the bars they are refused and no pull the rig scores exact is.
import type { Feature, SketchFeature } from '@shuff57/reshape-script/model-types';
import type { SoupGeom } from '@shuff57/reshape-script/model-types';
import type { ArcApi, RunResult, TranslateCtx, V2 } from './types.js';
import type { RuleRow } from './sketch-map.js';
import { checkRules } from './rule-check.js';

export const RECONCILE_TOL = { planar: 1e-9, curved: 3e-4 };
/** The guard code on a refused note. */
export const SKETCH_VOLUME_GUARD = 'SKETCH-VOLUME';

const TAU = Math.PI * 2;
// mm: two row ends this close are chained into one loop (the same tolerance as the layer's even-odd picker, soup-regions.ts). It does not decide what is joined:
// the open-outline pre-flight (open-outline.ts) refuses a pull of a soup with an end that is neither within SAME_POINT = 1e-9 of another nor held by a coincident
// rule before the engine runs, so every soup this check sees has its ends 1e-9 apart or held by a rule (and a rule that does not hold on the rows skips the check).
const JOIN_TOL = 1e-5;
const hyp = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmt = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v));
const piecesWord = (n: number) => (n === 1 ? 'one piece' : `${n} separate pieces`);

/** What the check needs to know about a sketch: its solid area (mm2), how many separate solid regions it has, and whether any edge is curved. */
export interface SketchArea { area: number; regions: number; curved: boolean }

interface Row { k: string; a: V2; b: V2; c: V2; r: number; sense?: string; construction?: boolean }
const isSoupSketch = (sk: SketchFeature) => sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
const live = (g: Row) => !g.construction && g.k !== 'point';

function arcSweep(g: Row): { a0: number; sweep: number } {
  const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]); const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
  let sw = (((a1 - a0) % TAU) + TAU) % TAU;
  if (g.sense === 'cw') sw = sw === 0 ? -TAU : sw - TAU; else if (sw === 0) sw = TAU;
  return { a0, sweep: sw };
}
const inPoly = (p: V2, poly: V2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]; const b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
};

/**
 * The loops of a soup's live rows chained end to end, each with its EXACT area (lines and arcs by Green's theorem, a circle as pi r^2) and its nesting depth; the
 * solid area by the even-odd rule (depth 0 solid, 1 a hole, 2 solid ...) and the number of solid regions. The contract's soupRegions, with the layer's join tolerance.
 * null when a chain does not close.
 */
export function soupArea(rows: Row[]): SketchArea | null {
  const L0 = rows.filter(live);
  if (!L0.length) return null;
  // integrated about a point of the sketch itself: a part far from the origin (1e6 mm) loses the area to cancellation otherwise (measured: ft-named-rect-1e6)
  const o = L0[0].a ?? L0[0].c; const sh = (p: V2 | undefined): V2 => (p ? [p[0] - o[0], p[1] - o[1]] : p as unknown as V2);
  const L: Row[] = L0.map((g) => ({ ...g, a: sh(g.a), b: sh(g.b), c: sh(g.c) }));
  const used = new Set<number>(); const loops: Array<{ poly: V2[]; area: number; depth: number }> = [];
  const ends = (g: Row): V2[] => (g.k === 'line' || g.k === 'arc' ? [g.a, g.b] : []);
  for (let s = 0; s < L.length; s++) {
    if (used.has(s)) continue;
    const g0 = L[s]; used.add(s);
    if (g0.k === 'circle') {
      const n = 1440;
      loops.push({ poly: Array.from({ length: n }, (_, k) => [g0.c[0] + g0.r * Math.cos((TAU * k) / n), g0.c[1] + g0.r * Math.sin((TAU * k) / n)]), area: Math.PI * g0.r * g0.r, depth: 0 });
      continue;
    }
    const poly: V2[] = []; let green = 0; const start = g0.a;
    const walk = (g: Row, fromA: boolean): V2 => {
      if (g.k === 'line') { const a = fromA ? g.a : g.b; const b = fromA ? g.b : g.a; poly.push(a); green += (a[0] * b[1] - b[0] * a[1]) / 2; return b; }
      const r = (hyp(g.a, g.c) + hyp(g.b, g.c)) / 2; const { a0, sweep } = arcSweep(g);
      const s0 = fromA ? a0 : a0 + sweep; const w = fromA ? sweep : -sweep;
      const n = Math.max(8, Math.ceil(Math.abs(w) / (TAU / 720)));
      for (let k = 0; k < n; k++) poly.push([g.c[0] + r * Math.cos(s0 + (w * k) / n), g.c[1] + r * Math.sin(s0 + (w * k) / n)]);
      green += (r * r * w + g.c[0] * r * (Math.sin(s0 + w) - Math.sin(s0)) - g.c[1] * r * (Math.cos(s0 + w) - Math.cos(s0))) / 2;
      return fromA ? g.b : g.a;
    };
    let at = walk(g0, true); let closed = false;
    for (let guard = 0; guard < L.length + 1; guard++) {
      if (hyp(at, start) < JOIN_TOL) { closed = true; break; }
      const k = L.findIndex((q, i) => { if (used.has(i)) return false; const e = ends(q); return e.length > 0 && (hyp(e[0], at) < JOIN_TOL || hyp(e[1], at) < JOIN_TOL); });
      if (k < 0) break;
      used.add(k); at = walk(L[k], hyp(ends(L[k])[0], at) < JOIN_TOL);
    }
    if (!closed) return null;
    loops.push({ poly, area: Math.abs(green), depth: 0 });
  }
  loops.forEach((l, i) => { const probe = l.poly[Math.floor(l.poly.length / 3)]; l.depth = loops.filter((q, j) => j !== i && inPoly(probe, q.poly)).length; });
  const area = loops.reduce((a, l) => a + (l.depth % 2 === 0 ? 1 : -1) * l.area, 0);
  return { area, regions: loops.filter((l) => l.depth % 2 === 0).length, curved: L.some((g) => g.k !== 'line') };
}

/**
 * The area of a sketch the layer maps as one outline (a polygon with rounded or bevelled corners, a circle): the outline the translator hands the engine
 * (arc.outlineOf), integrated exactly. Each edge adds its chord (a x b) / 2; an arc edge of signed sweep s adds its circular segment r^2 (s - sin s) / 2 on top.
 */
export function outlineArea(sk: SketchFeature, arc: ArcApi): SketchArea | null {
  const o = arc.outlineOf(sk);
  if (!o || !o.ok || !Array.isArray(o.points)) return null;
  if (sk.shape === 'circle') {
    const [a, b] = o.points; if (!a || !b) return null;
    const d = hyp(a, b);
    return { area: (Math.PI * d * d) / 4, regions: 1, curved: true };
  }
  const n = o.points.length;
  if (n < 3) return null;
  // integrated about the first corner: a part far from the origin (1e6 mm) loses the area to cancellation otherwise (measured: ft-named-rect-1e6)
  const P: V2[] = o.points.map((p) => [p[0] - o.points[0][0], p[1] - o.points[0][1]]);
  const B = o.bulges ?? {};
  let s2 = 0; let curved = false;
  for (let i = 0; i < n; i++) {
    const a = P[i]; const b = P[(i + 1) % n];
    s2 += a[0] * b[1] - b[0] * a[1];
    const g = B[i];
    if (!g) continue;
    curved = true;
    const { radius, startAngle, endAngle } = arc.arcFromBulge(a, b, g);
    let sweep = endAngle - startAngle;
    if (g > 0 && sweep < 0) sweep += TAU;
    if (g < 0 && sweep > 0) sweep -= TAU;
    s2 += radius * radius * (sweep - Math.sin(sweep));
  }
  return { area: Math.abs(s2) / 2, regions: 1, curved };
}

/**
 * A soup's rules are solved by the engine, not here: the rows in the doc are what the student drew. When a rule does not already hold on the drawn rows (a dimension
 * that resizes the shape, a join that moves a corner), the engine's shape differs from the rows and their area says nothing about it, so no claim is made (measured:
 * gallery-fr-rect-dims draws 28.2 x 17 and dimensions it 30 x 20; the build is the exact 6000 mm3). Residuals by the layer's own rule checker (rule-check.ts, no kernel);
 * a rule it cannot evaluate counts as not holding.
 */
export const RULE_HOLDS = 1e-9;
export function rulesHold(sk: SketchFeature): boolean {
  const rules = (sk.rules ?? []) as unknown as RuleRow[];
  if (!rules.length) return true;
  try {
    const geoms = sk.geoms as SoupGeom[];
    return checkRules(geoms, rules, geoms).every((r) => !r.driving || (r.residual !== null && Number.isFinite(r.residual) && r.residual <= RULE_HOLDS));
  } catch { return false; }
}

/** The area of any sketch the layer pulls, or null when it cannot be computed here. */
export function sketchArea(sk: SketchFeature, arc: ArcApi): SketchArea | null {
  try {
    if (isSoupSketch(sk) && !rulesHold(sk)) return null;
    const r = isSoupSketch(sk) ? soupArea(sk.geoms as unknown as Row[]) : outlineArea(sk, arc);
    return r && Number.isFinite(r.area) && r.area > 0 ? r : null;
  } catch { return null; } // a malformed sketch: the planner that maps it decides, in its own words
}

/** The fields of a pull this check reads (loose: a malformed doc is skipped, never refused here). */
interface PullView { id: string; kind: string; target?: string; height?: unknown; midplane?: boolean; length2?: number; taper?: number; direction?: unknown; alongNormal?: boolean }

/**
 * The length the pull spans along the sketch normal, as the layer's planners build it (a midplane pull spans |height|; otherwise |height| plus a positive length2),
 * or null for a pull this arithmetic does not describe (the contract's skips).
 */
export function pullLength(f: PullView): number | null {
  if (typeof f.height !== 'number' || !Number.isFinite(f.height)) return null;
  if (f.taper || (f.direction && f.alongNormal === false)) return null;
  const l2 = !f.midplane && typeof f.length2 === 'number' && f.length2 > 0 ? f.length2 : 0;
  return Math.abs(f.height) + l2;
}

/** The sentence: owner-approved wording (2026-11-06); only the ${...} parts are computed. */
export function reconcileSentence(f: { target?: string }, H: number, info: SketchArea, built: { volume: number; pieces: number }): string {
  const want = info.area * H; const got = built.volume; const wantPieces = info.regions;
  const part = f.target ? `sketch ${f.target}` : 'this sketch';
  const head = `Pulling ${part} ${fmt(H)} mm should make about ${fmt(+want.toPrecision(7))} mm3 in ${piecesWord(wantPieces)} (its area ${fmt(+info.area.toPrecision(7))} mm2 times the length), but the 3D build came out`;
  const tail = 'so it was not built; a thin wall or a very small gap between shapes is the usual cause, so make the walls thicker or draw the shapes on separate sketches.';
  if (built.pieces === wantPieces) return `${head} ${fmt(+Math.abs(got - want).toPrecision(2))} mm3 ${got < want ? 'smaller' : 'larger'}, ${tail}`;
  return `${head} at ${fmt(+built.volume.toPrecision(7))} mm3 in ${piecesWord(built.pieces)}, ${tail}`;
}

/** The contract's reconcileExtrude: null when the build agrees with the sketch, else the sentence. */
export function reconcilePull(f: PullView, info: SketchArea | null, built: { volume: number; pieces: number } | null): string | null {
  if (!info || !(info.area > 0) || !built || !Number.isFinite(built.volume)) return null;
  const H = pullLength(f);
  if (H === null || !(H > 0)) return null;
  const want = info.area * H;
  const tol = info.curved ? RECONCILE_TOL.curved : RECONCILE_TOL.planar;
  const rel = Math.abs(built.volume - want) / want;
  if (rel <= tol && built.pieces === info.regions) return null;
  return reconcileSentence(f, H, info, built);
}

/** A body belongs to the pull when it is one of the names the pull produced or a piece the engine split off one of them ("name (2)"). */
const isPiece = (bodyName: string, names: string[]) => names.some((n) => bodyName === n || (bodyName.startsWith(`${n} (`) && /^ \(\d+\)$/.test(bodyName.slice(n.length))));

/**
 * The check as every step calls it, right after a successful engine run of a feature and before the feature is accepted. Only a pull ('extrude') is checked;
 * `produces` are the body names its plan made, `sketch` the sketch it pulls. The pieces are counted on the reply itself, whatever the set's own aggregate counts.
 * ctx.skipSketchVolume turns it off (the fake engines of the differential tests report a bounding-box volume; never set in production).
 */
export function sketchVolumeRefusal(f: Feature, sketch: SketchFeature | undefined, ctx: Pick<TranslateCtx, 'arc' | 'skipSketchVolume'>, res: RunResult, produces: string[]): string | null {
  if (f.kind !== 'extrude' || ctx.skipSketchVolume || !sketch || !res.measure) return null;
  const fv = f as unknown as PullView;
  if (pullLength(fv) === null) return null;
  const mine = res.measure.bodies.filter((b) => isPiece(b.name, produces));
  if (!mine.length) return null;
  const built = { volume: mine.reduce((a, b) => a + b.volume_mm3, 0), pieces: mine.length };
  return reconcilePull(fv, sketchArea(sketch, ctx.arc), built);
}
