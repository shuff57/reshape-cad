# SPEC engine-port — packages/engine: wiring the FreeCAD kernel in beside replicad

Blueprint only — no code written against this spec yet. Written after reading
in full: `engine/bridge/fc-session.mjs`, `fc-commands.mjs`, `fc-sketch.mjs`;
`packages/kernel/src/occt-api.ts`, `occt-build.ts`, `occt-mesh.ts`,
`occt-three.ts`, `config.ts`; `packages/studio/src/model/BrepViewportThree.tsx`
(the kernel-loading and build/mesh effects); `packages/script/src/model-types.ts`;
`packages/sketch/src/sketch-solve.ts`; `packages/sandbox-dev/vite.config.ts`;
`engine/play/studio.js` and `serve.mjs`. Every claim below is sourced to one
of those files, not assumed.

---

## 0. The one thing to correct before planning starts

The originating brief describes `packages/sketch`'s constraint solver as
"GCS-based." **It is not.** `sketch-solve.ts`'s own header says so directly:
it used to consider `planegcs` (a wasm port of FreeCAD's own GCS) and
**rejected** it — 600 KB LGPL blob, async init clashing with a sync render
path — and replaced it with an in-house least-squares residual solver over a
small vocabulary (`horizontal`, `vertical`, `length`/`equal`, corner pins, and
`distanceX`/`distanceY`/`symmetric`/`angle` per `SPEC-P1d-sketcher.md`).
`fc-sketch.mjs`, by contrast, drives FreeCAD's **real** in-kernel Sketcher GCS
(`sk.solve()`, DoF, `Coincident`/`Radius`/`Angle`/`Symmetric`/etc.). These are
two independently-built, non-interoperating solvers with different
vocabularies. §4 below treats this as the top risk, not a footnote.

---

## 1. Interface comparison

### 1.1 Shape of the two APIs

| | `engine/bridge` (FreeCAD) | `packages/kernel` (replicad/OCCT) |
|---|---|---|
| Execution model | **Stateful.** `createFcSession(Module)` opens one persistent FreeCAD document living in wasm memory. Every command (`session.pad(...)`, `session.fillet(...)`) mutates that SAME document incrementally. | **Stateless.** `buildDoc(oc, doc: ModelDoc, arc)` takes the WHOLE `ModelDoc` feature array and rebuilds every shape from scratch, every call. No document persists inside the kernel between calls — see `BrepViewportThree.tsx`'s build effect, which calls `kernel.buildDoc(...)` fresh every time `doc` changes (line ~2146). |
| Command shape | JS functions that emit a **Python source string**, run it via `Module.ccall('freecad_run_python', ...)`, and read results back through a JSON sentinel file (`/tmp/reshape_out.json`, via `Module.FS`). Async in spirit (real work happens in wasm) but the JS call itself is synchronous. | Direct calls into embind-bound OpenCascade C++ classes (`new oc.BRepPrimAPI_MakeBox(...)`, etc.) — synchronous, no serialization layer. |
| Feature tree | A **real object graph** FreeCAD itself owns: `PartDesign::Body` with a `Tip` pointer, `PartDesign::Pad`/`Fillet`/etc. as named `DocumentObject`s chained via `BaseFeature`. Sub-element references (`fl.Base = (base, ['Edge3'])`) are FreeCAD's own topological-naming mechanism. | A flat `Feature[]` array the JS side owns (`ModelDoc.features`). No object graph in the kernel; face/edge persistence across rebuilds is reconstructed by `packages/kernel/src/topo-name.ts` + `topo-resolve.ts`, a **hand-built** naming layer that exists precisely because OCCT's raw `TopoDS_Shape` has none of its own. |
| Mesh output | `session.mesh()` → `{positions:number[], indices:number[], volume}` (one undifferentiated blob). `session.meshFaces()` → `{faces:[{id,positions,indices}], edges:[{id,points}], volume}` — per-face/per-edge, tagged with FreeCAD's own 0-based sub-element index (`faceId i == "Face{i+1}"`). Plain JSON, not three.js-shaped; something must build a `THREE.BufferGeometry` from it. | `tessellateToThree(THREE, oc, shape, {deflection})` (`occt-three.ts`) returns `{geometry: THREE.BufferGeometry, faces: FaceRange[]}` directly — already indexed, already three.js-native, `FaceRange{index,start,count}` for picking. |
| Errors | Two shapes: a thrown `Error` with a raw Python traceback (rc≠0 path), or — for the "safe" commands (`fillet`, `chamfer`, `pocket`, sweeps) — a `{ok:false, error:string}` status object read back through the same JSON channel (`wrapStatus` in `fc-commands.mjs`), specifically so a recoverable failure never dumps a traceback into the UI. | A single thrown `Error`, caught by the component's own try/catch around `buildDoc()`/`tessellate()` and shown in a "Could not build this model" panel — **except** per-feature refusals (fillet radius too big, draft angle too steep), which do **not** throw: they land in `BuildResult.refusals: Map<featureId,string>` and the feature falls back to its pre-feature shape. This refusal channel has no counterpart in the FreeCAD bridge's per-call status object. |
| Units | Implicit mm (FreeCAD document default); never explicitly typed. | Also implicit, unitless-but-mm-by-convention (no unit field on `ModelDoc`). **Not yet cross-checked against each other — see §4.** |

### 1.2 Is there a natural seam?

Not for free. The mismatch is not cosmetic — it's the execution model. A
naive "make the FreeCAD bridge answer to `buildDoc(oc, doc)`'s signature" is
possible but has a real cost: `buildDoc()`'s whole contract is "rebuild
everything from this doc, from nothing, every time." Applied literally to
FreeCAD's session, that means closing the document and **replaying the
entire feature history through Python on every keystroke** — correctness-
safe, but a per-command Python round trip repeated N times where N grows
with the model. The alternative — diff the incoming `ModelDoc` against what
the live FreeCAD session has already built, and emit only the new commands —
is real, unwritten logic; nothing in this repo does that today. §5 picks the
replay approach for v1 explicitly, with the diff version named as a
follow-up, not a blocker.

The feature-tree model is also genuinely different, not just differently
coded: FreeCAD's PartDesign body is a **linear** history (each feature's
`BaseFeature` is exactly the previous one), while `ModelDoc`/`occt-build.ts`
allows a `combine` feature to reference arbitrary earlier features and does
not enforce single-body linearity. Not every `ModelDoc` shape has an obvious
PartDesign equivalent — see §4.

---

## 2. What `packages/engine` should contain

`packages/engine/` exists as an npm workspace member today with **zero
files**. Sibling packages' naming: `@shuff57/reshape-kernel`,
`@shuff57/reshape-script`, `@shuff57/reshape-sketch`. This one is
**`@shuff57/reshape-engine`**.

### 2.1 File moves

| Source | Destination | Change |
|---|---|---|
| `engine/bridge/fc-session.mjs` | `packages/engine/src/fc-session.mjs` | **Split, not verbatim.** `createFcSession()` (the portable half) moves as-is. `loadNodeKernel()` (the bottom third: `node:fs`, `node:child_process`, `node:module`) must NOT ship in the browser bundle — move it to `packages/engine/src/fc-session-node.mjs`, imported only by test/Node tooling, never by the browser entry point. |
| `engine/bridge/fc-commands.mjs` | `packages/engine/src/fc-commands.mjs` | Verbatim. Zero external deps today (pure string emitters + session wrappers) — confirm that stays true after the move (`grep -n "^import" packages/engine/src/fc-commands.mjs` should show nothing but sibling `.mjs` files, if anything). |
| `engine/bridge/fc-sketch.mjs` | `packages/engine/src/fc-sketch.mjs` | Verbatim, same as above. |
| n/a | `packages/engine/src/config.ts` | **New**, mirroring `packages/kernel/src/config.ts` exactly: `getEngineBaseUrl()`/`setEngineBaseUrl()`, default `'/reshape/engine'`. |
| n/a | `packages/engine/src/load-browser.mjs` | **New.** Wraps `engine/play/studio.js`'s global-`Module` bootstrap (see §2.2) into one clean `async function loadFreeCadEngine(): Promise<Module>`. |
| The ~18 `*-test.mjs` files in `engine/bridge/` | Stay in `engine/bridge/` for now, OR move to `packages/engine/test/` if the package gets a `test` script (sibling packages that have one — `reshape-script`, `reshape-sketch` — use `node --test "test/*.test.mjs"`). **Not required for the port to work**; call this out as a follow-up so it isn't silently dropped. |

`package.json` (model on `packages/kernel/package.json`):

```json
{
  "name": "@shuff57/reshape-engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./fc-session": "./dist/fc-session.js",
    "./fc-commands": "./dist/fc-commands.js",
    "./fc-sketch": "./dist/fc-sketch.js",
    "./config": "./dist/config.js",
    "./load-browser": "./dist/load-browser.js"
  },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {}
}
```
No dependency on `@shuff57/reshape-script` or `-sketch` yet — the bridge
files know nothing about `ModelDoc`. That dependency, if it ever exists,
belongs to whatever writes the `FreeCadEngineAdapter` (§3), not to the bridge
itself. Keep the bridge dependency-free, matching how it is today.

### 2.2 Serving the kernel artifact

**Two different problems, not one**, because the FreeCAD kernel's own
loading protocol is not the replicad one:

- Replicad: `dynamicImportKernel('replicad_single.js')` is a real ES module
  `import()`; its default export is an async Emscripten factory called with
  no special config. `packages/kernel/src/config.ts` already documents that
  this wasm (~23 MB) is **not vendored** — it's served externally by
  whichever app hosts it, and `packages/sandbox-dev/vite.config.ts`'s
  `kernelStaticServer()` plugin proxies it from a **sibling shCode
  checkout** (`RESHAPE_KERNEL_DIR`, default
  `../../../shCode/public/reshape/kernel`) at URL prefix `/reshape/kernel/`.

- FreeCAD: `engine/play/studio.js` does **not** use ES module `import()` for
  the kernel at all. It uses classic `<script>` tag injection
  (`loadScript('/freecad-data.js')`, then `loadScript(base + 'FreeCADCmd.js')`),
  sets a **global** `window.Module` config object first (with `preRun`,
  `print`, `printErr`, `noInitialRun`), then calls the **global**
  `createFreeCAD(window.Module)` factory and `mod.callMain([...])` with a
  placeholder arg. This is materially more finicky than replicad's loader —
  global-variable convention, explicit `callMain`, environment variables set
  in `preRun` (`FREECAD_WASM_KERNEL`, `FREECAD_HOME`, `PYTHONHOME`,
  `PYTHONPATH`). `packages/engine/src/load-browser.mjs` (§2.1) exists
  specifically to hide this behind one async function so the rest of the app
  never has to know.

- **The artifact set is different too, and lives in THIS repo, not an
  external checkout**: `engine/play/freecad-data.js` (84 KB) +
  `engine/play/freecad-data.data` (**5.95 MB**, measured — the Emscripten
  data pack: Python stdlib + `Mod`/`Ext` trees, PartDesign included) +
  `engine/build/g5-artifacts/FreeCADCmd.js` + `FreeCADCmd.wasm` (**52 MB
  combined**, measured — the actual compiled kernel, real browser build,
  `NODERAWFS=OFF`). Total ≈ **58 MB**, not the ~53 MB the originating brief
  estimated — correct that number going forward; the wasm binary, not the
  data pack, is the dominant cost. `engine/build/g3-artifacts` is a
  **different, Node-only build** (`NODERAWFS=ON`) that `engine/play/serve.mjs`'s
  own comment says is "known to fail in a browser" — do not serve that one
  to `sandbox-dev`.
- Add a second plugin to `packages/sandbox-dev/vite.config.ts`,
  `engineStaticServer()`, mirroring `kernelStaticServer()` but pointing at
  `engine/build/g5-artifacts/` + `engine/play/freecad-data.*` — both **inside
  this repo**, so no `RESHAPE_ENGINE_DIR` env var is needed by default (add
  one anyway for symmetry/override, matching `RESHAPE_KERNEL_DIR`'s pattern).
  Serve at `/reshape/engine/`.

---

## 3. How `BrepViewportThree.tsx` should switch engines

### 3.1 The common interface

Define once, in a shared location both adapters can import without either
depending on the other's package — `packages/kernel/src/engine-adapter.ts`
(the existing "kernel surface" package is the natural home; `packages/engine`
should not depend on `packages/kernel` or vice versa, so the interface lives
in whichever is imported by both `BrepViewportThree.tsx` and the two adapter
implementations — `packages/kernel` already is, so put it there):

```ts
// packages/kernel/src/engine-adapter.ts
export interface EngineAdapter {
  load(): Promise<void>;
  build(doc: ModelDoc): { shapes: Map<string, unknown>; refusals?: Map<string,string> };
  mesh(shape: unknown, opts?: { deflection?: number }): { geometry: THREE.BufferGeometry; faces: FaceRange[] } | null;
  resolveFace(name: TopoName, built: unknown): unknown | null;   // picking
  resolveEdge(name: TopoName, built: unknown): unknown | null;
  nameFace(built: unknown, doc: ModelDoc, featureId: string, face: unknown): TopoName | null;
  nameEdge(built: unknown, doc: ModelDoc, featureId: string, edge: unknown): TopoName | null;
}
```
Exact method list should be pinned by grepping `BrepViewportThree.tsx` for
every direct call into `kernel.oc`, `facesOf`, `resolveName`,
`resolveNameAsUsedBy`, `nameFaceOnCurrentShape`, `nameEdgeOnCurrentShape`,
`tessellateToThree`, `edgesToThree` (all present per the earlier grep) —
each becomes an adapter method. Treat the list above as a starting draft,
not final.

### 3.2 Two implementations

- **`OcctEngineAdapter`** (`packages/kernel/src/occt-engine-adapter.ts`) —
  a **behavior-preserving wrapper** around the existing `buildDoc`,
  `tessellateToThree`, `resolveName`, `resolveNameAsUsedBy`,
  `nameFaceOnCurrentShape`, `nameEdgeOnCurrentShape`. No new logic; this
  file should be small and boring.
- **`FreeCadEngineAdapter`** (`packages/engine/src/adapter.ts`, or
  `packages/kernel/src/freecad-engine-adapter.ts` if `packages/kernel` stays
  the one place adapters live — pick one and keep both adapters in the same
  package so `BrepViewportThree.tsx` has one import site to branch on) —
  wraps a `createFcSession`/`attachCommands` session, replays `ModelDoc`
  into it (see §5 step 6), and converts `meshFaces()`'s JSON into a
  `THREE.BufferGeometry` matching `occt-three.ts`'s `BrepThreeMesh` shape.

### 3.3 Where the flag lives

Add to `packages/kernel/src/config.ts`, beside `getKernelBaseUrl`:

```ts
let engineMode: 'occt' | 'freecad' = 'occt';
export function getEngineMode() { return engineMode; }
export function setEngineMode(m: 'occt' | 'freecad') { engineMode = m; }
```
Default `'occt'` — this must not change default behavior. `sandbox-dev`
reads a `VITE_RESHAPE_ENGINE` env var at startup and calls `setEngineMode()`
once, the same pattern `RESHAPE_KERNEL_DIR` already uses for the URL. A
future UI toggle just calls `setEngineMode()` directly.

`BrepViewportThree.tsx`'s module-level `loadKernel()` becomes `loadEngine()`,
branching on `getEngineMode()` and returning an `EngineAdapter`. Every call
site in the ~2400-line component that reaches directly into `kernel.oc`,
`facesOf(kernel.oc, ...)`, `resolveName(kernel.oc, ...)`, etc. must move
behind the adapter's own methods — this is the invasive part, and it is
listed last in the build sequence (§5) on purpose: it should be a **pure
seam refactor**, done only after both adapters are independently proven, so
any regression is attributable to the refactor and nothing else.

---

## 4. Risk list

1. **Stateful vs. stateless rebuild (the central risk).** Covered in §1.2.
   v1 answer: replay the whole `ModelDoc` through fresh FreeCAD commands on
   every build call, accept the cost, and name the incremental-diff version
   as an explicit, separate follow-up (not silently deferred — write it
   down where the next person will see it, per §5 step 10).

2. **Two non-interoperating sketch systems — DECIDED: `ModelDoc` is the
   single source of truth (option (b)).** `engine/play/studio.js`'s own UI
   bypasses `ModelDoc` entirely today (its own `state.sketch`/`state.tip`,
   talking to `fc-sketch.mjs` directly) — that shortcut is **not** carried
   into the port. Real translation work from `packages/sketch`'s constraint
   vocabulary into FreeCAD Sketcher commands is now in scope. Full design in
   §4.5.

3. **Topological naming is reimplemented, not shared.**
   `packages/kernel/src/topo-name.ts`/`topo-resolve.ts` exists specifically
   because raw OCCT `TopoDS_Shape` carries no persistent identity — it's a
   hand-built substitute for something FreeCAD's own object graph
   (`Base[0].Shape` sub-element links) already does natively and
   differently. Do not attempt to reuse `resolveName()`/`.IsSame()`-based
   matching against FreeCAD shapes; the `FreeCadEngineAdapter`'s naming
   methods must resolve through FreeCAD's own `Face{n}`/`Edge{n}` sub-element
   names (already what `meshFaces()` tags), a second, separate
   implementation.

4. **Crash-safety guards are kernel-specific, not portable.**
   `fc-commands.mjs`'s fillet/chamfer emitters cap radius **before**
   recompute because an oversized value corrupts the wasm heap *during* the
   failed recompute, not after — no exception to catch, no after-the-fact
   fix possible (see that file's own comment on `fillet()`). This has no
   counterpart in the OCCT path, where `BRepFilletAPI` throws cleanly and
   `roundedEdges()` catches it in a plain try/catch. The `FreeCadEngineAdapter`
   needs its own defensive logic; none of the OCCT side's error handling
   transfers.

5. **Unit agreement is unverified.** Both engines are implicit-mm, but
   nothing in either codebase asserts they agree numerically for the same
   `ModelDoc` input — worth a measured check (build the same fixture on both,
   compare volume/bbox, the same bar `occt-api.ts`'s own header sets for
   itself) before code depends on the assumption.

6. **PartDesign body linearity vs. `ModelDoc`'s flatter graph.** FreeCAD's
   `Body.Tip`/`BaseFeature` chain is strictly linear; `ModelDoc`'s `combine`
   feature can reference arbitrary earlier features, and it's not yet
   confirmed whether `ModelDoc` supports multiple independent bodies in one
   document the way `topLevel()` picking several root shapes suggests it
   might. Flag as an open question for whoever writes the replay logic in
   §5 step 6, not something this blueprint resolves.

7. **Payload size.** ≈58 MB (FreeCAD) vs. ≈23 MB (replicad, per
   `config.ts`'s own comment) — about 2.5x. Fine behind an opt-in flag
   defaulting to `'occt'`; worth flagging before anyone considers flipping
   the default.

8. **DoF mismatch between the two solvers (new, from §4.5's design).**
   `packages/sketch`'s least-squares solver has no DoF concept at all — it
   reports `overConstrained: boolean` from a residual threshold, never "2
   degrees of freedom remain." FreeCAD's GCS is stricter and always knows
   exactly how many DoF are left. A `ModelDoc` sketch the JS solver is happy
   with can come back from `sk.solve()` under-constrained (real remaining
   DoF the translated constraint list doesn't pin) — §4.5's answer is to
   close that gap with position pins computed from the JS solver's own
   already-solved coordinates, not to rely on FreeCAD's solver finding the
   same solution branch unassisted.

---

## 4.5 Sketch constraint translation (`ModelDoc` → FreeCAD Sketcher)

### 4.5.1 Geometry must come from `outlineOf()`, not raw `points`

`SketchFeature.points` is the **design corner** list — what the student
placed. It is not the geometry to hand FreeCAD: once any `rounds`/`chamfers`
entry is non-empty, `outlineOf()` (`packages/sketch/src/sketch-arc.ts`,
already exists, do not reimplement) is what turns design corners into the
actual trim points and arc bulges that form the outline — a rounded corner
is one design point but becomes two trim points plus an arc segment in the
built geometry. The translator must call `outlineOf()` first and emit
`fc-sketch.mjs`'s `addLine`/`addArc` per resulting segment (`addCircle` for
`shape: 'circle'`), **not** one `addLine` per raw design corner.

This means **design corner index ≠ FreeCAD geoId** the moment any rounding
exists (and even without rounding, geoIds are assigned in emission order,
which the translator controls but must track explicitly rather than assume
identity). The translator must build and keep a map as it emits geometry:

```ts
// corner n (a design corner index into SketchFeature.points) -> where to
// find it in the FreeCAD sketch, for constraints that name corners.
type CornerRef = { geoId: number; pointPos: 1 | 2 | 3 }; // 1=start,2=end,3=center
const cornerRefs: Map<number, CornerRef> = new Map();
```
Plain, unrounded corner `n` is the **start point** of the line segment
emitted for edge `n` (`edgeCorners(n, count)` — the same convention
`sketch-solve.ts` already uses: edge `n` runs corner `n` → corner `n+1`), so
`cornerRefs.set(n, { geoId: <edge n's geoId>, pointPos: 1 })` as each edge is
emitted. A rounded corner has no single line endpoint to point at anymore —
its `CornerRef` must resolve to the **arc's own endpoint that sits where the
trim point closest to the original corner landed** (`outlineOf()`'s return
value carries enough to identify this — read its actual return shape when
implementing, don't guess the field names here).

### 4.5.2 Constraint mapping table

| `ModelDoc` (`Constraint` in `sketch-solve.ts`) | FreeCAD Sketcher (`fc-sketch.mjs`) | Fit |
|---|---|---|
| `{ kind: 'horizontal', edge }` | `session.constrainHorizontal(sk, g)` | **Clean.** `g` = the geoId the edge was emitted as. |
| `{ kind: 'vertical', edge }` | `session.constrainVertical(sk, g)` | **Clean.** |
| `{ kind: 'length', edge, value }` | `session.constrainDistance(sk, g, 1, g, 2, value)` — same geoId, start-to-end point-to-point distance | **Clean, but not literal.** FreeCAD has no dedicated "Length" emitter; a `Distance` constraint between a line's own two endpoints is the length constraint (verified in `fc-sketch.mjs`'s own `distance()` emitter, which takes an arbitrary `g1,p1,g2,p2` pair). |
| `{ kind: 'equal', edge, other }` | `session.constrainEqual(sk, g1, g2)` | **Clean.** |
| `{ kind: 'parallel', edge, other }` | `session.constrainParallel(sk, g1, g2)` | **Clean.** |
| `{ kind: 'perpendicular', edge, other }` | `session.constrainPerpendicular(sk, g1, g2)` | **Clean.** |
| `{ kind: 'distanceX', a, b, value }` | `session.constrainDistanceX(sk, g1, p1, g2, p2, value)` | **Needs resolution, not clean.** `a`/`b` are design **corner** indices; resolve each through `cornerRefs` (§4.5.1) to get `(geoId, pointPos)`. Once resolved, the constraint call itself is 1:1. |
| `{ kind: 'distanceY', a, b, value }` | `session.constrainDistanceY(sk, g1, p1, g2, p2, value)` | Same as `distanceX`. |
| `{ kind: 'symmetric', a, b, center }` | `session.constrainSymmetric(sk, g1,p1, g2,p2, g3,p3)` | Same corner-resolution requirement, three corners not two. FreeCAD's Symmetric (point-point-about-point) matches `sketch-solve.ts`'s own stated semantics exactly (symmetry about a **point**, not a line) — confirmed compatible, not just similarly named. |
| `{ kind: 'angle', edge, other, degrees }` | `session.constrainAngle(sk, g1, g2, degrees)` | **Approximate — needs a measured check, not assumed.** `fc-sketch.mjs`'s emitter already converts degrees→radians correctly (measured against the wasm kernel per that file's own comment). But `sketch-solve.ts`'s residual is a **signed turn via `atan2(cross,dot)`, wrapped into `(-PI,PI]`**, and FreeCAD's `Angle` constraint between two line geoIds has its own sign/reference convention that has **not** been cross-checked against that wrapping. Build sequence step must verify a translated angle constraint reproduces the same corner positions the JS solver computed, for at least one non-trivial (non-90°) case, before trusting this row. |
| `{ kind: 'lock', corner }` | **No direct equivalent — synthesize.** | `lock` in `ModelDoc` means "this corner does not move," a solver-level pin, not a named FreeCAD constraint. Synthesize with two constraints against the sketch origin: `constrainDistanceX(sk, g, p, -1, 1, x)` + `constrainDistanceY(sk, g, p, -1, 1, y)`, where `(x,y)` is the corner's **already-solved** coordinate from `ModelDoc`'s own `points` (`packages/sketch` already solved this — reuse its answer, don't ask FreeCAD to re-derive it). `-1, 1` is `fc-sketch.mjs`'s documented convention for the sketch root point (`pinOrigin`'s own implementation does exactly this pattern for a single axis-free case; generalize it to both axes here). |

`parallel`/`perpendicular`/`equal` in `sketch-solve.ts` are listed above;
note `sketch-solve.ts` also still carries them as legacy relaxation-era
kinds per its own file header — no change needed, they map the same as any
other binary constraint.

### 4.5.3 DoF closure: pin what's left, don't trust FreeCAD to find the same basin

Translating every explicit constraint 1:1 does **not** guarantee FreeCAD's
GCS lands on the same shape `packages/sketch`'s least-squares solver already
computed — the two solvers don't share an algorithm, and an under-constrained
translated sketch could solve into a different (also technically valid)
configuration. v1 answer, in order:

1. Emit geometry (§4.5.1) and every explicit constraint (§4.5.2).
2. Call `session.sketchState(sk)` and read `dof`/`fully`/`conflicting`/
   `redundant`/`malformed`.
3. If `conflicting` or `malformed` is non-empty: this is a **real
   translation bug or a genuinely unrepresentable constraint set**, not
   something to paper over — refuse the sketch with a clear error naming
   which FreeCAD constraint indices conflicted, per §4.5.4's refusal policy.
4. If `dof > 0` (under-constrained): pin every remaining free corner to its
   already-known-correct `(x, y)` from `ModelDoc`'s solved `points`, via the
   same `DistanceX`+`DistanceY`-against-origin pattern used for `lock`
   (§4.5.2's last row) — this is a closer step, not a new design, reusing
   the `lock` synthesis. Re-run `sketchState()` after; `dof` must now be 0.
   If it is not, that is a translation bug (some corner's pin didn't take)
   and must throw, not silently ship an under-constrained sketch.
5. `redundant` alone (no `conflicting`/`malformed`) is expected and fine —
   the DoF-closure pins from step 4 are often redundant with constraints
   translated in step 1 by construction (both agree on the same point), and
   FreeCAD's own `Redundant` classification exists for exactly this
   non-error case. Do not treat it as a failure.

### 4.5.4 Refusal policy for unrepresentable constraints

Per-constraint, not whole-sketch, and matching the existing codebase's own
voice (`model-types.ts`'s `whyCannotRound()` states refusals as plain facts,
not stack traces — follow that precedent): if a specific `ModelDoc`
constraint cannot be translated (none are known to be fully unrepresentable
today per the table above — `angle`'s convention is unverified, not known-
broken), the `FreeCadEngineAdapter` throws a clear, named error identifying
the constraint kind and the sketch feature id, and the **whole sketch
build** refuses (matching step 7's existing "throw a clear message" pattern
for unsupported `Feature.kind`s) rather than silently dropping one
constraint and shipping a shape the student didn't ask for.

---

## 5. Build sequence

Each step names its own self-check. Assume no memory of this research —
every path is absolute or repo-relative and exact.

1. **Scaffold the package.** Create `packages/engine/package.json` (§2.1
   shape) and a `tsconfig.json` matching `packages/kernel/tsconfig.json`.
   *Self-check:* `npm run build --workspace=@shuff57/reshape-engine` runs
   (even against a placeholder `src/index.ts` that exports nothing) with no
   npm workspace resolution error.

2. **Move the bridge files**, splitting `fc-session.mjs` as described in
   §2.1 (§2.1's row for `fc-session.mjs`). *Self-check:*
   `grep -rn "node:fs\|node:child_process\|node:module" packages/engine/src/`
   returns matches **only** inside `fc-session-node.mjs` — nowhere else.

3. **Regression-baseline the existing playground before touching it.** Run
   `node engine/play/serve.mjs` and open `http://localhost:8787/studio.html`
   in a browser; confirm New Body → Rect Sketch → Pad → Fillet still works
   exactly as before. Do this **before** any of steps 4–9 touch
   `engine/play/*`, so any later breakage is attributable to this port, not
   pre-existing.

4. **Add `packages/engine/src/config.ts`** (§2.1) and
   **`packages/engine/src/load-browser.mjs`** (§2.2), wrapping the
   global-`Module` + `loadScript` + `callMain` sequence from
   `engine/play/studio.js` lines ~137–168 into one
   `async function loadFreeCadEngine(baseUrl): Promise<Module>`.
   *Self-check:* a small standalone HTML page (throwaway, in a scratch
   location) that only calls `loadFreeCadEngine()` and then
   `createFcSession(mod).newDocument('t')` succeeds with no console error,
   proving the wrapper is behaviorally equivalent to studio.js's inline
   version.

5. **Add `engineStaticServer()` to `packages/sandbox-dev/vite.config.ts`**
   (§2.2), serving `engine/build/g5-artifacts/` + `engine/play/freecad-data.*`
   at `/reshape/engine/`. *Self-check:* with `sandbox-dev`'s dev server
   running, `curl -sI http://localhost:5173/reshape/engine/FreeCADCmd.wasm`
   returns `200` with `Content-Type: application/wasm`, and
   `curl -sI http://localhost:5173/reshape/engine/freecad-data.data` returns
   `200`.

6. **Define `EngineAdapter`** in `packages/kernel/src/engine-adapter.ts`
   (§3.1), then write **`OcctEngineAdapter`** as a pure wrapper — no new
   behavior. *Self-check:* `sandbox-dev`, default engine mode, renders every
   model it rendered before this step with no visual or console difference
   (spot-check 2–3 existing test docs; if `packages/kernel` has an existing
   volume/bbox regression script — grep for one — run it and confirm the
   same pass count as before this step).

7. **Write `FreeCadEngineAdapter.build()`**, v1 = full replay (§4 risk 1),
   in substeps:
   a. For each incoming `ModelDoc.features`, open a fresh FreeCAD document
      and emit the matching `fc-commands` call for non-sketch feature kinds
      that map cleanly onto PartDesign (`box`, `cylinder`, `sphere`
      primitives; `extrude`→`pad`, `pocket`, `revolve`, `fillet`,
      `chamfer`). For any other `Feature.kind` (`blend`, `draft`, `shell`,
      `mirror`, `pattern`), **throw** a clear "not yet supported on the
      FreeCAD engine: `<kind>`" — these remain genuinely out of scope for
      v1, unlike sketches, which are now in scope.
      *Self-check:* a hand-written `ModelDoc` fixture with one `box` + one
      `fillet`, run through `FreeCadEngineAdapter.build()`, produces a shape
      whose volume (read via the session) matches
      `OcctEngineAdapter.build()`'s volume for the equivalent doc, within a
      stated tolerance — the same "two engines, one number" bar
      `occt-api.ts`'s own header commits to.
   b. Write `packages/engine/src/sketch-translate.ts`, implementing §4.5:
      `translateSketch(sketch: SketchFeature, session): CornerRefMap`
      (or equivalent — pin the exact signature to what `attachSketchCommands`
      actually returns per call, not to this sketch of one) — emits geometry
      via `outlineOf()` (§4.5.1), translates every constraint (§4.5.2),
      closes remaining DoF (§4.5.3), and enforces the refusal policy
      (§4.5.4). For any `SketchFeature` in the incoming `ModelDoc`,
      `build()` calls this before the primitive/feature emission in (a) so
      a `Pad`/`Pocket` targeting that sketch has real FreeCAD geometry to
      reference.
      *Self-check, three parts:* (i) a hand-written unconstrained rectangle
      sketch (4 points, no `constraints`) translates and reaches `dof: 0`
      via §4.5.3's position-pin closure, with `conflicting`/`malformed`
      both empty; (ii) a hand-written sketch using every constraint kind in
      §4.5.2's table at least once (including one `lock` and one non-90°
      `angle`) translates without throwing, reaches `dof: 0`, and — this is
      the real bar — the FreeCAD-solved corner coordinates match
      `packages/sketch`'s own already-solved `points` within a stated
      tolerance (proving the angle convention row's uncertainty resolved
      cleanly, not just that nothing threw); (iii) a `Pad` built from a
      rounded rectangle (non-empty `rounds`) produces the same volume as
      `OcctEngineAdapter` for the equivalent doc, proving §4.5.1's
      `outlineOf()`-based geometry emission (not raw `points`) actually
      wired in correctly.

8. **Write `FreeCadEngineAdapter.mesh()`**, converting `session.meshFaces()`'s
   `{faces:[{id,positions,indices}], edges}` JSON into a
   `THREE.BufferGeometry` + `FaceRange[]` matching `occt-three.ts`'s
   `BrepThreeMesh` exactly. *Self-check:* the triangle count and a manually
   computed bounding box on the converted `THREE.BufferGeometry` match what
   `session.mesh()`'s own `volume` and vertex extents report for the same
   shape.

9. **Wire the flag** (`getEngineMode`/`setEngineMode` in
   `packages/kernel/src/config.ts`, §3.3), default `'occt'`. *Self-check:*
   with no env var and no `setEngineMode()` call, `sandbox-dev`'s behavior is
   unchanged from step 6's baseline.

10. **Refactor `BrepViewportThree.tsx`** to call `loadEngine()` /
    `EngineAdapter` methods instead of `kernel.oc`/`facesOf`/`resolveName`/
    `tessellateToThree` directly (§3.3). Do this **last**, as a pure seam
    refactor with no new behavior. *Self-check, two parts:* (a) with
    `getEngineMode()` still `'occt'`, the full existing interaction surface
    (build, pick face, pick edge, fillet, undo) is smoke-tested against the
    step-6/9 baseline with no behavior change; (b) set
    `VITE_RESHAPE_ENGINE=freecad`, reload, and confirm the box+fillet subset
    from step 7 builds and renders through the same component with no other
    source file touched.

11. **Write down what step 7 refused to build.** Add a short note (a doc, or
    a comment beside `FreeCadEngineAdapter`) listing every `Feature.kind`
    that throws today, so the gap doesn't silently bit-rot as more
    `ModelDoc` features are added elsewhere in the app without a matching
    FreeCAD translation.
