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
//     only), extrude -> Pad, pocket, fillet, chamfer.
//   - Everything else -- cone, torus, prism, wedge, combine, blend, mirror,
//     pattern, hole, shell, move, draft, and (see the note on the 'revolve'
//     branch's absence below) revolve/groove -- throws a clear "not yet
//     supported on the FreeCAD engine: <kind>", per step 7's own
//     instruction, rather than silently building the wrong shape.
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
// Picking (resolveFace/resolveEdge/nameFace/nameEdge) is the SAME risk-3
// work, unscheduled in build-sequence steps 7-9 (nothing calls them this
// phase -- step 10, the BrepViewportThree.tsx seam refactor, is phase 3) and
// implemented here as a clear "not yet implemented" throw rather than a
// guess. edges()/faceAt() need no naming history at all -- they are FreeCAD's
// own OWN documented Face{n}/Edge{n} sub-element convention (fc-session.mjs's
// meshFaces() comment: "faceId i == 'Face{i+1}'") -- so those ARE implemented.

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

  mesh(shape: unknown, opts?: { deflection?: number }): EngineMesh | null {
    const session = this.requireSession();
    const s = shape as FcBuiltFeature | null;
    if (!s || s.kind !== 'solid') return null;

    const raw = session.meshFaces(s.objName, opts?.deflection ?? 0.1);
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
   *  a drawable line -- no naming history needed, unlike resolveEdge(). */
  edges(shape: unknown): Array<{ edge: unknown; geometry: THREE_NS.BufferGeometry }> {
    const session = this.requireSession();
    const s = shape as FcBuiltFeature | null;
    if (!s || s.kind !== 'solid') return [];
    const raw = session.meshFaces(s.objName);
    if (!raw || raw.empty || !raw.edges) return [];
    return raw.edges.map((e) => {
      const geometry = new this.THREE.BufferGeometry();
      geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(e.points, 3));
      return { edge: `Edge${e.id + 1}`, geometry };
    });
  }

  /** The reverse of mesh()'s own FaceRange.index -- FreeCAD's own
   *  `"Face" + (index+1)` convention (same source comment as edges()
   *  above), needing no kernel round-trip to answer. */
  faceAt(shape: unknown, index: number): unknown | null {
    const s = shape as FcBuiltFeature | null;
    if (!s || s.kind !== 'solid' || index < 0) return null;
    return `Face${index + 1}`;
  }

  resolveFace(_name: TopoName, _build: EngineBuildResult): unknown | null {
    throw new Error(
      'FreeCadEngineAdapter.resolveFace: general topological-name resolution for this engine is not yet '
        + 'implemented (SPEC-engine-port.md §4 risk 3) -- only fillet/chamfer edge lookup has a narrow, '
        + 'internal resolver so far.',
    );
  }

  resolveEdge(_name: TopoName, _build: EngineBuildResult): unknown | null {
    throw new Error(
      'FreeCadEngineAdapter.resolveEdge: general topological-name resolution for this engine is not yet '
        + 'implemented (SPEC-engine-port.md §4 risk 3) -- only fillet/chamfer edge lookup has a narrow, '
        + 'internal resolver so far.',
    );
  }

  nameFace(_build: EngineBuildResult, _doc: ModelDoc, _pickedFeature: string, _face: unknown): TopoName | null {
    throw new Error(
      'FreeCadEngineAdapter.nameFace: naming a picked face on this engine is not yet implemented '
        + '(SPEC-engine-port.md §4 risk 3).',
    );
  }

  nameEdge(_build: EngineBuildResult, _doc: ModelDoc, _pickedFeature: string, _edge: unknown): TopoName | null {
    throw new Error(
      'FreeCadEngineAdapter.nameEdge: naming a picked edge on this engine is not yet implemented '
        + '(SPEC-engine-port.md §4 risk 3).',
    );
  }
}
