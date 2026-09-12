// packages/kernel/src/freecad-engine-adapter.ts
//
// FreeCAD half of the EngineAdapter seam (SPEC-engine-port.md §3.2, build
// sequence steps 7-9). v1 = full replay (§4 risk 1): every build() opens a
// fresh FreeCAD document and re-emits the whole ModelDoc as fresh FreeCAD
// commands, rather than diffing against the live session.
//
// SCOPE, deliberately narrower than a general port:
//   - Feature kinds built for real: box, cylinder, sphere (all via the
//     bridge's own proven sketch+pad path -- fc-commands.mjs has no
//     PartDesign::Box/Cylinder emitter, but its very first smoke test
//     (session-test.mjs) already proves a 40x40 rect sketch + Pad(20)
//     against this exact kernel, which is the pattern reused here),
//     sketch (translated via ./sketch-translate.js, plane 'xy' offset 0
//     only), extrude -> Pad, pocket, fillet, chamfer, and -- added in a
//     later pass, see docs/specs/SPEC-engine-port.md §6.1 -- cone, torus,
//     prism. Those three build via fc-commands.mjs's own native
//     PartDesign::Cone/Torus/Prism emitters (previously only string-level
//     tested, never run against a live kernel until this pass), each
//     verified against OcctEngineAdapter's own volume for the same doc.
//     prism's own emit.prism() used to hardcode a hexagon (`Polygon = 6`)
//     with no way to pass ModelDoc's `sides` field -- fixed with an
//     optional `sides` parameter, default 6, so every existing caller that
//     does not pass it is unaffected.
//   - pattern (linear + polar), added in a later pass -- see
//     docs/specs/SPEC-studio-canonical.md phase 2 -- via fc-commands.mjs's
//     own native PartDesign::LinearPattern/PolarPattern emitters (previously
//     proven only at the string level, engine/bridge/pattern-test.mjs).
//     Built in the target's own body, same "continue in the target's body"
//     convention as fillet/chamfer/extrude/pocket.
//     CLOSED (docs/specs/SPEC-coord-fix.md): this port used to REFUSE three
//     cases -- a rotated target (pattern axis co-rotates with the body
//     instead of staying world-frame), a non-'z' circular axis, and a
//     circular pattern of ANY primitive target (box, cylinder, sphere, cone,
//     torus, prism) -- all three traced to the same root cause, PartDesign's
//     pattern axis resolving in BODY-LOCAL space while ModelDoc's own
//     step/axis is always WORLD-frame. Fixed by a world-frame axis-proxy
//     sketch (fc-commands.mjs's axisSketchPy()/emit.patternAxis(), built from
//     body.Placement.inverse() * worldPlacement) passed to
//     linearPattern()/polarPattern() as `worldAxis` instead of the bare axis
//     string -- see the 'pattern' branch's own comment below for the
//     mechanism and SPEC-coord-fix.md for the real-kernel verification
//     (coord-fix-probe.mjs P1, load-bearing) that PolarPattern.Axis honours
//     the referenced line's base point, not just its direction, which is
//     what makes the circular-pattern-of-a-primitive case fixable this way.
//   - revolve / groove (docs/specs/SPEC-coord-fix.md): the profile sketch is
//     now built via fc-sketch.mjs's sketchNewOnOrigin(), attached to the
//     Body's own XZ_Plane origin datum (measured convention: local X = world
//     X, local Y = world Z) instead of the bare flat-XY sketch every other
//     translateSketch() caller uses -- see the 'revolve'/'groove' branches
//     below and latheProfileRefusal() for the profile-crosses-axis refusal
//     FreeCAD's own PartDesign::Revolution/Groove enforce that occt-build.ts
//     does not.
//   - shell (this pass): via fc-commands.mjs's native PartDesign::Thickness
//     emitter -- the third DressUp sibling of Fillet/Chamfer, so it reuses
//     the SAME Base=(base, subElementNames) tuple and resolveFace()'s own
//     picking. CANNOT build a fully-closed hollow (no `open` face): measured
//     directly against this kernel's own C++ (FeatureThickness.cpp,
//     TopoShapeExpansion.cpp), an empty face list either silently no-ops
//     (the PartDesign feature) or throws "Null input shape" (the raw OCCT
//     call) -- a real engine-level restriction this fork adds on top of
//     vanilla FreeCAD/OCCT's own MakeThickSolidByJoin, which occt-build.ts's
//     shell branch relies on accepting an empty closing list for its own
//     "no `open` -> closed" default. So on THIS engine, `f.open` absent or
//     unresolvable both refuse cleanly rather than build an unrequested
//     opening or fake a closed hollow this kernel cannot make -- see the
//     'shell' branch's own comment below.
//   - draft (this pass): via fc-commands.mjs's native PartDesign::Draft
//     emitter, SCOPED DOWN from DraftFeature's full design -- only a single
//     named face (`f.face`, not `whole: true` Body Draft) on a 'z' pull with
//     an UNROTATED target body. MEASURED directly against this kernel
//     (engine/bridge/draft-probe*.mjs): PartDesign::Draft.PullDirection
//     cannot be set to ANY explicit reference on this kernel build (a raw
//     sketch's V_Axis, a raw sketch's own edge, a real edge of the solid
//     itself, a PartDesign::Line datum, even the Body's own Origin Z_Axis
//     datum all fail identically), while its implicit default (body-local Z)
//     builds fine -- a genuine per-fork gap, same class as Thickness's own
//     "cannot build a fully-closed hollow" finding. NeutralPlane, unlike
//     PullDirection, DOES accept an explicit world-frame proxy sketch
//     (referenced via (sketchObj, ['']), not ['V_Axis']) and DOES honour a
//     genuine world offset, the same "honours the referenced object's own
//     world position" property SPEC-coord-fix.md's P1 already proved for
//     PolarPattern.Axis. Angle is passed through UNCHANGED -- cross-checked
//     against occt-build.ts's own drafted() (the SAME BRepOffsetAPI_
//     DraftAngle call) via freecad-draft.manual.mjs, not merely assumed from
//     DraftFeature's own doc-comment wording; see fc-commands.mjs's draft()
//     header for the negation this pass tried and measured WRONG.
//   - mirror (this pass): via fc-commands.mjs's native PartDesign::Mirrored
//     emitter. MirrorPlane -- an unknown going in, since this fork's other
//     plane/axis references split unpredictably per-feature (PolarPattern.
//     Axis and Draft's NeutralPlane DO honour a world-frame proxy sketch;
//     Draft's own PullDirection rejects every explicit reference tried) --
//     was PROBED FRESH against this kernel (engine/bridge/mirror-probe.mjs)
//     before writing this branch, rather than assumed from either sibling.
//     MEASURED: MirrorPlane joins NeutralPlane/PolarPattern.Axis's side of
//     that split -- it accepts (sketchObj, ['']) and genuinely honours the
//     proxy's own WORLD position (a proxy built at world x=0 on a body
//     placed at world x=20 produced a mirror reflecting through world x=0,
//     not the body's own local origin), so neutralPlane() is reused
//     directly rather than duplicated. The branch reproduces occt-build.ts's
//     own documented "mirror through the target's own near bounding-box
//     face along the axis, not the world origin" contract by building that
//     proxy at the target's measured near-face WORLD coordinate. Also
//     MEASURED: PartDesign::Mirrored keeps BOTH the original and its
//     reflection fused into one Shape by construction (a
//     FeatureTransformedPattern, the same family as LinearPattern/
//     PolarPattern, not a DressUp) -- Shape.Volume comes back as exactly 2x
//     the original, so no separate boolean fuse is needed here the way
//     occt-build.ts's own mirror branch (BRepAlgoAPI_Fuse) requires. See the
//     'mirror' branch's own comment below for the full account.
//   - move (this pass): via fc-commands.mjs's native moveBody()/
//     copyBodyMoved() -- a plain Body.Placement translation, NOT a rebuild of
//     any feature geometry. FreeCAD's Body.Shape is only ever the Placement
//     frame applied to the underlying feature shape AT READ TIME, so a move
//     needs zero of the naming machinery the OCCT engine's own 'move' branch
//     requires (occt-build.ts records an OpRecord specifically so a name
//     written before a move still resolves after it) -- a name written
//     against this body before a move still resolves correctly afterward
//     for free. `copy: false` reuses the SAME bodyName/objName as the
//     target (only the frame moved, in place); `copy: true` duplicates the
//     whole Body (doc.copyObject, ~11 objects for one Pad-based body:
//     sketch, pad, 3 axes, 3 planes, 2 origins, body) and gets a NEW
//     bodyName/objName, leaving the original untouched and top-level (see
//     topLevel()'s own `f.kind === 'move' && !f.copy` check in
//     model-types.ts). Refuses (rather than silently moving too much) when
//     the target's Body.Tip is not the target's own object -- something was
//     already built on top of it in the same body, and moving the body
//     would move that later feature too -- and when a copy's offset is
//     exactly zero (the copy would sit exactly on the original with nothing
//     to distinguish it). See the 'move' branch's own comment below and
//     findPrimitiveAncestor()/findSketchAncestor()'s own `move` case for how
//     naming survives through a `copy: false` move but deliberately returns
//     null through a `copy: true` one (the duplicate's body-local geometry
//     is byte-identical to the original's, so resolving a name through it
//     would silently attribute a pick on one copy to the other).
//   - combine (this pass): CLOSES SPEC-engine-port.md §6.1's stale claim that
//     combine "needs multi-body support v1 doesn't have" -- it needs none.
//     PartDesign::Boolean exists on this kernel but has its own coordinate-
//     frame bug (places the tool at its world position but reads the base
//     body-local); Part::Fuse/Cut/Common -- document-level features taking
//     two finished Body shapes directly -- read both bodies' world
//     placements correctly with zero coordinate work and leave both input
//     Bodies untouched and reusable. See fc-commands.mjs's own
//     partBoolean() header and the 'combine' branch below for the full
//     account.
//   - hole (this pass, docs/specs/SPEC-hole.md): occt-build.ts's own
//     "sugar over cylinder + subtract" -- but built here as ONE
//     PartDesign::Pocket per drill plane, cut from an unattached,
//     world-positioned circle-profile sketch, NOT as a Part::Cut the way
//     `combine` above builds its own booleans. A Part::Cut result sets
//     `container: 'part'`, and notInABody() would then refuse the app's own
//     documented flagship chain (reshape-docs.ts:139, "box -> hollow -> hole
//     -> round(edge)") the instant a later PartDesign feature tried to build
//     on the hole. FreeCAD's own PartDesign::Hole was tried and rejected too
//     -- three silent-wrong-answer bugs measured against this kernel (drill
//     direction ignored on 2 of 3 axes, a multi-circle profile under-drilled,
//     a coned bottom instead of flat), all reporting 'Up-to-date' with no
//     error. The Pocket-from-a-profile-sketch design stays fully native
//     (inside the target's own Body, no `container` field needed) and
//     reuses the same world-frame proxy formula
//     (body.Placement.inverse() * worldPlacement) already proven for
//     PolarPattern.Axis/Draft's NeutralPlane/Mirrored's MirrorPlane, here as
//     a PROFILE for the first time rather than a REFERENCE. See the 'hole'
//     branch's own comment below and fc-commands.mjs's bore() header for the
//     full measured account (SPEC-hole.md).
//   - Everything else -- wedge, blend --
//     throws a clear "not yet supported on the FreeCAD engine: <kind>", per
//     step 7's own instruction, rather than silently building the wrong
//     shape. wedge specifically was investigated and rejected, not
//     merely unstarted: fc-commands.mjs's emit.wedge() only ever sets
//     PartDesign::Wedge's Width and Height, with no parameter for ModelDoc's
//     own WedgeFeature.depth at all -- a found mismatch of the same kind
//     revolve/groove used to have, not something this pass can close by
//     guessing a property mapping.
//   - v1 is SINGLE-BODY-PER-CHAIN: every primitive/sketch starts its own
//     fresh PartDesign::Body, and only extrude/pocket/fillet/chamfer -- which
//     all take a `target` naming an earlier feature -- continue building
//     inside THAT feature's own body. combine joins two independent chains
//     by building a document-level Part:: object OUTSIDE any Body instead
//     (see `container: 'part'` on FcBuiltFeature and notInABody() below) --
//     the one place a ModelDoc feature does not live in a PartDesign::Body.
//   - Edge naming for fillet/chamfer, inside build() itself, tries a
//     `between` name over two `primitive`-cause faces of the SAME fresh
//     box/cylinder feature first (resolvePrimitiveEdgeName(), matching
//     topo-resolve.ts's own nameEdgeBetweenPrimitiveFaces() vocabulary --
//     '+x'/'-x'/'+y'/'-y'/'+z'/'-z'/'side'), then -- added in the sketch-
//     naming pass below -- a `between` name over two sketch-derived
//     (`swept`/`rounded`/`cap`) faces of the SAME Pad, via the general
//     resolveEdge() this file's own EngineAdapter methods use for picking.
//     Anything else -- an edge from a carried or split face -- reports a
//     per-feature refusal (EngineBuildResult.refusals) rather than
//     guessing, the same "no answer is better than a confidently wrong
//     one" rule topo-resolve.ts's own header states.
//
// Picking (resolveFace/resolveEdge/nameFace/nameEdge, plus faceSize/
// edgeLength) is now implemented -- §4 risk 3, narrowed to exactly the
// causes this adapter's own feature set can produce and verify:
//
//   - `primitive` face names (a box/cylinder's own +x/-x/.../side faces) --
//     resolved geometrically (direction-of-centre + area tiebreak, the same
//     scoring resolvePrimitiveEdgeName() already proved) against whichever
//     FreeCAD object is CURRENTLY on screen for that primitive's chain, not
//     against a frozen historical shape.
//   - `between` edge names over two `primitive` faces of the SAME
//     box/cylinder -- reuses resolvePrimitiveEdgeName() directly, both for
//     the fillet-build path (already existed) and now for the general
//     resolveEdge()/nameEdge() picking path too.
//   - A face/edge picked on a Fillet/Chamfer's OWN result still resolves
//     to a `primitive` name when it is an untouched flat face (the
//     direction scorer runs against the CURRENT shape, so a face the round
//     did not touch is still found); the round's OWN new curved face
//     correctly returns null -- no `primitive` part scores as "this is it"
//     for a surface that is not axis-flat, matching topo-name.ts's own
//     documented rule that a round's own face has no primitive lineage.
//
// SKETCH-DERIVED (Pad) naming -- `swept`/`rounded`/`cap` -- is now also
// implemented (SPEC-studio-canonical.md phase 3), closing the gap the
// paragraph above used to describe as unscheduled design work. Neither
// option that paragraph raised (a second FreeCAD-specific "what came from
// what" tracker, or FreeCAD's own Generated()/Modified() Python API) turned
// out to be necessary -- a real-kernel MEASUREMENT was enough instead: a
// PartDesign::Pad's own Shape.Faces, queried by name directly off that SAME
// frozen object (never the owning Body or a later feature's current tip),
// comes back in a stable, predictable order (wall 0..n-1 in the profile's
// own outlineOf()/segmentRoles() order, then the bottom cap, then the top
// cap) that survives whatever is built on top of it later in the same
// Body -- see FcSweepInfo's own header for the exact measurement and the
// design this enables:
//   - resolveFace/resolveEdge (a stored name -> a face) always query the
//     extrude's OWN object directly and trust FcSweepInfo's cached ORDINAL
//     Face index -- no kernel round trip, safe specifically because that
//     object never changes once built.
//   - nameFace/nameEdge (a picked face -> a name) may be picking on a LATER
//     feature (a Fillet, a Pocket) whose own current Face order is NOT
//     ordinally stable (measured: two of a Pad's own untouched walls swap
//     position once a Pocket is added on top) -- so these instead identify
//     each wall/cap GEOMETRICALLY, via a point known to lie on it, checked
//     against the CURRENT shape with Part.Vertex(...).distToShape(...) --
//     the same "point known to lie on it" technique topo-history.ts's own
//     pointOnFace()/distanceTo() already use on the OCCT side, for the same
//     reason (querySketchGeometry(), findSketchAncestor()).
// Verified against the real kernel
// (packages/kernel/test/freecad-sketch-picking.manual.mjs, 88/88): a
// rectangle Pad's 4 walls + 2 caps and all 12 edges name and round-trip; a
// rounded-corner Pad's arc wall names `rounded` (the rest `swept`); a
// Fillet was built for real from a pick on a sketch-derived wall edge (this
// required generalizing build()'s OWN internal fillet-edge resolver too,
// which previously only ever tried resolvePrimitiveEdgeName()); a
// pad-then-pocket chain's untouched walls still name when picked on the
// POCKET's own current shape, while the pocket's own new hole geometry
// stays an honest null.
//
// NARROWED, deliberately, not merely unfinished: a POCKET's own newly-cut
// faces (its hole's wall, its floor) are never nameable, on purpose -- this
// matches OCCT's OWN scope for the identical case (occt-build.ts's pocket
// branch records no sweep history either, "a cut's faces come from the
// boolean, not the prism"), so this is parity with the other engine, not a
// gap. A circle-shaped sketch profile has no `sweep` cached at all (no
// per-edge/per-corner vocabulary to name a circular Pad's one wall after).
// A concave sketch's own cap point (the outline's vertex-average) is not
// guaranteed to land inside the polygon -- same limitation
// topo-history.ts's own pointOnFace() centroid heuristic already documents
// for OCCT; every fixture measured here is convex. A negative-bulge
// (clockwise) rounded corner's own wall midpoint is unverified against the
// real kernel (only the positive-bulge/CCW fixture was measured). See
// docs/specs/SPEC-engine-port.md §6.2a for the full account, including a
// real, previously-shipped sign bug in sketch-translate.ts's own
// origin-pinning helper found (and fixed) while building this
// verification -- unrelated to naming itself, but blocking it.
//
// A second real internal fix this required: faceAt()/edges() used to return
// a BARE "Face{n}"/"Edge{n}" string with no record of which FreeCAD object
// it came from. That was fine for mesh()'s own consumer (which never round-
// trips the handle back into the kernel) but cannot answer faceSize()/
// edgeLength()/nameFace()/nameEdge() -- those need to know WHICH object's
// Shape to run getElement() against, and a bare "Face3" is ambiguous the
// moment more than one FreeCAD object exists (always true past the first
// feature). Both now return an FcElementRef ({objName, name}) instead --
// still `unknown` at the EngineAdapter boundary (BrepViewportThree.tsx never
// inspects the shape of a face/edge handle, only passes it back into this
// SAME adapter's own methods), so this is an internal representation fix,
// not an interface change.
//
// SAVE/OPEN .FCStd (SPEC-studio-canonical.md phase 4) -- saveDocument()/
// openDocument() below. save is a real, independently-openable FreeCAD
// document (verified against the real kernel: a fresh session's
// openDocument() on the saved bytes reproduces the identical mesh volume),
// PLUS the original ModelDoc embedded as JSON in the document's own Comment
// property, so open can round-trip anything this adapter saved exactly. Open
// REFUSES (returns null) for any `.FCStd` it did not save itself -- an
// arbitrary real-world FreeCAD file has no ModelDoc-shaped history at all,
// and guessing one from its native Part/PartDesign tree would silently
// misrepresent the model -- see engine-adapter.ts's own doc comment on these
// two methods for the full reasoning, and this port's own report for the
// probe that measured Comment (and Meta) actually surviving a save/open
// round trip on this kernel build before committing to the design.

import type { Feature, ModelDoc, MoveFeature, SketchFeature, Vec3 } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type * as THREE_NS from 'three';
import { createFcSession } from '@shuff57/reshape-engine/fc-session';
import { attachCommands } from '@shuff57/reshape-engine/fc-commands';
import { attachSketchCommands } from '@shuff57/reshape-engine/fc-sketch';
import { attachDrawingCommands } from '@shuff57/reshape-engine/fc-drawing';
import { loadFreeCadEngine } from '@shuff57/reshape-engine/load-browser';
import { translateSketch, type SketchSession } from '@shuff57/reshape-engine/sketch-translate';
import { arcFromBulge, circleOf, outlineOf, segmentRoles } from '@shuff57/reshape-sketch/sketch-arc';
import type { DrawingOptions, DrawingView, EngineAdapter, EngineBuildResult, EngineMesh } from './engine-adapter.js';
import type { FaceRange } from './occt-three.js';

/** The slice of the bridge session (fc-session.mjs core + fc-commands.mjs +
 *  fc-sketch.mjs, all attached) this adapter calls. Loose by the same
 *  discipline occt-build.ts's `Occt` uses -- the bridge is plain .mjs with
 *  no .d.ts of its own. */
export interface FcSessionLike extends SketchSession {
  /** The raw Emscripten module -- exportDrawing() needs FS.writeFile/
   *  readFile/unlink directly, the same portable-channel access
   *  saveDocument()/exportStl() already use inside fc-session.mjs itself;
   *  everything else on this interface stays at the higher session.*()
   *  level. */
  Module: { FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void } };
  newDocument(name?: string): void;
  exec(code: string): { rc: number; out: string };
  read(code: string): any;
  saveDocument(fcstdPath?: string): Uint8Array;
  openDocument(bytes: Uint8Array, fcstdPath?: string): string;
  meshFaces(objName?: string | null, deflection?: number): {
    object?: string;
    faces: Array<{ id: number; positions: number[]; indices: number[] }>;
    edges: Array<{ id: number; points: number[] }>;
    volume?: number;
    empty?: boolean;
  };
  newBody(name?: string): string;
  sketchNew(bodyName: string, sketchName: string): string;
  sketchAddRectangle(sk: string, x1: number, y1: number, x2: number, y2: number): number[];
  sketchRect(bodyName: string, sketchName: string, width: number, height: number): string;
  sketchCircle(bodyName: string, sketchName: string, radius: number, cx?: number, cy?: number): string;
  pad(bodyName: string, sketchName: string, padName: string, length: number): string;
  pocket(bodyName: string, sketchName: string, pocketName: string, length: number): string;
  sphere(bodyName: string, featName: string, radius: number): string;
  cone(bodyName: string, featName: string, radius1: number, radius2: number, height: number): string;
  torus(bodyName: string, featName: string, ringRadius: number, tubeRadius: number): string;
  prism(bodyName: string, featName: string, radius: number, height: number, sides?: number): string;
  fillet(bodyName: string, baseName: string, edgeNames: string[], radius: number): string;
  chamfer(bodyName: string, baseName: string, edgeNames: string[], size: number): string;
  thickness(bodyName: string, baseName: string, faceNames: string[], value: number): string;
  linearPattern(
    bodyName: string, featureName: string, count: number, step: number, axis?: 'x' | 'y' | 'z',
    patternName?: string, worldAxis?: { origin: Vec3; direction: Vec3 } | null,
  ): string;
  polarPattern(
    bodyName: string, featureName: string, count: number, angle?: number, axis?: 'x' | 'y' | 'z',
    patternName?: string, worldAxis?: { origin: Vec3; direction: Vec3 } | null,
  ): string;
  revolve(bodyName: string, sketchName: string, revName: string, angle?: number): string;
  groove(bodyName: string, sketchName: string, featName: string, angle?: number): string;
  patternAxis(bodyName: string, axisName: string, origin: Vec3, direction: Vec3): string;
  sketchNewOnOrigin(bodyName: string, sketchName: string, planeRole?: string): string;
  neutralPlane(bodyName: string, sketchName: string, origin: Vec3, direction: Vec3): string;
  draft(bodyName: string, baseName: string, faceName: string, angleDegrees: number, neutralSketchName: string): string;
  mirrored(bodyName: string, baseName: string, planeSketchName: string, mirrorName?: string): string;
  moveBody(bodyName: string, offset: Vec3): string;
  copyBodyMoved(bodyName: string, offset: Vec3): { bodyName: string; tipName: string };
  bodyTip(bodyName: string): string | null;
  partBoolean(op: 'union' | 'subtract' | 'intersect', baseName: string, toolName: string, resultName: string): string;
  bore(bodyName: string, sketchName: string, pocketName: string, radius: number,
       worldCenters: Vec3[], worldOrigin: Vec3, worldAxis: Vec3, depth: number): string;
  exportDrawing(opts: {
    objName: string; sheetPath: string; outPath: string;
    views: DrawingView[]; projection: 'first-angle' | 'third-angle';
    scale: number | null; hiddenLines: boolean;
    area: [number, number, number, number]; titleblock: [number, number];
  }): { ok: boolean; reason: string | null; scale: number | null; views: Array<{ name: string; type: string }>; bbox: [number, number, number, number] | null };
}

/** One built feature's FreeCAD identity: which Body it lives in, the name of
 *  its own DocumentObject, and whether that object is a solid ('solid') or
 *  a flat profile ('sketch') -- mesh() only ever meshes the former. This is
 *  the concrete type behind EngineBuildResult.shapes's `unknown` values;
 *  every other adapter method that receives one back casts to it, exactly
 *  the discipline occt-engine-adapter.ts documents for its own BuildResult. */
export interface FcBuiltFeature {
  bodyName: string;
  objName: string;
  kind: 'solid' | 'sketch';
  /** The ModelDoc feature id that produced this entry and its Feature.kind --
   *  carried along so resolvePrimitiveEdgeName() can check a `between`
   *  name's own `.feature` against the RIGHT primitive without a second
   *  lookup into `doc.features`. */
  featureId: string;
  featureKind: Feature['kind'];
  /** Present only on an 'extrude' entry whose profile sketch is a
   *  non-circular outline (outlineOf() succeeded, circleOf() did not) --
   *  see FcSweepInfo's own header for what this makes nameable and why. */
  sweep?: FcSweepInfo;
  /** Absent (the norm) = `bodyName` names a real PartDesign::Body and a
   *  PartDesign feature can be built inside it. 'part' = a DOCUMENT-LEVEL
   *  Part::Cut/Fuse/Common (a combine result) where bodyName === objName and no
   *  Body exists at all. MEASURED: session.fillet()/session.thickness() on one
   *  raise "'Part.Feature' object has no attribute 'newObject'" -- gate on this
   *  BEFORE the call (notInABody()), never catch the kernel's AttributeError. */
  container?: 'part';
}

/** One outline segment of a Pad's own profile sketch, matched to its wall's
 *  ordinal position -- see FcSweepInfo's own header for the measurement this
 *  is built on. `at` is a point KNOWN TO LIE ON this wall's own surface, at
 *  local z = height/2 (never z=0 or z=height, which are the CAPS' own planes
 *  and would make the point ambiguous between a wall and a cap) -- used only
 *  by querySketchGeometry() to identify this wall on a shape OTHER than the
 *  extrude's own frozen object (a later fillet/chamfer/pocket's current
 *  tip), where ordinal Face position is no longer reliable (see this file's
 *  header on the measured reordering). */
interface FcSweepSegment {
  role: 'edge' | 'corner';
  index: number;
  faceIndex: number;
  at: [number, number];
}

/**
 * What a Pad needs remembered about its own profile sketch to name a wall
 * (`swept`/`rounded`) or a cap (`cap`) later -- the FreeCAD-specific
 * counterpart of occt-build.ts's SweepRecord, cached on the extrude's OWN
 * FcBuiltFeature entry rather than in a side map, since nothing else in this
 * adapter needs to look one up by feature id alone.
 *
 * MEASURED, not assumed (real-kernel script against fc-kernel-pd-final, see
 * this port's own report): for a Pad built from an n-segment outline
 * (outlineOf()'s own segment order, straight or arc alike), the Pad's OWN
 * `Shape.Faces` -- queried against THAT SAME FROZEN OBJECT, by name, never
 * against the owning Body or a later feature's current tip -- comes back in
 * EXACTLY this order: wall for segment 0, wall for segment 1, ..., wall for
 * segment n-1, then the bottom cap (the profile's own z=0 plane), then the
 * top cap (z=height). This holds for a plain rectangle (n=4), a rectangle
 * with one rounded corner (n=5, the arc's own wall landing at exactly its
 * emission position with a Cylinder surface type), and continues to hold on
 * the Pad's OWN object even after a LATER feature (a Pocket, measured) is
 * built on top of it in the same Body -- a PartDesign feature object's own
 * `.Shape` is frozen at whatever it computed to and does not get rewritten
 * by a later feature in the chain (the same fact this file's own `mesh()`
 * header already relies on for Body.Placement). It is exactly why
 * `resolveFace`/`resolveEdge` (below) can use this ordinal mapping directly,
 * with no further geometry: they always query `objName` (this Pad's own
 * object), never the current tip.
 *
 * The SAME measurement also found the ordering is NOT stable on the BODY's
 * (or any later feature's) own CURRENT `Shape.Faces` once something is built
 * on top -- e.g. after a Pocket, two of the Pad's own untouched walls
 * appeared at different ordinal positions than before, and the modified
 * bottom cap moved position too. So `nameFace`/`nameEdge` (picking, where
 * the clicked object can be ANY later feature in the chain) do NOT trust
 * this ordinal mapping directly -- they use `at`/`capAt`, a point known to
 * lie on the intended face, checked geometrically against the CURRENT
 * object's Faces via `Part.Vertex(...).distToShape(...)` (querySketchGeometry
 * below), the same "point known to lie on it" technique
 * lib/topo-history.ts's own pointOnFace()/distanceTo() already use on the
 * OCCT side for exactly the same reason (never trust kernel-assigned face
 * order across a rebuild).
 *
 * NARROWED, honestly, not guessed past: `circleOf(sketch)` sketches (no
 * outline segments to name a wall after) have no `sweep` at all -- a circular
 * profile's Pad/Pocket has no nameable wall or cap under this scheme, same
 * "no answer over a wrong one" rule as everywhere else in this file. A
 * NEGATIVE-bulge (clockwise-wound) rounded corner's own wall midpoint angle
 * is UNVERIFIED against the real kernel -- only a positive-bulge (CCW)
 * fixture was measured (same caveat sketch-translate.ts's own header already
 * states for the identical arc-orientation question). `capAt` is the
 * outline's own vertex-average, which is a reliable interior point for a
 * convex (or mildly non-convex) polygon but is NOT guaranteed to lie inside
 * a genuinely concave one -- same documented limitation as
 * lib/topo-history.ts's own pointOnFace() centroid heuristic; a concave
 * sketch's cap would come back an honest null rather than a wrong face, not
 * a crash, but this pass did not add topo-history.ts's own grid-search
 * fallback for it.
 */
interface FcSweepInfo {
  /** The ModelDoc sketch feature id this Pad's profile came from -- checked
   *  against a `swept`/`rounded` name's own `.from` before trusting it. */
  from: string;
  segments: FcSweepSegment[];
  /** Ordinal position of the bottom (z=0) and top (z=height) cap on the
   *  Pad's OWN object -- always `segments.length` and `segments.length + 1`
   *  respectively, per the measurement above; kept as explicit fields rather
   *  than recomputed at every call site. */
  bottomFaceIndex: number;
  topFaceIndex: number;
  /** A point on each cap's own interior, at z=0 for bottom / z=height for
   *  top -- see this interface's own header for the concave-polygon caveat. */
  capAt: [number, number];
  height: number;
}

/** A FreeCAD face/edge handle: which object's Shape it lives on, plus its
 *  own "Face{n}"/"Edge{n}" sub-element name. Bare name strings are ambiguous
 *  past the first built object (see this file's own header) -- every method
 *  that hands a face/edge to a caller, or receives one back, uses this
 *  instead. Still `unknown` at the EngineAdapter boundary (see engine-
 *  adapter.ts): nothing outside this file inspects the shape. */
interface FcElementRef {
  objName: string;
  name: string;
}

const num = (v: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`${what}: expected a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
};

const pyStr = (s: string): string => JSON.stringify(String(s));

const OUT_PATH = '/tmp/reshape_out.json';

const BOX_PARTS = new Set(['+x', '-x', '+y', '-y', '+z', '-z']);
const CYLINDER_PARTS = new Set(['+z', '-z', 'side']);

/** Prefix stamped on the ORIGINAL ModelDoc JSON before it is stashed in
 *  App::Document.Comment (see saveDocument()/openDocument() below) -- lets
 *  openDocument() tell "this is a ModelDoc this adapter wrote" apart from an
 *  arbitrary real .FCStd file whose own author happened to write a Comment
 *  that is coincidentally valid JSON (a real, if unlikely, risk with no
 *  prefix check at all). Not a security boundary, just a cheap sanity gate
 *  before JSON.parse -- the version/features shape check right after it is
 *  what actually decides the file is trustworthy. */
const MODELDOC_MARKER = 'RESHAPE_MODELDOC_V1:';

// ---- exportDrawing() -------------------------------------------------------
//
// The app owns the sheet template (SPEC-techdraw-export.md's "Skip
// `freecad:editable` entirely" finding -- EditableTexts round-trips through
// the kernel correctly but PageResult comes back with the placeholder
// UNCHANGED, so the substitution has to happen here, before the kernel ever
// sees the file, not through FreeCAD's own GUI-only text-edit machinery).

const SHEET_PATH = '/tmp/reshape-sheet.svg';
const OUT_SVG = '/tmp/reshape-drawing.svg';

interface SheetSpec {
  width: number;
  height: number;
  /** [x0,y0,x1,y1] mm, SVG (Y-down) coords -- the full usable area inside
   *  the sheet's own margin, titleblock still included. */
  frame: [number, number, number, number];
  /** Titleblock's own top-left corner, SVG coords -- bottom-right of the
   *  sheet, so this is always the frame's own (fx1 - tbWidth, fy1 - tbHeight). */
  titleblock: [number, number];
  template: string;
}

const escapeXml = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A minimal, self-drawn sheet: border + a bottom-right titleblock box with
 *  {{TITLE}}/{{SCALE}}/{{DATE}} tokens -- substituted by fillTitleBlock()
 *  below, JS-side, before the kernel ever reads the file (see this file's
 *  own header note on why kernel-side substitution does not work). `width`/
 *  `height` are REAL attributes (not just a viewBox) -- the kernel's own
 *  DrawSVGTemplate reads the page size from them; a template missing them
 *  silently produces a zero-size page. */
function makeSheet(width: number, height: number, tbWidth = 120, tbHeight = 30): SheetSpec {
  const margin = 10;
  const frame: [number, number, number, number] = [margin, margin, width - margin, height - margin];
  const titleblock: [number, number] = [frame[2] - tbWidth, frame[3] - tbHeight];
  const [tbX, tbY] = titleblock;
  const template =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">\n` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" stroke="none"/>\n` +
    `<rect x="${margin}" y="${margin}" width="${width - 2 * margin}" height="${height - 2 * margin}" fill="none" stroke="#000000" stroke-width="0.5"/>\n` +
    `<rect x="${tbX}" y="${tbY}" width="${tbWidth}" height="${tbHeight}" fill="none" stroke="#000000" stroke-width="0.5"/>\n` +
    `<text x="${tbX + 4}" y="${tbY + 10}" font-family="sans-serif" font-size="5">{{TITLE}}</text>\n` +
    `<text x="${tbX + 4}" y="${tbY + 20}" font-family="sans-serif" font-size="4">Scale {{SCALE}}</text>\n` +
    `<text x="${tbX + 4}" y="${tbY + 28}" font-family="sans-serif" font-size="3.5">{{DATE}}</text>\n` +
    `</svg>\n`;
  return { width, height, frame, titleblock, template };
}

const SHEETS: Record<NonNullable<DrawingOptions['sheet']>, SheetSpec> = {
  'A4-landscape': makeSheet(297, 210, 120, 30),
  'A3-landscape': makeSheet(420, 297, 160, 36),
  'USLetter-landscape': makeSheet(279.4, 215.9, 120, 30),
};

/** Substitute {{TITLE}}/{{DATE}} always; {{SCALE}} only when a value is
 *  given. Leaving it out when `scale` is falsy is deliberate -- see
 *  exportDrawing()'s own comment: autoscale means the real number is not
 *  known until the kernel returns it, so the token has to SURVIVE into the
 *  composed bytes for one final substitution afterward, not be replaced
 *  with an empty string now. */
function fillTitleBlock(template: string, values: { title: string; scale: string; date: string }): string {
  let out = template
    .replace(/\{\{TITLE\}\}/g, escapeXml(values.title))
    .replace(/\{\{DATE\}\}/g, escapeXml(values.date));
  if (values.scale) out = out.replace(/\{\{SCALE\}\}/g, escapeXml(values.scale));
  return out;
}

/** "1:1" / "2:1" / "1:2" engineering-drawing scale notation. */
function formatScale(scale: number): string {
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  return scale >= 1 ? `${round3(scale)}:1` : `1:${round3(1 / scale)}`;
}

export class FreeCadEngineAdapter implements EngineAdapter {
  private session: FcSessionLike | null = null;
  private loadPromise: Promise<void> | null = null;

  /** `loadModule` defaults to the browser loader (load-browser.mjs) but is
   *  constructor-injected so tests (and any future Node caller) can pass
   *  fc-session-node.mjs's loadNodeKernel() instead -- same discipline
   *  occt-engine-adapter.ts's own constructor-injected `THREE` follows. */
  constructor(
    private readonly THREE: typeof THREE_NS,
    private readonly loadModule: () => Promise<unknown> = loadFreeCadEngine,
  ) {}

  async load(): Promise<void> {
    if (this.session) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const Module = await this.loadModule();
        const session = attachDrawingCommands(attachSketchCommands(attachCommands(createFcSession(Module)))) as FcSessionLike;
        this.session = session;
      })();
    }
    return this.loadPromise;
  }

  private requireSession(): FcSessionLike {
    if (!this.session) throw new Error('FreeCadEngineAdapter: load() has not completed');
    return this.session;
  }

  // ---- build ---------------------------------------------------------------

  build(doc: ModelDoc): EngineBuildResult {
    const session = this.requireSession();
    session.newDocument('reshape');

    const shapes = new Map<string, unknown>();
    const refusals = new Map<string, string>();
    const built = new Map<string, FcBuiltFeature>();
    // Which rotation (ModelDoc's own f.rotate, [0,0,0] when absent/identity)
    // each Body was placed with -- set alongside setBodyPlacement() below.
    // USED TO be read by the 'pattern' branch to refuse a rotated target
    // (PartDesign's pattern axis used to resolve through the Body's OWN
    // Origin datum, body-local, so a rotated body would silently repeat
    // along its own tilted axis) -- CLOSED by the world-frame axis-proxy fix
    // (docs/specs/SPEC-coord-fix.md, see the 'pattern' branch's own comment),
    // which makes the axis genuinely world-frame regardless of body rotation.
    // No remaining reader; kept (not deleted) since setBodyPlacement() still
    // threads it through and a future per-body rotation query may want it.
    const bodyRotate = new Map<string, Vec3>();

    let bodyCounter = 0;
    const freshBody = (): string => {
      const name = `Body${++bodyCounter}`;
      session.newBody(name);
      return name;
    };

    const requireBuilt = (id: string, forWhat: string): FcBuiltFeature => {
      const b = built.get(id);
      if (!b) throw new Error(`cannot build ${forWhat}: its target '${id}' was not built`);
      return b;
    };

    for (const f of doc.features) {
      if (f.kind === 'box') {
        const bodyName = freshBody();
        const [w, d, h] = f.size;
        const sketchName = `${f.id}_sk`;
        session.sketchNew(bodyName, sketchName);
        session.sketchAddRectangle(
          sketchName,
          -w / 2, -d / 2,
          w / 2, d / 2,
        );
        const padName = `${f.id}_pad`;
        session.pad(bodyName, sketchName, padName, h);
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -h / 2, bodyRotate);
        const entry: FcBuiltFeature = { bodyName, objName: padName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'cylinder') {
        const bodyName = freshBody();
        const sketchName = `${f.id}_sk`;
        session.sketchCircle(bodyName, sketchName, f.radius, 0, 0);
        const padName = `${f.id}_pad`;
        session.pad(bodyName, sketchName, padName, f.height);
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -f.height / 2, bodyRotate);
        const entry: FcBuiltFeature = { bodyName, objName: padName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'sphere') {
        const bodyName = freshBody();
        const featName = `${f.id}_sph`;
        session.sphere(bodyName, featName, f.radius);
        this.setBodyPlacement(session, bodyName, f.center, undefined, 0, bodyRotate);
        const entry: FcBuiltFeature = { bodyName, objName: featName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'cone') {
        // PartDesign::Cone is a frustum (Radius1 at its own local z=0,
        // Radius2 at z=height); Radius2=0 tapers it to a point, matching
        // occt-build.ts's coneOf() (base full radius at z=0, apex at
        // z=height) exactly. Centred the same way as cylinder/prism --
        // built at local z in [0,height], then re-centred by localZShift.
        const bodyName = freshBody();
        const featName = `${f.id}_cone`;
        session.cone(bodyName, featName, f.radius, 0, f.height);
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -f.height / 2, bodyRotate);
        const entry: FcBuiltFeature = { bodyName, objName: featName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'torus') {
        // PartDesign::Torus is already centred on its own local origin, flat
        // in its own XY plane -- same as occt-build.ts's BRepPrimAPI_MakeTorus
        // (no z-shift needed), so this follows sphere's placement exactly:
        // localZShift 0, center/rotate applied directly to the Body.
        const bodyName = freshBody();
        const featName = `${f.id}_torus`;
        session.torus(bodyName, featName, f.ringRadius, f.tubeRadius);
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, 0, bodyRotate);
        const entry: FcBuiltFeature = { bodyName, objName: featName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'prism') {
        // PartDesign::Prism's own vertex convention (a vertex at angle 0, the
        // polygon built from a Circumradius) already matches occt-build.ts's
        // own prism branch -- that file's own comment says so directly, this
        // is not a re-derivation. Centred the same way as cylinder/cone: the
        // solid sits at local z in [0,height], re-centred by localZShift.
        const bodyName = freshBody();
        const featName = `${f.id}_prism`;
        const sides = Math.max(3, Math.min(12, Math.round(f.sides)));
        session.prism(bodyName, featName, f.radius, f.height, sides);
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -f.height / 2, bodyRotate);
        const entry: FcBuiltFeature = { bodyName, objName: featName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'sketch') {
        const sk: SketchFeature = f;
        if ((sk.plane ?? 'xy') !== 'xy' || (sk.offset ?? 0) !== 0) {
          throw new Error(
            `not yet supported on the FreeCAD engine: sketch on plane '${sk.plane ?? 'xy'}'`
              + `${sk.offset ? ` at offset ${sk.offset}` : ''} -- only plane 'xy' at offset 0 is built today`,
          );
        }
        const bodyName = freshBody();
        const sketchName = `${f.id}_sk`;
        session.sketchNew(bodyName, sketchName);
        translateSketch(session, sketchName, sk);
        const entry: FcBuiltFeature = { bodyName, objName: sketchName, kind: 'sketch', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'extrude') {
        const src = requireBuilt(f.target, `extrude ${f.id}`);
        if (src.kind !== 'sketch') throw new Error(`cannot build extrude ${f.id}: '${f.target}' is not a sketch`);
        const padName = `${f.id}_pad`;
        session.pad(src.bodyName, src.objName, padName, f.height);
        const srcSketch = doc.features.find((x) => x.id === f.target) as SketchFeature | undefined;
        const sweep = srcSketch ? this.buildSweepInfo(srcSketch, f.height) : undefined;
        const entry: FcBuiltFeature = { bodyName: src.bodyName, objName: padName, kind: 'solid', featureId: f.id, featureKind: f.kind, sweep };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'pocket') {
        const target = requireBuilt(f.target, `pocket ${f.id}`);
        const into = requireBuilt(f.into, `pocket ${f.id}`);
        if (target.kind !== 'sketch') throw new Error(`cannot build pocket ${f.id}: '${f.target}' is not a sketch`);
        {
          const why = this.notInABody(into, f.id, 'a pocket');
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, into);
            shapes.set(f.id, into);
            continue;
          }
        }
        if (target.bodyName !== into.bodyName) {
          throw new Error(`not yet supported on the FreeCAD engine: pocket ${f.id} cuts across two different bodies`);
        }
        const pocketName = `${f.id}_pocket`;
        session.pocket(into.bodyName, target.objName, pocketName, f.depth);
        const entry: FcBuiltFeature = { bodyName: into.bodyName, objName: pocketName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'fillet') {
        const target = requireBuilt(f.target, `${f.style} ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build ${f.style} ${f.id}: '${f.target}' is not a solid`);
        {
          const why = this.notInABody(target, f.id, `a ${f.style}`);
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
        }
        // Primitive edges first (resolvePrimitiveEdgeName's own direct scope,
        // unchanged); a sketch-derived (swept/rounded/cap) `between` pair
        // falls through to the generalized resolveEdge() this port's own
        // sketch-picking phase added -- it resolves independently off the
        // name's own `.feature` (always the extrude ancestor, by
        // construction), so it works here with no ancestor walk of its own.
        // The objName match is a safety guard, not decoration: a fillet's
        // own PartDesign::Fillet.Base must name a sub-element of `target`'s
        // OWN object, and resolveEdge() has no reason to know that -- a
        // mismatch (which should not arise for a direct, un-chained fillet,
        // the only case this pass verified) is refused rather than fed to
        // the kernel as a cross-object reference.
        let edgeName: string | null = this.resolvePrimitiveEdgeName(session, target, f.edge);
        if (!edgeName) {
          const resolved = this.resolveEdge(f.edge, { shapes: built }) as FcElementRef | null;
          if (resolved && resolved.objName === target.objName) edgeName = resolved.name;
        }
        if (!edgeName) {
          refusals.set(
            f.id,
            `${f.id}'s edge could not be found on the FreeCAD engine -- only an edge between two named `
              + `faces of a fresh box/cylinder primitive, or two named walls/caps of a sketch-derived Pad, `
              + `resolves today; ${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        let resultName: string;
        try {
          resultName = f.style === 'chamfer'
            ? session.chamfer(target.bodyName, target.objName, [edgeName], f.size)
            : session.fillet(target.bodyName, target.objName, [edgeName], f.size);
        } catch (e) {
          const verb = f.style === 'chamfer' ? 'Chamfering' : 'Rounding';
          refusals.set(
            f.id,
            `${verb} ${f.id} at ${f.size} would not fit its edge -- ${f.id} is shown without it. `
              + `(${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: target.bodyName, objName: resultName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'pattern') {
        // fc-commands.mjs carries native PartDesign::LinearPattern/
        // PolarPattern emitters (engine/bridge/pattern-test.mjs proves them
        // at the string level). Built in the SAME body as the target,
        // matching fillet/chamfer/extrude/pocket's own "continue in the
        // target's body" convention.
        //
        // CLOSED (docs/specs/SPEC-coord-fix.md): this used to refuse a
        // rotated target, a non-'z' circular axis, and a circular pattern of
        // ANY primitive target -- all three traced to one root cause.
        // occt-build.ts's own pattern branch is explicit that BOTH modes
        // work in WORLD coordinates -- linear moves by a literal world-frame
        // vector, circular orbits a line through the WORLD origin along
        // f.axis, regardless of where the target sits, how it is rotated, or
        // what kind of primitive it is. FreeCAD's LinearPattern/
        // PolarPattern instead resolve their Direction/Axis through a
        // DocumentObject, which the OLD code below resolved via the owning
        // Body's OWN Origin datum (Body.Origin.X_Axis/Y_Axis/Z_Axis) -- a
        // line fixed at BODY-LOCAL (0,0,0), which co-rotates with
        // Body.Placement and has no knowledge of where Placement will later
        // put the body in the world. Passing a world-frame axis-proxy sketch
        // (fc-commands.mjs's axisSketchPy()/emit.patternAxis(), built from
        // body.Placement.inverse() * worldPlacement) as `worldAxis` instead
        // fixes all three at once: the axis line now genuinely sits at the
        // WORLD origin along the WORLD axis, regardless of the target
        // body's own rotation, so `bodyRotate` (still tracked above, no
        // longer read here) no longer needs to gate anything, non-'z' axes
        // work the same way 'z' does, and a primitive's local geometry no
        // longer needs to sit away from the axis for the pattern to be
        // non-degenerate -- verified against the real kernel
        // (coord-fix-probe.mjs P1, load-bearing): PolarPattern.Axis honours
        // the referenced line's WORLD base point, not just its direction.
        const target = requireBuilt(f.target, `pattern ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build pattern ${f.id}: '${f.target}' is not a solid`);
        {
          const why = this.notInABody(target, f.id, 'a pattern');
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
        }

        if (f.count < 1) {
          refusals.set(f.id, `${f.id} needs at least one copy -- ${f.id} is shown without it.`);
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        const AXIS_VEC: Record<'x' | 'y' | 'z', Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
        const patternName = `${f.id}_pattern`;
        let resultName: string | null = null;

        if (f.mode === 'linear') {
          const step = f.step ?? [0, 0, 0];
          const AXES: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
          const nonzero = AXES.map((_, i) => i).filter((i) => Math.abs(step[i]) > 1e-9);
          if (nonzero.length > 1) {
            refusals.set(
              f.id,
              `${f.id} could not be built on the FreeCAD engine -- a linear pattern step along more than `
                + `one world axis at once is not yet supported; ${f.id} is shown without it.`,
            );
          } else {
            const idx = nonzero[0] ?? 0;
            const axis = AXES[idx];
            // Signed, not absolute -- FreeCAD's own Length is a plain
            // Quantity and a negative value reverses direction along the
            // datum axis's positive sense (verified against the real
            // kernel, see this port's own report). i = 0..count-1, so the
            // total span from first to last instance is step*(count-1),
            // matching occt-build.ts's own `moved(oc, src, step[axis]*i)`.
            const length = step[idx] * (f.count - 1);
            resultName = session.linearPattern(
              target.bodyName, target.objName, f.count, length, axis, patternName,
              { origin: [0, 0, 0], direction: AXIS_VEC[axis] },
            );
          }
        } else {
          const axis = f.axis ?? 'z';
          resultName = session.polarPattern(
            target.bodyName, target.objName, f.count, f.totalAngle ?? 360, axis, patternName,
            { origin: [0, 0, 0], direction: AXIS_VEC[axis] },
          );
        }

        if (resultName === null) {
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: target.bodyName, objName: resultName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'revolve') {
        // CLOSED (docs/specs/SPEC-coord-fix.md): occt-build.ts's own
        // revolveProfileFace() lays a flat 'xy'-plane sketch's (u,v) into the
        // plane spanned by {sketch-U, plane-normal} = world {X, Z} and spins
        // about the normal = world Z. Reproduced by attaching the profile
        // sketch to the Body's own XZ_Plane origin datum (fc-sketch.mjs's
        // sketchNewOnOrigin(), measured convention: local X = world X, local
        // Y = world Z) instead of the bare flat-XY sketch translateSketch()
        // otherwise lands on -- translateSketch() itself is unmodified, it
        // only ever emits local (x,y) geometry and is plane-agnostic.
        const src = requireBuilt(f.target, `revolve ${f.id}`);
        if (src.kind !== 'sketch') throw new Error(`cannot build revolve ${f.id}: '${f.target}' is not a sketch`);
        const srcSketch = doc.features.find((x) => x.id === f.target) as SketchFeature | undefined;
        if (!srcSketch || (srcSketch.plane ?? 'xy') !== 'xy' || (srcSketch.offset ?? 0) !== 0) {
          throw new Error(`not yet supported on the FreeCAD engine: revolve ${f.id} on a sketch plane other than 'xy' at offset 0`);
        }
        const why = this.latheProfileRefusal(srcSketch, f.id);
        if (why) {
          refusals.set(f.id, why);
          built.set(f.id, src);
          shapes.set(f.id, src);
          continue;
        }
        const revSketchName = `${f.id}_rsk`;
        session.sketchNewOnOrigin(src.bodyName, revSketchName, 'XZ_Plane');
        translateSketch(session, revSketchName, srcSketch);
        const revName = `${f.id}_rev`;
        try {
          session.revolve(src.bodyName, revSketchName, revName, f.angle ?? 360);
        } catch (e) {
          refusals.set(
            f.id,
            `Spinning ${f.id} through ${f.angle ?? 360} degrees did not produce a solid -- `
              + `${f.id} is shown without it. (${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, src);
          shapes.set(f.id, src);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: src.bodyName, objName: revName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'groove') {
        // Subtractive counterpart of revolve -- same orientation fix, cut
        // from the `into` target's own body instead of building a fresh one.
        const src = requireBuilt(f.target, `groove ${f.id}`);
        const into = requireBuilt(f.into, `groove ${f.id}`);
        if (src.kind !== 'sketch') throw new Error(`cannot build groove ${f.id}: '${f.target}' is not a sketch`);
        {
          const why = this.notInABody(into, f.id, 'a groove');
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, into);
            shapes.set(f.id, into);
            continue;
          }
        }
        if (src.bodyName !== into.bodyName) {
          throw new Error(`not yet supported on the FreeCAD engine: groove ${f.id} cuts across two different bodies`);
        }
        const srcSketch = doc.features.find((x) => x.id === f.target) as SketchFeature | undefined;
        if (!srcSketch || (srcSketch.plane ?? 'xy') !== 'xy' || (srcSketch.offset ?? 0) !== 0) {
          throw new Error(`not yet supported on the FreeCAD engine: groove ${f.id} on a sketch plane other than 'xy' at offset 0`);
        }
        const why = this.latheProfileRefusal(srcSketch, f.id);
        if (why) {
          refusals.set(f.id, why);
          built.set(f.id, into);
          shapes.set(f.id, into);
          continue;
        }
        const grvSketchName = `${f.id}_gsk`;
        session.sketchNewOnOrigin(into.bodyName, grvSketchName, 'XZ_Plane');
        translateSketch(session, grvSketchName, srcSketch);
        const grooveName = `${f.id}_grv`;
        try {
          session.groove(into.bodyName, grvSketchName, grooveName, f.angle ?? 360);
        } catch (e) {
          refusals.set(
            f.id,
            `Cutting ${f.id} out of ${f.into} did not remove anything -- ${f.id} is shown `
              + `without it. (${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, into);
          shapes.set(f.id, into);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: into.bodyName, objName: grooveName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'shell') {
        // PartDesign::Thickness -- the third DressUp sibling of Fillet/
        // Chamfer (PROPERTY_SOURCE(PartDesign::Thickness, PartDesign::
        // DressUp), FeatureThickness.cpp), so its Base is the same
        // (base, subElementNames) tuple fillet/chamfer already use, and this
        // branch resolves f.open through resolveFace() exactly the way the
        // 'fillet' branch above resolves f.edge through resolveEdge() --
        // same objName-matches-target safety check, same refusal-not-throw
        // discipline.
        //
        // CANNOT match occt-build.ts's own "no `open` -> fully closed"
        // default. MEASURED directly against this kernel's own C++, not
        // assumed: FeatureThickness.cpp's execute() early-returns the
        // UNCHANGED base shape (no exception raised, State stays
        // 'Up-to-date') the instant Base's sub-element list is empty, and
        // the underlying TopoShape::makeElementThickSolid
        // (TopoShapeExpansion.cpp) throws "Null input shape" if it is ever
        // reached with zero faces at all -- a real engine-level restriction
        // in this fork, not vanilla FreeCAD/OCCT's MakeThickSolidByJoin
        // (which occt-build.ts's own shell-branch comment notes DOES accept
        // an empty closing list, and which is exactly what that file's own
        // "no `open` -> closed" default and its "`open` given but
        // unresolved -> falls back to closed" behavior both depend on).
        // Neither is achievable here: a fully closed hollow cannot be built
        // via PartDesign::Thickness on this engine at all, so BOTH cases --
        // f.open absent, and f.open present but unresolved -- collapse into
        // the SAME honest refusal below, rather than silently building an
        // open shell nobody asked for or faking a closed one this kernel
        // cannot make. This is a genuine kernel-capability gap, not a port
        // gap -- same "no answer over a wrong one" rule the revolve/groove
        // profile-crossing refusal above already follows for a different
        // real OCCT/FreeCAD divergence.
        const target = requireBuilt(f.target, `shell ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build shell ${f.id}: '${f.target}' is not a solid`);
        {
          const why = this.notInABody(target, f.id, 'hollowing');
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
        }

        if (f.thickness <= 0) {
          refusals.set(f.id, `${f.id}'s thickness must be greater than zero -- ${f.id} is shown without it.`);
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        const bboxPy =
          `import json, FreeCAD as App\n` +
          `doc = App.ActiveDocument\n` +
          `bb = doc.getObject(${pyStr(target.objName)}).Shape.BoundBox\n` +
          `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'size': [bb.XLength, bb.YLength, bb.ZLength]}))\n`;
        const { size } = session.read(bboxPy) as { size: Vec3 };
        const smallest = Math.min(size[0], size[1], size[2]);
        if (2 * f.thickness >= smallest) {
          refusals.set(
            f.id,
            `Hollowing ${f.id} to ${f.thickness} thick would collapse it -- `
              + `the wall has to be under ${Math.floor(smallest / 2 * 10) / 10}. `
              + `${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        let faceName: string | null = null;
        if (f.open) {
          const resolved = this.resolveFace(f.open, { shapes: built }) as FcElementRef | null;
          if (resolved && resolved.objName === target.objName) faceName = resolved.name;
        }
        if (!faceName) {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- PartDesign::Thickness needs a face to open `
              + `here (this engine's own Thickness cannot make a fully closed hollow with no opening at all); `
              + `${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        let resultName: string;
        try {
          resultName = session.thickness(target.bodyName, target.objName, [faceName], f.thickness);
        } catch (e) {
          refusals.set(
            f.id,
            `Hollowing ${f.id} to ${f.thickness} thick did not work -- ${f.id} is shown without it. `
              + `(${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: target.bodyName, objName: resultName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'hole') {
        // Sugar over cylinder + subtract on the OCCT engine (occt-build.ts:974).
        // Here: one PartDesign::Pocket per drill plane, cut by a circle profile
        // sketch positioned in the WORLD frame -- see fc-commands.mjs's bore()
        // header for what was measured.
        //
        // Deliberately NOT Part::Cut (the combine path): a Part:: result sets
        // container:'part' and notInABody() then refuses every later PartDesign
        // feature -- and the chain AFTER a hole is this app's documented flagship
        // example (reshape-docs.ts:139, "The order that always builds": box ->
        // hollow -> hole -> round(edge)), with ModelEditor.tsx carrying a measured
        // 2026-09-04 regression note about a Fillet whose target IS the Hole.
        //
        // Deliberately NOT PartDesign::Hole either: it exists, builds, and stays
        // in the Body -- but is silently WRONG three ways on this kernel (all
        // State 'Up-to-date', no error): ignores the profile's drill direction (an
        // 'x' bore returns the 'z' answer), under-drills a multi-circle profile (4
        // circles cut 2), and DrillPoint defaults to 'Angled', coning the bottom
        // of every blind hole. Its only value-add over a Pocket
        // (Threaded/HoleCutType/Tapered) has no counterpart in HoleFeature.
        const target = requireBuilt(f.target, `hole ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build hole ${f.id}: '${f.target}' is not a solid`);

        {
          const why = this.notInABody(target, f.id, 'a hole');
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
        }

        if (f.diameter <= 0 || f.depth <= 0) {
          refusals.set(f.id,
            `${f.id}'s diameter and depth must both be greater than zero -- ${f.id} is shown without it.`);
          built.set(f.id, target); shapes.set(f.id, target); continue;
        }

        const holeAxis = f.axis === 'x' ? 0 : f.axis === 'y' ? 1 : 2;
        const axisVec: Vec3 = [0, 0, 0];
        axisVec[holeAxis] = 1;

        // WORLD bbox: Body.Shape, NEVER target.objName's own Shape (a PartDesign
        // feature object's Shape stays body-local). f.center is an offset from
        // the target's world bbox centre, not a world position.
        const holeBboxPy =
          `import json, FreeCAD as App\n` +
          `doc = App.ActiveDocument\n` +
          `bb = doc.getObject(${pyStr(target.bodyName)}).Shape.BoundBox\n` +
          `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'bbox': [[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`;
        const { bbox: holeBbox } = session.read(holeBboxPy) as { bbox: [Vec3, Vec3] };
        const holeC: Vec3 = [
          (holeBbox[0][0] + holeBbox[1][0]) / 2 + f.center[0],
          (holeBbox[0][1] + holeBbox[1][1]) / 2 + f.center[1],
          (holeBbox[0][2] + holeBbox[1][2]) / 2 + f.center[2],
        ];

        // Fit gate -- same check and wording as occt-build.ts:996-1005. This
        // engine will NOT refuse on its own: a bore that misses exits Up-to-date
        // with the volume unchanged (measured), so it lives here.
        const holePerp = holeAxis === 0
          ? [holeBbox[1][1] - holeBbox[0][1], holeBbox[1][2] - holeBbox[0][2]]
          : holeAxis === 1
            ? [holeBbox[1][0] - holeBbox[0][0], holeBbox[1][2] - holeBbox[0][2]]
            : [holeBbox[1][0] - holeBbox[0][0], holeBbox[1][1] - holeBbox[0][1]];
        if (f.diameter > Math.min(...holePerp)) {
          refusals.set(f.id,
            `Boring ${f.id} at diameter ${f.diameter} would not fit ${f.target} -- ${f.id} is shown without it.`);
          built.set(f.id, target); shapes.set(f.id, target); continue;
        }

        // Bore centres, VERBATIM from occt-build.ts:1027-1034 -- corners.dx/dy are
        // the half-offsets themselves, applied to world X/Y regardless of f.axis.
        // Match the quirk; newHoleCorners() only emits axis 'z'.
        const holeCenters: Vec3[] = f.corners
          ? [
              [holeC[0] - f.corners.dx, holeC[1] - f.corners.dy, holeC[2]],
              [holeC[0] + f.corners.dx, holeC[1] - f.corners.dy, holeC[2]],
              [holeC[0] - f.corners.dx, holeC[1] + f.corners.dy, holeC[2]],
              [holeC[0] + f.corners.dx, holeC[1] + f.corners.dy, holeC[2]],
            ]
          : [holeC];

        // ONE sketch + ONE Pocket per drill plane. Centres sharing their
        // component along f.axis share a plane -> one sketch, N circles. MEASURED:
        // 4 circles in one profile cut 4 bores in a single Pocket,
        // 29738.053289415348 on BOTH engines. Also more correct than 4 chained
        // cuts, for the reason occt-build.ts:1035-1039 fuses its bores into one
        // tool first: sequential cuts of overlapping bores can refill material.
        const holePlanes = new Map<string, Vec3[]>();
        for (const w of holeCenters) {
          const key = w[holeAxis].toFixed(6);
          const g = holePlanes.get(key);
          if (g) g.push(w); else holePlanes.set(key, [w]);
        }

        let holeObjName = target.objName;
        let holeFailure: string | null = null;
        let holeGi = 0;
        for (const group of holePlanes.values()) {
          try {
            holeObjName = session.bore(
              target.bodyName, `${f.id}_boresk${holeGi}`, `${f.id}_bore${holeGi}`,
              f.diameter / 2, group, group[0], axisVec, f.depth,
            );
          } catch (e) {
            holeFailure = e instanceof Error ? e.message : String(e);
            break;
          }
          holeGi++;
        }
        if (holeFailure) {
          refusals.set(f.id,
            `Boring ${f.id} into ${f.target} did not work -- ${f.id} is shown without it. (${holeFailure})`);
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        // NO `container` field: the result is a PartDesign::Pocket inside the
        // target's OWN Body, so a later fillet/hole/draft/pattern builds on it
        // normally. That is the entire reason for this design over Part::Cut.
        const holeEntry: FcBuiltFeature = {
          bodyName: target.bodyName,
          objName: holeObjName,             // the LAST pocket name (the body's new Tip)
          kind: 'solid',
          featureId: f.id,
          featureKind: f.kind,
        };
        built.set(f.id, holeEntry);
        shapes.set(f.id, holeEntry);
      } else if (f.kind === 'draft') {
        // PartDesign::Draft -- see fc-commands.mjs's own draft()/
        // neutralPlane() header comments for the full account of what was
        // measured against the real kernel and why. SCOPED DOWN from
        // DraftFeature's full two-mode design, deliberately, not merely
        // unfinished:
        //   - `whole: true` (Body Draft) is refused. This engine has no
        //     enumerate-every-face-and-identify-the-two-caps machinery for
        //     an ARBITRARY solid (only resolveFace's own narrow primitive/
        //     swept/rounded/cap vocabulary) -- building it would be new,
        //     unproven plumbing, not a port of something already measured
        //     against this kernel. Same "a real, reasoned partial gap beats
        //     a guessed full implementation" rule as SPEC-engine-port.md
        //     §6.1.
        //   - Only `pull === 'z'` on an UNROTATED body is supported.
        //     MEASURED (engine/bridge/draft-probe*.mjs): PartDesign::Draft.
        //     PullDirection is a real property but EVERY explicit reference
        //     this pass tried (a raw sketch's V_Axis, a raw sketch's own
        //     drawn Edge, a real edge of the solid itself, a PartDesign::
        //     Line datum, even the Body's own Origin Z_Axis datum -- an
        //     object that already IS the implicit default direction) fails
        //     identically on this kernel build, while leaving PullDirection
        //     unset builds successfully. A genuine per-fork kernel
        //     limitation (same class as Thickness's own "cannot build a
        //     fully-closed hollow" gap, this file's own 'shell' branch), not
        //     fixable by any reference form this pass could find. Since the
        //     implicit default direction is body-local Z, a rotated body's
        //     draft would silently follow the body's own tilt rather than
        //     stay world-frame (the same class of bug SPEC-coord-fix.md's
        //     pattern/revolve/groove fixes closed) with no world-frame-proxy
        //     fix available here -- refused, not silently misbuilt.
        const target = requireBuilt(f.target, `draft ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build draft ${f.id}: '${f.target}' is not a solid`);
        {
          const why = this.notInABody(target, f.id, 'a draft');
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
        }

        if (f.whole) {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- Body Draft (every face but the `
              + `two ${f.pull}-axis caps) is not yet supported here; only a single named face `
              + `resolves today. ${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        if (f.pull !== 'z') {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- a draft pull direction other `
              + `than 'z' is not supported here (this engine's own Draft feature cannot take a `
              + `custom pull direction); ${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const rot = bodyRotate.get(target.bodyName) ?? [0, 0, 0];
        if (rot.some((r) => Math.abs(r) > 1e-9)) {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- draft on a rotated body is not `
              + `supported here (the pull direction would follow the body's own tilt instead of `
              + `staying world-frame); ${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        if (!f.face) {
          refusals.set(f.id, `${f.id} needs a face to draft -- ${f.id} is shown without it.`);
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const resolved = this.resolveFace(f.face, { shapes: built }) as FcElementRef | null;
        const faceName = resolved && resolved.objName === target.objName ? resolved.name : null;
        if (!faceName) {
          refusals.set(
            f.id,
            `${f.id}'s face could not be found on the FreeCAD engine -- ${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        const neutralSketchName = `${f.id}_neutral`;
        try {
          session.neutralPlane(target.bodyName, neutralSketchName, [0, 0, f.neutral], [0, 0, 1]);
        } catch (e) {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- setting up its neutral plane `
              + `failed. (${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        let resultName: string;
        try {
          resultName = session.draft(target.bodyName, target.objName, faceName, f.angle, neutralSketchName);
        } catch (e) {
          refusals.set(
            f.id,
            `Drafting ${f.id} at ${f.angle} degrees would not fit its face -- ${f.id} is shown `
              + `without it. (${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: target.bodyName, objName: resultName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'mirror') {
        // PartDesign::Mirrored -- see fc-commands.mjs's own mirrored()/
        // neutralPlane() header comments for the full account measured
        // against the real kernel (engine/bridge/mirror-probe.mjs).
        // Reproduces occt-build.ts's own documented "mirror through the
        // target's own near bounding-box face along the axis, NOT the world
        // origin" contract (see that file's own 'mirror' branch comment) --
        // MirrorPlane is set to a world-frame proxy sketch, built at that
        // near-face world coordinate, via neutralPlane() REUSED DIRECTLY
        // rather than duplicated: MEASURED to behave exactly like
        // PolarPattern.Axis/Draft's own NeutralPlane, honouring the proxy's
        // own world position, NOT like PullDirection (draft's own gap
        // above), which rejects every explicit reference tried.
        //
        // PartDesign::Mirrored keeps BOTH the original and its reflection
        // fused into one Shape BY CONSTRUCTION -- it is a
        // PartDesign::FeatureTransformedPattern, the SAME family as
        // LinearPattern/PolarPattern above, not a DressUp like Fillet/Draft.
        // MEASURED: its own Shape.Volume comes back as exactly 2x the
        // original (no overlap), so -- unlike occt-build.ts's own mirror
        // branch, which needs a separate BRepAlgoAPI_Fuse call -- no boolean
        // fuse is needed here at all. This is exactly reshape's own Mirror
        // contract (MirrorFeature's own doc comment in model-types.ts: the
        // source feature stays visible, the mirrored copy is added
        // alongside it), so the two engines converge on the same shape by a
        // different route: an explicit fuse on one side, a native additive
        // PartDesign transform on the other.
        const target = requireBuilt(f.target, `mirror ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build mirror ${f.id}: '${f.target}' is not a solid`);
        {
          const why = this.notInABody(target, f.id, 'a mirror');
          if (why) {
            refusals.set(f.id, why);
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
        }

        const axis = f.plane === 'yz' ? 0 : f.plane === 'xz' ? 1 : 2;
        const normal: Vec3 = [0, 0, 0];
        normal[axis] = 1;

        // WORLD-frame bbox: Body.Shape (not target.objName's OWN Shape)
        // reflects Body.Placement -- see this file's own comment on mesh()
        // above for the measured "a PartDesign feature object's own Shape
        // stays body-local" fact this relies on. target.objName is the
        // body's current Tip at this point in the build (v1's
        // single-body-per-chain design, same invariant mesh() itself uses).
        const bboxPy =
          `import json, FreeCAD as App\n` +
          `doc = App.ActiveDocument\n` +
          `bb = doc.getObject(${pyStr(target.bodyName)}).Shape.BoundBox\n` +
          `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'bbox': [[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`;
        const { bbox } = session.read(bboxPy) as { bbox: [Vec3, Vec3] };
        const lo = bbox[0][axis];
        const hi = bbox[1][axis];
        const at = Math.abs(lo) <= Math.abs(hi) ? lo : hi;
        const through: Vec3 = [0, 0, 0];
        through[axis] = at;

        const planeSketchName = `${f.id}_mirrorplane`;
        const mirrorName = `${f.id}_mirror`;
        try {
          session.neutralPlane(target.bodyName, planeSketchName, through, normal);
        } catch (e) {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- setting up its mirror plane failed. `
              + `(${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        let resultName: string;
        try {
          resultName = session.mirrored(target.bodyName, target.objName, planeSketchName, mirrorName);
        } catch (e) {
          refusals.set(
            f.id,
            `Mirroring ${f.id} across the '${f.plane}' plane did not work -- ${f.id} is shown without it. `
              + `(${e instanceof Error ? e.message : String(e)})`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: target.bodyName, objName: resultName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'move') {
        // Body.Placement is a frame applied only when Body.Shape is read --
        // a move never rewrites the underlying feature geometry, so a
        // face/edge named before the move still resolves after it with no
        // new naming machinery (see this file's own header on 'move' and
        // findPrimitiveAncestor()/findSketchAncestor()'s own `move` case).
        const target = requireBuilt(f.target, `move ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build move ${f.id}: '${f.target}' is not a solid`);

        // Refuse rather than silently move more than asked: if something
        // else was already built on top of the target in the SAME body
        // (the target's Body.Tip is no longer the target's own object),
        // moving the body would move that later feature too.
        if (session.bodyTip(target.bodyName) !== target.objName) {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- moving ${f.target} would also move `
              + `what was built on top of it. Move the last shape in the chain instead. `
              + `${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        if (!f.copy) {
          try {
            session.moveBody(target.bodyName, f.offset);
          } catch (e) {
            refusals.set(
              f.id,
              `Moving ${f.id} did not work -- ${f.id} is shown without it. `
                + `(${e instanceof Error ? e.message : String(e)})`,
            );
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
          // SAME bodyName/objName as the target -- only the frame moved, so
          // a later feature built on top of THIS move still resolves against
          // the same body/object, exactly as if the target had never moved.
          const entry: FcBuiltFeature = { ...target, featureId: f.id, featureKind: f.kind };
          built.set(f.id, entry);
          shapes.set(f.id, entry);
        } else {
          if (Math.hypot(f.offset[0], f.offset[1], f.offset[2]) < 1e-9) {
            refusals.set(
              f.id,
              `${f.id} would sit exactly on top of ${f.target} -- give the copy `
                + `somewhere to go. ${f.id} is shown without it.`,
            );
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
          let copied: { bodyName: string; tipName: string };
          try {
            copied = session.copyBodyMoved(target.bodyName, f.offset);
          } catch (e) {
            refusals.set(
              f.id,
              `Copying ${f.target} did not work -- ${f.id} is shown without it. `
                + `(${e instanceof Error ? e.message : String(e)})`,
            );
            built.set(f.id, target);
            shapes.set(f.id, target);
            continue;
          }
          // NEW bodyName/objName -- the original stays top-level, unmoved,
          // and still meshes on its own (see topLevel()'s own
          // `f.kind === 'move' && !f.copy` check, which never consumes the
          // target when copy is true).
          const entry: FcBuiltFeature = {
            bodyName: copied.bodyName, objName: copied.tipName, kind: 'solid',
            featureId: f.id, featureKind: f.kind,
          };
          built.set(f.id, entry);
          shapes.set(f.id, entry);
        }
      } else if (f.kind === 'combine') {
        // See fc-commands.mjs's partBoolean() header for what was measured against
        // this kernel and why PartDesign::Boolean -- which DOES exist here -- was
        // probed first and rejected. This CLOSES SPEC-engine-port.md §6.1's claim
        // that combine "needs multi-body support v1 doesn't have": it needs none.
        // A Part:: boolean is a document-level feature reading two finished shapes,
        // leaving both Bodies untouched and reusable.
        //
        // The ONE place a ModelDoc feature does not live in a PartDesign::Body: two
        // independent chains meet, and Body.Tip/BaseFeature is strictly linear
        // (SPEC-engine-port.md §6, risk 6), so there is no Body for the result to
        // belong to. `container: 'part'` records that; notInABody() (below) turns
        // it into a clean refusal for anything built on top.
        //
        // Folded PAIRWISE in ModelDoc order, exactly as occt-build.ts's combine
        // branch folds Fuse/Cut/Common -- a loop not a reduce, same reason that
        // file gives. For `subtract` the first target is the body being cut, per
        // CombineFeature's own doc comment.
        //
        // live[i].bodyName, NOT objName -- LOAD-BEARING. Only the BODY's Shape
        // carries Body.Placement (the same measurement mesh()'s own header and the
        // 'mirror' branch rest on); objName would drop every center/rotate, giving
        // the right volume in the wrong place -- exactly the bug class
        // freecad-mirror.manual.mjs's header warns a volume-only test misses.
        const live = f.targets
          .map((id) => built.get(id))
          .filter((e): e is FcBuiltFeature => !!e && e.kind === 'solid');

        if (live.length < 2) {
          refusals.set(f.id, `${f.id} needs two solid shapes to combine -- ${f.id} is shown without it.`);
          if (live[0]) { built.set(f.id, live[0]); shapes.set(f.id, live[0]); }
          continue;
        }

        const VERB = { union: 'Joining', subtract: 'Cutting', intersect: 'Overlapping' } as const;
        let cur = live[0].bodyName;
        let failed: string | null = null;
        for (let i = 1; i < live.length; i++) {
          try {
            cur = session.partBoolean(f.op, cur, live[i].bodyName, `${f.id}_op${i}`);
          } catch (e) {
            failed = e instanceof Error ? e.message : String(e);
            break;
          }
        }
        if (failed) {
          refusals.set(
            f.id,
            `${VERB[f.op]} these shapes left nothing behind -- they may not touch each other. `
              + `${f.id} is shown without it. (${failed})`,
          );
          built.set(f.id, live[0]);
          shapes.set(f.id, live[0]);
          continue;
        }
        const entry: FcBuiltFeature = {
          bodyName: cur, objName: cur, kind: 'solid', container: 'part',
          featureId: f.id, featureKind: f.kind,
        };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else {
        throw new Error(`not yet supported on the FreeCAD engine: ${f.kind}`);
      }
    }

    return { shapes, refusals: refusals.size ? refusals : undefined };
  }

  /** Every PartDesign feature is created by `doc.getObject(bodyName).newObject(...)`,
   *  which needs bodyName to be a real PartDesign::Body. A combine result is a
   *  document-level Part::Cut/Fuse/Common instead -- MEASURED: session.fillet()
   *  and session.thickness() on one both raise "'Part.Feature' object has no
   *  attribute 'newObject'". Gate BEFORE the call so it surfaces as a per-feature
   *  refusal rather than a kernel AttributeError that fails the whole model. */
  private notInABody(target: FcBuiltFeature, id: string, what: string): string | null {
    if (target.container !== 'part') return null;
    return `${id} could not be built on the FreeCAD engine -- ${what} works inside a PartDesign `
      + `Body, and the combine it is built on lives outside one here. ${id} is shown without it.`;
  }

  /** revolve/groove pre-check: FreeCAD's own PartDesign::Revolution/Groove
   *  raise if the profile crosses the spin axis; occt-build.ts's MakeRevol
   *  does not -- it silently builds a self-intersecting solid. A genuine,
   *  deliberate divergence between the two engines (not a bug to hide):
   *  refuse rather than build wrong, same "no answer over a wrong one" rule
   *  fillet's own edge resolution already follows. `u = 0` is allowed -- a
   *  cone's triangle touches the axis without crossing it. */
  private latheProfileRefusal(sketch: SketchFeature, id: string): string | null {
    const outline = outlineOf(sketch);
    if (!outline.ok) {
      return `${id} could not be built on the FreeCAD engine -- its profile sketch `
        + `'${sketch.id}' does not close into one outline; ${id} is shown without it.`;
    }
    const minU = Math.min(...(outline.points as number[][]).map((p) => p[0]));
    if (minU < -1e-9) {
      return `${id} could not be built on the FreeCAD engine -- its profile crosses the `
        + `spin axis (it reaches x = ${minU.toFixed(3)}); move the sketch so it sits `
        + `entirely at or right of x = 0. ${id} is shown without it.`;
    }
    return null;
  }

  /** Build the cached wall/cap geometry an extrude's own FcBuiltFeature
   *  entry needs for resolveFace/resolveEdge/nameFace/nameEdge -- see
   *  FcSweepInfo's own header for the measurement this is built on. Mirrors
   *  sketch-translate.ts's own geometry-emission loop EXACTLY (same
   *  outlineOf()/segmentRoles() calls, same segment order, same bulge ->
   *  arc math) because the Pad's own wall order is measured to match that
   *  SAME emission order one-for-one -- a divergence between the two loops
   *  would silently mis-name every wall past the first. Returns undefined
   *  for a circle-shaped sketch (no outline segments to name a wall after)
   *  or an outline that failed to build (collapsed design, <3 segments) --
   *  an honest "nothing cached" rather than a guess. */
  private buildSweepInfo(sketch: SketchFeature, height: number): FcSweepInfo | undefined {
    if (circleOf(sketch)) return undefined;
    const outline = outlineOf(sketch);
    if (!outline.ok) return undefined;
    const pts = outline.points;
    const bulges = outline.bulges ?? {};
    const n = pts.length;
    if (n < 3) return undefined;
    const roles = segmentRoles(outline.basis);
    const segments: FcSweepSegment[] = [];
    let cxSum = 0;
    let cySum = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      cxSum += a[0];
      cySum += a[1];
      const bulge = bulges[i];
      let at: [number, number];
      if (bulge) {
        // The arc's own midpoint (by angle, not by chord) -- a point known
        // to lie on the CURVED wall, unlike the chord's midpoint (which sits
        // inside the material, off the surface). Same a0/a1 CCW-normalising
        // fixup sketch-translate.ts's own arc branch already applies, for
        // the same reason: arcFromBulge()'s raw startAngle/endAngle can wrap
        // either way and the bulge's own sign says which is meant.
        const { center, radius, startAngle, endAngle } = arcFromBulge(a, b, bulge);
        let a0 = startAngle;
        let a1 = endAngle;
        if (bulge > 0 && a1 < a0) a1 += 2 * Math.PI;
        if (bulge < 0 && a1 > a0) a1 -= 2 * Math.PI;
        const mid = (a0 + a1) / 2;
        at = [center[0] + radius * Math.cos(mid), center[1] + radius * Math.sin(mid)];
      } else {
        at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      }
      segments.push({ role: roles[i].role, index: roles[i].index, faceIndex: i, at });
    }
    return {
      from: sketch.id,
      segments,
      bottomFaceIndex: n,
      topFaceIndex: n + 1,
      capAt: [cxSum / n, cySum / n],
      height,
    };
  }

  /** Apply a ModelDoc primitive's center + rotate to the Body that holds it.
   *  `center` is applied EXCLUSIVELY here, via Body.Placement -- every
   *  primitive's own local geometry is built at/near local (0,0,0)
   *  (box/cylinder's sketch at local (0,0), sphere/cone/torus/prism at
   *  their own native object origin, per each branch's own comment above),
   *  Z running [0, height] from the pad/native feature. `localZShift`
   *  (usually -height/2) re-centres Z locally BEFORE rotation, matching
   *  occt-build.ts's own centre-at-origin-then-rotate-then-translate
   *  sequence for a box/cylinder (`turned(oc, moved(oc, raw,
   *  [-w/2,-d/2,-h/2]), f.rotate, [0,0,0])`, then `moved(oc, shape,
   *  f.center)` in the caller) -- X/Y are already centred by construction
   *  here, so only Z needs the pre-rotation shift. Composed as ONE FreeCAD
   *  Placement multiplication so the whole Body (and every feature built
   *  inside it afterward, fillets included) moves together.
   *
   *  box/cylinder used NOT to follow this "local geometry at (0,0,0)"
   *  convention -- their sketch baked `center`'s X/Y directly into its own
   *  local coordinates, which then got a SECOND translation from this very
   *  function's Body.Placement, doubling an off-origin box/cylinder's world
   *  position (center [30,20,0] measured back as world bbox center
   *  [60,40,0] against the real kernel). Fixed by moving their sketch
   *  geometry to local (0,0) too, so this function is now the ONLY place
   *  `center` is ever applied, for every primitive kind alike. */
  private setBodyPlacement(
    session: FcSessionLike, bodyName: string, center: Vec3, rotate: Vec3 | undefined, localZShift: number,
    bodyRotate?: Map<string, Vec3>,
  ): void {
    bodyRotate?.set(bodyName, rotate ?? [0, 0, 0]);
    const [cx, cy, cz] = center;
    const [rx, ry, rz] = rotate ?? [0, 0, 0];
    const py =
      `import FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `Rx = App.Rotation(App.Vector(1,0,0), ${num(rx, 'rotate.x')})\n` +
      `Ry = App.Rotation(App.Vector(0,1,0), ${num(ry, 'rotate.y')})\n` +
      `Rz = App.Rotation(App.Vector(0,0,1), ${num(rz, 'rotate.z')})\n` +
      // Rx applied first, then Ry, then Rz -- App.Rotation's `*` applies its
      // RIGHT operand first, so Rz*Ry*Rx composes to exactly that order,
      // matching occt-build.ts's turned() (which applies X then Y then Z
      // sequentially to the already-rotated shape).
      `Rtotal = Rz.multiply(Ry).multiply(Rx)\n` +
      `pre = App.Placement(App.Vector(0,0,${num(localZShift, 'localZShift')}), App.Rotation())\n` +
      `body.Placement = App.Placement(App.Vector(${num(cx, 'center.x')},${num(cy, 'center.y')},${num(cz, 'center.z')}), Rtotal).multiply(pre)\n` +
      `doc.recompute()\n`;
    const { rc, out } = session.exec(py);
    if (rc !== 0) throw new Error(`setBodyPlacement(${bodyName}) failed:\n${out}`);
  }

  /** §4 risk 3, narrowed to exactly what the box+fillet self-check needs:
   *  a `between` name over two `primitive`-cause faces of the SAME fresh
   *  box/cylinder feature -- topo-resolve.ts's own
   *  nameEdgeBetweenPrimitiveFaces()/resolvePrimitiveFace() vocabulary,
   *  re-implemented against FreeCAD's own Shape.Faces/Shape.Edges instead
   *  of an OCCT TopExp_Explorer. Returns FreeCAD's own "EdgeN" sub-element
   *  name, or null for anything outside that narrow case (a sweep-generated
   *  edge, a rounded corner, an edge on a moved/combined shape, ...) -- the
   *  caller turns null into a per-feature refusal, never a guess. */
  private resolvePrimitiveEdgeName(
    session: FcSessionLike, target: FcBuiltFeature, name: TopoName,
  ): string | null {
    if (name.cause !== 'between') return null;
    const [a, b] = name.of;
    if (a.cause !== 'primitive' || b.cause !== 'primitive') return null;
    if (a.feature !== target.featureId || b.feature !== target.featureId) return null;
    if (target.featureKind !== 'box' && target.featureKind !== 'cylinder') return null;
    const parts = target.featureKind === 'box' ? BOX_PARTS : CYLINDER_PARTS;
    if (!parts.has(a.part) || !parts.has(b.part)) return null;

    const py =
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `o = doc.getObject(${pyStr(target.objName)})\n` +
      `sh = o.Shape\n` +
      `bb = sh.BoundBox\n` +
      `cx=(bb.XMin+bb.XMax)/2.0; cy=(bb.YMin+bb.YMax)/2.0; cz=(bb.ZMin+bb.ZMax)/2.0\n` +
      `DIRS = {'+x':(1.0,0.0,0.0),'-x':(-1.0,0.0,0.0),'+y':(0.0,1.0,0.0),'-y':(0.0,-1.0,0.0),'+z':(0.0,0.0,1.0),'-z':(0.0,0.0,-1.0)}\n` +
      `def _score(f, d):\n` +
      `    c = f.CenterOfMass\n` +
      `    return (c.x-cx)*d[0] + (c.y-cy)*d[1] + (c.z-cz)*d[2]\n` +
      `def _resolve_face(part):\n` +
      `    if part in DIRS:\n` +
      `        d = DIRS[part]\n` +
      `        best=None; best_s=-1e18; best_a=-1e18\n` +
      `        for f in sh.Faces:\n` +
      `            s = _score(f, d); a = f.Area\n` +
      `            if s > best_s + 1e-7 or (abs(s-best_s) <= 1e-7 and a > best_a):\n` +
      `                best=f; best_s=max(s,best_s); best_a=a\n` +
      `        return best\n` +
      `    if part == 'side':\n` +
      `        top = _resolve_face('+z'); bot = _resolve_face('-z')\n` +
      `        def _same(x,y):\n` +
      `            return x is not None and (x.CenterOfMass - y.CenterOfMass).Length < 1e-7\n` +
      `        for f in sh.Faces:\n` +
      `            if not _same(top,f) and not _same(bot,f):\n` +
      `                return f\n` +
      `    return None\n` +
      `fa = _resolve_face(${pyStr(a.part)})\n` +
      `fb = _resolve_face(${pyStr(b.part)})\n` +
      `idx = None\n` +
      `if fa is not None and fb is not None:\n` +
      `    for i, e in enumerate(sh.Edges):\n` +
      `        onA = any(e.isSame(ea) for ea in fa.Edges)\n` +
      `        onB = any(e.isSame(eb) for eb in fb.Edges)\n` +
      `        if onA and onB:\n` +
      `            idx = i\n` +
      `            break\n` +
      `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'edge': ('Edge%d' % (idx+1)) if idx is not None else None}))\n`;

    const res = session.read(py);
    return res.edge ?? null;
  }

  // ---- mesh ------------------------------------------------------------

  // A REAL, PRE-EXISTING BUG this pass found while verifying torus/prism at
  // an off-origin center: setBodyPlacement() sets the BODY's own
  // Placement, but a PartDesign feature object's OWN .Shape stays in
  // BODY-LOCAL coordinates -- only doc.getObject(bodyName).Shape (not
  // doc.getObject(featureObjName).Shape) reflects that Placement. Measured
  // directly against the kernel with plain session.sphere() + a manual
  // Placement set, no adapter code involved: the feature's own Shape.BoundBox
  // stayed at [-5,5] while the BODY's Shape.BoundBox correctly showed
  // [25,35] for a center=[30,0,0] placement. This silently misrendered
  // EVERY off-origin primitive already shipped (box/cylinder/sphere), not
  // just the cone/torus/prism this pass adds -- it was invisible until now
  // because every prior real-kernel fixture in this port used center
  // [0,0,0]. Fixed here (the rendering path only -- mesh()/edges() are what
  // a viewport actually calls) by meshing the owning BODY, not the feature:
  // Body.Shape is, by construction, the body's current Tip transformed by
  // Body.Placement, and for v1's single-body-per-chain design `bodyName`
  // always names the SAME body whose Tip is exactly this shape's own
  // objName at the moment it was built (see FcBuiltFeature's own header --
  // v1 never has two live tips in one body). NOT extended to
  // resolvePrimitiveEdgeName()/queryPrimitiveGeometry() (edge/face naming
  // and fillet's own Base reference) -- those intentionally stay on
  // objName's body-LOCAL shape, because PartDesign::Fillet.Base itself
  // takes a body-local feature reference, and topo-name.ts's own +x/-x/etc
  // convention is understood in the primitive's own pre-Placement frame the
  // same way occt-build.ts builds a box unrotated-then-rotated.
  //
  // CONFIRMED, not assumed, against the real kernel (out-of-band bugfix
  // pass that moved box/cylinder's own sketch geometry to local (0,0), see
  // this file's own header on the box/cylinder branches and on
  // setBodyPlacement): resolvePrimitiveEdgeName()/queryPrimitiveGeometry()
  // both compute cx/cy/cz from `target.objName`'s OWN CURRENT BoundBox on
  // every call, never from a stored f.center, so face/edge direction
  // scoring is entirely self-relative to whatever local geometry the shape
  // actually has -- it does not matter whether that local geometry sits at
  // local origin or away from it. Re-verified on an off-origin box (center
  // [30,20,5]) and cylinder (center [30,20,5]) after the fix: every face
  // resolves, every face round-trips through nameFace() back to its own
  // part, edge-between-two-faces resolves and measures correctly, and a
  // fillet on that resolved edge still builds. No regression from the
  // box/cylinder fix.
  mesh(shape: unknown, opts?: { deflection?: number }): EngineMesh | null {
    const session = this.requireSession();
    const s = shape as FcBuiltFeature | null;
    if (!s || s.kind !== 'solid') return null;

    const raw = session.meshFaces(s.bodyName, opts?.deflection ?? 0.1);
    if (!raw || raw.empty || !raw.faces || raw.faces.length === 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];
    const faces: FaceRange[] = [];
    for (const face of raw.faces) {
      if (!face.positions.length || !face.indices.length) continue;
      const baseVertex = positions.length / 3;
      for (const p of face.positions) positions.push(p);
      const start = indices.length;
      for (let t = 0; t < face.indices.length; t += 3) {
        indices.push(baseVertex + face.indices[t], baseVertex + face.indices[t + 1], baseVertex + face.indices[t + 2]);
      }
      faces.push({ index: face.id, start, count: indices.length - start });
    }
    if (indices.length === 0) return null;

    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return { geometry, faces };
  }

  /** FreeCAD's own documented sub-element convention (fc-session.mjs's
   *  meshFaces() comment: "edgeId j == 'Edge{j+1}'"), converted straight to
   *  a drawable line -- no naming history needed, unlike resolveEdge().
   *  Queries the owning BODY, not the feature -- same reason and same
   *  fix as mesh()'s own header comment: only Body.Shape carries
   *  setBodyPlacement()'s transform, so drawing off s.objName's own local
   *  Shape would draw the line in the wrong world position. The returned
   *  ref's objName is the body too, so faceSize()/edgeLength() (which
   *  getElement() straight off ref.objName) stay consistent with what was
   *  actually drawn here. */
  edges(shape: unknown): Array<{ edge: unknown; geometry: THREE_NS.BufferGeometry }> {
    const session = this.requireSession();
    const s = shape as FcBuiltFeature | null;
    if (!s || s.kind !== 'solid') return [];
    const raw = session.meshFaces(s.bodyName);
    if (!raw || raw.empty || !raw.edges) return [];
    return raw.edges.map((e) => {
      const geometry = new this.THREE.BufferGeometry();
      geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(e.points, 3));
      const ref: FcElementRef = { objName: s.bodyName, name: `Edge${e.id + 1}` };
      return { edge: ref, geometry };
    });
  }

  /** The reverse of mesh()'s own FaceRange.index -- FreeCAD's own
   *  `"Face" + (index+1)` convention (same source comment as edges()
   *  above), needing no kernel round-trip to answer. Returns an
   *  FcElementRef, not a bare name -- see this file's own header. objName
   *  is the owning BODY, matching mesh()'s own bodyName-based indexing
   *  (see that method's header) -- a bare s.objName here would give a
   *  face index into the wrong (untransformed) Shape.Faces ordering. */
  faceAt(shape: unknown, index: number): unknown | null {
    const s = shape as FcBuiltFeature | null;
    if (!s || s.kind !== 'solid' || index < 0) return null;
    const ref: FcElementRef = { objName: s.bodyName, name: `Face${index + 1}` };
    return ref;
  }

  /** Walk a fillet/chamfer chain back to the box/cylinder primitive that
   *  started it, within the SAME body -- v1 is single-body-per-chain (this
   *  file's own header), so this chain is always linear and always ends at
   *  exactly one primitive or nothing. Anything else in the chain (a
   *  sketch, an extrude, a pocket, a sphere) is out of naming scope today --
   *  see this file's own header on `swept`/`cap` -- and stops the walk with
   *  null rather than guessing past it. */
  private findPrimitiveAncestor(
    build: EngineBuildResult, doc: ModelDoc, featureId: string,
  ): { id: string; kind: 'box' | 'cylinder' } | null {
    let id: string | undefined = featureId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const bf = build.shapes.get(id) as FcBuiltFeature | undefined;
      if (!bf) return null;
      if (bf.featureKind === 'box' || bf.featureKind === 'cylinder') return { id, kind: bf.featureKind };
      if (bf.featureKind === 'move') {
        const mv = doc.features.find((x) => x.id === id) as MoveFeature | undefined;
        // copy: true -> honest null, not a walk-through: the duplicate's
        // body-local geometry is byte-identical to the original's, so
        // resolving a name through it would silently attribute a pick on
        // the copy to the original (or vice versa) -- same rule
        // pattern/mirror already follow for their own copies.
        if (!mv || mv.copy) return null;
        id = mv.target;
        continue;
      }
      if (bf.featureKind !== 'fillet') return null;
      const docFeature = doc.features.find((f) => f.id === id) as { target?: string } | undefined;
      id = docFeature?.target;
    }
    return null;
  }

  /** The `swept`/`rounded`/`cap` counterpart of findPrimitiveAncestor(): walk
   *  a chain back to the `extrude` (Pad) feature that started it, carrying
   *  its cached FcSweepInfo along. `fillet`/`chamfer` continue the SAME
   *  chain as findPrimitiveAncestor already follows (`.target`); `pocket`
   *  follows `.into` instead -- the solid it cut, not `.target` (the
   *  CUTTING sketch, a different feature entirely, per this file's own
   *  `pocket` build() branch). A pocket's OWN newly-cut faces (its hole's
   *  wall/floor) are never reached by this walk -- there is no design edge
   *  of ITS OWN cutting profile in the vocabulary to name them after,
   *  matching occt-build.ts's own pocket branch, which records no sweep
   *  history at all for the same reason ("a cut's faces come from the
   *  boolean, not the prism") -- so an untouched Pad wall/cap survives being
   *  cut into elsewhere on the same solid, but the cut's own new geometry
   *  stays unnamed, an honest null from querySketchGeometry() below rather
   *  than a guess. An extrude entry with no cached `sweep` (a circle profile,
   *  or an outline that failed to build -- see FcSweepInfo's own header)
   *  stops the walk with null, same as anything else this scope does not
   *  cover. */
  private findSketchAncestor(
    build: EngineBuildResult, doc: ModelDoc, featureId: string,
  ): { id: string; sweep: FcSweepInfo } | null {
    let id: string | undefined = featureId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const bf = build.shapes.get(id) as FcBuiltFeature | undefined;
      if (!bf) return null;
      if (bf.featureKind === 'extrude') return bf.sweep ? { id, sweep: bf.sweep } : null;
      if (bf.featureKind === 'move') {
        // Same copy:true -> null rule as findPrimitiveAncestor's own `move`
        // case above -- see that comment for why.
        const mv = doc.features.find((x) => x.id === id) as MoveFeature | undefined;
        if (!mv || mv.copy) return null;
        id = mv.target;
        continue;
      }
      if (bf.featureKind === 'fillet') {
        const docFeature = doc.features.find((f) => f.id === id) as { target?: string } | undefined;
        id = docFeature?.target;
        continue;
      }
      if (bf.featureKind === 'pocket') {
        const docFeature = doc.features.find((f) => f.id === id) as { into?: string } | undefined;
        id = docFeature?.into;
        continue;
      }
      return null;
    }
    return null;
  }

  /**
   * The geometric counterpart of queryPrimitiveGeometry(), for a sketch-
   * derived (Pad) wall/cap instead of a primitive's direction-scored face.
   * Identifies each of `sweep`'s candidates on `target.objName`'s CURRENT
   * Shape by checking whether a point KNOWN to lie on it (`FcSweepSegment.at`
   * at local z = height/2 for a wall, `capAt` at z=0/z=height for a cap) is
   * within tolerance of that face -- `Part.Vertex(...).distToShape(...)`,
   * the same "point known to lie on it" technique lib/topo-history.ts's own
   * pointOnFace()/distanceTo() use on the OCCT side, chosen for the same
   * reason: this runs against whichever object was actually picked, which
   * per FcSweepInfo's own header measurement can be a LATER feature (a
   * Pocket, a Fillet) whose own Face ordering no longer matches the Pad's
   * original emission order. Candidates are keyed 'edge:N'/'corner:N' (a
   * wall) or 'cap:top'/'cap:bottom' -- nameForSweepKey() below turns a hit
   * back into the right TopoName cause. `adjacent`, when `edgeIdx` is given,
   * is the (by Face name) faces bordering that edge -- same one-round-trip
   * shape queryPrimitiveGeometry() already uses so nameEdge() need not run a
   * second query. */
  private querySketchGeometry(
    session: FcSessionLike, target: FcBuiltFeature, sweep: FcSweepInfo, edgeIdx: number | null,
  ): { parts: Record<string, string>; adjacent: string[] } {
    const candidates: Array<[string, [number, number, number]]> = [];
    for (const seg of sweep.segments) {
      candidates.push([`${seg.role}:${seg.index}`, [seg.at[0], seg.at[1], sweep.height / 2]]);
    }
    candidates.push(['cap:bottom', [sweep.capAt[0], sweep.capAt[1], 0]]);
    candidates.push(['cap:top', [sweep.capAt[0], sweep.capAt[1], sweep.height]]);

    const py =
      `import json, FreeCAD as App, Part\n` +
      `doc = App.ActiveDocument\n` +
      `o = doc.getObject(${pyStr(target.objName)})\n` +
      `sh = o.Shape\n` +
      `faces = list(sh.Faces)\n` +
      `edges = list(sh.Edges)\n` +
      `TOL = 1e-4\n` +
      `def _face_at(pt):\n` +
      `    v = Part.Vertex(App.Vector(pt[0], pt[1], pt[2]))\n` +
      `    for i, f in enumerate(faces):\n` +
      `        try:\n` +
      `            d = v.distToShape(f)[0]\n` +
      `        except Exception:\n` +
      `            continue\n` +
      `        if d <= TOL:\n` +
      `            return i\n` +
      `    return None\n` +
      `result = {}\n` +
      `for key, pt in ${JSON.stringify(candidates)}:\n` +
      `    i = _face_at(pt)\n` +
      `    if i is not None:\n` +
      `        result[key] = 'Face%d' % (i+1)\n` +
      `adjacent = []\n` +
      `eidx = ${edgeIdx === null ? 'None' : num(edgeIdx, 'edgeIdx')}\n` +
      `if eidx is not None and 0 <= eidx < len(edges):\n` +
      `    e = edges[eidx]\n` +
      `    for i, f in enumerate(faces):\n` +
      `        if any(e.isSame(fe) for fe in f.Edges):\n` +
      `            adjacent.append('Face%d' % (i+1))\n` +
      `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'parts': result, 'adjacent': adjacent}))\n`;
    const res = session.read(py);
    return { parts: (res && res.parts) || {}, adjacent: (res && res.adjacent) || [] };
  }

  /** Turn a querySketchGeometry() candidate key back into the TopoName it
   *  stands for, rooted at `feature` (the extrude/Pad ancestor's own id) and
   *  checked against `sweep.from` implicitly by construction (the key came
   *  from `sweep.segments` in the first place). Null for a key this scheme
   *  does not recognise -- defensive, never expected in practice since the
   *  key vocabulary is generated by querySketchGeometry() itself. */
  private nameForSweepKey(feature: string, sweep: FcSweepInfo, key: string): TopoName | null {
    if (key === 'cap:bottom') return { cause: 'cap', feature, kind: 'face', end: 'bottom' };
    if (key === 'cap:top') return { cause: 'cap', feature, kind: 'face', end: 'top' };
    const m = /^(edge|corner):(\d+)$/.exec(key);
    if (!m) return null;
    const index = Number(m[2]);
    return m[1] === 'edge'
      ? { cause: 'swept', feature, kind: 'face', from: sweep.from, edge: index }
      : { cause: 'rounded', feature, kind: 'face', from: sweep.from, corner: index };
  }

  /** The shared-edge lookup resolveEdge() needs for a sketch-derived
   *  `between` pair, once both faces already have real Face{n} names (via
   *  resolveFace()) -- unlike resolvePrimitiveEdgeName(), no direction
   *  scoring is needed here, since the two Face names are already known;
   *  this is exactly resolvePrimitiveEdgeName()'s own edge-finding tail,
   *  extracted so it is not duplicated a third time. */
  private sharedEdgeByName(session: FcSessionLike, objName: string, faceNameA: string, faceNameB: string): string | null {
    const py =
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `o = doc.getObject(${pyStr(objName)})\n` +
      `sh = o.Shape\n` +
      `fa = sh.getElement(${pyStr(faceNameA)})\n` +
      `fb = sh.getElement(${pyStr(faceNameB)})\n` +
      `idx = None\n` +
      `if fa is not None and fb is not None:\n` +
      `    for i, e in enumerate(sh.Edges):\n` +
      `        onA = any(e.isSame(ea) for ea in fa.Edges)\n` +
      `        onB = any(e.isSame(eb) for eb in fb.Edges)\n` +
      `        if onA and onB:\n` +
      `            idx = i\n` +
      `            break\n` +
      `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'edge': ('Edge%d' % (idx+1)) if idx is not None else None}))\n`;
    const res = session.read(py);
    return res.edge ?? null;
  }

  /**
   * The direction+area scoring resolvePrimitiveEdgeName() already proved for
   * one part pair, generalized: computes every candidate part's CURRENT
   * FreeCAD face name in ONE kernel round trip, and -- when `edgeIdx` is
   * given -- which two (by name) of those faces border that edge. Runs
   * against `target.objName` AS IT STANDS NOW, so a part untouched by a
   * later fillet/chamfer on the SAME chain still resolves correctly (the
   * scorer just finds the current face that best faces that direction);
   * the round's own new face never wins any part's contest, which is how a
   * pick on it correctly comes back unnamed rather than guessed.
   */
  private queryPrimitiveGeometry(
    session: FcSessionLike, target: FcBuiltFeature, primitiveKind: 'box' | 'cylinder', edgeIdx: number | null,
  ): { parts: Record<string, string>; adjacent: string[] } {
    const parts = [...(primitiveKind === 'box' ? BOX_PARTS : CYLINDER_PARTS)];
    const py =
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `o = doc.getObject(${pyStr(target.objName)})\n` +
      `sh = o.Shape\n` +
      `bb = sh.BoundBox\n` +
      `cx=(bb.XMin+bb.XMax)/2.0; cy=(bb.YMin+bb.YMax)/2.0; cz=(bb.ZMin+bb.ZMax)/2.0\n` +
      `DIRS = {'+x':(1.0,0.0,0.0),'-x':(-1.0,0.0,0.0),'+y':(0.0,1.0,0.0),'-y':(0.0,-1.0,0.0),'+z':(0.0,0.0,1.0),'-z':(0.0,0.0,-1.0)}\n` +
      `def _score(f, d):\n` +
      `    c = f.CenterOfMass\n` +
      `    return (c.x-cx)*d[0] + (c.y-cy)*d[1] + (c.z-cz)*d[2]\n` +
      `def _resolve_face(part):\n` +
      `    if part in DIRS:\n` +
      `        d = DIRS[part]\n` +
      `        best=None; best_s=-1e18; best_a=-1e18\n` +
      `        for f in sh.Faces:\n` +
      `            s = _score(f, d); a = f.Area\n` +
      `            if s > best_s + 1e-7 or (abs(s-best_s) <= 1e-7 and a > best_a):\n` +
      `                best=f; best_s=max(s,best_s); best_a=a\n` +
      `        return best\n` +
      `    if part == 'side':\n` +
      `        top = _resolve_face('+z'); bot = _resolve_face('-z')\n` +
      `        def _same(x,y):\n` +
      `            return x is not None and (x.CenterOfMass - y.CenterOfMass).Length < 1e-7\n` +
      `        for f in sh.Faces:\n` +
      `            if not _same(top,f) and not _same(bot,f):\n` +
      `                return f\n` +
      `    return None\n` +
      `faces = list(sh.Faces)\n` +
      `edges = list(sh.Edges)\n` +
      `result = {}\n` +
      `for part in ${JSON.stringify(parts)}:\n` +
      `    f = _resolve_face(part)\n` +
      `    if f is not None:\n` +
      `        for i, ff in enumerate(faces):\n` +
      `            if ff.isSame(f):\n` +
      `                result[part] = 'Face%d' % (i+1)\n` +
      `                break\n` +
      `adjacent = []\n` +
      `eidx = ${edgeIdx === null ? 'None' : num(edgeIdx, 'edgeIdx')}\n` +
      `if eidx is not None and 0 <= eidx < len(edges):\n` +
      `    e = edges[eidx]\n` +
      `    for i, f in enumerate(faces):\n` +
      `        if any(e.isSame(fe) for fe in f.Edges):\n` +
      `            adjacent.append('Face%d' % (i+1))\n` +
      `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'parts': result, 'adjacent': adjacent}))\n`;
    const res = session.read(py);
    return { parts: (res && res.parts) || {}, adjacent: (res && res.adjacent) || [] };
  }

  private edgeIndexFromName(name: string): number | null {
    const m = /^Edge(\d+)$/.exec(name);
    return m ? parseInt(m[1], 10) - 1 : null;
  }

  /** `primitive` (a box/cylinder face) or `swept`/`rounded`/`cap` (a Pad's
   *  own wall or cap) -- `between` names an edge, not a face, and every
   *  other cause (`carried`, `split`, `made`) needs history this adapter
   *  does not track (this file's own header). Both branches resolve against
   *  `build.shapes.get(name.feature)` directly -- that IS the primitive's or
   *  the extrude's own built entry by construction (nameFace() below only
   *  ever writes a name with `feature` set to that ancestor's own id, never
   *  an intermediate fillet/pocket), so no ancestor walk is needed here,
   *  unlike nameFace()/nameEdge(). The `swept`/`rounded`/`cap` branch trusts
   *  FcSweepInfo's own cached ORDINAL Face index directly (no geometry
   *  re-derivation) -- safe here specifically because it always queries the
   *  extrude's OWN object by name, which FcSweepInfo's own header measured
   *  to keep a frozen, unchanging Shape regardless of what is built on top
   *  of it later in the same Body. */
  resolveFace(name: TopoName, build: EngineBuildResult): unknown | null {
    if (name.cause === 'primitive') {
      const session = this.requireSession();
      if (name.kind !== 'face') return null;
      const target = build.shapes.get(name.feature) as FcBuiltFeature | undefined;
      if (!target || target.kind !== 'solid') return null;
      if (target.featureKind !== 'box' && target.featureKind !== 'cylinder') return null;
      const parts = target.featureKind === 'box' ? BOX_PARTS : CYLINDER_PARTS;
      if (!parts.has(name.part)) return null;
      const { parts: found } = this.queryPrimitiveGeometry(session, target, target.featureKind, null);
      const faceName = found[name.part];
      return faceName ? ({ objName: target.objName, name: faceName } satisfies FcElementRef) : null;
    }
    if (name.cause === 'swept' || name.cause === 'rounded') {
      const entry = build.shapes.get(name.feature) as FcBuiltFeature | undefined;
      if (!entry || entry.kind !== 'solid' || !entry.sweep || entry.sweep.from !== name.from) return null;
      const want = name.cause === 'swept' ? 'edge' : 'corner';
      const at = name.cause === 'swept' ? name.edge : name.corner;
      const seg = entry.sweep.segments.find((s) => s.role === want && s.index === at);
      return seg ? ({ objName: entry.objName, name: `Face${seg.faceIndex + 1}` } satisfies FcElementRef) : null;
    }
    if (name.cause === 'cap') {
      const entry = build.shapes.get(name.feature) as FcBuiltFeature | undefined;
      if (!entry || entry.kind !== 'solid' || !entry.sweep) return null;
      const idx = name.end === 'bottom' ? entry.sweep.bottomFaceIndex : entry.sweep.topFaceIndex;
      return { objName: entry.objName, name: `Face${idx + 1}` } satisfies FcElementRef;
    }
    return null;
  }

  /** `between` over two `primitive` faces of the SAME box/cylinder --
   *  exactly resolvePrimitiveEdgeName()'s own scope, reused directly -- OR
   *  two `swept`/`rounded`/`cap` faces of the SAME Pad, resolved to real
   *  Face names via resolveFace() above and then joined by
   *  sharedEdgeByName(). A mismatched cause pair, or two names rooted at
   *  different features, is an honest null in both branches, same as
   *  before. */
  resolveEdge(name: TopoName, build: EngineBuildResult): unknown | null {
    const session = this.requireSession();
    if (name.cause !== 'between') return null;
    const [a, b] = name.of;
    if (a.feature !== b.feature) return null;
    if (a.cause === 'primitive' && b.cause === 'primitive') {
      const target = build.shapes.get(a.feature) as FcBuiltFeature | undefined;
      if (!target || target.kind !== 'solid') return null;
      const edgeName = this.resolvePrimitiveEdgeName(session, target, name);
      return edgeName ? ({ objName: target.objName, name: edgeName } satisfies FcElementRef) : null;
    }
    const SKETCH_CAUSES = new Set(['swept', 'rounded', 'cap']);
    if (SKETCH_CAUSES.has(a.cause) && SKETCH_CAUSES.has(b.cause)) {
      const faceA = this.resolveFace(a, build) as FcElementRef | null;
      const faceB = this.resolveFace(b, build) as FcElementRef | null;
      if (!faceA || !faceB || faceA.objName !== faceB.objName) return null;
      const edgeName = this.sharedEdgeByName(session, faceA.objName, faceA.name, faceB.name);
      return edgeName ? ({ objName: faceA.objName, name: edgeName } satisfies FcElementRef) : null;
    }
    return null;
  }

  /** Name a face the student just clicked on `pickedFeature`'s CURRENT
   *  shape. Tries the box/cylinder primitive ancestor first
   *  (findPrimitiveAncestor), then the Pad/extrude ancestor
   *  (findSketchAncestor) -- a chain roots at exactly one of the two kinds,
   *  never both, so this is an either/or, not a fallback-after-failure. The
   *  sketch branch scores every wall/cap candidate against THAT shape as it
   *  stands right now (querySketchGeometry(), the geometric counterpart of
   *  queryPrimitiveGeometry()'s direction scoring) and looks for the one
   *  whose current face matches what was clicked. */
  nameFace(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, face: unknown): TopoName | null {
    const session = this.requireSession();
    const ref = face as FcElementRef | null;
    if (!ref || typeof ref.name !== 'string') return null;
    const target = build.shapes.get(pickedFeature) as FcBuiltFeature | undefined;
    if (!target || target.kind !== 'solid') return null;

    const primAncestor = this.findPrimitiveAncestor(build, doc, pickedFeature);
    if (primAncestor) {
      const { parts } = this.queryPrimitiveGeometry(session, target, primAncestor.kind, null);
      for (const [part, faceName] of Object.entries(parts)) {
        if (faceName === ref.name) return { cause: 'primitive', feature: primAncestor.id, kind: 'face', part };
      }
      return null;
    }

    const sketchAncestor = this.findSketchAncestor(build, doc, pickedFeature);
    if (!sketchAncestor) return null;
    const { parts } = this.querySketchGeometry(session, target, sketchAncestor.sweep, null);
    for (const [key, faceName] of Object.entries(parts)) {
      if (faceName === ref.name) return this.nameForSweepKey(sketchAncestor.id, sketchAncestor.sweep, key);
    }
    return null;
  }

  /** Name an edge the student just clicked, as the `between` of its two
   *  adjacent faces -- same either/or ancestor walk as nameFace(), one
   *  kernel round trip via queryPrimitiveGeometry()/querySketchGeometry()
   *  covers both the part scoring and the edge's own adjacency. */
  nameEdge(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, edge: unknown): TopoName | null {
    const session = this.requireSession();
    const ref = edge as FcElementRef | null;
    if (!ref || typeof ref.name !== 'string') return null;
    const target = build.shapes.get(pickedFeature) as FcBuiltFeature | undefined;
    if (!target || target.kind !== 'solid') return null;
    const edgeIdx = this.edgeIndexFromName(ref.name);
    if (edgeIdx === null) return null;

    const primAncestor = this.findPrimitiveAncestor(build, doc, pickedFeature);
    if (primAncestor) {
      const { parts, adjacent } = this.queryPrimitiveGeometry(session, target, primAncestor.kind, edgeIdx);
      if (adjacent.length !== 2) return null;
      const nameForFace = (faceName: string): TopoName | null => {
        for (const [part, fn] of Object.entries(parts)) {
          if (fn === faceName) return { cause: 'primitive', feature: primAncestor.id, kind: 'face', part };
        }
        return null;
      };
      const a = nameForFace(adjacent[0]);
      const b = nameForFace(adjacent[1]);
      return a && b ? { cause: 'between', feature: a.feature, kind: 'edge', of: [a, b] } : null;
    }

    const sketchAncestor = this.findSketchAncestor(build, doc, pickedFeature);
    if (!sketchAncestor) return null;
    const { parts, adjacent } = this.querySketchGeometry(session, target, sketchAncestor.sweep, edgeIdx);
    if (adjacent.length !== 2) return null;
    const nameForFace = (faceName: string): TopoName | null => {
      for (const [key, fn] of Object.entries(parts)) {
        if (fn === faceName) return this.nameForSweepKey(sketchAncestor.id, sketchAncestor.sweep, key);
      }
      return null;
    };
    const a = nameForFace(adjacent[0]);
    const b = nameForFace(adjacent[1]);
    return a && b ? { cause: 'between', feature: a.feature, kind: 'edge', of: [a, b] } : null;
  }

  /** The picked face's own in-plane size, off the BUILT geometry -- same
   *  "drop the near-zero axis, report the other two smallest-first" rule as
   *  OcctEngineAdapter.faceSize(), computed from FreeCAD's own BoundBox on
   *  the specific sub-element (Shape.getElement(name), the exact call
   *  fc-session.mjs's own meshFaces() comment already verifies against:
   *  "getElement('Face1').Area == Faces[0].Area"). Null for a curved or
   *  non-axis-aligned face, or when the object/element cannot be found --
   *  same "no answer over a wrong one" rule as resolveFace. */
  faceSize(face: unknown): [number, number] | null {
    const session = this.requireSession();
    const ref = face as FcElementRef | null;
    if (!ref || typeof ref.objName !== 'string' || typeof ref.name !== 'string') return null;
    const py =
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `size = None\n` +
      `o = doc.getObject(${pyStr(ref.objName)})\n` +
      `if o is not None:\n` +
      `    el = o.Shape.getElement(${pyStr(ref.name)})\n` +
      `    if el is not None:\n` +
      `        bb = el.BoundBox\n` +
      `        ext = [bb.XMax-bb.XMin, bb.YMax-bb.YMin, bb.ZMax-bb.ZMin]\n` +
      `        flat = next((i for i, e in enumerate(ext) if e < 0.05), None)\n` +
      `        if flat is not None:\n` +
      `            rest = sorted(e for i, e in enumerate(ext) if i != flat)\n` +
      `            size = [round(rest[0], 2), round(rest[1], 2)]\n` +
      `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'size': size}))\n`;
    const res = session.read(py);
    return res && Array.isArray(res.size) ? (res.size as [number, number]) : null;
  }

  /** A picked edge's own true arc length, via FreeCAD's own Edge.Length
   *  (already accounts for a curved edge, not the endpoint-to-endpoint
   *  straight-line distance). Same getElement() lookup as faceSize(). */
  edgeLength(edge: unknown): number | null {
    const session = this.requireSession();
    const ref = edge as FcElementRef | null;
    if (!ref || typeof ref.objName !== 'string' || typeof ref.name !== 'string') return null;
    const py =
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `length = None\n` +
      `o = doc.getObject(${pyStr(ref.objName)})\n` +
      `if o is not None:\n` +
      `    el = o.Shape.getElement(${pyStr(ref.name)})\n` +
      `    if el is not None and el.Length and el.Length > 0:\n` +
      `        length = round(el.Length, 2)\n` +
      `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'length': length}))\n`;
    const res = session.read(py);
    return typeof res?.length === 'number' && Number.isFinite(res.length) ? res.length : null;
  }

  // ---- Save/Open .FCStd ----------------------------------------------------
  //
  // fc-session.mjs already carries the bridge-level primitives this needs
  // (saveDocument()/openDocument(), proven since engine/play/studio.js's own
  // Save/Open buttons) -- both are ModelDoc-agnostic on purpose ("the FreeCAD
  // bridge knows nothing about ModelDoc", this file's own header), so the
  // ModelDoc-specific half (embedding/reading the JSON, deciding when to
  // refuse) lives here instead of in the bridge.
  //
  // See engine-adapter.ts's own saveDocument()/openDocument() doc comments
  // for the full design rationale (why open() refuses rather than guesses).
  // MEASURED against the real kernel, not assumed: App::Document.Comment (a
  // plain string property every FreeCAD document already has) round-trips a
  // multi-hundred-byte JSON string byte-for-byte through saveAs()/
  // openDocument() on fc-kernel-pd-final -- see this port's own report for
  // the probe script and its output. Chosen over App::Document.Meta (a
  // dict-valued property that ALSO round-trips, measured the same way) for
  // being one plain string field with no dict-marshalling edge cases to
  // carry across a Python binding this session has already found surprises
  // in more than once (Body.Tip, OriginFeatures naming).

  saveDocument(doc: ModelDoc): Uint8Array {
    const session = this.requireSession();
    // Rebuild fresh from `doc` itself rather than trusting whatever the
    // session's ActiveDocument happens to currently hold -- a caller could
    // otherwise save a stale or mid-drag preview document that does not
    // match the `doc` it asked to save. build()'s own v1-full-replay
    // discipline (this file's header) makes this cheap and exact: the same
    // session.newDocument('reshape') + full re-emit every build() already
    // does, not a second code path.
    this.build(doc);
    const json = JSON.stringify(doc);
    const { rc, out } = session.exec(
      `import FreeCAD as App\n` +
      `_doc = App.ActiveDocument\n` +
      `_doc.Comment = ${pyStr(MODELDOC_MARKER + json)}\n`,
    );
    if (rc !== 0) throw new Error(`saveDocument: could not embed ModelDoc metadata:\n${out}`);
    return session.saveDocument();
  }

  openDocument(bytes: Uint8Array): ModelDoc | null {
    const session = this.requireSession();
    // Always actually opens the file into the engine's own session -- even
    // when the ModelDoc reconstruction below fails and this returns null,
    // the bytes were still real, kernel-verified `.FCStd` content (openDocument
    // throws on anything that isn't). The very next build() call replaces
    // whatever this leaves active anyway (v1 full-replay, same as save()
    // above), so leaving it loaded costs nothing and matches
    // fc-session.mjs's own openDocument() contract ("becomes the new
    // ActiveDocument").
    session.openDocument(bytes);
    let comment: string | undefined;
    try {
      comment = session.read(
        `import json, FreeCAD as App\n` +
        `_doc = App.ActiveDocument\n` +
        `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'comment': _doc.Comment}))\n`,
      )?.comment;
    } catch {
      return null;
    }
    if (typeof comment !== 'string' || !comment.startsWith(MODELDOC_MARKER)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(comment.slice(MODELDOC_MARKER.length));
    } catch {
      return null;
    }
    if (
      !parsed || typeof parsed !== 'object'
      || (parsed as { version?: unknown }).version !== 1
      || !Array.isArray((parsed as { features?: unknown }).features)
    ) {
      return null;
    }
    return parsed as ModelDoc;
  }

  // ---- exportDrawing() ------------------------------------------------------
  //
  // See engine-adapter.ts's own exportDrawing() doc comment for the full
  // "why SVG, why per-view composition, why OCCT throws" design rationale,
  // and docs/specs/SPEC-techdraw-export.md for the measured evidence behind
  // every step below. Layer split: this method owns the sheet template and
  // the titleblock text (JS-side, since kernel-side substitution does not
  // survive PageResult -- see fillTitleBlock()'s own comment); fc-drawing.mjs
  // (session.exportDrawing()) owns the projected geometry.

  exportDrawing(doc: ModelDoc, opts: DrawingOptions = {}): Uint8Array {
    const session = this.requireSession();

    // (a) Rebuild, exactly as saveDocument() does -- guarantees the drawing
    //     matches the `doc` the caller handed in, not whatever the session
    //     last built.
    const build = this.build(doc);

    // (b) The tip solid is the LAST entry with kind === 'solid'. Same rule
    //     mesh()'s own _active_solid() uses in Python; passing the name
    //     explicitly is more honest than re-deriving it kernel-side.
    let objName: string | null = null;
    let tipEntry: FcBuiltFeature | null = null;
    for (const v of build.shapes.values()) {
      const e = v as FcBuiltFeature;
      if (e.kind === 'solid') { objName = e.objName; tipEntry = e; }
    }
    if (!objName) {
      throw new Error(
        'exportDrawing: nothing to draw -- this model has no solid yet. '
          + 'A sketch on its own projects no edges; pad or extrude it into a solid first.',
      );
    }

    // (c) Sheet: the app's own template string, titleblock filled in HERE.
    //     Kernel-side substitution does NOT work (measured: EditableTexts is
    //     stored and read back correctly but PageResult comes out byte-identical
    //     with the placeholder intact -- the substitution lives in the GUI item).
    //     ModelDoc has no document-level `name` (model-types.ts's own
    //     ModelDoc is just {version, features}) -- default to the tip
    //     solid's OWN feature.name when the caller set one, same as the
    //     tree/label the studio UI already shows for it.
    const sheet = SHEETS[opts.sheet ?? 'A4-landscape'];
    const tipFeature = doc.features.find((f) => f.id === tipEntry!.featureId);
    const svgTemplate = fillTitleBlock(sheet.template, {
      title: opts.title ?? tipFeature?.name ?? 'UNTITLED',
      scale: opts.scale ? formatScale(opts.scale) : '', // filled in after autoscale
      date: new Date().toISOString().slice(0, 10),
    });
    session.Module.FS.writeFile(SHEET_PATH, new TextEncoder().encode(svgTemplate));

    // (d) Clear the target FIRST -- exportStl's own guard. Without it a failed
    //     export silently returns the PREVIOUS run's file and the user
    //     downloads a stale drawing with no symptom at all.
    try { session.Module.FS.unlink(OUT_SVG); } catch { /* first run */ }

    // (e) Kernel side.
    const info = session.exportDrawing({
      objName,
      sheetPath: SHEET_PATH,
      outPath: OUT_SVG,
      views: opts.views ?? (['front', 'top', 'right', 'iso'] as DrawingView[]),
      projection: opts.projection ?? 'third-angle',
      scale: opts.scale ?? null,
      hiddenLines: opts.hiddenLines ?? true,
      area: sheet.frame,
      titleblock: sheet.titleblock,
    });

    if (!info.ok) throw new Error(`exportDrawing: ${info.reason}`);

    // (f) Read the bytes back -- saveDocument/exportStl's exact pattern.
    //     Module.FS.readFile throws an Emscripten ErrnoError with NO .message;
    //     letting it escape crashes studio.js's guard() (which does
    //     e.message.split(...)) and the user sees NOTHING -- no log line, no
    //     download, no error. exportStl already hit this and translates it
    //     (fc-session.mjs:231-237); do the same.
    let bytes: Uint8Array;
    try { bytes = session.Module.FS.readFile(OUT_SVG); }
    catch {
      throw new Error(
        'exportDrawing: the kernel wrote no SVG. Only a solid projects edges -- '
          + 'a sketch or a bare wire draws nothing. Pad it into a solid first.',
      );
    }
    if (!bytes.length) throw new Error('exportDrawing: produced an empty SVG (0 bytes)');

    // (g) Autoscale: the real scale was not known until the kernel returned
    //     it, so the {{SCALE}} token survived fillTitleBlock() untouched --
    //     fill it in now, once, on the returned bytes.
    if (!opts.scale && typeof info.scale === 'number') {
      const text = new TextDecoder('utf8').decode(bytes).replace(/\{\{SCALE\}\}/g, formatScale(info.scale));
      bytes = new TextEncoder().encode(text);
    }
    return bytes;
  }
}
