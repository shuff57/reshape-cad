// Shared types for the layer. The kernel is never named here: everything that touches an engine arrives through the
// context object (TranslateCtx) the caller passes in. The engine reply shapes below are what the host bridge's
// snapshot() produces (packages/solidcraft-host/src/upstream-bridge.mjs); they are interfaces over untyped engine data,
// so most fields are optional and the translator keeps its original defensive reads.
import type { Feature, SketchFeature, SoupGeom, SoupRule } from '@shuff57/reshape-script/model-types';

/** Plain numeric arrays: results of .map() on a Vec3 are number[] and the original code mixes both freely. */
export type V3 = number[];
export type V2 = number[];

/** One engine command: a name and its parameter object. */
export interface Cmd {
  command: string;
  params: Record<string, unknown>;
}

export interface BodyMeasure {
  name: string;
  bbox: { min: V3; max: V3 };
  volume_mm3: number;
  area_mm2?: number;
  faces: number;
  kernel: { faces: number; shells?: number };
  face_types?: Record<string, number>;
  center_of_mass: V3;
}

/** The reply of ctx.runSC(commands). */
export interface RunResult {
  ok: boolean;
  completed?: unknown;
  measure?: { bodies: BodyMeasure[] };
  sketches?: unknown[];
  failed?: { index?: number; command?: string | null; error?: string; params?: unknown } | null;
  /** holes set only: set by a bridge that ran the commands under an execution budget (opts.budgetS) and ran out of it. */
  timedOut?: boolean;
  /** holes set only: CPU milliseconds the run used, when the bridge measures it. */
  cpuMs?: number;
  /** patterns-mirror set only: wall milliseconds the set measured around the run. */
  wallMs?: number;
  rejected?: unknown;
  error?: unknown;
  sketch_at_failure?: unknown;
}

export interface TopoFace {
  name: string;
  index: number;
  centroid: V3;
  plane_normal?: V3 | null;
  area: number;
  centroid_hit?: { index: number; dist: number } | null;
  inner_point?: V3 | null;
  inner_hit?: { index: number; dist: number } | null;
}
export interface TopoEdge {
  name: string;
  index: number;
  start: V3;
  mid: V3;
  end: V3;
  length: number;
}
export interface TopoBody {
  name: string;
  error?: string;
  faces: TopoFace[];
  edges: TopoEdge[];
}
/** The reply of ctx.topologyOf(commands). */
export interface TopologyReply {
  ok: boolean;
  /** fillet-chamfer set only: the measure of the same run, when the host puts it in the topology reply (the original reads the face count before a blend from it). */
  measure?: { bodies: BodyMeasure[] };
  topology?: { truncated?: boolean; bodies: TopoBody[] } | null;
  error?: string;
  rejected?: unknown;
  failed?: { error?: string } | null;
  results?: Array<{ feature?: number | null } | null | undefined>;
}

export interface Frame {
  origin: V3;
  u: V3;
  v: V3;
  n: V3;
}

export interface OutlineLike {
  ok: boolean;
  points: Array<[number, number]>;
  bulges?: Record<number, number>;
  notes?: string[];
}
/** The `arc` member of the context: the sketch outline helpers (packages/sketch sketch-arc). */
export interface ArcApi {
  outlineOf(sk: SketchFeature): OutlineLike;
  arcFromBulge(a: V2, b: V2, bulge: number): { center: V2; radius: number; startAngle: number; endAngle: number };
}
/** The `mt` member of the context: model-types, of which only sketchFrameOf is read. */
export interface MtApi {
  sketchFrameOf?(s: SketchFeature): Frame;
}

export interface SoupInfo {
  sketchId: string;
  geoms: SoupGeom[] | undefined;
  rules: SoupRule[];
  names: unknown;
  notes: string[];
  ruleMap: unknown;
}

/** What the caller hands translateDoc. */
export interface TranslateCtx {
  runSC(cmds: Cmd[], opts?: { budgetS: number }): RunResult | Promise<RunResult>;
  topologyOf?(cmds: Cmd[]): TopologyReply | Promise<TopologyReply>;
  arc: ArcApi;
  mt?: MtApi;
  soups?: Record<string, SoupInfo>;
  /** extrude-pocket profile only: measuring switches of the group's own harness (skip the after-the-build checks / the slanted-round-cut guard). */
  skipVerify?: boolean;
  unguardedSlant?: boolean;
  /**
   * Every set: switch OFF the check of a pull's built volume and pieces against its sketch (sketch-volume.ts), and in the seven sets that have no after-the-build
   * check of a pocket (all but 'extrude-pocket' and 'unified') the extrude-pocket group's cut-consistency check of a pocket (pocket-cut.ts). For the fake engines of
   * the differential tests only, which report bounding-box volumes (and the originals they are compared with have neither check). Never set in production.
   */
  skipSketchVolume?: boolean;
  /**
   * Every set: switch OFF the open-outline pre-flight of a pull or pocket of a soup (open-outline.ts). For measuring only (the before/after runs of
   * GUARD-OPEN-OUTLINE.md, the differential tests' originals have no such check). Never set in production.
   */
  skipOpenOutline?: boolean;
  /** holes profile only: names of guards to switch OFF (the group's negative controls; ALL_GUARDS lists them). Never set in production. */
  guardsOff?: string[];
  /**
   * shell-draft set only: the group's pick source. Resolve a name to a face point in the PRIMITIVE's own frame (before any move of the history; the
   * original asked brep-rs `resolve` and took `centroid`). When the host supplies it, the set runs the group's G-PICK exactly (it shifts the point by the
   * moves in the chain); when it does not, the set takes the point from the base's name resolution (ctx.topologyOf), which is already where the part is.
   */
  resolveAt?(prefix: Feature[], name: unknown): { kind: string; centroid: V3; length?: number; area?: number } | null | Promise<{ kind: string; centroid: V3; length?: number; area?: number } | null>;
  /**
   * Opt-in, default OFF ('base' and 'shell-draft' sets, anything that resolves a name through resolveNamesFor / resolveAfter): carry a named FACE through
   * the non-copy moves and whole quarter turns of the part between the feature it was named on and the target (follow-moves.ts); refuse a copy, any other
   * turn, and a join / mirror / pattern in between, in one sentence. Off: the name is looked up where the primitive was built, as before.
   */
  followMoves?: boolean;
  /** patterns-mirror set only: the time limit of one engine run (ms of NEW work; the replay of what was already accepted gets 2x its own time on top; default 600000) and of the whole model (default 3600000). Safety nets, not status criteria. */
  pmBudgetMs?: number;
  pmDocBudgetMs?: number;
  /**
   * unified set only: which of the extrude-pocket group's join checks are applied to every combine (booleans.ts). 'cheap' (the default): the ones that need no further engine run (a slanted round pull run
   * into another part, two blocks that only touch, a flush step a hair thick, curved parts in contact with no shell merged); 'full': also the inclusion-exclusion consistency check (V(join) against the
   * sum of its parts, measured in scratch sessions: one or more engine runs per join); 'off': the combine is left to the booleans group's own guards.
   */
  unifiedEpJoinChecks?: 'off' | 'cheap' | 'full';
  /** shell-draft set only: which `draft(` calls of the script used `from:` and no `neutral:` (draftFromUsage(script)), in order; the original's `opts.fromUsage`. */
  fromUsage?: Array<{ from: string | null; neutral: boolean }>;
}

export type { Feature, SketchFeature };
