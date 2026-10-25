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
  runSC(cmds: Cmd[]): RunResult | Promise<RunResult>;
  topologyOf?(cmds: Cmd[]): TopologyReply | Promise<TopologyReply>;
  arc: ArcApi;
  mt?: MtApi;
  soups?: Record<string, SoupInfo>;
  /** extrude-pocket profile only: measuring switches of the group's own harness (skip the after-the-build checks / the slanted-round-cut guard). */
  skipVerify?: boolean;
  unguardedSlant?: boolean;
}

export type { Feature, SketchFeature };
