# HALT-9: a draft built about the wrong plane after a draft the page left out (fixed)

2026-11-12, `main` after `6a08dc7a`, pin SolidCraft v0.30.1 (`8e2b0cd6`). Found while reading `host-entry.mjs` for the blocked-steps work, not by a
sweep. Status: **FIXED 2026-11-12** on our side of the seam; no sentence was added or changed. The kernel did nothing wrong here: it built
exactly the input it was given.

## What was wrong

`draft(face, angle, { from: 'bottom' })` takes its neutral plane from the bottom of the shape as it was drawn. If the part has moved since,
that plane is no longer the part's bottom, and the guard G-FROM refuses the draft ("from:'bottom' would put the neutral plane at -5, but the
bottom of this part is at 0 now ..."). G-FROM knows which word each draft was written with from a list the page hands to the layer, one entry
per draft, **paired by position**.

The page (and the Node host route, which is the same code) translates a script a second time when one of its own guards fires, with the
refused steps left out: a round, hollow or draft on a part a pocket already cut whose result was not kept (G-STALE), or a step that reads the
part of a sketch the sketch guard refused. When a **draft** was among the steps left out, the list was not cut down with it. Every later draft
was then paired with the entry of the draft before it:

- a later draft written with `from:` took an entry with no word, G-FROM had nothing to check, and the draft was **built** about the stale plane;
- a later draft written with a number took the left-out draft's word, and was **refused** by G-FROM with a sentence about a `from:` it never had.

## Smallest case (the real kernel, Node host route)

```js
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] }); const p = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
pocket(sk2, p, 4); draft(p.face('right'), 5);          // stale: p was cut and the result not kept (refused, G-STALE)
const c = box(30, 20, 10); move(c, [100, 0, 5]);        // the box now sits on z = 0..10
draft(c.face('right'), 5, { from: 'bottom' });          // the bottom as drawn was z = -5
```

| script | the last draft, before | after |
|---|---|---|
| the last two lines alone | refused, G-FROM | refused, G-FROM |
| the whole script | **built**: the box is 5825.0227 mm3 | refused, G-FROM |
| the same, `from: 'top'` | **built**: the box is 6000.0000 mm3 | refused, G-FROM |
| the stale step is a hollow, not a draft | refused, G-FROM | refused, G-FROM |
| the cut is kept (`const q = pocket(...)`), so the first draft builds | refused, G-FROM | refused, G-FROM |

What `from: 'bottom'` means for that box now is a tilt about z = 0: 30 x 20 x 10 - 20 tan(5 deg) x 50 = 5912.5113 mm3, and the kernel builds
exactly that when the neutral is given as the number 0. What was built is the tilt about z = -5: 6000 - 20 tan(5 deg) x 100 = 5825.0227. So the
part was 87.49 mm3 (1.5%) off what the script asked for, with no refusal and no warning. Two references agree on both numbers: the closed
form and the kernel's own build with the neutral written as a number (`halt-9-fix/cases.json`, `cases-before.jsonl`, `cases-after.jsonl`).

## How wide

A seeded family, 60 scripts (`halt-9-fix/gen.mjs`, seed 71), through the Node host route on 0.30.1. Each has a draft that is left out (15 + 15
after a stale cut, 15 + 15 on the pull of a sketch the sketch guard refuses), then a box of random size moved up or down by -12 to 15 mm, then a
draft of its right or front face at 3 to 10 degrees.

| the later draft | before the fix | after the fix |
|---|---|---|
| A, written with `from: 'bottom'` or `'top'` (30) | 30 built, 0 refused. Each equals the closed form of a tilt about the plane as drawn to 1e-9, and is off the tilt the word means now by up to 10.2% of the volume | 30 refused by G-FROM, 0 built |
| B, written with a number (30) | 19 built right; 11 refused by G-FROM about a word the draft does not have (all 11 are among the 16 where the first draft carries a `from:` word; in the other 5 of the 16 the layer refused that first draft itself, so nothing was left out) | 30 built, each equal to the closed form (worst 5.9e-15) |

So before the fix every from-word draft that followed a left-out draft was built unchecked. Both ways of leaving a draft out show it.

It needs three things in one script: a step the page's own guards refuse and leave out that is a draft, a later draft written with a `from:`
word, and that later draft's part moved, joined or turned since it was drawn (otherwise the plane is still right and the build is right). None
of the pilot scripts, the 56 examples or the existing corpora has all three, which is why no sweep found it. The path has existed since the
page's second translation was added (the SG-13 and G-STALE host guards).

## The fix

`translateWithout()` in `packages/solidcraft-host/pane/src/host-entry.mjs` now cuts the list down with the doc: the entry of every draft that is
left out is left out too, so each remaining draft keeps its own entry. Seven lines; the layer is not touched and neither is any sentence.

Test: `packages/solidcraft-host/test/host-guards.test.mjs`, "HALT-9: a draft left out of the second translation does not shift the from-word
record of the drafts after it" (both directions, and both ways a draft is left out). On the tree before the fix its first case builds the draft.

Checked on the committed tree, 0.30.1: the table above and the seeded family were re-run through the Node host route (`halt-9-fix/cases-after.jsonl`,
`fu71-after.jsonl`); in the real page (headless Chrome, `halt-9-fix/page-after.json`) the whole script and its `from: 'top'` twin show the last
draft refused by G-FROM, the draft alone is refused as before, and the draft with the neutral as a number builds 5912.5113 mm3; the pane check
passes; `npm test` 1028 tests, 1022 pass, 6 skipped, 0 fail.

## Not looked at

Whether anything else the page hands to the layer is paired by position. `fromUsage` is the only list of that kind in the layer's context today
(the other fields are functions or keyed by name), and the blocked-steps prototype that also leaves steps out cuts the list down the same way.
