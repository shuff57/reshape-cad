# packages/kernel

## OVERVIEW
The `EngineAdapter` seam and its one implementation (brep-rs). Also holds three OCCT files that are NOT app code -- see REFEREE APPARATUS below before deleting anything that looks orphaned here.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Adapter contract | src/engine-adapter.ts | `EngineAdapter`, `EngineBuildResult` (shapes + per-feature `refusals`), `EngineMesh`, `FaceRange` |
| The one adapter | src/brep-rs-engine-adapter.ts | Shapes are `{doc, feature}` JSON handles the Rust wasm re-parses per call |
| Asset URL | src/config.ts | `getKernelBaseUrl()` only -- there is no engine mode |
| Barrel | src/index.ts | Nothing imports via bare `.`; documents what is deliberately NOT exported |

Naming types (`TopoName`, `whyNameLost`) and op-history helpers (`faceFate`, `sharedEdge`, ...) live in packages/script (`topo-name.ts`, `topo-history.ts`), not here. This package only records and resolves.

## REFEREE APPARATUS
`src/occt-build.ts`, `src/occt-mesh.ts` and `src/topo-resolve.ts` have no importer anywhere and are exported from neither the barrel nor package.json. They are not dead. `scripts/brep-parity-gate.mjs` and `scripts/brep-mesh-gate.mjs` load them out of `dist/` **by filesystem path**, build every fixture on OCCT as well as on brep-rs, and compare -- the only independent oracle over a kernel whose signature failure is the wrong answer rather than the missing one. They compile because `tsconfig.json` includes `src/**/*.ts`; that is the whole mechanism keeping them alive. `replicad-opencascadejs` is a root devDependency for these gates and nothing else.

## CONVENTIONS
- **Constructor injection for tests**: the adapter takes `THREE` as a constructor arg; `BrepRsEngineAdapter.loadFromBytes()` is a test-only seam (node has no fetch for the wasm), not part of the contract.
- **Kernel wasm is never vendored**: `packages/brep-rs/pkg` is gitignored and served by the host app; always read the URL from `getKernelBaseUrl()`.
- **`refusals` and pass-through are one behaviour**: a refused feature keeps its unmodified source shape in `shapes` AND a reason in `refusals`. Any caller reading a build result must surface the refusals map; pass-through alone recreates the "feature reports success but is not what its row says" defect. With no second engine to retry on, this map is the whole story the student gets.
- **No engine mode**: `config.ts` exports the base URL and nothing else. `packages/kernel/test/config.test.mjs` asserts `getEngineMode`/`setEngineMode` do not exist, so a second engine cannot creep back in unnoticed.

## ANTI-PATTERNS
- **Do not delete the referee apparatus** (see above) because it has no importer. That is what it looks like when it is working.
- **Do not export the OCCT files from the barrel or package.json.** The gates reach them by dist path; an export would advertise a second kernel this app does not have.
- **Do not resolve `carried`/`split` names against the final shape.** The ancestor resolves on its own feature's pre-op shape, then pushes forward through the recorded op chain.
- **Do not treat brep-rs shape handles as kernel objects.** They are opaque `{doc, feature}` keys; every mesh/resolve/measure call re-parses the doc JSON in the wasm.
- **Do not hardcode kernel asset paths.** `/reshape/kernel` is only today's default; consumers read `getKernelBaseUrl()` so the wasm can move to R2 without code edits.
- **Do not "fix" the `made` cause by guessing a face.** It returns null on purpose; the design question is left open in topo-resolve.ts's header.