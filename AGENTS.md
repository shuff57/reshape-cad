# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-17. **Rewritten for the SolidCraft layer:** 2026-10-17 (see docs/PLAN-scripting-layer.md).

## OVERVIEW
Browser-first CAD scripting: reSHape Script (2D sketches + 3D parts, JavaScript) running as a layer on SolidCraft. The language, the sketch solver and the translator are ours. The B-rep kernel is not: today it is SolidCraft's engine (truck), expected to move to SolidCore (a Rust port of NVIDIA's SMLib) as that matures. Our own kernel, brep-rs, is retired and lives in `archive/` as an independent oracle only.

The layer's one promise: **never a silently wrong solid**. A feature the layer cannot build correctly is refused in one plain sentence, alongside whatever did build. The kernel underneath does not keep that promise by itself, so the guard layer does.

## STRUCTURE
```
reshape-cad/
├── packages/
│   ├── script/       # reSHape Script interpreter, ModelDoc, round-trip emitter (ours, keep)
│   ├── sketch/       # 2D sketch solver (constraints, arcs, outlines) (ours, keep)
│   ├── brep-adapter/ # EngineAdapter seam; the brep-rs impl is retired, a SolidCraft impl replaces it
│   ├── studio/       # React UI -- library, not an app (status pending: plan open decision 1)
│   └── sandbox-dev/  # Vite harness mounting studio; frozen until the front-end decision
├── archive/          # RETIRED, not built or tested: brep-rs kernel, kernel-campaign specs. See archive/README.md
├── scripts/          # LEAD-OWNED gates; frozen, they point at the archived kernel
├── docs/             # Plans, specs, spike reports; docs/replica kept in place as reference data
│   └── spikes/solidcraft-referee/  # the SolidCraft work: translator, bridge, host page, fuzz oracle
├── design/           # Mockups + UI-revamp specs
├── bench/            # Yardstick tasks + record.json
└── assets/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| The plan | docs/PLAN-scripting-layer.md | Phases, parked work, open decisions |
| Language/runtime changes | packages/script/src/reshape-script.ts | Interpreter core; `runScript()` entry |
| Code generation (round-trip) | packages/script/src/reshape-script-gen.ts | `toScript()` doc → source |
| Model types / document schema | packages/script/src/model-types.ts | `ModelDoc`, `Feature`, `SketchFeature` |
| Sketch solving | packages/sketch/src/sketch-solve.ts | Constraint resolution, DoF |
| Sketch outline/tessellation | packages/sketch/src/sketch-arc.ts | `tessellate()`, `arcFromBulge()` |
| Script to SolidCraft | docs/spikes/solidcraft-referee/phase0/translate.mjs | Translator, ModelDoc to SolidCraft commands |
| Bridge / host page | docs/spikes/solidcraft-referee/phase1..7 | Spike grade; a patch against upstream solidcraft-web |
| Wrong-solid oracle | docs/spikes/solidcraft-referee/fuzz/ | Test harness for the guard layer |
| Adapter seam | packages/brep-adapter/src/engine-adapter.ts | `EngineAdapter`, `EngineBuildResult`, `FaceRange` |
| Retired kernel | archive/brep-rs | Oracle only. Restore: `git mv archive/brep-rs packages/brep-rs` |
| React UI / viewport | packages/studio/src/ | `ReshapeStudio`, `BrepViewportThree` (loads the retired kernel) |
| App entry / dev server | packages/sandbox-dev/src/main.tsx | `App` → `ReshapeStudio`; frozen |
| CI / build order | .github/workflows/ci.yml | Repointed to archive/brep-rs, not re-run since the move |
| Gates | scripts/*.mjs | Frozen; need a symlink to the archive, see COMMANDS |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `runScript` | function | packages/script/src/reshape-script.ts:611 | 15+ | Interpreter entry; returns `RunResult` |
| `toScript` | function | packages/script/src/reshape-script-gen.ts:254 | 5 | Round-trip emitter (doc → source) |
| `solveDoc` | function | packages/script/src/model-codegen.ts:503 | 20+ | Full document solve (sketch + 3D) |
| `EngineAdapter` | interface | packages/brep-adapter/src/engine-adapter.ts:95 | — | The kernel seam; build/mesh/edges/name/measure |
| `FaceRange` | interface | packages/brep-adapter/src/engine-adapter.ts:66 | 3 | Face → index-buffer range; survives a re-mesh |
| `BrepRsEngineAdapter` | class | packages/brep-adapter/src/brep-rs-engine-adapter.ts:80 | 2 | RETIRED implementation; a SolidCraft one replaces it |
| `tessellate` | function | packages/sketch/src/sketch-arc.ts:608 | 10+ | Sketch → polyline points |
| `ReshapeStudio` | component | packages/studio/src/ReshapeStudio.tsx:184 | 1 | Main UI surface |
| `BrepViewportThree` | component | packages/studio/src/model/BrepViewportThree.tsx:448 | 1 | Three.js viewport + kernel loader (loads the retired kernel) |

Line numbers are from 2026-09-17 and may have drifted.

## CONVENTIONS
- **TypeScript**: `strict: true`, `isolatedModules: true`, ES2022, `moduleResolution: bundler`, `jsx: react-jsx` (tsconfig.base.json)
- **Exports**: Subpath exports only (`./model-types`, `./engine-adapter`); bare `.` re-exports minimal config
- **Build order**: Manual chain `sketch → script → brep-adapter → studio` (root package.json); `--workspaces` breaks on fresh checkout
- **One adapter seam, kernel behind it**: everything that builds a solid goes through `EngineAdapter`. Nothing outside the adapter names a kernel. Swapping truck for SolidCore must touch the adapter only
- **No fallback engine**: a shape the current kernel cannot build correctly is refused per feature, in a sentence. It is not retried elsewhere. `config.ts` exports only the base URL and a `getEngineMode()` must not exist (pinned by `packages/brep-adapter/test/config.test.mjs`)
- **Upstream stays unmodified**: SolidCraft and SolidCore are pinned to a commit and never forked or patched by us. Defects are handled on our side of the seam. Patch files stay under `docs/spikes/` and are not applied
- **Tests run with `bun test`**: `node` on this box is Bun 1.4.2, so `npm test` does not run. Archived tests live in `packages/*/test/archived/`, outside the `test/*.test.mjs` glob
- **No linter/formatter**: No ESLint, Prettier — conventions enforced by `tsc` + written docs
- **Line endings**: LF enforced via `.gitattributes` for all text/code; `*.wasm`, `*.png` marked binary

## ANTI-PATTERNS (THIS PROJECT)
- **Never return a wrong solid silently**: with the kernel outside our control, the guard layer is the only thing between a student and a wrong part. Pre-flight rules refuse known-bad classes; a post-build check against an independent measure catches the rest. Built-or-refused is the only acceptable outcome
- **Do not edit `archive/`, and do not delete it**: brep-rs is the only independent oracle over the kernel. `replicad-opencascadejs` stays a devDependency for the OCCT referee apparatus (`packages/brep-adapter/src/{occt-build,occt-mesh,topo-resolve}.ts`, `packages/script/src/topo-history.ts`), which has no importer and is loaded by the frozen gates from `dist/` by path
- **Do not bless goldens or measured numbers without a second oracle**: a differential check cannot see a kernel that is wrong the same way as its reference
- **Do not fork or patch upstream SolidCraft/SolidCore**: see CONVENTIONS
- **Nothing is pushed, filed or posted without the owner approving the exact text**: applies to upstream issues and PRs too
- **Do not edit gate scripts**: `scripts/brep-*.mjs`, `check-record.mjs`, `occt-modeldoc-gate.mjs` are LEAD-OWNED and frozen
- **`reshape-script.ts` must NEVER be imported into the main app origin**: evaluation only inside the sandboxed iframe (reshape-script.ts:1576)
- **Do not touch `dependsOn` / `VOCABULARY`**: editing rejects the slice (SPEC-P1e, SPEC-P1g)
- **Do not unify state-indicator vs message-color** (ReshapeStudio.tsx:1536)

## UNIQUE STYLES
- **Sandboxed script execution**: `packages/sandbox-dev/src/ReshapePreview.tsx` runs interpreter in `allow-scripts` without `allow-same-origin` iframe
- **Per-feature refusal contract**: `EngineBuildResult.refusals` maps feature id → reason; the UI surfaces it beside whatever did build, and does NOT retry on another engine
- **Referee, not dependency**: a gate fixture is built on the kernel under test and on an independent oracle (OCCT, brep-rs) and compared against live-measured volumes — never a hardcoded number
- **Topology naming via "between" cause**: Edges named by two adjacent faces (topo-name.ts); survives boolean/transform
- **Sketch outline with basis corners**: Fillet points project through basis corner's anchor (HandleOverlay.tsx:projectOutline)

## COMMANDS
```bash
# Tests (Bun; per package). `npm test` does not run on this box.
(cd packages/sketch && bun test test/*.test.mjs)
(cd packages/script && bun test test/*.test.mjs)
(cd packages/studio && bun test test/*.test.mjs)

# SolidCraft spike: see docs/spikes/solidcraft-referee/phase*/run.sh and README.md

# Oracle / gates (frozen): symlink the archive first, remove the link afterwards
ln -s ../archive/brep-rs packages/brep-rs
node scripts/brep-parity-gate.mjs
node scripts/brep-mesh-gate.mjs
node scripts/brep-step-gate.mjs
```

## NOTES
- `archive/brep-rs/pkg/` is gitignored wasm output (`pkg/.gitignore` is `*`). Rebuilding it needs `cd archive/brep-rs && wasm-pack build --release --target web --out-dir pkg`
- The two failure classes of any kernel decide priority: (1) REFUSALS, which are honest; (2) a SILENT WRONG SOLID, which is not. Class (2) outranks class (1). The long brep-rs history of both is in `archive/brep-rs/AGENTS.md` and `archive/docs/specs/`
- SolidCore status page: tangency-labs.github.io/solidcore (regenerated on every merge). On 2026-10-18 it showed 113 of 261 units green, boolean 31%, offset 32%, primitive 8%, blend 3%, version 0.0.x. Re-check periodically (plan phase 5)
- Known truck defects the guard layer must cover: shell families A and B (wall or ligament between t and 2t), n7, n17b, the tangency residual, and the sketch contact gap (6e-5 to 1.3e-4 mm). Family C is unverified. Source: docs/spikes/solidcraft-referee/HANDOFF.md
- `.omo/`, `.msgbox/`, `.codegraph/` are agent/tooling dirs, but not uniformly untracked: `.omo/notepads/` IS committed, `.omo/run-continuation/` is gitignored, `.codegraph/` is excluded locally via `.git/info/exclude`
- `.msgbox/` also carries a file-claim protocol (`msg.mjs claim|release|owners`); check `owners` before editing a package another agent holds. Claims on `packages/brep-rs/src` and `docs/specs/census` are stale and should be released
