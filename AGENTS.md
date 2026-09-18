# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-17

## OVERVIEW
Browser-first CAD: reSHape Script (2D sketches + 3D parts, JavaScript) over a headless FreeCAD kernel compiled to WebAssembly, with reSHape's own OCCT kernel as the fallback. Writes `.FCStd` that opens in desktop FreeCAD 1.1.3.

## STRUCTURE
```
reshape-cad/
├── packages/
│   ├── kernel/       # OCCT/FreeCAD/brep-rs EngineAdapters + shared types
│   ├── script/       # reSHape Script interpreter + emitters (replicad, FreeCAD Python)
│   ├── sketch/       # 2D sketch solver (constraints, arcs, outlines)
│   ├── studio/       # React UI (editor, viewer, timeline)
│   ├── engine/       # FreeCAD wasm loader + fc-* bridge (mixed .ts/.mjs)
│   ├── brep-rs/      # Independent Rust B-rep kernel (wasm via wasm-bindgen)
│   └── sandbox-dev/  # Vite dev harness for studio (only runnable app)
├── engine/           # FreeCAD wasm patch series + Docker toolchain (Track U)
├── scripts/          # Root gate scripts (brep-*, occt-*, check-*)
├── docs/             # Specs, schemas, spike reports
├── design/           # Mockups + UI-revamp specs
├── bench/            # Yardstick tasks + record.json
├── parity/           # FreeCAD PartDesign parity list
└── assets/icons/freecad/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Language/runtime changes | packages/script/src/reshape-script.ts | Interpreter core; `runScript()` entry |
| Code generation (replicad/FreeCAD) | packages/script/src/reshape-script-gen.ts | `toScript()` round-trip |
| Model types / document schema | packages/script/src/model-types.ts | `ModelDoc`, `Feature`, `SketchFeature` |
| Sketch solving | packages/sketch/src/sketch-solve.ts | Constraint resolution, DoF |
| Sketch outline/tessellation | packages/sketch/src/sketch-arc.ts | `tessellate()`, `arcFromBulge()` |
| Engine adapters (3 kernels) | packages/kernel/src/*-engine-adapter.ts | `EngineAdapter` interface + 3 impls |
| OCCT build pipeline | packages/kernel/src/occt-build.ts | Feature → OCCT shape |
| Topology naming/resolution | packages/kernel/src/topo-resolve.ts | `TopoName`, `resolveName()` |
| FreeCAD wasm session | packages/engine/src/fc-session.mjs | Portable `exec`/`read` channel |
| React UI / viewport | packages/studio/src/ | `ReshapeStudio`, `BrepViewportThree` |
| Rust B-rep kernel | packages/brep-rs/src/ | `lib.rs` module layering, `wasm.rs` exports |
| App entry / dev server | packages/sandbox-dev/src/main.tsx | `App` → `ReshapeStudio` |
| CI / build order | .github/workflows/ci.yml | Enforces sketch→script→engine→kernel→studio |
| Benchmarks / gates | scripts/*.mjs | `check-record`, `occt-modeldoc-gate` |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `runScript` | function | packages/script/src/reshape-script.ts:611 | 15+ | Interpreter entry; returns `RunResult` |
| `toScript` | function | packages/script/src/reshape-script-gen.ts:254 | 5 | Round-trip emitter (doc → source) |
| `solveDoc` | function | packages/script/src/model-codegen.ts:503 | 20+ | Full document solve (sketch + 3D) |
| `EngineAdapter` | interface | packages/kernel/src/engine-adapter.ts:109 | 11 | Kernel abstraction (build/mesh/name/save) |
| `FreeCadEngineAdapter` | class | packages/kernel/src/freecad-engine-adapter.ts:651 | 3 | FreeCAD wasm implementation |
| `OcctEngineAdapter` | class | packages/kernel/src/occt-engine-adapter.ts:63 | 3 | replicad OCCT implementation |
| `BrepRsEngineAdapter` | class | packages/kernel/src/brep-rs-engine-adapter.ts:81 | 3 | Rust wasm implementation |
| `build_doc_json` | wasm export | packages/brep-rs/src/wasm.rs:115 | 3 | Rust kernel build entry |
| `tessellate` | function | packages/sketch/src/sketch-arc.ts:608 | 10+ | Sketch → polyline points |
| `ReshapeStudio` | component | packages/studio/src/ReshapeStudio.tsx:187 | 1 | Main UI surface |
| `BrepViewportThree` | component | packages/studio/src/model/BrepViewportThree.tsx:519 | 1 | Three.js viewport + engine loader |

## CONVENTIONS
- **TypeScript**: `strict: true`, `isolatedModules: true`, ES2022, `moduleResolution: bundler`, `jsx: react-jsx` (tsconfig.base.json)
- **Exports**: Subpath exports only (`./model-types`, `./engine-adapter`); bare `.` re-exports minimal config
- **Build order**: Manual chain `sketch → script → engine → kernel → studio` (root package.json); `--workspaces` breaks on fresh checkout
- **Tests import from `dist/`**: `node --test "test/*.test.mjs"` runs against compiled output; must `npm run build` first
- **No linter/formatter**: No ESLint, Prettier, rustfmt, clippy — conventions enforced by `tsc` + written docs
- **Line endings**: LF enforced via `.gitattributes` for all text/code; `*.wasm`, `*.png`, `*.FCStd` marked binary
- **Rust**: Edition 2021, release profile `opt-level="z"`, `lto=true`, `panic="abort"` (size-optimized wasm)
- **Engine mode**: `getEngineMode()` from `packages/kernel/src/config.ts` gates UI; three kernels not interchangeable

## ANTI-PATTERNS (THIS PROJECT)
- **Do not edit gate scripts**: `scripts/brep-*.mjs`, `check-record.mjs`, `occt-modeldoc-gate.mjs` are LEAD-OWNED
- **Never return wrong solid silently**: Kernels must refuse per-feature with plain sentence (SPEC-brep-kernel-rs.md)
- **Do not offset helix profile from axis**: Causes 14-min kernel hang at 3.4GB (p1c3-test.mjs:172)
- **Never add `depth: 0` fixture**: Hangs OCCT outright (SPEC-pocket-crossbody.md, freecad-pocket-crossbody.manual.mjs)
- **`PullDirection` / `Reversed` never set**: Explicit references fail on this kernel build (fc-commands.mjs)
- **`lib/reshape-script.ts` must NEVER import into main app origin**: Evaluation only inside sandboxed iframe (reshape-script.ts:1576)
- **Do not touch `dependsOn` / `VOCABULARY`**: Editing rejects the slice (SPEC-P1e, SPEC-P1g)
- **`topo` and `geom` must not import each other** (brep-rs/src/lib.rs:20)
- **Never clear engine badge** (SPEC-studio-engine-badge.md:34)
- **Do not unify state-indicator vs message-color** (ReshapeStudio.tsx:1660)

## UNIQUE STYLES
- **Mixed source/dist exports**: `packages/engine` exports raw `./src/*.mjs` for fc-* bridge, but `./dist/*.js` for TS modules
- **Sandboxed script execution**: `packages/sandbox-dev/src/ReshapePreview.tsx` runs interpreter in `allow-scripts` without `allow-same-origin` iframe
- **Per-feature refusal contract**: `EngineBuildResult.refusals` maps feature id → reason; UI shows without crashing
- **Engine auto-fallback**: `BrepViewportThree` loads OCCT fallback when FreeCAD kernel refuses a doc
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

# Rust kernel rebuild
cd packages/brep-rs && wasm-pack build --release --target web --out-dir pkg

# Benchmark gates
node scripts/check-record.mjs bench/record.json
node scripts/occt-modeldoc-gate.mjs
```

## NOTES
- `packages/fcstd` listed in README does NOT exist — FCStd handling is in `kernel/freecad-engine-adapter.ts` + `studio/ReshapeStudio.tsx`
- Two `engine/` dirs: root `engine/` (wasm patch/Docker) vs `packages/engine/` (TS loader) — confusing naming
- `packages/brep-rs` has NO package.json at root → not an npm workspace; consumed by URL at runtime
- `packages/brep-rs/pkg/*.wasm` gitignored via `pkg/.gitignore` (`*`)
- `.omo/`, `.msgbox/`, `.codegraph/` are agent/tooling dirs, but not uniformly untracked: `.omo/notepads/` IS committed (the brep-rs campaign's memory), `.omo/run-continuation/` is gitignored, `.codegraph/` is excluded locally via `.git/info/exclude`
- Manual test files `*.manual.mjs` excluded from automated `node --test` runs