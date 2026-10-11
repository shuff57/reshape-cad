# Architecture v2: FreeCAD's Part Design loop on reshape-cad

Written 2026-10-09, replacing `v1/architecture.md` after two reviews rejected it (`REVIEW-RESPONSE.md` maps every
finding). Planning only: nothing here is built, and nothing in this folder edits a repo file. Every claim about the
repo below was checked against the file and line cited today; the one thing that was measured rather than read is
marked MEASURED.

Scope is the recon's slice (`recon.md`): Sketcher -> Part Design features -> tree / recompute -> parameters ->
STEP / STL -> 3D view and selection. One body per document.

## 0. The decision: one source of truth, Rust only where references need history

v1 proposed a Rust core (document, expressions, solver, recompute, files, eight crates, SQLite, Tauri) under the
studio. Both reviews rejected it, and the repo agrees with them:

- `packages/studio/src/ReshapeStudio.tsx:9-16` states the contract: `script.js`'s text is the single source of
  truth a caller persists; Build writes it through `toScript()`, Code edits it directly, and a lesson mounts the same
  component. A second canonical document beside it is the "two engines" anti-pattern one level up.
- Parameter binding already exists: `param()` in the script, correlated to doc slots by `ScriptParamRef.slots`
  (`packages/script/src/reshape-script-gen.ts:69`) and re-emitted by `paramBindings()` (`:235`).
- The recon's own size estimate puts the risk in the kernel's `partial` rows, not in the app layer.

So v2 keeps the shape the repo has and adds to it additively:

```
script.js  --runScript() in the sandboxed iframe-->  ModelDoc (+ namedParams)
           --lowerForBuild() (TS, pure)-->            ModelDoc the kernel sees
           --build_doc_json (brep-rs, resolves history-dependent fields inside build_doc)--> shapes + refusals
           --deriveStates() (TS, over dependsOn)-->   UpToDate | Invalid(sentence) | Stale per feature
           --mesh / pick / measure / export-->        only while nothing up to Tip is Invalid or Stale
```

Body, Origin and Tip are UI concepts over the ordered feature list. There is no `Document` type, no migration, no
app-local store (`v1/schema.sql` is history; v2 needs no store, see section 7).

### How much of v2 is Rust, and what the user gives up against v1

| layer | v1 | v2 | why |
| --- | --- | --- | --- |
| B-rep kernel | Rust (`packages/brep-rs`) | Rust, unchanged location; every new capability lands here | the one kernel; the gates measure `brep-rs/pkg` (`scripts/brep-parity-gate.mjs:82-83`) and the app serves the same `pkg` (`packages/sandbox-dev/vite.config.ts:14-15`) |
| history-dependent references (pocket through-all, sketch on a face that follows edits, up-to-face) | Rust `reshape-features` crate as a pre-pass | Rust, as additive JSON fields resolved INSIDE `build_doc` against `History` | they need the built prefix; `resolve_name(&hist, ..)` (`wasm.rs:3591`) is the existing mechanism, used by the fillet arm at `wasm.rs:2211` |
| 2D constraint solver | Rust, `packages/sketch` retired | Rust for soup sketches (`brep-rs/src/sketch`, driven by `packages/kernel/src/sketch-session.ts`); the TS solver stays for legacy `points`+`constraints` sketches | `reshape-script.ts:101-109` imports `solveSketch`; `model-codegen.ts:633-636` runs it on every adoption; `rect()` itself writes the legacy form (`reshape-script.ts:1237-1258`). Retiring it is a semantic migration, deferred behind a differential sweep |
| document model | Rust `Document`, schema 2 | TypeScript `ModelDoc`, extended additively (`tip`, `suppressed`) | one source of truth; `dependsOn`/`VOCABULARY` pinned (`SPEC-P1e-pocket-word.md:118`) |
| expressions / units | Rust `reshape-expr`, unit-aware | none new: a slot binds to a `param()`; the script is JavaScript, so Code mode already has full expressions | expressions beyond a plain param reference are deferred (section 5) |
| recompute states | Rust `reshape-recompute` | TypeScript over `dependsOn()` | re-deriving the dependency rule in Rust would fork a pinned function |
| tree / panels / property grid | TypeScript | TypeScript | it is React |
| files | `.reshape` zip, SQLite, IndexedDB | `script.js` text, as today | the document IS the script |
| desktop | Tauri 2 | none | deferred |

Plainly: v2 adds Rust only inside `packages/brep-rs`, and everything a FreeCAD user sees (tree, task panels,
property grid, parameter panel, states) is TypeScript. The user gives up, relative to v1: a Rust document model, a
unit-aware expression language, a single-wasm core, a native desktop app, a zip document format and crash-recovery
snapshots. What is kept is the thing the recon said matters: the hours go to the kernel's `partial` rows, every
gate and fixture keeps working untouched, and no second truth appears.

## 1. Stack

| layer | choice | why |
| --- | --- | --- |
| kernel | `packages/brep-rs`, the only crate, built by `wasm-pack` into `pkg/` | one kernel, no fallback; the gates and the app load the same binary |
| interpreter | `packages/script/src/reshape-script.ts` in the sandboxed iframe | unchanged; never imported into the main origin (`reshape-script.ts:1576` region, AGENTS.md) |
| document | `ModelDoc` + `namedParams`, persisted as `script.js` | one source of truth |
| lowering | `packages/script/src/model-lower.ts` (new, pure TS) | tip truncation, suppressed removal with re-targeting, pattern-of-feature expansion, fillet-set rule |
| states | `packages/script/src/model-states.ts` (new, pure TS, over `dependsOn`) | Invalid, Stale, UpToDate; the export gate reads it |
| UI | `packages/studio` extended | tree with Body / Origin / Tip, task panels, property grid, params panel binding |
| export | STL / OBJ / 3MF through `packages/studio/src/mesh-export.ts` (`writeSTL` at `:163`, `writeOBJ` at `:194`); STEP through the kernel's `export_step` | all exist today; v2 adds the gate and the STEP button |
| tests | `cargo test` in brep-rs; `node --test` suites in each package against `dist/`; the four lead-owned gates on demand | unchanged |
| hosting | the browser, as today | |
| server / auth / payments / email / jobs / store | none | local tool |

## 2. ModelDoc, extended additively

All new fields are optional so every existing fixture, census script and gate reads unchanged.

```ts
interface ModelDoc { version: 1; features: Feature[]; tip?: string }   // tip absent = last feature
interface Feature  { ...; suppressed?: true }                           // on every kind
```

Bindings are not a new field: a bound slot is a `param()` declaration in `script.js`, carried at run time as
`RunResult.namedParams` (`reshape-script.ts:150-159`) and re-emitted by `toScript(doc, namedParams)`. Build mode's
`fx` control writes a `namedParams` entry for a slot; nothing else changes.

Kernel-side additive fields (resolved inside `build_doc`, never by the TS layer, because they need `History`):

```ts
interface PocketFeature { ...; through?: true }            // tool height from the built target's extent along the sketch normal
interface SketchFeature { ...; frameFrom?: TopoName }      // a face name; resolved to a frame at build time, so it follows edits
interface ExtrudeFeature { ...; upTo?: TopoName }          // should-priority; planar faces only, else refuse
interface PocketFeature  { ...; upTo?: TopoName }
```

Each one refuses in a sentence when the name does not resolve, the face is not planar, or the extent cannot be
proven, and records history (`record_op`) so a later fillet still finds its edge. The `frame` field keeps working
for every saved sketch; `frameFrom` wins when both are present.

## 3. Body, Origin, Tip over the feature list

- **Body** is the document. One per `script.js`; a second body is refused with "one body per document for now".
- **Origin** is the three named planes (`'top'`, `'front'`, `'side'` in the script, `xy`/`xz`/`yz` in the doc) and
  the `datum` features. The tree shows them under Origin; none of them is a kernel object (datum is a kernel no-op,
  `features.csv:74`).
- **Tip** is `doc.tip`. The body's shape at Tip is `hist.shapes[tip]`, because every feature inserts its result under
  its own id (`history.rs:116-119`); so one build serves the whole tree and the viewport meshes `mesh_feature(doc,
  tip)`. Features after Tip stay in the list, keep their states, and are drawn greyed.
- **Insert after Tip** is a doc operation: `insertAfter(doc, tipId, feature)` re-targets the next feature in the
  same chain from `tipId` to the new id, then `toScript()` writes the script. The emitted script chains through
  handle variables, so the inserted line reads naturally.
- **Suppress** is `suppressed: true`; `lowerForBuild` removes the feature and re-targets its consumers to its own
  target, the same re-targeting `insertAfter` uses in reverse.

## 4. Lowering rules

`lowerForBuild(doc) -> ModelDoc` is pure and total over the fields above. Everything history-dependent is NOT here;
it is a kernel field (section 2). The rules the reviews forced:

| FreeCAD feature | lowers to | refuses in lowering (a sentence beside what built) |
| --- | --- | --- |
| Pad, one side | `extrude` and, when the body already has a solid, `combine { union }` with the current head | |
| Pad reversed | `datum` offset by `-h` then `extrude h` (pure arithmetic on the frame) | |
| Pad symmetric | `datum` offset by `-h/2` then `extrude h` | |
| Pad two sides | two extrudes and a `combine { union }` | the join may refuse in the kernel; its sentence is surfaced |
| Pocket blind | `pocket { target, into, depth }` | |
| Pocket through all | `pocket { through: true }` (kernel field) | |
| Hole | `hole { center, axis, diameter, depth, counterbore?, countersink? }` (`model-types.ts:522-571`); "through" is depth = extent + 2, the same sugar `throughDepth` uses (`reshape-script.ts:1720-1728`) | extent not provable; drill point, tapered, modeled thread |
| Fillet / Chamfer, N edges | N `fillet` features in order, one edge each (`FilletFeature.edge` is one name, `model-types.ts:621`) | ROUND sets whose edges share a vertex refuse ("rounds that meet at a corner are not built yet; round them one at a time"); CHAMFER sets allowed only after the referee fixture in `build-order.md` M0 shows sequential equals simultaneous |
| Linear / polar pattern OF A FEATURE | N copies OF THAT FEATURE: a hole becomes N chained `hole` features with the centre offset transformed; an additive feature becomes N sketches with transformed frames, N extrudes and unions. Ids are synthetic and stable: `${patternId}~${i}` | anything the kernel `pattern` would be asked to do: the kernel's `pattern` copies the WHOLE target solid and unions the copies (`wasm.rs:2052-2130`), so a polar pattern of a hole through it would refill the holes. The kernel `pattern` stays for the script's `repeat()`, whose semantics are whole-solid |
| Mirrored OF A FEATURE | the same expansion with a reflection | non-base planes |
| Revolution / Groove | `revolve` / `groove` | axis other than world Z (today) |
| Thickness / Draft / Loft / primitives / Boolean | `shell` / `draft` / `blend` / primitives + `combine` | per the kernel's rows |

Nothing in lowering approximates. A row the kernel cannot build ships with the kernel's sentence.

## 5. Parameters and expressions

- A FreeCAD `fx` on a quantity is, in v2, a binding of that doc slot to a `param()`: the params panel
  (`ReshapeParamsPanel`) already shows every named param as a slider, and `toScript` already emits the declaration
  once and the variable at every bound slot. M1's exit test uses exactly this.
- Expressions beyond a plain reference (`thick * 2`, `Params.width + 1 mm`) are DEFERRED. The interpreter correlates
  a param to a slot through the boxed `Number` it returns (`reshape-script.ts:335-345`); an arithmetic result is a
  plain number and the correlation is lost (`:826`), so a Build-mode expression would not survive `toScript`. If an
  expression field is added later it is an additive sidecar of slot -> JavaScript text (arithmetic, `Math.*`,
  identifiers), emitted verbatim, evaluated by the script itself because the script is JavaScript. Units are deferred
  with it. Code mode has full JavaScript today.
- Cycle detection is moot under this model: a `param()` is a literal, and JavaScript's own `const` ordering refuses a
  forward reference with a sentence the student already sees.

## 6. States and the export gate

- Inputs: `EngineBuildResult.refusals` (feature id -> sentence) and `dependsOn()` (`model-types.ts:709`).
- **Invalid(sentence)**: the feature has a refusal.
- **Stale**: the feature's chain passes through an Invalid feature, OR its target was refused. The second case
  matters because the kernel drops a feature whose target is missing WITHOUT a sentence of its own: the hole arm
  (`wasm.rs:1392-1394`) and the fillet arm (`wasm.rs:2206-2208`) both read "OCCT does nothing at all when the target
  is missing" and `continue`. And a refused cut never calls `advance_head` (`history.rs:129`; the Oracle's `:123` is `head_of`), so a later feature
  that names the body by its original id builds on the un-cut body.
- **UpToDate**: neither.
- **Export, measure and the body-at-Tip mesh refuse** while any feature up to Tip is Invalid or Stale, with the first
  sentence. Today `exportSTL` (`ReshapeStudio.tsx:1086-1089`) writes `meshRef.current` with no check; v2 gates it.
  This is the per-feature refusal contract carried to the file: never a wrong solid on disk.
- FreeCAD keeps last-good shapes downstream of an invalid sketch and calls them up to date (recon F07); v2's Stale is
  the behavioural improvement the recon asked for.

## 7. Files

`script.js` text, as today (`localStorage` in the sandbox, a download or a lesson's saved artifact). No `.reshape`
zip, no SQLite, no IndexedDB tables; `v1/schema.sql` is history and nothing in v2 needs a store. Recent files,
thumbnails and autosave snapshots are deferred with the desktop shell. `.FCStd` is neither read nor written, for the
clean-room reason in `v1/architecture.md` section 7, which still stands (`docs/clean-room/README.md`). STEP is the
interchange both ways: export live (gate 78/78), import planar-only.

## 8. The parts that bite

- **Panic containment.** `panic = "abort"` (`packages/brep-rs/Cargo.toml:22`) means a kernel panic traps the wasm
  instance; there is no `catch_unwind` in `wasm.rs`, and the instance holds state (`thread_local!` at `wasm.rs:27-29`
  for the build cache, `:186-190`, and the sketch session at `:8662`). The canonical document is already outside the
  instance (it is `script.js`), so containment is: keep the compiled `WebAssembly.Module`, catch the `RuntimeError`
  in `BrepRsEngineAdapter`, re-instantiate synchronously with `initSync({ module })` (the kernel test suite already
  loads this way), reopen the sketch session from its rows (by design: `sketch-session.ts:1-6`), then rebuild the doc
  one feature prefix at a time to find the feature that trapped and report it as Invalid with "the kernel crashed
  building <id>; it was restarted". A Worker is not needed for this, and the adapter's synchronous API stays. No root
  Cargo profile change is involved because v2 has no workspace (the Momus 3 hazard is recorded in `REVIEW-RESPONSE.md`
  for the day one appears).
- **Topological naming.** The failure is mis-resolution, not only non-resolution: a split piece is told apart by a
  point in the parent's parameter space (`topo-name.ts:30-41`), which can pick another piece after a large edit. The
  1-to-N pattern expansion embeds synthetic ids in names, so they must be stable across runs (they are, by
  construction from the pattern id and index). M0 adds fixtures that check the RESOLVED EDGE GEOMETRY (centroid,
  length) after a face-splitting edit, not just that a name resolved. M1's thick 8 -> 12 test exercises cap names only
  and says so.
- **The lowering referee.** Lowering is a second place a wrong solid can come from. Every lowering rule in section 4
  ships with a closed-form fixture (volume and bbox computed by hand) run through the real kernel, and a request to
  the lead for the same fixture in the parity gate so OCCT referees it. Nothing in `scripts/` is edited by this plan.
- **Two sketch solvers** stay until a differential sweep (TS vs Rust over the census and the lesson sketches) shows
  zero disagreement; a disagreement refuses.
- **wasm size.** MEASURED 2026-10-09 on the `pkg/` built 08:03: 1,502,764 bytes raw, 564,943 bytes gzipped at the
  default level (`gzip -c pkg/brep_rs_bg.wasm | wc -c`); the parity gate prints the level-9 figure. Budget 7,250,252
  (`packages/brep-rs/AGENTS.md:38`). The kernel suite gains a test that fails above a recorded ceiling.
- **The iframe rule.** Found while verifying Momus 2 and not acted on: `ReshapePreview.tsx:15` says the iframe runs
  WITHOUT `allow-same-origin`, and `:100` sets `sandbox="allow-scripts allow-same-origin"`. One of them is wrong;
  flagged for the user, outside this plan's folder.

## 9. Kernel work, from `features.csv`

Unchanged rule: the `brep_rs` column decides, re-measured before any item starts (`AGENTS.md`: counts go stale within
a day). The ranked list, re-sized per the reviews, is `build-order.md` section 6. The one change in kind: fillet on
general edges is a time-boxed research spike with a stop rule, not a scheduled slice, because K1a stopped at its own
stop rule (`docs/kernel-campaign.md:1416`) and the 2026-10-09 design read says `process_face` is a case library with no
general framework to extend (`docs/specs/PLAN-kernel-next-2026-10-05.md:192`). S05's UX is designed assuming a fillet
after a pocket keeps refusing.
