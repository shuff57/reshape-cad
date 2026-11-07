// The open-outline pre-flight: a pull or a pocket of a soup (a sketch drawn as rows and rules) whose outline has an end that meets nothing is refused before the
// engine is called, whatever the kernel would do with it. Pure 2-D arithmetic on the rows; no kernel is named or called.
//
// Why (docs/spikes/solidcraft-referee/GUARD-OPEN-OUTLINE.md): a soup rectangle whose line 3 ends at [0.00001, 20] while line 4 starts at [0, 20], with no coincident
// rule, pulled 10, is built as 5999.9995 mm3 by SolidCraft 0.30.1 (it welds the two loose ends at their midpoint) and the shipped 'unified' set ships it; OCCT and
// brep-rs refuse it. A pocket with a 1e-6 gap is built in every set on the 0.21.0 pin too. The layer's even-odd picker and the sketch-volume check both chain row ends
// within JOIN_TOL = 1e-5 mm of each other, so neither could see such a gap.
//
// The rule (owner, 2026-11-07): two row ends are joined ONLY when they are the same point (SAME_POINT below) or a coincident rule holds them together (directly, or
// through a chain of coincident rules over points, other ends or the origin). Every end of every live line and arc (not construction, not a point row) must be joined
// to another end; a circle is closed by itself.
//
// SAME_POINT = 1e-9 mm, measured (GUARD-OPEN-OUTLINE.md, "Threshold"; packages/layer/test/gap-census.mjs): over every soup that a pull or pocket reads in the corpora
// (sketch-geometry, extrude-pocket, phase 2 fixtures, the layer's seeded docs, the pane examples: 1,450 soups, 17,642 ends), an end with no coincident rule is either
// exactly 0 from another end (1,878 ends), more than 1e-3 away (138, open shapes), or one of the drawn gap-series cases at 1e-9 ... 1e-3 (18), which OCCT and brep-rs
// refuse. An end that a rule holds comes out of the contract's own solver at most 8.4e-11 from its partner (on a conflicting sketch), so the solver's residual is 12x
// inside the bar and the owner's 1e-7 example 100x outside it. 1e-9 is also the repo's existing "same point" (extrude-pocket cleanSketch, the contract's LIMITS.zero).
//
// It sits IN FRONT of JOIN_TOL (soup-regions.ts, sketch-volume.ts), which is unchanged: once this check has passed, every end is within 1e-9 of its partner or held
// by a rule, so the chaining at 1e-5 joins exactly the ends this check joined (a rule that does not hold on the drawn rows makes sketch-volume skip, as before).
//
// The two sentences are the owner-approved ones (2026-11-07), only the ${...} parts computed: a gap under 1e-5 mm on the drawn coordinates gets the extrude-pocket
// group's "a hair apart" sentence (extrude-pocket.ts plainKernelSentence); a wider one the even-odd picker's loose-end sentence (soup-regions.ts soupLoops), with
// "to cut" for a pocket. Both carry the planner's `${f.id}: ` prefix; planFeature raises them (not inSketch, which the planners wrap again).
import type { Feature, SketchFeature } from '@shuff57/reshape-script/model-types';
import type { V2 } from './types.js';

/** The guard code on a refused note (a code, not text). Every step keeps this refusal's sentence as it is. */
export const OPEN_OUTLINE_GUARD = 'OPEN-OUTLINE';
/** mm: two row ends this close are the same point. */
export const SAME_POINT = 1e-9;
/** mm: below this gap (strict, on the drawn coordinates) the ends are "a hair apart" (the extrude-pocket group's sentence); at or above it, a loose end. */
export const HAIR_GAP = 1e-5;
/** The join tolerance the loose-end walk uses to say WHERE the outline breaks: the even-odd picker's (soup-regions.ts), so the sentence names the same point. */
const WALK_TOL = 1e-5;

interface Row { k: string; id: number; a: V2; b: V2; c?: V2; construction?: boolean }
interface RuleView { k: string; a: number; aEnd?: string; b: number; bEnd?: string; active?: boolean }
type End = 'a' | 'b';

const isSoup = (sk: SketchFeature) => sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
const hyp = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const where = (p: V2) => `[${p.map((v) => +v.toFixed(3)).join(', ')}]`;

/** What the check found: null when every end is joined; otherwise the sentence's kind, the place and the gap. */
export type OpenOutline = null | { kind: 'hair'; gap: number } | { kind: 'loose'; at: V2; gap: number };

/**
 * The ends of a soup's live lines and arcs that are joined to no other end, by SAME_POINT or by coincident rules. null when the sketch is not a soup or every end
 * is joined. A malformed row (no coordinates) is left to the planner that maps the sketch, which refuses it in its own words.
 */
export function openOutline(sk: SketchFeature): OpenOutline {
  if (!isSoup(sk)) return null;
  const all = sk.geoms as unknown as Row[];
  const rows = all.filter((g) => !g.construction && (g.k === 'line' || g.k === 'arc'));
  if (!rows.length) return null;
  const ok = (p: unknown): p is V2 => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  if (rows.some((g) => !ok(g.a) || !ok(g.b))) return null;
  // coincident rules, chained: a union-find over (row id, end) keys, the origin as row -1. An end with no end named defaults as the sketch mapper's does.
  const byId = new Map(all.map((g) => [g.id, g]));
  const key = (id: number, end: string | undefined) => (id === -1 ? '-1:o' : `${id}:${end ?? (byId.get(id)?.k === 'circle' ? 'c' : 'a')}`);
  const up = new Map<string, string>();
  const find = (k: string): string => { let r = k; for (let n = up.get(r); n !== undefined && n !== r; n = up.get(r)) r = n; return r; };
  const unite = (x: string, y: string) => { if (!up.has(x)) up.set(x, x); if (!up.has(y)) up.set(y, y); const rx = find(x); const ry = find(y); if (rx !== ry) up.set(rx, ry); };
  for (const r of ((sk.rules ?? []) as unknown as RuleView[])) if (r && r.k === 'coincident' && r.active !== false) unite(key(r.a, r.aEnd), key(r.b, r.bEnd));
  const ends: Array<{ g: Row; e: End; p: V2; k: string }> = rows.flatMap((g) => (['a', 'b'] as End[]).map((e) => ({ g, e, p: g[e], k: `${g.id}:${e}` })));
  const ruled = (x: string, y: string) => up.has(x) && up.has(y) && find(x) === find(y);
  const joined = (i: number) => ends.some((y, j) => j !== i && (hyp(ends[i].p, y.p) <= SAME_POINT || ruled(ends[i].k, y.k)));
  const gapOf = (i: number) => ends.reduce((m, y, j) => (j === i ? m : Math.min(m, hyp(ends[i].p, y.p))), Infinity);
  const loose = ends.map((_, i) => i).filter((i) => !joined(i));
  if (!loose.length) return null;
  const gaps = loose.map(gapOf);
  if (gaps.every((d) => d < HAIR_GAP)) return { kind: 'hair', gap: Math.max(...gaps) };
  // a loose end: say where, walking the rows as the even-odd picker does (soupLoops), so the place is the one its sentence would name; a coincident rule also joins
  // Only a place that IS one of the loose ends found above (gap >= HAIR_GAP) is taken from the walk; otherwise the first such end in row order.
  const wide = new Map(loose.map((i, n) => [ends[i].k, gaps[n]] as const).filter(([, d]) => d >= HAIR_GAP));
  const meets = (x: { k: string; p: V2 }, y: { k: string; p: V2 }) => hyp(x.p, y.p) <= WALK_TOL || ruled(x.k, y.k);
  const used = new Set<number>();
  for (const e of rows) {
    if (used.has(e.id)) continue;
    used.add(e.id);
    const start = { k: `${e.id}:a`, p: e.a };
    let tail = { k: `${e.id}:b`, p: e.b };
    for (let guard = 0; guard <= rows.length && !meets(tail, start); guard++) {
      const cand = rows.filter((x) => !used.has(x.id) && (meets({ k: `${x.id}:a`, p: x.a }, tail) || meets({ k: `${x.id}:b`, p: x.b }, tail)));
      if (cand.length === 0) { if (wide.has(tail.k)) return { kind: 'loose', at: tail.p, gap: wide.get(tail.k)! }; break; }
      if (cand.length > 1) break; // several edges meet here: not this check's sentence; the place falls back to the first loose end below
      const x = cand[0]; used.add(x.id);
      const fwd = meets({ k: `${x.id}:a`, p: x.a }, tail);
      tail = fwd ? { k: `${x.id}:b`, p: x.b } : { k: `${x.id}:a`, p: x.a };
    }
  }
  const [k0, d0] = [...wide][0];
  return { kind: 'loose', at: ends.find((x) => x.k === k0)!.p, gap: d0 };
}

/**
 * The pre-flight as planFeature calls it, for a pull ('extrude') or a pocket of a soup: null when the outline closes, else the whole refusal sentence with the
 * `${f.id}: ` prefix.
 */
export function openOutlineRefusal(f: Feature, sk: SketchFeature | undefined): string | null {
  if ((f.kind !== 'extrude' && f.kind !== 'pocket') || !sk) return null;
  const o = openOutline(sk);
  if (!o) return null;
  if (o.kind === 'hair') return `${f.id}: the outline does not close: two ends that should meet are a hair apart (less than 0.00001 mm); add a coincident rule between them or make them meet exactly`;
  return `${f.id}: sketch ${sk.id} has an edge that does not close into a loop (a loose end near ${where(o.at)}), so it has no outline to ${f.kind === 'pocket' ? 'cut' : 'pull'}`;
}
