# SPEC: make packages/studio (via sandbox-dev) the canonical sandbox

Status (2026-09-11): phase 1 DONE (commit 79ab6c0) -- sandbox-dev has a
real Code side, verified via bowser. Phase 2 (pattern support) DONE --
linear + polar patterns build in `freecad-engine-adapter.ts`, verified
against the real fc-kernel-pd-final kernel (26/26 checks). Three found
semantic gaps (rotated target, non-'z' circular axis, circular pattern of
a primitive target) are refused per-feature, not built wrong -- see
`freecad-engine-adapter.ts`'s own 'pattern' branch comment and
SPEC-engine-port.md §6.1 for the full account. Phase 3 (general
topo-naming for picking) DONE for extrude (sketch-derived wall/cap naming,
88/88 checks against the real kernel); pocket's own newly-cut geometry
stays refused, deliberately matching OCCT's own scope for the same case --
see SPEC-engine-port.md §6.2a for the full account, including a real,
previously-shipped sketch-translate.ts sign bug found and fixed along the
way. Phase 4 (Save/Open .FCStd) DONE -- EngineAdapter grew
saveDocument()/openDocument(); FreeCAD saves a real, independently-openable
.FCStd that also embeds the original ModelDoc as JSON (so it round-trips
exactly), OCCT throws a clear refusal, and the UI grays out Save/Open on the
OCCT engine rather than showing an error after a click. See
SPEC-engine-port.md §6.6 for the full account, including the real design
question this phase was flagged to stop and report on (an arbitrary
real-world .FCStd cannot in general be reconstructed as a ModelDoc) and how
it was resolved without guessing. Phase 5 (retire engine/play/studio.html)
DONE -- studio.html/studio.js/play.js/pick3d.js/sketch.js moved (git mv,
history preserved) to engine/play/_archive/; the wasm data pack
(freecad-data.js/.data) stayed in engine/play/ since packages/sandbox-dev's
own engineStaticServer() still serves it from there (confirmed unaffected:
200s on both files post-move, and a live bowser check rebuilt a box on the
FreeCAD engine through sandbox-dev with no console errors). packages/studio
(via packages/sandbox-dev) is now the one canonical sandbox.

Out-of-band bugfix (2026-09-11, separate from the phase sequence above): a
real, pre-existing bug in the box/cylinder branches of `build()` -- `f.center`
was applied TWICE (once baked into the sketch's own local coordinates, once
again via `setBodyPlacement()`'s Body.Placement), doubling an off-origin
box/cylinder's world position (measured: center `[30,20,0]` came back as
world bbox center `[60,40,0]`). Fixed by moving their sketch geometry to
local `(0,0)`, matching sphere/cone/torus/prism's existing convention. Direct
consequence: box/cylinder now ALSO hit the circular-pattern-is-a-geometric-
no-op gap above, which used to name only "sphere, cone, torus or prism" --
now every primitive kind. See `freecad-engine-adapter.ts`'s own comments on
the box/cylinder branches, `setBodyPlacement`, and the 'pattern' branch, and
SPEC-engine-port.md §6.1's own update, for the full account. Picking
(`resolveFace`/`resolveEdge`/fillet-edge-resolution) was checked live against
an off-origin box/cylinder after the fix and is unaffected -- it computes its
own reference frame from the shape's current BoundBox every call, never from
a stored `f.center`.

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
2. **DONE. Pattern support in freecad-engine-adapter** — linear + polar, backed
   by real `PartDesign::LinearPattern`/`PolarPattern`. UI/model already
   existed; this was adapter `build()` work only. Verified against
   `fc-kernel-pd-final` (`packages/kernel/test/freecad-pattern.manual.mjs`,
   26/26 passing): 3-copy non-overlapping linear pattern volume/span exact
   vs OCCT, 4-copy 90°-spaced polar pattern volume/span exact vs OCCT
   (rules out a 72°/duplicate-at-seam spacing), negative step correctly
   reverses direction, two independent patterns in one document keep
   distinct object names. Found and fixed three real bugs along the way
   (all in `fc-commands.mjs`'s `linearPattern`/`polarPattern` emitters, none
   in this phase's own new code): `Body.Tip` never advanced to the new
   pattern object (`Body.Shape` kept showing the pre-pattern feature) --
   fixed by setting it explicitly; a negative `Length` errored
   ("Pattern length too small") instead of reversing direction -- fixed by
   moving direction into the separate `Reversed` boolean and always sending
   a positive magnitude; a second `PartDesign::Body` in the same document
   auto-suffixes its own axis datum's internal NAME on collision (measured:
   `Z_Axis` on the first body, `Z_Axis001` on the second), so the original
   `origin.getObject('Z_Axis')` name-based lookup silently returned `None`
   past the first body -- fixed by resolving through `OriginFeatures`'
   `.Role` property instead, which is not renamed. Also found, and REFUSED
   rather than built wrong (per-feature, `EngineBuildResult.refusals`,
   matching this file's existing "no answer over a wrong one" convention):
   a rotated target (the pattern's own axis would rotate with the body
   instead of the world), a non-'z' circular axis (unreachable via the
   studio UI, which hardcodes 'z'), and a circular pattern of a primitive
   target -- box, cylinder, sphere, cone, torus, or prism (their local
   geometry sits on the very axis the pattern orbits, so every copy
   silently lands on the original -- confirmed only by running against the
   real kernel, not from reading the code; box/cylinder joined this list in
   an out-of-band bugfix pass, see this file's own status note above, once
   their separate double-translation bug was fixed). Full account in
   `freecad-engine-adapter.ts`'s own 'pattern' branch comment.
3. **DONE (extrude; pocket's own new geometry stays refused, by design). General
   (non-primitive) topo-naming for picking** — resolve faces/edges on
   sketch-derived solids, not just primitives, so Fillet/Chamfer works on
   real modeled parts, not just raw boxes/cylinders. Closed via a real-kernel
   measurement, not FreeCAD's own history API: a `PartDesign::Pad`'s own
   `Shape.Faces`, queried directly off that same frozen object, comes back
   in a stable, predictable order (wall 0..n-1 in the profile's own segment
   order, then bottom cap, then top cap) that survives later features being
   built on top -- so `resolveFace`/`resolveEdge` trust a cached ordinal
   index outright, while `nameFace`/`nameEdge` (which may be picking on a
   LATER feature's current, no-longer-ordinally-stable shape) fall back to
   geometric point-matching, the same "point known to lie on it" technique
   `topo-history.ts` already uses on the OCCT side. Verified against
   `fc-kernel-pd-final` (`packages/kernel/test/freecad-sketch-picking.
   manual.mjs`, 88/88): a rectangle Pad's 4 walls + 2 caps and all 12 edges
   name and round-trip; a rounded-corner Pad's arc wall names `rounded`, the
   rest `swept`; a Fillet was built for real from a pick on a sketch-derived
   wall edge; a pad-then-pocket chain's untouched walls still name when
   picked on the pocket's own current shape, while the pocket's own new
   hole geometry stays an honest null. REFUSED, not guessed: naming a
   pocket's own newly-cut faces at all -- deliberately matching OCCT's own
   scope (which records no sweep history for pocket either, so this is
   parity, not a gap); a circle-shaped sketch profile (no per-edge
   vocabulary to name a wall after); a concave sketch's cap (same centroid
   limitation `topo-history.ts` already documents for OCCT). Found and fixed
   along the way, unrelated to naming itself but blocking this phase's own
   verification: a real, previously-shipped sign bug in
   `sketch-translate.ts`'s origin-pinning helper had every closure-pinned or
   `lock`-ed sketch corner (and every circle-sketch center) building at the
   NEGATIVE of its intended coordinate -- a full point-reflection through
   the sketch origin, invisible to every prior volume-only real-kernel check
   since a point reflection does not change volume. Full account, including
   the exact measurement and the fix's precise scope, in
   `SPEC-engine-port.md` §6.2a.
4. **DONE. Save/Open .FCStd** -- `EngineAdapter` grew `saveDocument(doc):
   Uint8Array` / `openDocument(bytes): ModelDoc | null`, matching
   fc-session.mjs's own bridge-level naming. FreeCAD's own saveAs/
   openDocument (already proven by studio.js's Save/Open buttons) write a
   real, independently-openable `.FCStd`, which also embeds the ORIGINAL
   ModelDoc as marker-prefixed JSON in `App::Document.Comment` -- measured,
   not assumed, to round-trip byte-for-byte through saveAs()/openDocument()
   via a standalone probe against fc-kernel-pd-final before writing any
   adapter code (App::Document.Meta, a dict property, was also measured to
   work and considered, but Comment's single-string shape has fewer
   Python-binding edge cases on a kernel that has already surprised this
   port more than once). `openDocument()` returns the embedded ModelDoc
   exactly for anything this adapter saved, and refuses (null) for anything
   else -- an arbitrary real-world `.FCStd` (studio.html's own Open button
   supports exactly that) has no ModelDoc-shaped history at all, and
   guessing one from a general FreeCAD Part/PartDesign/Sketcher tree would
   silently misrepresent the model the moment the guess is wrong, so this
   follows the same "no answer over a wrong one" rule as the pattern/picking
   refusals in phases 2-3 rather than attempting a partial import.
   `OcctEngineAdapter` throws a clear "not supported on the OCCT engine"
   error for both methods (OCCT has no `.FCStd` concept at all); the UI
   (`ReshapeStudio.tsx`'s new Save/Open toolbar buttons) grays both out on
   the OCCT engine instead of relying on that throw, via a new `onEngine`
   prop on `BrepViewportThree.tsx` that reports which engine is ACTUALLY
   live (correct even through the phase-1-documented per-doc OCCT fallback,
   not just the configured getEngineMode()). Verified against
   `fc-kernel-pd-final`
   (`packages/kernel/test/freecad-save-open.manual.mjs`, 10/10): a genuine
   three-way round trip (native bytes reopened through the bridge directly
   reproduce the same mesh volume; the embedded ModelDoc reconstructs
   structurally exact; rebuilding that reconstructed ModelDoc from scratch
   reproduces the same volume again), a foreign `.FCStd` with no embedded
   marker correctly refuses, and both OCCT methods throw the expected
   message. Also verified live in the browser (bowser, sandbox-dev,
   fully-wired FreeCAD engine): built a real box, Save downloaded a real
   9,246-byte `.FCStd`, Clear model emptied the viewport, and Open on that
   same file correctly restored the identical box -- no console errors.
   Full account in SPEC-engine-port.md §6.6.
5. **DONE. Retire `engine/play/studio.html`** — archived (not deleted,
   `git mv`) to `engine/play/_archive/`: `studio.html`, `studio.js`,
   `play.js`, `pick3d.js`, `sketch.js`. The wasm data pack
   (`freecad-data.js`/`.data`) stayed in `engine/play/`, still served by
   `packages/sandbox-dev/vite.config.ts`'s `engineStaticServer()` — verified
   unaffected (both files still 200 post-move; a live bowser check rebuilt a
   box on the FreeCAD engine through `sandbox-dev` with no console errors).
   `SPEC-engine-port.md`, `~/.claude/plans/freecad-browser.md`, and
   `bench/record.json`'s C2 note updated to point at the sandbox as
   canonical.

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
