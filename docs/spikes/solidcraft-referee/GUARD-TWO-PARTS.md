# A hole in a script with more than one part: G-BODIES narrowed, G-OTHERS added

2026-11-12, `main` after `e5c2a6bc`, pin SolidCraft v0.30.1 (`8e2b0cd6`). Found by the sweep of the page's second pass (`pilot-2026-11/PILOT.md`,
"The page's second pass, swept"): adding an unrelated part to a script made every hole in it refused. Owner decision: allow it, with a check.

## What was wrong

The holes guard G-BODIES refused a hole whenever the engine held more than one body:

> hole1 (hole): the part it drills is 2 separate pieces and a hole cannot tell which one to drill, so hole1 is shown without it -- drill each piece before copying it, or join the pieces first.

It was written for copies of one part (a hole after `repeat()`: the cut went into one copy and the layer reported another; `contract/holes.json`,
G-BODIES). But its test counted every body in the script, so a box and a lid, or a plate and a peg, was enough: neither could be drilled, and the
sentence was not true (the part is one piece). The only way through was to drill before the second part was made.

Measured before the change (`guard-two-parts/first-cases.json`, `first-before.jsonl`): 10 of 10 scripts in which a second part existed when the
hole was made were refused (the other part far away or beside, made before or after the drilled one, a box, a pulled sketch or a cylinder); the
one script that drilled first and made the second part afterwards was built. With the guard switched off, 12 of 12 holes were drilled in the
right part and matched the closed form to 3e-6 (`first-guard-off.jsonl`).

## The rule now

`packages/layer/src/holes.ts`, mirrored in `contract/holes4-translate.mjs`:

1. **Before the cut (G-BODIES, narrowed).** The part being drilled must be one piece, as before. Other bodies no longer stop the hole when each of
   them is a **different part** (`otherPartsOnly`): some accepted step lists the body, and none of the steps that list it shares a starting shape (a
   primitive, a sketch) with the part being drilled (`rootsOf`). A copy, a pattern or a mirror of the drilled part shares its starting shape; a body no
   step lists (a piece the engine split off, a copy it named itself) has no known maker. Both stay refused with the sentence above, as before.
2. **After the cut (G-OTHERS, new).** Every body the engine held before the hole, other than the drilled part's, must come back as it was: still
   there, the same volume to 1e-9, the same shell and face counts (`othersChanged`). If not, the hole is refused:

   > hole1 (hole): cutting it would also cut box2, which is in the way of this hole, so hole1 is shown without it -- drill this hole before you make box2.

   The name is the step that made the other body. The sentence is the owner's (2026-11-12).

## The check is not a formality: a kernel fault it covers

A plain bore is cut with a cylinder aimed at named bodies, and never touched another part in any run. A **counterbore or countersink** is cut
with SolidCraft's own `solid.hole`, given the body's name. It still cuts a second part that sits on top of the drilled part, under it (touching
or with a gap), or stands in the hole, **when that part was made after the drilled one**:

| script (the box is 40 x 40 x 20, the hole 6 across with a counterbore 12 across, 4 deep) | drilled box | other part | with the check |
|---|---|---|---|
| lid 40 x 40 x 4 on top, made after the box | 31095.348 (right) | 6332.153, 8 faces (was 6400, 6 faces) | refused, G-OTHERS |
| the same with a countersink 12 across, 90 degrees | 31321.508 | 6325.136 (was 6400) | refused, G-OTHERS |
| block 60 x 60 x 4 underneath | 31095.348 | 14286.921 (was 14400: the bore went on through it) | refused, G-OTHERS |
| the lid made **before** the box | 31095.348 | 6400.000 | built |
| the lid 5 above the box (a gap) | 31095.348 | 6400.000 | built |
| a part beside the box, sharing a side face | 31095.348 | 32000.000 | built |

(`guard-two-parts/lid-cases.json`, `lid-check-on.jsonl`, `lid-check-off.jsonl`.) So before this change the blanket refusal was all that stood
between a student and a lid with a hole nobody asked for. This is upstream behaviour and is not patched; the check is on our side of the seam.

## Measured

**Seeded family**, 270 scripts (`guard-two-parts/gen.mjs`, seed 81), Node host route, real kernel. A box with a hole (plain through, plain blind,
counterbore, countersink, plain along x; hole centre and sizes random) and a second part placed far away, beside (touching, with a gap), on top
(touching, gap), underneath (touching, gap), overlapping the box, or standing in the hole's path; made before or after the box; in about a third
of the cases also drilled itself. Two references per case: the closed form of each body, and the same hole on the box alone.

| | count |
|---|---|
| built | 246 |
| of those, the drilled box within 3e-4 of the closed form (worst 2.7e-5: the facets of the bore) | 246 |
| of those, the other part its own volume (exactly, 1e-9, where it is a box that is not drilled; within 3e-4 where it is the peg or is drilled itself) | 246 |
| of those, the drilled box identical (1e-9) to the same hole on the box alone | 246 |
| refused by G-OTHERS | 24 |
| of those, the other part really cut when the check is switched off (`tp81-off.jsonl`) | 24 |
| refused for any other reason, or built differently from the box alone | 0 |

All 24 refusals are counterbores and countersinks with the other part made after the box: on top touching (6), underneath touching (6),
underneath with a gap (6), standing in the hole (6). The other part lost 0.33 to 1.53% (on top), 0.42 to 3.14% (underneath) and 80 to 85% (the
peg). The same placements with the other part made first: 54 of 54 built right. Plain holes: 162 of 162 built right.

**Patterns and joins** (`guard-two-parts/pattern-cases.json`, `pattern.jsonl`): a hole in a pattern of three separate copies is refused as before
("3 separate pieces"), with or without another part; a hole in another part beside such a pattern is built and the pattern is untouched; a hole in
a pattern whose copies touch (one piece), and in a join of two boxes, beside a third part, is built right.

**Existing corpora**, host route, 4784 rows (24717 steps), against the sweep before the change: 38 rows changed. In 35 a hole had been stopped by
the body count: 5 of them are built now (`combined seed 382` is the row's measured step and is RIGHT by the oracles; in `rg combined seed 92`,
`243`, `245` and `249` the hole is in the middle of the script, and every step of those rows equals the same row with the other part left out), and
30 are refused for the hole's own reason (not flat under the hole 18, a curved part 5, a recess that does not fit 4, a countersink past the edge
1, the engine 1, and 1 by G-OTHERS). 1 row is the `from:` fix of the same day (`sd draft-from-bottom-extrude-lifted`, RIGHT by the oracles) and 2
are the "that face" sentence. No step that was built before is built differently. The 10 rows the oracles flag are the same 10 as before
(`combined seed 50` and the others of GUARD-DRAFT-PULL.md and GUARD-UNIFIED-JOIN-FULL.md).

**Every corpus row with an unrelated part injected** (the three-way sweep, `pilot-2026-11/PILOT.md`, "The page's second pass, swept"): before
this change 861 of 4784 rows changed when an unrelated block of steps was added, 228 of them a hole that was built without the block and refused
with it. After the change, with other blocks at other places: 323 rows change, every one a step refused in both with other words; no step is
built in one and not in the other, and no built volume differs.

**In the real page** (`pilot-2026-11/followup/two-parts-and-from-page.json`): a plain hole under a lid, a counterbore with another part far away,
a counterbore with the lid made first, and with the lid made after the hole, a hole in each of two parts: all built, within 4e-6 of the closed
form. A counterbore with the lid made after the box: "hole1 (hole): cutting it would also cut box2, which is in the way of this hole ...". A hole in
a pattern of three separate copies: "the part it drills is 3 separate pieces ...", as before.

Checked: `npm test` 1045 tests, 1039 pass, 6 skipped, 0 fail; the six browser checks give the same results as the last recorded run (examples 46 of 56).

Tests: `packages/layer/test/two-parts.test.mjs` (6: the three helpers and the sentence in the layer and the contract copy; two-part docs on the
fake engine; a fake that damages the other part is refused by G-OTHERS, and built with the check off). The holes differential test (17) passes
with both sides changed.

## Limits

- A counterbore or countersink next to a part made later stays refused. The sentence's advice (drill before you make the other part) is measured.
- "Different part" is decided from the script: two parts that share a sketch or a primitive count as related and stay refused, even when they are
  separate solids (two pulls of one sketch).
- G-OTHERS compares volume, shell count and face count. A cut that changed another part without changing any of the three has not been seen and
  is hard to imagine, but it is not excluded by proof.
- Hollows, drafts, rounds, pockets and joins in a script with several parts were not changed and not measured here beyond the corpora.
- The number in "the part it drills is N separate pieces" still counts every body in the script, so with another part present it can say 3 where
  the drilled part is in 2 pieces. Not changed.
