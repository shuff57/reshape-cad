// packages/kernel/src/engine-adapter.ts
//
// The common seam both kernels answer to. packages/kernel and
// packages/engine deliberately do not depend on each other (see
// docs/specs/SPEC-engine-port.md §2.1 -- the FreeCAD bridge knows nothing
// about ModelDoc, and this package's OCCT code knows nothing about FreeCAD
// sessions), so this interface lives wherever BOTH the consumer
// (BrepViewportThree.tsx) and both implementations already import from --
// packages/kernel, since BrepViewportThree.tsx already depends on it for
// occt-build/occt-three/topo-resolve.
//
// Pinned by grepping BrepViewportThree.tsx (as it stood before this port)
// for every direct call into kernel.oc / facesOf / resolveName /
// resolveNameAsUsedBy / nameFaceOnCurrentShape / nameEdgeOnCurrentShape /
// tessellateToThree / edgesToThree, then reading each call site rather than
// trusting the grep list alone -- two things the list names turned out NOT
// to be called directly by the component, and one call's actual direction
// was the opposite of what its name suggests:
//
//   - resolveNameAsUsedBy is never called BY the component -- it's called
//     internally by nameFaceOnCurrentShape() (topo-resolve.ts), which the
//     component does call. So it is not part of this seam; each adapter's
//     own nameFace()/nameEdge() implementation is free to use an
//     as-used-by push internally, same as the OCCT path already does.
//   - facesOf() is called as `facesOf(oc, shape)[index]` -- turning a
//     FaceRange.index (from a raycast hit, or a persisted selection) back
//     into a face handle, i.e. the REVERSE of "index of a face". That's
//     faceAt() below, not a face-to-index lookup.
//   - resolveName() is called once (restorePicks(), always on an EDGE name
//     read back from a persisted pick) -- the edge half of resolveFace/
//     resolveEdge below. No face-by-name call exists at a component call
//     site today; resolveFace is kept anyway for symmetry with resolveName()
//     itself, which is cause-generic in topo-resolve.ts and does not
//     distinguish face names from edge names.
//
// `oc` itself is intentionally NOT part of this interface: every OCCT-shaped
// call the component makes (per the list above) goes through one of these
// methods. Step 10 (the seam refactor itself) found two more direct `oc`
// reaches this list had not named -- a local `faceSize(oc, face)` /
// `edgeLength(oc, edge)` pair, and a purely diagnostic
// `Object.keys(kernel.oc).length` in the loading-note text -- and closed the
// first two as `faceSize`/`edgeLength` above (OcctEngineAdapter moves the
// existing Bnd_Box/BRepGProp logic in verbatim; FreeCadEngineAdapter throws
// "not yet implemented", same as resolveFace/nameFace, since real
// measurement against a FreeCAD shape is unscheduled §4 risk-3 work). The
// third had no adapter-neutral equivalent (a FreeCAD session has no `oc`
// export count to report) and was simply replaced with engine-mode-neutral
// loading text -- see BrepViewportThree.tsx's own loadEngine().

import type { ModelDoc } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type * as THREE from 'three';
import type { FaceRange } from './occt-three.js';

/** What one build produced, in adapter-neutral terms. `shapes` mirrors
 *  BuildResult.shapes (feature id -> built shape) -- kept as `unknown`
 *  rather than `any` because callers only ever pass a shape back into this
 *  SAME adapter's own methods (mesh/resolveFace/resolveEdge/nameFace/
 *  nameEdge), never inspect it directly; each implementation knows its own
 *  concrete shape type. `refusals` mirrors BuildResult.refusals exactly
 *  (occt-build.ts) -- per-feature reasons a feature's result differs from
 *  what its document row asked for. */
export interface EngineBuildResult {
  shapes: Map<string, unknown>;
  refusals?: Map<string, string>;
}

/** A meshed shape, three.js-ready -- the adapter-neutral shape of
 *  occt-three.ts's BrepThreeMesh. Both adapters converge on this even though
 *  OcctEngineAdapter gets it for free (tessellateToThree already returns
 *  this shape) and FreeCadEngineAdapter has to build it from
 *  session.meshFaces()'s JSON (§2 build sequence step 8). */
export interface EngineMesh {
  geometry: THREE.BufferGeometry;
  faces: FaceRange[];
}

export type DrawingView = 'front' | 'top' | 'right' | 'left' | 'rear' | 'bottom' | 'iso';

export interface DrawingOptions {
  /** Sheet size. Default 'A4-landscape' (297x210mm). */
  sheet?: 'A4-landscape' | 'A3-landscape' | 'USLetter-landscape';
  /** Default ['front','top','right','iso']. */
  views?: DrawingView[];
  /** Default 'third-angle'. */
  projection?: 'first-angle' | 'third-angle';
  /** Omit for automatic (fit to sheet). */
  scale?: number;
  /** Dashed hidden-line rendering on the orthographic views. Default true. */
  hiddenLines?: boolean;
  /** Titleblock text. Default: the doc's own name. */
  title?: string;
  /** Overall-extent dimensions on the orthographic views: the view's own
   *  projected width and height, plus a diameter callout per visible circle.
   *  Default 'none'.
   *
   *  'overall' is the honest name and the whole scope. It is NOT GD&T
   *  auto-dimensioning: no feature-relative positions, no fillet radii, no
   *  angles, no tolerances, no datums, and nothing at all on an isometric
   *  view (its edges project as ellipses and skewed lines, which cannot be
   *  dimensioned meaningfully). See docs/specs/SPEC-drawing-pdf-dimensions.md
   *  Part 2 for what was measured and what was deferred.
   *
   *  A view whose projection yields no straight edge and no closed circle
   *  gets NO dimensions and is reported in `skipped` rather than guessed at. */
  dimensions?: 'none' | 'overall';
}

export interface EngineAdapter {
  /** Bring the underlying kernel up (load the wasm, or open a session).
   *  Idempotent-ish in spirit -- called once before the first build(). */
  load(): Promise<void>;

  /** Rebuild every shape in `doc`. OcctEngineAdapter forwards straight to
   *  buildDoc(); FreeCadEngineAdapter replays the whole feature list through
   *  fresh FreeCAD commands (SPEC-engine-port.md §4 risk 1 -- v1 is full
   *  replay, not an incremental diff). */
  build(doc: ModelDoc): EngineBuildResult;

  /** Mesh one already-built shape for three.js. Returns null exactly when
   *  tessellateToThree() would: no drawable surface. `deflection` is the
   *  chord tolerance in mm, same convention both kernels already use. */
  mesh(shape: unknown, opts?: { deflection?: number }): EngineMesh | null;

  /** Every pickable edge of a built shape, paired with its line geometry --
   *  the adapter form of edgesToThree(). Raycaster hits one of these lines
   *  and the caller gets back the SAME edge handle resolveEdge()/nameEdge()
   *  take, without re-walking the shape. */
  edges(shape: unknown): Array<{ edge: unknown; geometry: THREE.BufferGeometry }>;

  /** The face at FaceRange.index on a built shape -- the reverse lookup a
   *  raycast hit (or a persisted face selection) needs, in the SAME order
   *  mesh()'s FaceRange.index was assigned in. The adapter form of
   *  `facesOf(oc, shape)[index]`. Out-of-range or unmeshed returns null. */
  faceAt(shape: unknown, index: number): unknown | null;

  /** Resolve a stored TopoName back to a face/edge on a freshly built shape
   *  (picking-by-reference: fillet an edge, widen the part, the name still
   *  finds it). Null is a real answer -- see topo-resolve.ts's resolveName()
   *  doc comment -- and every caller must treat it as one. */
  resolveFace(name: TopoName, build: EngineBuildResult): unknown | null;
  resolveEdge(name: TopoName, build: EngineBuildResult): unknown | null;

  /** Name a face/edge the student just clicked, on the CURRENT top-level
   *  shape of `pickedFeature` -- the adapter form of
   *  nameFaceOnCurrentShape()/nameEdgeOnCurrentShape(). Null means "no
   *  recorded path back to a nameable primitive", not an error. */
  nameFace(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, face: unknown): TopoName | null;
  nameEdge(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, edge: unknown): TopoName | null;

  /** A picked face's own in-plane size (e.g. [40, 40] for a box's top face),
   *  read off the BUILT geometry -- the adapter form of
   *  BrepViewportThree.tsx's own module-level faceSize(oc, face) helper,
   *  found during the step-10 seam refactor: it reached into `kernel.oc`
   *  directly (Bnd_Box/BRepBndLib), same as every other call this interface
   *  already covers, so it moves here rather than staying a stray exception.
   *  Null for a curved or non-axis-aligned face, or whenever the size cannot
   *  be computed -- same "no answer over a wrong one" rule as resolveFace. */
  faceSize(face: unknown): [number, number] | null;

  /** A picked edge's own true arc length -- the adapter form of
   *  BrepViewportThree.tsx's own module-level edgeLength(oc, edge) helper,
   *  moved here for the same reason as faceSize above. Null whenever it
   *  cannot be computed. */
  edgeLength(edge: unknown): number | null;

  /** Serialize `doc` to a real `.FCStd` (a zip archive) -- bytes for the
   *  caller to hand off as a browser download, the same "adapter returns
   *  bytes, caller owns the Blob/download" split packages/studio's own
   *  mesh-export.ts writers already follow for Export STL/OBJ/3MF.
   *
   *  The file's own embedded FreeCAD geometry is a faithful, independently
   *  openable `.FCStd` (real PartDesign/Sketcher objects, verified against
   *  the real kernel) -- but it ALSO carries the ORIGINAL ModelDoc as JSON in
   *  the document's own metadata, so openDocument() below can round-trip
   *  anything THIS method saved exactly, without reverse-engineering a
   *  general FreeCAD feature tree back into ModelDoc's own narrower
   *  vocabulary. See openDocument()'s own comment for why that reverse
   *  direction is refused instead of guessed.
   *
   *  OcctEngineAdapter throws -- OCCT has no `.FCStd` concept at all, so this
   *  is a real "not supported on this engine" condition, not a bug; callers
   *  should gate the UI on the current engine mode rather than only catching
   *  this (packages/kernel/src/config.ts's getEngineMode()). */
  saveDocument(doc: ModelDoc): Uint8Array;

  /** Reconstruct a ModelDoc from `.FCStd` bytes. Succeeds ONLY for a file
   *  saveDocument() (on some FreeCadEngineAdapter) produced -- detected via
   *  the embedded ModelDoc metadata described above -- and returns null for
   *  anything else. An arbitrary real-world `.FCStd`, built in actual
   *  FreeCAD Part/PartDesign workflows outside this app, has no ModelDoc-
   *  shaped history at all: any body count, feature kinds this app's own
   *  Feature vocabulary cannot name, Sketcher constraints its own translator
   *  never emits, multi-body assemblies this adapter's v1 (single-body-per-
   *  chain) cannot represent... Reconstructing a GUESSED ModelDoc from a
   *  general feature tree would silently misrepresent the model the moment
   *  the guess is wrong -- refused outright instead, the same "no answer
   *  over a wrong one" rule as resolveFace/resolveEdge and the pattern
   *  refusals in freecad-engine-adapter.ts. Null is a real, expected answer
   *  for "not a file this app produced" (or a corrupt one), not an error --
   *  the caller decides how to tell the student (e.g. "this file wasn't
   *  created by this app and can't be reopened here").
   *
   *  OcctEngineAdapter throws -- same reasoning as saveDocument(). */
  openDocument(bytes: Uint8Array): ModelDoc | null;

  /** Render `doc` as a real 2D engineering drawing -- a standard multi-view
   *  projection on a titled sheet -- and return SVG bytes, the same "adapter
   *  returns bytes, caller owns the Blob/download" split saveDocument() and
   *  packages/studio's mesh exporters already follow.
   *
   *  SVG, not PDF, deliberately: this kernel has NO App-layer PDF writer at
   *  all (verified -- TechDrawGui, which owns every QPrinter/QSvgGenerator
   *  path, is not built into the headless kernel). A caller wanting PDF
   *  converts the SVG browser-side; that is not this seam's job.
   *
   *  OcctEngineAdapter throws -- OCCT has no TechDraw concept at all, the
   *  same real "not supported on this engine" condition saveDocument() and
   *  openDocument() already established. Gate the UI on getEngineMode(). */
  exportDrawing(doc: ModelDoc, opts?: DrawingOptions): Uint8Array;
}
