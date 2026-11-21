# Holes from the bottom: plan B, step 1 (2026-11-20)

Plan: `../PLAN-copies-low-holes-2026-11.md`, part B. The owner chose the spelling `from: 'bottom'` and said to start part B in a worktree
(branch `holes-from-bottom`) while the copies sweep runs on `main`. Step 1 is the language and **plain** holes from the bottom; a
counterbore or countersink from the bottom is refused in a sentence and is step 2.

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
- A counterbore from the bottom is refused, as it must be until step 2.
- With the switch off, every hole from the bottom is refused.

## New sentences (approved by the owner as written, 2026-11-20)

- `hole's from is 'bottom', to drill from the low end of its axis; leave it out to drill from the top. You gave it {the text "top"}.`
- `hole() cannot find where the bottom of this {box} is along {z} exactly, so a hole that stops short of the other side cannot start at the bottom. ...` (the top sentence's twin)
- `{hole1} (hole): a hole drilled from the bottom is not built in this version yet, so {hole1} is shown without it -- drill it from the top (leave out from:).`
- `{hole1} (hole): a {counterbore} drilled from the bottom is not built in this version yet, so {hole1} is shown without it -- drill it from the top, or leave out the {counterbore}.`
- `{hole1} (hole): a hole drilled from the bottom that stops short of the other side starts on the bottom of the part, but the part is not flat and level over this spot, so {hole1} is shown without it -- move the hole under a flat bottom, or let it go all the way through.`
- In the base translator (not shown in the page): `{hole1} (hole): a hole drilled from the bottom is not mapped`.

## Next

1. Step 2: a counterbore or countersink from the bottom: the recess at the low end (`solid.hole` with an explicit direction, checked
   first on the pin), each recess guard mirrored (G-TOP for a recess, G-RECESS, G-NEST, `holeProfile`, G-CSOPEN), and the OCCT
   referee's recess mirrored (`occt-build.ts`, the only part of the referee that assumes the high end).
2. A sweep with both switches on, as for copies; then the owner's decision for the page, the docs line, and shCode's writer
   (`lib/solidcraft-ui-to-code.ts` writes `from: 'bottom'` instead of refusing a hole drilled up from the low face).
