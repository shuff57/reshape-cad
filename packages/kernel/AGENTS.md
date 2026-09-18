# packages/kernel

## OVERVIEW
One `EngineAdapter` contract, three wasm kernel implementations (replicad OCCT, FreeCAD, brep-rs), plus the shared OCCT build pipeline and topology-name resolver.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Adapter contract | src/engine-adapter.ts | `EngineAdapter`, `EngineBuildResult` (shapes + per-feature `refusals`) |
| OCCT build | src/occt-build.ts | `buildDoc()`; keeps `OpRecord`/`SweepRecord` op objects alive, their history is what naming resolves through |
| Name resolution | src/topo-resolve.ts | `resolveName()`, one branch per `TopoName` cause; returns null over guessing |
| OCCT adapter | src/occt-engine-adapter.ts | Thin shell over occt-build + topo-resolve |
| FreeCAD adapter | src/freecad-engine-adapter.ts | ~2800 lines; per-kind build branches, save/open, drawing export |
| brep-rs adapter | src/brep-rs-engine-adapter.ts | Shapes are `{doc, feature}` JSON handles the Rust wasm re-parses per call |
| Mode + asset URL | src/config.ts | `getEngineMode()` / `getKernelBaseUrl()`, module-level state |
| Kernel API slice | src/occt-api.ts | Hand-written `Occt` interface; the real .d.ts is 1.54MB and not vendored |
| Mesh helpers | src/occt-mesh.ts, src/occt-three.ts | Tessellation, per-face `FaceRange` groups for picking |

Naming types (`TopoName`, `whyNameLost`) and op-history helpers (`faceFate`, `sharedEdge`, ...) live in packages/script (`topo-name.ts`, `topo-history.ts`), not here. This package only records and resolves.

## CONVENTIONS
- **Constructor injection for tests**: adapters take `THREE` (and FreeCAD's `loadModule`) as constructor args; `BrepRsEngineAdapter.loadFromBytes()` is a test-only seam, not part of the contract.
- **Kernel wasm is never vendored**: replicad_single (23MB) and brep-rs pkg are gitignored, served by the host app; always read the URL from `getKernelBaseUrl()`.
- **`refusals` and pass-through are one behaviour**: a refused feature keeps its unmodified source shape in `shapes` AND a reason in `refusals`. Any caller reading a build result must surface the refusals map; pass-through alone recreates the "feature reports success but is not what its row says" defect.
- **FreeCAD build is v1 full replay**: every `build()` opens a fresh document and re-emits the whole ModelDoc. Never diff against the live session. `saveDocument()` rebuilds first rather than trusting the active document, and stashes the ModelDoc JSON in `Document.Comment` behind a marker for `openDocument()`.
- **Engine-only features throw**: OCCT and brep-rs adapters throw plain sentences for save/open/drawing. Callers gate on `getEngineMode()`; they do not catch the message text.

## ANTI-PATTERNS
- **Do not swap the hand-written `Occt` slice for the full generated .d.ts.** The 1.54MB declarations are deliberately not vendored; a wrong entry point fails loudly at first call, which is the trade.
- **Do not resolve `carried`/`split` names against the final shape.** The ancestor resolves on its own feature's pre-op shape, then pushes forward through the recorded op chain.
- **Do not treat brep-rs shape handles as kernel objects.** They are opaque `{doc, feature}` keys; every mesh/resolve/measure call re-parses the doc JSON in the wasm.
- **Do not hardcode kernel asset paths.** `/reshape/kernel` is only today's default; consumers read `getKernelBaseUrl()` so the wasm can move to R2 without code edits.
- **Do not generalize a FreeCAD branch without probing the kernel first.** Each existing branch records what was measured against this fork, and the fork's answers differ per feature. Probe fresh (engine/bridge/*-probe.mjs) before writing a new one.
- **Do not "fix" the `made` cause by guessing a face.** It returns null on purpose; the design question is left open in topo-resolve.ts's header.