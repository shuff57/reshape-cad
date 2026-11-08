// TypeScript port of docs/spikes/solidcraft-referee/phase7/pane/lib/resolve-names.mjs. Behaviour-preserving.
//
// Resolves a ModelDoc topological NAME (packages/script/src/topo-name.ts) to a 3D pick point from the engine's own
// topology snapshot (faces with centroid / planar normal / area / persistent name / own pick-hit, edges with start / mid /
// end / length / persistent `A|B` name). A name is resolved on the OWN SHAPE of the feature it names; the returned point
// is then a pick on the target body. Causes implemented: primitive, carried (planar), cap, swept (straight edge), between.
// A name of any other cause is REFUSED with a sentence, never approximated. See the original file for the full header.
import type { Feature, SketchFeature } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type { Frame, OutlineLike, TopoEdge, TopoFace, V3 } from './types.js';
import { quarterTurns } from './follow-moves.js';

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const AXV: Record<string, V3> = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const ANGLE_TOL = 1e-6;

/** The fields of a feature this module reads off a doc entry. The doc is plain data and may carry a field the typed
 *  union does not declare for that kind; the original reads them untyped, so this view is deliberately loose. */
interface FeatureView {
  id: string;
  kind: string;
  rotate?: V3;
  round?: number;
  center?: V3;
  size?: V3;
  height?: number;
  target?: string;
  into?: string;
  targets?: string[];
  op?: string;
}
const view = (f: Feature): FeatureView => f as unknown as FeatureView;

export interface Evidence {
  name: string;
  [k: string]: unknown;
}
export interface Plane { n: V3; d: number }
export interface Shape {
  ok: true;
  bodyName: string;
  featureId: string;
  featureNumber: number | null;
  faces: TopoFace[];
  edges: TopoEdge[];
}
export type ShapeResult = Shape | Fail;
export interface Fail { ok: false; sentence: string }
export interface FaceRes {
  ok: true;
  kind: 'face';
  area: number;
  shape: Shape;
  faces: TopoFace[];
  plane: Plane | null;
  evidence: Evidence;
  point?: V3 | null;
}
export interface FaceSetRes {
  ok: true;
  kind: 'faceset';
  faces: TopoFace[];
  shape: Shape;
  evidence: Evidence & { engineFaces: string[] };
}
export interface EdgeRes {
  ok: true;
  kind: 'edge';
  point: V3;
  length: number;
  shape: Shape;
  edges: TopoEdge[];
  evidence: Evidence & { engineEdges: string[] };
  /** set by confirmOnTarget on a face only; declared here so Resolved is one record shape */
  plane?: undefined;
}
export type Resolved = Fail | FaceRes | FaceSetRes | EdgeRes;
type FaceResolved = Fail | FaceRes | FaceSetRes;

export interface ResolveEnv {
  features: Feature[];
  shapeOf(featureId: string): Promise<ShapeResult>;
  sketchFrame(sk: SketchFeature): Frame;
  outline(sk: SketchFeature): OutlineLike;
  /** ctx.followMoves: a primitive turned by whole quarter turns is resolved (its face part is a LOCAL direction, carried by the turn) instead of refused. Default off. */
  followTurns?: boolean;
}

export function nameText(n: TopoName | null | undefined): string {
  if (!n || typeof n !== 'object') return String(n);
  switch (n.cause) {
    case 'primitive': return `${n.feature}.${n.kind}[${n.part}]`;
    case 'swept': return `${n.feature}.${n.kind}[${n.from}.edge${n.edge}]`;
    case 'rounded': return `${n.feature}.${n.kind}[${n.from}.corner${n.corner}]`;
    case 'cap': return `${n.feature}.cap[${n.end}]`;
    case 'carried': return `${n.feature}.same[${nameText(n.of)}]`;
    case 'between': return `${n.feature}.edge[${nameText(n.of?.[0])} ^ ${nameText(n.of?.[1])}]`;
    default: {
      const o = n as { feature?: string; cause?: string }; // split / made, and any cause a malformed doc carries
      return `${o.feature ?? '?'}.${o.cause ?? '?'}`;
    }
  }
}

const fail = (sentence: string): Fail => ({ ok: false, sentence });
const scaleOf = (shape: { faces: TopoFace[]; edges: TopoEdge[] }) => {
  let s = 1;
  for (const f of shape.faces) for (const v of f.centroid) s = Math.max(s, Math.abs(v));
  for (const e of shape.edges) for (const p of [e.start, e.mid, e.end]) for (const v of p) s = Math.max(s, Math.abs(v));
  return s;
};
const planarOf = (f: TopoFace): Plane | null => (f.plane_normal && nrm(f.plane_normal) > 0.5 ? { n: f.plane_normal, d: dot(f.plane_normal, f.centroid) } : null);
const parallel = (a: V3, b: V3) => dot(a, b) >= 1 - ANGLE_TOL; // same direction, both unit

export type PickPoint = { ok: true; point: V3; source: string } | { ok: false; why: string };

/**
 * The point to hand the engine for a FACE pick: its centroid when the engine's own nearest-face rule sends that point back
 * to this face; otherwise the centroid of its largest display triangle, again only if the rule sends it back. Else no point.
 */
export function pickPoint(f: TopoFace, tol: number): PickPoint {
  const ok = (h: { index: number; dist: number } | null | undefined) => h && h.index === f.index && h.dist <= tol;
  if (ok(f.centroid_hit)) return { ok: true, point: f.centroid, source: 'centroid' };
  if (f.inner_point && ok(f.inner_hit)) return { ok: true, point: f.inner_point, source: 'interior point (largest display triangle); the centroid is off the face' };
  const h = f.centroid_hit;
  return { ok: false, why: h ? `solidcraft's nearest-face rule sends a pick at its centroid to face ${h.index} (${h.dist.toExponential(2)} mm away), not to face ${f.index}, and no interior point on it survives the same test` : 'the topology snapshot has no pick-hit for it' };
}

export async function resolveName(name: TopoName, env: ResolveEnv, want?: 'edge' | 'face' | null): Promise<Resolved> {
  const r: Resolved = name?.cause === 'between' ? await resolveEdge(name, env) : await resolveFaceName(name, env);
  if (!r.ok) return r;
  if (want && r.kind !== want) return fail(`${nameText(name)} names ${r.kind === 'edge' ? 'an edge' : r.kind === 'faceset' ? `a set of ${r.faces.length} faces` : 'a face'}, but this feature needs ${want === 'edge' ? 'an edge' : 'a face'}`);
  if (r.kind === 'face') {
    // A provisional point on the NAME'S OWN shape (evidence only). The pick that is actually used is made on the TARGET
    // body by the translator (confirmOnTarget).
    const tol = 1e-6 * Math.max(1, scaleOf(r.shape)) * 10;
    const p = pickPoint(r.faces[0], Math.max(tol, 1e-4));
    r.point = p.ok ? p.point : null;
    r.evidence.pickPoint = p.ok ? `own shape: ${p.source}` : `own shape: none (${p.why})`;
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------- faces
async function resolveFaceName(name: TopoName, env: ResolveEnv): Promise<FaceResolved> {
  const t = nameText(name);
  if (!name || name.kind !== 'face') return fail(`${t} is not a face name`);
  const f = env.features.find((x) => x.id === name.feature);
  if (!f) return fail(`${t}: there is no feature ${name.feature} before this one`);
  switch (name.cause) {
    case 'primitive': return primitiveFace(name, view(f), env, t);
    case 'cap': return capFace(name, view(f), env, t);
    case 'swept': return sweptFace(name, view(f), env, t);
    case 'carried': return carriedFace(name, view(f), env, t);
    case 'rounded': return fail(`${t}: a name made by a ROUNDED sketch corner is not resolved in the browser demo (only primitive, cap, swept-by-a-straight-edge, carried-plane and between names are)`);
    case 'split': case 'made':
      return fail(`${t}: a '${name.cause}' name (a piece of a face, or a face an operation made) is not resolved in the browser demo; it needs a discriminator point and solidcraft has no history record to read it from`);
    default: return fail(`${t}: the name cause '${(name as { cause: string }).cause}' is not one this demo knows`);
  }
}

function finishFace(t: string, shape: Shape, cands: TopoFace[], extra: { rule: string; checks?: unknown[] }): Fail | FaceRes {
  if (cands.length === 0) return fail(`${t} matches no face on ${shape.bodyName} (${extra.rule}); not guessing`);
  if (cands.length > 1) return fail(`${t} matches ${cands.length} faces on ${shape.bodyName} (${cands.map((c) => c.name).join(', ')}; ${extra.rule}); a name must pick exactly one, so nothing is picked`);
  const face = cands[0];
  return {
    ok: true, kind: 'face', area: face.area, shape,
    faces: [face], plane: planarOf(face),
    evidence: { name: t, candidates: 1, engineFace: face.name, rule: extra.rule, checks: extra.checks ?? [] },
  };
}

async function shapeFor(env: ResolveEnv, featureId: string, t: string): Promise<ShapeResult> {
  const s = await env.shapeOf(featureId);
  if (!s.ok) return fail(`${t}: ${s.sentence}`);
  return s;
}

const rotated = (f: FeatureView) => Array.isArray(f.rotate) && f.rotate.some((v) => v);

type NameOf<C extends string> = Extract<TopoName, { cause: C }>;

/**
 * `world`: read the face part as a WORLD direction on the turned primitive (the planar face whose outward normal is the unturned direction, at
 * the extreme along it), the way the OCCT and brep-rs referees name it (brep-adapter topo-resolve.ts resolvePrimitiveFace). Geometry only: the
 * doc-plane and persistent-label checks are checks of the primitive's own frame and are not made.
 */
async function primitiveFace(name: NameOf<'primitive'>, f: FeatureView, env: ResolveEnv, t: string, world = false): Promise<FaceResolved> {
  const part = name.part;
  const isPrim = ['box', 'cylinder', 'prism'].includes(f.kind);
  // a primitive's `rotate` turns it about the origin (x, then y, then z) BEFORE it is placed at `center`; its face part is a local direction that the turn carries along
  // (solidcraft's persistent labels turn with the body: F1:+x stays the local +x face). Only with followTurns, and only by whole quarter turns.
  const turn = isPrim && rotated(f) && env.followTurns ? quarterTurns(f.rotate!) : null;
  if (world) {
    if (!turn || part === 'side' || !AXV[part]) return fail(`${t}: no world-frame reading`);
    const shape = await shapeFor(env, f.id, t);
    if (!shape.ok) return shape;
    const tol = 1e-6 * Math.max(1, scaleOf(shape));
    const dir = AXV[part];
    const planar = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, dir));
    const best = planar.length ? Math.max(...planar.map((x) => dot(x.centroid, dir))) : null;
    const cands = planar.filter((x) => best !== null && Math.abs(dot(x.centroid, dir) - best) <= tol * 10);
    return finishFace(t, shape, cands, { rule: `world frame: planar face with outward normal ${part} at the extreme along it on ${f.id}'s own shape` });
  }
  if (isPrim && rotated(f) && !turn) return fail(`${t}: ${f.id} is rotated; this demo resolves primitive faces only on unrotated primitives (the part names the face by direction, and a rotated body turns solidcraft's own face labels too)`);
  if (isPrim && f.round) return fail(`${t}: ${f.id} carries a whole-shape round, which changes its faces and edges; not resolved`);
  if (part === 'side' && f.kind !== 'cylinder') return fail(`${t}: only a cylinder primitive has a 'side' face in this demo`);
  if (part !== 'side' && !AXV[part]) return fail(`${t}: '${part}' is not a face part this demo knows`);
  if ((f.kind === 'cylinder' || f.kind === 'prism') && part !== 'side' && part !== '+z' && part !== '-z') return fail(`${t}: a ${f.kind} has no ${part} face`);
  if (['sphere', 'cone', 'torus', 'wedge'].includes(f.kind)) return fail(`${t}: faces of a ${f.kind} are not resolved in the browser demo`);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const c = f.center ?? [0, 0, 0];
  if (part === 'side') {
    const curved = shape.faces.filter((x) => !x.plane_normal);
    if (curved.length === 0) return fail(`${t} matches no curved face on ${shape.bodyName}; not guessing`);
    // a cylinder's wall is one face in the doc; the engine splits it at the seam into 2.
    return { ok: true, kind: 'faceset', faces: curved, shape, evidence: { name: t, candidates: curved.length, engineFaces: curved.map((x) => x.name), rule: 'every non-planar face of the cylinder primitive' } };
  }
  const dirLocal = AXV[part];
  const dir: V3 = turn ? turn.map((row) => Math.round(row[0] * dirLocal[0] + row[1] * dirLocal[1] + row[2] * dirLocal[2])) : dirLocal; // exact: a quarter turn maps an axis to an axis
  // rule 1 (geometry only): planar, outward normal == dir, centroid extreme along dir
  const planar = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, dir));
  const best = planar.length ? Math.max(...planar.map((x) => dot(x.centroid, dir))) : null;
  const cands = planar.filter((x) => best !== null && Math.abs(dot(x.centroid, dir) - best) <= tol * 10);
  const checks: unknown[] = [];
  if (cands.length === 1 && isPrim) {
    // rule 2 (the doc alone): the plane the primitive's own parameters put there
    const axis = dir.findIndex((v) => v !== 0);
    const axisLocal = dirLocal.findIndex((v) => v !== 0); // the half extent is along the LOCAL axis; the plane lies along the world one
    const half = f.kind === 'box' ? f.size![axisLocal] / 2 : f.height! / 2; // box has size, cylinder / prism have height
    const docOffset = (c[axis] + Math.sign(dir[axis]) * half) * Math.sign(dir[axis]);
    const got = dot(cands[0].centroid, dir);
    const okDoc = Math.abs(got - docOffset) <= 1e-6 * Math.max(1, Math.abs(docOffset));
    checks.push({ check: 'doc plane', expected: docOffset, got, agree: okDoc });
    if (!okDoc) return fail(`${t}: solidcraft's face ${cands[0].name} is at ${got} along ${part} but ${f.id}'s own parameters put that face at ${docOffset}; the two disagree, so nothing is picked`);
    // rule 3: the engine's persistent name for it
    const want = shape.featureNumber != null ? persistentPrimitive(f.kind, shape.featureNumber, part) : null;
    if (want) {
      const ok = cands[0].name === want || cands[0].name.startsWith(want + '#');
      checks.push({ check: 'engine persistent name', expected: want, got: cands[0].name, agree: ok });
      if (!ok) return fail(`${t}: solidcraft names that face ${cands[0].name}, not ${want} as a ${f.kind}'s ${part} should be; the two disagree, so nothing is picked`);
    } else checks.push({ check: 'engine persistent name', agree: null, note: 'feature number or kind not mapped; skipped' });
  } else if (cands.length === 1) {
    checks.push({ check: 'doc plane', agree: null, note: `${f.id} is a ${f.kind}: no doc-derived plane for a built shape; the rule is geometry on solidcraft's own shape only` });
  }
  return finishFace(t, shape, cands, { rule: `planar face with outward normal ${part} at the extreme along it on ${f.id}'s own shape`, checks });
}

function persistentPrimitive(kind: string, n: number, part: string): string | null {
  if (kind === 'box') return `F${n}:${part}`;
  if (kind === 'cylinder') return part === '+z' ? `F${n}:top` : part === '-z' ? `F${n}:bottom` : null;
  return null;
}

type ExtrudeOf = { err: Fail; sk?: undefined; fr?: undefined } | { err?: undefined; sk: SketchFeature; fr: Frame };
function extrudeOf(env: ResolveEnv, f: FeatureView, t: string): ExtrudeOf {
  if (f.kind !== 'extrude') return { err: fail(`${t}: ${f.id} is a ${f.kind}, not a plain extrude; sweep names of other features are not resolved in the browser demo`) };
  for (const k of ['midplane', 'length2', 'reversed', 'taper', 'direction', 'alongNormal']) {
    if ((f as unknown as Record<string, unknown>)[k]) return { err: fail(`${t}: ${f.id} uses the ${k} option, which the translator does not map; not resolved`) };
  }
  const sk = env.features.find((x) => x.id === f.target && x.kind === 'sketch') as SketchFeature | undefined;
  if (!sk) return { err: fail(`${t}: ${f.id}'s sketch ${f.target} is not in the document before this feature`) };
  const f0 = env.sketchFrame(sk);
  // the sweep runs along u x v (xy +Z, xz -Y, yz +X): NOT the `n` of a named-plane table, whose xz entry has the opposite sign
  const [u, v] = [f0.u, f0.v];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return { sk, fr: { ...f0, n } };
}

async function capFace(name: NameOf<'cap'>, f: FeatureView, env: ResolveEnv, t: string): Promise<FaceResolved> {
  const { fr, err } = extrudeOf(env, f, t);
  if (err) return err;
  if (name.end !== 'top' && name.end !== 'bottom') return fail(`${t}: cap end '${name.end}' is not top or bottom`);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const outward = name.end === 'top' ? fr.n : fr.n.map((v) => -v);
  const d = dot(fr.origin, fr.n) + (name.end === 'top' ? f.height! : 0);
  const want = d * (name.end === 'top' ? 1 : -1);
  const cands = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, outward) && Math.abs(dot(x.centroid, outward) - want) <= tol * 10);
  return finishFace(t, shape, cands, { rule: `planar face, outward normal along the sketch normal ${name.end === 'top' ? '' : 'reversed '}at the sketch plane${name.end === 'top' ? ' + height' : ''}`, checks: [{ check: 'doc plane', expected: want, agree: cands.length === 1 }] });
}

async function sweptFace(name: NameOf<'swept'>, f: FeatureView, env: ResolveEnv, t: string): Promise<FaceResolved> {
  const { sk, fr, err } = extrudeOf(env, f, t);
  if (err) return err;
  if (name.from !== sk.id) return fail(`${t}: the name was written against sketch ${name.from} but ${f.id} sweeps ${sk.id}; not resolved`);
  if (sk.shape === 'circle' || (Array.isArray(sk.geoms) && sk.geoms.length)) return fail(`${t}: ${sk.id} is a circle or a rows-and-rules sketch; a swept name over it is not resolved in the browser demo`);
  const o = env.outline(sk);
  if (!o.ok) return fail(`${t}: ${sk.id} has no usable outline`);
  const pts = o.points;
  const designN = Array.isArray(sk.points) ? sk.points.length : null;
  if (designN === null || pts.length !== designN) return fail(`${t}: ${sk.id} has rounded or chamfered corners (its outline has ${pts.length} segments for ${designN ?? '?'} design edges), so the sketch edge index does not map to one straight wall; not resolved`);
  const i = name.edge;
  if (!Number.isInteger(i) || i < 0 || i >= pts.length) return fail(`${t}: ${sk.id} has no edge ${String(i)}`);
  if ((o.bulges ?? {})[i]) return fail(`${t}: sketch edge ${i} of ${sk.id} is an arc; a swept name over an arc is not resolved in the browser demo (only straight edges are)`);
  const a2 = pts[i]; const b2 = pts[(i + 1) % pts.length];
  const w = (p: number[]): V3 => [0, 1, 2].map((k) => fr.origin[k] + fr.u[k] * p[0] + fr.v[k] * p[1]);
  const A = w(a2); const B = w(b2);
  const dir = sub(B, A); const L = nrm(dir);
  if (L < 1e-9) return fail(`${t}: sketch edge ${i} has zero length`);
  const e = dir.map((v) => v / L);
  const cr = [fr.n[1] * e[2] - fr.n[2] * e[1], fr.n[2] * e[0] - fr.n[0] * e[2], fr.n[0] * e[1] - fr.n[1] * e[0]];
  const cn = nrm(cr);
  const nOut = cr.map((v) => v / cn);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const mid = [0, 1, 2].map((k) => (A[k] + B[k]) / 2 + (fr.n[k] * f.height!) / 2);
  // a wall of a straight edge is a planar rectangle: normal perpendicular to the edge and to the sketch normal (either
  // sign), centroid at the lifted edge midpoint, area edge length x height
  const cands = shape.faces.filter((x) => x.plane_normal && Math.abs(Math.abs(dot(x.plane_normal, nOut)) - 1) <= ANGLE_TOL
    && nrm(sub(x.centroid, mid)) <= tol * 10 && Math.abs(x.area - L * Math.abs(f.height!)) <= 1e-6 * Math.max(1, L * Math.abs(f.height!)));
  return finishFace(t, shape, cands, { rule: `planar wall through sketch edge ${i} lifted by the height (centroid and area match)`, checks: [{ check: 'doc wall centroid', expected: mid, agree: cands.length === 1 }] });
}

async function carriedFace(name: NameOf<'carried'>, f: FeatureView, env: ResolveEnv, t: string): Promise<FaceResolved> {
  if (['move', 'rotate', 'mirror', 'pattern'].includes(f.kind)) return fail(`${t}: ${f.id} is a ${f.kind}, which moves or copies faces; a carried name through it is not resolved`);
  if (!name.of || name.of.kind !== 'face') return fail(`${t}: a carried name must wrap a face name`);
  const parent = await resolveFaceName(name.of, env);
  if (!parent.ok) return fail(`${t}: its parent ${parent.sentence}`);
  return liftTo(parent, f.id, env, t);
}

/**
 * Move a resolved PLANAR face from the shape it was named on to the own shape of feature `T` that consumed it:
 * the same plane (the normal flips when the face was a subtracted tool's), exactly one face there, no larger than the
 * original, and the engine's persistent name must be the same. Anything else is a refusal, not a nearest guess.
 */
async function liftTo(r: FaceRes | FaceSetRes, T: string, env: ResolveEnv, t: string): Promise<FaceResolved> {
  if (r.shape.featureId === T) return r;
  if (r.kind === 'faceset') return fail(`${t}: its face is a set of ${r.faces.length} faces (a cylinder wall split at the seam); lifting a set through ${T} is not resolved`);
  if (!r.plane) return fail(`${t}: the face ${r.faces[0].name} is curved; a CURVED face carried through ${T} is not resolved in the browser demo (it would have to be matched by surface, and only planes are)`);
  const Tf = env.features.find((x) => x.id === T);
  if (!Tf) return fail(`${t}: there is no feature ${T} before this one`);
  const tv = view(Tf);
  if (['move', 'rotate', 'mirror', 'pattern'].includes(tv.kind)) return fail(`${t}: ${T} is a ${tv.kind}, which moves or copies faces; a name through it is not resolved`);
  const consumed = [...(tv.targets ?? []), tv.target, tv.into].filter(Boolean);
  if (!consumed.includes(r.shape.featureId)) return fail(`${t}: ${T} does not take ${r.shape.featureId} as an input (it takes ${consumed.join(', ') || 'nothing'}), so the face cannot have been carried through it`);
  const flip = tv.kind === 'combine' && tv.op === 'subtract' && tv.targets!.indexOf(r.shape.featureId) >= 1;
  const shape = await shapeFor(env, T, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const n = flip ? r.plane.n.map((v) => -v) : r.plane.n;
  const d = flip ? -r.plane.d : r.plane.d;
  const cands = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, n) && Math.abs(dot(x.centroid, n) - d) <= tol * 10);
  const checks = [...((r.evidence.checks as unknown[] | undefined) ?? []), { check: 'lift', from: r.shape.featureId, to: T, flipped: flip, plane: { n, d } }];
  if (cands.length === 1) {
    const ratio = cands[0].area / r.faces[0].area;
    checks.push({ check: 'area vs original', ratio });
    if (ratio > 1 + 1e-6) return fail(`${t}: the face on that plane of ${T} is LARGER than the original (${cands[0].area} vs ${r.faces[0].area}); it was merged with another face, so it is not the carried one; nothing is picked`);
    const nm = cands[0].name; const was = r.faces[0].name;
    const same = nm === was || nm.startsWith(was + '#') || was.startsWith(nm + '#');
    checks.push({ check: 'engine persistent name kept', expected: was, got: nm, agree: same });
    if (!same) return fail(`${t}: the face on that plane of ${T} is named ${nm} by solidcraft, not ${was}; the geometry and the persistent names disagree, so nothing is picked`);
  }
  const out = finishFace(t, shape, cands, { rule: `the planar face on ${r.faces[0].name}'s plane${flip ? ' (flipped: it was a subtracted tool)' : ''} on ${T}'s own shape`, checks });
  if (out.ok) out.evidence.liftedFrom = r.evidence;
  return out;
}

// ---------------------------------------------------------------------------------------------------- edges
const parseEdgeName = (n: unknown): string[] | null => {
  if (typeof n !== 'string') return null;
  const parts = n.replace(/~\d+$/, '').split('|');
  return parts.length === 2 ? parts : null;
};
const near = (p: V3, q: V3, tol: number) => nrm(sub(p, q)) <= tol;

async function resolveEdge(name: NameOf<'between'>, env: ResolveEnv): Promise<Fail | EdgeRes> {
  const t = nameText(name);
  if (name.kind !== 'edge' || !Array.isArray(name.of) || name.of.length !== 2) return fail(`${t} is not a well-formed between name`);
  const f = env.features.find((x) => x.id === name.feature);
  if (!f) return fail(`${t}: there is no feature ${name.feature} before this one`);
  let A = await resolveFaceNameOrSet(name.of[0], env);
  if (!A.ok) return fail(`${t} cannot be resolved: ${A.sentence}`);
  let B = await resolveFaceNameOrSet(name.of[1], env);
  if (!B.ok) return fail(`${t} cannot be resolved: ${B.sentence}`);
  const clash = await turnedFrameClash(name, env, A, B, t);
  if (clash) return clash;
  // the edge lives on ITS feature's own shape; a face named on an earlier shape is first carried onto that shape
  A = await liftTo(A, name.feature, env, t);
  if (!A.ok) return A;
  B = await liftTo(B, name.feature, env, t);
  if (!B.ok) return B;
  if (A.shape.bodyName !== B.shape.bodyName || A.shape.featureId !== B.shape.featureId) return fail(`${t}: its two faces live on different shapes (${A.shape.featureId} and ${B.shape.featureId}); an edge between faces of two different features is not resolved`);
  const shape = A.shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const aNames = new Set(A.faces.map((x) => x.name)); const bNames = new Set(B.faces.map((x) => x.name));
  const planeA = A.faces.length === 1 ? planarOf(A.faces[0]) : null;
  const planeB = B.faces.length === 1 ? planarOf(B.faces[0]) : null;
  const onPlane = (e: TopoEdge, pl: Plane) => [e.start, e.mid, e.end].every((p) => Math.abs(dot(pl.n, p) - pl.d) <= tol * 10);
  const byName = shape.edges.filter((e) => {
    const pr = parseEdgeName(e.name);
    return pr && ((aNames.has(pr[0]) && bNames.has(pr[1])) || (aNames.has(pr[1]) && bNames.has(pr[0])));
  });
  let cands: TopoEdge[]; let geoAll: TopoEdge[] | null = null;
  if (planeA && planeB) {
    geoAll = shape.edges.filter((e) => onPlane(e, planeA) && onPlane(e, planeB));
    const all = geoAll;
    const sameSet = all.length === byName.length && all.every((e) => byName.some((x) => x.index === e.index));
    if (!sameSet) return fail(`${t}: geometry finds ${all.length} edge(s) on both planes but solidcraft's persistent edge names find ${byName.length}; the two disagree, so nothing is picked`);
    cands = all;
  } else {
    const pl = planeA ?? planeB;
    cands = pl ? byName.filter((e) => onPlane(e, pl)) : byName;
    if (byName.length !== cands.length) return fail(`${t}: ${byName.length - cands.length} of the edges solidcraft names for it do not lie on the planar face's plane; the two disagree, so nothing is picked`);
  }
  if (cands.length === 0) return fail(`${t} matches no edge on ${shape.bodyName} (the two faces do not meet there any more, or never did); not guessing`);
  // a closed loop that the engine splits at a seam (a cylinder rim = 2 half circles) is ONE edge in the doc
  if (cands.length > 1) {
    const ends = cands.flatMap((e) => [e.start, e.end]);
    const closed = ends.every((p, i) => ends.filter((q, j) => j !== i && near(p, q, tol * 10)).length === 1);
    if (!closed) return fail(`${t} matches ${cands.length} separate edges on ${shape.bodyName} (${cands.map((e) => e.name).join(', ')}) that do not form one closed loop; a name must pick exactly one edge, so nothing is picked`);
  }
  const e0 = cands[0];
  return {
    ok: true, kind: 'edge', point: e0.mid, length: cands.reduce((s, e) => s + e.length, 0), shape, edges: cands,
    evidence: {
      name: t, candidates: cands.length, loop: cands.length > 1, engineEdges: cands.map((e) => e.name), pointOn: e0.name,
      facesA: [...aNames], facesB: [...bNames],
      checks: [planeA && planeB ? { check: 'geometry vs persistent names', agree: true, geometric: geoAll!.length, named: byName.length } : { check: 'persistent names + plane of the planar face', agree: true, named: byName.length }],
    },
  };
}

/**
 * An edge named on a primitive turned by quarter turns (followTurns) has two readings: the primitive's own frame (the face parts turn with the
 * body; what the resolver picks) and the world frame (the face parts are world directions after the turn; what the OCCT and brep-rs referees
 * pick). Where both readings name a face for each part and the two pairs differ, the name is refused: building either edge could be the wrong
 * solid. Where they name the same pair, or the world frame names no face for a part (a cylinder lying on its side has no world top face, so
 * only the primitive's own reading exists), the pick is resolved as before (except a cylinder's BOTTOM with no world reading: refused, see below). A 'side' part (a cylinder's wall) is the same face in both frames.
 */
async function turnedFrameClash(name: NameOf<'between'>, env: ResolveEnv, A: FaceResolved & { ok: true }, B: FaceResolved & { ok: true }, t: string): Promise<Fail | null> {
  if (!env.followTurns) return null;
  const names = (r: { faces: TopoFace[] }) => new Set(r.faces.map((x) => x.name));
  const own = [names(A), names(B)];
  const world: Set<string>[] = [];
  let turned: FeatureView | null = null;
  let noWorld = false; let noWorldBottom: FeatureView | null = null;
  for (let i = 0; i < 2; i++) {
    const n = name.of[i];
    const raw = n?.cause === 'primitive' ? env.features.find((x) => x.id === n.feature) : undefined;
    const f = raw ? view(raw) : null;
    if (!f || n.cause !== 'primitive' || !['box', 'cylinder', 'prism'].includes(f.kind) || !rotated(f) || !quarterTurns(f.rotate!)) { world.push(own[i]); continue; }
    turned = f;
    if (n.part === 'side') { world.push(own[i]); continue; }
    const w = await primitiveFace(n, f, env, nameText(n), true);
    if (!w.ok) {
      // a cylinder lying on its side: no cap faces world +z or -z. Its own frame is the only reading of the part, and for its TOP rim the referees'
      // world-frame lookup (a tie-break, topo-resolve.ts) lands on that same rim (measured: centre of mass to 2.4e-7). For its BOTTOM rim the
      // tie-break lands on the top rim, so no second oracle confirms the build (AGENTS.md): refused, owner decision (audit FM-1).
      if (f.kind === 'cylinder' && n.part === '-z') noWorldBottom = f;
      noWorld = true;
      continue;
    }
    world.push(names(w));
  }
  if (noWorldBottom) return fail(`${t}: ${noWorldBottom.id} is rotated; this demo resolves primitive faces only on unrotated primitives, and the bottom of a cylinder turned onto its side has no world-frame reading that a second oracle confirms; nothing is picked`);
  if (noWorld) return null;
  if (!turned) return null;
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  if ((same(own[0], world[0]) && same(own[1], world[1])) || (same(own[0], world[1]) && same(own[1], world[0]))) return null;
  const show = (s: Set<string>[]) => s.map((x) => [...x].join('+')).join(' ^ ');
  return fail(`${t}: ${turned.id} is rotated; this demo resolves primitive faces only on unrotated primitives unless the name means one edge either way, and after this turn it does not (${show(own)} in ${turned.id}'s own frame, ${show(world)} in the world frame); nothing is picked`);
}

/** A face name inside `between` may resolve to a whole SET of engine faces (a cylinder's two wall halves). */
async function resolveFaceNameOrSet(name: TopoName, env: ResolveEnv): Promise<FaceResolved> {
  const r = await resolveFaceName(name, env);
  if (!r.ok) return r;
  return { ...r, faces: r.faces };
}
