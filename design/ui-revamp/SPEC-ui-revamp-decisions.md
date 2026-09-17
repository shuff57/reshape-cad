# ADDENDUM: UI revamp decisions -- the pick sheet, resolved

Status (2026-09-15): decision worksheet for SPEC-ui-revamp.md; nothing here
revises that spec's architecture, it resolves the pick-from-the-kit step.
The revamp produced three full-page mockups (`design/ui-revamp/`:
mockup-A-docked.html = docked discipline, mockup-B-canvas-first.html =
canvas-first, mockup-C-guided.html = guided stages) plus ui-kit.html (16
element cards). Every choice is stated as a recommendation with rationale so
a reviewer can approve or veto in one pass. `call:` marks judgment calls
the reviewer may overrule.

## 1. The hybrid recommendation

**Base architecture = Mockup A's docked grid, with one imported floating
element.** The shell is A's grid -- topbar 44 / toolbar 52 /
[left 280 | viewport | right 240] / timeline 56 / status 26 -- and floating
chrome is permitted ONLY for: drag handles, the selection strip, hover
pills, toasts, and ONE new addition, the context bar (below). Everything
else docks.

Why A wins: the SPEC's measured friction ledger attributes the majority of
the ~85 documented collisions to floating chrome -- ribbon against hints
(Studio:123-135), rules pane against tools card (Editor:460-470;
Studio:1596-1617), corner-anchored pills against corner-anchored buttons
(Viewport:2779-2953; Overlay:1923-1932). Docking is not a style preference;
it removes the collision *class*. Per-element fixes already chase the
symptom; this stops paying for them.

**Adopt from B: the context bar** -- the single floating chrome element.
Content policy: appears on solid/sketch selection; holds that feature's top
3-5 actions (the same verbs the toolbar exposes -- never a second
vocabulary, SPEC §4.1 rule); anchored above the selection's screen position;
dismissed by Escape (registers in the stack, tier 3) or click-away. It
NEVER overlaps the topbar or timeline -- docked rows reserve their space, so
the bar flips below the selection when near the top edge and is clamped
above the timeline otherwise.

**Adopt from C: the coach card, NOT the stage rail (by default).** The
coach card lives in the Dimensions panel: one-sentence next action, green
border (mockup-C `.coach-card`). The stage rail ships only as a lesson-mode
opt-in a teacher flips on; the sandbox ships Free mode. Reason: the
students-vs-sandbox duality already exists in the codebase --
`ReshapeStudio.tsx:100,198` defaults `autoRunOnMount = true` and
`sandbox-dev/src/App.tsx:39` passes `false`. The lesson layer already knows
who it is talking to; the rail belongs behind that same flag, not in the
default chrome.

call: A + B's one floating bar + C's coach card is the whole hybrid. If the
reviewer wants the stage rail in Free mode too, it is a flag flip later --
adopting it now buys guided polish at the cost of the density the sandbox
user did not ask for.

## 2. Decision table

Element-by-element verdicts. Source = kit card number (ui-kit.html) and/or
mockup. ADOPT = build it; KEEP = already built, retain (restyled if noted);
DEFER = revisit later with a stated trigger; DROP = not adopted.

| # | Element | Decision | Source | Where it lands | Reason |
|---|---------|----------|--------|----------------|--------|
| 1 | Docked grid shell (A) | ADOPT | A, SPEC §3 | `ReshapeStudio.tsx` | removes the floating-chrome collision class |
| 2 | Fusion ribbon w/ group captions | ADOPT as docked toolbar row | A; kit 1 | `ModelEditor.tsx` (ribbon groups) | group captions teach vocabulary without tooltips |
| 3 | Flyout families | KEEP as-is | BUILT (kit 2) | `ModelEditor.tsx` | already built; behavior survives docking |
| 4 | Tool search, Alt+C | KEEP | BUILT (kit 15) | `ModelEditor.tsx` search box | cheap, already built; SPEC §4.2 keep-or-drop resolved |
| 5 | Parts/Planes dock | ADOPT | A; SPEC §5.2 | left dock, `ReshapeStudio.tsx` | replaces the floating tools card |
| 6 | Rules panel docked | KEEP | already done in code; SPEC §5.3 | left dock below Parts | docking of it is already the shipped state |
| 7 | Dimensions panel + full-width slider line | ADOPT the slider-line rule | kit 7 | `ReshapeParamsPanel.tsx` | one line = label + slider + value; the panel itself stays |
| 8 | Timeline chips | KEEP, restyled | kit 5 | `ModelEditor.tsx` | chips exist; restyle to chip anatomy (SPEC §5.5) |
| 9 | Rollback ticks between chips | ADOPT over the tree bar | kit 6 ("pick one") | `ModelEditor.tsx` timeline | linear strip matches how lesson text speaks |
| 10 | Context bar | ADOPT | B; kit 4 | new component, `packages/studio/src/model/` | PROPOSED-NEW; puts valid verbs at the selection |
| 11 | Inline dimension flags | DEFER | kit 14 | -- | needs geometry-anchored editing infra the app lacks; revisit after drag-handle refactor |
| 12 | Tab radial | DROP for now | B | -- | discoverability risk for a never-opened-CAD audience |
| 13 | Right-click context menu | DEFER to a later pass | SPEC §4.1 | mark in SPEC §8 risk table | redundant with toolbar + context bar; menu adds a 4th Escape consumer |
| 14 | Status bar | ADOPT | A; kit 16; SPEC §5.8 | `ReshapeStudio.tsx` | PROPOSED-NEW; gives every note a single home |
| 15 | Nav cube | KEEP as-is | BUILT (kit 12) | `BrepViewportThree.tsx` safe area | already built, safe-area rule in SPEC §5.8 |
| 16 | Home pill | KEEP | BUILT | topbar (re-anchor) | behavior built; anchor moves per SPEC §3 |
| 17 | Stage rail / coach card | Rail DEFER; coach card ADOPT | C; kit 13 | Dimensions panel | rail behind lesson flag; coach card is free density |
| 18 | Escape stack (registry) | ADOPT | SPEC §4.3 | `ReshapeStudio.tsx` keydown owner | retires the hand-rolled priority chain |

Count: 9 ADOPT, 6 KEEP, 2 DEFER + 1 split DEFER/ADOPT, 1 DROP, 1 deferred
menu. Nothing adopted without a home file; nothing dropped without a
reason a reviewer can veto.

## 3. What each mockup contributes / retires

**Mockup A contributes the grid and the docking discipline** -- the whole
shell, the toolbar-as-row decision it resolves toward (a row above the
viewport rather than SPEC §3's vertical column; see call below), and the
status bar. It retires the floating-card collision fixes as dead code:
Studio:1443-1447 (flex-shrink guard), Studio:1596-1617 (rules-pane margin
dodge), Viewport:2779-2783 (top:56 stack), Viewport:2805-2817 (left:70 rail
dodge), Overlay:1923-1932 (alarm reposition). Five measured hacks die the
day the grid ships.

call: A's toolbar is horizontal (52px row). SPEC §3 called for a vertical
left column. The row wins: it shares the top edge with the topbar it
serves, keeps the left dock purely for Parts/Rules/Dimensions, and the
vertical-column argument (hint collisions at the top edge) is answered by
the status bar -- hints have a home now. Reviewer may revert to the column;
the grid does not care.

**Mockup B contributes the context bar and the inline-flag concept.** The
context bar is adopted (§2 row 10); the permanent Dimensions panel is
retired ONLY when a selection exists -- the slide-in panel stays for the
no-selection state. Flagged risk, stated plainly: floating UI was the
collision source, so the context bar must obey a strict anchor + collision
policy -- one bar at a time, anchored above selection, flips below when
near the top edge, never over topbar/timeline (§1). Inline flags (kit 14)
are the concept B proves; they DEFER on infrastructure, not on merit.

**Mockup C contributes the coach card and stage badges.** The coach card
adopts into the Dimensions panel (§1); stage badges ride along wherever the
lesson flag lands. The rail itself ships behind that flag: lesson mode
opt-in, sandbox stays Free mode. C's full guided shell -- rail always
visible, sandbox hidden -- retires as a default.

## 4. Palette decision (REVISED 2026-09-16): the split stays — lean in

~~The original recommendation (2026-09-15): adopt ONE family during
adoption; no dual-track -- keep the chrome family for all chrome (docks,
topbar, timeline, status) and port the viewport's `COLORS` object onto the
chrome tokens (viewport bg/panel/line/dim map to
--ground/--panel/--hairline/--muted equivalents).~~

**SUPERSEDED 2026-09-16 by user decision:** the user approved the render
of `mockup-H-hybrid.html` ("i like how its rendered as is") AFTER it was
reskinned to the shCode aesthetic, which keeps the two-system split. The
split is intentional, and it matches both shCode's own practice (chrome
token variables plus hardcoded Dracula surfaces across ~30 components) and
what `BrepViewportThree.tsx:95` already ships (the #282a36 family). New
decision: chrome adopts the shCode token family (§4a); the viewport stays
-- and leans into -- Dracula. No port of `COLORS` onto chrome tokens.

The ≥60° hue-separation rule (SPEC §6; measured 48° collapse history,
BrepViewportThree.tsx:1109-1112) still governs state colors: hover cyan
#8be9fd and selected pink #ff79c6 must stay separated. Re-check on paper
whenever a new selection or hover color is added, before it ships.

## 4a. Skin decision (2026-09-16): shCode aesthetic

The user approved `mockup-H-hybrid.html` rendered in the shCode skin
(2026-09-16). That skin is now the design direction for all Studio chrome.

Token summary:

| Surface | Tokens |
|---------|--------|
| Chrome | ground #252525, panel #1e1e1e, raised #2a2a2a, hairline #333, text #ccc, muted #8b93a7, accent #5baafd (source: shCode `app/globals.css:5-12`) |
| Semantic | additive #50fa7b, subtractive #ff79c6, conflict #ff5555, info #bd93f9, hover #8be9fd |
| Code surfaces | bg #282a36, panel #21222c, well #1e1f29, border #44475a, fg #f8f8f2, dim #6272a4; syntax extras #f1fa8c / #bd93f9 / #ffb86c; viewport dot grid #3b3d4d |

Typography: Courier UI stack (`'Courier', monospace`, line-height 1.6);
Fira Code 13px editor stack; 11px/700/uppercase/.08em kickers for dock,
toolbar, and status headers.

Shape: 4px radius on controls, 3px on tiny chips, 6px on flyouts, 999px on
pills; flat 1px hairlines; soft shadows reserved for elevation -- 0 2px 4px
on docks, 0 8px 24px on floaters.

Chrome idioms: badge = color+'22' background / +'55' border / 11px 600
uppercase; Build|Code = underline tab with 2px #22c55e active bar; viewport
canvas = #21222c + #3b3d4d dot grid (DiagramEditor signature); hint and
refusal panels = #282a36 with #ffb86c55 border.

This **SUPERSEDES SPEC §6's token block and the studio-mockup-dark family**
for all future Studio UI work; SPEC §6 remains as historical record.
Reference render: `mockup-H-hybrid.html` (approved 2026-09-16).

Builder judgment calls recorded during the H reskin: timeline chip accent
bars are 2px, not the 6px in the kit spec (the chips are too short for 6px);
dock panels are flat -- soft shadow is reserved for floating elements; the
"the real name:" tooltips stay native `title=` rather than custom popovers.

## 5. Adoption order

Five steps, each independently shippable, in this order. All are UI-shell
changes behind the existing script.js contract -- nothing touches the doc
model -- so each step's rollback is a revert of its own commit; the model
file is untouched throughout.

1. **Status bar + note taxonomy consolidation.** Lowest risk; gives every
   message a home before anything moves. Files: `ReshapeParamsPanel.tsx`
   (note classes), `BrepViewportThree.tsx` overlays (badge retirement).
   Rollback: revert; corner badges reappear.
2. **Docked grid restructure of ReshapeStudio.** The big one -- retires the
   5 collision hacks (Studio:1443-1447, Studio:1596-1617,
   Viewport:2779-2783, Viewport:2805-2817, Overlay:1923-1932). Done after
   step 1 so status/note messages already have a home. Files:
   `ReshapeStudio.tsx`, `ModelEditor.tsx`. Rollback: revert; floating
   chrome returns with its hacks.
3. **Timeline rollback ticks + chip restyle.** Files: `ModelEditor.tsx`.
   Kit 6 "pick one" resolved to ticks; tree option drops. Rollback:
   revert; existing chip markup returns.
4. **Context bar.** New component in `packages/studio/src/model/`, wired to
   the selection state ReshapeStudio already owns (SPEC §2 principle 2 --
   no private selection). Files: new component + `ModelEditor.tsx` wiring.
   Rollback: revert; toolbar remains the only verb surface.
5. **Coach card + lesson-mode stage rail.** Last, gated on the lesson flag
   (`autoRunOnMount` duality, §1). Files: `ReshapeParamsPanel.tsx` (coach
   card), lesson-mode wiring in `ReshapeStudio.tsx`. Rollback: revert;
   sandbox unaffected either way.

### Step 1 — SHIPPED (2026-09-16)

Status bar shipped in `packages/studio/src`: footer `role="status"`
`aria-live="polite"` as last flex child of ReshapeStudio (26px,
`STATUS_BAR_HEIGHT_PX`); note ticker (StudioNote severity taxonomy from
new `src/notes.ts`: instruction/conflict/info/success/status → existing
`--reshape-*` tokens), engine dot, bbox readout (new `dimsMm` on
BrepViewportStats), selection readout with click-to-clear, static nav hint.

Note priority as shipped: stale-error+scriptError → stale-error
refusal/generic → refusal → scriptError alone → stale-empty → rebuildMs →
null (code-mode script errors surface as themselves -- first review caught
the interception, fixed in rework). `badgesInStatusBar=true` gates
BrepViewportThree's top-right selection/edge-hint stack (default false,
backward-safe); engine fallback notices left in-viewport.

Timeline bumped to `bottom:26px`; pane-view padding and HandleOverlay
bottomInset follow `STATUS_BAR_HEIGHT_PX`. The five collision hacks remain
untouched -- that is step 2. Verification: `tsc --noEmit` clean, studio
tests 28/28, build clean; independent review PASS-WITH-NITS (2 cycles:
FAIL→rework→PASS-WITH-NITS); one accepted cosmetic nit (Build selection
label persists in Code mode footer). Open question #2 is partially
answered: ReshapeStudio owns the status row; toolbarExtra ownership (host
Reset/Fullscreen) unchanged.

### Step 2 — SHIPPED (2026-09-16)

Docked grid shipped in `ReshapeStudio.tsx`: the root is a CSS grid -- Build cols
`280px 1fr`, rows `52px/1fr/58px/26px`, areas `toolbar/tools-view/timeline/status`;
Code cols `minmax(0,2fr)/minmax(0,3fr)`, timeline row 0, left dock `display:none`;
`.reshape-studio-body` = `display:contents` so its children are the grid items.
The params panel stays INSIDE the pane as its internal 240px strip (F1
adjudication: the pane spans the full 1fr -- no orphaned third column). Code mode
keeps the viewport preview (product decision preserved; mockup-H's no-viewport
Code variant NOT adopted -- noted as a future product call).

All seven hacks/cousins retired, each verified by independent review: (1)
flex-shrink guard pairing resolved (toolbar is a real row); (2) rules margin
dodge + `min(420px,45%)` calcs deleted; (3) topRightStack top:56→12; (4)
stageHint top:56→12; (5) engineNoticeStack top:92→12 + left:50%/translateX(-50%)
(phantom card width gone); (6) viewStrip left:70→12; (7) `.sketch-alarm`
top:60/right:16→12/12. `BUILD_CHROME_TOP_PX` deleted, replaced by
`TOOLBAR_HEIGHT_PX=52`; HandleOverlay bottomInset 84→0 (timeline + status are
grid rows outside the pane-view). Flyout menus unaffected (`position:fixed` by
design -- verified, not clipped).

Collapses are now track-width overrides: `.is-tools-hidden` → 46px column;
`.is-code-collapsed` → 32px column (new root class; the old `.is-collapsed` flex
removed). `is-card-empty`/`cardHasContent` dead state removed (ModelEditor's
optional `onContentChange` prop remains, unused -- harmless).

Review history: 2 cycles -- review 1 FAIL (F1 orphaned params area: 240px dead
column in Build; F2 Code inversion: preview dies after first Run -- both
invisible to tsc/tests, found by grid-placement derivation), rework cycle 1
fixed F1+F2+N1-N5, re-review PASS (one theoretical non-blocking nit:
`.is-tools-hidden` lacks an `.is-build` guard -- unreachable today).
Verification: tsc clean, studio tests 28/28, build clean. NOT done: no browser
render by any agent -- the grid geometry is code-verified only; the visual
eyeball (Build 240px-flush right edge, Code preview alive after Run, both
collapses, fullscreen) remains the human check via `npm run dev:sandbox`. Step 2
retires the dead-code list from §3 -- the "five measured hacks die the day the
grid ships" paragraph is now historical.

### Step 3 — SHIPPED (2026-09-16)

Timeline chip restyle: 2px state accent bars (selected `--reshape-pink`,
refused `--reshape-danger`, pending muted), 3px radius, 11px/600/uppercase/
.04em -- the shCode badge idiom from §4a. Rollback ticks restyled on the
PRE-EXISTING `.model-rollback-handle` buttons (no new DOM, keyboard-accessible):
tick-before-chip-k → `onRollback(k)` → `slice(0,k)`, semantics unchanged. The
refused ⚠ badge adopts the shCode warn idiom (rgba .13/.33); card glyph
severity unified to danger. Polish fold-ins from the visual audit: BROWSER
kicker hidden in the 46px collapsed rail; Code-mode empty-run note "Script ran
but built nothing…" (mode-aware stale-empty, severity status).

Review: PASS-WITH-NITS, 3 cosmetic nits fixed (card glyph severity unified,
2 redundant CSS decls). VERIFIED BY SCREENSHOT (a first for this effort):
design/ui-revamp/shots/ 07/08/09 -- chips+ticks live with a two-box model,
bbox readout showing real dims, kicker gone in rail, empty-run note rendering.
Note: 06-timeline.png missed its subject (empty doc = no chips) -- superseded
by 09. Standing "no render" caveat retired 2026-09-16: subagent-driven
Playwright capture + orchestrator image review is now part of the loop
(design/ui-revamp/shots/, gitignored).

### Step 4 — SHIPPED (2026-09-17)

Context bar shipped: new packages/studio/src/model/ContextBar.tsx -- presentational
pill (who + ✎ Dimensions primary + per-kind toolbar verbs + mono param chips +
⚠ refusal sentence), anchored above the selection, flips below near the top edge,
Escape/click-away dismiss. Anchor via a synthetic `__ctx_` HandleSpec from new
`featureCenter()` (packages/script/src/model-handles.ts) through the EXISTING
projection pipeline -- no BrepViewportThree changes, answering open question #3's
projection concern. Actions via `registerContextActions` (the SketchConstraints
registerActions pattern) handing out ModelEditor's real closures --
dependents-confirm delete flow preserved. Per-kind contents: shapes
Round/Turn/Hole/Hollow/Repeat/Mirror/Move/Copy; sketch Pull/Spin; param features
Dimensions/Move/Copy/Delete. Rolled-back features auto-hide (effectiveDoc gate).

Review history: review 1 FAIL -- #2 infinite render loop (registrar→setState;
fixed receiver-side: ctxActionsRef + presence-boolean, reads at click time),
#1 stray `__ctx_` dot (filtered from HandleOverlay points), #4 Escape double-fire
(canDismiss gate); re-review PASS all three. Gates: tsc clean, 28/28, root build
clean. Visual proof: capture attempts repeatedly cancelled (nested claude-CLI
hung overnight waiting on an unanswerable question -- wrapper pattern hardened:
skip-permissions + stdin closed); visual proof of the bar is the ONE step-4 item
NOT yet screenshot-verified, eyeball via `npm run dev:sandbox` remains.

## 6. Open questions remaining

1. **Build|Code toggle placement.** All three mockups assume topbar center
   (SPEC §8.2 proposal). Confirm -- or the toggle grows into a topbar tab
   pair if Code grows real chrome.
2. **Status bar ownership.** ReshapeStudio renders it, but SandboxWorkspace
   folds its own Reset/Fullscreen into the toolbar row today; who owns the
   row -- studio unconditionally, or sandbox-specific additions?
   (partially answered 2026-09-16: ReshapeStudio owns the status row; toolbarExtra untouched)
3. **Inline dimension flags (DEFER, row 11) need a screen-space projection
   API on BrepViewportThree.** Does one exist to build on? HandleOverlay
   already projects anchors -- if that path is reusable, the defer-shortens
   to "after drag-handle refactor" rather than "new API."
   (answered 2026-09-17: projection API exists and is reusable -- synthetic
   anchor spec through projectAnchors; see Step 4)
4. **Touch/tablet posture remains out of scope** (SPEC §8.5). Confirm; no
   touch affordance ships in any adopted step above.

Companion artifacts: SPEC-ui-revamp.md (architecture), ui-kit.html (element demos), mockup-A/B/C.html (full-page variants), mockup-H-hybrid.html (the approved hybrid, shCode skin).