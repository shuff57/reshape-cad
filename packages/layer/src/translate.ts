// TypeScript port of docs/spikes/solidcraft-referee/phase7/pane/lib/translate-p4.mjs (the phase 4 base translator).
// Behaviour-preserving: same command lists, same refusal sentences, same numbers. Not a rewrite: planFeature's per-kind
// logic is the original's, line for line.
//
// ModelDoc -> engine command JSON, executed PER FEATURE on fresh sessions (prefix 1..k).
//
// Refusal contract (AGENTS.md): a feature that cannot be mapped, or that the engine refuses, is refused in a plain
// sentence alongside whatever DID build; a feature that depends on a refused or already-consumed feature is refused
// with a pointer to it. Nothing here falls back to another engine. No kernel is named here: everything that touches an
// engine comes in through the context object (ctx.runSC, ctx.topologyOf, ctx.arc, ctx.mt).
//
// Non-null assertions (`!`) below stand for fields that the feature's `kind` guarantees on a well-formed doc. The original
// reads them unguarded, so a malformed doc throws the same TypeError, which translateDoc turns into a refusal sentence.
import type { Feature, SketchFeature } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type { Cmd, Frame, MtApi, RunResult, TopologyReply, TranslateCtx, TopoBody, V3 } from './types.js';
import { mapSketch } from './sketch-map.js';
import { resolveName, pickPoint } from './resolve-names.js';
import type { Evidence, Resolved, ResolveEnv, ShapeResult, FaceRes, EdgeRes } from './resolve-names.js';

export const FEATURE_KINDS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge', 'sketch', 'datum', 'extrude', 'combine',
  'blend', 'revolve', 'groove', 'pocket', 'mirror', 'pattern', 'hole', 'shell', 'move', 'rotate', 'fillet', 'draft'];

const AX: Record<string, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXN: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' };
const len = (a: V3) => Math.hypot(...a);
const isZero3 = (v: V3 | undefined | null) => !v || (v[0] === 0 && v[1] === 0 && v[2] === 0);
const bname = (id: string) => `b_${id}`;

/** named-plane frame, identical to model-types.ts NAMED_PLANE_FRAMES / sketchFrameOf (copied, as in the original). */
const NAMED = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};
function frameOf(s: SketchFeature, mt?: MtApi): Frame {
  if (mt && mt.sketchFrameOf) return mt.sketchFrameOf(s);
  if (s.frame) {
    const { origin, u, v } = s.frame;
    return { origin, u, v, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
  }
  const a = NAMED[s.plane ?? 'xy'] ?? NAMED.xy;
  const o = s.offset ?? 0;
  return { origin: a.n.map((c) => c * o), ...a };
}

export interface Refusal { refusal: string }
export const refuse = (sentence: string): Refusal => ({ refusal: sentence });
export { frameOf as frameWithMt, isZero3 };

// ---- planner types -------------------------------------------------------------------------------------------------
export interface TranslateState {
  head: Record<string, string>;
  bodies: Record<string, string[]>;
  stale: Record<string, string>;
  refused: Record<string, string>;
  sketches: Record<string, SketchFeature>;
  measure: Record<string, Aggregate>;
  counter: number;
  accLen: Record<string, number>;
  /** extrude-pocket profile only: the bodies of the scene after the last accepted feature, and the bodies made from a slanted round pull. */
  scene?: SceneEntry[];
  curvedSlant?: Set<string>;
  /** holes profile only: the guard bookkeeping of the holes group (hole chains, body count, CPU seconds spent). See holes.ts. */
  holes?: HolesState;
  /** shell-draft profile only: the closed hollows of the shell-draft group. See shell-draft.ts. */
  shellDraft?: { voided: Record<string, true> };
}
export interface HolesState {
  chain: Record<string, { baseIdx: number; baseMeasure: Aggregate | undefined }>;
  allCount: number;
  spentS: number;
  lastRunS: number;
}
export interface SceneEntry { name: string; vol: number; bbox: number[]; shells: number }
export interface Aggregate {
  volume: number;
  faces: number;
  kernelFaces: number;
  /** extrude-pocket profile only. */
  shells?: number;
  curved: boolean;
  bbox: number[];
  faceTypes: Record<string, number>;
  com: number[];
  bodies: string[];
}
export interface PlanCtx extends TranslateCtx {
  resolve(name: unknown): Resolved | null;
}
/** What a feature's after-the-build check gets: the measure of what it built, the accepted commands so far and a way to re-run them. */
export interface VerifyEnv { accepted: Cmd[]; variant: Cmd[]; runSC: TranslateCtx['runSC']; checks: unknown[]; scene: SceneEntry[] }
export type Verify = (m: Aggregate, env: VerifyEnv) => Promise<string | null>;
export type Plan =
  | Refusal
  | { noop: true; stage?: true }
  | { variants: Cmd[][]; produces: string[]; consumes: string[]; pickedFrom?: string; evidence?: Evidence; flagCurvedSlant?: boolean; verify?: Verify };

/** What a per-kind planner is handed besides the feature, the state and the context. */
export interface PlanHelpers {
  name: string;
  needBody(id: string): string[] | null;
  headOf(id: string): string;
  dep(id: string, role?: string): string | null;
  inSketch(sk: SketchFeature, opts?: { revolve?: boolean; allowSoup?: boolean }): InSketch;
}
export type Planner = (f: Feature, st: TranslateState, ctx: PlanCtx, h: PlanHelpers) => Plan;

/**
 * The planner seam. A profile is the set of planners (a registry from feature kind to planner; a kind it does not list falls through
 * to the base planner in planFeature's switch) plus the few wordings and bookkeeping hooks a group changes. BASE_PROFILE reproduces the
 * phase 4 base translator exactly; groups add their own in their own file (extrude-pocket.ts) and are selected by createTranslator.
 */
export interface Profile {
  name: string;
  planners: Partial<Record<string, Planner>>;
  /** true: split-off pieces and shells are counted in the measure, scene is tracked, plan.verify runs, notes carry `checks`. */
  verifies: boolean;
  initState(st: TranslateState): void;
  depSentence(f: Feature, role: string, headId: string, st: TranslateState): string | null;
  noOutline(sk: SketchFeature, o: { points?: number[][]; notes?: string[] }): string;
  plannerError(f: Feature, e: unknown): { refusal: string; internal: string | null };
  kernelRefusal(f: Feature, raw: string | null): string;
  /**
   * Optional: bookkeeping that every accepted feature triggers, whichever profile owns its kind (the extrude-pocket scene, the holes body
   * count). `plan` is the plan of a feature run by the generic loop, null when a profile's own step accepted it.
   */
  onAccepted?(st: TranslateState, res: RunResult, m: Aggregate, plan: Plan | null): void;
  /** Optional: extra fields of the translateDoc result (the holes set reports the CPU seconds it spent as `spentS`). */
  result?(st: TranslateState): Partial<TranslateResult>;
  /**
   * Optional: a profile that runs the whole per-feature step itself (plan, run, post-check, note) instead of the generic loop. The holes set
   * does: its loop differs from the generic one in the budget, the post-checks, the note fields and the sentence for an engine failure.
   */
  step?(f: Feature, idx: number, env: LoopEnv): Promise<void>;
  /** Composition (composeProfiles): the member profiles in order, and the owner of a feature kind. Absent on a single profile. */
  members?: Profile[];
  owner?(kind: string): Profile;
}
/** What a profile's own step gets: the loop's mutable state. */
export interface LoopEnv {
  doc: { features: Feature[] };
  ctx: TranslateCtx;
  st: TranslateState;
  accepted: Cmd[];
  out: FeatureResult[];
  shapeCache: ShapeCache;
  /** the whole profile (the composition, when there is one) */
  profile: Profile;
}
/** The member profiles of a profile (itself, when it is not a composition). */
export const membersOf = (p: Profile): Profile[] => p.members ?? [p];
/** The profile that decides everything about a feature of this kind. */
export const ownerOf = (p: Profile, kind: string): Profile => (p.owner ? p.owner(kind) : p);

/**
 * Compose planner sets. Later entries override earlier ones per feature KIND: the owner of a kind is the last profile that lists a planner
 * for it; every kind no profile lists belongs to the FIRST profile. Everything that decides a feature's own result (its planner, dependency
 * sentence, planner-error and kernel-refusal wording, how its measure is aggregated, whether it is verified, its note, and a profile's own
 * step) is taken from the owner of the feature's kind. Bookkeeping hooks (initState, onAccepted) run for EVERY member on every accepted
 * feature, so the extrude-pocket scene stays current when a hole was accepted and the holes body count stays current when a pocket was.
 * The sketch 'no usable outline' sentence is decided by the owner of the feature that maps the sketch.
 */
export function composeProfiles(list: Profile[]): Profile {
  if (!list.length) throw new Error('composeProfiles needs at least one planner set');
  if (list.length === 1) return list[0];
  const first = list[0];
  const owners = new Map<string, Profile>();
  for (const p of list) for (const k of Object.keys(p.planners)) owners.set(k, p);
  const owner = (kind: string): Profile => owners.get(kind) ?? first;
  return {
    name: list.map((p) => p.name).join('+'),
    planners: Object.assign({}, ...list.map((p) => p.planners)) as Profile['planners'],
    verifies: first.verifies,
    initState: (st) => { for (const p of list) p.initState(st); },
    depSentence: (f, role, id, st) => owner(f.kind).depSentence(f, role, id, st),
    noOutline: (sk, o) => first.noOutline(sk, o),
    plannerError: (f, e) => owner(f.kind).plannerError(f, e),
    kernelRefusal: (f, raw) => owner(f.kind).kernelRefusal(f, raw),
    onAccepted: (st, res, m, plan) => { for (const p of list) p.onAccepted?.(st, res, m, plan); },
    result: (st) => Object.assign({}, ...list.map((p) => p.result?.(st) ?? {})) as Partial<TranslateResult>,
    members: list,
    owner,
  };
}
export const BASE_PROFILE: Profile = {
  name: 'base',
  planners: {},
  verifies: false,
  initState: () => {},
  depSentence(f, role, id, st) {
    if (st.refused[id]) return `${f.id} (${f.kind}): its ${role} ${id} was refused (${st.refused[id]})`;
    if (st.stale[id]) return `${f.id} (${f.kind}): its ${role} ${id} was already changed in place by ${st.stale[id]}, and a solidcraft command list has no second copy of it`;
    return null;
  },
  noOutline: (sk, o) => `sketch ${sk.id} has no usable outline (${(o.notes ?? []).join('; ') || 'outlineOf refused it'})`,
  plannerError: (f, e) => ({ refusal: `${f.id} (${f.kind}): translator error: ${(e as Error).message}`, internal: null }),
  kernelRefusal: (f, raw) => `${f.id} (${f.kind}): solidcraft refused it -- ${raw}`,
};

/** Primitive fields as the original reads them (loose: a stray field on any kind reads as in the original). */
interface PrimView {
  id: string;
  kind: string;
  size?: V3;
  radius?: number;
  height?: number;
  center?: V3;
  rotate?: V3;
  round?: number;
  roundStyle?: string;
  ringRadius?: number;
  tubeRadius?: number;
  sides?: number;
  width?: number;
  depth?: number;
}

/** Sketch outline -> sketch.* commands (inside an open sketch). Returns {cmds} or {refusal}. */
export const isSoup = (sk: SketchFeature) => sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function profileCmds(sk: SketchFeature, ctx: TranslateCtx, profile: Profile): Refusal | { cmds: Cmd[] } {
  if (isSoup(sk)) return refuse(`sketch ${sk.id} is drawn as rows and rules (a soup); it is mapped by inSketch, not here`);
  const o = ctx.arc.outlineOf(sk);
  if (!o.ok) return refuse(profile.noOutline(sk, o));
  if (sk.shape === 'circle') {
    const [a, b] = o.points;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { cmds: [{ command: 'sketch.circle.center', params: { center: c, diameter: Math.hypot(b[0] - a[0], b[1] - a[1]) } }] };
  }
  const pts = o.points;
  const bulges = o.bulges ?? {};
  if (!Object.values(bulges).some((g) => g)) {
    return { cmds: [{ command: 'sketch.line', params: { points: pts.map((p) => [p[0], p[1]]), closed: true } }] };
  }
  const cmds: Cmd[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const g = bulges[i];
    if (!g) { cmds.push({ command: 'sketch.line', params: { points: [a, b] } }); continue; }
    // same arc construction as occt-build.ts sketchWire: a point on the arc halfway round
    const { center, radius, startAngle, endAngle } = ctx.arc.arcFromBulge(a, b, g);
    let sweep = endAngle - startAngle;
    if (g > 0 && sweep < 0) sweep += Math.PI * 2;
    if (g < 0 && sweep > 0) sweep -= Math.PI * 2;
    const mid = startAngle + sweep / 2;
    cmds.push({ command: 'sketch.arc.three_point', params: { start: a, end: b, through: [center[0] + radius * Math.cos(mid), center[1] + radius * Math.sin(mid)] } });
  }
  return { cmds };
}

export type InSketch = Refusal | { name: string; soup?: true; cmds: Cmd[] };
export function inSketch(sk: SketchFeature, ctx: TranslateCtx, st: TranslateState, { revolve = false, allowSoup = true } = {}, profile: Profile = BASE_PROFILE): InSketch {
  if (isSoup(sk)) {
    if (revolve || !allowSoup) return refuse(`sketch ${sk.id} is a constrained sketch (rows and rules); this demo maps those for extrude and pocket only, not for revolve, groove or blend`);
    const name = `sk_${sk.id}_${st.counter++}`;
    const m = mapSketch(sk, { name });
    if (!m.ok) return refuse(`sketch ${sk.id} cannot be handed to solidcraft's solver: ${m.refusals.map((r) => `rule ${r.rule + 1}${r.kind ? ` (${r.kind})` : ''}: ${r.sentence}`).join('; ')}`);
    if (ctx.soups) ctx.soups[name] = { sketchId: sk.id, geoms: sk.geoms, rules: sk.rules ?? [], names: m.names, notes: m.notes ?? [], ruleMap: m.ruleMap };
    return { name, soup: true, cmds: [...m.commands, { command: 'sketch.finish', params: {} }] };
  }
  const fr = frameOf(sk, ctx.mt);
  const prof = profileCmds(sk, ctx, profile);
  if ('refusal' in prof) return prof;
  const name = `sk_${sk.id}_${st.counter++}`;
  return {
    name,
    cmds: [
      { command: 'sketch.create', params: { name, plane: { origin: fr.origin, x_dir: fr.u, y_dir: revolve ? fr.n : fr.v } } },
      ...prof.cmds,
      { command: 'sketch.finish', params: {} },
    ],
  };
}

const rotCmds = (name: string, rotate: V3): Cmd[] => {
  const out: Cmd[] = [];
  if (isZero3(rotate)) return out;
  ['x', 'y', 'z'].forEach((a, i) => { if (rotate[i]) out.push({ command: 'solid.move', params: { bodies: [name], axis: AX[a], angle: rotate[i] } }); });
  return out;
};
const moveCmd = (name: string, t: V3): Cmd => ({ command: 'solid.move', params: { bodies: [name], translate: t } });

/** Edge points for a primitive's whole-shape `round`: box = 12 edge midpoints, cylinder = the two rim circles. */
function roundPoints(f: PrimView, base: V3): V3[] {
  if (f.kind === 'box') {
    const [w, d, h] = f.size!.map((v) => v / 2);
    const c = base;
    const p: V3[] = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0], c[1] + sy * d, c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0] + sx * w, c[1], c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.push([c[0] + sx * w, c[1] + sy * d, c[2]]);
    return p;
  }
  return [[base[0] + f.radius!, base[1], base[2] + f.height! / 2], [base[0] + f.radius!, base[1], base[2] - f.height! / 2]];
}

/** Plan one feature. Returns {refusal} | {variants:[cmds...], produces:[names], consumes:[ids]} | {noop:true}. */
export function planFeature(f: Feature, st: TranslateState, ctx: PlanCtx, profileIn: Profile = BASE_PROFILE): Plan {
  const profile = ownerOf(profileIn, f.kind); // a composition: the profile that owns this kind decides
  const name = bname(f.id);
  const needBody = (id: string): string[] | null => {
    const bs = st.bodies[headOf(id)];
    return bs && bs.length ? bs : null;
  };
  // occt-build advanceHead: a hole / pocket / groove leaves its target's id pointing at the NEWEST cut, so a second bore
  // on the same target stacks on the first instead of starting over.
  const headOf = (id: string): string => { let h = id; const seen = new Set<string>(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
  const dep = (id: string, role = 'target'): string | null => {
    id = headOf(id);
    return profile.depSentence(f, role, id, st);
  };
  const planner = profile.planners[f.kind];
  if (planner) return planner(f, st, ctx, { name, needBody, headOf, dep, inSketch: (sk, opts) => inSketch(sk, ctx, st, opts, profile) });
  switch (f.kind) {
    case 'box': case 'cylinder': case 'sphere': case 'torus': case 'cone': case 'prism': case 'wedge': {
      const p = f as unknown as PrimView;
      const rot = !isZero3(p.rotate);
      const c = p.center ?? [0, 0, 0];
      const at = rot ? [0, 0, 0] : c; // rotation is about the ORIGIN, so a rotated primitive is built at the origin first
      const cmds: Cmd[] = [];
      if (p.kind === 'box') {
        cmds.push({ command: 'solid.box', params: { length: p.size![0], width: p.size![1], height: p.size![2], center: at, body_name: name } });
      } else if (p.kind === 'cylinder') {
        cmds.push({ command: 'solid.cylinder', params: { radius: p.radius, height: p.height, base: [at[0], at[1], at[2] - p.height! / 2], axis: 'Z', body_name: name } });
      } else if (p.kind === 'sphere') {
        cmds.push({ command: 'solid.sphere', params: { radius: p.radius, center: at, body_name: name } });
      } else if (p.kind === 'torus') {
        cmds.push({ command: 'solid.torus', params: { major: p.ringRadius, minor: p.tubeRadius, center: at, body_name: name } });
      } else if (p.kind === 'cone') {
        // no solid.cone: spin the right triangle (0,0)-(r,0)-(0,h) about the sketch y axis, as occt-build coneOf does
        const nm = `sk_${p.id}_${st.counter++}`;
        cmds.push(
          { command: 'sketch.create', params: { name: nm, plane: { origin: [at[0], at[1], at[2] - p.height! / 2], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
          { command: 'sketch.line', params: { points: [[0, 0], [p.radius, 0], [0, p.height]], closed: true } },
          { command: 'sketch.finish', params: {} },
          { command: 'solid.revolve', params: { axis: 'y', sketch: nm, operation: 'new', body_name: name } },
        );
      } else {
        const poly = p.kind === 'prism'
          ? (() => { const n = Math.max(3, Math.min(12, Math.round(p.sides!))); return Array.from({ length: n }, (_, i) => [p.radius! * Math.cos(2 * Math.PI * i / n), p.radius! * Math.sin(2 * Math.PI * i / n)]); })()
          : [[-p.width! / 2, -p.depth! / 2], [p.width! / 2, -p.depth! / 2], [-p.width! / 2, p.depth! / 2]];
        const nm = `sk_${p.id}_${st.counter++}`;
        cmds.push(
          { command: 'sketch.create', params: { name: nm, plane: { origin: [at[0], at[1], at[2] - p.height! / 2], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } },
          { command: 'sketch.line', params: { points: poly, closed: true } },
          { command: 'sketch.finish', params: {} },
          { command: 'solid.extrude', params: { distance: p.height, sketch: nm, operation: 'new', body_name: name } },
        );
      }
      if (p.round) {
        if (p.kind !== 'box' && p.kind !== 'cylinder') return refuse(`${p.id} (${p.kind}): a whole-shape round is only mapped for box and cylinder`);
        const pts = roundPoints(p, at);
        cmds.push(p.roundStyle === 'chamfer'
          ? { command: 'solid.chamfer', params: { edges: pts, distance: p.round, body: name } }
          : { command: 'solid.fillet', params: { edges: pts, radius: p.round, body: name } });
      }
      if (rot) { cmds.push(...rotCmds(name, p.rotate!)); if (!isZero3(c)) cmds.push(moveCmd(name, c)); }
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case 'datum':
      return { noop: true };
    case 'sketch':
      return { noop: true, stage: true };
    case 'extrude': {
      const d = dep(f.target, 'sketch');
      if (d) return refuse(d);
      for (const k of ['midplane', 'length2', 'reversed', 'taper', 'direction', 'alongNormal']) {
        if ((f as unknown as Record<string, unknown>)[k]) return refuse(`${f.id} (extrude): the ${k} option is not mapped in phase 0 (only a plain one-sided extrude along the sketch normal is)`);
      }
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (extrude): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st, undefined, profile);
      if ('refusal' in s) return refuse(`${f.id} (extrude): ${s.refusal}`);
      return { variants: [[...s.cmds, { command: 'solid.extrude', params: { distance: f.height, sketch: s.name, operation: 'new', body_name: name } }]], produces: [name], consumes: [] };
    }
    case 'revolve': case 'groove': {
      const d = dep(f.target, 'sketch') || (f.kind === 'groove' ? dep(f.into, 'solid') : null);
      if (d) return refuse(d);
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (${f.kind}): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st, { revolve: true }, profile);
      if ('refusal' in s) return refuse(`${f.id} (${f.kind}): ${s.refusal}`);
      const params: Record<string, unknown> = { axis: 'y', sketch: s.name };
      if (f.angle !== 360) params.angle = -f.angle;
      if (f.kind === 'revolve') return { variants: [[...s.cmds, { command: 'solid.revolve', params: { ...params, operation: 'new', body_name: name } }]], produces: [name], consumes: [] };
      const bs = needBody(f.into);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (groove): ${f.into} is not a single body`);
      return { variants: [[...s.cmds, { command: 'solid.revolve', params: { ...params, operation: 'cut', targets: bs } }]], produces: bs, consumes: [f.into] };
    }
    case 'pocket': {
      const d = dep(f.target, 'sketch') || dep(f.into, 'solid');
      if (d) return refuse(d);
      const sk = st.sketches[f.target];
      const bs = needBody(f.into);
      if (!sk || !bs || bs.length !== 1) return refuse(`${f.id} (pocket): needs a sketch and a single body`);
      const s = inSketch(sk, ctx, st, undefined, profile);
      if ('refusal' in s) return refuse(`${f.id} (pocket): ${s.refusal}`);
      // pocket pushes OPPOSITE the sweep direction (occt-build: h = -depth * dir), i.e. direction negative on a u x v frame
      return { variants: [[...s.cmds, { command: 'solid.extrude', params: { distance: f.depth, direction: 'negative', sketch: s.name, operation: 'cut', targets: bs } }]], produces: bs, consumes: [f.into] };
    }
    case 'blend': {
      const ds = f.targets.map((t) => dep(t, 'sketch')).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (blend): needs two or more sketches`);
      const cmds: Cmd[] = []; const names: string[] = [];
      for (const t of f.targets) {
        const sk = st.sketches[t];
        if (!sk) return refuse(`${f.id} (blend): ${t} is not a sketch`);
        const s = inSketch(sk, ctx, st, { allowSoup: false }, profile);
        if ('refusal' in s) return refuse(`${f.id} (blend): ${s.refusal}`);
        cmds.push(...s.cmds); names.push(s.name);
      }
      cmds.push({ command: 'solid.loft', params: { sections: names.map((n) => ({ sketch: n })), operation: 'new', body_name: name } });
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case 'combine': {
      const ds = f.targets.map((t) => dep(t)).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (combine): needs two or more targets`);
      const all = f.targets.map((t) => needBody(t));
      if (all.some((b) => !b || b.length !== 1)) return refuse(`${f.id} (combine): every target must be a single body`);
      const op = f.op === 'union' ? 'join' : f.op === 'subtract' ? 'cut' : 'intersect';
      const names = all.map((b) => b![0]);
      return {
        variants: [[{ command: 'solid.combine', params: { target: names[0], tools: names.slice(1), operation: op } }]],
        produces: [names[0]], consumes: f.targets,
      };
    }
    case 'move': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.copy) return refuse(`${f.id} (move): a copying move is not mapped (solidcraft names the copy itself, and phase 0 does not track it)`);
      const bs = needBody(f.target);
      return { variants: [[{ command: 'solid.move', params: { bodies: bs, translate: f.offset } }]], produces: bs!, consumes: [f.target] };
    }
    case 'rotate': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!m) return refuse(`${f.id} (rotate): no measured bounding box for ${f.target}`);
      const c = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cmds: Cmd[] = [];
      if (!isZero3(c)) cmds.push({ command: 'solid.move', params: { bodies: bs, translate: c.map((v) => -v) } });
      ['x', 'y', 'z'].forEach((a, i) => { if (f.angles[i]) cmds.push({ command: 'solid.move', params: { bodies: bs, axis: AX[a], angle: f.angles[i] } }); });
      if (!isZero3(c)) cmds.push({ command: 'solid.move', params: { bodies: bs, translate: c } });
      return { variants: [cmds], produces: bs!, consumes: [f.target] };
    }
    case 'mirror': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!m) return refuse(`${f.id} (mirror): no measured bounding box for ${f.target}`);
      const axis = f.plane === 'yz' ? 0 : f.plane === 'xz' ? 1 : 2;
      const lo = m.bbox[axis]; const hi = m.bbox[axis + 3];
      const at = Math.abs(lo) <= Math.abs(hi) ? lo : hi; // occt-build: through the part's nearer face on this axis
      const origin = [0, 0, 0]; origin[axis] = at;
      const normal = [0, 0, 0]; normal[axis] = 1;
      return { variants: [[{ command: 'solid.mirror', params: { bodies: bs, plane: { origin, normal }, combine: true } }]], produces: bs!, consumes: [f.target] };
    }
    case 'pattern': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (pattern): needs a single target body`);
      if (f.count < 2) return refuse(`${f.id} (pattern): a count under 2 is the original alone; not mapped`);
      const copies = [bs[0], ...Array.from({ length: f.count - 1 }, (_, i) => `${bs[0]} (${i + 2})`)];
      let pat: Cmd;
      if (f.mode === 'circular') {
        if ((f.totalAngle ?? 360) !== 360) return refuse(`${f.id} (pattern): a circular pattern over less than 360 degrees is not mapped (solidcraft's angle semantics were not verified)`);
        pat = { command: 'solid.pattern.circular', params: { bodies: bs, axis: AXN[f.axis ?? 'z'], count: f.count } };
      } else {
        const s: V3 = f.step ?? [0, 0, 0];
        if (isZero3(s)) return refuse(`${f.id} (pattern): a zero step puts every copy on the original`);
        const L = len(s);
        pat = { command: 'solid.pattern.rectangular', params: { bodies: bs, dir1: s.map((v) => v / L), count1: f.count, spacing1: L } };
      }
      // OCCT fuses the instances. Try to join them; if the engine cannot (disjoint copies), keep them as separate bodies.
      const join: Cmd = { command: 'solid.combine', params: { target: copies[0], tools: copies.slice(1), operation: 'join' } };
      return { variants: [[pat, join], [pat]], produces: copies, consumes: [f.target] };
    }
    case 'hole': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.counterbore || f.countersink) return refuse(`${f.id} (hole): counterbore and countersink are not mapped in phase 0`);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!bs || bs.length !== 1 || !m) return refuse(`${f.id} (hole): needs a single measured target body`);
      const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cx = bc[0] + f.center[0]; const cy = bc[1] + f.center[1]; const cz = bc[2] + f.center[2];
      const centers = f.corners
        ? [[cx - f.corners.dx, cy - f.corners.dy, cz], [cx + f.corners.dx, cy - f.corners.dy, cz], [cx - f.corners.dx, cy + f.corners.dy, cz], [cx + f.corners.dx, cy + f.corners.dy, cz]]
        : [[cx, cy, cz]];
      const dir = AX[f.axis ?? 'z'];
      const cmds: Cmd[] = centers.map((c) => ({
        command: 'solid.cylinder',
        params: { radius: f.diameter / 2, height: f.depth, base: c.map((v, i) => v - dir[i] * f.depth / 2), axis: AXN[f.axis ?? 'z'], operation: 'cut', targets: bs },
      }));
      return { variants: [cmds], produces: bs, consumes: [f.target] };
    }
    case 'shell': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (shell): needs a single target body`);
      if (!f.open) return refuse(`${f.id} (shell): this spike's shell needs a face to remove; a closed hollow box is not mapped`);
      const r = ctx.resolve(f.open);
      if (r && r.ok === false) return refuse(`${f.id} (shell): ${r.sentence}`);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (shell): the opened face could not be resolved to a single face (${r ? `it names ${r.kind}` : 'no resolution'})`);
      return { variants: [[{ command: 'solid.shell', params: { faces: [r.point], thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target], pickedFrom: 'solidcraft topology (browser)', evidence: r.evidence };
    }
    case 'fillet': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (fillet): needs a single target body`);
      const r = ctx.resolve(f.edge);
      if (r && r.ok === false) return refuse(`${f.id} (${f.kind}): ${r.sentence}`);
      if (!r || r.kind !== 'edge') return refuse(`${f.id} (fillet): the edge could not be resolved to a single edge (${r ? `it names ${r.kind}` : 'no resolution'})`);
      // phase 4: the resolved point is ON the edge (the engine's own edge midpoint), so there is exactly one candidate.
      const cands = [r.point];
      const mk = (p: V3): Cmd => (f.style === 'chamfer'
        ? { command: 'solid.chamfer', params: { edges: [p], distance: f.size, body: bs[0] } }
        : { command: 'solid.fillet', params: { edges: [p], radius: f.size, body: bs[0] } });
      return { variants: cands.map((p) => [mk(p)]), produces: bs, consumes: [f.target], pickedFrom: 'solidcraft topology (browser)', evidence: r.evidence };
    }
    case 'draft': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.whole || !f.face) return refuse(`${f.id} (draft): a whole-body draft is not mapped (needs a face pick per face)`);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (draft): needs a single target body`);
      const r = ctx.resolve(f.face);
      if (r && r.ok === false) return refuse(`${f.id} (draft): ${r.sentence}`);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (draft): the face could not be resolved to a single face (${r ? `it names ${r.kind}` : 'no resolution'})`);
      const ax = AX[f.pull ?? 'z'];
      return {
        variants: [[{ command: 'solid.draft', params: { faces: [r.point], angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }]],
        produces: bs, consumes: [f.target], pickedFrom: 'solidcraft topology (browser)', evidence: r.evidence,
      };
    }
    default: {
      const u = f as { id: string; kind: string }; // narrowed to never; a malformed doc can carry any kind
      return refuse(`${u.id}: feature kind '${u.kind}' is not in the ModelDoc vocabulary this translator knows`);
    }
  }
}

/** A body belongs to a feature when it is one of the names it produced or a piece solidcraft split off one of them ("name (2)"). (extrude-pocket profile) */
const isPiece = (bodyName: string, names: string[]) => names.some((n) => bodyName === n || (bodyName.startsWith(`${n} (`) && /^ \(\d+\)$/.test(bodyName.slice(n.length))));

/** Aggregate the named bodies of a successful run into one measure (sum volume/faces, union bbox). With `pieces`, split-off pieces count and the shells are summed. */
function aggregate(res: RunResult, names: string[], pieces = false): Aggregate | null {
  const bs = res.measure!.bodies.filter((b) => (pieces ? isPiece(b.name, names) : names.includes(b.name)));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  return {
    volume: bs.reduce((s, b) => s + b.volume_mm3, 0),
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    ...(pieces ? { shells: bs.reduce((s, b) => s + (b.kernel.shells ?? 1), 0) } : {}),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a: Record<string, number>, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / bs.reduce((a, b) => a + b.volume_mm3, 0)),
    bodies: bs.map((b) => b.name),
  };
}

interface ConfirmArgs { st: TranslateState; accepted: Cmd[]; ctx: TranslateCtx; targetId: string }

/**
 * The name was resolved on the own shape of the feature it names; the pick lands on the TARGET body as it is now. Redo, ON THE
 * TARGET: the candidate count (every face coplanar with the named plane, or every edge matching), the engine's own pick-hit
 * test and the choice of an interior point. More than one candidate, or no safe point, is a refusal with the count.
 */
async function confirmOnTarget(rr: Resolved, { st, accepted, ctx, targetId }: ConfirmArgs): Promise<Resolved> {
  if (!rr.ok || rr.kind === 'faceset') return rr;
  const headId = (id: string): string => { let h = id; const seen = new Set<string>(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
  const tb = st.bodies[headId(targetId)];
  const nm = rr.evidence.name;
  if (!tb || tb.length !== 1) return { ok: false, sentence: `${nm} resolved on ${rr.shape.featureId}, but the target ${targetId} is ${tb ? tb.length : 0} bodies; a pick is made on a single body, so nothing is picked` };
  let cur: TopologyReply;
  // ctx.topologyOf may be absent when called from resolveAfter; the original then throws inside this try, and the message is kept.
  try { cur = await ctx.topologyOf!(accepted); } catch (e) { cur = { ok: false, error: (e as Error).message }; }
  const body: TopoBody | null | undefined = cur.ok && cur.topology ? cur.topology.bodies.find((b) => b.name === tb[0]) : null;
  if (!body || body.error) return { ok: false, sentence: `${nm} resolved, but solidcraft returned no topology for the target ${tb[0]}; nothing is picked` };
  let sc = 1;
  for (const e of body.edges) for (const q of [e.start, e.mid, e.end]) for (const v of q) sc = Math.max(sc, Math.abs(v));
  for (const x of body.faces) for (const v of x.centroid) sc = Math.max(sc, Math.abs(v));
  const tol = 1e-6 * sc * 10;
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (rr.kind === 'edge') {
    const er: EdgeRes = rr;
    const per = er.edges.map((e) => body.edges.filter((q) => dist(q.mid, e.mid) <= tol && Math.abs(q.length - e.length) <= tol));
    const miss = per.filter((m) => m.length === 0).length;
    if (miss) return { ok: false, sentence: `${nm} resolves to ${er.evidence.engineEdges.join(', ')} on ${er.shape.featureId}, but ${miss === er.edges.length ? 'that edge is' : 'part of that edge is'} no longer present whole on ${tb[0]} (an operation after ${er.shape.featureId} changed or removed it); nothing is picked` };
    if (per.some((m) => m.length > 1)) return { ok: false, sentence: `${nm} matches more than one edge on ${tb[0]} (${per.flat().map((q) => q.name).join(', ')}); nothing is picked` };
    er.evidence.target = { body: tb[0], candidates: er.edges.length, edges: per.flat().map((q) => q.name), point: er.point };
    return er;
  }
  const fr: FaceRes = rr;
  if (!fr.plane) return { ok: false, sentence: `${nm} resolves to a curved face; a pick of a curved face on the target is not resolved in the browser demo` };
  const { n, d } = fr.plane;
  // same geometric plane. The OPPOSITE orientation counts only when the name's shape is not the target itself (a subtracted
  // tool's wall is a wall of the cavity with its normal flipped); on the target's own shape a face on the far side of a
  // slab with the opposite normal (the bottom of the part) is a different face.
  const allowFlip = fr.shape.featureId !== targetId && fr.shape.featureId !== headId(targetId);
  const on = body.faces.filter((x) => x.plane_normal && Math.abs(dot(x.centroid, n) - d) <= tol
    && (dot(x.plane_normal, n) >= 1 - 1e-6 || (allowFlip && dot(x.plane_normal, n) <= -1 + 1e-6)));
  if (on.length === 0) return { ok: false, sentence: `${nm} resolves on ${fr.shape.featureId}, but no face of ${tb[0]} lies on that plane any more; nothing is picked` };
  if (on.length > 1) return { ok: false, sentence: `${nm} matches ${on.length} faces on ${tb[0]} (${on.map((x) => x.name).join(', ')}; all on the named plane); a name must pick exactly one, so nothing is picked` };
  const p = pickPoint(on[0], Math.max(tol, 1e-4));
  if (!p.ok) return { ok: false, sentence: `${nm} resolves to ${on[0].name} on ${tb[0]} but there is no safe pick point: ${p.why}` };
  fr.point = p.point;
  fr.evidence.pickPoint = `target ${tb[0]}: ${p.source}`;
  fr.evidence.target = { body: tb[0], candidates: 1, face: on[0].name, faceIndex: on[0].index, point: p.point, pickSource: p.source, centroidHit: on[0].centroid_hit ?? null, innerHit: on[0].inner_hit ?? null };
  return fr;
}

export type ShapeCache = Map<string, { cmds: Cmd[]; r: TopologyReply }>;

/** The name-resolution environment: how to read the own shape of a feature that was built (see resolve-names). */
function makeEnv(st: TranslateState, accepted: Cmd[], prefix: Feature[], ctx: TranslateCtx, shapeCache: ShapeCache): ResolveEnv {
  return {
    features: prefix,
    sketchFrame: (sk) => frameOf(sk, ctx.mt),
    outline: (sk) => ctx.arc.outlineOf(sk),
    shapeOf: async (fid): Promise<ShapeResult> => {
      if (st.accLen[fid] === undefined) return { ok: false, sentence: `feature ${fid} was not built (it is a sketch, was refused, or comes later), so there is no shape of it to read the name from` };
      const bodies = st.bodies[fid];
      if (!bodies || bodies.length !== 1) return { ok: false, sentence: `feature ${fid} produced ${bodies ? bodies.length : 0} bodies; a name is resolved on a single body` };
      if (!shapeCache.has(fid)) {
        const cmds = accepted.slice(0, st.accLen[fid]);
        let r: TopologyReply;
        try { r = await ctx.topologyOf!(cmds); } catch (e) { r = { ok: false, error: (e as Error).message }; }
        shapeCache.set(fid, { cmds, r });
      }
      const { cmds, r } = shapeCache.get(fid)!;
      if (!r.ok || !r.topology) return { ok: false, sentence: `solidcraft could not report the topology of ${fid} (${r.error ?? r.rejected ?? (r.failed && r.failed.error) ?? 'no topology in the reply'})` };
      if (r.topology.truncated) return { ok: false, sentence: `the topology of ${fid} is larger than the bridge's snapshot limit; not resolved` };
      const body = r.topology.bodies.find((b) => b.name === bodies[0]);
      if (!body || body.error) return { ok: false, sentence: `solidcraft returned no topology for body ${bodies[0]}${body?.error ? ' (' + body.error + ')' : ''}` };
      let k = -1;
      cmds.forEach((c, i) => { if (c.params?.body_name === bodies[0] && /^solid\.(box|cylinder|extrude|revolve|loft|sphere|torus)$/.test(c.command)) k = i; });
      const featureNumber = k >= 0 ? (r.results?.[k]?.feature ?? null) : null;
      return { ok: true, bodyName: bodies[0], featureId: fid, featureNumber, faces: body.faces, edges: body.edges };
    },
  };
}

export interface FeatureResult {
  id: string;
  kind: string;
  status: 'built' | 'refused' | 'noop';
  commands: Cmd[];
  refusal?: string;
  measure?: Aggregate;
  pickedFrom?: string;
  evidence?: Evidence | null;
  pick?: Record<string, unknown> | null;
  variantsTried?: number;
  failed?: RunResult['failed'];
  sketchAtFailure?: unknown;
  /** extrude-pocket profile only. */
  checks?: unknown[];
  internalError?: string;
  /** holes profile only. */
  guard?: string;
  raw?: string | null;
  probe?: unknown;
  unguarded?: unknown;
  cpuMs?: number;
}
export interface TranslateResult {
  features: FeatureResult[];
  commands: Cmd[];
  /** holes profile only: CPU seconds the engine runs of this translation used (the sum of the replies' cpuMs). */
  spentS?: number;
  _state: { st: TranslateState; accepted: Cmd[]; shapeCache: ShapeCache };
}

/**
 * Translate and execute a ModelDoc feature by feature.
 * ctx: { arc, mt, runSC(cmds)->parsed result, topologyOf(cmds)->topology reply, soups? }
 */
/**
 * phase 4: resolve the one name this feature needs (a shell's open face, a fillet's edge, a draft's face) from the engine's own topology,
 * before planning it. Returns what the planner's `ctx.resolve` reads. Nothing is resolved without `ctx.topologyOf`.
 */
export async function resolveNamesFor(f: Feature, prefix: Feature[], env: { st: TranslateState; accepted: Cmd[]; ctx: TranslateCtx; shapeCache: ShapeCache }): Promise<Map<unknown, Resolved>> {
  const { st, accepted, ctx, shapeCache } = env;
  const resolved = new Map<unknown, Resolved>();
  const nameField = f.kind === 'shell' ? 'open' : f.kind === 'fillet' ? 'edge' : f.kind === 'draft' ? 'face' : null;
  const nameVal: TopoName | undefined = f.kind === 'shell' ? f.open : f.kind === 'fillet' ? f.edge : f.kind === 'draft' ? f.face : undefined;
  if (nameField && nameVal && typeof nameVal === 'object' && ctx.topologyOf) {
    const menv = makeEnv(st, accepted, prefix, ctx, shapeCache);
    let rr = await resolveName(nameVal, menv, nameField === 'edge' ? 'edge' : 'face');
    rr = await confirmOnTarget(rr, { st, accepted, ctx, targetId: (f as { target: string }).target });
    if (rr.ok && rr.kind === 'faceset') resolved.set(nameVal, { ok: false, sentence: `${rr.evidence.name} is ${rr.faces.length} faces in solidcraft (${rr.evidence.engineFaces.join(', ')}; a cylinder's wall is split at its seam); a face pick of it would choose one half silently, so nothing is picked` });
    else resolved.set(nameVal, rr);
  }
  return resolved;
}

/**
 * Translate and execute a ModelDoc feature by feature.
 * ctx: { arc, mt, runSC(cmds)->parsed result, topologyOf(cmds)->topology reply, soups? }
 * A feature whose kind is owned by a profile with its own `step` (the holes set) is run by that step; every other feature runs the loop below.
 */
export async function translateDoc(doc: { features: Feature[] }, ctx: TranslateCtx, profileIn: Profile = BASE_PROFILE): Promise<TranslateResult> {
  const st: TranslateState = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {} };
  profileIn.initState(st);
  const shapeCache: ShapeCache = new Map();
  const accepted: Cmd[] = [];
  const out: FeatureResult[] = [];
  for (let idx = 0; idx < doc.features.length; idx++) {
    const f = doc.features[idx];
    const profile = ownerOf(profileIn, f.kind); // a composition: the profile that owns this kind decides everything about the feature
    if (profile.step) { await profile.step(f, idx, { doc, ctx, st, accepted, out, shapeCache, profile: profileIn }); continue; }
    const prefix = doc.features.slice(0, idx);
    const resolved = await resolveNamesFor(f, prefix, { st, accepted, ctx, shapeCache });
    const fctx: PlanCtx = { ...ctx, resolve: (name) => resolved.get(name) ?? null };
    const note = (o: Omit<FeatureResult, 'id' | 'kind'>) => out.push({ id: f.id, kind: f.kind, ...o });
    if (f.kind === 'sketch') st.sketches[f.id] = f;
    let plan: Plan;
    let internal: string | null = null;
    try { plan = planFeature(f, st, fctx, profile); } catch (e) { const pe = profile.plannerError(f, e); internal = pe.internal; plan = refuse(pe.refusal); }
    if ('refusal' in plan) { st.refused[f.id] = plan.refusal; note({ status: 'refused', refusal: plan.refusal, commands: [], ...(internal ? { internalError: internal } : {}) }); continue; }
    if ('noop' in plan) { note({ status: 'noop', commands: [] }); continue; }
    let lastErr: string | null = null;
    let lastFail: RunResult | null = null;
    let verifyRefusal: string | null = null;
    const checks: unknown[] = [];
    let built = false;
    for (const variant of plan.variants) {
      let res: RunResult;
      try { res = await ctx.runSC([...accepted, ...variant]); } catch (e) { res = { ok: false, failed: { error: `bridge error: ${(e as Error).message}` } }; }
      if (!res.ok) { lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.rejected ?? res.error ?? 'unknown'); lastFail = res; continue; }
      const m = aggregate(res, plan.produces, profile.verifies);
      if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }
      if (profile.verifies) {
        const bad = plan.verify && !ctx.skipVerify ? await plan.verify(m, { accepted: accepted.slice(), variant, runSC: ctx.runSC, checks, scene: st.scene! }) : null;
        if (bad) { verifyRefusal = bad; lastErr = null; continue; }
      }
      accepted.push(...variant);
      for (const mp of membersOf(profileIn)) mp.onAccepted?.(st, res, m, plan);
      st.accLen[f.id] = accepted.length;
      st.bodies[f.id] = m.bodies;
      st.measure[f.id] = m;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? f.target : f.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
      }
      note({ status: 'built', ...(profile.verifies ? { checks } : {}), commands: variant, measure: m, pickedFrom: plan.pickedFrom, evidence: plan.evidence ?? null, pick: (variant.find((c) => c.params.edges || c.params.faces)?.params) ?? null, variantsTried: plan.variants.indexOf(variant) + 1 });
      built = true;
      break;
    }
    if (built) continue;
    const sentence = verifyRefusal ?? profile.kernelRefusal(f, lastErr);
    st.refused[f.id] = sentence;
    note({ status: 'refused', refusal: sentence, commands: plan.variants[0], failed: lastFail?.failed ?? null, sketchAtFailure: lastFail?.sketch_at_failure ?? null });
  }
  const extras: Partial<TranslateResult> = profileIn.result ? profileIn.result(st) : {};
  return { features: out, commands: accepted, ...extras, _state: { st, accepted, shapeCache } };
}

/** Resolve one name against the shapes a finished translateDoc left behind (same code path as translateDoc). */
export async function resolveAfter(tr: TranslateResult, doc: { features: Feature[] }, name: TopoName, ctx: TranslateCtx, want?: 'edge' | 'face' | null, targetId: string | null = null, beforeId: string | null = null): Promise<Resolved> {
  const { st, accepted: all, shapeCache } = tr._state;
  // the target as it stood BEFORE the feature that uses the name (after it, a rounded edge is gone by construction)
  let accepted = all;
  if (beforeId) {
    const i = doc.features.findIndex((x) => x.id === beforeId);
    let len = 0;
    for (let k = 0; k < i; k++) if (st.accLen[doc.features[k].id] !== undefined) len = Math.max(len, st.accLen[doc.features[k].id]);
    accepted = all.slice(0, len);
  }
  const rr = await resolveName(name, makeEnv(st, accepted, doc.features, ctx, shapeCache), want);
  return targetId ? confirmOnTarget(rr, { st, accepted, ctx, targetId }) : rr;
}
