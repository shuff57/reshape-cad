# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-17

## OVERVIEW
Browser-first CAD: reSHape Script (2D sketches + 3D parts, JavaScript) over brep-rs, an independent Rust B-rep kernel compiled to WebAssembly. ONE kernel, no fallback — a shape brep-rs cannot build is refused per feature, in a sentence, alongside whatever did build.

## STRUCTURE
```
reshape-cad/
├── packages/
│   ├── brep-rs/      # THE kernel: Rust B-rep, wasm-bindgen; pkg/ is gitignored output
│   ├── kernel/       # EngineAdapter seam + the brep-rs impl (+ OCCT referee apparatus)
│   ├── script/       # reSHape Script interpreter, ModelDoc, round-trip emitter
│   ├── sketch/       # 2D sketch solver (constraints, arcs, outlines)
│   ├── studio/       # React UI (editor, viewport, timeline) -- library, not an app
│   └── sandbox-dev/  # Vite harness mounting studio; the only runnable app
├── scripts/          # LEAD-OWNED gates, run on demand, never from npm test
├── docs/             # Specs, schemas, kernel-campaign ledger, spike reports
├── design/           # Mockups + UI-revamp specs
├── bench/            # Yardstick tasks + record.json
└── assets/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Language/runtime changes | packages/script/src/reshape-script.ts | Interpreter core; `runScript()` entry |
| Code generation (round-trip) | packages/script/src/reshape-script-gen.ts | `toScript()` doc → source |
| Model types / document schema | packages/script/src/model-types.ts | `ModelDoc`, `Feature`, `SketchFeature` |
| Sketch solving | packages/sketch/src/sketch-solve.ts | Constraint resolution, DoF |
| Sketch outline/tessellation | packages/sketch/src/sketch-arc.ts | `tessellate()`, `arcFromBulge()` |
| The kernel itself | packages/brep-rs/src/ | `lib.rs` module layering, `wasm.rs` JS surface |
| Adapter seam | packages/kernel/src/engine-adapter.ts | `EngineAdapter`, `EngineBuildResult`, `FaceRange` |
| The one adapter | packages/kernel/src/brep-rs-engine-adapter.ts | Shapes are `{doc, feature}` JSON handles |
| Referee apparatus (NOT app code) | packages/kernel/src/{occt-build,occt-mesh,topo-resolve}.ts | Only the gates load these, from dist/ by path |
| React UI / viewport | packages/studio/src/ | `ReshapeStudio`, `BrepViewportThree` |
| App entry / dev server | packages/sandbox-dev/src/main.tsx | `App` → `ReshapeStudio` |
| CI / build order | .github/workflows/ci.yml | Enforces sketch→script→kernel→studio |
| Gates | scripts/*.mjs | On demand only; see ANTI-PATTERNS |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `runScript` | function | packages/script/src/reshape-script.ts:611 | 15+ | Interpreter entry; returns `RunResult` |
| `toScript` | function | packages/script/src/reshape-script-gen.ts:254 | 5 | Round-trip emitter (doc → source) |
| `solveDoc` | function | packages/script/src/model-codegen.ts:503 | 20+ | Full document solve (sketch + 3D) |
| `EngineAdapter` | interface | packages/kernel/src/engine-adapter.ts:95 | — | The kernel seam; build/mesh/edges/name/measure |
| `FaceRange` | interface | packages/kernel/src/engine-adapter.ts:66 | 3 | Face → index-buffer range; survives a re-mesh |
| `BrepRsEngineAdapter` | class | packages/kernel/src/brep-rs-engine-adapter.ts:80 | 2 | The only implementation |
| `build_doc_json` | wasm export | packages/brep-rs/src/wasm.rs:1752 | — | Kernel build entry, JSON in/out |
| `tessellate` | function | packages/sketch/src/sketch-arc.ts:608 | 10+ | Sketch → polyline points |
| `ReshapeStudio` | component | packages/studio/src/ReshapeStudio.tsx:184 | 1 | Main UI surface |
| `BrepViewportThree` | component | packages/studio/src/model/BrepViewportThree.tsx:448 | 1 | Three.js viewport + kernel loader |

## CONVENTIONS
- **TypeScript**: `strict: true`, `isolatedModules: true`, ES2022, `moduleResolution: bundler`, `jsx: react-jsx` (tsconfig.base.json)
- **Exports**: Subpath exports only (`./model-types`, `./engine-adapter`); bare `.` re-exports minimal config
- **Build order**: Manual chain `sketch → script → kernel → studio` (root package.json); `--workspaces` breaks on fresh checkout
- **Tests import from `dist/`**: `node --test "test/*.test.mjs"` runs against compiled output; must `npm run build` first
- **No linter/formatter**: No ESLint, Prettier, rustfmt, clippy — conventions enforced by `tsc` + written docs
- **Line endings**: LF enforced via `.gitattributes` for all text/code; `*.wasm`, `*.png` marked binary
- **Rust**: Edition 2021, release profile `opt-level="z"`, `lto=true`, `panic="abort"` (size-optimized wasm)
- **No engine selection**: there is one kernel, chosen at compile time. `config.ts` exports only the base URL — a `getEngineMode()` reappearing means a second engine came back with it (pinned by `packages/kernel/test/config.test.mjs`)
- **`npm test` measures the product, gates measure the kernel**: `npm test` is check-record + workspace suites; the four `scripts/` gates run on demand

## ANTI-PATTERNS (THIS PROJECT)
- **Do not edit gate scripts**: `scripts/brep-*.mjs`, `check-record.mjs`, `occt-modeldoc-gate.mjs` are LEAD-OWNED
- **Never return wrong solid silently**: the kernel must refuse per-feature with a plain sentence (SPEC-brep-kernel-rs.md). With no fallback engine, this is now the ONLY thing standing between a student and a wrong part
- **Do not delete the OCCT referee apparatus**: `packages/kernel/src/{occt-build,occt-mesh,topo-resolve}.ts` and `packages/script/src/topo-history.ts` are not app code and have no importer — the parity/mesh gates load them from `dist/` by filesystem path. They are the only independent oracle over the kernel. `replicad-opencascadejs` stays a devDependency for them alone
- **Never add a `depth: 0` fixture**: hangs OCCT outright (SPEC-pocket-crossbody.md) — still live, the gates run OCCT
- **`reshape-script.ts` must NEVER be imported into the main app origin**: evaluation only inside the sandboxed iframe (reshape-script.ts:1576)
- **Do not touch `dependsOn` / `VOCABULARY`**: editing rejects the slice (SPEC-P1e, SPEC-P1g)
- **`topo` and `geom` must not import each other** (brep-rs/src/lib.rs:20)
- **Do not unify state-indicator vs message-color** (ReshapeStudio.tsx:1536)

## UNIQUE STYLES
- **Sandboxed script execution**: `packages/sandbox-dev/src/ReshapePreview.tsx` runs interpreter in `allow-scripts` without `allow-same-origin` iframe
- **Per-feature refusal contract**: `EngineBuildResult.refusals` maps feature id → reason; the UI surfaces it beside whatever did build, and does NOT retry on another engine — there isn't one
- **Referee, not dependency**: every gate fixture is built twice, on OCCT and on brep-rs, and compared against live-measured volumes — never a hardcoded number
- **Topology naming via "between" cause**: Edges named by two adjacent faces (topo-name.ts); survives boolean/transform
- **Sketch outline with basis corners**: Fillet points project through basis corner's anchor (HandleOverlay.tsx:projectOutline)

## COMMANDS
```bash
# Build (dependency order enforced)
npm run build

# Dev server (sandbox app)
npm run dev:sandbox

# Test (requires build first)
npm test

# Individual package test
npm test -w @shuff57/reshape-kernel
npm test -w @shuff57/reshape-script
npm test -w @shuff57/reshape-sketch
npm test -w @shuff57/reshape-studio

# Rust kernel rebuild -- REQUIRED before anything that loads the wasm,
# including packages/kernel's own test suite
cd packages/brep-rs && wasm-pack build --release --target web --out-dir pkg

# Gates: LEAD-OWNED, on demand, never part of npm test
node scripts/brep-parity-gate.mjs    # volume/bbox/faces vs OCCT
node scripts/brep-mesh-gate.mjs      # tessellation watertight + bounded
node scripts/brep-step-gate.mjs      # STEP export, read back by OCCT
npm run gate:occt                    # ModelDoc semantics, script text -> solid
```

## NOTES
- `packages/brep-rs` has NO package.json at root → not an npm workspace; its wasm is consumed by URL at runtime
- `packages/brep-rs/pkg/` is gitignored (`pkg/.gitignore` is `*`), so a fresh checkout has no wasm and the kernel suite cannot import it — measured: hide `pkg/` and that suite exits 1. CI builds it now (rustup target + wasm-pack + `cargo test --release`, before the JS build); **always build the wasm before running anything that loads it**
- **TWO SEPARATE FAILURE CLASSES, and the distinction decides priority.** (1) REFUSALS — shell beyond a box, a ROUND beyond a box, and a chamfer on a boolean result. These were masked by the OCCT fallback and are visible now; honest, and they need real kernel capability. **Do not trust this list without measuring it** — it went stale three times in one day and each time the slice had landed unrecorded. Counterbore is NOT a refusal: it cuts (`37c6091`). Countersink is NOT either: it cuts (`8abd28f`, exact at 31321.415986824602 = 32000-216π) and exports to STEP (`6cee4ba`, OCCT read-back at relative delta 0). A CHAMFER on any convex straight edge is NOT: `build_fillet`'s four paths were all prisms, and `f78f396` added a general convex-edge path via a coplanar wedge subtract (hex prism 5161.5114065552525 = 2980*sqrt(3)). What still refuses: a round beyond a box, because a ball blend is not a wedge; a chamfer on a boolean result, which is K2b and is gated on the K1a that failed its stop rule (msgbox #430); and tangency, which option (b) also cannot reach. (2) A SILENT WRONG SOLID — successive bores, and a subtracted tool's curved faces coming back unreversed. Both were ALWAYS wrong, before and after, because the fallback never fired for either. The bore-floor half is FIXED (`bfb211d`): `region_inside` (`ops.rs:532`, moved from 499) intersected a half-plane or disk from every face of `other`, which only holds while `other` is convex, so a prior bore's wall collapsed the region and `keep_disk` dropped the next floor; floors lost == prior-bore count, confirmed 6/6. The unreversed-face half is I-1, also fixed (`ops.rs:4178`): `flip_face` had arms for Plane and Cylinder only, so a Sphere/Cone/Torus tool face came back unreversed and the void's volume was ADDED — C6 measured 64523.5988 against 63476.4012, refusals empty, 0 open edges, so every guard waved it through. `flip_face` now returns `Option` and the fall-through is `None`. A third class-2 mechanism, an open shell passing the manifold guard, is also closed (K0c, translation-invariance guard). Class (2) outranks class (1): with no fallback, "never return a wrong solid" is all that protects a student
- The gates CAN see the bore-floor class now, as of `bfb211d`: `bores-blind-stacked` and `bore-through-then-blind` are blind multi-bore fixtures that build correctly (46812.478, parity rel delta 4.7e-16). What a differential gate still CANNOT see is a kernel that is wrong in the SAME WAY as OCCT — those two fixtures were green for months while both kernels shared the defect, so the gate agreed with itself. Parity reads 70 passed / 2 failed, and both reds are honest refusals of cases OCCT builds, not wrong solids
- `.omo/`, `.msgbox/`, `.codegraph/` are agent/tooling dirs, but not uniformly untracked: `.omo/notepads/` IS committed (the brep-rs campaign's memory), `.omo/run-continuation/` is gitignored, `.codegraph/` is excluded locally via `.git/info/exclude`
- `.msgbox/` also carries a file-claim protocol (`msg.mjs claim|release|owners`); check `owners` before editing a package another agent holds