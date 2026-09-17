// packages/kernel/src/brep-rs-engine-adapter.ts
//
// A third EngineAdapter, backed by the brep-rs wasm kernel (SPEC-brep-kernel-rs).
// A thin forward to the wasm exports -- no OCCT/topo-resolve logic is copied
// here; naming/measurement answers come back over the same JSON contracts the
// parity gate already pins (docs/specs/SPEC-brep-engine-adapter.md).
//
// Shape handles are plain objects THIS adapter owns: `{ doc, feature }` for a
// solid, `{ doc, feature, index }` for a face or edge -- `doc` being the exact
// ModelDoc JSON string the build ran on. Every method just passes that doc
// string back into the wasm export, where a single-entry thread_local cache
// (wasm.rs's LAST_DOC/LAST_HIST) keeps repeated calls from rebuilding.
//
// `THREE` is constructor-injected rather than statically imported, matching
// OcctEngineAdapter's discipline (three stays a peer dependency this package
// never hard-imports at runtime).

import type { ModelDoc } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type * as THREE_NS from 'three';
import type { FaceRange } from './occt-three.js';
import { getKernelBaseUrl } from './config.js';
import type { DrawingOptions, EngineAdapter, EngineBuildResult, EngineMesh } from './engine-adapter.js';

/** Which import strategy actually worked, set once on the first successful
 *  load. Same two-strategy fallback and same purely-diagnostic role as
 *  OcctEngineAdapter's copy (see that file's own comment) -- duplicated here
 *  rather than shared, the same discipline occt-three.ts/topo-resolve.ts
 *  already apply to their duplicated walkers. */
let kernelImportStrategy: 'webpackIgnore' | 'new-function' | null = null;

async function dynamicImportKernel(url: string): Promise<any> {
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

/** The one wasm module, shared by every BrepRsEngineAdapter instance -- same
 *  module-level-once discipline OcctEngineAdapter's kernelImportStrategy and
 *  BrepViewportThree.tsx's enginePromise both follow (two viewports in one
 *  session must not fetch the wasm twice). */
let wasmPromise: Promise<any> | null = null;

async function loadWasm(): Promise<any> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const base = getKernelBaseUrl();
      const mod = await dynamicImportKernel(`${base}/brep-rs/brep_rs.js`);
      await mod.default(`${base}/brep-rs/brep_rs_bg.wasm`);
      return mod;
    })();
  }
  return wasmPromise;
}

/** One built solid: the doc JSON it came from and the feature id it built. */
interface BrepShape {
  doc: string;
  feature: string;
}

/** A face or edge of a built solid, by position in faces()/edges() order --
 *  the SAME index the wasm exports (face_size/edge_length/name_face) take. */
interface BrepPart {
  doc: string;
  feature: string;
  index: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class BrepRsEngineAdapter implements EngineAdapter {
  private wasm: any = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly THREE: typeof THREE_NS) {}

  async load(): Promise<void> {
    if (this.wasm) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        this.wasm = await loadWasm();
      })();
    }
    return this.loadPromise;
  }

  /** Test-only seam: packages/kernel/test/brep-rs-engine-adapter.test.mjs
   *  loads packages/brep-rs/pkg via `initSync` in node (no fetch there), then
   *  hands the already-initialised module in. Not part of EngineAdapter. */
  loadFromBytes(wasmMod: any): void {
    // initSync has already run against the pkg module in the test process;
    // hand the namespace in and mark load() complete so requireWasm() passes.
    this.wasm = wasmMod;
    this.loadPromise = Promise.resolve();
  }

  private requireWasm(): any {
    if (!this.wasm) throw new Error('BrepRsEngineAdapter: load() has not completed');
    return this.wasm;
  }

  build(doc: ModelDoc): EngineBuildResult {
    const wasm = this.requireWasm();
    const docJson = JSON.stringify(doc);
    const out = JSON.parse(wasm.build_doc_json(docJson)) as {
      built: string[];
      refusals: Record<string, string>;
    };
    const shapes = new Map<string, unknown>();
    for (const id of out.built) {
      shapes.set(id, { doc: docJson, feature: id });
    }
    const refusals = new Map<string, string>();
    for (const [id, reason] of Object.entries(out.refusals ?? {})) {
      refusals.set(id, typeof reason === 'string' ? reason : JSON.stringify(reason));
    }
    return { shapes, refusals };
  }

  mesh(shape: unknown, opts?: { deflection?: number }): EngineMesh | null {
    const wasm = this.requireWasm();
    const part = shape as BrepPart;
    if (!part || typeof part.doc !== 'string') return null;
    const deflection = opts?.deflection ?? 0.05;
    const raw = wasm.mesh_feature(part.doc, part.feature, deflection);
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!m || typeof m.error === 'string') return null;
    const positions = new Float32Array(m.positions as number[]);
    const indices = m.indices as number[];
    if (!indices || indices.length === 0) return null;
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices as any);
    geometry.computeVertexNormals();
    const faces: FaceRange[] = [];
    for (let i = 0; i < (m.faces as Array<{ index: number; start: number; count: number }>).length; i++) {
      const f = (m.faces as Array<{ index: number; start: number; count: number }>)[i];
      faces.push({ index: i, start: f.start, count: f.count });
      geometry.addGroup(f.start, f.count, 0);
    }
    return { geometry, faces };
  }

  edges(shape: unknown): Array<{ edge: unknown; geometry: THREE_NS.BufferGeometry }> {
    const wasm = this.requireWasm();
    const part = shape as BrepPart;
    if (!part || typeof part.doc !== 'string') return [];
    const raw = wasm.mesh_feature(part.doc, part.feature, 0.05);
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!m || typeof m.error === 'string') return [];
    const out: Array<{ edge: unknown; geometry: THREE_NS.BufferGeometry }> = [];
    // One BufferGeometry of line segments per polyline -- mesh_feature's
    // `edges` field is one flat [x,y,z,...] polyline per topological edge,
    // in the SAME edges() order face/edge indices refer to.
    const edges = (m.edges ?? []) as number[][];
    for (let i = 0; i < edges.length; i++) {
      const flat = edges[i];
      if (!flat || flat.length < 6) continue;
      // flat is a polyline: consecutive points, so line segments pair
      // point k with point k+1.
      const segs: number[] = [];
      for (let k = 0; k + 5 < flat.length; k += 3) {
        segs.push(flat[k], flat[k + 1], flat[k + 2], flat[k + 3], flat[k + 4], flat[k + 5]);
      }
      if (segs.length === 0) continue;
      const geometry = new this.THREE.BufferGeometry();
      geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(new Float32Array(segs), 3));
      out.push({ edge: { doc: part.doc, feature: part.feature, index: i }, geometry });
    }
    return out;
  }

  faceAt(shape: unknown, index: number): unknown | null {
    const wasm = this.requireWasm();
    const part = shape as BrepPart;
    if (!part || typeof part.doc !== 'string') return null;
    const raw = wasm.mesh_feature(part.doc, part.feature, 0.05);
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!m || typeof m.error === 'string') return null;
    const faces = (m.faces ?? []) as Array<{ index: number; start: number; count: number }>;
    // Same contract as facesOf(): the index counts ALL faces of the shape in
    // mesh order; out of range is a real null, not an error.
    if (index < 0 || index >= faces.length) return null;
    return { doc: part.doc, feature: part.feature, index };
  }

  resolveFace(name: TopoName, build: EngineBuildResult): unknown | null {
    const wasm = this.requireWasm();
    // Rebuild the doc the build came from: the adapter's handles carry the
    // exact doc string, but a TopoName only names a feature -- so rebuild via
    // resolve()'s enrichment to get its faceIndex.
    const docJson = docOf(build);
    if (!docJson) return null;
    const raw = wasm.resolve(docJson, JSON.stringify(name));
    if (raw === 'null') return null;
    let r: any;
    try {
      r = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!r || r.kind !== 'face' || typeof r.faceIndex !== 'number') return null;
    const feature = typeof r.feature === 'string' ? r.feature : (name as any).feature;
    if (!feature) return null;
    return { doc: docJson, feature, index: r.faceIndex };
  }

  resolveEdge(name: TopoName, build: EngineBuildResult): unknown | null {
    const wasm = this.requireWasm();
    const docJson = docOf(build);
    if (!docJson) return null;
    const raw = wasm.resolve(docJson, JSON.stringify(name));
    if (raw === 'null') return null;
    let r: any;
    try {
      r = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!r || r.kind !== 'edge' || typeof r.edgeIndex !== 'number') return null;
    const feature = typeof r.feature === 'string' ? r.feature : (name as any).feature;
    if (!feature) return null;
    return { doc: docJson, feature, index: r.edgeIndex };
  }

  nameFace(build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, face: unknown): TopoName | null {
    const wasm = this.requireWasm();
    const part = face as BrepPart;
    if (!part || typeof part.index !== 'number') return null;
    const raw = wasm.name_face(JSON.stringify(doc), pickedFeature, part.index);
    if (raw === 'null') return null;
    try {
      return JSON.parse(raw) as TopoName;
    } catch {
      return null;
    }
  }

  nameEdge(_build: EngineBuildResult, doc: ModelDoc, pickedFeature: string, edge: unknown): TopoName | null {
    const wasm = this.requireWasm();
    const part = edge as BrepPart;
    if (!part || typeof part.index !== 'number') return null;
    // wasm's name_edge builds the `between` cause from the edge's two adjacent
    // faces and returns "null" when either face has no name cause (a bore wall
    // on a boolean result, for instance) -- a real null, not an error.
    const raw = wasm.name_edge(JSON.stringify(doc), pickedFeature, part.index);
    if (raw === 'null') return null;
    try {
      return JSON.parse(raw) as TopoName;
    } catch {
      return null;
    }
  }

  faceSize(face: unknown): [number, number] | null {
    const wasm = this.requireWasm();
    const part = face as BrepPart;
    if (!part || typeof part.doc !== 'string' || typeof part.index !== 'number') return null;
    const raw = wasm.face_size(part.doc, part.feature, part.index);
    if (raw === 'null') return null;
    try {
      const wh = JSON.parse(raw);
      if (Array.isArray(wh) && wh.length === 2) return [wh[0], wh[1]];
    } catch {
      return null;
    }
    return null;
  }

  edgeLength(edge: unknown): number | null {
    const wasm = this.requireWasm();
    const part = edge as BrepPart;
    if (!part || typeof part.doc !== 'string' || typeof part.index !== 'number') return null;
    const raw = wasm.edge_length(part.doc, part.feature, part.index);
    if (raw === 'null') return null;
    const len = Number(raw);
    return Number.isFinite(len) && len > 0 ? round2(len) : null;
  }

  // .FCStd is a FreeCAD-native format and TechDraw a FreeCAD-only concept --
  // the same real "not supported on this engine" condition
  // OcctEngineAdapter establishes, same message family so callers can treat
  // them alike. Callers should gate on getEngineMode() instead of catching.
  saveDocument(_doc: ModelDoc): Uint8Array {
    throw new Error('not supported on the brep-rs engine: Save (.FCStd) requires the FreeCAD engine');
  }

  openDocument(_bytes: Uint8Array): ModelDoc | null {
    throw new Error('not supported on the brep-rs engine: Open (.FCStd) requires the FreeCAD engine');
  }

  exportDrawing(_doc: ModelDoc, _opts?: DrawingOptions): Uint8Array {
    throw new Error('not supported on the brep-rs engine: Export Drawing requires the FreeCAD engine');
  }
}

/** The exact doc JSON one of this adapter's builds ran on. Handles carry it,
 *  but an EngineBuildResult arriving from a FRESH doc build carries nothing
 *  -- resolveFace/resolveEdge recover it from the build's own shape handle
 *  (the doc string every handle embeds). */
function docOf(build: EngineBuildResult): string | null {
  for (const shape of build.shapes.values()) {
    const p = shape as BrepPart | null;
    if (p && typeof p.doc === 'string') return p.doc;
  }
  return null;
}
