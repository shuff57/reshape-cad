# SPEC — studio: a persistent "using OCCT" badge after an engine swap (2026-09-15)

Operator decision, 2026-09-15: **the engine swap stays permanent for the mount** (do not
change that), and a small persistent badge tells the student which engine is actually
drawing their model. If any path in this spec does not exist, STOP and say so rather than
guessing.

## WORK STYLE

Keep every message short. First code edit within 6 tool calls. Small surgical UI change:
do not refactor the viewport, do not touch geometry, do not change engine selection or the
fallback mechanism itself.

## The gap this closes

`packages/studio/src/model/BrepViewportThree.tsx`:
- the swap is permanent: `engineRef.current = fallback` at line ~2334 (the FreeCAD
  throw path) and line ~2356 (the brep-rs refusals path);
- the existing note is PER BUILD: it is set in those same branches and cleared at the top
  of every build (line ~2284).

So after the first swap, every later build runs on the fallback engine, which refuses
nothing, so no note appears and nothing on screen says the configured engine is no longer
in use. Measured in a browser 2026-09-15: Box + Round, Clear model, Box + Round again --
the second build silently rounds on OCCT with no notice.

Keep the per-build note exactly as it is. Add a separate, persistent badge.

## What to build

1. State: alongside `engineFallbackNote` (line ~527), add something like
   `const [engineSwappedTo, setEngineSwappedTo] = useState<'occt' | null>(null)`.
2. Set it in BOTH fallback branches, right where `engineRef.current = fallback` happens.
   NEVER clear it: it describes the mount, and the swap is permanent by design. Do not
   clear it at the top of the build effect where the note is cleared.
3. Render a small badge whenever it is set. Text: `using OCCT`. Give it a `title`
   explaining why, for example "brep-rs could not build a feature in this model, so the
   OCCT engine is drawing it for the rest of this session." Reuse the existing style
   constants (`COLORS`, the same font stack as `engineFallbackNoteStyle`); make it
   visually quieter than the note -- this is a status, not an alert.
4. Placement: it must not overlap the floating tools card on the left
   (`.reshape-studio-tools`, width `min(420px, 45%)` at `left: 12`), the part pill (top
   right), the view cube (bottom right), or the timeline strip (bottom centre). The
   fallback note already solves the same problem at line ~2879 with
   `left: calc((100% + min(420px, 45%)) / 2 + 6px)`; follow that pattern rather than
   inventing a new one, and pick a spot that does not collide with the note itself, since
   both can be on screen at once on the build that triggers the swap.

## How to see it

A fallback needs a feature brep-rs refuses. With `VITE_RESHAPE_ENGINE=brep-rs`:
- Hollow (shell) a CYLINDER -- brep-rs only hollows boxes, so it refuses.
- Or Round an edge of a non-box.
(The box/cylinder `round` property is being implemented right now in another dispatch, so
do not rely on it as your trigger.)

A dev server may already be running at http://localhost:5288/. If you have no browser
tool, say so plainly instead of claiming you saw the badge.

## Constraints

1. Edit only `packages/studio/src/`. Do NOT touch `packages/kernel`, `packages/brep-rs`
   (another run is editing it right now) or `scripts/brep-*.mjs`.
2. `npm run build` must pass, and `npm test -w @shuff57/reshape-studio` must stay green
   (28 tests today).
3. Do not change the swap, the note, engine selection, or any geometry code.

## Done means

`npm run build` passes, studio tests pass, the badge appears after a swap and stays for
the rest of the session, and it overlaps nothing.

## Report (one message)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or unverified goes in the first sentence). Include:
where you set the state, where and how you placed the badge, the build and test results,
files changed, ONE design decision this spec did not pin down, and which checks you could
NOT perform -- in particular say whether you actually saw it rendered.
