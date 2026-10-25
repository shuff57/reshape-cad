// TypeScript port of docs/spikes/solidcraft-referee/phase7/pane/lib/sketch-map.mjs. Behaviour-preserving: same commands,
// same refusal sentences. See that file for the entity-name table and the reasoning behind each rule's mapping.
//
// ModelDoc SketchFeature (geoms + rules, BEFORE solving) -> engine sketch commands, so that the ENGINE's own sketch
// solver produces the geometry. A rule with no honest counterpart is refused in a plain sentence and the WHOLE sketch is
// then not built.
import type { SoupGeom, SoupRule, SketchFeature } from '@shuff57/reshape-script/model-types';
import type { Cmd, Frame, V2 } from './types.js';

const NAMED = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

/** The fields of a sketch this module reads. A SketchFeature satisfies it. */
export interface SketchInput {
  id?: string;
  plane?: 'xy' | 'xz' | 'yz';
  offset?: number;
  frame?: { origin: number[]; u: number[]; v: number[] };
  geoms?: SoupGeom[];
  geom?: SoupGeom[];
  rules?: SoupRule[];
}

/** A soup rule as it can arrive in a doc: the typed union plus the two flags the type does not declare. */
export type RuleRow = SoupRule & { driving?: boolean; active?: boolean };

export function frameOf(sk: SketchInput): Frame {
  if (sk.frame) {
    const { origin, u, v } = sk.frame;
    return { origin, u, v, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
  }
  const a = NAMED[sk.plane ?? 'xy'] ?? NAMED.xy;
  const o = sk.offset ?? 0;
  return { origin: a.n.map((c) => c * o), ...a };
}

const gname = (id: number) => `g${id}`;
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const dist = (a: V2, b: V2) => len(sub(a, b));

type LineGeom = Extract<SoupGeom, { k: 'line' }>;
type CircleGeom = Extract<SoupGeom, { k: 'circle' }>;
type ArcGeom = Extract<SoupGeom, { k: 'arc' }>;
type RoundGeom = CircleGeom | ArcGeom;
const isRound = (g: SoupGeom): g is RoundGeom => g.k === 'circle' || g.k === 'arc';

/** Mid point on the arc a -> b taken in direction `sense` about centre c (what the three-point arc's `through` needs). */
function arcThrough(g: ArcGeom): V2 {
  const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
  const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
  const TAU = Math.PI * 2;
  let sweep = (((a1 - a0) % TAU) + TAU) % TAU; // ccw a -> b
  if (g.sense === 'cw') sweep = sweep === 0 ? -TAU : sweep - TAU;
  const m = a0 + sweep / 2;
  const r = g.r ?? dist(g.a, g.c);
  return [g.c[0] + r * Math.cos(m), g.c[1] + r * Math.sin(m)];
}

export interface MapRefusal {
  rule: number;
  kind: string;
  sentence: string;
}
export interface NameEntry {
  geom: number | null;
  kind: string;
  curve: string | null;
  points: Record<string, string>;
  sense?: string;
  forRule?: number;
}
export type MapResult =
  | { ok: false; refusals: MapRefusal[]; names: NameEntry[]; notes: string[] }
  | { ok: true; commands: Cmd[]; names: NameEntry[]; ruleMap: number[][]; notes: string[]; sketchName: string; frame: Frame };

/**
 * Map one sketch. Returns
 *   { ok:true,  commands, names, ruleMap, notes }          commands are everything up to (not including) sketch.finish
 *   { ok:false, refusals:[{rule, kind, sentence}], names }  the sketch is not built
 * opts: { name } engine sketch name (default `sk_<id>`), { frame } override.
 */
export function mapSketch(sk: SketchInput, opts: { name?: string; frame?: Frame } = {}): MapResult {
  const geoms = sk.geoms ?? sk.geom ?? [];
  const rules: RuleRow[] = sk.rules ?? [];
  const name = opts.name ?? `sk_${sk.id ?? 'x'}`;
  const fr = opts.frame ?? frameOf(sk);
  const refusals: MapRefusal[] = [];
  const notes: string[] = [];
  const refuse = (i: number, sentence: string) => { refusals.push({ rule: i, kind: rules[i]?.k ?? 'geom', sentence }); };

  // ---- dense 1-based ids ------------------------------------------------------------------------------------------
  const byId = new Map<number, SoupGeom>();
  geoms.forEach((g, i) => {
    if (g.id !== i + 1) refusals.push({ rule: -1, kind: 'geom', sentence: `geometry row ${i + 1} carries id ${g.id}; the soup's ids are dense and 1-based` });
    byId.set(g.id, g);
  });

  const commands: Cmd[] = [];
  const names: NameEntry[] = [];
  commands.push({ command: 'sketch.create', params: { name, plane: { origin: fr.origin, x_dir: fr.u, y_dir: fr.v } } });
  for (const g of geoms) {
    const id = gname(g.id);
    const base = { id, connect: false, ...(g.construction ? { construction: true } : {}) };
    if (g.k === 'point') {
      commands.push({ command: 'sketch.point', params: { point: g.p, id, connect: false } });
      names.push({ geom: g.id, kind: 'point', curve: null, points: { a: id } });
    } else if (g.k === 'line') {
      commands.push({ command: 'sketch.line', params: { points: [g.a, g.b], ids: [id], connect: false, ...(g.construction ? { construction: true } : {}) } });
      names.push({ geom: g.id, kind: 'line', curve: id, points: { a: `${id}.start`, b: `${id}.end` } });
    } else if (g.k === 'circle') {
      commands.push({ command: 'sketch.circle.center', params: { center: g.c, radius: g.r, ...base } });
      names.push({ geom: g.id, kind: 'circle', curve: id, points: { c: `${id}.center` } });
    } else if (g.k === 'arc') {
      commands.push({ command: 'sketch.arc.three_point', params: { start: g.a, end: g.b, through: arcThrough(g), ...base } });
      // engine QUIRK (measured in the spike): a clockwise three-point arc is stored as the ccw arc (b -> a) with
      // `reversed`; our logical start `a` of a cw arc is `<id>.end`.
      const cw = g.sense === 'cw';
      names.push({ geom: g.id, kind: 'arc', curve: id, sense: g.sense, points: { a: cw ? `${id}.end` : `${id}.start`, b: cw ? `${id}.start` : `${id}.end`, c: `${id}.center` } });
    } else {
      const bad = g as { id: number; k: string }; // narrowed to never by the four kinds above; a malformed doc can still land here
      refusals.push({ rule: -1, kind: 'geom', sentence: `geometry ${bad.id} is a ${bad.k}, which this mapper does not draw (point, line, circle and arc only)` });
    }
  }

  // ---- reference resolution ---------------------------------------------------------------------------------------
  const geomOf = (id: number): SoupGeom | undefined => byId.get(id);
  // ODDITY PRESERVED (see NOTES.md): undefined for a geometry kind that was refused above; callers then read `.points` on it.
  const nameOf = (id: number) => names.find((n) => n.geom === id) as NameEntry;
  /** A POINT reference for geometry `id` at end `end` (rule i for refusal sentences). Returns ref string or null (refused). */
  const pt = (i: number, id: number, end: string | undefined, { need = false, lock = false } = {}): string | null => {
    if (id === -1) return 'origin';
    if (id === -2 || id === -3) { refuse(i, `the ${id === -2 ? 'X' : 'Y'} axis has no point to name`); return null; }
    const g = geomOf(id);
    if (!g) { refuse(i, `names geometry ${id}, which is not in the sketch`); return null; }
    const n = nameOf(id);
    let e = end;
    if (!e) {
      if (need) { refuse(i, `needs a point of geometry ${id} and the row names none (brep-rs refuses the same row)`); return null; }
      e = lock && (g.k === 'circle' || g.k === 'arc') ? 'c' : g.k === 'circle' ? 'c' : 'a';
    }
    if (g.k === 'point') { if (e !== 'a') { refuse(i, `geometry ${id} is a point and has no end '${e}'`); return null; } return n.points.a; }
    const ref = n.points[e];
    if (!ref) { refuse(i, `geometry ${id} is a ${g.k} and has no point '${e}'`); return null; }
    return ref;
  };
  /** A CURVE reference. axes: allow -2/-3 -> 'x'/'y'. */
  const curve = (i: number, id: number, { axes = false, only = null }: { axes?: boolean; only?: string[] | null } = {}): string | null => {
    if (id === -2 || id === -3) {
      if (!axes) { refuse(i, `the sketch axis cannot be used here`); return null; }
      return id === -2 ? 'x' : 'y';
    }
    const g = geomOf(id);
    if (!g) { refuse(i, `names geometry ${id}, which is not in the sketch`); return null; }
    if (g.k === 'point') { refuse(i, `geometry ${id} is a point, not a curve`); return null; }
    if (only && !only.includes(g.k)) { refuse(i, `geometry ${id} is a ${g.k}; this rule needs ${only.join(' or ')}`); return null; }
    return nameOf(id).curve;
  };
  const startPos = (id: number, end: string | undefined): V2 | null => {
    if (id === -1) return [0, 0];
    const g = geomOf(id);
    if (!g) return null;
    if (g.k === 'point') return g.p;
    if (g.k === 'line') return end === 'b' ? g.b : g.a;
    if (g.k === 'circle') return g.c;
    if (g.k === 'arc') return end === 'b' ? g.b : end === 'c' ? g.c : g.a;
    return null;
  };

  const ruleMap: number[][] = []; // per rule: indices into commands
  const emit = (i: number, cmd: string, params: Record<string, unknown>) => { commands.push({ command: cmd, params }); (ruleMap[i] ??= []).push(commands.length - 1); };
  const ruleIsDriven = (r: RuleRow) => r.driving === false;
  const dimBase = (r: RuleRow) => (ruleIsDriven(r) ? { driven: true } : {});
  const value = (i: number, r: { value?: unknown }): number | null => {
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) { refuse(i, `carries no numeric value`); return null; }
    return r.value;
  };
  /** the preceding coincident rows, so an endpoint tangent can be checked to ride on one */
  const joined = (a: number, ae: string | undefined, b: number, be: string | undefined) => rules.some((x) => x.k === 'coincident' && ((x.a === a && (x.aEnd ?? 'a') === (ae ?? 'a') && x.b === b && (x.bEnd ?? 'a') === (be ?? 'a')) || (x.a === b && (x.aEnd ?? 'a') === (be ?? 'a') && x.b === a && (x.bEnd ?? 'a') === (ae ?? 'a'))));

  // lock rules are hoisted ahead of every other rule (the engine's fix pins a point where it is WHEN THE COMMAND RUNS).
  const order = [...rules.keys()].sort((x, y) => (rules[x].k === 'lock' ? 0 : 1) - (rules[y].k === 'lock' ? 0 : 1) || x - y);
  order.forEach((i) => {
    const r = rules[i];
    if (r.active === false) { notes.push(`rule ${i} (${r.k}) is inactive: skipped, as brep-rs drops it from the solve, the diagnosis and the profile`); ruleMap[i] = []; return; }
    switch (r.k) {
      case 'coincident': {
        const a = pt(i, r.a, r.aEnd), b = pt(i, r.b, r.bEnd);
        if (a && b) emit(i, 'sketch.constraint.coincident', { a, b });
        return;
      }
      case 'pointOnObject': {
        const a = pt(i, r.a, r.aEnd);
        const b = curve(i, r.b, { axes: true, only: ['line', 'circle', 'arc'] });
        if (a && b) emit(i, 'sketch.constraint.coincident', { a, b });
        return;
      }
      case 'horizontal': case 'vertical': {
        const l = curve(i, r.a, { only: ['line'] });
        if (l) emit(i, 'sketch.constraint.horizontal_vertical', { line: l, mode: r.k });
        return;
      }
      case 'parallel': case 'perpendicular': {
        const a = curve(i, r.a, { axes: true, only: ['line'] }), b = curve(i, r.b, { axes: true, only: ['line'] });
        if (a && b) emit(i, `sketch.constraint.${r.k}`, { a, b });
        return;
      }
      case 'equal': {
        const ga = geomOf(r.a), gb = geomOf(r.b);
        const a = curve(i, r.a, { only: ['line', 'circle', 'arc'] }), b = curve(i, r.b, { only: ['line', 'circle', 'arc'] });
        if (a && b && ga && gb) {
          const round = (g: SoupGeom) => g.k === 'circle' || g.k === 'arc';
          if (round(ga) !== round(gb)) { refuse(i, `equal across a line and a circle/arc is refused by brep-rs too (a radius is not a length)`); return; }
          emit(i, 'sketch.constraint.equal', { a, b });
        }
        return;
      }
      case 'tangent': {
        const ga = geomOf(r.a), gb = geomOf(r.b);
        const a = curve(i, r.a, { axes: true, only: ['line', 'circle', 'arc'] }), b = curve(i, r.b, { axes: true, only: ['line', 'circle', 'arc'] });
        if (!a || !b || !ga || !gb) return;
        const endForm = r.aEnd !== undefined || r.bEnd !== undefined;
        if (endForm && !joined(r.a, r.aEnd, r.b, r.bEnd)) {
          refuse(i, `is the endpoint tangent form with no coincident row joining those two ends before it; solidcraft's tangent is between curves, and it only treats it as tangent-at-the-joint when the ends are tied`);
          return;
        }
        // branch requests: mapped only when the start state already is in the requested branch
        if (isRound(ga) && isRound(gb) && r.mode) {
          const d = dist(ga.c, gb.c);
          const ext = Math.abs(d - (ga.r + gb.r));
          const int = Math.abs(d - Math.abs(ga.r - gb.r));
          const startMode = ext <= int ? 'external' : 'internal';
          if (startMode !== r.mode) { refuse(i, `asks for ${r.mode} tangency but the circles start ${startMode}ly placed; solidcraft's tangent has no mode parameter (it keeps the branch of the starting geometry), so it cannot be requested`); return; }
          notes.push(`rule ${i} (tangent mode ${r.mode}): branch carried by the starting geometry, not requested of solidcraft`);
        }
        if (r.side !== undefined && ((ga.k === 'line' && isRound(gb)) || (gb.k === 'line' && isRound(ga)))) {
          const L = (ga.k === 'line' ? ga : gb) as LineGeom, C = (ga.k === 'line' ? gb : ga) as RoundGeom;
          const sigma = Math.sign(cross(sub(L.b, L.a), sub(C.c, L.a)));
          if (sigma !== 0 && sigma !== Math.sign(r.side)) { refuse(i, `records side ${r.side} for the line/circle tangency but the circle starts on the other side of the line; solidcraft's tangent has no side parameter, so it cannot be requested`); return; }
          notes.push(`rule ${i} (tangent side ${r.side}): branch carried by the starting geometry, not requested of solidcraft`);
        }
        emit(i, 'sketch.constraint.tangent', { a, b });
        return;
      }
      case 'symmetric': {
        const a = pt(i, r.a, r.aEnd), b = pt(i, r.b, r.bEnd);
        if (!a || !b) return;
        if (r.cEnd !== undefined) {
          // 3-point form: c is the midpoint of a and b; a construction line through the two mirrored points carries it.
          const c = pt(i, r.c, r.cEnd);
          if (!c) return;
          const m = `m${i}`;
          commands.push({ command: 'sketch.line', params: { points: [a, b], ids: [m], construction: true, connect: false } });
          (ruleMap[i] ??= []).push(commands.length - 1);
          names.push({ geom: null, kind: 'helper-line', curve: m, points: {}, forRule: i });
          emit(i, 'sketch.constraint.midpoint', { point: c, line: m });
        } else {
          const l = curve(i, r.c, { axes: true, only: ['line'] });
          if (l) emit(i, 'sketch.constraint.symmetry', { a, b, line: l });
        }
        return;
      }
      case 'distance': {
        const v = value(i, r); if (v === null) return;
        if (!(v > 0)) { refuse(i, `has value ${v}; solidcraft's distance dimension is a length and a zero or negative one is refused`); return; }
        const a = pt(i, r.a, r.aEnd, { need: true }), b = pt(i, r.b, r.bEnd, { need: true });
        if (!a || !b) return;
        const ga = geomOf(r.a);
        const ends = [r.aEnd, r.bEnd].sort().join('');
        if (r.a === r.b && ga?.k === 'line' && ends === 'ab') emit(i, 'sketch.dimension', { entities: [nameOf(r.a).curve], type: 'length', value: v, ...dimBase(r) });
        else emit(i, 'sketch.dimension', { entities: [a, b], type: 'distance', value: v, ...dimBase(r) });
        return;
      }
      case 'distanceX': case 'distanceY': {
        const v = value(i, r); if (v === null) return;
        const a = pt(i, r.a, r.aEnd, { need: true }), b = pt(i, r.b, r.bEnd, { need: true });
        if (!a || !b) return;
        const ax = r.k === 'distanceX' ? 0 : 1;
        if (v === 0) {
          // signed zero: the two points are level; the equivalent constraint is a horizontal/vertical-points constraint.
          if (r.driving === false) { refuse(i, `is a reference ${r.k} of 0; solidcraft has no reference form of a point-pair level constraint`); return; }
          emit(i, 'sketch.constraint.horizontal_vertical', { points: [a, b], mode: r.k === 'distanceX' ? 'vertical' : 'horizontal' });
          notes.push(`rule ${i} (${r.k} 0): emitted as a ${r.k === 'distanceX' ? 'vertical' : 'horizontal'}-points constraint (no parameter), not a dimension`);
          return;
        }
        const pa = startPos(r.a, r.aEnd), pb = startPos(r.b, r.bEnd);
        const s = pa && pb ? pb[ax] - pa[ax] : 0;
        if (Math.abs(s) < 1e-9) { refuse(i, `the two points start level in ${r.k === 'distanceX' ? 'x' : 'y'}, so the side (sign) of the signed ${r.k} ${v} is not carried by the starting geometry`); return; }
        if (Math.sign(s) !== Math.sign(v)) { refuse(i, `is the SIGNED ${r.k} ${v} (brep-rs) but the points start ${s > 0 ? 'positive' : 'negative'}; solidcraft's ${r.k === 'distanceX' ? 'horizontal' : 'vertical'} dimension is |d| and keeps the starting side, so the sign cannot be requested`); return; }
        emit(i, 'sketch.dimension', { entities: [a, b], type: r.k === 'distanceX' ? 'horizontal' : 'vertical', value: Math.abs(v), ...dimBase(r) });
        return;
      }
      case 'radius': case 'diameter': {
        const v = value(i, r); if (v === null) return;
        if (!(v > 0)) { refuse(i, `has value ${v}; a radius or diameter must be positive`); return; }
        const c = curve(i, r.a, { only: ['circle', 'arc'] });
        if (c) emit(i, 'sketch.dimension', { entities: [c], type: r.k, value: v, ...dimBase(r) });
        return;
      }
      case 'angle': {
        const v = value(i, r); if (v === null) return;
        const ga = geomOf(r.a) as LineGeom | undefined, gb = geomOf(r.b) as LineGeom | undefined; // curve() below refuses non-lines
        const a = curve(i, r.a, { only: ['line'] }), b = curve(i, r.b, { only: ['line'] });
        if (!a || !b || !ga || !gb) return;
        // Simulate the engine's own reading choice from the start state, then express the constraint it will hold in OUR terms.
        const da = sub(ga.b, ga.a), db = sub(gb.b, gb.a);
        if (len(da) < 1e-12 || len(db) < 1e-12) { refuse(i, `has a zero-length line at the start; the angle between it and another is undefined`); return; }
        const toDeg = (x: number) => (x * 180) / Math.PI;
        let ang = Math.atan2(cross(da, db), dot(da, db));
        let swapped = false;
        if (ang < 0) { ang = -ang; swapped = true; }
        const direct = { value: ang, swapped, flip: false };
        const supp = { value: Math.PI - ang, swapped: !swapped, flip: true };
        let [cur, alt] = ang <= Math.PI / 2 ? [direct, supp] : [supp, direct];
        const want = (v * Math.PI) / 180;
        if (Math.abs(want - alt.value) < Math.abs(want - cur.value)) cur = alt;
        const eff = cur.swapped ? -want : want; // a->b, radians, mod pi
        const effDeg = (((toDeg(eff) % 180) + 180) % 180);
        const wantDeg = (((v % 180) + 180) % 180);
        const dd = Math.min(Math.abs(effDeg - wantDeg), 180 - Math.abs(effDeg - wantDeg));
        if (dd > 1e-6) { refuse(i, `is the directed angle ${v} deg from line ${r.a} to line ${r.b}; from this starting geometry solidcraft would apply the value to the opposite orientation (it would hold ${effDeg.toFixed(6)} deg from ${r.a} to ${r.b}); its angle dimension is undirected and takes its orientation from the start state`); return; }
        if (r.quadrant) notes.push(`rule ${i} (angle quadrant ${r.quadrant}): brep-rs's quadrant never enters its residual either; orientation carried by the starting geometry`);
        emit(i, 'sketch.dimension', { entities: [a, b], type: 'angle', value: `${v} deg`, ...dimBase(r) });
        return;
      }
      case 'lock': {
        if (r.driving === false) { refuse(i, `a lock cannot be a reference measurement`); return; }
        const p = pt(i, r.a, r.aEnd, { lock: true });
        if (p) emit(i, 'sketch.constraint.fix', { entity: p, fixed: true });
        return;
      }
      default:
        refuse(i, `kind '${(r as { k: string }).k}' is not in the soup vocabulary this mapper knows`);
    }
  });

  if (refusals.length) return { ok: false, refusals, names, notes };
  return { ok: true, commands, names, ruleMap, notes, sketchName: name, frame: fr };
}

/** the full command list for a built sketch: finish + extrude (one-sided along the sketch normal, the doc's extrude). */
export function extrudeCommands(mapped: { commands: Cmd[]; sketchName: string }, { height, body = 'Body1' }: { height: number; body?: string }): Cmd[] {
  return [...mapped.commands, { command: '@sketch', params: {} }, { command: 'sketch.finish', params: {} },
    { command: 'solid.extrude', params: { distance: height, sketch: mapped.sketchName, operation: 'new', body_name: body } }];
}

/**
 * Which of the engine's profiles our doc means: the even-odd fill of the doc's own loops. A face is solid when an interior
 * point of it lies inside an ODD number of the doc's closed loops. Construction geometry is not a loop.
 */
export function docProfileIndices(profileList: Array<{ interior: V2 }>, geoms: SoupGeom[]): number[] {
  const segs: Array<[number, V2, V2]> = []; // [loopKey, [x0,y0], [x1,y1]]
  type LiveGeom = Exclude<SoupGeom, { k: 'point' }>;
  const live = geoms.filter((g): g is LiveGeom => !g.construction && g.k !== 'point');
  const parent = live.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = (g: LiveGeom): V2[] => (g.k === 'line' || g.k === 'arc' ? [g.a, g.b] : []);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    if (ends(live[i]).some((p) => ends(live[j]).some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6))) parent[find(i)] = find(j);
  }
  const arcPts = (g: ArcGeom, n = 96): V2[] => {
    const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
    const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
    const TAU = Math.PI * 2;
    let sw = (((a1 - a0) % TAU) + TAU) % TAU;
    if (g.sense === 'cw') sw = sw === 0 ? -TAU : sw - TAU;
    const r = Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]);
    return Array.from({ length: n + 1 }, (_, k) => [g.c[0] + r * Math.cos(a0 + (sw * k) / n), g.c[1] + r * Math.sin(a0 + (sw * k) / n)]);
  };
  live.forEach((g, i) => {
    const key = find(i);
    let pts: V2[];
    if (g.k === 'line') pts = [g.a, g.b];
    else if (g.k === 'arc') pts = arcPts(g);
    else pts = Array.from({ length: 97 }, (_, k) => [g.c[0] + g.r * Math.cos((2 * Math.PI * k) / 96), g.c[1] + g.r * Math.sin((2 * Math.PI * k) / 96)]);
    for (let k = 0; k + 1 < pts.length; k++) segs.push([key, pts[k], pts[k + 1]]);
  });
  const inside = (pt: V2, key: number) => {
    let c = false;
    for (const [k, p, q] of segs) {
      if (k !== key) continue;
      if ((p[1] > pt[1]) !== (q[1] > pt[1]) && pt[0] < ((q[0] - p[0]) * (pt[1] - p[1])) / (q[1] - p[1]) + p[0]) c = !c;
    }
    return c;
  };
  const keys = [...new Set(segs.map((s) => s[0]))];
  return profileList.map((p, i) => ({ i, d: keys.filter((k) => inside(p.interior, k)).length })).filter((x) => x.d % 2 === 1).map((x) => x.i);
}

export type { SketchFeature };
