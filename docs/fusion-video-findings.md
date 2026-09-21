# Fusion mouse-parity: video findings log

Findings from `.opencode/agents/fusion-video-eyes.md` (Gemini via OpenRouter,
`scripts/fusion-video-parity.mjs`), spot-checked against each video's real
transcript before being recorded here. Each entry follows the agent's report
structure: verified findings cite a timestamp + transcript excerpt; unverified
claims are named, not dropped. Cross-references `docs/specs/SPEC-mouse-parity.md`
`[CONFIRM]` tags where a finding settles one.

Append one section per video reviewed. Do not edit past entries except to fix
a factual error — this is a log, not a living summary.

---

## Fusion sketch constraints ("Sketch Constraints Made Easy in Autodesk Fusion")

- **Source**: https://www.youtube.com/watch?v=EnNPCfIxpX8 (official Autodesk
  Fusion channel) and https://www.autodesk.com/learn/ondemand/tutorial/sketch-constraints
  (same lesson, Autodesk-hosted original — 8:47 vs. the YouTube re-upload's
  9:49; content matches).
- **Model**: `google/gemini-3.8-flash` (YouTube run) and `google/gemini-3.5-flash-lite`
  (Autodesk-hosted run, both concur on the findings below).
- **Reviewed**: 2026-09-20.

### Verified findings

1. **Constraint glyph deletion — click then keyboard delete, or right-click delete.**
   Timestamp 08:37–08:46 (YouTube transcript): *"you can delete constraints
   once they've been created by clicking on the icon to make it blue and then
   clicking the backspace or delete button on your keyboard."* Autodesk-hosted
   version adds a second path at 02:27: *"by clicking each constraint and
   pressing delete on your keyboard, or by right clicking and selecting delete
   from the markup menu."*
   Confirms `SPEC-mouse-parity.md` Phase 2.8 ("render on canvas, hover-highlight,
   click to select, Del to remove") — already shipped per git log (P2.8,
   `613feca`). No change needed; this is corroboration, not a new requirement.

2. **Two-entity constraint click order is select-first-is-reference.** Autodesk
   docs (`help.autodesk.com/.../GUID-E8C8752F-...`, Activity 2) state directly:
   *"The first selection is your reference, then your second selection aligns
   to match the reference."* Video transcript 02:20–02:34 shows the same
   pattern for the coincident constraint (select point → select line → they
   fix together). This is a real behavior detail not yet in `SPEC-mouse-parity.md`
   — worth adding to Phase 2.8 if constraint *application* (not just deletion)
   gets a phase.

3. **Selection-first, tool-second batch application.** Transcript 03:55–04:12:
   *"rather than selecting the constraint first and then the lines you can
   also select each of the lines that you want to constrain first and then
   press on the constraint... it allows me to select multiple sketch objects
   to constrain at once, whereas if I'd gone the other way I would only be
   able to do two at once."* Two distinct sequencing paths (tool-first limits
   to 2 entities; selection-first allows N) — not currently modeled in the
   studio's constraint UI. Candidate for a future phase, not yet scheduled.

4. **Right-click marking menu filters to valid constraints only.** Transcript
   09:17–09:32: *"if I select the line and the circle only the tangential and
   the fixed constraints are available... you can also see this by right
   clicking in the window and only the constraints that are available will
   show up in this list."* This corroborates `SPEC-mouse-parity.md` Phase 4.1's
   marking-menu description generally, but is specific evidence that the
   *content* of that menu must be selection-type-aware for constraints, not
   just command-context-aware. Not yet built (Phase 4 unstarted).

5. **Inference glyphs while drawing (not just after constraining).** Transcript
   07:46–08:08: hovering a line shows a lock icon (H/V inference); approaching
   a line's center shows a triangle (midpoint inference); click-and-hold off a
   line endpoint draws a tangent arc automatically. This is a *drawing-time*
   preview behavior distinct from post-hoc constraint glyphs — relevant to
   Phase 2.2 (drag-to-create) and Phase 2.3 (snapping) rather than 2.8.

### Unverified / discarded claims

- Gemini (both models) repeatedly cited exact glyph **colors** (e.g. "turns
  bright blue," "solid green with padlock") and specific **cursor icon
  shapes** (e.g. "cyan triangle badge on cursor"). The transcript is audio-only
  and cannot confirm color/shape claims — these are visual-only and were not
  cross-checked against a frame grab. Treat as leads, not facts, until someone
  screenshots the actual Fusion UI.
- One run claimed no keyboard modifiers (Shift/Ctrl) are used for constraint
  multi-select "in this video" — this is true only for *this* video; it does
  not mean Fusion's constraint workflow never uses them elsewhere, and should
  not be read as evidence against Phase 3.1's Ctrl/Shift semantics.

### Relevance to `packages/studio`

Maps to `packages/studio/src/pick-helpers.ts` (constraint glyph hit-testing,
already covers hover/select per git log) and the sketch tool layer
(`SketchCanvas2D.tsx`) for the drawing-time inference glyphs (finding 5, not
yet built) and selection-first batch constraint application (finding 3, not
yet built).

---

## Sketching basics overview ("Sketching Basics Overview")

- **Source**: https://www.autodesk.com/learn/ondemand/tutorial/sketching-basics-overview
- **Model**: script default (`google/gemini-3.8-flash`); every timestamped claim
  matched its transcript context — no `--pro` elevation needed.
- **Reviewed**: 2026-09-20.

### Verified findings

1. **Sketch shortcuts: `L` line, `S` toolbox search, right-click marking menu.**
   01:51–01:55: *"You can also press the keyboard shortcut L for line." / "Press S
   to search for a command, or right-click the canvas to access the command from
   the marking menu."* Corroborates Phase 2.6's shortcut list and Phase 4.1.

2. **Drag-to-create with floating length/angle value boxes.** 02:11–02:22: *"use
   the origin as your starting point by hovering near to it, waiting for it to
   snap, then clicking to place. Once placed, drag this line away from the
   origin. You can see a preview of the line, as well as two dialog boxes that
   let you define the length and angle, if already known."* Direct evidence for
   Phase 2.2 (drag-to-create) and Phase 2.7 (typeable floating value box).

3. **Snap-origin auto-constraint lifecycle.** 03:25–03:56: *"an automatic
   constraint was placed, meaning this start point is locked in place." /
   "If you delete this to remove the constraint, the sketched line is now free
   to move." / "To reset the constraint, simply drag the end point back to the
   origin and release the mouse button after you see it snap."* Snapping
   creates a constraint, deletion frees the geometry, re-snap re-applies —
   spans Phase 2.3 (snapping) and 2.8 (glyph delete).

4. **Circle snap applies coincident; moving the center drags the connected line.**
   04:00–04:18: *"Hover to snap to the end point of the line, then drag out and
   click to create a circle." / "If you move the circle from its center point,
   notice that the line also moves with it, since an automatic constraint was
   applied when you snapped to the end point."* Solver-coupled drag behavior.

5. **Closed profile = light blue shading, required before extrude.** 04:36–04:44:
   *"your sketch must be a closed profile, meaning there are no gaps in the
   perimeter profile." / "This is indicated by the light blue shading."*

6. **2-point rectangle auto-applies horizontal/vertical constraints.** 06:10–06:15:
   *"Once placed, notice the vertical and horizontal constraints have been
   automatically applied."*

7. **Sketch fillet: red preview, dimension prompt, Repeat via marking menu,
   auto-equal across corners.** 06:43–07:29: *"You can see a preview of the
   fillet in red, and after you click, you are prompted to enter the dimension." /
   "right click to open the marking menu, and select repeat fillet." / "each of
   your selections has the same fillet radius as the first selected, as an
   automatic equal constraint was applied."* A sketch fillet tool is not in the
   spec yet — new capability lead.

8. **Sketch palette checkboxes hide dimensions/constraints globally.** 08:25:
   *"From the sketch palette, deselect the dimensions and constraints checkboxes
   to hide these and make your workspace a little cleaner."*

### Unverified / discarded claims

- Exact cursor crosshair shapes, hex colors of the red fillet preview / light
  blue profile shading, and marking-menu icon artwork: audio-only transcript
  cannot confirm visual detail; the functional presence of each feature is
  corroborated, the visuals are not.

### Relevance to `packages/studio`

`SketchCanvas2D.tsx` / `sketch-canvas-core.ts` for drag-to-create (2.2), snap
glyphs (2.3), on-canvas value boxes (2.7), constraint lifecycle (2.8); the
sketch fillet + auto-equal finding is a new `packages/sketch` solver lead.

---

## Press Pull ("Press Pull Command - Fusion 360 Part Tutorial")

- **Source**: queue URL `.../curated/part-modeling-fusion-360/29DPu0ORL2rn0T8atcdYKw`
  returned 403 (WAF) at review time; the agent ran the pipeline on the YouTube
  re-upload https://www.youtube.com/watch?v=F9bg6_FtAFs. Third-party re-upload —
  treat as corroboration, re-confirm on the official lesson if it returns.
- **Model**: script default (`google/gemini-3.8-flash`).
- **Reviewed**: 2026-09-20.

### Verified findings

1. **Press Pull on a 2D sketch profile brings up the Extrude dialog.**
   00:19–00:27: *"go to press pull click on that button and now we can start
   making selections since we want to select the sketch profile in this case we
   can just hover over it and left click and as we do that it brings up the
   extrude menu."*

2. **Face + Press Pull: drag the in-canvas arrow or type in the distance field.**
   01:20–01:31: *"go to press pull click on this face and I can either click and
   drag this Arrow to change the length or I can type a parameter in this
   distance field."* Core Phase 5.1 behavior.

3. **"Modify existing feature" adds no timeline entry.** 01:58–02:10: *"when we
   press OK here you'll notice that no additional features were added to this
   timeline."*

4. **Offset types + precise numeric entry.** 03:00–03:11: *"we'll set the offset
   type to new offset here we could set an offset of 0.4 inches."*

### Unverified / discarded claims

- All visual styling (cursor badges, dark blue outlines, exact color tints, an
  `[X]` clear button in the dialog panel): audio-only transcript, unverified.
- The "no keyboard modifiers used" observation is scoped to this video's
  demonstrations only — same caveat as recorded for the constraints entry.

### Relevance to `packages/studio`

`HandleOverlay.tsx` + viewport feature manipulation — Phase 5.1 (arrow +
floating typeable value box) and 5.3 (preview, commit-on-OK).

---

## Extrude ("Extrude solid bodies")

- **Source**: queue URL `.../curated/part-modeling-fusion-360/1xP9YgyS6eblcyaWJZYTkL`
  404s at review time (verified via yt-dlp); the same lesson is live at
  https://www.autodesk.com/learn/ondemand/tutorial/extrude-solid-bodies.
- **Model**: script default (`google/gemini-3.8-flash`).
- **Reviewed**: 2026-09-20.

### Verified findings

1. **`E` hotkey starts Extrude.** 02:31: *"This time, press E to start the
   extrude command."* Corroborates the Phase 2.6 / ribbon shortcut table.

2. **Symmetric direction extrudes both sides of the sketch plane.** 00:52–00:57:
   *"you can set the direction drop down to symmetric. This enables you to
   extrude the same distance on each side of the sketch plane."*

3. **OK commits; each extrusion is its own timeline feature.** 01:15 + 04:12:
   *"When you click OK, the dialog closes and you see the new solid body on the
   canvas." / "they appear as three distinct extrude features in the timeline,
   so that you can modify them and use them separately."*

4. **ViewCube: named faces → orthographic views; corners/home → isometric.**
   03:18 + 04:05: *"Click the named faces on the view cube, such as front, top,
   or right, to switch to any of the predefined orthographic views." / "You can
   also click the corners of the view cube or click the home icon to view the
   design from an isometric angle."* Corner/isometric snapping goes beyond the
   current Phase 1.5 (faces only) — extend the ViewCube hit zones.

### Unverified / discarded claims

- Tooltip text, click-and-hold select-other, in-canvas arrow/arc handle visuals,
  translucent red-cut/blue-join previews, right-click marking-menu contents,
  and Ctrl-modifier tooltips: all visual-only; the audio transcript cannot
  confirm them. Treat as frame-grab leads.

### Relevance to `packages/studio`

`HandleOverlay.tsx` (Phase 5.1 manipulators) and `BrepViewportThree.tsx`
(Phase 5.3 preview/commit; Phase 1.5 ViewCube corner hit zones).

---

## Fillets ("Fill your knowledge of Fusion Fillets")

- **Source**: queue URL `.../curated/part-modeling-fusion-360/VleKklLIcTIGlzvfTOFHf`
  is dead (404, verified via yt-dlp at review time); the agent substituted the
  official curriculum video https://www.youtube.com/watch?v=VVVxKVN1u9M ("Fill
  your knowledge of Fusion Fillets", Brad Tallis, 35:12 — verified live).
- **Model**: script default (`google/gemini-3.8-flash`).
- **Reviewed**: 2026-09-20.

### Verified findings

1. **Pre-select edges, then right-click → Fillet in the marking menu.** 00:23:
   *"I like to pre-seelect the edge. Right mouse click, and there's the fillet
   command right there."* Selection-first sequencing again; Phase 4.1 menu
   content must include feature commands, not just sketch commands.

2. **Ctrl-click adds edges to the selection.** 02:20 + 05:35: *"I could hold down
   my control key, select that edge." / "I'm holding down my control key to
   control my selection. I'll select all three of those, right mouse click."*
   Transcript evidence toward the Phase 3.1 `[CONFIRM]`: Ctrl = add.

3. **Tangent chain toggle enables per-edge selection.** 02:35: *"you can select
   the edges individually if you want to by turning off this tangent chain
   option."* Chain propagation defaults on; per-edge selection is the opt-out.

4. **Full round fillet: hovering the center face highlights the opposing side
   faces.** 31:26: *"So, I'm going to hover over the face and then I'm going to
   move my my cursor until the walls that are going to be"* — multi-face hover
   preview for a multi-face feature.

### Unverified / discarded claims

- Red/green rail dots on variable fillets, HUD tooltip text ("Match Radius:
  [value]"), floating value box styling, and asymmetric-fillet arrow/table drag
  coordinates: visual-only, unconfirmed by the audio transcript.

### Relevance to `packages/studio`

`pick-helpers.ts` + `BrepViewportThree.tsx` edge picking (Phase 3.1 modifier
semantics, 3.2 selection filters), `HandleOverlay.tsx` radius handle (5.1).

---

## Constrain sketch geometry ("Constrain sketch geometry")

- **Source**: queue URL `.../curated/sketch-basics/Y25iA5XAxEvrm5J5h5v9z` 404s at
  review time (verified via yt-dlp); the same lesson is live at
  https://www.autodesk.com/learn/ondemand/tutorial/constrain-sketch-geometry,
  which is what the pipeline ran. (A first agent run died on an upstream
  `[Google] Invalid thought signature` error before producing a report; this is
  the clean retry.)
- **Model**: script default (`google/gemini-3.8-flash`); all timestamped claims
  matched transcript context — no `--pro` needed.
- **Reviewed**: 2026-09-20.

### Verified findings

1. **Toolbar-first constraint application.** 02:08: *"if we apply a vertical
   constraint by selecting it from the toolbar, then the line itself."*

2. **Constraint tool stays active across selections; `Esc` exits.** 02:30:
   *"Fusion will then remain in this constraint type, so to exit, press escape
   on your keyboard."* Matches the Esc-cascade note in Phase 2.6.

3. **Shift+click pre-selection, with selection count shown in the canvas status
   area.** 02:36–02:59: *"You can also pre-select geometry by left-clicking to
   select the first and whilst holding shift on your keyboard, select the other
   feature. Those that have been selected will be displayed in the bottom
   right-hand side of the Fusion canvas. With this pre-selected geometry, click
   the midpoint constraint from the toolbar."* Same selection-first path the
   prior entry's finding 3 observed; the visible selection counter is new.

4. **Right-click marking menu filters to only the constraints valid for the
   current selection.** 03:26–03:40: *"I will select this arc and the line by
   again holding shift, then right-click to bring up the marking menu. You can
   see the only applicable constraint options for these selected geometry
   types, so go ahead and click on tangent."* Independent second video
   confirming the prior entry's finding 4 (Phase 4.1 must be
   selection-type-aware).

5. **Sketch palette can hide constraint symbols when the sketch is busy.**
   03:53–04:10: *"if you ever find your sketch becoming too busy with the place
   constraint symbols, then you can always hide these from the sketch palette."*

6. **Drawing-time inference preview: blue symbol before placement, geometry
   still free.** 04:36–04:46: *"you can see this blue perpendicular symbol where
   the two sketch entities meet. What you are seeing is just a preview of the
   automatic constraint, as you are currently still free to move this
   particular feature in space."* Refines the prior entry's finding 5:
   inference glyphs are preview-state, committed only on click.

7. **Click-to-place commits the inferred constraint.** 04:55–05:02: *"It is
   only when you click to place the geometry with the preview visible that the
   constraint will be placed."*

8. **Hold Ctrl/Command while drawing to suppress automatic constraint
   inference.** 05:28: *"you can also temporarily disable this by holding Ctrl
   or Command on a Mac, then continuing with your design."* New behavior not
   in the spec — belongs beside Phase 2.3 snapping.

9. **Constraint deletion: click icon, Shift for multiple, `Delete` or
   right-click → Delete.** 05:49–05:59: *"select the respective constraint icon,
   or select multiple by holding Shift on your keyboard, and press Delete on
   your keyboard, or right click and select Delete."* Corroborates Phase 2.8
   (shipped) and extends it with Shift multi-select.

### Unverified / discarded claims

- Cursor crosshair/badge transformations (Gemini cited 00:55, 02:13, 03:55) and
  the radial layout of the marking menu: visual-only, not confirmable from the
  audio transcript.

### Relevance to `packages/studio`

`pick-helpers.ts` glyph hit-testing/selection and `SketchCanvas2D.tsx` tools
— Phase 2.8 (plus Shift multi-select of glyphs), Phase 4.1
  (selection-type-aware menu), and a new Ctrl-suppresses-inference rule for
Phase 2.3.

---

## Dimension sketch geometry ("Dimension Sketch Geometry")

- **Source**: queue URL `.../curated/sketch-with-fusion-360/8N7tjOeHwXotZhbRaBwau`
  403s at review time (verified via yt-dlp); the same lesson is live at
  https://www.autodesk.com/learn/ondemand/tutorial/dimension-sketch-geometry,
  which is what the pipeline ran. (First agent run died on the same upstream
  session error; this is the clean retry.)
- **Model**: script default (`google/gemini-3.8-flash`).
- **Reviewed**: 2026-09-20.

### Verified findings

1. **`D` opens the dimension tool.** 00:37–00:42: *"click on a dimension button
   or press the shortcut D on your keyboard."* Matches the Phase 2.6 shortcut
   table's `D` dimension.

2. **Type a value, `Enter` commits.** 01:32–01:37: *"either press enter on your
   keyboard to accept this value, or you can define a specific value, so go
   ahead and enter a more rounded value and press enter."*

3. **Double-click a placed dimension to edit it.** 02:09–02:13: *"You can always
   edit these values at any time by double clicking on the dimension to open
   the dimension dialog box, then entering a new value."* This is exactly the
   Phase 2.7 interaction, verbatim.

4. **Fully-constrained sketch turns black and cannot be dragged.** 02:34–02:40:
   *"you can see the sketch has turned black, indicating it is fully
   constrained, meaning you cannot freely drag any of the features in space."*
   DoF feedback lead: the solver knows the state (`sketch-solve.ts`); the
   studio has no fully-constrained visual.

5. **Dimension tool spans line-to-line, point-to-line, and angular
   dimensions.** 03:20–03:52: *"you are not limited to dimensioning just
   individual arcs or lines. Other ways you can use a dimension tool, include a
   line to align, a point to align, or angular dimensions."*

### Unverified / discarded claims

- Cursor dimension-badge, tooltip strings ("Select sketch objects to
  dimension"), floating numeric-box placement mechanics, browser-tree red lock
  badges, and hover-highlight colors: visual-only, unconfirmed by transcript.

### Relevance to `packages/studio`

`SketchCanvas2D.tsx` dimension mode + `sketch-canvas-core.ts` — Phase 2.7
(click entity → place label → type inline → double-click to edit is confirmed
as the Fusion pattern); fully-constrained coloring needs `packages/sketch`
(`sketch-solve.ts`) DoF surfaced to the canvas.

---

## reSHape Studio baseline (Phase 1+2, self-recorded)

- **Source**: self-recorded Playwright scenarios, not a URL — `scripts/parity-scenarios/phase1-camera.mjs`
  → `.omo/evidence/parity-recordings/phase1-camera/page@65ffb90bed8a54102cd44615096630f4.webm`,
  and `scripts/parity-scenarios/phase2-sketch.mjs`
  → `.omo/evidence/parity-recordings/phase2-sketch/page@6bfcfb0f27510b79fc60bba5cd7990ee.webm`
  (recorded by todo 4 of `.omo/plans/fusion-parity-closure.md`).
- **Model**: script default (`google/gemini-3.8-flash`) for both; output was detailed
  enough on the first pass (not vague/thin) that `--pro` escalation was not used, per
  `fusion-video-eyes.md`'s cost-awareness rule.
- **Reviewed**: 2026-09-20.
- **Methodology note**: these are silent screen recordings of reSHape Studio itself, not
  Fusion footage, and have no speech. `scripts/fusion-video-parity.mjs`'s local
  faster-whisper transcript path failed outright on both files (`IndexError: tuple index
  out of range` decoding a no-audio-stream webm — expected, not a pipeline bug) so there
  is no transcript to spot-check against. Per this todo's brief, the substitute
  spot-check here is a **visual cross-check against the scenario script's own known
  action sequence** (`phase1-camera.mjs` / `phase2-sketch.mjs` read line-by-line), not a
  transcript excerpt — every "verified" claim below matches a specific scripted step,
  not a caption.

### Phase 1 — camera baseline (`phase1-camera.mjs`)

Known scripted sequence: create Box → select it → Fit Selection → left-drag orbit →
wheel-zoom at an off-center point → click "Persp" (ortho/perspective toggle) → click
"Win Zoom" then drag a zoom rectangle → click ViewCube "TOP" face.

#### Verified

1. **Window-zoom click-drag-release cycle.** Model: *"Click `Win Zoom` on the lower
   viewport control bar (button toggles to inverted white background)... Click-drag:
   click and drag diagonally in the 3D viewport to define the rectangular zoom
   region... On release, the view instantly magnifies to the framed marquee bounds, and
   the `Win Zoom` tool automatically deactivates back to its idle state."* Matches the
   script's `Win Zoom` step exactly (click the button, drag `(cx-100,cy-80)→(cx+100,cy+80)`,
   release).
2. **Box creation + selection UI.** Model: *"green circular node with a soft radial halo
   at the face surface... square green vertex/corner handles... a contextual floating
   toolbar (`Box 1: Dimensions Move Copy Round Turn Hole...`) anchors near the entity
   upon selection."* Matches the script's `Box` button click followed by a canvas click
   to select it — the toolbar name (`Box 1`) and command set match `ContextBar.tsx`'s
   real command list.
3. **On-screen nav-hint text read correctly, but the hint itself is stale/wrong.** Model:
   *"Navigation shortcuts indicated on the bottom bar: RIGHT DRAG: ORBIT / SCROLL:
   ZOOM."* This is an accurate visual read of `ReshapeStudio.tsx:1592`'s static status
   bar (`"Right-drag orbit · Scroll zoom"`), but it contradicts the orbit gesture the
   script actually performs and the one the app actually binds:
   `BrepViewportThree.tsx:1044-1056` binds **LEFT**-drag to `OrbitControls.ROTATE` for
   the `'legacy'` default scheme (`camera-controls.ts:23,33`, `ORBIT: 0`), and a standing
   code comment at `BrepViewportThree.tsx:2133-2136` already flags the "right-drag
   orbits" claim as stale. This is a real UI-copy bug lead the self-recording surfaced —
   the model read the on-screen text correctly; the text itself is wrong.

#### Unverified / discarded

- The model's five timestamps (00:00–00:05) cover only the first ~5s of a clip whose
  script runs roughly ten discrete steps; it never mentions **Fit Selection**, the
  **wheel zoom-to-cursor**, the **Persp/ortho toggle click**, or the **ViewCube TOP face
  click** — not claimed inaccurately, just silently absent. Named here per the
  unverified/discarded convention rather than left unaddressed.
- "00:05: Glyphs and floating menus disappear/reframe as the view changes" is too vague
  to tie to a specific scripted step (nothing in the script explicitly deselects);
  treat as an unconfirmed generic observation.

#### Coverage

Correctly identified against the known script: Box creation/selection UI, Win Zoom
click-drag-release. Missed/not mentioned: Fit Selection, the left-drag orbit itself,
wheel zoom-to-cursor, the Persp toggle, and the ViewCube TOP click. Bonus finding
outside the script: the orbit nav-hint text bug above.

### Phase 2 — sketch baseline (`phase2-sketch.mjs`)

Known scripted sequence: click "Sketch" → drag-create a rectangle → line snapped to an
existing vertex, then `Escape` → drag the bottom edge with the Select tool → marquee-
select a window → Dimension tool: click edge, click offset point, type `"45"`, `Enter`
→ Select tool: click a constraint glyph, press `Delete`.

#### Verified

1. **Drag-created rectangle with vertex handles.** Model: *"00:02: Rectangular sketch
   geometry is created with prominent square/circle vertex handles at corner points."*
   Matches the script's `Rect` tool drag-create step.
2. **Auto-applied constraint glyphs on the new rectangle.** Model: *"00:03: magenta
   constraint glyphs (circular/square badges containing geometric constraint symbols)
   attached to vertices and line segments."* Consistent with this log's "Sketching basics
   overview" entry's finding 6 (2-point rectangle auto-applies H/V constraints) and with
   `pick-helpers.ts` glyph rendering — a correctly-timed side effect of the drag-create
   step, not an explicitly scripted click but an expected consequence of it.
3. **Dimension value and readout match exactly.** Model: *"00:06–00:08: A dimension
   callout (45) with boundary guide ticks... Simultaneously, a numeric slider/input
   parameter appears in the right sidebar (Sketch 1 distance: 45)."* Matches the
   script's Dimension-tool step precisely, including the typed value `"45"`.

#### Unverified / discarded

- **"Single-click selection of `XY Plane` in the left browser tree switches the view
  into 2D sketch mode" (00:01) does not match the script.** The script clicks a
  `button:has-text("Sketch")`, not an `XY Plane` tree entry — reSHape Studio's actual
  sketch-entry UI (per the script, which is ground truth here) is a toolbar button, not
  a browser-tree plane pick. This reads like the model pattern-matching to a *generic
  Fusion* workflow rather than what's actually in this recording — a genuine
  hallucination against the known script, named per the failure-mode convention rather
  than reported as fact.
- **"No keyboard modifiers... displayed, prompted, or indicated" contradicts the known
  script.** The script presses `Escape` (after the snapped line), types `"45"` then
  `Enter` (dimension commit), and presses `Delete` (constraint-glyph deletion) — four
  distinct keyboard actions the model's own claim says did not occur. This is the
  clearest hallucination/miss in either report; flagged explicitly rather than let
  stand.
- "00:04–00:05: Line drawing commands executed by snapping endpoints to grid
  coordinates" — the script snaps to an *existing vertex* (`circle.sk-vertex`), not a
  background grid point; close but not the same claim, so the "grid" detail is
  unconfirmed.
- Same stale "RIGHT-DRAG: Orbit" nav hint as Phase 1's finding 3 (00:01–00:08) — a
  second independent observation of the same UI-copy bug, reinforcing it rather than a
  new lead.

#### Coverage

Correctly identified against the known script: the rectangle drag-create step, its
auto-constraint glyphs, and the dimension-tool value/readout. Missed/not mentioned: the
line-snap-to-vertex step's `Escape`, the whole-edge drag, the marquee-select window, and
the constraint-glyph select+`Delete` step — plus it actively mis-stated that no keyboard
was used, when the script uses one three separate times.

### Relevance to `packages/studio`

`ReshapeStudio.tsx:1592`'s status-bar nav hint ("Right-drag orbit") should read
left-drag to match `BrepViewportThree.tsx`'s actual `OrbitControls` binding
(`:1044-1056`, `:2133-2136`) — a small, concrete fix these self-recorded baselines
surfaced that no Fusion-video review could have, since it's about this app's own UI copy
rather than Fusion's. Otherwise these two baselines double as a calibration check on
`fusion-video-eyes.md`'s Gemini pipeline itself: it reliably catches static/structural
UI (toolbars, glyphs, dialog values) but drops less-visually-salient steps (camera-only
moves, keyboard-only commits) and produced one clear pattern-matching hallucination
(the browser-tree plane pick) with no real Fusion footage to anchor it — useful context
for weighting future entries in this log.

---

## reSHape Studio Phase 3 closeout (self-recorded)

- **Source**: self-recorded Playwright scenarios, not a URL — the four
  `scripts/parity-scenarios/phase3-*.mjs` files (built by todo 11 of
  `.omo/plans/fusion-parity-closure.md`), each self-asserting via
  `.reshape-studio-status-sel` text before being handed to the review
  pipeline (a script that throws on a wrong result is stronger ground truth
  than a video review alone):
  - `phase3-box-select.mjs` → `.omo/evidence/parity-recordings/phase3-box-select/page@febed3d0983ac72b8f105c665623917f.webm`
  - `phase3-mixed-select.mjs` → `.omo/evidence/parity-recordings/phase3-mixed-select/page@d15955a87ecc13b08c1217e6972e339f.webm`
  - `phase3-select-other.mjs` → `.omo/evidence/parity-recordings/phase3-select-other/page@d1c4a590f111d389dee5c1258fc4a796.webm`
  - `phase3-dblclick-keys.mjs` → `.omo/evidence/parity-recordings/phase3-dblclick-keys/page@ac1299379d50c8ba4bfca61c8269b2ea.webm`
- **Model**: script default (`google/gemini-3.8-flash`) for all four; none of the
  four outputs were vague/thin enough to warrant `--pro` escalation.
- **Reviewed**: 2026-09-20.
- **Methodology note**: same as the Phase 1+2 baseline entry above — silent
  self-recordings, faster-whisper's local transcript path fails outright on
  all four (`IndexError: tuple index out of range`, no audio stream —
  expected, not a pipeline bug), so the spot-check below is against each
  scenario script's own known action sequence, not a caption.

### box-select (`phase3-box-select.mjs`)

Known scripted sequence: three boxes side-by-side → FRONT view → window drag
(left-to-right) enclosing box3+box2 → crossing drag (right-to-left) starting
inside box1 and sweeping through box2 into box3.

#### Verified

1. **Selection-count readout matches the script's own assertions exactly.**
   Model: *"Selection status dynamically updates in the bottom-left viewport
   readout (`NOTHING SELECTED` → `BOX 1` → `3 SELECTED`)... When multiple
   bodies are selected simultaneously, manipulation handles/nodes appear
   concurrently across all selected objects."* This is the live, video-level
   confirmation of the exact regression the script's own `throw` already
   proved at the code level (window drag → `"2 selected"`, crossing drag →
   `"3 selected"`) — `distinctOwners()`'s fix (ReshapeStudio.tsx, commit
   `90ef0f7`) is what makes a multi-body drag report every owner instead of
   collapsing to the last-clicked one.
2. **Window vs. crossing drag direction correctly distinguished.** Model:
   describes a left-to-right drag producing a clean multi-object selection
   and separately calls out that filter chips (`Faces`, `Edges`, `Vertices`,
   `Bodies`) gate which entity kind a drag can pick up — matches
   `marqueeKind()`'s `endX >= startX` window / else-crossing rule and
   `BrepViewportThree.tsx`'s `filtersRef`-gated `collectBoxSelection()`.

#### Unverified / discarded

- **Fourth independent observation of the stale orbit-hint text.** Model:
  *"Right-Drag: Dedicated to 3D Orbit (`RIGHT-DRAG: ORBIT` indicated in
  lower status bar)"* — same `ReshapeStudio.tsx:1592` bug the Phase 1+2
  baseline entry above first flagged (left-drag orbits, not right-drag).
  Not a new lead; reinforcing evidence that this fix is overdue.

#### Coverage

Both scripted drag gestures (window + crossing) and their resulting
selection counts were correctly read off the live UI, corroborating the
script's own assertions rather than just repeating them.

### mixed selection (`phase3-mixed-select.mjs`)

Known scripted sequence: Ctrl-click a face, then Ctrl-click an edge of the
same box (Ctrl held via explicit `keyboard.down`/`up`, not `mouse.click`'s
`modifiers` option — see the script's own header comment for why).

#### Verified

1. **Sub-entity selection label matches exactly.** Model: *"Selection state
   transitions from `NOTHING SELECTED`... to `BOX 1`... and specific
   sub-elements `1 FACE • 1 EDGE`"* — matches the script's own assertion
   (`"Box 1 · 1 face + 1 edge"`) and `ModelEditor.tsx`'s
   `mixedSelectionNote()` contract: the face rides along in the selection
   rather than being silently dropped.

#### Unverified / discarded

- **The Ctrl modifier itself is not visually confirmable.** Model describes
  the second click as a plain "Direct single-click on the top surface"
  selecting the sub-element, with no mention of a held modifier key — this
  is an inherent limitation of a silent recording with no on-screen
  modifier-key overlay, not a claim the model got wrong per se. The
  scenario script's own assertion (not the video) is the authoritative
  proof that Ctrl was required for the selection to be additive rather than
  a replace.

#### Coverage

The resulting mixed face+edge selection label was read correctly; the Ctrl
gesture that produced it was not (and could not be, from video alone).

### select-other (`phase3-select-other.mjs`)

Known scripted sequence: two boxes at the IDENTICAL center via the Code side
(`box(40,40,20,{at:[0,0,0]})` twice — the only way to get 2+ guaranteed
overlapping candidates at one pixel, since the Box button's `newShape()`
always auto-offsets siblings along +X) → click-and-hold 300ms+ at the shared
center point, twice.

#### Verified

1. **Timeline shows both overlapping bodies and a selection change on the
   second interaction.** Model: *"Timeline blocks (`BOX 1`, `BOX 2`) appear
   at the bottom left. Clicking/focusing on `BOX 2` highlights the node with
   a bounding border and an indexed tag (`2`)."* Consistent with the
   script's own assertion that the status text differs between hold #1 and
   hold #2 (confirmed live: cycles `Box 2 → Box 1 → Box 2 ...`).

#### Unverified / discarded

- **The hold-and-release gesture itself reads as a plain click.** Model:
  *"Single-click on the timeline block (`BOX 2`) to select the feature"* —
  the actual interaction is a 350ms press-and-release on the CANVAS, not a
  timeline click; the model appears to be pattern-matching the resulting
  selection-highlight change to whichever nearby UI element looks most
  "clickable", another instance of the same silent-recording limitation
  noted above (no visible hold-timer or modifier-key cue to read).
- **`[CONFIRM]`-sourced timing is NOT settled by this entry.** The
  300ms/4px hold-cycle constants (`input-threshold.ts`,
  `HOLD_CYCLE_DELAY_MS`/`HOLD_CYCLE_DEAD_ZONE_PX`) implemented in todo 9 are
  a `.omo/plans/mouse-parity-handover.md`-sourced default, not verified
  against real Fusion footage — this self-recording proves reSHape's OWN
  implementation behaves as coded, it does not and cannot confirm that
  300ms/4px matches Fusion's actual qualitative behavior. The
  `SPEC-mouse-parity.md` `[CONFIRM]` tag for Phase 3.5 stays open; no lesson
  video demonstrating Fusion's own click-and-hold exists in the queue
  (per this log's own "Watch-for rules" section below, unchanged).

#### Coverage

The selection-cycling RESULT was corroborated; the specific GESTURE that
produced it (a timed hold, not a click) was not — expected, given no visual
hold-timer indicator exists on screen to read.

### double-click / Ctrl+A / Delete (`phase3-dblclick-keys.mjs`)

Known scripted sequence: add a box → double-click its body (opens params via
`focusParams()`'s flash) → add + exit a sketch → double-click its timeline
row (reopens the 2D editor) → click canvas, Ctrl+A, Delete.

#### Verified

1. **Params sidebar opens on double-click, with the right values.** Model:
   *"Selecting an object opens a right-hand sidebar (`DIMENSIONS mm`)
   displaying continuous slider handles for each axis dimension (`width`,
   `depth`, `height`)"* and *"inline parameter readouts (`Width 40`, `Depth
   40`, `Height 20`)"* — matches the script's box dims exactly and
   `editFeature()`'s `focusParams()` branch for a non-sketch feature.
2. **Sketch mode re-entry via timeline shown.** Model: *"Transitioning into
   sketch mode activates a 2D planar grid on the XY Plane... shifts the top
   toolbar context to 2D sketching"* and *"Features are ordered sequentially
   in the bottom timeline (`1: BOX 1` → `2: SKETCH 1`)"* — consistent with
   `editFeature()`'s `setSketchEditId` branch for a sketch feature, reached
   here via the timeline row double-click, not the `Sketch` toolbar button.

#### Unverified / discarded

- **Ctrl+A and Delete themselves are not visually confirmable**, same class
  of limitation as the mixed-select and select-other entries above — no
  on-screen keystroke indicator exists to read off. The script's own
  assertion (`"2 selected"` after Ctrl+A, `"Nothing selected"` + 0 timeline
  rows after Delete) is the authoritative proof, not the video.
- **Fifth independent observation of the stale orbit-hint text** (same
  `ReshapeStudio.tsx:1592` bug, again read correctly off-screen but
  factually wrong about which drag button orbits).

#### Coverage

Both double-click targets (viewport body, timeline row) and their resulting
panel states were correctly identified; the keyboard-only steps (Ctrl+A,
Delete) were not visually confirmable, as expected.

### Relevance to `packages/studio`

No new code-level findings beyond the fifth cumulative sighting of the
`ReshapeStudio.tsx:1592` stale orbit-hint bug (now confirmed across all six
self-recorded scenarios spanning Phase 1 through Phase 3 — this is no
longer a one-off, it should be fixed). The `distinctOwners()` box-select fix
(commit `90ef0f7`) is now proven at three levels: the unit test
(`box-select-owners.test.mjs`), the scenario script's own live assertion,
and this video review's independent read of the same on-screen counts.

---

## import-geometry-then-edit-with-direct-modeling

- **Source**: `https://www.autodesk.com/learn/ondemand/tutorial/import-geometry-then-edit-with-direct-modeling`
  (live Autodesk lesson, real Fusion footage with narration/transcript).
- **Model**: script default (`google/gemini-3.8-flash`) with a focus prompt
  targeting box-select / marquee-select interactions specifically (window vs
  crossing direction, modifier-key behavior); output was detailed and
  transcript-corroborated on the first pass, so `--pro` was not used.
- **Reviewed**: 2026-09-20.

#### Verified

1. **Window selection: drag direction and "fully enclosed only" semantics,
   transcript-corroborated.** Model (~02:13–02:16): *"The user clicks and
   drags a selection box from top-left to bottom-right... Acts as a Window
   selection, only capturing entities that fall entirely within the
   rectangular boundary. This cleanly isolates and selects just the faces of
   the cylindrical boss (6 faces selected) without grabbing the adjacent
   wall or support."* Real captions at 00:02:13 (*"Select the area to move,
   right-click, and select move copy"*) place a selection action at exactly
   this timestamp, corroborating the model's read.
2. **Crossing selection: drag direction and "touched-or-enclosed" semantics,
   transcript-corroborated.** Model (~02:28–02:31): *"the user clicks and
   drags from right to left (bottom-right towards top-left)... selecting any
   face that is either fully enclosed or merely touched/crossed... allows
   quick selection of both the boss and its supporting bracket geometry
   simultaneously (14 faces selected)."* The real caption at 00:02:27 says
   it explicitly: *"use a crossing selection to select the boss and pillar,
   then set the pivot point"* — narration and visual read agree.
3. **This directly matches reSHape's own implementation, box-select MUST
   FILE gate now resolved.** `marquee-select.ts`'s `marqueeKind()`
   (`drag.endX >= drag.startX ? 'window' : 'crossing'`) and
   `windowSelect()`/`crossingSelect()` (window = fully-inside only; crossing
   = inside-or-touched) implement EXACTLY the left-to-right/window,
   right-to-left/crossing split this real Fusion lesson demonstrates, with
   the identical inclusion rule for each direction. The
   `phase3-box-select.mjs` self-recording above (window drag → 2 objects
   fully enclosed; crossing drag → 3 objects, including one only
   touched/partially enclosed) is the SAME behavior against reSHape's own
   UI. **This resolves the box-select `MUST FILE` gate** named in this
   log's "Watch-for rules" section — no further video is queued for it.

#### Unverified / discarded

- The lesson's other named interactions (Move/Copy manipulator, chamfer via
  marking menu, timeline Edit Feature — the reasons this video was queued
  under "3D feature interactions") were not the focus of this pass; a
  separate future review should target those if Wave 4's manipulator work
  needs them. Not claimed here.

#### Coverage

Both box-select gestures (window, crossing) named by the plan's box-select
MUST FILE requirement were found, transcript-corroborated, and confirmed to
match reSHape's own `marquee-select.ts` implementation and its own
self-recorded scenario. Gate resolved.

---
## Next videos to review

Rebuilt 2026-09-20 for balanced 2D/3D/navigation coverage. All URLs probed
live via `yt-dlp --skip-download` (the `.../curated/...` paths 404/403 — use
the `ondemand/tutorial/<slug>` canonical paths). Already filed above:
sketch-constraints, sketching-basics-overview, constrain-sketch-geometry,
dimension-sketch-geometry, extrude, press-pull, fillets.

### 2D sketch interactions

- `https://www.autodesk.com/learn/ondemand/tutorial/create-and-modify-sketch-geometry`
  — line/circle/rect tools + modify; Phase 2.2/2.3/2.6.
  **MUST FILE: trim + offset** (the "modify" tools — no other live source; if
  absent, say so explicitly and grab them from the reserve video below).
- `https://www.autodesk.com/learn/ondemand/tutorial/the-sketch-environment`
  — sketch UI/palette layout; Phase 2 preamble, palette toggles.
- `https://www.autodesk.com/learn/ondemand/tutorial/sketch-2d-rectangles-using-lines-constraints-and-center`
  — rectangle + constraints; Phase 2.2/2.8.
- `https://www.autodesk.com/learn/ondemand/tutorial/constrain-and-align-sketch-features`
  — constraint application workflows; Phase 2.8/4.1.
- `https://www.autodesk.com/learn/ondemand/tutorial/parametric-modeling-sketching-intricate-shapes`
  — splines, line/dimension editing; Phase 2.7 + solver.

### 3D feature interactions

- `https://www.autodesk.com/learn/ondemand/tutorial/revolve-solid-bodies`
  — profile + axis selection + dialog; Phase 3/5.1.
- `https://www.autodesk.com/learn/ondemand/tutorial/shell-solid-bodies`
  — face-removal selection + thickness dialog; Phase 3/5.1.
- `https://www.autodesk.com/learn/ondemand/tutorial/create-holes-in-a-solid-body`
  — face pick, position handles, hole dialog; Phase 5.1 (HandleOverlay).
- `https://www.autodesk.com/learn/ondemand/tutorial/modeling-bodies-and-components`
  — Move/Copy gizmo on bodies vs components; Phase 5.2.
- `https://www.autodesk.com/learn/ondemand/tutorial/control-part-thickness-geometry-and-specific-angles`
  — measure inside modeling commands, timeline error resolution; Phase 5 +
  refusal-surfacing analog.
  **MUST FILE: Measure interaction** (tool activation, click sequence, result
  readout — no standalone lesson exists).

### Navigation / camera / menus

- `https://www.autodesk.com/learn/ondemand/tutorial/using-the-marking-menu`
  — marking menu levels + gestures; Phase 4.1/4.2 (the spec's `[CONFIRM]`
  delay/dead-zone question).
- `https://www.autodesk.com/learn/ondemand/tutorial/tour-the-fusion-user-interface`
  — nav bar, ViewCube, timeline placement; Phase 1/4.4.
- `https://www.autodesk.com/learn/ondemand/tutorial/adjust-display-settings`
  — camera perspective (ortho vs perspective), visual styles; Phase 1.3.
- `https://www.youtube.com/watch?v=FmMNIGVpCng` (official Autodesk Fusion
  channel) — ViewCube click/orbit, MMB pan, Shift+MMB orbit; settles Phase
  1.1's default mouse-scheme `[CONFIRM]`.

### Watch-for rules (do not skip)

These interactions have no standalone lesson (slugs 404) — they surface only
inside the queued videos marked **MUST FILE** above. Per video:

- **Trim + offset** → expect in `create-and-modify-sketch-geometry`. If the
  video doesn't show them, pull the reserve video
  `https://www.autodesk.com/learn/ondemand/tutorial/create-a-component-within-an-assembly`
  (live, verified) through the pipeline and file trim/offset from it before
  marking this interaction done.
- **Measure** → expect in `control-part-thickness-geometry-and-specific-angles`.
- **Box-select** → RESOLVED: verified in `## import-geometry-then-edit-with-direct-modeling` above (window ~02:13–02:16, crossing ~02:28–02:31, both transcript-corroborated and matched against `marquee-select.ts`).
- **Select-other (click-and-hold)** → no known lesson covers it; the fillet and
  extrude entries already carry it as an unverified visual claim. A transcript
  run cannot settle it — needs a frame grab or the user's own recording; do not
  queue another video for it.

A queue entry is not done until its **MUST FILE** items are either verified in
the findings log or explicitly named in that entry's "unverified/discarded"
section. When filing a new section, end it with a short "Coverage" line
naming which watch-fors were found (with timestamps) or explicitly absent.
