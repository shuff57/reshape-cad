# SPEC: make packages/studio (via sandbox-dev) the canonical sandbox

Status (2026-09-11): phase 1 DONE (commit 79ab6c0) -- sandbox-dev has a
real Code side, verified via bowser. Phase 2 (pattern support) in progress.

## 0. Decision

User request: "the whole point is to use freecad as the engine for 2D and 3D"
led to discovering two competing studio UIs: `engine/play/studio.html` (the
original vanilla-JS FreeCAD prototype) and `packages/studio` (the React
component library, wired through `packages/sandbox-dev`, currently mounted
with `sides={['build']}` only and stub Code-side components).

Decision (2026-09-11): **full feature parity port, then retire
`studio.html`.** packages/studio becomes the one sandbox going forward.

## 1. Findings (feature-dev:code-explorer, 2026-09-11)

The premise that packages/studio was missing most of studio.html's features
was wrong. Per-feature status, read-only investigation, no code changed:

| Feature | Status | Notes |
|---|---|---|
| Sketch constraint toolbar | **EXISTS**, richer | `SketchConstraints.tsx` on `packages/sketch/src/sketch-solve.ts` (in-house 2D solver), translated to real `Sketcher::Constraint`s via `packages/engine/src/sketch-translate.ts`. Covers every studio.html constraint; "Coincident" is implicit (closed-polygon topology + `lock`). |
| Face/edge picking | **EXISTS** for primitives, **PARTIAL** for sketch-derived solids | `BrepViewportThree.tsx` raycasts and highlights unconditionally. Naming (needed to build Fillet from a pick) only resolves for box/cylinder primitive faces/edges today (`freecad-engine-adapter.ts:710-786`); sketch-derived walls/caps resolve `null`, handled gracefully (try/catch already in place), not a crash. |
| Fillet/Chamfer | **EXISTS** in UI/model, **PARTIAL** in engine | Same primitive-only ceiling as picking, since it needs a named edge. |
| Pattern (linear/polar) | UI+model **EXIST**, adapter **MISSING** | `ModelEditor.tsx` has full UI + `PatternFeature` in `model-types.ts`; `freecad-engine-adapter.ts` has no `'pattern'` branch — throws today. |
| History list | **EXISTS**, richer | Dependency-aware delete, undo/redo, per-row detail — no drag-reorder, same as studio.html. |
| Run Script | **EXISTS**, but `CodeEditor`/`ReshapePreview` are external shCode-curriculum components not present in this repo | `sandbox-dev/App.tsx` only has no-op stubs. Needs a real (if minimal) implementation to function standalone here. |
| Save/Open .FCStd | **MISSING entirely** | No method on `EngineAdapter` at all — new adapter-seam surface needed, not just UI wiring. |
| Export STL | **EXISTS**, engine-agnostic | Operates on the meshed geometry directly, works against either engine already. |

packages/studio's React layer is confirmed engine-agnostic already (goes
through `EngineAdapter`/`TopoName`, never imports OCCT-specific modules
directly) — **no adapter-seam rework needed on the UI side.** The gap is
concentrated in `freecad-engine-adapter.ts`'s own feature coverage plus two
components that don't exist yet anywhere in this repo (Save/Open, a real
CodeEditor/ReshapePreview pair).

## 2. Phase plan

Same discipline as SPEC-engine-port.md: spec → code-engineer → independent
verify (build, full test suite, real fc-kernel-pd-final Docker container
where practical) → commit → next phase. No ollama delegation — this is
correctness-critical CAD kernel work.

1. **Wire sandbox-dev for real** — mount `sides={['build', 'code']}`,
   replace the no-op `CodeEditorStub`/`ReshapePreviewStub` with minimal real
   implementations (plain textarea + the existing `toScript()`/sandboxed
   script-runner is enough; no need to match shCode's actual editor chrome).
   Verify every already-EXISTS feature (sketch constraints, primitive
   picking, primitive fillet/chamfer, history/undo/redo, STL export)
   actually works end-to-end in the browser sandbox, not just unit tests.

   **Known issue found during phase 1 verification (2026-09-11, bowser/
   sandbox-p1-verify), pre-existing and NOT introduced by this phase's
   diff** (confirmed via `git log` — `freecad-engine-adapter.ts` and
   `ModelEditor.tsx` last changed in `3681d5b`, before this phase touched
   only `packages/sandbox-dev/*`): clicking **Round** on a selected primitive
   box (no edge picked first, so it takes the "round every edge" path) shows
   a success notice ("Rounded every edge...") and adds a "Box 1 corner"
   slider to the Dimensions panel (`BoxFeature.round`, set), but the 3D mesh
   never visibly updates — the box stays sharp-cornered. Reproduced twice,
   including a 1s wait and a hi-res screenshot to rule out a render-timing
   fluke. Undo cleanly removes the slider afterward, so the doc/history
   state itself is consistent; only the BUILT geometry disagrees with it.
   Likely the FreeCAD engine adapter's box builder not honoring
   `BoxFeature.round` at all (distinct from the single-picked-edge Fillet
   path this same phase's plan text already flags as primitive-only).
   Not fixed here — logged for future triage, out of this phase's scope.
2. **Pattern support in freecad-engine-adapter** — linear + polar, backed by
   real FreeCAD PartDesign array features. UI/model already exist; this is
   adapter `build()` work only.
3. **General (non-primitive) topo-naming for picking** — the deeper "item B"
   work: resolve faces/edges on sketch-derived solids (extrude/pocket walls
   and caps), not just primitives. This is what makes Fillet/Chamfer usable
   on real modeled parts, not just raw boxes/cylinders.
4. **Save/Open .FCStd** — new `EngineAdapter` methods. Straightforward on
   the FreeCAD side (native format); OCCT adapter can throw
   "not supported on this engine" per the established fallback-refusal
   pattern.
5. **Retire `engine/play/studio.html`** — once 1-4 are verified, archive
   (not delete) the vanilla prototype, update `SPEC-engine-port.md`, the
   plan file, and `bench/record.json` to point at the sandbox as canonical.

## 3. Explicitly out of scope for this pass

- **Revolve/Groove.** Already flagged in SPEC-engine-port.md §1.2/§6 as a
  genuine unresolved orientation-convention mismatch between
  `occt-build.ts` and FreeCAD's `PartDesign::Revolution` — needs a design
  decision, not implementation time. Do not touch here.
- **Mirror, Hole, Shell, Move, Draft, Combine.** Named in
  `freecad-engine-adapter.ts`'s own header as scoped-out future work,
  unrelated to studio-canonicalization specifically. Separate initiative.
- **studio.html's PartDesign-specific sweeps** (Pipe/Helix/Loft/sub-variants).
  These have **no equivalent `Feature.kind` at all** in
  `packages/script/src/model-types.ts` — not unbuilt, unmodeled. Adding them
  is greenfield modeling-language design work, not a port. Flagged for a
  separate decision, not bundled into "parity."
