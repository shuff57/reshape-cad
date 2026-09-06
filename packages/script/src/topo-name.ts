// Stable names for faces and edges, so a student's selection survives a rebuild.
//
// THE PROBLEM. A B-rep kernel gives you ADDRESSABLE faces. It does not give you
// PERSISTENT ones. Change an upstream dimension, the kernel rebuilds, and you
// get a fresh shape whose faces are in a fresh order. "Face 3" is not
// necessarily the face the student clicked. Every parametric CAD system has to
// solve this and it is the one FreeCAD lived with as its most notorious defect
// for over a decade. Adopting a kernel is the easy half; this file is the hard
// half.
//
// THE IDEA. A name is not a position in the result. It is a path through the
// history that PRODUCED the result. shCode has an unusual advantage here:
// ModelDoc is already an ordered list of features with stable string ids, which
// is exactly the substrate a naming scheme needs and what most CAD systems have
// to retrofit. Every face in the final solid has a first cause somewhere in
// that list, and the name is that cause written down.
//
//   e1.side[sk1.edge0]     the side face extrude e1 swept from sketch edge 0
//   e1.cap[top]            the face capping the top of that extrude
//   b1.face[+z]            the top face of box b1
//   op1.split[b1.face[+z], near(12.5,4)]
//                          a piece of that box face, cut into several by op1
//
// Read the last one carefully, because it is where the difficulty actually
// lives. A boolean does not merely keep or drop faces: it SPLITS them. One face
// goes in and three come out, and which of the three the student meant cannot
// be answered by the history alone -- the history says "all three came from
// b1.face[+z]". Something has to distinguish them.
//
// WHAT DISTINGUISHES A SPLIT PIECE. Not an ordinal. `split[..., 0]` is exactly
// the index-based naming this file exists to avoid: change an upstream number,
// the pieces come back in a different order, and the fillet jumps to a
// different piece of the same face. Instead a piece carries a geometric
// discriminator -- a point known to lie on it -- expressed in the PARENT
// face's own parameter space so it moves with the parent rather than with the
// world. On a rebuild the pieces are re-derived and the one containing that
// point wins.
//
// That is a heuristic and it is worth being honest about its failure mode: if
// a change is large enough that no piece contains the old point, the name does
// not resolve. That is a real limit, and the answer to it is not to guess. See
// the note on unresolvable names at the bottom.
//
// WHAT THIS FILE IS NOT. There is no kernel here. This is the algebra of names
// -- their shape, how they are written down, how they are read back, and what
// each feature kind is entitled to name. Resolution against real geometry is
// the next piece and it needs OpenCascade's Modified/Generated history maps.
// Keeping the two apart means the naming rules can be tested against
// arithmetic, the way lib/least-squares.ts is, rather than only against a
// running kernel.

/** Which of a shape's parts a name refers to. */
export type TopoKind = 'face' | 'edge' | 'vertex';

/**
 * A point that is known to lie on the thing being named, used only to tell
 * apart pieces that share a cause -- see the header.
 *
 * `u`/`v` are a FRACTION of the parent surface's parameter range -- 0 to 1
 * across the face -- not world coordinates and not raw parameters. Fractions
 * because stretching the model then moves the discriminator with the face it
 * belongs to, and because a raw parameter is a distance from whichever corner
 * the kernel chose to count from, which is not a thing anyone means. That
 * choice was measured, not argued: see the note above fractionOnFace() in
 * lib/topo-history.ts for the case where the raw form loses a selection.
 *
 * Rounded on purpose: two rebuilds of the same model should produce the same
 * name text, and raw floats do not.
 */
export interface OnPoint {
  u: number;
  v: number;
}

/** The generative causes a name can be built from. One per way a face or edge
 *  can come into existence in this app. */
export type TopoName =
  /** A face of a primitive, named by the direction it faces or its role.
   *  `b1.face[+z]`, `c1.face[side]`. Primitives have a fixed, knowable set. */
  | { cause: 'primitive'; feature: string; kind: TopoKind; part: string }
  /**
   * A face or edge an extrude or revolve swept from one sketch edge.
   * `e1.side[sk1.edge0]`.
   *
   * The sketch edge index is stable across a corner inserted SOMEWHERE ELSE
   * on the outline -- reindex() in lib/sketch-arc.ts shifts every index past
   * the seam so this one does not silently start meaning a neighbour.
   *
   * It is NOT stable across a corner inserted into THIS edge itself.
   * addCorner() splits one edge into two, and reindex()'s own rule -- shift
   * every index greater than the seam -- leaves the split edge's own number
   * on its first half by construction, since an edge is never greater than
   * itself. A name written against the whole original edge then silently
   * resolves to half of it with full confidence: measured, `swept edge:0`
   * on a 40-wide sketch side (wall centre x=20, area 480) after
   * addCorner(sk1, 0) resolves to x=10, area 240 -- see the case in
   * scripts/test-topo-resolve.mjs marked SKIP/UNTESTABLE for exactly this,
   * with the numbers. This is a known, unresolved limitation, not merely an
   * untested corner: fixing it needs a design-edge identity that survives
   * being split rather than only reindexed, which is a larger change than a
   * bug-fix pass carries. Do not repeat the old claim that this index is
   * simply stable -- it is stable against everything reindex() covers and
   * nothing more.
   */
  | { cause: 'swept'; feature: string; kind: TopoKind; from: string; edge: number }
  /** The face a sweep made from a ROUNDED OR CHAMFERED CORNER of its sketch.
   *  `e1.face[sk1.corner2]`.
   *
   *  This is not a fussy distinction from `swept`. Rounding a corner does not
   *  add a design edge -- the design still has four corners and four edges --
   *  it inserts a segment into the OUTLINE, between the two trim points the
   *  round leaves behind. Naming that face after an outline index would move it
   *  every time another corner was rounded, which is the whole failure this
   *  file exists to avoid. segmentRoles() in lib/sketch-arc.ts reads the two
   *  apart from the `basis` the outline already carries. */
  | { cause: 'rounded'; feature: string; kind: TopoKind; from: string; corner: number }
  /** The cap a sweep puts on its own end. `e1.cap[top]`. */
  | { cause: 'cap'; feature: string; kind: TopoKind; end: 'top' | 'bottom' }
  /** A part that came through an operation unchanged, keeping its identity.
   *  The common case for a boolean: most faces are untouched. */
  | { cause: 'carried'; feature: string; kind: TopoKind; of: TopoName }
  /**
   * One of several pieces an operation cut a single parent part into. The
   * discriminator, not an ordinal, is what tells the pieces apart.
   *
   * `side` is a SECOND, independent check alongside `at`, and it exists to
   * close a real hole in the first one -- see the long note above
   * fractionOnFace() in lib/topo-history.ts and pushThrough()'s use of it in
   * lib/topo-resolve.ts. `at` is anchored to the PARENT face alone, and a
   * parent that TRANSLATES relative to a tool that does not move looks, from
   * the parent's own local frame, exactly like one that GROWS -- the
   * fraction cannot tell those apart, and on a translate it can walk the
   * discriminator clean across the cut into the SIBLING piece. `at` alone
   * would then confidently return the wrong piece.
   *
   * `side` is which extreme of `axis` (0=x, 1=y, 2=z, in WORLD coordinates,
   * not the parent's parameter space) the chosen piece's centroid sat at
   * among ITS SIBLINGS, at the moment the name was written -- 'lo' if it was
   * the minimum, 'hi' if the maximum. That is information `at` cannot
   * recover by itself: `at` is a point ON the chosen piece and says nothing
   * about where the OTHER piece was. Resolving a name now requires BOTH
   * checks to agree -- the point must land on a piece, AND that piece must
   * still be the same extreme among its current siblings -- and refuses
   * (null) rather than guess when they disagree. That is strictly a
   * TIGHTENING: every case `at` alone resolved correctly still has `side`
   * agree, since nothing moved the pieces across the axis that mattered.
   *
   * Absent on a name that predates this field, or when the pieces had no
   * axis with enough spread to rank -- both fall back to `at` alone, which
   * is the pre-existing behaviour rather than a regression.
   */
  | {
    cause: 'split'; feature: string; kind: TopoKind; of: TopoName; at: OnPoint;
    side?: { axis: 0 | 1 | 2; dir: 'lo' | 'hi' };
  }
  /** A part that did not exist before this operation -- the wall a subtraction
   *  cuts, the seam a union makes. It has no ancestor to name, so it is named
   *  by its maker and located by a discriminator. */
  | { cause: 'made'; feature: string; kind: TopoKind; at: OnPoint }
  /**
   * An EDGE, named by the two faces that meet along it.
   *
   * Edges are what a fillet is applied to, and they are the part of a solid
   * with the least to hold on to: a box has twelve of them, they are
   * interchangeable to look at, and the kernel's own order over them is exactly
   * the thing this file refuses to depend on. But every edge is the meeting of
   * two faces, and faces are already nameable -- so an edge needs no new
   * mechanism, only the pair.
   *
   *   b1.edge[b1.face[+x] ^ b1.face[+z]]   the top-right edge of a box
   *
   * The pair is unordered: the edge where the top meets the right is the same
   * edge as where the right meets the top. formatName sorts the two so that a
   * name written either way round produces the same text, which is what makes
   * two rebuilds of the same model comparable as strings.
   */
  | { cause: 'between'; feature: string; kind: 'edge'; of: [TopoName, TopoName] };

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Write a name as text: stable, comparable, and readable in a message to a
 *  student. Two rebuilds of the same model must produce the same string, which
 *  is why the discriminator is rounded rather than raw. */
export function formatName(n: TopoName): string {
  const at = (p: OnPoint) => `near(${r4(p.u)},${r4(p.v)})`;
  switch (n.cause) {
    case 'primitive': return `${n.feature}.${n.kind}[${n.part}]`;
    case 'swept': return `${n.feature}.${n.kind}[${n.from}.edge${n.edge}]`;
    case 'rounded': return `${n.feature}.${n.kind}[${n.from}.corner${n.corner}]`;
    case 'cap': return `${n.feature}.cap[${n.end}]`;
    case 'carried': return `${n.feature}.same[${formatName(n.of)}]`;
    case 'split': {
      // `side` is appended only when present, so a name written before this
      // field existed formats exactly as it always did -- see the field's
      // own doc comment for why an absent side falls back rather than
      // regressing.
      const side = n.side ? `, ${n.side.dir}(${n.side.axis})` : '';
      return `${n.feature}.split[${formatName(n.of)}, ${at(n.at)}${side}]`;
    }
    case 'made': return `${n.feature}.made[${n.kind}, ${at(n.at)}]`;
    case 'between': {
      // Sorted, not written in the order the caller happened to pick the two
      // faces. An unordered pair with an ordered spelling is two names for one
      // edge, and the whole point of a name is that it compares.
      const pair = [formatName(n.of[0]), formatName(n.of[1])].sort();
      return `${n.feature}.edge[${pair[0]} ^ ${pair[1]}]`;
    }
  }
}

/** Human words for a PRIMITIVE face's own `part` -- "top"/"bottom" for a
 *  box or cylinder's +z/-z (matching the Top/Underneath view-strip preset
 *  words), "side" for a cylinder's own wraparound face. +x/-x/+y/-y are
 *  deliberately absent: which way is "front" or "left" depends on which way
 *  the camera happens to be facing, and this app already refuses to guess
 *  that anywhere else (see `partWordFor`'s own comment) -- printing the
 *  literal part name is the honest fallback, not a gap to fill in later. */
const PRIMITIVE_PART_WORDS: Record<string, string> = { '+z': 'top', '-z': 'bottom', side: 'side' };

/**
 * The single word (or two) a student-facing sentence uses for WHICH part of
 * a feature a name points at -- "top face", "edge" -- or null when the name
 * does not resolve to anything with its own part word.
 *
 * This is the ONE place that decision is made. SandboxWorkspace.tsx's
 * selection badge ("Box 1 · top face") and ModelEditor.tsx's Hollow note
 * ("Hollow 1 is open at the top face") both call this rather than each
 * carrying their own copy, specifically so the two can never drift apart --
 * measured 2026-09-04 as a real risk the first time this logic existed in
 * exactly one of them.
 *
 * `carried`/`split` are unwrapped first, exactly the way rootFeature() below
 * unwraps them to find which feature a name is rooted in -- a face an
 * operation passed through untouched (a box's own top face, after a Hole
 * drilled into its side and a Round on some other edge) is STILL a
 * primitive face for this purpose, even though its own immediate `.feature`
 * now names whichever operation last carried it forward. Measured
 * 2026-09-04: clicking that exact top face resolved (correctly) to the
 * Round feature as its OWNER (topological naming can only say who most
 * recently touched a face, not who originally made it, for `chosen`/
 * `pickedFaceUsable` purposes) with a `carried` name wrapping a `carried`
 * name wrapping the box's own `primitive` one -- and without this
 * unwrapping, Hollow silently built correctly open at that face (`open`
 * itself was never null) while its own note stayed silent about it, because
 * partWordFor() saw only the outermost `carried` cause and returned null.
 *
 * An edge (`between`) always says "edge", regardless of which two faces it
 * connects -- there is no finer word for an edge the way there is for a
 * face. A primitive face uses PRIMITIVE_PART_WORDS, falling back to the
 * literal part string for +x/-x/+y/-y (see that map's own comment for why
 * those are not guessed at). Anything else -- a hole's own wall, a round's
 * own filleted face, all of which have "no recorded path back to any
 * primitive" and so never carry a `primitive` or `between` cause even once
 * unwrapped -- returns null, the same "no answer is better than a
 * confidently wrong one" rule this file's own header states for names that
 * fail to resolve.
 */
export function partWordFor(n: TopoName | null | undefined): string | null {
  if (!n) return null;
  if (n.cause === 'carried' || n.cause === 'split') return partWordFor(n.of);
  if (n.cause === 'between') return 'edge';
  if (n.cause === 'primitive' && n.kind === 'face') {
    return `${PRIMITIVE_PART_WORDS[n.part] ?? n.part} face`;
  }
  return null;
}

/** The feature a name ultimately hangs off -- the earliest one in the chain.
 *  This is what a dependency check asks for: delete that feature and every
 *  name rooted in it is gone, which is a thing to say out loud rather than
 *  discover at rebuild time. */
export function rootFeature(n: TopoName): string {
  if (n.cause === 'carried' || n.cause === 'split') return rootFeature(n.of);
  // An edge between two faces can in principle root in two different features.
  // The first is reported, and featureChain() below is the honest answer when
  // the caller needs all of them -- a single root is a convenience, not a
  // complete description, and callers deciding what an edit disturbs should be
  // asking for the chain.
  if (n.cause === 'between') return rootFeature(n.of[0]);
  return n.feature;
}

/** Every feature id a name passes through, nearest cause first. Used to decide
 *  whether an edit can possibly have disturbed a selection: if none of these
 *  ids changed, the name did not need re-resolving at all. */
export function featureChain(n: TopoName): string[] {
  const out = [n.feature];
  if (n.cause === 'carried' || n.cause === 'split') out.push(...featureChain(n.of));
  if (n.cause === 'between') out.push(...featureChain(n.of[0]), ...featureChain(n.of[1]));
  return [...new Set(out)];
}

/**
 * Is this name still meaningful in this document?
 *
 * A structural check only -- it asks whether the features and sketch edges the
 * name refers to still exist, not whether the geometry still has such a face.
 * Cheap, runs without a kernel, and catches the common case: a student removed
 * the sketch corner that a filleted edge was swept from.
 */
export function nameIsStructurallyValid(
  n: TopoName,
  featureExists: (id: string) => boolean,
  sketchEdgeCount: (id: string) => number | null,
): boolean {
  if (!featureExists(n.feature)) return false;
  if (n.cause === 'swept' || n.cause === 'rounded') {
    // A closed outline has as many design edges as design corners, so one
    // count answers for both.
    const count = sketchEdgeCount(n.from);
    const at = n.cause === 'swept' ? n.edge : n.corner;
    if (count === null || at < 0 || at >= count) return false;
  }
  if (n.cause === 'carried' || n.cause === 'split') {
    return nameIsStructurallyValid(n.of, featureExists, sketchEdgeCount);
  }
  if (n.cause === 'between') {
    return n.of.every((f) => nameIsStructurallyValid(f, featureExists, sketchEdgeCount));
  }
  return true;
}

/**
 * Why a name no longer resolves, phrased for a student.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a name that cannot be resolved is
 * never silently dropped and never silently moved to a neighbour. Both are
 * worse than an error, because both look like the model quietly deciding
 * something on the student's behalf -- and a fillet that hops to a different
 * edge when you change an unrelated dimension is exactly the behaviour that
 * makes people distrust parametric CAD.
 *
 * Same contract as whyCannotRoundCorner() and whyRemovingCornerCosts() in
 * lib/sketch-arc.ts: say what was lost, say what caused it, and let the caller
 * decide what to do about it.
 */
export function whyNameLost(
  n: TopoName,
  featureExists: (id: string) => boolean,
  sketchEdgeCount: (id: string) => number | null,
  label: (id: string) => string,
): string | null {
  if (!featureExists(n.feature)) {
    return `That ${n.kind} was made by ${label(n.feature)}, which is no longer in the model.`;
  }
  if (n.cause === 'swept' || n.cause === 'rounded') {
    const count = sketchEdgeCount(n.from);
    if (count === null) {
      return `That ${n.kind} was pulled from ${label(n.from)}, which is no longer in the model.`;
    }
    const part = n.cause === 'swept' ? 'edge' : 'corner';
    const at = n.cause === 'swept' ? n.edge : n.corner;
    if (at < 0 || at >= count) {
      return `That ${n.kind} was pulled from ${part} ${at + 1} of ${label(n.from)}, `
        + `which now has only ${count} ${part}${count === 1 ? '' : 's'}.`;
    }
  }
  if (n.cause === 'carried' || n.cause === 'split') {
    return whyNameLost(n.of, featureExists, sketchEdgeCount, label);
  }
  if (n.cause === 'between') {
    // Either face going takes the edge with it, and the first reason found is
    // the one reported -- two reasons for one lost edge is more than a student
    // needs to act.
    for (const f of n.of) {
      const why = whyNameLost(f, featureExists, sketchEdgeCount, label);
      if (why) return why;
    }
  }
  return null;
}
