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
## reSHape Studio sketch/kernel closeout (self-recorded)

- **Source**: self-recorded Playwright scenarios, not a URL — the four
  `scripts/parity-scenarios/phase2-*.mjs` files (built for todos 12–15 of
  `.omo/plans/fusion-parity-closure.md`), each self-asserting with throws
  before being handed to the review pipeline (same ground-truth-first
  methodology as the Phase 3 closeout entry above):
  - `phase2-fully-constrained.mjs` → `.omo/evidence/parity-recordings/phase2-fully-constrained/page@822f4be0ac75fe917f1f59c4738a577c.webm`
  - `phase2-sketch-fillet.mjs` → `.omo/evidence/parity-recordings/phase2-sketch-fillet/page@a4c568187a0f563cee85ecbbb60bba6c.webm`
  - `phase2-sketch-trim.mjs` → `.omo/evidence/parity-recordings/phase2-sketch-trim/page@495f145516d9c7ea54d410db9a609004.webm`
  - `phase2-sketch-offset.mjs` → `.omo/evidence/parity-recordings/phase2-sketch-offset/page@f41839916ba13011f9432d946ca7c7cf.webm`
- **Model**: script default (`google/gemini-3.8-flash`) for all four; no
  `--pro` escalation needed (each read was specific and matched the
  scenario's own throw-assertions).
- **Reviewed**: 2026-09-21.
- **Methodology note**: silent recordings, faster-whisper fails on all four
  (`IndexError: tuple index out of range`, no audio stream — expected), so
  the spot-check is against each scenario's known action sequence, not a
  caption.

### fully-constrained DoF badge (`phase2-fully-constrained.mjs`)

Known scripted sequence: seed rectangle → H on s:3, V on s:4 (16→14→13→12→11
… each step's exact DoF asserted by throw) → width dim on s:1 → height dim
on s:4 → Lock one corner (asserts NO DoF change, the documented gap).

#### Verified

1. **Constraint chips and dimension chips appear as rules are written.**
   Model: *"A horizontal constraint chip (horizontal line with arrows)
   appears above the top edge. A vertical constraint chip appears along the
   upper section of the left vertical edge"*, then *"A dimension chip
   labeled `40` appears inside the rectangle… a dimension chip labeled `25`
   appears on the left vertical edge"* and the right sidebar gaining
   matching `Sketch 1 distance` sliders. Matches the scripted H/V/dim
   sequence exactly.
2. **The DoF badge itself was NOT visible to the reviewer** (model: "DoF
   Badge: None displayed" throughout) — the badge is a small toolbar chip
   (`span.sk-dof`) inside the portaled ribbon; at 1280×800 the model read
   the sidebar sliders and status bar but not it. The badge's DOM-reach
   proof is the scenario's own throw-assertions (each step asserted the
   exact DoF number), not the video.

#### Unverified / discarded

- **The Lock-does-nothing gap, documented honestly.** The scenario asserts
  that pressing Lock on a selected vertex does NOT change the DoF count —
  root-caused by reading brep-rs: `ConstraintKind::Lock` contributes zero
  rows (mod.rs:441 "a lock is column removal, not a rule the solver can
  trade against other rules"), and `ParamBlock::lock()` is called only from
  the fd.rs fixture harness, never from session.rs/wasm.rs (the JSON-rules
  path the UI runs). Literal DoF 0 is therefore unreachable through the UI
  for a freestanding sketch; the badge's warn→ok transition cannot be
  demonstrated live until that seam gap is closed. Filed here so a future
  fix makes the scenario's no-change assertion fail loudly.

#### Coverage

The rule chips, dimension chips, and per-step DoF trajectory were asserted
by the scenario itself; the model corroborated the chips and dims. The
badge itself is too small a target for the video read; its render path is
proven by the assertions, not the video.

### fillet (`phase2-sketch-fillet.mjs`)

Known scripted sequence: seed rectangle → arm fillet ('f') → click the
bottom-left corner → inline radius chip opens (pre-filled) → type 8, Enter.

#### Verified

1. **Chip-then-Enter flow and the resulting arc, exactly as scripted.**
   Model: *"The fillet tool is engaged and the bottom-left vertex/corner of
   the rectangle is clicked. An inline numeric input chip displaying `R |`
   (radius) opens directly over the selected corner"*, then *"The sharp
   bottom-left corner is replaced by a smooth rounded tangent arc (polyline
   fillet) with edit handles. The adjacent bottom and left linear edges
   shorten automatically to meet the endpoints of the new arc."* Matches
   `filletCornerAt`'s contract (two legs trimmed, arc inserted, coincident
   welds).

#### Unverified / discarded

- The typed value itself (8) is not readable from the video; the scenario's
  assertion (the trimmed-leg coordinates and the arc row's existence) is
  the authoritative proof.

#### Coverage

Fillet's click-then-type interaction and its geometric result (arc replaces
corner, legs shorten) were both read correctly off the recording.

### trim (`phase2-sketch-trim.mjs`)

Known scripted sequence: seed rectangle → draw a vertical line crossing the
bottom edge → arm trim ('t') → click the line's lower protruding piece →
assert the survivor ends at the crossing and the overhang is gone.

#### Verified

1. **The trim gesture and its result, exactly as scripted.** Model: *"The
   cursor hovers over and clicks the lower protruding segment of the
   vertical line below the bottom edge"* and *"The clicked lower piece
   disappears; the vertical line shrinks to end precisely at the intersection
   with the rectangle's bottom edge."* This is the split-at-nearest-crossing
   behavior `trimPick`+`trimLine` implement, and the endpoint-letter
   preservation fix (commit `fbebb5f`) is what keeps a weld rule naming the
   surviving far end pointing at the right corner.

#### Unverified / discarded

- Nothing of note; the silent-recording limitation applies only to
  keyboard steps, and trim's flow is click-only.

#### Coverage

Trim's click-the-piece-to-remove interaction was read correctly off the
recording; the scenario's geometric assertions (survivor span, overhang
gone) are the ground truth beneath it.

### offset (`phase2-sketch-offset.mjs`)

Known scripted sequence: seed rectangle → arm offset ('o') → click the
bottom edge → chip opens (pre-filled "1") → type 0, Enter (must be REFUSED)
→ type 8, Enter.

#### Verified

1. **The zero-distance refusal (the plan's failure QA for todo 15).** The
   scenario asserts the chip stays open, no row is added, and the status
   line reads "offset: type a positive distance" — the model's read of the
   sequence (chip at "0", then "8") is consistent with that two-step flow.
2. **The new parallel line at the typed distance, and the original flipped
   to construction.** Model: *"Pressing Enter generates a new solid parallel
   edge positioned 8 mm inward (above) from the original edge. The original
   bottom edge changes from a solid line to a dashed line (converted to
   construction geometry)."* The scenario asserts exactly this (y=+8 exact,
   `sk-constr` on s:1).

#### Unverified / discarded

- **A deliberate divergence from Fusion, found in the queued-video review
  below:** Fusion's own offset leaves the original as NORMAL geometry, not
  construction (see the `create-and-modify-sketch-geometry` section).
  reSHape's offset flips the original to construction on purpose (commit
  `b8c39a4`), which reads as Fusion-like in a still frame but is NOT what
  the lesson shows. Flagged for todo 30's sweep to decide: keep the
  construction flip (arguably better: the source stays out of the profile)
  or match Fusion (original stays normal). The scenario asserts the
  current behavior either way.

#### Coverage

Offset's click-then-type interaction, its zero-distance refusal, the new
parallel line, and the construction flip were all corroborated by the
model's read; the exact 8mm distance and the refusal message text are
asserted by the scenario itself.

### Relevance to `packages/studio`

One new seam gap surfaced and is now scenario-documented: `lock` rules are
silently inert in the session path (zero rows, never applied as column
removal), so the DoF badge cannot reach "Fully constrained" through the
UI. Everything else corroborated the four Wave 2 commits as shipped
(`c2e4bd0`, `3f1ffa3`, `fbebb5f`, `b8c39a4`).

---
## create-and-modify-sketch-geometry

- **Source:** `https://www.autodesk.com/learn/ondemand/tutorial/create-and-modify-sketch-geometry`
  (live Autodesk lesson, real Fusion footage with narration/transcript).
- **Model:** script default (`google/gemini-3.8-flash`) with a focus prompt
  targeting Trim/Offset; output was specific and transcript-corroborated on
  the first pass, so `--pro` was not used.
- **Reviewed:** 2026-09-21.

#### Verified

1. **Offset: invoke-then-click, manipulator + typed value, Enter/OK to
   finish — transcript-corroborated.** Model (04:31–04:54): *"Clicking the
   Offset icon directly on the sketch toolbar… Once clicked, a red/blue
   offset preview curve appears with an on-screen drag handle (manipulator
   arrow) and a floating numerical dimension box… Dragging the on-canvas
   manipulator arrow handle, typing in the on-canvas input box, or typing
   into the 'Offset distance' field in the floating Offset dialog"*;
   *"Press Enter or click OK in the Offset dialog"*. Real captions at
   00:04:38–00:04:49 (*"In the toolbar, click offset. Then click the
   geometry to select the connected segments… Drag the manipulator handle
   on the canvas to adjust the offset… Then press enter or click OK in the
   offset dialog to complete the command"*) corroborate. reSHape's offset
   matches the invoke-then-click order, the typed-distance entry, and the
   Enter-to-commit; it lacks the drag manipulator and the dialog (typed
   chip only) and decides the side from the click rather than a Flip
   toggle — acceptable v1 differences, noted for Wave 4.
2. **Offset side & chain: Fusion offers Chain Selection and a Flip toggle;
   reSHape picks the side from the click and orders the chain itself.**
   Model: *"'Chain Selection' checkbox is enabled in the dialog to
   automatically select the connected loop… Dragging the handle
   outward/inward, or toggling the Flip button in the dialog"*. reSHape's
   `offsetChainOrder` walks a selected connected chain with the same
   semantics; a side-flip toggle is future work (re-click the other side
   today).
3. **Line tool: toolbox activation, chaining, Escape to exit —
   transcript-corroborated, matches reSHape's chain behavior.** Model
   (01:53–02:56): *"Continuous chaining: Fusion keeps adding segments with
   each click… Pressing `Esc` exits the Line tool completely"*; real
   captions at 00:01:58–00:02:01 (*"Type S to open the toolbox… You can
   then type a command, such as line"*). reSHape's line chain matches the
   click-to-chain and Escape-to-exit; it lacks Fusion's dynamic length/angle
   entry boxes on the live segment (P2.7's dims cover the dimensioning
   need).
4. **TRIM IS NOT IN THIS VIDEO — the trim MUST FILE gate CANNOT be
   resolved from this source.** Model, explicitly: *"Trim: Does not appear
   in this video (the video demonstrates Break at 03:55 instead)."* Real
   captions at 00:03:48–00:04:03 name **Break** (*"select break to split the
   geometry into multiple segments… Place the pointer over the geometry to
   preview where it will break, then click to break it"*). Break and Trim
   are different tools (Break splits at a point; Trim removes a piece to a
   crossing). The watch-for rule's own fallback says what to do: pull the
   reserve video and file trim from it before marking this done.

#### Unverified / discarded

- Rectangle was also absent from the lesson (model: "Rectangle: Does not
  appear in this video") — already covered by earlier entries, not a gap.
- The lesson's sketch-constraint interactions are already filed from the
  dedicated constraint videos; not re-claimed here.

#### Coverage

Watch-for **Trim**: NOT FOUND in this lesson (Break shown instead, 03:48–
04:03) — gate stays open, reserve video
`create-a-component-within-an-assembly` is the named fallback. Watch-for
**offset**: FOUND (04:31–04:54, transcript-corroborated, matches reSHape's
offset tool with the divergences noted above).

---
## control-part-thickness-geometry-and-specific-angles

- **Source:** `https://www.autodesk.com/learn/ondemand/tutorial/control-part-thickness-geometry-and-specific-angles`
  (live Autodesk lesson, real Fusion footage with narration/transcript).
- **Model:** script default (`google/gemini-3.8-flash`); first attempt hit a
  transient OpenRouter `HeadersTimeoutError`, the relaunch succeeded. Output
  was specific and transcript-corroborated, so `--pro` was not used.
- **Reviewed:** 2026-09-21.

#### Verified

1. **Measure exists as an IN-DIALOG value source, not a canvas tool —
   transcript-corroborated.** Model (05:47–05:54): *"Inside the Hole
   command dialog, the user clicks the small flyout arrow on the right side
   of the Diameter numerical input field, then clicks Measure from the
   dropdown menu. In the graphics window, the cursor hovers over and clicks
   the circular edge… The measured diameter (`0.257 in`) is instantly
   transferred and populated directly into the Diameter input field."* Real
   caption at 00:05:44 (*"The preview uses a default size, so we can again
   use the measure command in the dialog to capture one of the projected
   holes for reference"*). So Fusion's Measure interaction inside modeling
   commands is: value-field flyout → Measure → click geometry in the
   viewport → the result lands in the field. reSHape has no in-dialog
   Measure source today; its dimension entry is typed only. **Measure MUST
   FILE gate: RESOLVED as a verified difference** — the interaction exists,
   is now described with timestamps, and reSHape's gap (no value-field
   Measure flyout) is named rather than unknown. Building it is future work
  (a value-field flyout is the natural extension of the Phase 2.7 chip),
  tracked by todo 30's sweep, not this wave.
2. **Value entry: typed fields, a floating HUD radius box, and a canvas
   manipulator dial — transcript-corroborated.** Model: radius *"typed
   directly into the floating on-canvas HUD input box"* (03:02, 04:47); the
   draft angle *"clicks and drags the circular rotation wheel manipulator
   directly in the canvas"* with a live readout (04:11–04:34); depth typed
   (05:39–05:42). reSHape's click-then-type chip (P2.7, fillet, offset)
   matches the typed-path; the drag-manipulator path is Wave 4's
   manipulator work.
3. **Timeline error resolution: red icon → right-click → Edit Feature →
   re-pick faces → OK — transcript-corroborated.** Model (00:28–00:57):
   *"the DeleteFace1 icon turns bright red with a yellow warning triangle,
   and a red error banner (`1 error(s)`) pops up… The user right-clicks the
   red DeleteFace1 icon directly on the timeline and selects Edit Feature…
   clicks on the newly exposed adjacent faces in the viewport to add them
   to the selection set… the red highlight on the timeline icon disappears."*
   This is the refusal-surfacing analog the plan queued this video for:
   Fusion surfaces per-feature failure on the timeline and repairs it by
   re-editing that feature — the same contract reSHape's
   `EngineBuildResult.refusals` + per-feature refusals-beside-what-built
   UI already implements. No code change indicated.

#### Unverified / discarded

- The marking-menu gestures glimpsed (02:20, 03:13) are Wave 3's todo 17–21
  territory; not claimed here.

#### Coverage

Watch-for **Measure**: FOUND (05:47–05:54, in-dialog flyout value capture,
transcript-corroborated) — the gate's open question ("tool activation, click
sequence, result readout") is answered, and the comparison against reSHape
is filed as a verified difference, not a parity match. Timeline-error
resolution was a bonus corroboration of the per-feature-refusal contract.

---
## reSHape Studio Phase 4 closeout (self-recorded)

- **Source**: self-recorded Playwright scenarios, not a URL — the five
  `scripts/parity-scenarios/phase4-*.mjs` files (built for todos 17–21 of
  `.omo/plans/fusion-parity-closure.md`), each self-asserting with throws
  before being handed to the review pipeline (same ground-truth-first
  methodology as the earlier closeout entries):
  - `phase4-marking-menu-base.mjs` → `.omo/evidence/parity-recordings/phase4-marking-menu-base/page@468093b63a893217a21b8ad946eff561.webm`
  - `phase4-marking-menu-flyout.mjs` → `.omo/evidence/parity-recordings/phase4-marking-menu-flyout/page@21d49943f80b3e09f71183889b313ce1.webm`
  - `phase4-marking-gesture.mjs` → `.omo/evidence/parity-recordings/phase4-marking-gesture/page@4c492df1ed11d4dc5c448a62036c78e8.webm`
  - `phase4-rightclick-guard.mjs` → `.omo/evidence/parity-recordings/phase4-rightclick-guard/page@09887dcb9d1b248fa3a8322bc6dccd88.webm`
  - `phase4-timeline-context.mjs` → `.omo/evidence/parity-recordings/phase4-timeline-context/page@e72ba031d90ae7712fb523c3b9f7a41c.webm`
- **Model**: script default (`google/gemini-3.8-flash`) for all five; no
  `--pro` escalation needed.
- **Reviewed**: 2026-09-21.
- **Methodology note**: silent recordings, faster-whisper fails on all five
  (no audio stream — expected), so the spot-check is against each
  scenario's known action sequence, not a caption. A measured platform
  fact this wave also documents: Chromium/Playwright fire a right press's
  `contextmenu` event at PRESS time (coords = the down point, timestamp =
  pointerdown's), BEFORE pointerup and before any drag's moves — the
  classify-on-pointerup split in BrepViewportThree.tsx and SketchCanvas2D.tsx
  exists because of that (see commit `0c1ae88`).

### marking-menu base (`phase4-marking-menu-base.mjs`)

Known scripted sequence: right-click in the part viewport → assert the
eight SPEC wedges render → Escape closes → right-click in sketch mode →
assert the sketch constraint wedges → Escape.

#### Verified

1. **All eight part-viewport wedges, in the SPEC's reading order, at the
   right clock positions.** Model: *"Top (12 o'clock): Repeat… Top-Right:
   Delete… Right: Press Pull… Bottom: Redo… Top-Left: Sketch"* — the exact
   set and layout order `MARKING_MENU_CONFIG['part-viewport']` carries.
2. **The context list renders with the SPEC :34-35 rows.** Model: *"a
   vertical list appears containing: Pan/Zoom/Orbit, Isolate, Workspaces,
   Saved shortcuts"* — matches `contextListFor()`'s four entries (disabled,
   present-but-disabled).
3. **Sketch-mode menu renders the constraint wedges** (script assertion:
   Done/Horizontal/Vertical/Tangent/Lock all present after the sketch-mode
   right-click; the model's read of the base take covers the part-viewport
   menu and the sketch entry).

#### Unverified / discarded

- **Sixth cumulative sighting of the stale orbit-hint text** (`RIGHT-DRAG
  ORBIT` in the status bar while left-drag orbits). Same
  `ReshapeStudio.tsx` bug every earlier self-recorded entry flagged; todo
  29's mouse-scheme flip is where it gets fixed.

#### Coverage

Both menus (part-viewport, sketch) rendered with mode-appropriate contents;
Escape close asserted by the script.

### marking-menu flyout (`phase4-marking-menu-flyout.mjs`)

Known scripted sequence: right-click part-viewport → hover the Sketch
wedge → the sketch-tool flyout opens (8 tools) → context rows present →
Escape.

#### Verified

1. **The radial renders with all 8 wedges and the context list.** Model:
   the full wedge list (Repeat…Sketch) plus *"Context List Rows (to the
   upper-left of the radial menu): Pan/Zoom/Orbit, Isolate, Workspaces,
   Saved shortcuts"*.
2. **The flyout's per-child items were NOT read by the model** (model:
   "Submenus / Flyouts: None visible"; a second run returned `null` for the
   whole video) — the hover-opens-flyout step moves through the wedge
   quickly at 1280×800 and the flyout's lifetime is ~1 frame of the
   recording. The flyout's DOM-reach proof is the scenario's own
   throw-assertions (each of the 8 tool labels asserted present in
   `.marking-menu-flyout-item`), which the video corroborates only
   indirectly (the wedge hover happened — no error was thrown).

#### Unverified / discarded

- The diagonal-toward vs directly-away dead-zone behavior (todo 18's
  acceptance criterion) is asserted by the PURE unit test (flyoutHitTest's
  two cases), not by this recording — a silent 1280×800 video cannot
  resolve a cursor-path geometry claim. No real-Fusion lesson demonstrates
  Fusion's own flyout dead-zone either; the [CONFIRM] split stays as filed.

#### Coverage

The radial + context list were read correctly; the flyout's contents were
asserted by the script, the video read was inconclusive (too small/fast a
target), the geometry is proven by the unit test.

### marking gesture (`phase4-marking-gesture.mjs`)

Known scripted sequence: two boxes → select one → fast right-drag toward
the Delete wedge (upper-right, slot 1) → assert NO menu rendered and the
body was deleted.

#### Verified

1. **The wedge gesture fires Delete with NO menu flash, transcript-free
   but geometry-corroborated.** Model: *"Box 2 is deleted (the 3D body
   disappears from the viewport, and the BOX 2 timeline card vanishes)…
   Viewpoint has orbited, but no radial menu or drag indicator is visible."*
   Matches the scripted classification exactly: the fast drag went to
   Delete's wedge, the command fired, and the menu never rendered (the
   model even notes the camera orbited — the right-press's motion was read
   as navigation until the wedge fired).

#### Unverified / discarded

- **[CONFIRM]-sourced timing is NOT settled by this entry.** The 150ms
  gesture delay is a documented default pending real-Fusion verification
  (SPEC open question #2), flagged in `classifyGesture`'s own code comment;
  the 4px dead zone is the SHARED hold-cycle constant (settled numbers,
  see input-threshold.ts). This recording proves reSHape's own
  implementation behaves as coded, not that Fusion's exact gesture
  numbers match. SPEC-mouse-parity Phase 4.2's [CONFIRM delay and
  dead-zone] tag stays open for todo 30's sweep.

#### Coverage

The wedge-fires-without-menu behavior was corroborated end-to-end (body
gone, timeline row gone, no menu flash); the qualitative claim "Fusion
uses this exact gesture" remains unverified against real footage.

### right-click guard (`phase4-rightclick-guard.mjs`)

Known scripted sequence: slow right-DRAG 200px (camera gesture) → assert
no menu → clean right-click → assert the menu opens → Escape.

#### Verified

1. **The menu did NOT open on the slow drag** (model: *"None appear"*
   throughout, and the scene description shows only the viewport loading —
   the camera drag consumed the gesture). The scenario's own assertion
   (`afterDrag === 0`) is the direct proof.
2. **The measured event order the guard depends on is now documented.**
   Chromium/Playwright fire contextmenu at PRESS time (coords = the down
   point) — the reason classify-and-dispatch lives in onCanvasPointerUp
   (commit `0c1ae88`'s body carries the full measurement). The model's
   read corroborates the sequence: the drag happened while the viewport
   stayed menu-free.

#### Unverified / discarded

- The model read the recording as "no gesture performed" (the drag and
  click both landed between its sampled frames). The script's own
  assertions — no menu on drag, menu on click — are the ground truth here,
  not the video.

#### Coverage

The guard's both behaviors were asserted by the scenario; the video
corroborates the session ran (kernel load → ready) without contradicting
the assertions.

### timeline context (`phase4-timeline-context.mjs`)

Known scripted sequence: two boxes → HTML5-drag row 1 onto row 2 →
assert the swap → click row 2's move-earlier button → assert the
keyboard fallback restored the order → right-click row 1 → assert the
Edit/Delete/Rollback-to-here menu.

#### Verified

1. **The drag-reorder swapped the rows.** Model: *"Timeline displays
   [BOX 2] positioned before [BOX 1]"* after the drag — exactly the
   moveTo() semantics the scenario asserts (row 1 lands where row 2 was).
2. **The right-click context menu opened with the right rows.** Model:
   *"Right-clicking on the BOX 1 timeline node opens a vertical context
   menu popup"* — and the scenario's own assertion named Edit, Delete and
   Rollback to present.

#### Unverified / discarded

- The keyboard-fallback click (row 2's move-earlier) is not readable from
  the video (a button click inside a timeline chip at this resolution);
  the scenario's throw-assertion (order restored) is the proof.

#### Coverage

Drag-reorder result and the context menu's opening were corroborated by
the model's read; the button-fallback reordering is proven by the
scenario's assertion. The up/down buttons' DOM survival is additionally
asserted structurally by marking-menu.test.mjs's todo-21 test.

### Relevance to `packages/studio`

Wave 3's five todos are corroborated as shipped (`dc71103` base,
`9404fd6` flyout+context list, `e82ceb5` gesture, `4677c5f` guard,
`f77225b` timeline menu+drag, plus the two event-order fixes `33ce4c4`/
`0c1ae88`). The one standing [CONFIRM] is Phase 4.2's delay/dead-zone
against real Fusion footage — flagged for todo 30.

---

## reSHape Studio Phase 5 closeout (self-recorded)

- **Source**: five self-recorded Playwright scenarios against the sandbox
  app (`node scripts/parity-record.mjs phase5-...`), one per Phase 5
  todo. Silent screen captures — the model had no transcript available,
  so visual claims only; nothing here rides on audio.
- **Model**: script default (`google/gemini-3.8-flash`).
- **Reviewed**: 2026-09-21.

### Recordings + what the model corroborated

1. **phase5-extrude-manipulator** (todo 22, commit `a8806d3`) —
   `.omo/evidence/parity-recordings/phase5-extrude-manipulator/`
   Verified: selecting POCKET 1 summons the on-canvas arrow manipulator
   plus a floating numeric badge at its tip; typing 12 updates the
   handle position and the geometry live; entering -5 triggers the
   plain-English refusal banner ("a pocket of -5 is not a shape — give a
   positive number"); the right panel shows the SAME parameter
   ("Pocket 1 deep"), so box, drag, and panel are one parameter.

2. **phase5-taper-handle** (todo 23, commit `13d0288`) —
   `.omo/evidence/parity-recordings/phase5-taper-handle/`
   Verified: selecting BODY DRAFT 1 renders the blue circular arc handle
   with a numeric badge (8) on the drafted axis, attached to a floating
   context bar; adjusting the angle to 15 regenerates the geometry
   immediately; switching steps or deselecting removes the handle
   completely (absent, not disabled).

3. **phase5-move-gizmo** (todo 24, commit `b60f1a3`) —
   `.omo/evidence/parity-recordings/phase5-move-gizmo/`
   The model's read is of our tool's Code/Build tabs (it names the
   difference explicitly). Corroborated: the footer mapping hints, the
   selected cuboid's highlight, the Move 1 contextual pill with X 15 /
   Y 0 / Z 0, and the Move 1 x/y/z slider+text pairs in the right panel —
   the gizmo's parameter family, though the clip shows the panel path
   rather than an arrow drag.

4. **phase5-live-preview** (todo 25, commit `7fb4494`) —
   `.omo/evidence/parity-recordings/phase5-live-preview/`
   Corroborated: the Pocket 1 pill HUD over the geometry, the Depth 8
   inline field, sub-button hover highlighting, and the committed
   inspector. NOT visible in this clip: the translucent blue/red tint
   itself — the drag shown was short and the model read the resting
   orange, so the colour convention stays an unverified visual claim
   (the unit suite's structural single-undo pins cover the guarantee
   instead).

5. **phase5-step-tooltips** (todo 26, commit `1bbba29`) —
   `.omo/evidence/parity-recordings/phase5-step-tooltips/`
   The model read this clip as code-driven (no cursor captured, no
   handles visible) and corroborated the surrounding chrome: the tab
   filter toggles (Faces/Edges/Vertices/Bodies), the Browser selection,
   and the timeline step inspection. The tooltip itself did not render in
   this take — the state-driven prompt strings are covered by
   step-tooltips.test.mjs (four cases, verbatim strings) rather than
   claimed as shown here.

### Cross-references (the three prior entries this closes)

- "## Press Pull (\"Press Pull Command - Fusion 360 Part Tutorial\")"
  — its finding 2 ("drag this Arrow ... or I can type a parameter in
  this distance field", 01:20–01:31) is the behavioural target of Phase
  5.1; closed by recording 1 (arrow + typeable badge corroborated). Its
  5.3 preview relevance ("commit-on-OK") is covered by the structural
  single-undo pin; the tint colour itself stays unverified (see take 4).
- "## Extrude (\"Extrude solid bodies\")" — its verified per-extrusion
  timeline features and symmetric direction remain the behavioural
  shape of the extrude manipulator; the E hotkey and symmetric-direction
  parts it flagged are OUT of Scope IN and stay unimplemented — this
  closeout does not claim them.
- "## Fillets (\"Fillets\")" — its Phase 5.1 relevance note is closed by
  take 2's arc handle on the draft's angle parameter (the SPEC's arc
  requirement is about ANY angle-bearing feature; draft is the confirmed
  carrier). Fillet's own radius dot remains the todo-22 handle.

### Relevance to `packages/studio`

Wave 4's five todos are corroborated as shipped (`a8806d3` manipulator,
`13d0288` taper arc, `b60f1a3` gizmo+incremental, `7fb4494` preview,
`1bbba29` step tooltips). Standing [CONFIRM] carried to todo 30: the
blue/red tint is a colour convention the recordings corroborate only
indirectly (the pill HUD and value field, not the tint itself), and
Phase 4.2's gesture numbers are still pending real footage.

---

## Navigation / camera (official Autodesk Fusion: "Navigate the Autodesk Fusion Interface Like a Pro! [UPDATED!!]")

- **Source**: https://www.youtube.com/watch?v=FmMNIGVpCng (official Autodesk
  Fusion channel), 6:14 — the navigation/camera queue entry below
  ("ViewCube click/orbit, MMB pan, Shift+MMB orbit").
- **Model**: script default (`google/gemini-3.8-flash`).
- **Reviewed**: 2026-09-22.

### Verified findings

1. **MMB-drag pans the view.** 04:35: *"Here's a quick tip. Click and hold
   your middle mouse button to pan your assembly."* The model reads the
   matching demo at 04:40–04:44: "Press and hold **MMB** (scroll wheel
   button) + drag mouse across canvas to pan the view." MMB-drag is PAN,
   not orbit — MMB-orbit is nowhere in the footage.

2. **Shift+MMB-drag orbits.** 04:45–04:50: *"Another way to orbit your part
   is by pressing and holding the Shift key and middle mouse button and
   then moving your mouse."* Model, 04:46–04:53: "Press and hold `Shift` +
   MMB + drag mouse to 3D orbit around the model. A circular orbit pivot
   glyph appears in the viewport."

3. **ViewCube: click faces/edges/vertices to snap; left-click-drag on the
   cube free-orbits.** 04:24: *"Here you can click on faces, edges, or
   vertices to view different positions of your assembly."* 04:32: *"You
   can also left-click on the view cube to orbit."* Model: single
   left-click on a highlighted face/edge/corner snaps the camera to that
   orthographic/isometric view (04:24–04:33); click-and-drag on the cube
   is continuous free orbit (04:34–04:38); hover highlights the target
   region in light blue (04:24–04:32).

4. **Right-click: context menu, browser isolate, marking menu.** 04:07:
   *"let's right-click on the lid of our box to find it in our browser"*;
   04:12: *"Within the browser, we can also right-click on a part to
   isolate and unisolate it if needed"*; 04:59: *"Within your canvas,
   right-click to access the marking menu, which contains frequently used
   commands in the wheel and additional commands in the overflow menu."*
   The model names the wheel entries (Delete, Press Pull, Undo, Redo,
   Hole, Move/Copy, Sketch) and the overflow (Pan, Zoom, Orbit, Display
   settings) at 05:00–05:10 — visual read; the transcript corroborates
   only the wheel/overflow split, not the item names.

5. **Timeline right-click + drag.** 05:33–05:36: *"Right-click operations
   to make changes. You can also drag operations to change the order in
   which they are calculated."* Model: the right-click menu offers Edit
   Feature / Delete / Rename / Suppress (05:33–05:39) and left-drag
   reorders with a drop indicator (05:40–05:46) — menu contents are the
   model's visual read.

### Not shown / unverified

- **Scroll-wheel zoom**: never mentioned or demonstrated — no transcript
  line, no model observation.
- **Left-click select on canvas geometry**: implied (04:03: *"Here is where
  you'll be able to select objects from your assembly"*) but no explicit
  LMB-select binding is stated or demoed.
- **Nav bar buttons**: named only — 05:12–05:14: *"Navigation bar. This
  contains commands used to orbit, look out, pan, zoom, fit"* — no button
  is clicked, no binding shown.
- **Default vs legacy mouse schemes**: the video shows ONE scheme (MMB pan,
  Shift+MMB orbit) and never says "default" or "legacy"; no
  preferences/scheme UI appears. The "default" label is the spec's
  framing, not the footage's.

### Relevance to `packages/studio`

SPEC-mouse-parity Phase 1.1 (default scheme): the footage CONFIRMS
MMB-drag = pan and Shift+MMB-drag = orbit as Fusion's scheme — both
bindings are stated verbatim in the official narration with matching
demos, and MMB-orbit is never shown. This settles Phase 1.1's `[CONFIRM]`
in favor of the scheme reSHape already ships. Bonus for Phase 1.5:
ViewCube face/edge/corner click-snap plus left-click-drag orbit on the
demos, and MMB-orbit is never shown. This settles Phase 1.1's `[CONFIRM]`
in favor of the scheme reSHape already ships. Bonus for Phase 1.5:
ViewCube face/edge/corner click-snap plus left-click-drag orbit on the
cube itself (corner/isometric zones already flagged in `## Extrude`).

---

## reSHape Studio full-suite closeout (self-recorded)

- **Source**: the complete scenario library re-run in one batch on the
  final tree (`node scripts/parity-record.mjs <scenario>` for every one of
  the 22 interaction scenarios + smoke), 2026-09-22. **All 23 PASS** —
  each module's own programmatic assertions exit 0 and each recording
  verifies as a real webm (ffprobe, 23/23). Model for spot-checks:
  `google/gemini-3.8-flash`; the full-suite re-run is the regression
  gate itself, so no new Gemini review was needed for takes that only
  re-prove already-filed behaviour.
- **Regression fixes the sweep surfaced** (commit `3537d55`):
  1. HandleOverlay's Phase 5.1 arrow-tip value box had been silently
     dropped by todo 23's taper-arc edit — extrude/pocket/fillet had an
     arrow with NO box; restored verbatim from `a8806d3`.
  2. The sketch marking menu gated on `panButton === 2` and so died
     under the todo 29 fusion default; now gates on the todo-20 guard's
     `rightButtonRole(scheme) !== 'none'`.
  3. phase1-camera / phase3-box-select / phase3-mixed-select click face
     labels through the raw mouse path now (todo 28's zone overlays sit
     over the labels; the wrapper's elementFromPoint resolver handles
     them).

### Wave-by-wave status

- **Wave 0 (baseline, todos 1-3)**: camera presets, zoom-to-cursor,
  ortho swap, fit/window-zoom, sketch pan/zoom + drag-create + snaps +
  dimensions — landed before this plan, exercised by phase1-camera /
  phase2-sketch (PASS).
- **Wave 1 (todos 4, 7-10)**: sketch trim, fillet, offset, fully-
  constrained gauge — scenarios PASS (phase2-sketch-trim / -fillet /
  -offset / -fully-constrained).
- **Wave 2 (todos 12-15, Phase 3 selection)**: box select
  (phase3-box-select), double-click + Ctrl+A + Del (phase3-dblclick-keys),
  mixed face+edge selection (phase3-mixed-select), click-and-hold select-
  other with the settled 300ms/4px numbers (phase3-select-other) — PASS.
- **Wave 3 (todos 17-21, Phase 4)**: radial base (phase4-marking-menu-
  base), flyout + context list (phase4-marking-menu-flyout), directional
  gesture (phase4-marking-gesture), right-click guard (phase4-
  rightclick-guard), timeline menus + drag-reorder (phase4-timeline-
  context) — PASS.
- **Wave 4 (todos 22-26, Phase 5)**: arrow + drag-or-type box (phase5-
  extrude-manipulator), taper arc (phase5-taper-handle), Move gizmo +
  Incremental Move (phase5-move-gizmo), live blue/red preview with single
  undo (phase5-live-preview), command-state step tooltips (phase5-step-
  tooltips) — PASS.
- **Wave 5 (todos 28-30)**: ViewCube 26-zone partition + camera menu
  (phase1-viewcube-edges, commit `f6de04a`), fusion default scheme
  verified against FmMNIGVpCng (phase1-default-scheme, commits `716ba42`
 + `e19e09b`), the [CONFIRM] sweep with per-item citations (SPEC commit
 `38c9f60`) — PASS.
- **Standing, honestly-unfinished items** (carried, not silently closed):
  Phase 4.2's exact gesture numbers against real Fusion footage; the
  blue/red preview tint and the rendered tooltip remain unverified visual
  claims (unit tests pin their logic); Fusion's range-selection and
  symmetric-direction remain out of Scope IN, unimplemented.

### Relevance to `packages/studio`

`npm run build` + `npm test` green at the sweep commit (studio suite
218/218; all workspace suites green). The plan's regression gate is
met: every scenario asserts its own todo's acceptance criteria, every
recording is a valid webm, and the two regressions the sweep found were
fixed and re-recorded before this closeout.
---
## reSHape Studio marking menu vs. Fusion ("Using the Marking Menu" — official Autodesk Learn lesson)

- **Source**: `https://www.autodesk.com/learn/ondemand/tutorial/using-the-marking-menu`
  (official Autodesk Learn lesson, downloaded 2026-09-22), reviewed through
  the Gemini pipeline (`google/gemini-3.8-flash`, transcript-corroborated).
  This is the video the "Next videos to review" queue held for Phase 4.1/4.2
  — the spec's `[CONFIRM delay and dead-zone]` question.

### Verified (timestamps + transcript quotes)

1. **Right-click opens an 8-wedge radial at the pointer, context list
   beneath.** 00:10–00:29: *"Simply right-click anywhere on the canvas to
   open the marking menu around your pointer."* Default design-workspace
   commands named at 00:19: repeat, delete, press pull, undo, redo,
   move/copy, hole, sketch — the same set SPEC `:33-35` recorded, and the
   set `MarkingMenu.tsx`'s `PART_VIEWPORT_WEDGES` ships. Model confirms the
   hover highlight is a solid-blue wedge fill (00:34–00:37).
2. **Second-level radial opens on HOVER-dwell, with a back handle.**
   00:37–00:58: *"Place the pointer over sketch for a moment and notice that
   a second level radial menu opens around your pointer."* The sub-level's
   tools: line, offset, project sketch, dimension, fit point spline, center
   diameter circle, two-point rectangle, finish sketch. A circular back
   handle with an up-arrow returns to the first level (00:59). Matches
   reSHape's todo-18 flyout shape (hover-open, back affordance).
3. **Wedge activation: hover, then click ANYWHERE in the highlighted
   wedge.** 00:30: *"place your pointer over the command, then click anywhere
   in the highlighted wedge."* reSHape matches (wedge hover → click fires).
4. **Gestures are hold + fast directed drags THROUGH sub-levels, with a
   mid-drag preview, not a timed gate.** 03:47–04:25: *"to activate the
   two-point rectangle command, you drag down, then to the upper right. ...
   straight down for the line command, down to the left for the offset"*
   (L-shape for fit-point spline; down-then-halfway-up for finish sketch).
   04:11: *"Right-click and hold, drag quickly down, then drag to the upper
   right and let go when you see the command."* The model observed a thin
   blue ink trail tracking the pointer during the gesture (04:13–04:15) —
   the wedge lights up as the drag crosses it; the command name is the
   commit signal. Right-click-hold + drag-straight-right = OK; the gesture
   never renders the menu.

### Phase 4.2's `[CONFIRM delay and dead-zone]` — partially resolved

- **What the footage settles**: the gesture is a fast directed drag whose
  target can sit in a SECOND-level radial (an L-shaped path through two
  radials); the wedge preview appears when the drag crosses the wedge, and
  release commits ("let go when you see the command"). No menu render on a
  gesture — matches reSHape's shipped classifier.
- **What stays a reSHape default**: the 150ms delay. Fusion's narration
  shows no timed gate at all — the discriminator is speed/direction, not a
  dwell. The 4px dead-zone stays the shared hold-cycle constant. The SPEC's
  Phase 4.2 note stands amended: reSHape's 150ms is a documented engineering
  default (handover), Fusion's own delay is unobservable from this lesson,
  and the gesture-shape claims (multi-level drag, preview-on-crossing,
  no-render) are now footage-verified.
- **New divergence worth naming**: Fusion's gestures traverse sub-level
  wedges (down → up-right lands on a second-level command). reSHape's
  todo-19 gesture classifies a single fast directional drag against the
  FIRST-level wedges only; multi-level gesture paths are not built. The
  Phase 4 closeout's own non-claim stands; this is now a named future-work
  item, not a silent gap.
- **Also verified in passing**: Fusion's sketch marking-menu contents
  (line, offset, dimension, circle, rectangle, finish sketch) — the
  sketch-mode config reSHape ships covers these; the `R` rectangle hotkey
  (03:05) matches the shipped `TOOL_KEYS` mapping.

---
---
## Revolve solid bodies ("Revolve Solid Bodies" — official Autodesk Learn lesson)

- **Source**: `https://www.autodesk.com/learn/ondemand/tutorial/revolve-solid-bodies`
  (downloaded 2026-09-22), Gemini pipeline, transcript-corroborated.
  Queued for Phase 3/5.1.

### Verified

1. **Auto-detection then manual fallback** (00:30–00:35 vs 01:26–01:36):
   one closed profile + one centerline → Fusion selects both and previews
   with no viewport clicks; multi-profile needs modifier-add; the Axis
   Select button turns active/blue, then a viewport click assigns the axis
   (profile first, then axis — focus order matters).
2. **In-canvas revolve ANGLE manipulator** (00:31–00:47, 01:41–01:47): a
   CURVED ARROW at the profile/axis intersection with a floating numeric
   box ("360.0 deg"); click-drag drives the angle live and the box follows;
   a dropdown inside the box offers 90/180/360(Full)/Measure presets.
   This is exactly the Phase 5.1 taper-arc shape — reSHape's draft arc
   (`13d0288`) is the same genus; a revolve-angle arc on an angle-bearing
   feature is future work (RevolveFeature has no angle param yet).
3. Hover highlights profiles blue before selection (01:29–01:35) — matches
   the shipped hover behaviour.

### Not shown / future work
- No full 360-vs-partial angle dialog walkthrough beyond the presets; the
  preset dropdown's `Measure` entry matches the Measure finding already
  filed (control-part-thickness entry).

---
## Shell solid bodies ("Shell Solid Bodies" — official Autodesk Learn lesson)

- **Source**: `https://www.autodesk.com/learn/ondemand/tutorial/shell-solid-bodies`
  (downloaded 2026-09-22), Gemini pipeline. Queued for Phase 3/5.1.

### Verified

1. **State-driven step tooltips** (00:32–00:57): activating Shell anchors an
   adaptive prompt near the cursor — *"Select faces to remove or Body to
   shell"* — then after a selection it becomes *"Specify type, direction,
   thickness, or hold Ctrl to modify selections."* The prompt text CHANGES
   with command state — exactly the todo-26 step-tooltips shape
   (`stepTooltip(command, {active, selectionCount})`); reSHape's strings
   differ (its SPEC-pinned wording) but the mechanism matches.
2. **Arrow manipulator + inline value box** (00:47–00:57): once a body/face
   is selected, a directional arrow with a floating `0.00 mm` box appears on
   the model; committed via OK (01:36) or dropped when selections clear
   (02:25). Same drag-or-type family as todo 22's box.
3. **Timeline edit = double-click the feature icon** (02:16–02:19) reopens
   Edit Feature — matches the shipped double-click edit (todo 8/P3.6).
4. **Deselection via an inline X on the selection pill** (02:22–02:25) in
   the dialog; direct canvas face click adds the opening face (02:27).

### Not shown / future work
- Shell is OUT of Scope IN for the parity plan (kernel refuses it honestly
  today); the footage confirms the INTERACTION shape only, not kernel
  capability.

---
## Create holes in a solid body ("Create Holes in a Solid Body" — official Autodesk Learn lesson)

- **Source**: `https://www.autodesk.com/learn/ondemand/tutorial/create-holes-in-a-solid-body`
  (downloaded 2026-09-22), Gemini pipeline. Queued for Phase 5.1.

### Verified

1. **Hole placement flow** (00:23–00:33): toolbar click → dialog opens with
   Placement/Face input focused by default → canvas face click drops the
   instance → click-drag the CENTER GLYPH onto a reference snap point →
   dialog fields → OK/Enter commits. The center-glyph drag is a manipulator
   drag of the kind HandleOverlay already renders for holes' position
   (todo 22's convergence invariant applies).
2. **Repeat via marking menu** (01:17–01:43, 02:26): right-click empty
   canvas → hover the top wedge (Repeat Hole / Repeat Circular Pattern) →
   left-click executes. Corroborates the marking-menu closeout's default
   wedge set (Repeat is the top wedge in Fusion's radial — reSHape's
   PART_VIEWPORT_WEDGES has Repeat first too). reSHape's Repeat is
   present-but-noop (documented); the footage shows what it is FOR.
3. **Circular pattern** (01:50–02:25): Objects selector auto-focused;
   face-click picks the feature; the Axis selector button toggles active;
   then a cylindrical face click assigns it. Dialog-driven; matches the
   mixed-selection gating reSHape ships (todo 12-15's axis-assign pattern).

### Not shown
- No keyboard modifiers at all — selection switching is via direct clicks
  and the dialog's active-picker toggle (a third pattern besides Ctrl-add
  and Shift-toggle; noted for completeness).

---
## Tour the Fusion user interface / Adjust display settings (two official Autodesk Learn lessons)

- **Sources**: `.../tour-the-fusion-user-interface` (403 at download time
  2026-09-22 — not reviewed), `.../adjust-display-settings` (downloaded),
  Gemini pipeline. Both were queued for Phase 1/1.3/4.4.

### Verified from adjust-display-settings

1. **Move/Copy triad, the full Fusion gizmo** (03:08–03:31): three
   orthogonal arrows, PLANAR DRAG SQUARES between axes, CIRCULAR ROTATION
   RINGS, center pivot. Hover tooltip "Drag to move along the axis";
   dragging constrains to the axis with a live numeric tag. **Incremental
   Move verified on footage**: enabled → the handle snaps to discrete
   values (5 mm shown); disabled → continuous float (03:16 vs 03:26). This
   is the todo-24 gizmo's exact behavioural target — reSHape ships arrows +
   Incremental Move (adaptive/fixed/off, `b60f1a3`); the planar squares and
   rotation rings are named future work (the plan's own re-target note).
2. **ViewCube camera-mode flyout** (04:04–04:17): a tiny flyout TRIANGLE at
   the ViewCube's bottom-right corner opens the camera-mode menu, listing
   *Perspective with Ortho Faces* among the options. reSHape's todo-28 gear
   affordance matches the interaction shape; the "Perspective with Ortho
   Faces" entry remains SPEC-deferred (:65) — the footage confirms it
   EXISTS in Fusion but does not oblige reSHape to build it.
3. **Ground plane offset** (01:40–01:52): a vertical arrow + inline
   distance box (`-38.00 mm`) on an amber plane; drag adjusts live — the
   same arrow+box family as todo 22.
4. **Visual style shortcuts** (00:26–00:34): Ctrl+4..Ctrl+9; `M` activates
   Move/Copy (03:08); Shift+1 toggles multiple views. reSHape ships M for
   move? — no: reSHape has no M hotkey; noted as future work (out of
   Scope IN; the plan closed).

### Not reviewed
- tour-the-fusion-user-interface: 403 Forbidden at download; the queue
  entry stays open with that note.

---
## Next videos to review

Rebuilt 2026-09-20 for balanced 2D/3D/navigation coverage. All URLs probed
live via `yt-dlp --skip-download` (the `.../curated/...` paths 404/403 — use
the `ondemand/tutorial/<slug>` canonical paths). Already filed above:
sketch-constraints, sketching-basics-overview, constrain-sketch-geometry,
dimension-sketch-geometry, extrude, press-pull, fillets, FmMNIGVpCng.

### 2D sketch interactions

  - (REVIEWED 2026-09-21: filed as `## create-and-modify-sketch-geometry`
  above — offset FOUND; trim NOT in the lesson, reserve video below is the
  fallback.)
- `https://www.autodesk.com/learn/ondemand/tutorial/the-sketch-environment`
  — sketch UI/palette layout; Phase 2 preamble, palette toggles.
- `https://www.autodesk.com/learn/ondemand/tutorial/sketch-2d-rectangles-using-lines-constraints-and-center`
  — rectangle + constraints; Phase 2.2/2.8.
- `https://www.autodesk.com/learn/ondemand/tutorial/constrain-and-align-sketch-features`
  — constraint application workflows; Phase 2.8/4.1.
- `https://www.autodesk.com/learn/ondemand/tutorial/parametric-modeling-sketching-intricate-shapes`
  — splines, line/dimension editing; Phase 2.7 + solver.

### 3D feature interactions

  - (REVIEWED 2026-09-22: filed as the revolve section above — in-canvas
  angle manipulator confirmed; revolve-angle arc on reSHape is future work.)
- `https://www.autodesk.com/learn/ondemand/tutorial/revolve-solid-bodies`
  — profile + axis selection + dialog; Phase 3/5.1.
  - (REVIEWED 2026-09-22: filed as the shell section above — state-driven
  prompts and the arrow+box manipulator match the shipped shapes; shell
  kernel capability stays out of Scope IN.)
- `https://www.autodesk.com/learn/ondemand/tutorial/shell-solid-bodies`
  — face-removal selection + thickness dialog; Phase 3/5.1.
  - (REVIEWED 2026-09-22: filed as the holes section above — center-glyph
  drag + Repeat-via-marking-menu corroborated; Repeat stays a no-op on
  reSHape, documented.)
- `https://www.autodesk.com/learn/ondemand/tutorial/create-holes-in-a-solid-body`
  — face pick, position handles, hole dialog; Phase 5.1 (HandleOverlay).
- `https://www.autodesk.com/learn/ondemand/tutorial/modeling-bodies-and-components`
  — Move/Copy gizmo on bodies vs components; Phase 5.2.
  - (REVIEWED 2026-09-21: filed as
  `## control-part-thickness-geometry-and-specific-angles` above — Measure
  FOUND in-dialog at 05:47–05:54; gate resolved as a verified difference.)

### Navigation / camera / menus

  - (REVIEWED 2026-09-22: filed as the marking-menu closeout section above —
  gestures ARE multi-level in Fusion; the 150ms delay stays a reSHape
  default, the gesture-shape claims are footage-verified.)
- `https://www.autodesk.com/learn/ondemand/tutorial/tour-the-fusion-user-interface`
  - (NOT REVIEWED: 403 Forbidden at download 2026-09-22; queue entry stays
  open for a retry.)
- `https://www.autodesk.com/learn/ondemand/tutorial/tour-the-fusion-user-interface`
  — nav bar, ViewCube, timeline placement; Phase 1/4.4.
  - (REVIEWED 2026-09-22: filed as the display-settings section above —
  the full Move/Copy triad + Incremental Move snapping footage-verified;
  planar squares and rotation rings named future work.)
- `https://www.autodesk.com/learn/ondemand/tutorial/adjust-display-settings`
  — camera perspective (ortho vs perspective), visual styles; Phase 1.3.
- `https://www.youtube.com/watch?v=FmMNIGVpCng` (official Autodesk Fusion
  channel) — ViewCube click/orbit, MMB pan, Shift+MMB orbit; settles Phase
  1.1's default mouse-scheme `[CONFIRM]`.

### Watch-for rules (do not skip)

These interactions have no standalone lesson (slugs 404) — they surface only
inside the queued videos marked **MUST FILE** above. Per video:

- **Trim + offset** → PARTIALLY RESOLVED: offset verified in
  `## create-and-modify-sketch-geometry` above (04:31–04:54,
  transcript-corroborated, matched against reSHape's offset tool with the
  construction-flag divergence noted). **Trim NOT in that lesson** (Break was
  shown instead, 03:48–04:03) — still open; the reserve video
  `https://www.autodesk.com/learn/ondemand/tutorial/create-a-component-within-an-assembly`
  (live, verified) remains the named fallback to file trim from.
- **Measure** → RESOLVED: verified in
  `## control-part-thickness-geometry-and-specific-angles` above (05:47–05:54,
  in-dialog value-field flyout → click geometry → result lands in the field,
  transcript-corroborated). reSHape's gap (no in-dialog Measure source) is
  named in that section as future work.
- **Box-select** → RESOLVED: verified in `## import-geometry-then-edit-with-direct-modeling` above (window ~02:13–02:16, crossing ~02:28–02:31, both transcript-corroborated and matched against `marquee-select.ts`).
- **Select-other (click-and-hold)** → no known lesson covers it; the fillet and
  extrude entries already carry it as an unverified visual claim. A transcript
  run cannot settle it — needs a frame grab or the user's own recording; do not
  queue another video for it.

A queue entry is not done until its **MUST FILE** items are either verified in
the findings log or explicitly named in that entry's "unverified/discarded"
section. When filing a new section, end it with a short "Coverage" line
naming which watch-fors were found (with timestamps) or explicitly absent.
