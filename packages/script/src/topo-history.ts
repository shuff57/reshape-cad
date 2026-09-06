// Asking an operation what became of a face.
//
// lib/topo-name.ts is the algebra of names and lib/topo-resolve.ts turns a name
// back into a face. This file is the one underneath both: the small set of
// OpenCascade calls that answer "this face went into the operation -- what came
// out?". It is separate because every one of these calls has a trap in it, and
// they are better collected in one file with the measurement written down than
// scattered through the resolver.
//
// WHAT A BOOLEAN DOES TO A FACE. Four outcomes, and the naming design in
// topo-name.ts is built around exactly these:
//
//   kept      Modified() empty, IsDeleted() false. The face came through
//             untouched and is literally the same face in the result.
//   replaced  Modified() has one entry. Same identity, new geometry -- a side
//             wall that gained a notch. This is `carried`.
//   split     Modified() has several. One face in, several out, and the
//             history alone cannot say which one the student meant. This is
//             `split`, and the discriminator is what tells them apart.
//   deleted   IsDeleted(). The face is gone and any name rooted in it is lost.
//
// Measured on this build, 2026-09-01, cutting a 10-wide groove across the top
// of a 40x40x20 box:
//
//   side x=0, x=40, bottom   kept
//   side y=0, y=40           replaced (each gained a notch)
//   TOP                      split into two, at x=-12.5 and x=+12.5
//
// WHAT A SWEEP DOES INSTEAD. A prism or a revolve does not modify faces, it
// GENERATES them: one profile edge in, one wall out, plus a cap at each end.
// That history is exact rather than discriminated, which is why a `swept` or
// `cap` name needs no near() point. The second half of this file covers it.
//
// SIX BINDING TRAPS, all of them found the hard way and none of them obvious
// from the error text. They are noted at each call site as well, because that
// is where the next person will be standing. Two of them -- the wire builder
// copying the edges you hand it, and a full revolve still offering caps it does
// not have -- return a plausible wrong answer rather than an error, which is
// the kind worth reading twice.

/** The slice of OpenCascade this file calls. Same deliberate looseness as
 *  lib/occt-build.ts -- see the note there. */
export interface Occt {
  [name: string]: any;
}

/** How far apart two points have to be before they count as different. The
 *  kernel's own modelling tolerance is 1e-7; this is a decimal order looser so
 *  a point that is genuinely ON a face is not rejected for floating-point
 *  noise. */
const ON_TOL = 1e-6;

/**
 * Every shape in one of OpenCascade's history lists.
 *
 * TRAP 1: `TopTools_ListIteratorOfListOfShape` is NOT bound in this build, and
 * neither is `TopTools_ListOfShape` -- the list is exported under its
 * NCollection name. There is no iterator at all. What the list does have is
 * Assign, First, RemoveFirst and (inherited, so it does not show in
 * getOwnPropertyNames) Size and IsEmpty.
 *
 * So the walk is destructive, over a COPY. Assigning into a fresh list first is
 * not defensive tidiness: `Modified()` hands back the algorithm's own list, and
 * emptying that would quietly destroy the history for every later query.
 *
 * TRAP 2: each element has to be `.clone()`d on the way out. The handle
 * `First()` returns points into the copy, and the very next `RemoveFirst()`
 * invalidates it.
 */
export function listShapes(oc: Occt, list: any): any[] {
  if (!list) return [];
  const copy = new oc.NCollection_List_TopoDS_Shape();
  copy.Assign(list);
  const out: any[] = [];
  while (!copy.IsEmpty()) {
    out.push(copy.First().clone());
    copy.RemoveFirst();
  }
  return out;
}

/** What an operation did to one face that went into it. */
export type Fate =
  | { kind: 'kept'; face: any }
  | { kind: 'replaced'; face: any }
  | { kind: 'split'; pieces: any[] }
  | { kind: 'deleted' };

/**
 * Ask one boolean (or fillet, or shell) what became of one face.
 *
 * This is the whole mechanism. Everything above it -- carrying a fillet across
 * a rebuild, telling a student their selection is gone -- is bookkeeping on top
 * of these four answers.
 *
 * IsDeleted() true does not end the question the way it used to. An open
 * hollow's own closing face is the case that forced this open: the face
 * itself does not survive (there is a hole where it was, not a modified
 * version of it), but BRepOffsetAPI_MakeThickSolid still GENERATES real
 * geometry from it -- the rim where the opening meets the part's own outer
 * wall -- and a between() name naming an edge at that rim needs exactly that
 * face to resolve pushForward against. Modified() answers "what did this
 * face become"; Generated() answers "what did this operation BUILD from a
 * face that itself did not persist" -- a different question IsDeleted()
 * being true does not settle either way, so Generated() is only tried once
 * Modified()'s own precondition (the face persisting at all) has already
 * failed. Zero results from Generated() is the same honest "genuinely gone"
 * answer this always returned; a fillet or a plain boolean simply never has
 * anything there, so this costs them nothing.
 */
export function faceFate(oc: Occt, op: any, face: any): Fate {
  if (!op || !face) return { kind: 'deleted' };
  let gone = false;
  try {
    gone = op.IsDeleted(face);
  } catch {
    // A face the operation never saw. Not an error worth throwing over: the
    // caller asked a reasonable question and the answer is "not mine".
    return { kind: 'deleted' };
  }
  if (gone) {
    let gen: any[] = [];
    try {
      gen = listShapes(oc, op.Generated(face));
    } catch {
      gen = [];
    }
    if (gen.length === 0) return { kind: 'deleted' };
    if (gen.length === 1) return { kind: 'replaced', face: gen[0] };
    return { kind: 'split', pieces: gen };
  }
  const mod = listShapes(oc, op.Modified(face));
  if (mod.length === 0) return { kind: 'kept', face };
  if (mod.length === 1) return { kind: 'replaced', face: mod[0] };
  return { kind: 'split', pieces: mod };
}

// ---- points and parameters --------------------------------------------------
//
// The discriminator that tells split pieces apart is a (u, v) in the PARENT
// face's parameter space -- see the header of lib/topo-name.ts for why it is
// not an ordinal. These four functions are how it is written down and read
// back.

/**
 * Where a world point lands in a face's parameter space, or null if it does
 * not lie on that face's surface at all.
 *
 * TRAP 3: out-parameters do not work the way opencascade.js documents them.
 * `LowerDistanceParameters({current:0}, {current:0})` leaves both wrappers at
 * zero and reports success -- a silent wrong answer, and (0, 0) is a plausible
 * enough parameter pair that it does not look wrong. `Parameters(1, u, v)`
 * RETURNS the pair instead, as `{ U, V }`. Measured: a point at world
 * (-12, 5) on a centred 40-box's top face is (8, 25), which is the corner-based
 * parameterisation and not the origin-based one.
 */
export function uvOnFace(oc: Occt, face: any, pnt: any): { u: number; v: number } | null {
  // TRAP 4, shared with lib/occt-build.ts: BRep_Tool.Surface wants a
  // TopoDS_Face. TopExp_Explorer hands out TopoDS_Shape, and the BindingError
  // it throws names the type it got but not the call that wanted it.
  const surf = oc.BRep_Tool.Surface(oc.TopoDS.Face(face));
  const proj = new oc.GeomAPI_ProjectPointOnSurf(pnt, surf, 1e-7);
  if (!proj.NbPoints || proj.NbPoints() < 1) return null;
  const uv = proj.Parameters(1, { current: 0 }, { current: 0 });
  if (!uv || typeof uv.U !== 'number') return null;
  return { u: uv.U, v: uv.V };
}

/** The world point at a raw (u, v) on a face. */
export function pointAt(oc: Occt, face: any, u: number, v: number): any {
  return new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true).Value(u, v);
}

/**
 * A face's own parameter range. Read off the adaptor rather than
 * BRepTools.UVBounds, whose out-parameters are subject to the same trap as
 * LowerDistanceParameters -- it leaves the wrappers at zero and reports
 * nothing wrong.
 */
function uvRange(oc: Occt, face: any): { u0: number; u1: number; v0: number; v1: number } {
  const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
  return {
    u0: ad.FirstUParameter(), u1: ad.LastUParameter(),
    v0: ad.FirstVParameter(), v1: ad.LastVParameter(),
  };
}

// A discriminator is stored as a FRACTION of the parent face's parameter range,
// not as a raw parameter. This is not a detail; it is the difference between
// the design working and not, and it was settled by measurement rather than
// argument.
//
// OpenCascade parameterises a box face from one of its corners, so a raw
// parameter is a distance from a corner the kernel picked and nobody chose.
// Measured: a bar 40 wide with a 10-wide slot across the top splits into pieces
// at x -20..-5 and x 5..20, whose raw u are 7.5 and 32.5. Widen the bar to 70
// and the corner moves. u=7.5 still lands on the left piece, because the left
// piece is the one touching that corner. u=32.5 lands at x=-2.5, which is
// inside the slot -- on no piece at all, so the name resolves to null and a
// student's fillet silently falls off the part.
//
// As a fraction both survive: 0.1875 and 0.8125 of the face's width land on the
// left and right pieces at 40, 70 and 26 wide. A fraction is also what a person
// means by "the left one" -- a relative position on the face -- where a raw
// parameter means "so many millimetres from an arbitrary corner", which nobody
// means.
//
// It has a failure mode of its own, and it is worth being precise about which
// one -- an earlier version of this note claimed only the honest half. A face
// that shrinks relative to the feature splitting it -- because it genuinely
// shrinks, or because it SLIDES past a cut that does not move, which looks
// identical from the face's own local frame -- drags the fraction toward and
// eventually off the intended piece. Off the edge of the piece into the
// material the cut removed, the answer is null, and that half was always
// honest. But push far enough and the SAME fraction can walk clean through
// that gap and land inside the SIBLING piece instead -- a confident, wrong
// answer, not a null one. Measured, not hypothetical: a box translating past
// a fixed groove does exactly this once it has moved about a third of the
// groove's own width beyond centre.
//
// That is why the 'split' cause carries a second field, `side` (see its own
// doc comment in lib/topo-name.ts), independent of the fraction: which
// extreme of which axis the chosen piece sat at among its siblings when the
// name was written. A piece the fraction finds has to ALSO still be that
// extreme among its current siblings, or the answer is null instead of the
// wrong piece -- see pushThrough() in lib/topo-resolve.ts. With that check in
// place the sentence above is true without qualification: every way this
// discriminator can miss now lands on null, never on a piece that was not
// meant.

/** Where a world point sits on a face, as a fraction of that face's own
 *  parameter range. Null if it does not lie on the face's surface. */
export function fractionOnFace(oc: Occt, face: any, pnt: any): { u: number; v: number } | null {
  const raw = uvOnFace(oc, face, pnt);
  if (!raw) return null;
  const r = uvRange(oc, face);
  const du = r.u1 - r.u0;
  const dv = r.v1 - r.v0;
  // A range of zero would be a degenerate face; 0.5 keeps the point in the
  // middle of nothing rather than producing an infinity.
  return {
    u: Math.abs(du) < 1e-12 ? 0.5 : (raw.u - r.u0) / du,
    v: Math.abs(dv) < 1e-12 ? 0.5 : (raw.v - r.v0) / dv,
  };
}

/** The inverse: the world point at a fraction of a face's parameter range.
 *  This is what makes a discriminator survive a rebuild -- the face is
 *  re-derived, its range comes back with it, and the same fraction lands in the
 *  same place relative to the face however the world has moved. */
export function pointAtFraction(oc: Occt, face: any, u: number, v: number): any {
  const r = uvRange(oc, face);
  return pointAt(oc, face, r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v);
}

/**
 * How far a world point is from a face, counting the face's trimmed boundary.
 *
 * This is the containment test, and it has to respect trimming: a point on the
 * top plane of the box but sitting over the groove is ON the surface and OFF
 * the face, and only the trimmed distance tells them apart.
 * `BRepClass_FaceClassifier` would be the direct way and is not bound in this
 * build; BRepExtrema_DistShapeShape measures to the trimmed face and answers
 * the same question.
 *
 * TRAP, the same shape as MakeFace(wire) in lib/occt-build.ts: the
 * THREE-argument constructor binds to an `Extrema_ExtFlag` overload whose enum
 * is not exported, and fails with "parameter 0 has unknown type
 * 15Extrema_ExtFlag" -- an error that names neither argument you passed. The
 * two-argument form is bound and works.
 */
export function distanceTo(oc: Occt, pnt: any, shape: any): number {
  const v = new oc.BRepBuilderAPI_MakeVertex(pnt).Vertex();
  return new oc.BRepExtrema_DistShapeShape(v, shape).Value();
}

/** Every edge of a shape. Used to find the profile edge a sketch segment
 *  became -- see the note on generatedFrom. */
export function edgesOf(oc: Occt, shape: any): any[] {
  const out: any[] = [];
  const exp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (exp.More()) {
    out.push(exp.Current().clone());
    exp.Next();
  }
  return out;
}

/** The one edge of `shape` that passes through a point, or null if none does
 *  or several do. Ambiguity is a refusal, for the same reason a split piece
 *  that two discriminators claim is a refusal. */
export function edgeThrough(oc: Occt, shape: any, pnt: any): any | null {
  const hits = edgesOf(oc, shape).filter((e) => distanceTo(oc, pnt, e) <= ON_TOL);
  return hits.length === 1 ? hits[0] : null;
}

// ---- sweeps -----------------------------------------------------------------
//
// A prism or a revolve does not modify faces the way a boolean does; it
// GENERATES them. One edge of the profile goes in and one wall of the solid
// comes out, and the two ends of the sweep are its caps. That is a cleaner
// history than a boolean's and it is why `swept` and `cap` names can be exact
// rather than discriminated.

/**
 * The single face a sweep generated from one profile edge, or null.
 *
 * TRAP, and it is the one that decides how the profile has to be built: the
 * edges you hand to BRepBuilderAPI_MakeWire are NOT the edges that end up in
 * the wire. The builder copies and reorients them to make the wire connected,
 * so asking Generated() about an edge you kept a reference to answers with an
 * empty list -- for every edge except, confusingly, the first, which is added
 * as-is. Measured: a four-sided profile answered 1, 0, 0, 0.
 *
 * The fix is not to keep the edges at all. Build the face, walk the edges back
 * OFF it, and match each one to its outline segment by a point known to lie on
 * it. That is order-independent as well as correct, which matters because
 * explorer order is exactly the thing this whole design refuses to depend on.
 */
export function generatedFrom(oc: Occt, op: any, edge: any): any | null {
  if (!op || !edge) return null;
  let made: any[] = [];
  try {
    made = listShapes(oc, op.Generated(edge));
  } catch {
    return null;
  }
  return made.length === 1 ? made[0] : null;
}

/**
 * The face capping one end of a sweep, or null.
 *
 * `closed` is not a convenience flag. A revolve that goes all the way round has
 * no caps -- the profile meets itself -- but FirstShape() and LastShape() still
 * return a face, and they return the PROFILE, which is not part of the solid at
 * all. Measured: a 90-degree revolve gives 6 faces with First and Last at
 * different places; the same profile at 360 gives 4 faces with First and Last
 * both at the profile's own centre. Handing that back would be a face the
 * student can never see, on a solid it is not part of.
 */
export function capOf(oc: Occt, op: any, end: 'top' | 'bottom', closed: boolean): any | null {
  if (!op || closed) return null;
  try {
    const s = end === 'top' ? op.LastShape() : op.FirstShape();
    return s && (!s.IsNull || !s.IsNull()) ? s : null;
  } catch {
    return null;
  }
}

/**
 * Run a kernel operation that is allowed to refuse.
 *
 * MEASURED, not defensive: OCCT reports a refusal two different ways and only
 * one of them is a return value. A fillet radius too big for its edge sets
 * IsDone() false; a draft on a face that cannot take one throws a
 * `WebAssembly.Exception` with no message, no stack into our code, and no type
 * beyond `Exception {}`. Body Draft hit the second on the first run and took
 * the whole build down with it -- one face that cannot lean should cost that
 * face, not the model.
 *
 * So both are funnelled to null, which is the answer the rest of this design
 * already knows how to handle: the feature does not build, and the caller says
 * why rather than shipping a shape the student did not ask for.
 */
function refusable(run: () => any | null): any | null {
  try {
    return run();
  } catch {
    return null;
  }
}

/**
 * The one edge two faces share, or null.
 *
 * This is all an edge name needs. A box has twelve edges, they are
 * indistinguishable to look at, and the kernel's order over them is exactly
 * what a name may not depend on -- but each one is the meeting of two faces,
 * and faces are already nameable. So the pair IS the name and this is the
 * whole of its resolution.
 *
 * IsSame rather than a geometric comparison: two faces of one solid share the
 * literal same edge, so identity is available and is stronger than proximity.
 * Null when they share none (opposite faces of a box) or several (which a
 * curved pair can genuinely do) -- both mean the name does not pick out one
 * edge, and refusing is the rule.
 */
export function sharedEdge(oc: Occt, a: any, b: any): any | null {
  if (!a || !b) return null;
  const ea = edgesOf(oc, a);
  const eb = edgesOf(oc, b);
  const hits: any[] = [];
  for (const x of ea) {
    for (const y of eb) {
      if (x.IsSame(y)) hits.push(x);
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Round one edge of a solid.
 *
 * The payoff of every naming slice before this one, and the reason the
 * refusal in .gauntlet/parity.json said "each needs face or edge selection on
 * a B-rep": rounding ONE edge is not a thing a mesh can express. What ships in
 * the app today is JSCAD's roundRadius, which rounds every edge of a box at
 * once and cannot be pointed at one.
 *
 * Measured against the analytic answer rather than a golden number: a fillet of
 * radius r along a straight edge of length L removes exactly
 * (1 - pi/4) * r^2 * L. On a 40x30x20 box, r=4 along the 30 edge: 103.009 in,
 * 103.009 out.
 *
 * ChFi3d_Rational is the surface family OCCT builds the blend from; it is the
 * ordinary choice and the only one of the three that is exact for a constant
 * radius on a straight edge.
 */
/** A fillet's result, plus the builder itself -- BRepFilletAPI_MakeFillet
 *  exposes the SAME IsDeleted()/Modified() history query interface a
 *  boolean's builder does (measured 2026-09-04: this kernel build binds all
 *  three of IsDeleted/Modified/Generated on it), so the caller can register
 *  it in BuildResult.ops exactly like occt-build.ts's own boolean() helper
 *  does -- see that function's own comment. Without this, a face nothing
 *  about the fillet touched (a box's own top face, after a Round on some
 *  other edge entirely) had NO recorded path forward at all: chainToFeature()
 *  never finds a hop into a fillet feature's own id, resolveNameAsUsedBy()
 *  falls back to the name resolved on its ORIGINAL pre-fillet shape, and
 *  IsSame() against the post-fillet tessellation fails -- fillet, unlike a
 *  boolean, does not reliably preserve untouched faces' own TShape identity,
 *  so the two are never "the same" object even though they are the same
 *  face. The practical cost: Hollow, opened at a face picked after a Round
 *  exists anywhere in the chain, silently built fully closed -- the pick
 *  still highlighted correctly (that path resolves the CURRENT tip's own
 *  face, not this one), but nameFaceOnCurrentShape() returned null for the
 *  SAME face when hollow() asked "which named face is this", so
 *  pickedFaceUsable stayed false and `open` was never passed to newShell(). */
export interface FilletResult {
  shape: any;
  op: any;
}

export function filleted(oc: Occt, shape: any, edge: any, radius: number): FilletResult | null {
  if (!shape || !edge || !(radius > 0)) return null;
  return refusable(() => {
    const mk = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    mk.Add(radius, oc.TopoDS.Edge(edge));
    mk.Build(new oc.Message_ProgressRange());
    // A radius the edge cannot take -- bigger than the faces beside it --
    // leaves IsDone false. Returning the unfilleted shape would silently
    // ignore the student; null is the caller's cue to say so.
    return mk.IsDone && !mk.IsDone() ? null : { shape: mk.Shape(), op: mk };
  });
}

/** Cut one edge off flat, at `distance` from it. The chamfer to filleted()'s
 *  round, and the same story: one named edge, not all of them. Returns the
 *  same shape+op pair, for the same reason -- see FilletResult's own doc
 *  comment; BRepFilletAPI_MakeChamfer shares its base class's history query
 *  interface with BRepFilletAPI_MakeFillet. */
export function chamfered(oc: Occt, shape: any, edge: any, distance: number): FilletResult | null {
  if (!shape || !edge || !(distance > 0)) return null;
  return refusable(() => {
    const mk = new oc.BRepFilletAPI_MakeChamfer(shape);
    mk.Add(distance, oc.TopoDS.Edge(edge));
    mk.Build(new oc.Message_ProgressRange());
    return mk.IsDone && !mk.IsDone() ? null : { shape: mk.Shape(), op: mk };
  });
}

/**
 * Tilt one face of a solid, so the part can leave a mould.
 *
 * `pull` is the direction the mould opens and `neutral` the plane that does not
 * move -- everything above it leans out, everything below leans in. Both are
 * required by the kernel and neither has a sensible default, so the caller
 * supplies them from the feature rather than this guessing.
 */
export function drafted(
  oc: Occt,
  shape: any,
  face: any,
  pull: [number, number, number],
  angleRad: number,
  neutralZ: number,
): any | null {
  if (!shape || !face) return null;
  return refusable(() => {
    const dr = new oc.BRepOffsetAPI_DraftAngle(shape);
    const plane = new oc.gp_Pln(
      new oc.gp_Pnt(0, 0, neutralZ),
      new oc.gp_Dir(pull[0], pull[1], pull[2]),
    );
    dr.Add(
      oc.TopoDS.Face(face),
      new oc.gp_Dir(pull[0], pull[1], pull[2]),
      angleRad,
      plane,
    );
    dr.Build(new oc.Message_ProgressRange());
    return dr.IsDone && !dr.IsDone() ? null : dr.Shape();
  });
}

/**
 * Put a face where its solid actually ended up.
 *
 * A sweep's output is sometimes moved afterwards -- a revolve on an offset
 * sketch plane is built at the origin and then translated. The transform shares
 * the underlying geometry rather than copying it, so the face the sweep
 * generated is NOT a face of the moved solid: measured, IsSame() against every
 * face of the moved solid is false, and the face sits where the solid used to
 * be. Applying the same transform to the face lands it exactly on the right
 * one. Skipping this would hand back a face floating in space, which is worse
 * than null because it looks like an answer.
 */
export function placed(oc: Occt, shape: any, trsf: any | null): any | null {
  if (!shape) return null;
  if (!trsf) return shape;
  return new oc.BRepBuilderAPI_Transform(shape, trsf, false).Shape();
}

/** Where a face's area is centred. Duplicated from lib/topo-resolve.ts rather
 *  than imported so that this file has no dependency of its own -- it is the
 *  bottom of the stack and both files above it use it. */
function centreOf(oc: Occt, face: any): any {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(face, g, false, false);
  return g.CentreOfMass();
}

/**
 * A world point KNOWN to lie on a face.
 *
 * The centre of area is the obvious candidate and is right for the rectangular
 * pieces a groove or a slot produces. It is not right in general: an L-shaped
 * piece, or one with a hole through the middle, centres somewhere that is not
 * on it. So the centre is CHECKED rather than assumed, and a grid over the
 * face's own parameter range is the fallback.
 *
 * Returning null when even the grid finds nothing is a real answer. A
 * discriminator that does not lie on the piece it is supposed to identify would
 * resolve to nothing later, and it is better to refuse to write the name than
 * to write one that is quietly dead.
 */
export function pointOnFace(oc: Occt, face: any): any | null {
  const c = centreOf(oc, face);
  if (distanceTo(oc, c, face) <= ON_TOL) return c;
  const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
  const u0 = ad.FirstUParameter();
  const u1 = ad.LastUParameter();
  const v0 = ad.FirstVParameter();
  const v1 = ad.LastVParameter();
  const N = 7;
  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= N; j++) {
      const p = ad.Value(u0 + ((u1 - u0) * i) / (N + 1), v0 + ((v1 - v0) * j) / (N + 1));
      if (distanceTo(oc, p, face) <= ON_TOL) return p;
    }
  }
  return null;
}

/**
 * Which of several pieces contains a point, or null.
 *
 * Null covers two different failures and deliberately does not distinguish
 * them here: no piece contains it (the change was big enough to move the
 * geometry out from under the name), or several do (the point landed on a
 * shared edge). Both mean the selection cannot be honoured, and the rule this
 * whole design exists to enforce is that a name which cannot be resolved is
 * never quietly moved to a neighbour.
 */
export function pieceContaining(oc: Occt, pieces: any[], pnt: any): any | null {
  const hits = pieces.filter((f) => distanceTo(oc, pnt, f) <= ON_TOL);
  return hits.length === 1 ? hits[0] : null;
}
