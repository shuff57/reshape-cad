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
//     convention as fillet/chamfer/extrude/pocket. NARROWED, not a full
//     port of PatternFeature's shape -- see the 'pattern' branch's own
//     comment for the three found semantic gaps (a rotated target's
//     pattern axis co-rotates with the body instead of staying
//     world-frame; a non-'z' circular axis is unsupported; a circular
//     pattern of ANY primitive target -- box, cylinder, sphere, cone,
//     torus, or prism -- is a geometric no-op, found only by running
//     against the real kernel) -- all three REFUSED per-feature
//     (EngineBuildResult.refusals) rather than built wrong.
//     The axis narrowing is invisible in practice
//     -- ModelEditor.tsx's newPattern() hardcodes axis 'z' and never
//     exposes another axis in its own UI. The rotated-target refusal IS
//     reachable, though: whyCannotOrbit() only gates a target sitting ON
//     the orbit axis (center too close to it), not a target that has been
//     turned via canRotate()'s own Turn control -- a box rotated then
//     patterned hits this refusal for real. Named here, not silently
//     narrowed away; see this port's own report.
//   - Everything else -- wedge, combine, blend, mirror, hole,
//     shell, move, draft, and (see the note on the 'revolve' branch's
//     absence below) revolve/groove -- throws a clear "not yet supported
//     on the FreeCAD engine: <kind>", per step 7's own instruction, rather
//     than silently building the wrong shape. wedge specifically was
//     investigated and rejected, not merely unstarted: fc-commands.mjs's
//     emit.wedge() only ever sets PartDesign::Wedge's Width and Height,
//     with no parameter for ModelDoc's own WedgeFeature.depth at all -- a
//     found mismatch of the same kind as revolve/groove's orientation gap,
//     not something this pass can close by guessing a property mapping.
//   - v1 is SINGLE-BODY-PER-CHAIN: every primitive/sketch starts its own
//     fresh PartDesign::Body, and only extrude/pocket/fillet/chamfer -- which
//     all take a `target` naming an earlier feature -- continue building
//     inside THAT feature's own body. combine (needed to join two
//     independent chains into one) is out of scope (§4 risk 6 names this as
//     an open design question, not resolved here).
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

import type { Feature, ModelDoc, SketchFeature, Vec3 } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type * as THREE_NS from 'three';
import { createFcSession } from '@shuff57/reshape-engine/fc-session';
import { attachCommands } from '@shuff57/reshape-engine/fc-commands';
import { attachSketchCommands } from '@shuff57/reshape-engine/fc-sketch';
import { loadFreeCadEngine } from '@shuff57/reshape-engine/load-browser';
import { translateSketch, type SketchSession } from '@shuff57/reshape-engine/sketch-translate';
import { arcFromBulge, circleOf, outlineOf, segmentRoles } from '@shuff57/reshape-sketch/sketch-arc';
import type { EngineAdapter, EngineBuildResult, EngineMesh } from './engine-adapter.js';
import type { FaceRange } from './occt-three.js';

/** The slice of the bridge session (fc-session.mjs core + fc-commands.mjs +
 *  fc-sketch.mjs, all attached) this adapter calls. Loose by the same
 *  discipline occt-build.ts's `Occt` uses -- the bridge is plain .mjs with
 *  no .d.ts of its own. */
export interface FcSessionLike extends SketchSession {
  newDocument(name?: string): void;
  exec(code: string): { rc: number; out: string };
  read(code: string): any;
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
  linearPattern(bodyName: string, featureName: string, count: number, step: number, axis?: 'x' | 'y' | 'z', patternName?: string): string;
  polarPattern(bodyName: string, featureName: string, count: number, angle?: number, axis?: 'x' | 'y' | 'z', patternName?: string): string;
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
        const session = attachSketchCommands(attachCommands(createFcSession(Module))) as FcSessionLike;
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
    // each Body was placed with -- set alongside setBodyPlacement() below,
    // read by the 'pattern' branch. Needed because PartDesign::LinearPattern/
    // PolarPattern's Direction/Axis resolve through the Body's OWN Origin
    // datum, which lives in BODY-LOCAL space and therefore co-rotates with
    // Body.Placement -- unlike occt-build.ts's pattern, whose step/axis is
    // always a literal WORLD-frame vector (see the 'pattern' branch's own
    // comment below for the full explanation).
    const bodyRotate = new Map<string, Vec3>();
    // false for EVERY primitive kind (box, cylinder, sphere, cone, torus,
    // prism) -- each one's own sketch/native-feature geometry sits at/near
    // local (0,0,0) regardless of f.center; center is applied ONLY via
    // Body.Placement, per each branch's own comment below. Has no entry
    // (undefined, not false) for a sketch/extrude/pocket/fillet/chamfer
    // chain, which never calls setBodyPlacement at all, so Body.Placement
    // stays identity and body-local IS world for those.
    //
    // box/cylinder USED to bake f.center directly into their own sketch's
    // local x/y coordinates (true here) -- that was a real, separate bug
    // (see setBodyPlacement's own header): center got applied TWICE, once
    // baked into the sketch and once again via Body.Placement, doubling an
    // off-origin box/cylinder's world position (measured live: center
    // [30,20,0] came back with a world bbox center of [60,40,0]). Fixed by
    // moving their sketch geometry to local (0,0), matching sphere/cone/
    // torus/prism's existing convention -- so box/cylinder are false here
    // too now, same as every other primitive.
    //
    // This matters for the SAME reason bodyRotate does: a circular
    // pattern's Axis resolves through the Body's own Origin datum, fixed at
    // body-LOCAL (0,0) -- for a target whose local geometry is ALSO
    // effectively at (0,0) (false here), orbiting it around that axis is a
    // geometric no-op (every copy lands on the original), regardless of how
    // far from the WORLD origin f.center actually placed it. Measured
    // against the real kernel: a radius-5 sphere at center [30,0,0],
    // patterned 4x around 'z', built with no error and no refusal but came
    // back with the volume of exactly ONE sphere, not four -- confirming
    // the four copies had silently collapsed onto each other. Since the
    // box/cylinder fix above, this is now true for EVERY primitive kind,
    // not just sphere/cone/torus/prism -- see the 'pattern' branch's own
    // refusal below, which now covers all six. Refused rather than shipped.
    const bodyLocalCentered = new Map<string, boolean>();

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
        bodyLocalCentered.set(bodyName, false);
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
        bodyLocalCentered.set(bodyName, false);
        const entry: FcBuiltFeature = { bodyName, objName: padName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'sphere') {
        const bodyName = freshBody();
        const featName = `${f.id}_sph`;
        session.sphere(bodyName, featName, f.radius);
        this.setBodyPlacement(session, bodyName, f.center, undefined, 0, bodyRotate);
        bodyLocalCentered.set(bodyName, false);
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
        bodyLocalCentered.set(bodyName, false);
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
        bodyLocalCentered.set(bodyName, false);
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
        bodyLocalCentered.set(bodyName, false);
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
        if (target.bodyName !== into.bodyName) {
          throw new Error(`not yet supported on the FreeCAD engine: pocket ${f.id} cuts across two different bodies (no combine yet)`);
        }
        const pocketName = `${f.id}_pocket`;
        session.pocket(into.bodyName, target.objName, pocketName, f.depth);
        const entry: FcBuiltFeature = { bodyName: into.bodyName, objName: pocketName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'fillet') {
        const target = requireBuilt(f.target, `${f.style} ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build ${f.style} ${f.id}: '${f.target}' is not a solid`);
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
        // fc-commands.mjs already carries native PartDesign::LinearPattern/
        // PolarPattern emitters (engine/bridge/pattern-test.mjs proved them
        // at the string level; this is the first live-kernel use). Built in
        // the SAME body as the target, matching fillet/chamfer/extrude/
        // pocket's own "continue in the target's body" convention.
        //
        // THREE genuine semantic gaps were found here, of the same kind as
        // the revolve/groove orientation mismatch and wedge's missing-
        // parameter gap this file's own header already documents -- each
        // narrower, though: each affects a SUBSET of inputs, not every
        // pattern, so the subset that is verified-correct against the real
        // kernel is built for real rather than refusing pattern outright.
        // All three trace back to the same root cause: occt-build.ts's own
        // comment on its pattern branch is explicit that BOTH modes work in
        // WORLD coordinates -- linear moves by a literal world-frame
        // vector, circular orbits a line through the WORLD origin along
        // f.axis, regardless of where the target sits, how it is rotated,
        // or what kind of primitive it is. FreeCAD's LinearPattern/
        // PolarPattern instead resolve their Direction/Axis through the
        // owning Body's OWN Origin datum (Body.Origin.X_Axis/Y_Axis/
        // Z_Axis) -- a line fixed at BODY-LOCAL (0,0,0), which co-rotates
        // with Body.Placement and has no knowledge of where Placement will
        // later put the body in the world.
        //
        // 1. A ROTATED target (setBodyPlacement's own f.rotate, tracked
        //    per-body in `bodyRotate` above): the pattern would silently
        //    repeat along the body's own tilted local axis instead of the
        //    world axis ModelDoc asked for. Refused below for any pattern,
        //    linear or circular, on a rotated target.
        // 2. A non-'z' circular axis: v1 narrows circular mode to 'z' only,
        //    matching every pattern the studio UI itself can actually
        //    produce (ModelEditor.tsx's newPattern() hardcodes axis: 'z',
        //    never exposes another axis in the Dimensions panel).
        // 3. Found ONLY by running against the real kernel, not from
        //    reading the code: a circular pattern of ANY primitive target
        //    (box, cylinder, sphere, cone, torus, prism). None of the six
        //    bake f.center into their own local geometry at all (center is
        //    applied purely via Body.Placement, per each branch's own
        //    comment above) -- so their local shape sits at/near body-local
        //    (0,0,0), exactly where the pattern's own Origin-datum axis also
        //    sits, REGARDLESS of how far from the world origin f.center
        //    actually placed them. Orbiting them is a geometric no-op.
        //    Measured: a radius-5 sphere at center [30,0,0], patterned 4x
        //    around 'z', built with no error and no refusal but came back
        //    with the volume of exactly one sphere, not four -- see
        //    `bodyLocalCentered`'s own declaration above and this port's
        //    own report. box/cylinder USED to be unaffected (their sketch
        //    geometry baked f.center into local x/y, so their local shape
        //    sat away from the axis) -- but that was itself a real,
        //    separate bug (setBodyPlacement's own header: center got
        //    applied twice, doubling their world position), fixed by moving
        //    their sketch geometry to local (0,0) too. Now every primitive
        //    kind hits this gap the same way. A non-primitive chain
        //    (sketch/extrude/pocket/fillet/chamfer never calls
        //    setBodyPlacement at all, so Body.Placement stays identity and
        //    body-local IS world for them) is still unaffected.
        // Linear patterns are unaffected by gaps 2 and 3 -- translation has
        // no "wrong pivot" the way rotation does.
        const target = requireBuilt(f.target, `pattern ${f.id}`);
        if (target.kind !== 'solid') throw new Error(`cannot build pattern ${f.id}: '${f.target}' is not a solid`);

        if (f.count < 1) {
          refusals.set(f.id, `${f.id} needs at least one copy -- ${f.id} is shown without it.`);
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

        const rootRotate = bodyRotate.get(target.bodyName) ?? [0, 0, 0];
        if (rootRotate.some((v) => v !== 0)) {
          refusals.set(
            f.id,
            `${f.id} could not be built on the FreeCAD engine -- patterning a rotated primitive is not `
              + `yet supported (the pattern's own axis would rotate with the body instead of staying on `
              + `the world axis); ${f.id} is shown without it.`,
          );
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }

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
            resultName = session.linearPattern(target.bodyName, target.objName, f.count, length, axis, patternName);
          }
        } else {
          const axis = f.axis ?? 'z';
          if (axis !== 'z') {
            refusals.set(
              f.id,
              `${f.id} could not be built on the FreeCAD engine -- circular patterns around the '${axis}' `
                + `axis are not yet supported (only 'z' is built today); ${f.id} is shown without it.`,
            );
          } else if (bodyLocalCentered.get(target.bodyName) === false) {
            // See bodyLocalCentered's own declaration above -- EVERY
            // primitive target's (box, cylinder, sphere, cone, torus,
            // prism) local geometry sits at/near the SAME body-local origin
            // the pattern orbits, so every copy would silently land on the
            // original. Measured against the real kernel, not assumed: see
            // this port's own report.
            refusals.set(
              f.id,
              `${f.id} could not be built on the FreeCAD engine -- a circular pattern of a primitive `
                + `(box, cylinder, sphere, cone, torus or prism) is not yet supported (every copy would `
                + `land on the original); ${f.id} is shown without it.`,
            );
          } else {
            resultName = session.polarPattern(target.bodyName, target.objName, f.count, f.totalAngle ?? 360, 'z', patternName);
          }
        }

        if (resultName === null) {
          built.set(f.id, target);
          shapes.set(f.id, target);
          continue;
        }
        const entry: FcBuiltFeature = { bodyName: target.bodyName, objName: resultName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else {
        // revolve/groove: occt-build.ts's own revolve reads a flat sketch's
        // (u, v) as (radius, height) about the PLANE'S NORMAL
        // (revolveProfileFace's own comment); FreeCAD's PartDesign::Revolution
        // spins a profile about an axis LYING IN the profile's own plane. A
        // sketch built by translateSketch() here is flat on world XY, which
        // is the wrong orientation for FreeCAD's Revolution outright -- it
        // would need a SEPARATE profile sketch built in a plane containing
        // the axis (e.g. attached to the Body's own XZ_Plane datum), which
        // this port has not built or verified. Rather than ship a lathe
        // profile with an unverified orientation, this is named here as a
        // found mismatch (matching this task's own instruction to stop and
        // report rather than improvise past it) and throws, same as the
        // other unimplemented kinds.
        throw new Error(`not yet supported on the FreeCAD engine: ${f.kind}`);
      }
    }

    return { shapes, refusals: refusals.size ? refusals : undefined };
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
}
