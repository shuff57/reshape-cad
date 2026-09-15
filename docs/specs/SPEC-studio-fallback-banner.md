# SPEC — studio: fix the engine-fallback banner (2026-09-15)

Two UI defects found by a visual pass of the brep-rs engine (see `.msgbox/FUTURE.md`,
entry "brep-rs renders in the studio"). Both are in the fallback NOTIFICATION, not in
any geometry. If any path in this spec does not exist, STOP and say so rather than
guessing.

## WORK STYLE

Keep every message short. First code edit within 6 tool calls. This is a small, surgical
UI change: do not refactor the viewport, do not touch geometry or engine selection.

## Background

When the active engine refuses a feature the other engine can build, the studio swaps to
the fallback engine for the rest of the mount and shows a note. The state is
`engineFallbackNote` in `packages/studio/src/model/BrepViewportThree.tsx` (grep for
`setEngineFallbackNote`). Its text looks like:

"This model uses a feature brep-rs can't build yet (Rounding box box1 is not supported by
brep-rs yet -- box1 is shown without it.) -- showing it with the other engine."

## Defect 1 — the banner is clipped by the Parts sidebar

Measured in a browser: the note is centred in the whole viewport pane (`left: 314.5px`),
while the opaque Parts/Planes sidebar covers x 0-433px, so about 27% of the banner's left
edge is hidden behind the sidebar and unreadable.

Fix: position the note so it centres in the VISIBLE area (right of the sidebar), or pin it
to a corner of the visible area. Read how the sidebar's width is known in this component
(or its CSS) and reuse that; do not hard-code 433. If the width is only in CSS, a CSS-side
fix (for example placing the note inside the same flex/grid child the canvas lives in) is
preferred over measuring in JS.

## Defect 2 — the banner is stale

Reproduced: trigger the fallback (a box with `round` set), then Clear model and build a
plain box that needs no fallback. The banner stays on screen, still naming the feature
that no longer exists.

Fix: clear the note when a build produces no refusals that caused a fallback. Find where
the build effect sets it and add the matching clear on the success path. Do NOT clear the
engine swap itself — once an engine has been swapped for the mount, that stays, as its own
comment explains. Only the note goes away.

## Constraints

1. Edit only `packages/studio/src/`. Do not touch `packages/kernel`, `packages/brep-rs`,
   `scripts/brep-*.mjs` (the lead holds claims on those) or any spec.
2. `npm run build` at the repo root must pass (it type-checks studio).
3. Do not change engine selection, the fallback mechanism, or any geometry code.
4. Keep the existing wording of the note.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
npm run build
npm test -w @shuff57/reshape-studio     # if the package has tests
```

A dev server with the brep-rs engine may already be running at http://localhost:5288/
(VITE_RESHAPE_ENGINE=brep-rs). You can use it to check your fix by hand if you have a
browser tool; if you do not, say so rather than claiming it was verified visually.

## Done means

`npm run build` passes, the note is fully visible next to the sidebar, and it disappears
on the next build that needs no fallback.

## Report (one message)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or unverified goes in the first sentence). Include:
what you changed and where, how you positioned the note, where you cleared it, the build
result, files changed, ONE design decision this spec did not pin down, and which checks you
could NOT perform (you have no image input, so say whether you saw the fix rendered).
