# SPEC engine-port — packages/engine: wiring the FreeCAD kernel in beside replicad

**Status (2026-09-11): the build sequence below is DONE and this spec is now
the live status doc for the FreeCAD engine, not just a blueprint** — §5's 11
steps all landed (commits `077e10a` through `91e3539`), plus a real
closure-pin bug found and fixed post-launch (`25f4fda`) and 3 more
`Feature.kind`s built (`3681d5b`). Then, same day, `SPEC-studio-canonical.md`'s
4-phase studio-canonicalization port added: linear/polar `pattern` (`6f2eea0`,
§6.1), a box/cylinder placement bugfix that also widened the circular-pattern
refusal to every primitive kind (`7cd6963`, §6.1a), sketch-derived (Pad)
face/edge naming for `extrude` plus a real sign-bug fix in
`sketch-translate.ts`'s origin-pinning (`ca20089`, §6.2a), and Save/Open
`.FCStd` (`ca882f8`, §6.6) — current through `ca882f8`. §6 "Known gaps" is the
current, maintained account of what still throws/refuses and why — read that
section, not just this header, for what's actually true today. The original
blueprint premise below (§0-§5) is kept as-written for its reasoning, not
edited to sound retroactively finished.

Originally written as a blueprint only — no code written against it yet — after
reading in full: `engine/bridge/fc-session.mjs`, `fc-commands.mjs`,
`fc-sketch.mjs`; `packages/kernel/src/occt-api.ts`, `occt-build.ts`,
`occt-mesh.ts`, `occt-three.ts`, `config.ts`;
`packages/studio/src/model/BrepViewportThree.tsx` (the kernel-loading and
build/mesh effects); `packages/script/src/model-types.ts`;
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
   implementation. **Update (SPEC-studio-canonical.md phase 3):** primitive
   naming closed first (§6.2); sketch-derived (Pad wall/cap) naming closed
   in a further pass, §6.2a below — a real ordinal Face-position measurement
   against the live kernel, not FreeCAD's own Generated()/Modified() API,
   turned out to be sufficient. Pocket's own newly-cut geometry is still
   unnameable, matching OCCT's own scope for the same case (see §6.2a).

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

---

## 6. Known gaps (step 11)

Written after step 10 actually wired `BrepViewportThree.tsx` to `EngineAdapter`
and exercised both engines live, through `packages/sandbox-dev`, in a real
browser -- so this is what was actually found, not a forecast.

### 6.1 `Feature.kind`s that throw on the FreeCAD engine

`FreeCadEngineAdapter.build()` (`packages/kernel/src/freecad-engine-adapter.ts`)
builds `box`, `cylinder`, `sphere`, `sketch` (plane `'xy'` at offset `0`
only -- any other plane/offset throws its own specific message), `extrude`,
`pocket`, `fillet`/`chamfer`, `cone`, `torus`, `prism` (added in a later
pass, see below), and -- added in a further pass, see "pattern lands"
below -- `pattern` (linear + polar, narrowed). Every other
`Feature['kind']` (`packages/script/src/model-types.ts`) throws
`"not yet supported on the FreeCAD engine: <kind>"`:

`wedge`, `groove`, `blend`, `combine`, `revolve`, `mirror`,
`hole`, `shell`, `draft`, `move` -- 10 kinds. `revolve`/`groove`
specifically are a found orientation mismatch, not unstarted work -- see
`FreeCadEngineAdapter`'s own comment on its `else` branch. v1 is also
single-body-per-chain (`combine` is the one place two independent chains
would need to merge into one Body, and does not).

**`cone`/`torus`/`prism` added, `wedge` investigated and rejected.**
`fc-commands.mjs` already carried native `PartDesign::Cone`/`Torus`/
`Prism`/`Wedge` emitters -- the same "additive primitive on a fresh Body"
pattern `sphere` already used, proven at the STRING level
(`engine/bridge/prims-test.mjs`) but never run against a live kernel until
this pass. `cone`/`torus`/`prism` all matched their OCCT (`occt-build.ts`)
semantics directly enough to build for real: `PartDesign::Cone`'s
`Radius1`/`Radius2` frustum with `Radius2=0` tapers to a point exactly
like `coneOf()`'s own base-at-z=0/apex-at-z=height construction;
`PartDesign::Torus` is centred on its own local origin like
`BRepPrimAPI_MakeTorus`, no z-shift needed; `PartDesign::Prism`'s own
vertex-at-angle-0 convention already matches `occt-build.ts`'s own prism
branch by that file's own comment. `prism` needed one real fix:
`emit.prism()` hardcoded `Polygon = 6` with no way to pass
`PrismFeature.sides` (3..12) at all -- fixed with an optional `sides`
parameter (default 6, so every existing caller/test that omits it is
unaffected). `wedge` was investigated and REJECTED, not merely unstarted:
`emit.wedge()` only ever sets `PartDesign::Wedge`'s `Width` and `Height`,
with no parameter for `WedgeFeature.depth` at all -- a found mismatch of
the same kind as `revolve`/`groove`'s orientation gap, not something this
pass could close by guessing a property mapping. `hole`/`shell`/`draft`/
`move`/`mirror` have no native bridge emitters at all (no `emit.hole`,
`emit.shell`, `emit.draft`, `emit.move`, `emit.mirror`) and were left
untouched -- each would need real, unscheduled design work (a hole's own
sketch-plane-vs.-already-placed-body question in particular is a genuine
open question, not a small gap), not a two-line follow of an existing
pattern the way cone/torus/prism were.

**`pattern` (linear + polar) added in a further pass** (SPEC-studio-
canonical.md phase 2), closing the follow-up named above. Built in the
target's own body via `fc-commands.mjs`'s native `PartDesign::
LinearPattern`/`PolarPattern` emitters (previously proven only at the
string level, `engine/bridge/pattern-test.mjs`), matching fillet/chamfer/
extrude/pocket's own "continue in the target's body" convention. Verified
against `fc-kernel-pd-final`
(`packages/kernel/test/freecad-pattern.manual.mjs`, 26/26 passing): a
3-copy non-overlapping linear pattern's volume and bbox span match OCCT
exactly, a 4-copy 90°-spaced polar pattern's volume and span match OCCT
exactly (ruling out FreeCAD spacing occurrences at 360/(count-1) instead
of 360/count, which would have fused a duplicate at the seam), a negative
step correctly reverses direction, and two independent patterns built in
one document keep distinct object names.

Getting there found and fixed three real, previously-unknown bugs, all in
`fc-commands.mjs`'s emitters, none in this pass's own new adapter code:
1. **`Body.Tip` never advances to a `newObject()`-created pattern.**
   `Body.Shape` kept reflecting the PRE-pattern feature (measured: a
   3-instance linear pattern's own bbox came back as a single instance's
   extent) until this pass added an explicit `body.Tip = lp` (`= pp` for
   polar), with the previous Tip restored on the existing rollback-on-
   failure path.
2. **A negative `Length` does not reverse direction -- it errors.**
   `PartDesign::LinearPattern.Length` rejected a negative Quantity outright
   ("Pattern length too small") rather than patterning the other way.
   Fixed by moving direction into the separate `Reversed` boolean property
   and always sending a positive magnitude.
3. **A second `PartDesign::Body` in the same document auto-suffixes its
   own axis datum's internal NAME on collision.** `origin.getObject
   ('Z_Axis')` is a name-based lookup; measured directly against the
   kernel, the first Body's Z axis really is named `Z_Axis`, but the
   SECOND Body's is silently renamed `Z_Axis001` by FreeCAD itself, so the
   original lookup returned `None` for every body past the first and threw
   the exact "type of first element in tuple must be 'DocumentObject', not
   NoneType" exception this same file's own header already names as a
   DIFFERENT bug (msgbox #97) with the identical symptom. Fixed by
   resolving through `origin.OriginFeatures`' own `.Role` property instead
   of `Name` -- `Role` ('X_Axis'/'Y_Axis'/'Z_Axis'/...) is not renamed on
   collision.

Three further, genuine semantic gaps were found (not bugs in this pass's
own code -- structural mismatches between the two engines, the same kind
`revolve`/`groove` and `wedge` already are) and REFUSED per-feature
(`EngineBuildResult.refusals`, the same "no answer over a wrong one" rule
fillet's own edge resolution already follows) rather than built wrong,
all traceable to one root cause: occt-build.ts's own pattern always works
in WORLD coordinates, but FreeCAD's `LinearPattern`/`PolarPattern` resolve
their `Direction`/`Axis` through the owning Body's own Origin datum, fixed
at BODY-LOCAL (0,0,0), which has no knowledge of where `Body.Placement`
will later put the body in the world:
- **A rotated target.** The pattern's own axis would rotate with the body
  instead of staying on the world axis ModelDoc asked for.
- **A non-'z' circular axis.** Unreachable via the studio UI today
  (`ModelEditor.tsx`'s `newPattern()` hardcodes `axis: 'z'`), narrowed
  rather than solved.
- **A circular pattern of a primitive target.** Found ONLY by running
  against the real kernel, not from reading the code: every primitive kind
  (originally sphere/cone/torus/prism; box/cylinder joined this list in an
  out-of-band bugfix pass, see §6.1a below) never bakes `f.center` into its
  own local geometry (center is applied purely via `Body.Placement`), so
  its local shape sits at/near body-local (0,0,0) -- exactly where the
  pattern's own axis also sits, regardless of how far from the world origin
  `f.center` actually placed it. Measured: a radius-5 sphere at center
  `[30,0,0]`, patterned 4x around `'z'`, built with no error and no
  refusal but came back with the volume of exactly one sphere, not four.
  Any non-primitive chain (sketch/extrude/pocket/fillet/chamfer never call
  `setBodyPlacement` at all, so `Body.Placement` stays identity and
  body-local IS world for them) is unaffected.

Full account, including the exact refusal wording, is
`FreeCadEngineAdapter`'s own comment on its `pattern` branch.

Verified against the real kernel (`fc-kernel-pd-final`,
`packages/kernel/test/freecad-new-kinds.manual.mjs`): cone/torus/prism
volumes match OCCT exactly (cone 261.7994, torus 789.5684, octagon prism
1527.3506), and -- once the placement bug below was fixed -- a translated
torus and a translated-AND-rotated prism's own bounding boxes match OCCT's
to four decimal places too, not just their volumes.

**A real, pre-existing bug found (and fixed) while verifying this pass's
own additions at an off-origin center:** `setBodyPlacement()` sets the
owning `PartDesign::Body`'s own `.Placement`, but a PartDesign feature
object's OWN `.Shape` stays in BODY-LOCAL coordinates -- only
`doc.getObject(bodyName).Shape` (never `doc.getObject(featureObjName)
.Shape`) reflects that transform. Measured directly against the kernel
with a plain `session.sphere()` call plus a manual `Placement` set, no
adapter code involved: the feature's own `Shape.BoundBox` stayed at
`[-5,5]` on every axis while the BODY's `Shape.BoundBox` correctly showed
`[25,35]` on X for a `center: [30,0,0]` placement. This silently
misrendered and mis-measured EVERY off-origin primitive already shipped
(`box`/`cylinder`/`sphere`), not only the kinds this pass adds -- it was
invisible until now because every prior real-kernel fixture in this port
(§6.2's picking sweep, §6.3's volume comparisons) happened to use `center:
[0,0,0]`. Fixed in the RENDERING/MEASUREMENT path only --
`mesh()`/`edges()`/`faceAt()` now query and index off the owning Body
(`s.bodyName`), not the feature (`s.objName`) -- verified this both fixes
the position (translated torus, translated+rotated prism bboxes now match
OCCT exactly, see above) and does not regress the existing picking suite
(`freecad-picking.manual.mjs`, still 90/90) or the existing volume
fixtures (`freecad-vs-occt.manual.mjs`, still all passing). Deliberately
NOT extended to `resolvePrimitiveEdgeName()`/`queryPrimitiveGeometry()`
(edge/face naming, and fillet's own `Base` reference) -- those
intentionally stay on the feature's body-LOCAL `Shape`, because
`PartDesign::Fillet.Base` itself takes a body-local feature reference
(changing that would risk breaking fillet's own internal chain-building,
which was out of this pass's job to touch) and `topo-name.ts`'s own
`+x`/`-x`/etc convention is understood in a primitive's own
pre-Placement frame, the same way `occt-build.ts` builds a box
unrotated-then-rotated. Whether that picking path also needs a
rotation/translation-aware fix for an off-origin, rotated primitive is a
real, separate, UNVERIFIED question this pass did not have scope to chase
down -- named here as a follow-up, not silently left for the next person
to rediscover from scratch.

### 6.1a A real, pre-existing bug found (and fixed): box/cylinder double-translation

Out-of-band bugfix pass (2026-09-11, separate from the phase sequence
`SPEC-studio-canonical.md` tracks): `build()`'s `box` and `cylinder`
branches did TWO things with `f.center` -- baked it directly into the
sketch's own local x/y coordinates (`session.sketchAddRectangle`/
`sketchCircle`), AND ALSO passed it to `setBodyPlacement()`, which applies
it a second time via `Body.Placement`. For an identity rotation this
doubled an off-origin box/cylinder's true world position. Measured live,
before any fix, against the real kernel (`fc-kernel-pd-final`): a box and a
cylinder both built with `center: [30, 20, 0]` came back with a world bbox
center of `[60, 40, 0]`, not `[30, 20, 0]` -- confirming the bug exactly as
`setBodyPlacement()`'s own Python codegen suggested on inspection, not
assumed from reading the code alone.

sphere/cone/torus/prism never had this bug -- each of those already builds
its own native geometry at/near local (0,0,0) and applies `center` ONLY via
`setBodyPlacement()` (see `bodyLocalCentered`, `false` for all of them).
Fixed by making box/cylinder follow the exact same convention: their sketch
now draws at local `(0,0)` (`-w/2..w/2` etc., no `f.center` offset), so
`setBodyPlacement()`'s `Body.Placement` is the ONLY place `center` is ever
applied, for every primitive kind alike. Re-verified against the real
kernel after the fix: the same off-origin box/cylinder now comes back with
a world bbox center of exactly `[30, 20, 0]`, both at identity rotation and
at a 45-degree rotation about Z.

**Direct consequence, worked through per this pass's own instructions
rather than left as a surprise:** box/cylinder's local geometry now sits at
body-local (0,0,0) too, exactly where a circular pattern's Origin-datum
axis also sits -- so box/cylinder now hit the SAME circular-pattern-is-a-
geometric-no-op gap §6.1 above documents for sphere/cone/torus/prism.
`bodyLocalCentered` is set to `false` for box/cylinder too (previously
`true`), which automatically extends the existing `pattern` branch's
`bodyLocalCentered.get(...) === false` refusal to them with no additional
condition needed -- confirmed by re-running
`packages/kernel/test/freecad-pattern.manual.mjs` against the real kernel:
its `circDoc` fixture (an off-origin box, circular-patterned) now correctly
REFUSES instead of building a collapsed single-copy "ring", and the test's
own expectations were updated to match (23/23 checks pass, up from the
previous 22/26 -- the four failures being exactly the box-specific circular-
pattern checks that assumed the old, buggy "unaffected" behavior). The
refusal message, which used to name "a sphere, cone, torus or prism"
specifically, now says "a primitive (box, cylinder, sphere, cone, torus or
prism)" since it covers all six.

**Picking checked for a regression, not assumed safe:** `resolvePrimitiveEdgeName()`/
`queryPrimitiveGeometry()` (§6.2 below) compute their own direction-scoring
reference frame (`cx`/`cy`/`cz`) from `target.objName`'s CURRENT `Shape.BoundBox`
on every call, never from a stored `f.center` -- so whether the local
geometry sits at local origin or away from it makes no difference to face/edge
naming. Verified live on an off-origin box (`center: [30, 20, 5]`) and
cylinder (same center) after the fix: every face resolves via `resolveFace`,
every face round-trips through `nameFace()` back to its own part, an edge
between two named faces resolves via `resolveEdge` and measures the correct
length, and a fillet built on that resolved edge still succeeds with no
refusal. No regression.

### 6.2 Picking: implemented for the primitive/between-primitive case, real geometry only

Superseding this section's earlier claim ("all four throw 'not yet
implemented'") -- `resolveFace`/`resolveEdge`/`nameFace`/`nameEdge`, plus
`faceSize`/`edgeLength`, are now implemented on `FreeCadEngineAdapter`
(`packages/kernel/src/freecad-engine-adapter.ts`), narrowed to exactly the
causes this adapter's feature set can produce:

- `primitive` face names (a box/cylinder's own `+x`/`-x`/.../`side`) --
  resolved by the same direction-of-centre + area-tiebreak scoring
  `resolvePrimitiveEdgeName()` already used for the fillet-build path,
  generalized to every part in one kernel round trip
  (`queryPrimitiveGeometry()`), run against whichever FreeCAD object is
  CURRENTLY on screen for that primitive's chain -- not a frozen historical
  shape, so a face untouched by a later fillet/chamfer on the SAME chain
  still resolves correctly.
- `between` edge names over two `primitive` faces of the SAME box/cylinder --
  reuses `resolvePrimitiveEdgeName()` directly for the general picking path
  too, not just the fillet-build path it originally existed for.
- A fillet/chamfer chain is walked back to its box/cylinder ancestor
  (`findPrimitiveAncestor()`) so a pick on the FILLET's own current shape
  still names correctly-rooted `primitive` faces; the round's own new curved
  face correctly returns `null` (verified against the real kernel: on a
  box+fillet, 6 of 8 faces on the filleted solid still name rooted at the
  box, 1 honestly returns null for the corner the round replaced with two
  new faces, 1 for the round's own second new face).

**NOT implemented, and not guessable without more design work**: naming a
face/edge on an extrude/pocket-built solid that came from a SWEPT sketch
edge or an end CAP (`topo-name.ts`'s `swept`/`cap` causes). The OCCT side
answers these via `BuildResult.sweeps`, a per-feature record of which
`TopoDS_Edge` each sketch edge generated (`topo-history.ts`'s
`generatedFrom()`/`capOf()`, built from `BRepBuilderAPI_MakeShape`'s own
`Generated()` history). FreeCAD's bridge has no equivalent history channel
today -- `session.meshFaces()` reports `"Face{n}"`/`"Edge{n}"` and nothing
about which sketch edge or `PartDesign::Pad` end produced which one.
Building that is a real, unscheduled design question (either a second,
FreeCAD-specific history tracker parallel to `topo-history.ts`'s OCCT one,
or leaning on FreeCAD's own `Generated()`/`Modified()` Python API across a
Pad/Pocket) -- not something this phase closed by extending the primitive
resolver. A pick on such a face/edge (a Pad's side wall, its top/bottom cap)
still highlights; `resolveFace`/`resolveEdge`/`nameFace`/`nameEdge` just
return `null` for it, same as any other unresolvable name.

A real internal fix this required: `faceAt()`/`edges()` used to return a
bare `"Face{n}"`/`"Edge{n}"` string with no record of which FreeCAD object
it came from -- fine for `mesh()`'s own consumer (never round-trips the
handle back into the kernel), but ambiguous the moment `faceSize()`/
`edgeLength()`/`nameFace()`/`nameEdge()` need to know WHICH object's `Shape`
to query, which is always true past the first built feature. Both now
return an `FcElementRef` (`{objName, name}`) instead -- still `unknown` at
the `EngineAdapter` boundary (`BrepViewportThree.tsx` never inspects the
shape of a face/edge handle), so this is an internal representation fix,
not an interface change.

Verified against the real kernel (`fc-kernel-pd-final`,
`packages/kernel/test/freecad-picking.manual.mjs`): a 40x30x20 box's all 6
faces name and round-trip through `resolveFace` back to the exact same
`Face{n}`, `faceSize()` matches the box's own dimensions per face, all 12
edges name (`between`, two `primitive` faces) and round-trip through
`resolveEdge`, `edgeLength()` returns a positive number for each -- 90 of 90
checks passed. (Since extended, §6.1a: an off-origin box/cylinder
regression section was added to the same file after the box/cylinder
double-translation fix -- 103 of 103 checks passing overall.)
`BrepViewportThree.tsx`'s `pickAt()`/`restorePicks()` no
longer need their `try/catch`-as-null fallback to survive a FreeCAD-engine
click (it still wraps every call, unchanged, since `null` remains the
correct answer for anything outside this narrowed scope) -- a click on a
box or cylinder's own flat face or straight edge, even past a fillet/
chamfer applied to the SAME chain, now returns a real name and a real
measured size.

### 6.2a Sketch-derived (Pad) naming: `swept`/`rounded`/`cap`, closed for extrude; pocket's own new geometry stays refused

SPEC-studio-canonical.md phase 3. Superseding §6.2's "NOT implemented"
paragraph for the `extrude` case specifically -- `resolveFace`/`resolveEdge`/
`nameFace`/`nameEdge` now also cover a Pad's own side walls (`swept` for a
straight design edge, `rounded` for an arc from a rounded/chamfered corner)
and its two caps (`cap`, `end: 'top' | 'bottom'`), closing exactly the gap
§6.2 named as unscheduled design work -- and without needing either option
that paragraph raised (a second FreeCAD-specific history tracker, or
FreeCAD's own `Generated()`/`Modified()` Python API). A simpler, measured
fact was enough instead.

**What was measured, against `fc-kernel-pd-final`, before any code was
written** (a throwaway script, not shipped): for a `PartDesign::Pad` built
from an n-segment outline (straight or arc segments alike, `outlineOf()`'s
own order), the Pad's **own** `Shape.Faces` — queried by name, directly off
that **same, frozen** object, never off the owning Body or a later
feature's current tip — comes back in **exactly** wall-0, wall-1, ...,
wall-(n-1), then the bottom cap, then the top cap, every time. Verified for
a plain rectangle (n=4), a rectangle with one rounded corner (n=5, the arc's
own wall landing at its emission position with a `Cylinder` surface type,
not a `Plane`), and confirmed to **keep holding on that SAME Pad object**
even after a further feature (a Pocket) was built on top of it in the same
Body — a `PartDesign` feature object's own `.Shape` is computed once and
does not get rewritten by a later feature in the chain (the same fact
`mesh()`'s own header already relies on for `Body.Placement`). The **same**
measurement also confirmed the opposite is true of the owning Body's (or
any later feature's) own **current** `Shape.Faces`: after the Pocket, two of
the Pad's own untouched walls had swapped ordinal positions and the modified
cap had moved too — kernel-assigned face order is not to be trusted the
moment anything is built on top, exactly the caution `topo-history.ts`'s own
header already gives for the OCCT side.

**The design this measurement enabled, in two halves matching that split:**

- `resolveFace`/`resolveEdge` (a stored name → a face) always query the
  extrude's **own** object directly (`build.shapes.get(name.feature)`,
  never an ancestor walk) and trust the **cached ordinal** Face index
  (`FcSweepInfo`, computed once at `build()` time by mirroring
  `sketch-translate.ts`'s own geometry-emission loop exactly — same
  `outlineOf()`/`segmentRoles()` calls, same order). No kernel round trip at
  all for this direction; the measurement above is what makes trusting the
  cache safe.
- `nameFace`/`nameEdge` (a picked face → a name) can be picking on **any**
  later feature in the chain (a Fillet, a Pocket), where ordinal trust does
  not hold — so these query the picked object's **current** Shape and
  identify each wall/cap candidate **geometrically**: a point known to lie
  on it (a wall's own arc-or-chord midpoint at local z = height/2; a cap's
  own outline-vertex-average at z = 0 or z = height) checked against every
  current face via `Part.Vertex(...).distToShape(...)` — the same
  "point known to lie on it" technique `topo-history.ts`'s own
  `pointOnFace()`/`distanceTo()` already use on the OCCT side, for the same
  reason (`querySketchGeometry()`, the geometric counterpart of the
  primitive path's `queryPrimitiveGeometry()` direction-scoring).
  `findSketchAncestor()` walks a `fillet`/`chamfer` (`.target`) or `pocket`
  (`.into`) chain back to its `extrude` root, mirroring
  `findPrimitiveAncestor()`.

Verified against the real kernel
(`packages/kernel/test/freecad-sketch-picking.manual.mjs`, 88/88 checks): a
plain rectangle Pad's 4 walls and 2 caps all name and round-trip; a
rounded-corner Pad's arc wall names with cause `rounded` (not `swept`) and
the other 4 still `swept`, all round-trip; all 12 edges of the plain
rectangle name as `between` two `swept`/`cap` faces and round-trip, with a
real positive `edgeLength()`; a Fillet was **built for real from a pick** on
one of those wall edges (the payoff this phase exists for — Round/Chamfer
on a real modeled part, not only a raw box/cylinder); and, on a genuine
pad-then-pocket chain, the Pad's untouched walls/cap still name and resolve
correctly when picked on the **pocket's own current** (reordered) shape,
while the pocket's own new geometry (the hole's wall, its floor, and the
modified cap it cut into) comes back an honest `null` — proving both halves
of the design above against real geometry, not just against a fake session.

**Narrowed, honestly, matching this file's own "no answer over a wrong one"
rule throughout:**

- **Pocket's own newly-cut faces are never nameable, on purpose** — not a
  gap this pass ran out of time for, but a deliberate match to what OCCT
  **already** does: `occt-build.ts`'s own `pocket` branch records no sweep
  history at all ("a cut's faces come from the boolean, not the prism"),
  and no code path anywhere ever constructs a `made`-cause name for one
  either (`topo-name.ts`'s own header names `made` as a real, open design
  question, not a solved one). Naming a pocket's own hole would have made
  the FreeCAD engine's naming **strictly more capable than OCCT's** for
  this one case — a real design decision this phase declined to make
  unilaterally, not an oversight.
- **A circle-shaped sketch profile has no `sweep` cached at all** — there is
  no per-edge/per-corner vocabulary to name a circular Pad's one wall after
  (`circleOf()` short-circuits `buildSweepInfo()`), matching how a circle
  sketch never populates `matchSegments()`'s marks on the OCCT side either.
- **A concave sketch's cap point (the outline's own vertex-average) is not
  guaranteed to land inside the polygon** — same documented limitation as
  `topo-history.ts`'s own `pointOnFace()` centroid heuristic; every fixture
  measured here is convex (a rectangle, a rounded rectangle) so this never
  triggered, but a concave cap could come back an honest `null` rather than
  a wrong face. `topo-history.ts`'s own grid-search fallback was not ported.
- **A negative-bulge (clockwise-wound) rounded corner's own wall midpoint is
  unverified against the real kernel** — only the positive-bulge (CCW)
  fixture this port's own rounded-rectangle test uses was measured; same
  caveat `sketch-translate.ts`'s own header already states for the
  identical arc-orientation question there.
- **A pocket cannot actually be reached today through `FreeCadEngineAdapter
  .build()` with a real, ordinary `ModelDoc`** — a real, pre-existing,
  already-documented v1 scope limit this phase found itself blocked by
  while writing its own verification script, not something it introduced or
  is positioned to fix: `'sketch'` always opens a **fresh** Body
  (`freshBody()`, unconditional), and `pocket`'s own build() branch throws
  "cuts across two different bodies" the instant its target sketch is not
  already in the **same** body as `into` — which requires a face-attached
  sketch (`sketchNewOnFace`, which the bridge itself has and
  `engine/bridge/pocket-test.mjs` already proves against the real kernel)
  that this adapter's own `'pocket'` build() branch has never been wired to
  create. The pad-then-pocket verification above worked around this by
  driving the same body directly through the session (mirroring the
  existing `freecad-engine-adapter-build.test.mjs`'s own "sketch -> pocket
  cuts into the same body" test, whose own body **proves the throw**, not a
  success) — real progress on naming, but pocket's own single-body reach is
  unchanged and still named here as open, not silently worked around.

**A real, previously-shipped, previously-undiscovered bug found (and
fixed) while building this verification, unrelated to naming itself:**
`sketch-translate.ts`'s own origin-pinning helper (`pinCornerToOrigin`,
also used by `pinAxisIfNeeded`'s DoF-closure loop and the `circleOf()`
branch's own center pin) called FreeCAD's `Sketcher::Constraint('DistanceX'
/'DistanceY', g1, p1, g2, p2, value)` with the design **corner first, the
origin second** — measured directly against the real kernel (not assumed):
this constraint means `value = coordinate(g2, p2) - coordinate(g1, p1)`,
second point minus first, so pinning `(corner, origin, value=x)` actually
pins `coordinate(corner) = -x` — every closure-pinned or `lock`-ed corner,
and every `circleOf()` center, landed at the **negative** of its intended
coordinate, a full point-reflection of the sketch through its own origin.
**Volume-only checks never caught this** (§6.3's own "rectangle extrude:
12000.0000, exact" included) because a point reflection is an isometry — it
changes *where* a shape sits, never its volume, and every real-kernel
fixture measured before this phase happened to be checked by volume alone.
Found chasing this phase's own wall-naming self-check: an extrude's wall
centroids came back at exactly the design's 180°-rotated positions
(`(-20,0)` instead of `(20,0)`, etc.) on the very first real-kernel run.
Fixed by swapping the argument order (origin first, corner second) in all
three call sites; `packages/engine/test/sketch-translate.test.mjs`'s own
argument-order assertions were updated to match, and the fix was
re-verified directly against the real kernel (the same sketch's own
`Sketch.Geometry` reads back at its correct, un-reflected coordinates).
**Scope of the fix, stated precisely**: only the three call sites that pin
something **against the sketch origin** (`ORIGIN_GEO`/`ORIGIN_POS`) were
touched. The *separate* `distanceX`/`distanceY` **constraint kinds**
(§4.5.2's own table row, between two *named*, non-origin corners) use a
different code path entirely and were not touched, checked, or implicated
by this finding — their own sign convention was independently verified
already (§6.3's "angle-constraint corner 2" measurement exercises a
different corner via explicit constraints, not this closure mechanism) and
auditing it further is out of this phase's own scope.

### 6.3 FreeCAD-kernel numbers: now measured for real, via `fc-kernel-pd-final`

Superseding this section's earlier claim ("never been cross-checked") --
`fc-kernel-pd-final:latest` (9.4GB, built in an earlier session) was already
sitting in this machine's local Docker image cache. Once Docker Desktop was
running, `freecad-vs-occt.manual.mjs` ran for real inside it
(`docker run --rm --privileged -v <repo>:/mnt/host/c/Users/.../reshape-cad
fc-kernel-pd-final node --experimental-wasm-exnref
/mnt/host/.../packages/kernel/test/freecad-vs-occt.manual.mjs
/work/build/bin/FreeCADCmd.js` -- the mount path must match the WSL2
host-mount convention `npm install`'s own workspace symlinks were written
against, `/mnt/host/c/...`, not an arbitrary bind path, or every
`@shuff57/*` import resolves to a dangling symlink). Measured results:

| Case | OCCT | FreeCAD | Match |
|---|---|---|---|
| box + fillet volume | 31785.3982 | 31785.3982 | exact |
| unconstrained rectangle extrude | 12000.0000 | 12000.0000 | exact |
| rounded-rectangle extrude | 11935.6194 | 11935.6194 | exact |
| angle-constraint corner 2, pre-closure | JS solver: `[38.0069, 15.9893]` | FreeCAD's own solve: `(38.006855, 15.98932)` | matches to the precision shown |

**The angle-constraint sign convention (§4.5.2's flagged uncertainty) is
CONFIRMED, not assumed**: read directly from `sketchState().geometry`
*before* any closure pin touches that corner -- FreeCAD's `Angle` constraint
between two line geoIds, emitted start-to-end exactly as
`sketch-translate.ts` already does, converges to the same corner position
`sketch-solve.ts`'s own `atan2(cross,dot)` residual computes. No sign flip
needed in the mapping table.

Getting here found and fixed three real, previously-unknown bugs -- all in
`translateSketch()`'s geometry-emission/closure code, none in the FreeCAD
bridge itself, each caught by the real GCS solver refusing to converge and
each verified fixed by re-running the same script:

1. **Segments were never welded into a closed loop.** `sketchAddLine()`/
   `sketchAddArc()` each create an independent geometry element with its own
   endpoints -- FreeCAD does not infer that segment *i*'s end sits at
   segment *i+1*'s start just because `outlineOf()` computed matching
   coordinates for both. First measured symptom: DoF closure pinned every
   design corner and the solver still reported `n*2` degrees of freedom left
   -- exactly the *n* segments' un-welded end points, which `cornerRefs`
   never tracks at all (it only ever holds `pointPos 1`). Fixed with an
   explicit `constrainCoincident(geoIds[i], 2, geoIds[(i+1)%n], 1)` loop
   after geometry emission, closing the polygon for real.
2. **An arc's construction values are a starting guess, not a fact.** After
   the weld fix, a rounded-corner sketch still failed:
   `gp_Circ::SetRadius() - radius should be positive number` mid-solve, the
   GCS solver wandering into an invalid guess because nothing told it the
   arc's radius/center were meant to be fixed. First fix attempt (pin
   radius + center, mirroring the circle branch) closed 3 of 3 reported DoF
   but left the arc's start/end *angles* free -- the weld to each neighbour
   only constrains the endpoint if that neighbour's OTHER end is itself
   already fixed, which is not true in general. Final fix: pin the arc's own
   two endpoints directly (`a`/`b` -- already known exactly, the same values
   used to construct the arc) plus radius, instead of trying to fix the
   circle's abstract parameters and hoping the welds propagate an angle.
3. **A rounded corner's closure pin used the wrong (pre-round) coordinate.**
   `sketch.points[c]` is the *design* corner, not where rounding trims the
   outline to -- pinning a rounded corner's arc-backed `CornerRef` to that
   stale coordinate directly conflicted with the arc's own (now-correct)
   endpoint pins. Fixed by tracking which corners resolved through the arc
   branch (`roundedCorners`) and skipping them in both the closure loop and
   the `lock` constraint handler (locking a rounded corner is now a refusal,
   not a silent wrong pin -- there is no single coordinate to lock it to).

### 6.3.1 The closure-pin tolerance gap: fixed, per-axis, with a real regression along the way

`packages/sketch`'s residual solver (`solveSketch`) is a least-squares
minimizer, so its output (`jsSolved.points`) carries small floating-point
residue (e.g. corner 1 lands at `29.99999999989688`, not exactly `30`) even
for a corner FreeCAD's own `lock`+`horizontal`+`length` constraints already
determine *exactly*. Closure re-pinning that same, already-exactly-fixed
point to the epsilon-different value is a genuine numerical conflict, not
the "redundant, both agree by construction" case §4.5.3 step 5 originally
assumed.

**Fix, in `sketch-translate.ts`'s closure loop**: `pinAxisIfNeeded()` pins
and checks X and Y **separately**, not as `pinCornerToOrigin()`'s bundled
pair. When a pin conflicts, it is undone (`session.delConstraint`) only
when **both**:
- `matches` -- the point was already within `CLOSURE_TOLERANCE_MM` (1e-4mm)
  of the target value *before* this pin, read back from
  `sketchState().geometry`; and
- `uninformative` -- `dof` did not drop when the pin was added (the actual
  definition of redundant, not just numerically close).

Proximity alone is **not sufficient evidence** and was the source of a real,
measured regression: since sketch geometry is always *constructed* from the
already-solved coordinates (§4.5.1), every corner starts out numerically
near its target regardless of whether anything actually holds it there.
An earlier version of this fix bundled X+Y together and deleted both halves
whenever either one conflicted-and-matched; against the real kernel, this
built the rounded-rectangle fixture with the **wrong volume**
(`12706.8583` instead of `11935.6194`) because one axis of a corner's pin
was genuinely needed (measured: `before.dof=3, after.dof=2`) but got
deleted anyway alongside a genuinely-redundant one on a *different* corner.
Splitting the check to per-axis, gated on both conditions, fixed it --
re-verified against the real kernel three consecutive runs, all matching
OCCT exactly (`12000.0000`, `11935.6194`).

**`skA` (the angle-constraint fixture) itself still refuses** -- correctly,
now, not a bug. One axis of corner 2's closure pin is genuinely informative
(`before.dof=3, after.dof=2` -- it really does close real freedom) *and*
FreeCAD's own solver flags it conflicting. `pinAxisIfNeeded` now leaves that
axis in place rather than silently dropping it (dropping it is exactly what
caused the regression above), so the sketch refuses honestly instead of
building a shape nobody verified. This is a real, narrower, unresolved
question -- why does an informative pin also conflict here -- left for a
follow-up; three unit tests (`packages/engine/test/sketch-translate.test.mjs`)
pin down all three outcomes (redundant+undone, genuinely-mismatched+refused,
informative-but-conflicting+kept) so a future fix can't silently regress
either direction again.

### 6.4 A real, fixed bug: `packages/engine/src/load-browser.mjs` had no `locateFile`

Found while running step 10's self-check (b) for real (not just reading the
code): `FreeCadEngineAdapter` failed on its very first `newDocument()` call
under `packages/sandbox-dev`, with `ModuleNotFoundError: No module named
'encodings'` -- Python's own stdlib never mounted. Root cause: the
Emscripten-generated `freecad-data.js` (a different, older data-packager
output than `FreeCADCmd.js`'s own module glue) resolves its own `.data` file
via `Module['locateFile']?.(name, '') ?? name` -- a BARE filename with no
script-relative fallback when `locateFile` is absent -- so its
`fetch('freecad-data.data')` resolved against the PAGE's own origin, not the
engine's base URL. `engine/play/studio.js`'s own copy of this same bootstrap
never surfaced this because that page happens to be served from the same
root its data file sits at -- a coincidence `packages/sandbox-dev`'s SPA
route (serving `freecad-data.data` under `/reshape/engine/`, not page root)
does not share. Fixed by adding one `locateFile: (path) => \`${base}${path}\``
line to `load-browser.mjs`'s `Module` config -- verified this also does not
change `FreeCADCmd.js`'s own (already-correct) wasm resolution, since both
now agree on the same `base`. `engine/play/*` was left untouched per this
phase's own scope constraint; its bootstrap still "works" there only by the
coincidence above.

### 6.5 Loading timing: three.js now loads before the kernel starts fetching, not alongside it

`BrepViewportThree.tsx`'s pre-refactor `loadKernel()`/`loadThree()` ran via
one `Promise.all(...)`, so the wasm kernel's own download started
concurrently with three.js's own chunk fetch. Both `EngineAdapter`
implementations take `THREE` constructor-injected (§3.2, unchanged by this
phase), so `loadEngine()` cannot construct or `load()` an adapter until
`loadThree()` has already resolved -- the two can no longer run in parallel.
Not a functional regression (self-check (a) is unaffected: build, pick,
fillet, undo all still work identically), and the wasm kernel (23-58 MB) so
dominates the load time over three.js's own chunk that the effect is likely
sub-second in absolute terms, but it is a genuine, unmeasured timing
difference from before this phase, named here rather than silently accepted.

### 6.6 Save/Open `.FCStd` (SPEC-studio-canonical.md phase 4) -- `EngineAdapter` grows two methods

`EngineAdapter` (§3.1) gained `saveDocument(doc: ModelDoc): Uint8Array` and
`openDocument(bytes: Uint8Array): ModelDoc | null`, matching
`fc-session.mjs`'s own bridge-level `saveDocument()`/`openDocument()` naming
(a real, ModelDoc-agnostic primitive already proven by `engine/play/
studio.js`'s own Save/Open buttons, found already there before writing any
new code here). The bridge stays ModelDoc-agnostic on purpose (this file's
own §2.1, "the FreeCAD bridge knows nothing about ModelDoc") -- the new
adapter-level methods are the ModelDoc-aware half, living in
`freecad-engine-adapter.ts` instead.

**The real design question this phase was flagged to stop and report on
instead of guessing**: a `.FCStd` can hold arbitrary FreeCAD Part/PartDesign/
Sketcher trees built entirely outside this app (`studio.html`'s own Open
button supports exactly that), while `ModelDoc` (`model-types.ts`) is a much
narrower, single-body-per-chain vocabulary of ~13 `Feature.kind`s. Resolved
by NOT attempting to reverse-engineer a general FreeCAD feature tree back
into a `ModelDoc` at all: `saveDocument()` writes a real, independently-
openable native `.FCStd`, but ALSO embeds the original `ModelDoc` as a
marker-prefixed JSON string in `App::Document.Comment` (a plain string
property every FreeCAD document already has). `openDocument()` looks for
that marker and returns the embedded `ModelDoc`, structurally exact, when
present; returns `null` -- refuses, per this port's established "no answer
over a wrong one" rule (topo-resolve.ts's own header; the pattern refusals
in §6.1) -- for any file that does not carry it, i.e. any `.FCStd` this
adapter did not itself save. `App::Document.Meta` (a dict-valued property)
was also measured to round-trip the same way and was considered instead;
`Comment` was chosen for being one plain string field, no dict-marshalling
edge case to carry across a Python binding this port has already found real
surprises in more than once (`Body.Tip`, `OriginFeatures` naming in §6.1).
Both were confirmed, not assumed, via a standalone probe script against
`fc-kernel-pd-final` before writing any adapter code.

`OcctEngineAdapter` implements both methods as an unconditional throw
(`"not supported on the OCCT engine: ..."`) -- OCCT has no `.FCStd` concept
at all, so there is no degraded answer to give, only a clear refusal
distinguishable from `FreeCadEngineAdapter`'s own per-feature `"not yet
supported on the FreeCAD engine: <kind>"` refusals (a different failure
shape: a whole capability, not one unbuilt feature). `ReshapeStudio.tsx`'s
Save/Open buttons gray out on the OCCT engine instead of relying on this
throw at all -- `BrepViewportThree.tsx` grew an `onEngine` prop (fired with
the live `EngineAdapter` instance and which kind is ACTUALLY active) so the
UI can gray out correctly even mid-session, after a FreeCAD-refusal fallback
(§6.1's per-doc OCCT fallback) has silently swapped the live engine to OCCT
underneath a `getEngineMode()` that still reports `'freecad'`.

**Verified against the real kernel**
(`packages/kernel/test/freecad-save-open.manual.mjs`, 10/10): building a
box+pattern `ModelDoc`, saving it, and reopening the raw bytes through the
BRIDGE directly (no `ModelDoc` involved at all) reproduces the identical
mesh volume -- a genuine native round trip, not just "no error thrown"; the
adapter's own `openDocument()` reconstructs a `ModelDoc` structurally equal
to the original; rebuilding THAT reconstructed `ModelDoc` from scratch,
independently, reproduces the same volume a third way; a `.FCStd` built via
raw bridge commands with no embedded marker correctly returns `null`, not a
guessed document; `OcctEngineAdapter.saveDocument()`/`openDocument()` both
throw the expected clear message.

**Verified live in the browser** (bowser, `packages/sandbox-dev`, real
FreeCAD wasm kernel): built a 40x40x20 box, confirmed Save/Open were enabled
once a shape existed, clicked Save and captured the real download (`reshape-
1-feature-<timestamp>.FCStd`, 9,246 bytes), cleared the model, clicked Open
and selected that same file via a native file chooser, and confirmed the
identical box reappeared in the viewport a few seconds later with no console
errors attributable to Save/Open or the kernel.
