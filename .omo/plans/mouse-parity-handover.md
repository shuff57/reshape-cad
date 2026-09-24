# HANDOVER — Mouse-Parity Phase 2 + 3 (SPEC-mouse-parity.md)

**Written:** 2026-09-20, by the orchestrator session. Read this before touching anything.

## Mission

Execute ALL of `docs/specs/SPEC-mouse-parity.md` Phase 2 (sketch nav/creation, items 1–8) and
Phase 3 (3D selection, items 1–7). Spec of record: `docs/specs/SPEC-mouse-parity.md` — read it.
Phase 1 (camera/view) shipped before this run at `b31ee21`.

**Status: 15 commits landed on main (local, not pushed). All pure-module work done. All of
Phase 2 DONE. Phase 3: items 7, 1, 2 DONE; item 3+4 = WIP uncommitted in tree (mostly complete,
135/135 tests green); items 5, 6 NOT STARTED. Final QA sweep (T13) NOT RUN.**

## Environment facts (learned the hard way — save yourself the rediscovery)

1. **`node` on PATH is a Bun 1.4.2 shim** that mishandles `node --test` glob patterns. Use the
   real Node 22 tarball already in the sandbox:
   `export PATH="/tmp/opencode/node-v22.14.0-linux-x64/bin:$PATH"` before any `node --test`.
   If that tarball is gone, download node v22 to `/tmp/opencode/` — do NOT modify the shim.
2. **Build order**: `npm run build` from repo root (sketch → script → kernel → studio).
   Tests import from `dist/`, so build first. Test command:
   `node --test packages/studio/test/*.test.mjs`.
3. **Playwright**: not a repo dependency. Prior tasks used a scratch setup: playwright-core
   cached at the opencode cache + chromium-1243, driven by a script under `/tmp/opencode/`.
   Dev server: `npm run dev:sandbox` on a private port (e.g. `--port 5199 --strictPort`),
   `setsid`-detach it, kill by PID when done. Two known Playwright quirks:
   `page.mouse.click()` has no working `modifiers` option → bracket clicks with
   `keyboard.down/up`; each pick pops a floating ContextBar that eats the next blind click →
   press `Escape` between steps.
4. **Browser QA oracle**: the status-bar readout `.reshape-studio-status-sel` reports
   selections (e.g. `Box 1 · 2 edges`, `Box 1 · body`, `Nothing selected`). Build test scenes
   via the Code side: switch to Code tab, type `box(40, 40, 40);`, click ▶ Run, switch to Build.
5. **Wasm**: browser QA needs `packages/brep-rs/pkg/` present. It exists now; a fresh checkout
   must build it first (`cd packages/brep-rs && wasm-pack build --release --target web --out-dir pkg`).
6. **Commit style**: `feat(studio): lowercase description (SPEC-mouse-parity Phase N item M)`.
   One atomic commit per spec item. NEVER stage `.msgbox/log.jsonl`. Do not push.
7. **`packages/studio/AGENTS.md` is stale in one spot**: it still lists `SketchConstraints.tsx`
   (deleted in `2b19a05`). The live constraint path is `writeDoc(geoms, rules)` in
   `SketchCanvas2D.tsx`. Also the Phase-1 view strip + filter chips live inside
   `BrepViewportThree.tsx`'s own JSX, NOT ReshapeStudio.tsx.
8. **Parallel-safe**: tasks are file-disjoint. Sketch-canvas tasks touch
   `SketchCanvas2D.tsx`/`sketch-canvas-core.ts`; viewport tasks touch
   `BrepViewportThree.tsx`/`ReshapeStudio.tsx`/`ModelEditor.tsx`. Never edit the other track's
   files. If the shared build breaks in the other track's file, verify your own files via a
   scratch copy (`git archive HEAD` + your file) instead of waiting.
9. **SoupRule has 16 kinds** (`model-types.ts:377`, all honored by the brep-rs solver): the 6
   value-carrying ones render as value chips, the other 10 as icons, in T9's constraint-glyph
   layer.
10. **Undo-press counting for Playwright**: press Ctrl+Z N times (checking a doc-observable
    each time) rather than trying to read stack depth from the DOM.

## What landed (15 commits, oldest → newest)

| Commit | What | Spec item |
|---|---|---|
| `7c524d9` | `sketch-view.ts` pure view math (zoom-to-cursor/pan/fit, screen↔world) | P2.1 |
| `43b660e` | `selection-model.ts` — unified SelectionState + ops (`replace/toggle/add/clear/toggleFeature/selectAllFeatures/primaryOf/featuresOf/ownerScoped`) | P3.7 (pure half) |
| `7069e1e` | `marquee-select.ts` — window/crossing box-select math | P2.5+P3.4 (pure half) |
| `5a6ec94` | `findSnap` unified snapper (vertex/midpoint/center/intersection/onCurve/grid; `snapVertex` delegates to it; +`lineCircleIntersections`/`circleCircleIntersections`) | P2.3 (pure half) |
| `2aabb85` | Sketch canvas pans/zooms (viewBox from SketchView, `vector-effect:non-scaling-stroke`, scheme-driven pan button, Shift+F fit) | P2.1 |
| `7101c04` | Drag-to-create rect/circle/slot (rubber band, one undo step; <3px = click) | P2.2 |
| `b94f263` | Whole-entity drag (line/circle/arc body; pinned-entity refusal note) | P2.4 |
| `1313fc7` | **Unify selection state** (`SelectionState` replaces 6 vars + shiftHeldRef; ModelEditor takes `selection`+`onSelectionChange`; behavior-preservation matrix verified) | P3.7 (wiring) |
| `2aabb85`…`b94f263` verified in browser (23/23 Playwright, zoom-anchor drift 7.9e-15mm) | | |
| `e7373d9` | Per-type snap glyphs (square/triangle/crosshair/X/diamond, constant px) | P2.3 (wiring) |
| `88f9da2` | Sketch marquee select (L→R window, R→L crossing) | P2.5 (wiring) |
| `092a808` | Tool shortcuts (L/R/C/A/S/T/V; `S`→slot, `V`→select) + per-tool cursors | P2.6 |
| `afc32f2` | Real Ctrl/Shift/Meta modifiers into `ViewportPick`; `pick-modifiers.ts` deleted; Ctrl=add-if-absent (local `addIfAbsent`), Shift=toggle, plain=replace, empty=clear always | P3.1 |
| `98ab880` | On-canvas dimensions (D arms dim tool when nothing selected; click entity → ghost label → place → inline input → Enter; dblclick re-edits; Tab cycles) | P2.7 |
| `613feca` | Constraint glyphs (16/16 SoupRule kinds: 6 value chips + 10 icons; hover/click-select/Del removes) | P2.8 |
| `1cb9a3b` | Vertex+body picking + filter chips (vertex>edge>face>body priority; `pick-helpers.ts` + 11 tests; body reachable when `filters.face` off) | P3.2 |

**Suite state after all of the above: 123/123 green, clean build.**

## WIP IN THE TREE (uncommitted — T11, mostly done, salvage first)

The last T11 attempt (cancelled) left complete-looking work UNCOMMITTED. Current tree:
`npm run build` clean, `node --test packages/studio/test/*.test.mjs` → **135/135 pass**
(123 base + 12 new). Diff stat (~554 insertions):

- `selection-model.ts` +23 — new `edgesOf`/`facesOf`/`verticesOf`/`bodiesOf` helpers (+24 test lines)
- `marquee-select.ts` +38 — generic rect/point-set helpers for 3D box select (+69 test lines)
- `BrepViewportThree.tsx` +284 — box-select drag (marquee overlay, projection, filters)
- `ReshapeStudio.tsx` +115 — mixed-selection consumption, status notes for ignored kinds
- `ModelEditor.tsx` +66

**FIRST ACTION for the next session:**

1. Review this diff carefully (`git diff` on those 8 files). It was written but never
   self-verified by its author (cancelled mid-Playwright).
2. Run the full gate: `npm run build && node --test packages/studio/test/*.test.mjs` (expect
   135/135; fix anything red).
3. If it checks out, run a Playwright smoke against `npm run dev:sandbox` for T11's contract:
   (a) Ctrl-click face + edge + vertex → all held; fillet uses the edge and notes ignored
   items; (b) L→R box covering two faces selects exactly those two; R→L touching a third
   includes it; (c) box-select respects filters; (d) drag starting ON a face = no marquee;
   (e) box released over nav cube does nothing; (f) T8's modifier matrix unchanged; (g)
   window-zoom unaffected; (h) HandleOverlay drag unaffected; (i) box select adds zero undo
   entries.
4. Commit as TWO atomic commits, matching repo style:
   `feat(studio): mixed face+edge selection where commands permit (P3.3)` and
   `feat(studio): viewport box select window/crossing (P3.4)`.

If the WIP is unsalvageable, revert those 8 files (`git checkout -- <files>`) and re-run T11
from scratch (contract below).

## Remaining work

### T11 (P3.3 + P3.4) — see "WIP" above: verify-and-land first, re-run only if broken.

Contract summary: mixed selection consumers gate on kinds they accept and never silently drop;
viewport box select reuses `marquee-select.ts` math via generic point-set helpers; respects
T10 filters; doesn't race window-zoom/nav cube/HandleOverlay; zero undo entries.

### T12 (P3.5 + P3.6) — NOT STARTED. Files: `BrepViewportThree.tsx`, `ModelEditor.tsx`, `ReshapeStudio.tsx`.

**(P3.5) Click-and-hold "select other":** pointerdown stationary 300 ms (4 px dead-zone) with
≥2 raycast candidates at that pixel → cycle selection to the next candidate (nearest-first
ring); movement or pointerup before timeout = normal click; one `setTimeout`, cleared on
move/up; no rAF. Two stacked coplanar solids → hold cycles to the back one; hold again cycles
back. Hold-then-drag inside 300ms → orbit proceeds, no cycle.

**(P3.6) Double-click + Ctrl+A + Del:** dblclick a feature body in the viewport or a timeline
row in `ModelEditor.tsx` → open that feature's params panel focused (single-click still =
select). Ctrl+A in viewport → select all features (use `selectAllFeatures` from
`selection-model.ts`). Del in viewport → delete selected feature(s) through the existing
doc-edit path; dependent features that then fail MUST surface their per-feature refusal
sentences (never hide — see root AGENTS.md, per-feature refusal contract). Edge cases: dblclick
empty space = nothing; Ctrl+A then Del on empty doc = no-op; consumed-feature deletion shows
refusal, not silence; undo = one step per delete; box-select drag (T11) kills the hold timer.

Category: `unspecified-high` (or `quick` if you want the flash lane; T10/T11-class work ran
fine on both). Skills: `programming`, `playwright`. TWO commits:
`feat(studio): click-and-hold select-other cycling (P3.5)`,
`feat(studio): double-click edit, Ctrl+A, Del in viewport (P3.6)`.

### T13 (final QA sweep) — NOT STARTED. Files: none edited.

Full gate (`npm run build` + all suites), then one consolidated Playwright pass over
`npm run dev:sandbox` covering: every browser-flagged scenario from T5–T12; the spec's
regression checklist (nav cube 6 faces + free drag, HandleOverlay drag, sketch undo
granularity, touch single-pointer, reduced-motion — verify no new animations/rAF were added,
refusal surfacing beside what built, Phase 1 behaviors: scheme presets/zoom-to-cursor/ortho
toggle/fit-selection/window-zoom). Produce a PASS/FAIL table with screenshots; route FAILs back
to a continuation of the owning task (`task(task_id="ses_...")`). Verify `npm test` green at
final HEAD.

### After T13: update the spec

Mark shipped items in `docs/specs/SPEC-mouse-parity.md` (a status line per phase is enough),
so the next reader knows Phase 2 + 3 are done. Only with owner approval if it's lead-owned.

## [CONFIRM] defaults taken (spec said "confirm with owner"; owner has not objected)

- Marquee: L→R = window (fully inside), R→L = crossing (touches). Fusion/AutoCAD convention.
- Ctrl-click = add-if-absent; Shift-click = toggle; plain = replace; empty = always clear.
- Sketch shortcuts: L line, R rect, C circle, A arc, S slot, T trim, D dimension, V select;
  sketch Fit = Shift+F. (`S` moved from select→slot, `V`→select, per the Fusion mapping.)
- Click-and-hold: 300 ms delay, 4 px dead-zone. (T12 not started; use these.)
- T8: Shift+Ctrl together → Shift wins. HandleOverlay's tap-through-a-handle pick path carries
  no modifiers (plain replace) — narrow known gap. `restorePicks()` re-emission carries no
  modifiers (T6/T8 accepted).

## Known quirks preserved deliberately (do not "fix" without checking spec intent)

- Shift-toggle-off leaves `primary` pointing at the just-removed item until the next click
  (pre-existing behavior, preserved through T6; T8's live test confirmed it).
- Body picks are only reachable when `filters.face` is off (T10's priority call: vertex > edge
  > face > body). If the owner wants body+face simultaneously distinguishable, that's a
  follow-up decision, not a bug.
- Arcs don't contribute intersection snaps (`findSnap` skips arc pairs; onCurve still covers
  the crossing point). Documented ponytail-ceiling in `sketch-canvas-core.ts`.
- Hover snaps exclude grid (`findSnap` called without gridStep) so glyphs never advertise a
  snap the tools won't honor. Renderer covers grid anyway; enabling is a one-arg change.
- Slot drag-to-create reads the dragged BOX (radius from the short side; square drag refuses).
- brep-rs `lock` constraint is a no-op (0 residuals), so no UI-reachable sketch is fully
  constrained — the pinned-entity refusal guard exists but can't be triggered end-to-end yet.

## Suggested order for the fresh session

1. Read `docs/specs/SPEC-mouse-parity.md` + this file. Build + test to confirm baseline
   (expect 135/135 with WIP, 123/123 at HEAD without it).
2. Verify-and-land T11's WIP (two commits) — or re-run T11 if broken.
3. Run T12 (one agent, viewport files; P3.5 then P3.6, two commits).
4. Run T13 (consolidated QA sweep; fix-or-route failures).
5. Update the spec's status lines; report to owner. Push only if the owner asks.