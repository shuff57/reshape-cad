# SPEC: Mouse-interaction parity with Autodesk Fusion

Status: DRAFT, 2026-09-19. Sources: code recon of `packages/studio/src` (file:line refs below,
taken from a read-only survey, not re-verified line by line), 12 Autodesk Learn lessons
(transcripts + `crv` keyframes), 4 ribbon screenshots in `ui-ref/`.

**Items tagged `[CONFIRM]` are Fusion behaviours neither the lessons nor the frames show.**
They are written from general knowledge of Fusion and must be checked against the user's
own recording or a live Fusion before being built.

## Goal

Someone who knows Fusion can orbit, pan, zoom, select, sketch and drag features in reSHape
Studio without relearning the mouse. Not a goal: matching Fusion's rendering, tool set, or
non-mouse UI.

## Current state (recon)

| Area | Today | Ref |
|---|---|---|
| Camera | stock three.js `OrbitControls`, no bindings configured: L-drag orbit, M-drag dolly, R-drag pan, wheel zoom toward target. A code comment claims "right-drag to orbit", stale | `BrepViewportThree.tsx:853`, `:1370` |
| Zoom | toward orbit target, no zoom-to-cursor; perspective only | `:853`, `:703` |
| Nav cube | 6 faces + free drag; no edges/corners, no menu | `:2516-2549` |
| 3D pick | CPU raycast; face + edge; click-only; shift toggles; faces and edges cannot mix; no vertex/body; no box select; no filters | `:1057-1371`, `ReshapeStudio.tsx:1243` |
| Context | floating ContextBar, no right-click menu, no double-click | `ContextBar.tsx` |
| Sketch view | fixed viewBox ±100, no pan/zoom | `SketchCanvas2D.tsx:52,186,1043` |
| Sketch tools | click-click creation; point snap only; only points drag; shortcuts `L`,`S`; dimensions via toolbar + inline input | `:284-456`, `:613-668`, `:672-686` |
| Manipulators | `HandleOverlay` param handles (move/turn/radius/size), pointer-captured so orbit ignores them | `HandleOverlay.tsx:337-390` |
| Timeline | up/down buttons, no drag reorder | `ModelEditor.tsx:1746` |

## Observed Fusion behaviour (from the lessons)

- Right-click opens a radial **marking menu** at the cursor: Repeat, Delete, Press Pull, Undo,
  Redo, Move/Copy, Hole, Sketch; hover Sketch for a second radial; a context list below holds
  Pan/Zoom/Orbit, Isolate, workspaces, saved shortcuts. Contents change with workspace, tab
  and active command.
- **Gestures**: hold right-button and drag toward a wedge without showing the menu; Sketch is
  reached by dragging down first. Same gestures cover OK / Cancel / Finish Sketch while a
  command is active.
- ViewCube: faces, edges and corners snap the view; Home; menu has camera mode
  (Orthographic / Perspective / Perspective with Orthographic Faces) and Set as Home/Front/Top.
- Navigation bar: orbit, look-at, zoom, pan, zoom-window, fit; Multiple Views (4 synced
  viewports); Named Views; Adaptive vs Fixed grid; Incremental Move (grid-snapped drag).
- Timeline: right-click an operation to edit/delete; drag to reorder.
- Feature dialogs (extrude, press pull, fillet): profile/face fills blue on select; on-canvas
  arrow manipulator plus a typeable floating value box; arc handle for taper/angle;
  symmetric shows arrows both sides; cut previews in red; tooltip prompts each step
  ("Select sketch profiles or planar faces", "Hold Ctrl to modify selection"); camera stays free
  while the dialog is open.
- Sketch: closed profiles fill blue; Esc exits the current command; `S` opens the toolbox
  search; shortcuts from the ribbon: E extrude, H hole, Q press pull, F fillet, M move,
  I measure, Del delete.

## Phases

Ordered by user-visible payoff and dependency. Each phase ships independently.

### Phase 1: Camera and view (self-contained)

1. **Mouse scheme.** Configure `OrbitControls.mouseButtons` / `touches` explicitly. Default
   to Fusion's scheme `[CONFIRM]`: MMB pan, Shift+MMB orbit, wheel zoom. Keep the current
   scheme as a selectable preset; store preference in localStorage (wrapped in try/catch).
2. **Zoom to cursor.** `OrbitControls.zoomToCursor = true`.
3. **Camera mode.** Perspective / Orthographic toggle (three `OrthographicCamera` swap,
   preserving target and framing). "Perspective with orthographic faces" is optional and
   deferred.
4. **Fit / zoom-window / look-at.** Fit-all exists as Home; add fit-selection and
   window-zoom (drag rectangle), reusing `camera-fit.ts`.
5. **ViewCube.** Add edge and corner hit zones and a camera-mode menu; snapping keeps
   current distance as faces do today.
6. Fix the stale comment at `BrepViewportThree.tsx:1370`.

Acceptance: pure-math parts (mouse-scheme mapping, ortho frustum sizing, window-zoom fit)
get `node --test` cases against `dist/` output; interaction verified in browser.

### Phase 2: Sketch view navigation and creation

1. **Pan / zoom in sketch.** Replace the fixed viewBox with a state `{cx, cy, scale}`; wheel
   zooms to cursor, MMB (same scheme as Phase 1) pans, a Fit button and `F6`-style shortcut
   `[CONFIRM key]`. Keep `SNAP_PX`/`HIT_PX` in screen space so they survive zoom.
2. **Drag-to-create** for rect / circle / slot alongside click-click, as Fusion allows both
   `[CONFIRM]`.
3. **Snapping.** Add midpoint, intersection, on-curve and (optional) grid to
   `sketch-canvas-core.ts` `findSnap`; draw a per-type snap glyph. Pure functions, unit
   tested in `sketch-canvas-core.test.mjs`.
4. **Entity drag.** Allow dragging whole lines/circles/arcs (solver `drag()` already exists
   for points); one undo step on pointerup as today.
5. **Marquee.** Window (left-to-right, fully inside) vs crossing (right-to-left) selection
   `[CONFIRM direction convention]`.
6. **Shortcuts and cursors.** Fusion sketch keys `[CONFIRM]` (L line, R rect, C circle, D
   dimension, T trim, etc.); per-tool cursor; Esc cascade already exists.
7. **On-canvas dimensions.** Click an entity in Dimension mode, place a label, type value
   inline; double-click a label to edit; Tab between fields.
8. **Constraint glyphs.** Render on canvas, hover-highlight, click to select, Del to remove.

### Phase 3: 3D selection

1. **Modifier semantics.** Carry modifiers into `onPick` (today a window keydown listener
   fakes it, `ReshapeStudio.tsx:257`). Ctrl-click adds, Shift-click toggles or ranges
   `[CONFIRM which is which in Fusion]`; empty click clears.
2. **Vertex and body picking**, plus **selection filters** (faces / edges / vertices /
   bodies) as a small toolbar or context option.
3. **Mixed selection.** Allow faces and edges together where the consuming command permits.
4. **Box select** in the viewport (window vs crossing), consistent with Phase 2.
5. **Click-and-hold "select other"** to cycle overlapped candidates `[CONFIRM behaviour]`.
6. **Double-click** a feature in the viewport or timeline to edit it; `Ctrl+A`, Del in the
   viewport.
7. **Unify selection state** between viewport and `ModelEditor` (today split); this is the
   riskiest refactor in the phase, so do it first and alone.

### Phase 4: Marking menu and context menus

1. **Right-click marking menu** component: radial first level (default eight commands from
   the lesson), second-level flyout on hover, context list below. Menu contents are data
   keyed by mode (part, sketch, active command).
2. **Gestures**: right-button hold + directional drag selects a wedge without rendering the
   menu after a short delay `[CONFIRM delay and dead-zone]`.
3. **Right-click must not break pan/orbit.** Distinguish a click (menu) from a drag by
   movement threshold; right-drag should remain available if the mouse preset uses it.
4. **Timeline / browser context menus** (edit, delete, rollback) and **drag-reorder** of
   timeline items; replace the up/down buttons but keep them keyboard-reachable.

### Phase 5: Direct manipulation on 3D

1. **Feature manipulators**: extend `HandleOverlay` to draw the arrow triad and floating
   value box on extrude/press-pull/fillet targets, with a typeable value and taper arc.
2. **Move/Copy gizmo** with axis arrows, plane handles and rotation rings; **Incremental
   Move** with adaptive/fixed increments.
3. **Live preview** (blue add / red cut) while dragging, committed once on pointerup so undo
   stays one step.
4. Step tooltips ("Select sketch profiles or planar faces") tied to command state.

## Cross-cutting rules

- Every interaction reads its modifier/button binding from one **input-scheme table**, so the
  preset in Phase 1 and the marking menu in Phase 4 cannot disagree.
- Put pure logic (hit-testing, snapping, scheme mapping, fit maths) in testable modules
  (`sketch-canvas-core.ts`, `camera-fit.ts`); tests import from `dist/`, so build before
  `npm test`.
- Rendering stays on-demand; do not add a continuous rAF loop for hover.
- Touch and reduced-motion must not regress; pointer capture for handles stays.
- Anything Fusion has that the kernel cannot do (features brep-rs refuses) is shown as a
  refusal in a sentence, not hidden.

## Risks and coordination

- `git status` at the time of writing shows uncommitted edits by someone else in
  `SketchCanvas2D.tsx`, `ModelEditor.tsx` and `ReshapeStudio.tsx`. Phases 2 and 3 touch the
  same files. Land or rebase those first, or claim the files in the message center.
- Selection-state unification (Phase 3.7) and the input-scheme table (cross-cutting) change
  shared plumbing; do them before feature work that depends on them.
- Raycast picking is CPU-side; vertex/body picking and click-and-hold cycling may need a
  spatial index if models get large. Measure before optimising.

## Open questions for the owner

1. Which bindings is the default: Fusion's, or keep today's? (Phase 1.1)
2. Are the `[CONFIRM]` behaviours above right? A short recording covering orbit/pan/zoom,
   select-other, window vs crossing select, and right-click gestures would settle all of them.
3. Is orthographic in scope for the first ship, or after Phase 2?
4. Marking menu: replace the ContextBar, or coexist with it?

## Definition of done (per phase)

- Behaviour matches the table row it replaces, verified in the browser on Windows Chrome.
- New pure logic has a `node --test` case; existing suites still pass (`npm run build && npm test`).
- No regression to the nav cube, HandleOverlay drag, or sketch undo granularity.
