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
}
