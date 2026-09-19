// The TS side of the sketch seam (SPEC-sketcher2 §5.1): a warm session over
// the wasm exports sketch_open/solve/diagnose/profile/close. This module owns
// the soup rows and the parameter vector; every edit reopens the session and
// re-solves from the previous parameter vector (the warm start), because the
// kernel holds no mutation exports by design -- the session is a function of
// its rows.
//
// Slot layout (packages/brep-rs/src/sketch/params.rs): the built-ins own the
// first 10 slots (origin p=2, X axis line=4, Y axis line=4, all FIXED), then
// user geometry in id order: point 2, line 4, circle 3, arc 7. The TS side
// mirrors that layout to address a point's slots for dragging.

/** One soup geometry row, the same shape ModelDoc stores (model-types.ts). */
export type SessionGeom =
  | { k: 'point'; id: number; p: [number, number]; construction?: boolean }
  | { k: 'line'; id: number; a: [number, number]; b: [number, number]; construction?: boolean }
  | { k: 'circle'; id: number; c: [number, number]; r: number; construction?: boolean }
  | {
      k: 'arc';
      id: number;
      c: [number, number];
      r: number;
      a: [number, number];
      b: [number, number];
      sense: 'ccw' | 'cw';
      construction?: boolean;
    };

/** One soup rule row, the same shape ModelDoc stores. */
export type SessionRule = Record<string, unknown> & { k: string };

/** The diagnosis JSON sketch_diagnose returns. */
export interface Diagnosis {
  rank: number;
  dof: number;
  bucket: 'consistent' | 'globally-infeasible' | 'redundant' | 'conflicting';
  blame: number[];
}

/** One solved profile segment (sketch_profile). Arc sweep is CCW radians. */
export type ProfileSeg =
  | { k: 'line'; a: [number, number]; b: [number, number] }
  | { k: 'arc'; centre: [number, number]; radius: number; start: number; sweep: number };

/** One solved profile loop (sketch_profile): the sketch's outline, or a hole
 *  through it (SPEC-sketcher2 §8.2). */
export type ProfileLoop = { role: 'outer' | 'hole'; segs: ProfileSeg[] };

/** Slots per geometry kind, in layout order, after the 10 built-in slots. */
const KIND_SLOTS: Record<SessionGeom['k'], number> = { point: 2, line: 4, circle: 3, arc: 7 };
const BUILTIN_SLOTS = 10;

/** The slot base of geometry `id` in the parameter vector, or null when no
 *  such geometry exists. Mirrors ParamBlock's push order. */
export function slotBaseOf(geoms: SessionGeom[], id: number): number | null {
  let base = BUILTIN_SLOTS;
  for (const g of geoms) {
    if (g.id === id) return base;
    base += KIND_SLOTS[g.k];
  }
  return null;
}

/** Slots (x, y) of a named point of geometry `id`, for the drag hot path.
 *  Point refs: 'a'/'b' on lines and arcs, 'c' on circles and arcs, 'a' on a
 *  bare point. Unknown combos return null and the caller skips the drag. */
export function pointSlots(
  geoms: SessionGeom[],
  id: number,
  at: 'a' | 'b' | 'c',
): [number, number] | null {
  const base = slotBaseOf(geoms, id);
  if (base === null) return null;
  const g = geoms.find((x) => x.id === id);
  if (!g) return null;
  let off: [number, number] | null = null;
  if (g.k === 'point') off = at === 'a' ? [0, 1] : null;
  else if (g.k === 'line') off = at === 'a' ? [0, 1] : at === 'b' ? [2, 3] : null;
  else if (g.k === 'circle') off = at === 'c' ? [0, 1] : null;
  else if (g.k === 'arc') {
    if (at === 'c') off = [0, 1];
    else if (at === 'a') off = [3, 4];
    else if (at === 'b') off = [5, 6];
  }
  return off ? [base + off[0], base + off[1]] : null;
}

/** The wasm module, loaded once per origin (same discipline as
 *  BrepRsEngineAdapter's wasmPromise: two viewports must not fetch twice).
 *  The runtime-computed import goes through `new Function` because a bundler
 *  that rewrites import() breaks a URL load -- the same escape hatch
 *  brep-rs-engine-adapter.ts's dynamicImportKernel uses. */
let wasmPromise: Promise<any> | null = null;

async function loadWasm(): Promise<any> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const { getKernelBaseUrl } = await import('./config.js');
      const base = getKernelBaseUrl();
      const mod = await new Function('u', 'return import(u)')(`${base}/brep-rs/brep_rs.js`);
      await mod.default(`${base}/brep-rs/brep_rs_bg.wasm`);
      return mod;
    })();
  }
  return wasmPromise;
}

export class SketchSession2D {
  private wasm: any = null;
  private handle = 0;
  private geoms: SessionGeom[] = [];
  private rules: SessionRule[] = [];
  /** The current parameter vector: warm start for the next solve. */
  params: Float64Array = new Float64Array(0);

  /** Test-only seam: the caller has already run initSync in node and hands
   *  the initialised module in (same convention as
   *  BrepRsEngineAdapter.loadFromBytes). */
  loadFromBytes(wasmMod: any): void {
    this.wasm = wasmMod;
  }

  async load(): Promise<void> {
    if (this.wasm) return;
    this.wasm = await loadWasm();
  }

  private requireWasm(): any {
    if (!this.wasm) throw new Error('SketchSession2D.load() must complete before use');
    return this.wasm;
  }

  /** Open (or reopen) the session from rows. Replaces both rows and params;
   *  a fresh open has no warm start. Returns the refusal sentence on a bad
   *  row, or null on success. */
  open(geoms: SessionGeom[], rules: SessionRule[]): string | null {
    const wasm = this.requireWasm();
    const json = JSON.stringify({ geoms, rules });
    const h = wasm.sketch_open(json);
    if (h === 0 || h === 0xffffffff) {
      return wasm.sketch_last_error() ?? 'sketch_open refused for an unknown reason';
    }
    if (this.handle !== 0) wasm.sketch_close(this.handle);
    this.handle = h;
    this.geoms = geoms;
    this.rules = rules;
    // Fresh block: the full vector is built-ins + rows, solved from the row
    // values themselves.
    this.params = new Float64Array(BUILTIN_SLOTS + geoms.reduce((n, g) => n + KIND_SLOTS[g.k], 0));
    let i = BUILTIN_SLOTS;
    for (const g of geoms) {
      const vals =
        g.k === 'point' ? g.p : g.k === 'line' ? [...g.a, ...g.b] : g.k === 'circle' ? [...g.c, g.r] : [...g.c, g.r, ...g.a, ...g.b];
      for (const v of vals) this.params[i++] = v;
    }
    return null;
  }

  /** Solve at the current params (or `params` as a warm start). Returns
   *  false and lastError() when the solve refuses. */
  solve(params?: Float64Array): boolean {
    const wasm = this.requireWasm();
    if (this.handle === 0) throw new Error('SketchSession2D.open() must run first');
    const p = wasm.sketch_solve(this.handle, params ?? new Float64Array(0), new Float64Array(0), 0, 0);
    if (!p) return false;
    this.params = p;
    return true;
  }

  /** Drag: solve with two slots pulled toward (tx, ty). `slotA`/`slotB` come
   *  from pointSlots(). The vector this returns becomes the session's params. */
  drag(slotA: number, slotB: number, tx: number, ty: number): boolean {
    const wasm = this.requireWasm();
    if (this.handle === 0) throw new Error('SketchSession2D.open() must run first');
    const p = wasm.sketch_solve(this.handle, this.params, new Float64Array([slotA, slotB]), tx, ty);
    if (!p) return false;
    this.params = p;
    return true;
  }

  /** Diagnose at the current point: rank, DoF, bucket, blame. */
  diagnose(): Diagnosis | null {
    const wasm = this.requireWasm();
    if (this.handle === 0) return null;
    const text = wasm.sketch_diagnose(this.handle);
    if (!text) return null;
    return JSON.parse(text) as Diagnosis;
  }

  /** The solved profile, or { refusal } when the sketch cannot be trusted.
   *  `loops[0]` is the outline; every later loop is a hole through it. */
  profile(): { loops: ProfileLoop[] } | { refusal: string } {
    const wasm = this.requireWasm();
    if (this.handle === 0) return { refusal: 'no open sketch session' };
    const text = wasm.sketch_profile(this.handle);
    if (!text) {
      return { refusal: this.lastError() ?? 'sketch_profile refused for an unknown reason' };
    }
    return JSON.parse(text) as { loops: ProfileLoop[] } | { refusal: string };
  }

  /** The last wasm-side sentence (open/solve/diagnose failures). */
  lastError(): string | null {
    const wasm = this.requireWasm();
    return wasm.sketch_last_error() ?? null;
  }

  /** Solved geometry readback: the rows the params describe. Rows come back
   *  in id order with the same kind fields `open` took. */
  solvedGeoms(): SessionGeom[] {
    let i = BUILTIN_SLOTS;
    return this.geoms.map((g) => {
      const read = (n: number): [number, number] => [this.params[i++], this.params[i++]];
      switch (g.k) {
        case 'point':
          return { ...g, p: read(0) };
        case 'line':
          return { ...g, a: read(0), b: read(0) };
        case 'circle': {
          const c = read(0);
          return { ...g, c, r: this.params[i++] };
        }
        case 'arc': {
          const c = read(0);
          const r = this.params[i++];
          return { ...g, c, r, a: read(0), b: read(0) };
        }
      }
    });
  }

  close(): void {
    if (this.handle !== 0) {
      this.requireWasm().sketch_close(this.handle);
      this.handle = 0;
    }
  }
}