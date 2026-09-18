// packages/kernel/src/occt-engine-adapter.ts
//
// A behavior-preserving EngineAdapter wrapper around the existing OCCT
// pipeline: buildDoc (occt-build.ts), tessellateToThree/edgesToThree
// (occt-three.ts), facesOf/resolveName/nameFaceOnCurrentShape/
// nameEdgeOnCurrentShape (topo-resolve.ts). No new logic -- every method
// below is a direct forward to one of those, same as
// docs/specs/SPEC-engine-port.md §3.2 asks for.
//
// `THREE` is constructor-injected rather than statically imported, matching
// occt-three.ts's own discipline (it takes `THREE: typeof import('three')`
// as a parameter on every call rather than importing the runtime module) --
// three stays a peer dependency this package never hard-imports at runtime.
//
// `build()` returns the REAL occt-build.ts BuildResult (ops/sweeps included,
// not just shapes/refusals) -- it satisfies EngineBuildResult structurally
// (a superset of its required fields), and every other method here casts an
// incoming EngineBuildResult back to BuildResult BECAUSE it always receives
// back the exact object this adapter itself produced. resolveName()/
// nameFaceOnCurrentShape()/nameEdgeOnCurrentShape() all need `ops`/`sweeps`
// to walk operation history -- EngineBuildResult's narrower shape exists so
// BrepViewportThree.tsx and a future FreeCadEngineAdapter never have to know
// those fields exist, not because this adapter can do without them.

import type { ModelDoc } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type * as THREE_NS from 'three';
import { buildDoc, type BuildResult, type Occt } from './occt-build.js';
import { edgesToThree, tessellateToThree } from './occt-three.js';
import {
  facesOf, nameEdgeOnCurrentShape, nameFaceOnCurrentShape, resolveName,
} from './topo-resolve.js';
import { getKernelBaseUrl } from './config.js';
import type { EngineAdapter, EngineBuildResult, EngineMesh } from './engine-adapter.js';

/** Which import strategy actually worked, set once on the first successful
 *  load. Same two-strategy fallback and same purely-diagnostic role as
 *  BrepViewportThree.tsx's own copy (see that file's dynamicImportKernel) --
 *  duplicated here rather than shared, the same discipline
 *  topo-resolve.ts/occt-three.ts already apply to facesOf() (see occt-three.ts's
 *  own comment on why: this is a small, proven walker, and neither layer
 *  should have to import the other's file to get it). */
let kernelImportStrategy: 'webpackIgnore' | 'new-function' | null = null;

const round2 = (n: number) => Math.round(n * 100) / 100;

async function dynamicImportKernel(path: string): Promise<any> {
  const url = `${getKernelBaseUrl()}/${path}`;
  if (kernelImportStrategy === 'new-function') {
    return new Function('u', 'return import(u)')(url);
  }
  try {
    const mod = await import(/* webpackIgnore: true */ url as any);
    kernelImportStrategy = 'webpackIgnore';
    return mod;
  } catch {
    const mod = await new Function('u', 'return import(u)')(url);
    kernelImportStrategy = 'new-function';
    return mod;
  }
}

export class OcctEngineAdapter implements EngineAdapter {
  private oc: Occt | null = null;
  private arc: any = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly THREE: typeof THREE_NS) {}

  async load(): Promise<void> {
    if (this.oc) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const [replicadMod, arcMod] = await Promise.all([
          dynamicImportKernel('replicad_single.js'),
          dynamicImportKernel('sketch-arc.js'),
        ]);
        // replicad_single.js's default export is an emscripten factory --
        // it returns a PROMISE of the initialised module, same as
        // BrepViewportThree.tsx's own loadKernel().
        this.oc = await replicadMod.default();
        this.arc = arcMod;
      })();
    }
    return this.loadPromise;
  }

  private requireOc(): Occt {
    if (!this.oc) throw new Error('OcctEngineAdapter: load() has not completed');
    return this.oc;
  }

  build(doc: ModelDoc): EngineBuildResult {
    return buildDoc(this.requireOc(), doc, this.arc);
  }

  mesh(shape: unknown, opts?: { deflection?: number }): EngineMesh | null {
    return tessellateToThree(this.THREE, this.requireOc(), shape, opts);
  }

  edges(shape: unknown): Array<{ edge: unknown; geometry: THREE_NS.BufferGeometry }> {
    return edgesToThree(this.THREE, this.requireOc(), shape);
  }

  faceAt(shape: unknown, index: number): unknown | null {
    return facesOf(this.requireOc(), shape)[index] ?? null;
  }

  resolveFace(name: TopoName, build: EngineBuildResult): unknown | null {
    return resolveName(this.requireOc(), name, build as unknown as BuildResult);
  }

  resolveEdge(name: TopoName, build: EngineBuildResult): unknown | null {
    // resolveName() is cause-generic (face and edge names alike -- the
    // 'between' cause IS how an edge is named, see topo-name.ts) so this is
    // the same call as resolveFace(); kept as a separate method because the
    // EngineAdapter contract names them separately for the caller's clarity.
    return resolveName(this.requireOc(), name, build as unknown as BuildResult);
  }

  nameFace(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, face: unknown): TopoName | null {
    return nameFaceOnCurrentShape(this.requireOc(), build as unknown as BuildResult, doc, pickedFeature, face);
  }

  nameEdge(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, edge: unknown): TopoName | null {
    return nameEdgeOnCurrentShape(this.requireOc(), build as unknown as BuildResult, doc, pickedFeature, edge);
  }

  // Moved verbatim from BrepViewportThree.tsx's own module-level faceSize()/
  // edgeLength() helpers (found during the step-10 seam refactor -- both
  // reached into kernel.oc directly, the same class of call every other
  // method on this class already wraps). No logic changed; only `oc` now
  // comes from requireOc() instead of a parameter.

  /** Item H (P20): the picked face's own in-plane size, e.g. [40, 40] for a
   *  box's top face -- read off the BUILT geometry (a real bounding box on
   *  this one face, not the doc's own fields), so it stays right after a
   *  Round, Hole or Hollow reshapes the solid those fields still describe.
   *
   *  A planar, axis-aligned face (every primitive's own flat face, and every
   *  flat face a Hollow/Hole/Round leaves alone) has one bbox axis pinned to
   *  (near) zero width -- its own normal. Dropping that axis and reporting
   *  the other two, smallest first for a stable "W x D" reading regardless
   *  of which world axes they happen to be, is exactly "40 x 40". A curved
   *  or non-axis-aligned face has no single degenerate axis to drop; null
   *  there rather than a bbox number nobody asked for and nobody could act
   *  on. */
  faceSize(face: unknown): [number, number] | null {
    const oc = this.requireOc();
    // Defensive, not load-bearing: a size the kernel could not compute (a
    // binding-signature mismatch on some build, a degenerate face) is a
    // missing THIRD word in the pill, never a reason to lose the pick
    // itself.
    try {
      const box = new oc.Bnd_Box();
      oc.BRepBndLib.Add(face, box, true);
      if (box.IsVoid?.()) return null;
      const lo = box.CornerMin();
      const hi = box.CornerMax();
      const extents = [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()];
      const flatAxis = extents.findIndex((e) => e < 0.05);
      if (flatAxis < 0) return null;
      const rest = extents.filter((_, i) => i !== flatAxis).sort((a, b) => a - b);
      return [round2(rest[0]), round2(rest[1])];
    } catch {
      return null;
    }
  }

  /** Item H: a picked edge's own true arc length via
   *  BRepGProp.LinearProperties (a curved edge's length is not its two
   *  endpoints' straight-line distance), so a rounded edge reads correctly
   *  too, not just a straight one. */
  edgeLength(edge: unknown): number | null {
    const oc = this.requireOc();
    try {
      const g = new oc.GProp_GProps();
      // Same (shape, props, ...flags) shape as VolumeProperties/
      // SurfaceProperties elsewhere in this codebase (see occt-build.ts's
      // measureShape) -- this build's binding refuses the 2-argument call
      // outright (measured: "invalid signature ... expects
      // (TopoDS_Shape,GProp_GProps,boolean,boolean)").
      oc.BRepGProp.LinearProperties(edge, g, false, false);
      const len = g.Mass();
      return Number.isFinite(len) && len > 0 ? round2(len) : null;
    } catch {
      return null;
    }
  }

  // .FCStd is a FreeCAD-native format -- OCCT/replicad has no concept of it
  // at all, so there is no partial or degraded answer to give here, only a
  // clear refusal. Prefixed distinctly from FreeCadEngineAdapter's own
  // "not yet supported on the FreeCAD engine: <kind>" refusals (which name a
  }
