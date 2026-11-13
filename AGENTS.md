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
| Is what the layer builds right | docs/spikes/solidcraft-referee/sweep/ | Host-route sweep against OCCT and brep-rs; score-built.sh judges what each case builds; README says how to read a flagged row |
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
- **Tests run per package, and locally that is now real Node**: `node` is a shim that prefers a user-local Node 22 (`~/.local/share/node/current`) and falls back to Bun only when no Node is installed. With Node present, `npm test` and `npm run ci:local` run the package scripts as `node --test`. Bun's `node:test` shim refuses that runner, so on a box without Node the per-package `bun test test/*.test.mjs` form is the only one that works. Archived tests live in `packages/*/test/archived/`, outside the `test/*.test.mjs` glob
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
# Tests. CI and this box both run these; the suites and check-record are also
# wrapped by `npm run ci:local`, which `.githooks/pre-push` calls.
npm test

# Per package, and the only form that works when `node` has fallen back to Bun
# (Bun's node:test shim refuses `node --test`):
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
- SolidCore status page: tangency-labs.github.io/solidcore (regenerated on every merge). On 2026-10-18 it showed 113 of 261 units green, boolean 31%, offset 32%, primitive 8%, blend 3%, version 0.0.x. On 2026-10-25 (commit 216cd66d) it showed 250 of 262 units green, 12 partial, 94.0% of lines green, every module 100% ported, 9 of 9 primitives building, and no version number. "Green" means it matches the C++ SMLib, not that it is correct: the page's own surface/surface intersection corpus shows upstream returning wrong topology on some cases. Wasm API completeness and speed are not on the page, so an `EngineAdapter` spike is still needed. Re-check periodically (plan phase 5)
- The pin: SolidCraft v0.30.1 (8e2b0cd6, truck), unmodified, since 2026-11-09, by owner decision against the Stage B recommendation (docs/spikes/solidcraft-referee/remeasure-0.30.1/REMEASURE-0.30.1.md, "Owner decision"). It was 0.21.0 "corrected", where corrected meant only our wrapper's build settings (upstream's release profile and root `[patch]` block, not the spike's opt-level "z" without the truck-geometry patch). The time-budget kernel is `packages/solidcraft-host/kernel/build.sh`; it now also copies in upstream's Cargo.lock. Rig: `~/.cache/solidcraft-0.30.1-rig` (sc-src, sc-referee-pkg, sc-referee-pkg-topology, student-preview); web build: `~/.cache/solidcraft-0.30.1/src/dist/web`. Test scripts take `SOLIDCRAFT_PIN` (default 0.30.1) for their default rig and output names. Evidence files named `*-0.21.0.*` are records of the old pin, not the pin
- Known truck defects the guard layer must cover: shell families A and B (wall or ligament between t and 2t), n7, n17b, the tangency residual, and the sketch contact gap (6e-5 to 1.3e-4 mm). Source: docs/spikes/solidcraft-referee/HANDOFF.md. New on 0.30.1, each refused only because a guard covers it: shell family C (a box with its bottom edges rounded R = 1.5t, hollowed open at the top, built 1.1e-3 to 5.7e-3 off; the hollow check, GUARD-FAMILY-C-HOLLOW.md), the welded open outline (an outline open by 1e-5 mm is closed by the kernel and built; GUARD-OPEN-OUTLINE.md), and a keep() that comes out bigger than its operands (`r6h-top-keep-r120-d5`, G19). Failing hollows can run for minutes (4 fuzz shells past 600 s); hollows now run under the 45 s time budget. Also new, each refused only because a guard covers it: a hollow after a counterbore or countersink whose mouth is 1 to 2 walls from a side wall (built 2.3 to 5.5% off; G-HOLE now measures from the mouth, HALT-7.md), and a hollow that opens the face a countersink is on (built up to 3.3% low near a corner; G-CSOPEN, HALT-8.md). In the page, any face pick on a part with a countersink is refused, because the bridge cannot verify a pick point beside a cone face. Fixed on our side 2026-11-12 (HALT-9.md): the page paired each draft's from: record by position, so a draft after a draft the page left out was judged by the wrong record and a from:'bottom' draft on a moved part was built about a stale plane. Also new, refused only because a guard covers it: a counterbore or countersink hole also cuts a second part that sits on, under or in the path of the drilled part, whichever of the two was made first (a part on top or underneath lost 0.1 to 3.6% of its volume, a peg standing in the hole 80 to 86%; G-OTHERS compares every other part before and after the cut, GUARD-TWO-PARTS.md). Found 2026-11-13 by the first run of the corpora in the real page: a pocket that makes the engine panic (`fc combined seed 215`, truck-geotrait curve.rs:78) left the page waiting for ever, because upstream's API never answers after a wasm trap; the page now rejects the waiting calls, refuses the step in its own sentence and loads SolidCraft again (`packages/solidcraft-host/src/crash-guard.mjs`). And the engine does not repeat a round to the last digit: two runs of the same commands differ by up to 1.5e-14 of the volume and list the faces in another order, so nothing may compare two engine runs of a rounded part for equality (pilot-2026-11b/PILOT-2.md). Fixed on our side 2026-11-13: the page refused every cylinder hollowed with its top or bottom open, because the pick-point check boxed a curved edge by upstream's three points and upstream's own pick point of the cap fell outside (`edgeBox` in `packages/solidcraft-host/src/upstream-bridge.mjs`); the corpora are now also swept in the real page, not only in Node (pilot-2026-11b/PILOT-2.md, 'The corpora in the real page': 4739 of 4784 rows identical to Node, the rest explained). The OCCT referee (`packages/brep-adapter/src/occt-build.ts`) reads `reversed`, `midplane`, `length2`, `taper` and `through` on a pull or pocket since 2026-11-13 and refuses the combinations it does not build (a custom direction, a taper with a two-sided or through sweep); before that it built a plain prism instead. Since the same day it also cuts a hole's counterbore or countersink and tilts every wall of a whole-body draft (it drilled the plain bore and tilted two walls of four before). It still rounds the wall of a hollow at an inside corner where the page's plane offset is sharp (0.36% apart after a counterbore; HALT-7.md fixed the plane offset as the reference), and a step built on a step the referee refused must be scored as the referee saying nothing, which the sweep in docs/spikes/solidcraft-referee/sweep/ does (the rig's older harness copies do not) (pilot-2026-11b/PILOT-2.md, 'The referee's remaining gaps'). The generated corpora score only a document's last step, which is usually refused: cut a document down to its built steps before scoring (39 final solids judged before, 1411 after, on 1500 new documents, no wrong solid)
- `.omo/`, `.msgbox/`, `.codegraph/` are agent/tooling dirs, but not uniformly untracked: `.omo/notepads/` IS committed, `.omo/run-continuation/` is gitignored, `.codegraph/` is excluded locally via `.git/info/exclude`
- `.msgbox/` also carries a file-claim protocol (`msg.mjs claim|release|owners`); check `owners` before editing a package another agent holds. Claims on `packages/brep-rs/src` and `docs/specs/census` are stale and should be released
