# SPEC: reSHape Studio UI revamp -- docked chrome, one interaction model

Status (2026-09-15): plan-of-record; no code written against it yet. Encodes
the completed UX inventory of `packages/studio/src` (ReshapeStudio.tsx,
model/ModelEditor.tsx, model/BrepViewportThree.tsx, model/HandleOverlay.tsx,
model/SketchConstraints.tsx, ReshapeParamsPanel.tsx) and the ~85-point
friction ledger distilled from it. Token source and visual reference:
`design/studio-mockup-dark.html` (adopted verbatim, §6).

## 1. Purpose & audience

reSHape Studio is a browser CAD app for **first-CS-course students** who
arrive through teacher-driven lesson contexts (a task list, a starter file, a
deadline), not through CAD curiosity. Most have never opened FreeCAD, Fusion,
or Onshape; nothing in the UI may assume CAD vocabulary, CAD muscle memory,
or tolerance for trial-and-error chrome.

Three commitments follow from that audience and they are not negotiable:

- **Plain English first.** The interface speaks in Pull/Spin/Turn/Round; CAD
  names (Fillet, Revolve, Shell, Pad...) are annotation -- tooltips, lesson
  text, the code side -- never the primary label. This is the existing
  convention and it is correct; the revamp extends it.
- **The refusal names the fix.** "Pick one shape to round." is the product's
  best feature: every error, disabled button, and conflict carries the
  reason AND the next action. A student who reads the message is never
  stuck.
- **The teacher's clock is the real clock.** Lessons run 30-90 minutes; a
  student who loses the selection, the Escape contract, or the model to a
  modal loses minutes they do not have. The revamp removes the structural
  causes of losing those minutes rather than adding capability.

The app already does the *content* of these commitments well (the amber-note
refusals, alias search, and conflict-red/auto-settle-purple/clamp-amber
taxonomy are ALREADY-BUILT). The revamp is about the *structure*: where
chrome lives, who owns which gesture, how many places a message can appear.
call: re-architecture of containment and ownership, not a reskin.

## 2. Design principles

1. **Canvas owns the viewport; chrome docks to its edges.** The 3D canvas is
   the only element that fills space; everything else is a docked band at a
   fixed edge. Today ribbon, tools card, hints, nav cube, Home, badges, and
   alarm all float, and the code contains measured collision fixes chasing
   them (Studio:123-135, Editor:460-470, Studio:1596-1617,
   Viewport:2779-2823, Overlay:1923-1932) -- per-element whack-a-mole;
   docking removes the whole class.
2. **One selection state.** Exactly one source of truth for what is selected;
   panel rows and canvas geometry are two views of it. The ownerOf
   regression (Studio:791-801) and the Item U fix live here; the rule is
   that a selection change is emitted by the model store once and consumed
   by canvas, panels, timeline, and strip -- none of them may mutate
   selection privately.
3. **Feedback lives at the point of interaction.** A message about the thing
   under the cursor appears next to that thing; app-wide notes are reserved
   for consequences that outlast the interaction. This is why the note/status
   band (timeline portal slots) is overloaded today -- it is the only home
   long messages have; §5.9 fixes the taxonomy instead of the band.
4. **Every refusal names the fix.** Plain-English reason + the next action,
   at the moment of refusal, on the surface that triggered it. A disabled
   button's tooltip carries the same text its refusal would (ALREADY-BUILT
   for tooltips; keep the parity rule).
5. **Plain English is the interface, CAD is the annotation.** Primary labels
   are student names; CAD names live in tooltips and the code view. Retired
   names stay searchable as aliases (ALREADY-BUILT).
6. **Mouse-first: no gesture requires a modifier to discover.** Every core
   action is reachable by click, drag, or right-click alone; modifiers
   (Shift, Ctrl, Alt) refine, they never gate. Alt+C for search and
   shift-click multi-select refine today; nothing core lives behind one --
   the right-click menu proposal (§4) gives click-only discovery to actions
   currently reachable only from the ribbon.
7. **One Escape stack.** Escape is arbitrated by a single registered
   priority chain (§4.3), not ad-hoc keydown ownership scattered per
   consumer. The hand-rolled priority (draw tool > sketch selection strip >
   code fullscreen, with a comment noting a real stack is owed if a 4th
   consumer appears) is retired by this principle; the 4th consumer
   (right-click menu) arrives with this revamp, so the stack is owed now.
8. **Density is earned by teaching, not by default.** Docks are collapsible;
   collapsed is a first-class state (a rail with live badges), not an
   afterthought. call: collapsed-by-default only below a 1280px canvas width;
   the expanded default is what lesson text assumes.

## 3. Layout architecture

**Decision: DOCKED-first, CSS grid areas.** One grid owns the app shell:

```
| topbar    topbar    topbar    |
| toolbar   left      viewport  |
| toolbar   left      right     |
| toolbar   left      viewport  |
| timeline  timeline  timeline  |
| status    status    status    |
```

Concretely, six grid areas:

| Area     | Size            | Collapses to        | Content |
|----------|-----------------|---------------------|---------|
| topbar   | 40px row        | n/a (persistent)    | wordmark, Build/Code toggle, undo/redo/delete (moved from ribbon end), Save/Open/Export, engine badge |
| toolbar  | 44-56px column  | 48px rail           | tool groups (vertical, scrollable) + search trigger; the horizontal ribbon rotated to a left column so it stops fighting viewport hints for top edge space |
| left     | 300-360px col   | 44px rail           | Parts/Planes browser; Rules panel tabs below it |
| viewport | 1fr             | --                  | canvas + permitted overlays only |
| right    | 240-280px col   | 44px rail           | Dimensions panel; collapses to a summary chip row in status bar |
| timeline | 48-64px row     | 32px (icon-only)    | feature chips + rollback bar |
| status   | 24-28px row     | n/a (persistent)    | selection readout, bbox, engine badge, nav style, note ticker (§5.9) |

px ranges assume a 1280-1920px window; below 1280px, left/right docks and
toolbar collapse to rails by default. call: the toolbar goes vertical-left
rather than staying a top ribbon -- the top edge is where the stage hint,
selection badge, and engine badge already collide, and a left column shares
an edge with the Parts dock it is always used alongside.

Floating is permitted ONLY for:

1. **Drag handles** (HandleOverlay) -- anchored to geometry by definition.
2. **Contextual selection strip** -- anchored to the current selection's
   screen position, not to viewport corners.
3. **Hover pills** -- anchored to the hovered element, never to a fixed
   corner (this retires Viewport:2895-2900 / Overlay:1925-1932, where
   corner-anchored pills collided with corner-anchored buttons).
4. **Toasts** -- bottom-center above the status bar, max 2, auto-expiring;
   transient confirmations only. Refusals are NOT toasts -- refusals are
   point-of-interaction notes (principle 3).

Everything else that floats today is retired by docking: floating tools card
(→ left dock), docked-Rules-plus-floating-tools split (→ one left dock with
tabs), floating timeline strip (→ timeline row), nav cube (→ docked
mini-cube in the viewport's reserved safe area), Home (→ topbar), stage
hint / selection badge / engine badge / conflict alarm (→ status bar and
note ticker). The five measured collision fixes in §2.1 become dead code on
adoption.

## 4. Canonical interaction model

Legend: **[B]** = ALREADY-BUILT (keep, possibly re-anchored); **[N]** =
PROPOSED-NEW; **[C]** = ALREADY-BUILT with a changed constant or anchor.

### 4.1 Mouse map

| Gesture | Build mode (3D) | Sketch mode (2D) | Status |
|---|---|---|---|
| Left-click | Pick face/edge/body [B] | Pick point/edge [B] | [B] |
| Left-drag on empty | Marquee/window select [N] (today: deliberate no-op [B]) | same [N] | [N] |
| Left-drag on selection | Move selection (with move handles) [B] | move points [B] | [B] |
| Left-drag on handle | Resize/move/turn; live preview; commit on pointerup [B] | [B] | [B] |
| Double-click on feature chip | Open that feature's params [N] | -- | [N] |
| Double-click on dimension | Inline text edit (type, Enter commits, Esc cancels) [N] | [N] | [N] |
| Double-click on sketch element | Element's own edit (endpoint-drag equivalent) [N] | [N] | [N] |
| Shift-click | Add to selection [B] -- sketch capped at 2 edges, 3D unbounded [B] | [B] | [B] |
| Ctrl-click | Toggle-in selection (remove if present) [N] | [N] | [N] |
| Right-click | Context menu [N] | context menu [N] | [N] |
| Right-drag | Orbit [B] | (sketch: 2D pan) [N] | [B]/[N] |
| Middle-drag | Pan [N] | pan [N] | [N] |
| Scroll | Zoom to cursor [B] | zoom [B] | [B] |
| Hover | Hover highlight + name pill [B] | [B] | [B] |

Right-click **content policy** [N]: the menu shows only (a) verbs valid for
the current selection, (b) verbs valid for the empty target under cursor,
(c) Undo/Redo. Every item is the same verb the toolbar exposes -- the menu
is a shortcut to existing verbs, never a second vocabulary. Refused verbs
appear in place, disabled, with the refusal as tooltip (same parity as
toolbar buttons, principle 4). Depth: 1 level, max 12 items; overflow goes
to "More...". call: the context menu exists because students will not hunt
the toolbar -- it puts the valid verbs at the cursor, principle 3 applied
to affordance.

### 4.2 Modifier map

| Modifier | Alone | With click | Status |
|---|---|---|---|
| Shift | Straight-line constraint while drawing [N] | add-to-selection [B] | [B]/[N] |
| Ctrl | -- | toggle-in selection [N]; Ctrl+Z/Y undo/redo [B] | [B]/[N] |
| Alt | Alt+C opens tool search [B] | (reserved; no hidden Alt-clicks) [N] | [B] |

call: keep Alt+C. The ribbon search earns its modifier as a power shortcut
while the same search is reachable by a visible box in the toolbar
(principle 6 satisfied by the visible route). Final keep-or-drop: §8.1.

### 4.3 Escape stack [N]

One registry, first-match-wins, highest priority first:

1. **Tool-arm** (active draw tool) -- disarms the tool, consumes key.
2. **Selection** (non-empty selection) -- clears selection, consumes key.
3. **Panel** (open transient panel state: inline dimension edit, open
   dropdown) -- closes it, consumes key.
4. **Fullscreen** (code view) -- exits, consumes key.

Components register at mount, unregister at unmount; topmost registered
consumer in each tier wins ties; unhandled Escape no-ops. This retires the
hand-rolled chain and its own "a real stack should exist" comment; the
right-click menu registers under tier 3. A consumer needing two Escapes
(tier 1 + tier 2) registers both, rather than hacking priority.

### 4.4 Double-click semantics [N]

- Feature chip in timeline → params panel opens scrolled to that feature.
- Dimension row (or dimension text in viewport) → inline text edit, mono
  font, Enter commits / Esc cancels / blur commits. No modal ever.
- Sketch element → element edit (equivalent endpoint drag).

call: double-click was entirely unused; giving it the two highest-frequency
intents (adjust a value, inspect a feature) costs no click budget and needs
no modifier -- principle 6.

## 5. Component specs

### 5.1 Toolbar (replaces floating ribbon)

Vertical dock, 44-56px wide, groups in current order: File / Edit / Sketch /
Create / Modify / Arrange / Combine, headers as 9.5px labels on collapse.
Buttons keep plain names with CAD-name tooltips [B]; active tool gets an
accent border (mockup `.fbtn.active`); additive/subtractive icons inherit
--additive/--subtractive [B in mockup]. Search box at top (same index,
retired names as aliases [B]); Alt+C focuses it. Undo/Redo/Delete leave the
ribbon end for the topbar (app-state verbs, not tools). Groups overflow to a
per-group "…" expander, not horizontal scroll.

### 5.2 Parts/Planes dock (replaces floating tools card)

Left dock, 300-360px, two tabs: **Parts**, **Planes**. Part rows: name
(student-visible, not CAD id), visibility eye [B], feature-count sub-label;
row selection uses the same selection store as canvas (principle 2 -- the
Item U class of bug dies here). Plane rows keep the plain-English convention
("turning plane", tooltip "the real name: the yz plane" [B]). call: defer
drag-reorder of the parts list to a later spec -- the timeline owns
ordering truth.

### 5.3 Rules panel

Lives in the left dock below Parts as tabs (Rules / Notes) or as a second
docked section, 280px nominal [C: was a separate 280px left dock]. Rule rows:
plain-name, state dot (ok/conflict/pending), value in mono. Conflict rows
open the note (§5.9 taxonomy) inline on the row, not in a shared band. The
panel is read-mostly; editing a rule routes through the Dimensions panel
inline-slider row so there is one editing surface.

### 5.4 Dimensions panel (right dock)

240-280px. One row per dimension, grouped by owning feature: plain label /
mono value / inline-slider [N].

Inline-slider row spec [N]: a single 24px-high row combining label (flex),
draggable slider track (min 60px, snap to 0.1), mono value readout (48px,
right-aligned, double-click → inline text edit per §4.4). Dragging previews
live and commits on release (matching handle commit semantics [B]);
keyboard arrows step by snap. Clamp-amber, auto-settle-purple, conflict-red
states carry over from the existing panel note taxonomy [B], now rendered
as a 2px left border + tinted value rather than full-row notes.

### 5.5 Timeline (docked row, replaces floating strip)

48-64px. Chip anatomy, left to right: state icon (additive/subtractive/
neutral color coding), plain name, state glyph, ⚠ badge on refused features
[B], consumed-dimension sub-glyph (mono numeral for dims this feature
consumed), rollback bar. Rollback bar: a draggable divider; everything right
of it renders dimmed with strikethrough name (mockup `.trow.dimmed`) and
is excluded from solve. call: rollback stays a timeline-native bar, NOT a
tree -- students think in "what did I do last", the linear strip is the
truth the lesson text also uses. Timeline chip click = select feature;
double-click = params (§4.4). Portal slots for messages are retired; see
§5.9.

### 5.6 Selection strip

Contextual strip anchored to the selection's screen position (offset above
its bbox), never viewport corners [C: today it is viewport-anchored].
Content: selected plain names, count, and the 2-3 verbs valid for that
selection (same source as the right-click menu). Max 2 edges in sketch /
unbounded 3D caps stay [B]. Replaces the corner-anchored selection badge.

### 5.7 Handle language

Keep existing colors verbatim. Handles are the one permitted floating
overlay that stays exactly as-is (principle 1 carve-out).

| Handle | Color | Shape | Meaning |
|---|---|---|---|
| Size | green | cube grips on faces/edges | resize |
| Point | blue | sphere dot | point drag (sketch, position) |
| Move | purple | arrows | translate selection |
| Turn | yellow | ring | rotate |
| Radius | amber | ring+grip | radius/round |

Commit-on-pointerup stays [B]; handle hover uses the hover token (§6);
every handle drag is cancellable with Esc via tier 2 (selection cleared →
drag aborts, model unchanged).

### 5.8 Status bar [N]

Persistent 24-28px row: **selection readout** (plain names + count, click →
clears selection), **bbox** (mono `w×d×h`, from the same measurement the
Home/fit code already computes), **engine badge** (FreeCAD/OCCT, with the
Save/Open graying parity documented in SPEC-studio-canonical.md phase 5
[B]), **nav style** (orbit/pan reminder text), and the **note ticker** (last
non-blocking note, full text on hover). All corner-floating badges retire
into it: selection badge, engine badge, conflict alarm (alarm = red note in
ticker + ⚠ chips, not a floating banner). Nav cube and Home: Home moves to
topbar; nav cube stays docked bottom-right inside the viewport's reserved
safe area (a 72px non-hit zone the viewport reserves, so canvas content
never sits under it).

### 5.9 Note taxonomy [B, formalized]

Five note classes, one visual language, one home per class:

| Class | Color | Home | Examples |
|---|---|---|---|
| Instruction | amber | point of interaction (strip/panel/toolbar) | "Pick one shape to round." |
| Conflict | red | owning panel row + status ticker | over-constrained sketch |
| Info | purple | owning panel row | auto-settle report |
| Success | green | toast (transient) | "Rounded every edge." |
| Status | gray | status ticker | engine, save state |

Rules: a message lives in exactly one home at a time; a conflict may be
mirrored as ⚠ on the timeline chip but its text lives on the row. Refused
features keep ⚠ chips [B]. Disabled buttons keep refusal-as-tooltip [B].
The shared band / portal-slot pattern is retired by rule 1.

## 6. Color & type tokens

Adopted verbatim from `design/studio-mockup-dark.html` (lines 8-28; no
drift):

```
--ground #14171c   --panel #1c2027   --raised #242a33
--hairline #2e353f --text #d7dde5    --muted #8b95a3
--accent #5aa9e6   --additive #e0b64d --subtractive #e0685a
--good #5fbf8f
--font-ui "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif
--font-mono "IBM Plex Mono", "SFMono-Regular", Consolas, monospace
--text-xs 11px --text-sm 12.5px --text-md 13.5px --text-lg 15px --text-xl 18px
```

Hover/selection (canvas, from BrepViewportThree.tsx:1069/1080, kept verbatim):

```
--hover-cyan #8be9fd   (hue ~180, hover)
--sel-pink  #ff79c6   (hue 326, selected)
```

**Separation rule:** hover and selection stay ≥60° apart in hue. This exists
because violet's collapse to 48° from selection pink is documented history
(BrepViewportThree.tsx:1109-1112); the current cyan/pink pair gives ~146°
and is correct -- freeze it as a named rule so no future state color repeats
the violet mistake. State colors: sketch/constraint state uses
--good/--subtractive; conflict notes get their own token -- call: define
`--conflict #e05252` rather than overloading --subtractive, because "this
tool subtracts material" and "your model is broken" must not be one color.

## 7. Adoption map

| New element | File(s) | Replaces | Retires (friction root causes 1-6) |
|---|---|---|---|
| App grid shell, topbar, docks | ReshapeStudio.tsx | floating ribbon + tools card + floating timeline (§3) | (1) floating chrome; all 5 measured collision fixes (Studio:123-135, Editor:460-470, Studio:1596-1617, Viewport:2779-2823, Overlay:1923-1932) |
| Vertical toolbar + search box | ModelEditor.tsx (ribbon groups) | ribbon top strip | (1); (4) hint-pills-over-buttons at the top edge |
| One selection store | ModelEditor.tsx + ReshapeStudio.tsx (ownerOf path) | per-consumer selection state | (2) panel/canvas desync (Studio:791-801 pattern, Item U) |
| Right-click context menu | BrepViewportThree.tsx + SketchConstraints.tsx | (new) | (6)-adjacent: modifier-gated affordance discovery |
| Escape stack | ReshapeStudio.tsx (keydown owner) | hand-rolled priority chain | (3) Escape ownership ad-hoc |
| Point-anchored hover pills | BrepViewportThree.tsx, HandleOverlay.tsx | corner-anchored pills | (4) pill/button collisions (Viewport:2895-2900, Overlay:1925-1932) |
| Note taxonomy + ticker | ReshapeStudio.tsx (portal slots), all panels | shared band/portal slots | (5) one band, too many messages |
| Inline-slider dimension rows | ReshapeParamsPanel.tsx | static value rows | (5)-adjacent: panel note overload |
| Status bar | ReshapeStudio.tsx | corner badges (selection/engine/conflict), Home, stage hint | (1), (4) remaining corner collisions |
| Timeline rollback bar + chip anatomy | ModelEditor.tsx | floating strip's ad-hoc chip markup | (2) desync via chip click select path |

Non-touching files: SketchConstraints.tsx changes only where its selection
and Escape handling join the shared stack (§4.3) -- its solver and toolbar
vocabulary are out of scope. `packages/sketch` and engine adapters are
untouched; this spec is UI-shell and interaction-only.

## 8. Risks & open questions

1. **Alt+C / ribbon search keep-or-drop.** Leaning keep (§4.2): the search
   index and alias behavior are already built and praised; the open question
   is whether the search box lives in the toolbar (proposed) or the topbar.
   Decision needed before phase 1.
2. **Build/Code toggle placement.** Proposed: topbar center (mockup
   `.mode-switch`). Open question: whether Code keeps its own header (today
   it is a separate stub surface in sandbox-dev); if Code grows real chrome,
   the toggle may want to be a topbar tab pair instead.
3. **Rollback UI: timeline bar vs tree.** Decided timeline-native (§5.5
   call) because lesson text speaks linearly; risk: dependency-aware delete
   semantics (already richer than studio.html) are tree-shaped, and the bar
   must not imply a strict order the model does not enforce. Mitigation:
   chip ⚠ and dimming encode "depends on", not position alone.
4. **Right-click menu discoverability.** Students who never try right-click
   still get the toolbar (principle 6: nothing lives only in the menu) --
   the menu is redundant access, not exclusive access. Risk accepted.
5. **Touch support: out of scope.** Mouse-first by design (§2.6); touch and
   pen are a separate spec. No component here may *break* under touch, but
   no touch affordance is built.
6. **Escape tier 1 vs tier 2 overlap.** Disarming a draw tool that also has
   an active selection: one keypress = one tier, but student intent ("back
   out") wants both. call: tier 1 takes the first Escape (disarm), tier 2
   the second (clear selection) -- matches the current hand-rolled muscle
   memory; revisit if the right-click menu makes tool-arm state rarer.
7. **Viewport safe area** (nav cube zone, §5.8) constrains `camera-fit.ts`;
   needs a measured check that fitting never places geometry under the safe
   area at default zoom.