// Turning a TopoName back into an actual face on a built shape.
//
// lib/topo-name.ts decides what a name IS -- a path through the history that
// produced the face, rather than a position in the result. This is the other
// half: given such a name and a freshly built shape, find the face it means.
//
// The claim being tested is narrow and is the whole point of the exercise:
//
//     build -> change an upstream number -> rebuild -> the name still finds
//     the same face
//
// If that holds, a student can fillet an edge and keep the fillet when they
// widen the part. If it does not, parametric modelling does not work, and no
// amount of kernel makes up for it.
//
// WHAT IS HERE AND WHAT IS NOT. `primitive` names -- the faces of a box,
// cylinder, sphere, cone or torus -- resolve from the shape alone, with no
// operation history needed. `carried` and `split` names, the ones that ride
// through a boolean, resolve through the operation history that buildDoc now
// keeps alive; lib/topo-history.ts is the layer that asks the kernel and this
// file is the bookkeeping on top of it.
//
// `swept`, `rounded` and `cap` resolve through the sweep history buildDoc keeps
// alongside the boolean history -- a prism or revolve GENERATES one wall per
// profile edge and a cap at each end, which is an exact answer rather than a
// discriminated one.
//
// `made` still returns null, and it is worth saying why rather than listing it
// as missing: the faces a cut appears to invent -- the floor and walls of a
// groove -- are not invented at all, they are the TOOL'S faces carried through.
// So they are already nameable with the machinery here, off the tool feature's
// id, and `made` may turn out to be needed only for the seams a fuse genuinely
// creates. That is a design question, not a gap, and it is left open rather
// than guessed at.

import type { BuildResult, Occt, OpRecord } from './occt-build.js';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import {
  capOf, edgesOf, faceFate, fractionOnFace, generatedFrom, pieceContaining,
  placed, pointAtFraction, pointOnFace, sharedEdge,
} from '@shuff57/reshape-script/topo-history';

/** Every face of a shape, in the kernel's own order -- which is exactly the
 *  order nothing here is allowed to depend on. */
export function facesOf(oc: Occt, shape: any): any[] {
  const out: any[] = [];
  const exp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (exp.More()) {
    out.push(exp.Current());
    exp.Next();
  }
  return out;
}

/** Where a face's area is centred, in world coordinates. Used to tell faces
 *  apart by where they sit rather than by what index they arrived in. */
export function faceCentre(oc: Occt, face: any): [number, number, number] {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(face, g, false, false);
  const c = g.CentreOfMass();
  return [c.X(), c.Y(), c.Z()];
}

/** Area, used only to break a tie between two faces that centre at the same
 *  point -- which a symmetric shape can genuinely produce. */
function faceArea(oc: Occt, face: any): number {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(face, g, false, false);
  return g.Mass();
}

const DIRS: Record<string, [number, number, number]> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/**
 * The face of a primitive that faces a given way.
 *
 * Chosen by how far its centre sits along that direction, not by index and not
 * by the kernel's face order -- both of which a rebuild is free to change. On a
 * box that picks the obvious face; on a cylinder `+z` and `-z` pick the caps
 * and anything else picks the curved side, which is the only face left.
 *
 * The limit, stated rather than discovered: this is for the axis-aligned
 * primitive set, which is what `primitive` names cover. It is not a general
 * face picker and must not be used as one -- a face of a boolean result is
 * addressed through its history, not by being furthest in some direction.
 */
export function resolvePrimitiveFace(oc: Occt, shape: any, part: string): any | null {
  const faces = facesOf(oc, shape);
  if (!faces.length) return null;
  const dir = DIRS[part];
  if (dir) {
    let best: any = null;
    let bestScore = -Infinity;
    let bestArea = -Infinity;
    for (const f of faces) {
      const c = faceCentre(oc, f);
      const score = c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2];
      const area = faceArea(oc, f);
      if (score > bestScore + 1e-7 || (Math.abs(score - bestScore) <= 1e-7 && area > bestArea)) {
        best = f;
        bestScore = Math.max(score, bestScore);
        bestArea = area;
      }
    }
    return best;
  }
  if (part === 'side') {
    // The curved wall of a cylinder or cone: the face that is neither cap.
    const top = resolvePrimitiveFace(oc, shape, '+z');
    const bottom = resolvePrimitiveFace(oc, shape, '-z');
    const topC = top ? faceCentre(oc, top) : null;
    const botC = bottom ? faceCentre(oc, bottom) : null;
    const same = (a: [number, number, number] | null, b: [number, number, number]) =>
      a !== null && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-7;
    for (const f of faces) {
      const c = faceCentre(oc, f);
      if (!same(topC, c) && !same(botC, c)) return f;
    }
    return null;
  }
  return null;
}

/** Candidate part names resolvePrimitiveFace() understands, for each
 *  primitive kind isRoundable() covers -- see lib/model-types.ts. Not
 *  exported: it is a resolution-order detail of namePrimitiveFace() below,
 *  not a fact about the model worth a caller depending on. */
const PRIMITIVE_FACE_PARTS: Record<'box' | 'cylinder', string[]> = {
  box: ['+x', '-x', '+y', '-y', '+z', '-z'],
  cylinder: ['+z', '-z', 'side'],
};

/**
 * The inverse of resolvePrimitiveFace(): given a real TopoDS_Face the
 * student actually clicked -- on a primitive's OWN shape, before anything is
 * cut from it, the exact scope resolvePrimitiveFace's own doc comment states
 * -- which named part is it?
 *
 * Tried in the same fixed order every time, so two rebuilds of an
 * unmodified primitive agree on the answer -- though the match itself is by
 * IsSame(), not by that order or by any index.
 */
export function namePrimitiveFace(
  oc: Occt, shape: any, feature: string, kind: 'box' | 'cylinder', face: any,
): TopoName | null {
  for (const part of PRIMITIVE_FACE_PARTS[kind]) {
    const candidate = resolvePrimitiveFace(oc, shape, part);
    if (candidate && candidate.IsSame(face)) {
      return { cause: 'primitive', feature, kind: 'face', part };
    }
  }
  return null;
}

/**
 * Name an EDGE the student clicked in the viewport, as the `between` of its
 * two adjacent faces -- see the `between` cause's own doc comment in
 * lib/topo-name.ts for why an edge is named by its faces rather than given a
 * naming mechanism of its own.
 *
 * Scoped to the same primitive set namePrimitiveFace() covers -- which is
 * also exactly the set Round/Bevel already work on (isRoundable() in
 * lib/model-types.ts). A box or cylinder's OWN shape has exactly two faces
 * meeting at any edge and both are always nameable; a shape with a real
 * operation history (a boolean, a sweep) can have edges bordering faces this
 * file has no name for yet, and this returns null rather than guessing which
 * -- the caller falls back to the whole-shape tool, the same way
 * whyCannotRound() already refuses those kinds today.
 */
export function nameEdgeBetweenPrimitiveFaces(
  oc: Occt, shape: any, feature: string, kind: 'box' | 'cylinder', edge: any,
): TopoName | null {
  const adjacent = facesOf(oc, shape).filter((f) =>
    edgesOf(oc, f).some((e) => e.IsSame(edge)));
  if (adjacent.length !== 2) return null;
  const a = namePrimitiveFace(oc, shape, feature, kind, adjacent[0]);
  const b = namePrimitiveFace(oc, shape, feature, kind, adjacent[1]);
  return a && b ? { cause: 'between', feature, kind: 'edge', of: [a, b] } : null;
}

/**
 * The operations at a feature that a given ancestor's face has to pass through.
 *
 * A combine over three targets is two pairwise booleans. A face of the first
 * target sees both; a face of the third only sees the second. Starting at the
 * wrong one asks an operation about a face it has never seen, which answers
 * "deleted" and loses a selection that was never actually lost.
 *
 * An ancestor the chain does not mention -- a name rooted several features back
 * -- falls back to the whole chain, which is the conservative reading: it went
 * in at the beginning.
 */
function chainFor(build: BuildResult, feature: string, ancestor: string): OpRecord[] {
  const list = build.ops.get(feature) ?? [];
  const at = list.findIndex((r) => r.inputs.includes(ancestor));
  return at < 0 ? list : list.slice(at);
}

/** A `split` discriminator, as pushThrough() consumes it -- see the `side`
 *  field's own doc comment on the 'split' cause in lib/topo-name.ts for what
 *  problem `side` closes that `u`/`v` alone cannot. */
interface SplitDiscriminator {
  u: number;
  v: number;
  side?: { axis: 0 | 1 | 2; dir: 'lo' | 'hi' };
}

/**
 * Where a face's area is centred, in world coordinates. Local copy of the
 * same computation topo-history.ts's centreOf() does -- kept here rather than
 * imported so this file's only dependency on that one is the handful of named
 * exports it already has, not an internal helper.
 */
function centroid(oc: Occt, face: any): [number, number, number] {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(face, g, false, false);
  const c = g.CentreOfMass();
  return [c.X(), c.Y(), c.Z()];
}

/**
 * Does `hit` still sit at the recorded extreme of `axis` among `pieces` on
 * THIS rebuild?
 *
 * This is the second half of the `side` check -- see its doc comment on the
 * 'split' cause in lib/topo-name.ts. `at` (the u/v point) only ever asks "is
 * this piece contains a certain point"; it cannot ask "and is this the piece
 * that used to be on the left", because a point on a piece says nothing about
 * where its SIBLING sat. This does, by re-ranking the CURRENT pieces the same
 * way nameSplitPiece() ranked them when the name was written.
 */
function onRecordedSide(
  oc: Occt, pieces: any[], hit: any, side: { axis: 0 | 1 | 2; dir: 'lo' | 'hi' },
): boolean {
  const centres = pieces.map((p) => centroid(oc, p));
  const hitIndex = pieces.findIndex((p) => p.IsSame(hit));
  if (hitIndex < 0) return false;
  const val = centres[hitIndex][side.axis];
  const isExtreme = (cmp: (a: number, b: number) => boolean) =>
    centres.every((c, i) => i === hitIndex || cmp(val, c[side.axis]));
  return side.dir === 'lo'
    ? isExtreme((a, b) => a <= b + 1e-9)
    : isExtreme((a, b) => a >= b - 1e-9);
}

/**
 * Push a face forward through a chain of booleans.
 *
 * `discriminator` is consulted only where an operation SPLITS the face, and it
 * is evaluated on the face as it enters that operation -- which is the face
 * whose pieces they are. For the single-boolean case, which is what the app
 * actually produces today, that is exactly the parent face the name was written
 * against. Naming uses the same rule (see nameSplitPiece), so the two halves
 * agree by construction rather than by coincidence.
 *
 * A split met by a name that carries no discriminator returns null. That is not
 * a gap: it means an edit turned one face into several and the name predates
 * the split, so there is genuinely no answer to which piece was meant.
 *
 * TWO REFUSALS ADDED ON TOP OF THE ORIGINAL ONE, both closing real defects
 * rather than tightening for its own sake -- neither can reject a case the
 * pre-existing point check alone would have accepted correctly:
 *
 * 1. `discriminator.side`, when present, must ALSO agree -- the piece
 *    `pieceContaining` found must still be the recorded extreme (leftmost or
 *    rightmost) among its CURRENT siblings. Without this, a parent that
 *    TRANSLATES relative to a tool that does not move can walk the u/v point
 *    clean across the cut onto the SIBLING piece, and pieceContaining would
 *    return that wrong piece with total confidence -- see the 'split' cause's
 *    own doc comment in lib/topo-name.ts for the full account.
 * 2. A discriminator that is supplied but never actually met a SPLIT fate
 *    anywhere in the chain -- every hop was 'kept' or 'replaced' -- also
 *    refuses. A name that identifies one of several pieces is not
 *    meaningful once there is only one piece again (the cut merged back into
 *    a single face, e.g. because it now falls exactly on the parent's own
 *    edge): the specific sliver the name pointed to has no separate identity
 *    left to return, and handing back the whole remaining face would be
 *    exactly the kind of confident wrong answer this file exists to refuse.
 */
function pushThrough(
  oc: Occt,
  chain: OpRecord[],
  face: any,
  discriminator: SplitDiscriminator | null,
): any | null {
  let cur = face;
  let consumedSplit = false;
  for (const rec of chain) {
    const fate = faceFate(oc, rec.op, cur);
    if (fate.kind === 'deleted') return null;
    if (fate.kind === 'kept' || fate.kind === 'replaced') {
      cur = fate.face;
      continue;
    }
    if (!discriminator) return null;
    const p = pointAtFraction(oc, cur, discriminator.u, discriminator.v);
    const hit = pieceContaining(oc, fate.pieces, p);
    if (!hit) return null;
    if (discriminator.side && !onRecordedSide(oc, fate.pieces, hit, discriminator.side)) return null;
    consumedSplit = true;
    cur = hit;
  }
  if (discriminator && !consumedSplit) return null;
  return cur;
}

/**
 * Walk the operation graph from one feature to another, returning the
 * OpRecords a face must be pushed through to get from the first to the
 * second -- or null if no path is recorded between them.
 *
 * WHY THIS EXISTS. chainFor() above answers a narrower question: "what did
 * THIS SPECIFIC feature's own op(s) do to a face that entered them", and it
 * only works when the caller already knows which feature ran the op. That is
 * fine for `carried`/`split`, where the name's own `feature` field IS that
 * op's feature. It breaks down the moment a name is resolved against one
 * feature (say the box a fillet's edge is named on) but has to be USED
 * against a later one (the moved copy of that box the fillet actually
 * targets) -- see the header of the 'move' branch in lib/occt-build.ts for
 * why that gap is a real, silent defect and not a hypothetical one.
 *
 * A breadth-first search over `build.ops`, one hop at a time: from the
 * current feature, a candidate is a valid next hop only when its OWN ops
 * actually name `feature` as one of their inputs -- checked directly here,
 * NOT by trusting chainFor()'s return length. chainFor()'s own "ancestor not
 * mentioned" fallback deliberately returns the WHOLE chain rather than an
 * empty one (see its own doc comment: "it went in at the beginning"), which
 * is the right answer for `carried`/`split` resolution, where the name's own
 * `feature` field is guaranteed to be that op's actual feature. It is the
 * WRONG answer here: with two or more features holding their own op records
 * (a Hole, then a Round on some other edge entirely -- neither one about the
 * other), that fallback made an UNRELATED candidate look connected, so a
 * two-hop path (through the Hole, then the Round) was found as a bogus
 * one-hop shortcut straight to the Round -- silently pushing a face through
 * an operation it was never actually part of. Measured 2026-09-04: exactly
 * this shortcut is why a box's own untouched top face could not be named
 * once a Round existed anywhere in the chain, no matter which edge it
 * rounded -- see FilletResult's own doc comment in lib/topo-history.ts for
 * the fuller story this bug was found chasing.
 *
 * Multiple moves or booleans stacked in sequence are walked one hop after
 * another rather than assumed to be a single step, so this is not limited to
 * the one-hop case a fillet-after-move produces.
 */
function chainToFeature(build: BuildResult, from: string, to: string): OpRecord[] | null {
  if (from === to) return [];
  const visited = new Set([from]);
  let frontier: Array<{ feature: string; chain: OpRecord[] }> = [{ feature: from, chain: [] }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const { feature, chain } of frontier) {
      for (const candidate of build.ops.keys()) {
        if (visited.has(candidate)) continue;
        const list = build.ops.get(candidate) ?? [];
        if (!list.some((r) => r.inputs.includes(feature))) continue;
        const hop = chainFor(build, candidate, feature);
        if (!hop.length) continue;
        const chainSoFar = [...chain, ...hop];
        if (candidate === to) return chainSoFar;
        visited.add(candidate);
        next.push({ feature: candidate, chain: chainSoFar });
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Resolve a name, then push the result forward to the feature that is
 * actually going to USE it -- the counterpart to placed() for a name whose
 * root sits one or more `move` (or other recorded) steps behind where a
 * fillet or draft needs it.
 *
 * If the name already lives at `usedByFeature` (the ordinary case -- a
 * fillet on the very shape the edge was named against) this is exactly
 * resolveName() and nothing more runs. It is the fillet/draft call sites in
 * lib/occt-build.ts that need the push, because they alone resolve a name
 * against one feature (the edge's own history) and then hand the result to
 * BRepFilletAPI/BRepOffsetAPI_DraftAngle against a DIFFERENT, later shape.
 *
 * No recorded path between the two -- `chainToFeature` returns null -- is
 * not treated as failure here: it means this pair of features has no boolean
 * or move history linking them (most builds today), so the plain resolution
 * is already correct and is returned as-is rather than discarded.
 */
export function resolveNameAsUsedBy(
  oc: Occt, name: TopoName, build: BuildResult, usedByFeature: string,
): any | null {
  // `between` is decomposed BEFORE any push, not after: resolveName()'s own
  // `between` branch finds sharedEdge() on the two faces' ORIGINAL shape,
  // and pushing THAT EDGE forward through a fillet asks its history a
  // question fillets do not answer reliably -- an edge merely bordering a
  // face the fillet trimmed (not the edge it actually rounded) can come
  // back IsDeleted() true even though it is untouched and geometrically
  // identical (measured 2026-09-04, reference.md's own round-then-bevel:
  // Round 1 on the box's top-front edge left the box's OWN top-back edge,
  // pushed this way, unresolvable). Pushing each FACE instead -- which is
  // exactly what item O's own fix already proved reliable, fillet's
  // Modified()/IsDeleted() history being accurate for faces -- and finding
  // sharedEdge() on the two RESULTS answers the same question without ever
  // asking a fillet about an edge's own fate. Recursive, not a single
  // level: each face name can itself need pushing through more than one
  // hop, the same as any other name here.
  if (name.cause === 'between') {
    const a = resolveNameAsUsedBy(oc, name.of[0], build, usedByFeature);
    const b = resolveNameAsUsedBy(oc, name.of[1], build, usedByFeature);
    return a && b ? sharedEdge(oc, a, b) : null;
  }
  const found = resolveName(oc, name, build);
  if (!found || name.feature === usedByFeature) return found;
  const chain = chainToFeature(build, name.feature, usedByFeature);
  if (chain === null || chain.length === 0) return found;
  return pushThrough(oc, chain, found, null);
}

/**
 * Find the face a name refers to on a built shape, or null.
 *
 * Null is a real answer and the caller must treat it as one: it means the
 * selection is lost, and lib/topo-name.ts's whyNameLost() exists to say why in
 * words a student can act on. Silently returning some other face would be the
 * behaviour that makes people distrust parametric CAD.
 */
export function resolveName(oc: Occt, name: TopoName, build: BuildResult): any | null {
  if (name.cause === 'primitive') {
    const shape = build.shapes.get(name.feature);
    return shape ? resolvePrimitiveFace(oc, shape, name.part) : null;
  }
  if (name.cause === 'carried' || name.cause === 'split') {
    // The ancestor is resolved on ITS OWN feature's shape -- the state of the
    // model before this operation ran -- and then pushed forward. Resolving it
    // against the result would be asking for the answer this function exists to
    // compute.
    const parent = resolveName(oc, name.of, build);
    if (!parent) return null;
    const chain = chainFor(build, name.feature, name.of.feature);
    if (!chain.length) return null;
    const discriminator = name.cause === 'split'
      ? { u: name.at.u, v: name.at.v, side: name.side } : null;
    return pushThrough(oc, chain, parent, discriminator);
  }
  if (name.cause === 'swept' || name.cause === 'rounded') {
    const rec = build.sweeps.get(name.feature);
    // `from` is checked rather than trusted: a name written against one sketch
    // and read back after the pull was retargeted at another refers to an edge
    // that exists but is not the one meant.
    if (!rec || rec.from !== name.from) return null;
    const want = name.cause === 'swept' ? 'edge' : 'corner';
    const at = name.cause === 'swept' ? name.edge : name.corner;
    const seg = rec.segments.find((s) => s.role === want && s.index === at);
    if (!seg) return null;
    return placed(oc, generatedFrom(oc, rec.op, seg.edge), rec.after);
  }
  if (name.cause === 'between') {
    // Both faces are resolved on the SAME built shape, and the edge is the one
    // they share. Nothing here knows or cares which edge index that is, which
    // is the entire point -- the same pair of face names finds the same edge on
    // a box of any size.
    const a = resolveName(oc, name.of[0], build);
    const b = resolveName(oc, name.of[1], build);
    return a && b ? sharedEdge(oc, a, b) : null;
  }
  if (name.cause === 'cap') {
    const rec = build.sweeps.get(name.feature);
    if (!rec) return null;
    return placed(oc, capOf(oc, rec.op, name.end, rec.closed), rec.after);
  }
  // made -- see the header. Returning null rather than guessing is the point.
  return null;
}

// ---- writing a name down ----------------------------------------------------
//
// The inverse direction, and it has to exist here rather than in
// lib/topo-name.ts: deciding whether a face was carried or split, and where its
// discriminator goes, is a question about real geometry.

/**
 * The name for a face that came through an operation without splitting.
 *
 * Returns null when the face was split instead, because `carried` would then be
 * a lie -- there are several faces with that history and the name would not say
 * which. The caller wants nameSplitPiece in that case, and the null is how it
 * finds out.
 */
export function nameCarried(
  oc: Occt,
  build: BuildResult,
  feature: string,
  of: TopoName,
): TopoName | null {
  const parent = resolveName(oc, of, build);
  if (!parent) return null;
  const chain = chainFor(build, feature, of.feature);
  if (!chain.length) return null;
  for (const rec of chain) {
    const fate = faceFate(oc, rec.op, parent);
    if (fate.kind === 'deleted' || fate.kind === 'split') return null;
  }
  return { cause: 'carried', feature, kind: of.kind, of };
}

/**
 * Which extreme of which world axis the chosen piece sits at, among its
 * siblings -- the `side` field on the 'split' cause. See that field's doc
 * comment in lib/topo-name.ts for why this is worth recording at all.
 *
 * The axis compared is whichever of x/y/z has the LARGEST spread among the
 * sibling centroids, so this adapts to whichever direction the cut actually
 * ran rather than assuming one. Returns undefined -- no side recorded, not a
 * failure -- when there is only one piece (nothing to rank against) or the
 * pieces do not separate along any axis by more than float noise (a
 * degenerate split not expected to occur in practice, but not worth
 * guessing at either).
 */
function siblingSide(
  oc: Occt, pieces: any[], piece: any,
): { axis: 0 | 1 | 2; dir: 'lo' | 'hi' } | undefined {
  if (pieces.length < 2) return undefined;
  const centres = pieces.map((p) => centroid(oc, p));
  let axis: 0 | 1 | 2 = 0;
  let spread = -1;
  for (let a = 0 as 0 | 1 | 2; a <= 2; a = (a + 1) as 0 | 1 | 2) {
    const vals = centres.map((c) => c[a]);
    const s = Math.max(...vals) - Math.min(...vals);
    if (s > spread) { spread = s; axis = a; }
  }
  if (spread < 1e-9) return undefined;
  const pieceIndex = pieces.findIndex((p) => p.IsSame(piece));
  if (pieceIndex < 0) return undefined;
  const val = centres[pieceIndex][axis];
  const isMin = centres.every((c, i) => i === pieceIndex || c[axis] >= val - 1e-9);
  return { axis, dir: isMin ? 'lo' : 'hi' };
}

/**
 * The name for one piece of a face an operation split.
 *
 * The discriminator is computed the same way it will later be read: a point
 * known to lie on the chosen piece, expressed in the parameter space of the
 * face as it entered the splitting operation. Both halves going through
 * pointOnFace and uvOnFace is what keeps them honest -- a name is only written
 * if the point that identifies it can actually be found and located.
 *
 * `side` is recorded alongside it -- see siblingSide() and the 'split'
 * cause's own doc comment in lib/topo-name.ts for what it is for. Both are
 * computed on the SAME `fate.pieces` from the SAME rebuild, which is what
 * keeps them honest with each other the same way `at` already is.
 *
 * Null means the piece could not be identified, and no name is better than a
 * name that will not resolve.
 */
export function nameSplitPiece(
  oc: Occt,
  build: BuildResult,
  feature: string,
  of: TopoName,
  piece: any,
): TopoName | null {
  const parent = resolveName(oc, of, build);
  if (!parent) return null;
  let cur = parent;
  for (const rec of chainFor(build, feature, of.feature)) {
    const fate = faceFate(oc, rec.op, cur);
    if (fate.kind === 'deleted') return null;
    if (fate.kind === 'kept' || fate.kind === 'replaced') {
      cur = fate.face;
      continue;
    }
    const on = pointOnFace(oc, piece);
    if (!on) return null;
    // Belt and braces: the point has to identify the piece uniquely among its
    // siblings, or the name would resolve to null the moment it was read back.
    if (!pieceContaining(oc, fate.pieces, on)) return null;
    const uv = fractionOnFace(oc, cur, on);
    if (!uv) return null;
    const side = siblingSide(oc, fate.pieces, piece);
    return { cause: 'split', feature, kind: of.kind, of, at: uv, ...(side ? { side } : {}) };
  }
  return null;
}

/**
 * Name an edge picked on the CURRENT top-level shape of `pickedFeature` --
 * which may be a bare primitive, or something built on top of one (a Move, a
 * Hole, ...) -- by finding which primitive feature and named face pair
 * actually produced it.
 *
 * WHY nameEdgeBetweenPrimitiveFaces() ALONE IS NOT ENOUGH. That function only
 * ever compares against a primitive's OWN untouched shape, which is exactly
 * right for an edge picked on a fresh Box or Cylinder and silent for anything
 * built on top of one. The moment even a Move sits on top, the picked shape's
 * faces are no longer IsSame() with the primitive's own --
 * BRepBuilderAPI_Transform relocates a face rather than reusing its identity
 * untouched, see the long comment on the 'move' branch in lib/occt-build.ts
 * -- so a direct comparison always misses, even though the model genuinely
 * still remembers where the edge came from.
 *
 * THE FIX RUNS resolveNameAsUsedBy() BACKWARDS, AS A SEARCH. That function
 * already knows how to push a stored primitive-face name FORWARD across
 * however many recorded operations sit between where it was written and
 * where it is used -- moves, booleans, whatever `ops` holds; it is what a
 * FilletFeature itself resolves against when it rebuilds (see
 * lib/occt-build.ts's 'fillet' branch). Naming a click is the same problem
 * read the other way: try every primitive this document could mean, push
 * each of its candidate face names forward to `pickedFeature`, and keep
 * whichever one lands on the exact face that was clicked. Bounded and
 * cheap -- at most (primitive count) x (3-6 faces per primitive)
 * resolutions, never a search over the model's whole geometry.
 *
 * NARROW ON PURPOSE, the same discipline nameEdgeBetweenPrimitiveFaces()
 * already follows. A face with no recorded path back to any primitive --
 * the new wall a Hole drills, the reflected half of a Mirror (only its
 * fuse is recorded as an op, not the reflecting transform that made the
 * second half -- see that branch's own comment), the seam where two
 * different primitives actually meet in a Combine -- returns null here
 * rather than a guess. That is the same refusal resolveName() already gives
 * for a `made` name: no answer is better than a confident wrong one.
 */
export function nameEdgeOnCurrentShape(
  oc: Occt,
  build: BuildResult,
  doc: { features: Array<{ id: string; kind: string }> },
  pickedFeature: string,
  edge: any,
): TopoName | null {
  const pickedShape = build.shapes.get(pickedFeature);
  if (!pickedShape) return null;
  const adjacent = facesOf(oc, pickedShape).filter((f) =>
    edgesOf(oc, f).some((e) => e.IsSame(edge)));
  if (adjacent.length !== 2) return null;

  const a = nameFaceOnCurrentShape(oc, build, doc, pickedFeature, adjacent[0]);
  const b = nameFaceOnCurrentShape(oc, build, doc, pickedFeature, adjacent[1]);
  return a && b ? { cause: 'between', feature: a.feature, kind: 'edge', of: [a, b] } : null;
}

/**
 * Name a FACE picked on the CURRENT top-level shape of `pickedFeature`, by
 * the same brute-force-but-bounded search nameEdgeOnCurrentShape() already
 * runs for each of an edge's two adjacent faces (see that function's own
 * doc comment for why the search direction has to run backwards from "try
 * every primitive" rather than forwards from the click) -- extracted here so
 * a face pick that never touches an edge (Hollow's "leave this face open",
 * a future Draft or Mirror picker) can resolve a name too, not only a Round.
 */
export function nameFaceOnCurrentShape(
  oc: Occt,
  build: BuildResult,
  doc: { features: Array<{ id: string; kind: string }> },
  pickedFeature: string,
  face: any,
): TopoName | null {
  const primitives = doc.features.filter(
    (f): f is { id: string; kind: 'box' | 'cylinder' } => f.kind === 'box' || f.kind === 'cylinder',
  );
  for (const prim of primitives) {
    if (!build.shapes.get(prim.id)) continue;
    for (const part of PRIMITIVE_FACE_PARTS[prim.kind]) {
      const candidate: TopoName = { cause: 'primitive', feature: prim.id, kind: 'face', part };
      const resolved = resolveNameAsUsedBy(oc, candidate, build, pickedFeature);
      if (resolved && resolved.IsSame(face)) return candidate;
    }
  }
  return null;
}
