# Holes from the bottom: plan B, steps 1 and 2 (2026-11-20)

Plan: `../PLAN-copies-low-holes-2026-11.md`, part B. The owner chose the spelling `from: 'bottom'` and said to start part B in a worktree
(branch `holes-from-bottom`) while the copies sweep runs on `main`. Step 1 is the language and **plain** holes from the bottom;
step 2 (below) adds a counterbore or countersink from the bottom.

## The language (`packages/script`)

- `hole(part, { ..., from: 'bottom' })` and `holes(...)` drill from the face at the LOW end of the axis; with no `from`, the hole is
  drilled from the high end as before, and every existing document reads and writes exactly as it did. Any other value stops the
  script: "hole's from is 'bottom', to drill from the low end of its axis; leave it out to drill from the top. You gave it ...".
- `HoleFeature.from?: 'bottom'`. The mouth's offset along the axis is the top hole's with the sign turned (`holeAxialOffset`), and a
  depth change keeps the side (`withHoleDepth`). `toScript` writes `from: 'bottom'` back (left out, a round trip would quietly drill
  from the top). VOCABULARY and dependsOn are untouched (`from` is an option, not a word).
- The docs (`reshape-docs.ts`) say nothing yet: the page refuses these holes until the owner turns them on.
- Tests: `test/hole-from-bottom.test.mjs` 3 of 3; the package's suite 397 of 403 with 0 failing (the rest skipped, as before).

## The layer (`packages/layer`)

- `ctx.allowBottomHoles` (off unless set; nothing sets it). Off: a hole from the bottom is refused in a sentence (G-BOTTOM), in the
  holes planner and in the base translator alike. On: a plain hole from the bottom is built; a recess from the bottom is still refused.
- G-TOP probes the mouth where it is: for a hole from the bottom, the probe disc is cut just above the tool's bottom (material above,
  air below), the same test mirrored; its family check (`flatTopCurved`) is the same at both ends. The plain bore, the volume model
  (`holeProfile`) and the other guards of a plain hole are symmetric already.
- The new sentences are kept apart from `SENTENCE` (the differential tests hold that table to the original's), and the probe's
  record gains a `mouth` field only for a hole from the bottom.
- Tests: the whole layer suite in the worktree 251 of 251 with the switch off (a first version failed 7: it put the new sentences in `SENTENCE` and a `mouth` field on every probe record); the holes differential suite 17 of 17.

## Live, against the OCCT referee (`live-bottom-holes.mjs`, `live-bottom-holes.out`)

11 scripts on the pinned engine with the switch on and off, scored against OCCT's build (a plain bore is built about its centre
there, so it is an independent build of a hole from the bottom) and against the volume worked out by hand:

- **No wrong solid.** Right against both: a box drilled from the bottom along z, x and y; four corner holes from the bottom; a
  cylinder; a pulled sketch; a hole from the bottom and one from the top in one part; a through hole marked from the bottom. The
  centre of mass moves up as material leaves the bottom (comZ +0.057 on the box, as a top hole's is -0.057).
- A sphere's bottom pole is refused, as its top pole is (G-TOP: the face is not flat there), now in the bottom's own words.
- (Step 1) A counterbore from the bottom was refused, as it had to be until step 2.
- With the switch off, every hole from the bottom is refused.

## New sentences (approved by the owner as written, 2026-11-20)

- `hole's from is 'bottom', to drill from the low end of its axis; leave it out to drill from the top. You gave it {the text "top"}.`
- `hole() cannot find where the bottom of this {box} is along {z} exactly, so a hole that stops short of the other side cannot start at the bottom. ...` (the top sentence's twin)
- `{hole1} (hole): a hole drilled from the bottom is not built in this version yet, so {hole1} is shown without it -- drill it from the top (leave out from:).`
- (step 1 only, removed in step 2: no longer said) `{hole1} (hole): a {counterbore} drilled from the bottom is not built in this version yet, ...`
- `{hole1} (hole): a hole drilled from the bottom that stops short of the other side starts on the bottom of the part, but the part is not flat and level over this spot, so {hole1} is shown without it -- move the hole under a flat bottom, or let it go all the way through.`
- In the base translator (not shown in the page): `{hole1} (hole): a hole drilled from the bottom is not mapped`.

## Step 2: a counterbore or countersink from the bottom

- **Measured first** (`measure-recess-bottom.mjs`, `.out`): native `solid.hole` with its position on a box's bottom face drills into
  that face with or without `direction: +z`, a counterbore and a countersink, blind and through, each within 1.5e-6 to 4.6e-6 of the
  volume worked out by hand (the engine's curved faces), the centre of mass moving up as it should.
- **The layer** (`holes.ts`, `shell-draft.ts`): the recess is cut on the low face with `direction` +axis; G-TOP probes the low face for
  a recess; G-NEST looks at earlier holes that reach the bottom; the cavity check (G-RECESS) compares the tool's bottom with the low
  face; the closed-form volume check works out a hole from the bottom with the axis turned over and turns its profile back, so a
  mix of holes from the top and the bottom on a box is still checked; G-CSOPEN (HALT-8) refuses hollowing open the face a
  countersink from the bottom opens onto (the low side). The step-1 refusal of a recess from the bottom is gone.
- **The OCCT referee** (`packages/brep-adapter/src/occt-build.ts`): the recess tool's mouth is measured from the part's low face and
  the tool turned over (a half turn about its own x) for a hole from the bottom. Changed in the same step as the layer, so every
  recess case below is also checked against the volume worked out by hand, which does not depend on either.
- **Live** (`live-bottom-holes.mjs` now 17 scripts): no wrong solid. Right against OCCT and by hand: a counterbore and a countersink
  from the bottom, blind and through; a counterbore along x; a counterbore from the top and one from the bottom in one part.
  A countersink from the bottom and then a hollow open at the bottom is refused by G-CSOPEN.

## Next

1. A sweep with both switches on, as for copies; then the owner's decision for the page, the docs line, and shCode's writer
   (`lib/solidcraft-ui-to-code.ts` writes `from: 'bottom'` instead of refusing a hole drilled up from the low face).
