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
//   - Everything else -- wedge, combine, blend, mirror, pattern, hole,
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
//   - Edge naming for fillet/chamfer is intentionally narrow. §4 risk 3
//     scopes real topological-naming resolution for this engine as separate,
//     unscheduled work ("a second, separate implementation"); this file
//     implements only the case the build-sequence's own self-check needs --
//     a `between` name over two `primitive`-cause faces of the SAME fresh
//     box/cylinder feature, matching topo-resolve.ts's own
//     nameEdgeBetweenPrimitiveFaces() vocabulary ('+x'/'-x'/'+y'/'-y'/'+z'/
//     '-z'/'side'), resolved geometrically against the live FreeCAD shape.
//     Anything else -- an edge from a sweep, a rounded corner, a carried or
//     split face -- reports a per-feature refusal (EngineBuildResult.refusals)
//     rather than guessing, the same "no answer is better than a confidently
//     wrong one" rule topo-resolve.ts's own header states.
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
// NOT implemented, and NOT guessable without more design work: naming a
// face/edge on an extrude/pocket-built solid that came from a SWEPT sketch
// edge or an end CAP (topo-name.ts's `swept`/`cap` causes). The OCCT side
// answers these via BuildResult.sweeps, a per-feature record of which
// TopoDS_Edge each sketch edge generated (topo-history.ts's
// generatedFrom()/capOf(), built from BRepBuilderAPI_MakeShape's own
// Generated() history). FreeCAD's bridge has no equivalent history channel
// today -- session.meshFaces() reports "Face{n}"/"Edge{n}" and nothing about
// which sketch edge or PartDesign::Pad end produced which one. Building
// that would mean either (a) a second, FreeCAD-specific "what came from
// what" tracker parallel to topo-history.ts's OCCT one, or (b) leaning on
// FreeCAD's own Generated()/Modified() Python API across a Pad/Pocket the
// same way OCCT's does -- both are real, unscheduled design questions, not
// a gap this file can close by extending the primitive resolver. A pick on
// such a face/edge (a Pad's side wall, its top/bottom cap) still highlights
// -- resolveFace/resolveEdge/nameFace/nameEdge just return null for it, the
// same "no answer over a wrong one" outcome any unresolvable name already
// gets. See docs/specs/SPEC-engine-port.md §6.2 for the full account.
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
          f.center[0] - w / 2, f.center[1] - d / 2,
          f.center[0] + w / 2, f.center[1] + d / 2,
        );
        const padName = `${f.id}_pad`;
        session.pad(bodyName, sketchName, padName, h);
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -h / 2);
        const entry: FcBuiltFeature = { bodyName, objName: padName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'cylinder') {
        const bodyName = freshBody();
        const sketchName = `${f.id}_sk`;
        session.sketchCircle(bodyName, sketchName, f.radius, f.center[0], f.center[1]);
        const padName = `${f.id}_pad`;
        session.pad(bodyName, sketchName, padName, f.height);
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -f.height / 2);
        const entry: FcBuiltFeature = { bodyName, objName: padName, kind: 'solid', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
      } else if (f.kind === 'sphere') {
        const bodyName = freshBody();
        const featName = `${f.id}_sph`;
        session.sphere(bodyName, featName, f.radius);
        this.setBodyPlacement(session, bodyName, f.center, undefined, 0);
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
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -f.height / 2);
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
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, 0);
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
        this.setBodyPlacement(session, bodyName, f.center, f.rotate, -f.height / 2);
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
        const entry: FcBuiltFeature = { bodyName: src.bodyName, objName: padName, kind: 'solid', featureId: f.id, featureKind: f.kind };
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
        const edgeName = this.resolvePrimitiveEdgeName(session, target, f.edge);
        if (!edgeName) {
          refusals.set(
            f.id,
            `${f.id}'s edge could not be found on the FreeCAD engine -- only an edge between two named `
              + `faces of a fresh box or cylinder primitive resolves today; ${f.id} is shown without it.`,
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

  /** Apply a ModelDoc primitive's center + rotate to the Body that holds it.
   *  The primitive's own geometry is built LOCALLY: X/Y already centred at
   *  `center` (box/cylinder bake it directly into the sketch's own
   *  coordinates; sphere is centred at its own object origin already, per
   *  occt-build.ts's own comment on its sphere branch), Z running
   *  [0, height] from the pad. `localZShift` (usually -height/2) re-centres
   *  Z locally BEFORE rotation, matching occt-build.ts's own centre-at-
   *  origin-then-rotate-then-translate sequence for a box/cylinder
   *  (`turned(oc, moved(oc, raw, [-w/2,-d/2,-h/2]), f.rotate, [0,0,0])`,
   *  then `moved(oc, shape, f.center)` in the caller) -- X/Y are already
   *  centred by construction here, so only Z needs the pre-rotation shift.
   *  Composed as ONE FreeCAD Placement multiplication so the whole Body
   *  (and every feature built inside it afterward, fillets included) moves
   *  together. */
  private setBodyPlacement(
    session: FcSessionLike, bodyName: string, center: Vec3, rotate: Vec3 | undefined, localZShift: number,
  ): void {
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
  // same way occt-build.ts builds a box unrotated-then-rotated. Whether that
  // picking path also needs a rotation-aware fix is a real, separate,
  // UNVERIFIED question this pass did not have scope to chase down -- see
  // this port's own report.
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

  /** `primitive` cause only -- `between` names an edge, not a face, and
   *  every other cause (`swept`, `cap`, `carried`, `split`, `made`) needs
   *  history this adapter does not track (this file's own header). Resolves
   *  against `build.shapes.get(name.feature)` directly -- that IS the
   *  primitive's own built entry by construction (nameFace() below only
   *  ever writes a `primitive` name with `feature` set to the primitive
   *  ancestor id, never an intermediate fillet), so no ancestor walk is
   *  needed here, unlike nameFace()/nameEdge(). */
  resolveFace(name: TopoName, build: EngineBuildResult): unknown | null {
    const session = this.requireSession();
    if (name.cause !== 'primitive' || name.kind !== 'face') return null;
    const target = build.shapes.get(name.feature) as FcBuiltFeature | undefined;
    if (!target || target.kind !== 'solid') return null;
    if (target.featureKind !== 'box' && target.featureKind !== 'cylinder') return null;
    const parts = target.featureKind === 'box' ? BOX_PARTS : CYLINDER_PARTS;
    if (!parts.has(name.part)) return null;
    const { parts: found } = this.queryPrimitiveGeometry(session, target, target.featureKind, null);
    const faceName = found[name.part];
    return faceName ? ({ objName: target.objName, name: faceName } satisfies FcElementRef) : null;
  }

  /** `between` cause only, over two `primitive` faces of the SAME
   *  box/cylinder -- exactly resolvePrimitiveEdgeName()'s own scope,
   *  reused directly rather than duplicated (it already takes a `target`
   *  and re-derives it here from `name.of[0].feature`, which is what that
   *  edge's own `.feature` is set to by nameEdge() below and by
   *  nameEdgeOnCurrentShape()'s OCCT counterpart alike). */
  resolveEdge(name: TopoName, build: EngineBuildResult): unknown | null {
    const session = this.requireSession();
    if (name.cause !== 'between') return null;
    const [a, b] = name.of;
    if (a.cause !== 'primitive' || b.cause !== 'primitive' || a.feature !== b.feature) return null;
    const target = build.shapes.get(a.feature) as FcBuiltFeature | undefined;
    if (!target || target.kind !== 'solid') return null;
    const edgeName = this.resolvePrimitiveEdgeName(session, target, name);
    return edgeName ? ({ objName: target.objName, name: edgeName } satisfies FcElementRef) : null;
  }

  /** Name a face the student just clicked on `pickedFeature`'s CURRENT
   *  shape. Walks back to the box/cylinder primitive that chain started
   *  from (findPrimitiveAncestor -- null for anything else, including a
   *  sketch/extrude/pocket chain, per this file's own header), then scores
   *  every part against THAT shape as it stands right now and looks for the
   *  one whose current face matches what was clicked. */
  nameFace(build: EngineBuildResult, _doc: ModelDoc, pickedFeature: string, face: unknown): TopoName | null {
    const session = this.requireSession();
    const ref = face as FcElementRef | null;
    if (!ref || typeof ref.name !== 'string') return null;
    const target = build.shapes.get(pickedFeature) as FcBuiltFeature | undefined;
    if (!target || target.kind !== 'solid') return null;
    const ancestor = this.findPrimitiveAncestor(build, _doc, pickedFeature);
    if (!ancestor) return null;
    const { parts } = this.queryPrimitiveGeometry(session, target, ancestor.kind, null);
    for (const [part, faceName] of Object.entries(parts)) {
      if (faceName === ref.name) return { cause: 'primitive', feature: ancestor.id, kind: 'face', part };
    }
    return null;
  }

  /** Name an edge the student just clicked, as the `between` of its two
   *  adjacent faces -- same primitive-ancestor walk as nameFace(), one
   *  kernel round trip via queryPrimitiveGeometry() covers both the part
   *  scoring and the edge's own adjacency. */
  nameEdge(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, edge: unknown): TopoName | null {
    const session = this.requireSession();
    const ref = edge as FcElementRef | null;
    if (!ref || typeof ref.name !== 'string') return null;
    const target = build.shapes.get(pickedFeature) as FcBuiltFeature | undefined;
    if (!target || target.kind !== 'solid') return null;
    const ancestor = this.findPrimitiveAncestor(build, doc, pickedFeature);
    if (!ancestor) return null;
    const edgeIdx = this.edgeIndexFromName(ref.name);
    if (edgeIdx === null) return null;
    const { parts, adjacent } = this.queryPrimitiveGeometry(session, target, ancestor.kind, edgeIdx);
    if (adjacent.length !== 2) return null;
    const nameForFace = (faceName: string): TopoName | null => {
      for (const [part, fn] of Object.entries(parts)) {
        if (fn === faceName) return { cause: 'primitive', feature: ancestor.id, kind: 'face', part };
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
