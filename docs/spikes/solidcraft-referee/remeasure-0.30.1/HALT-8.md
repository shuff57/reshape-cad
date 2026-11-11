# HALT-8: a hollow opened on the face a countersink is on still builds wrong through the Node host route

2026-11-10, branch `t3/halt-7-hollow-recess-fix`, after the HALT-7 fix (`adcb8c37`), pin SolidCraft v0.30.1 (`8e2b0cd6`). Found by the seeded
hollow-after-recess family the HALT-7 brief asked for. No fix is made here: the owner chose the radius fix only, and this needs a new decision.

Status: **GUARDED 2026-11-10** by owner decision (option 1 below): `G-CSOPEN` in `packages/layer/src/shell-draft.ts` refuses every hollow that opens the
face a countersink's mouth is on, with the sentence the owner approved:

> shell1 (hollow): not supported yet because hole1 has a countersink on the face being opened, so shell1 is shown without it -- open a different face, or drill after hollowing.

Checked (`halt-8-fix/`): all 8 wrong builds and the round-number repros are refused; of the 249 seeded scripts the 89 that open a countersink's
face are refused by it (38 of them built right before: the accepted cost), 4 more stop earlier at the hole, and the other 156 are unchanged; a
counterbore, and a countersink with another face opened, still reach the kernel. In the real page the corner repro and the clean plate show the
new sentence in 3.4 s; a counterbore builds; a countersink with the bottom opened still gets the name-lookup sentence (below). Existing corpora
through the host route: 0 rows changed in all six (sd, holes, combined, mt, fccombined, rgcombined: 4784 rows, 713 hollow-with-hole).
The page's name-lookup refusal stays, by owner decision, with a true sentence for a hollow: upstream's `model.faces` describes planes and cylinders
only, so the bridge has nothing to verify a pick point against beside a cone. When the face was found but no pick point could be backed, and the
part has a countersink, the hollow now says:

> shell1 (hollow): not supported yet because the bottom face cannot be picked reliably on a part with a countersink, so shell1 is shown without it -- hollow before drilling the countersink.

Seen in the page (`halt-8-fix/browser-lookup-030.json`): open bottom and open front after a countersink show it; open top shows the G-CSOPEN
sentence; a plain hole and a counterbore still build. A draft after a countersink keeps the old "could not be found" wording (no sentence approved
for it). The Node route is unchanged: its stand-in reports pick hits, so it never reaches this.

Evidence for the finding: `halt-7-fix/` beside this file.

## What is wrong

A box, one countersunk hole, then `hollow(..., { open: 'top' })`, where the countersink's mouth is on the opened face. Every feature comes back
`built`, no guard fires, and the volume is wrong. Two classes:

| class | where the mouth sits | error | cases seen | hollow time |
|---|---|---|---|---|
| corner | 2 to 2.75 walls from TWO side walls | −1.1% to −3.3% | 5 seeded + 2 round-number | 21 to 32 s |
| side | 2 to 2.25 walls from ONE side wall | +1.8e-4 to +2.7e-4 | 3 seeded | 7 to 8 s |

Not affected in the same sweeps: the same countersink opened at the bottom, a counterbore at the same corner, a countersink at 2.5 walls from one
side, a countersink at 2.78 walls from two sides (one case), and one at 3.5 walls from two sides. All of those match the closed form to 1e-5 or better.

This is not fuzz family 3 (straight length in (t, 2t)): in these cases the straight length is 3.3 to 10 walls. Family 3 itself did not build wrong
here: of 41 seeded family-3 scripts, 28 built and all 28 match the closed form within 2e-5; 13 were refused by the kernel at all ten open-face
points (about 6 s in total).

The same wrong volumes come out on 0.21.0 corrected (`h8-021c.jsonl`, `h8-round-021c.jsonl`), so this is not from the repin.

## Repro (round numbers)

```js
const b = box(30, 30, 12);
hole(b, { across: 3, at: [6, 6], countersink: { across: 8, angle: 90 } });
hollow(b, { wall: 2, open: 'top' });
```

Built 4385.557 mm³. Closed form 4454.635, voxel oracle 4454.664 (−1.55%), Euclid cross-check 4459.94 (−1.67%). Hollow run 25.4 s.

```js
const b = box(20, 20, 6);
hole(b, { across: 3, at: [5, 5], countersink: { across: 6, angle: 90 } });
hollow(b, { wall: 1, open: 'top' });
```

Built 845.971 mm³. Closed form 857.408 (−1.33%). Hollow run 25.4 s.

Controls on the first box that build right (`h8-round-030.jsonl`): hole at `[6, 0]` (one side), a counterbore `{ across: 8, deep: 2 }` at `[6, 6]`,
the same countersink with `open: 'bottom'`, and the countersink at `[4, 4]`.

Seeded cases: `sf7-070`, `sf7-074`, `sf7-076`, `sf11-071`, `sf11-073` (corner); `sf7-072`, `sf11-069`, `sf11-070` (side). Scripts in `sf7.json`
and `sf11.json`, runs in `sf7-030.jsonl` and `sf11-030.jsonl`, summary by `sf-summary.py`.

## The oracles

- Closed form (`seed-family.mjs`, `closedForm`): exact cross-sections of the solid minus the cavity. It matches the kernel to 1e-5 or better on
  every case that is not listed above.
- Voxel plane-offset oracle at h = 0.05 (`oracle-com.mjs`). On seed 7 many planes are off its grid, which costs it up to 1.7e-3, so seed 11 snaps
  every plane to the grid. On the corner cases both oracles agree to 1e-3 of each other and disagree with the kernel by 1e-2 or more.
- Euclid cross-check on the round-number cases agrees with the other two on the corner class.

The side class (2e-4) is confirmed by the closed form and, on the two seed-11 cases, by the voxel oracle to 4e-6 of the closed form. It is small,
but it is 20 times the 1e-5 the controls reach.

## Why no guard fires

After the HALT-7 fix `G-HOLE` uses the mouth radius: it refuses when mouth radius + wall reaches the side wall's offset plane, that is a gap under
2 walls. Two things are not covered:

1. Side class: the offset of a countersink's cone is wider than the mouth by `wall / cos(angle / 2)`, not by `wall`. At the open face the
   offset reaches `mouth radius + wall / cos(angle / 2)`. That is 1.33 walls at 82°, 1.41 at 90°, 2 at 120°. The three side cases are exactly the ones
   whose gap is under `1 + 1 / cos(angle / 2)` walls. One case 0.06 walls inside that limit still built right.
2. Corner class: the wrong builds go on past that limit (82° at 2.5 walls, 90° at 2.51 walls, where nothing touches). No clearance rule explains
   them. The kernel takes 21 to 32 s on each, against about 2 s for a right build. One 120° case at 3.0 walls from both sides ran out the 45 s budget.

## What a student sees in the real page today

Different from the Node host route. In the real browser page (`browser-030.json`, normal budget) every hollow after a countersink that was
tried is refused in 2.6 to 4.4 s, before the kernel runs the hollow, with:

> shell1 (hollow): the top face of hole1 could not be found on the part as it is now, so shell1 is shown without it -- open a different face, or hollow before drafting.

That was 5 of 5: the three seeded corner repros, the clean 40×30×10 countersink plate that the Node route builds right, and one bottom-opened
case (with "bottom" in the sentence). A hollow after a counterbore builds in the page. So, as far as these five runs show:

- the HALT-8 wrong builds are not reachable in the page today, but only because of that name-lookup refusal, which is not a guard for this;
- the page refuses a clean countersink-then-hollow that should build, with a sentence that does not describe the cause;
- the Node host route and the page disagree on countersink-then-hollow. The sweeps score the Node route.

### Why the page's lookup fails (investigated 2026-11-10, owner request)

The cause is on our side of the seam, in `packages/solidcraft-host/src/upstream-bridge.mjs`, and it is deliberate caution, not an upstream defect.

- The page has no primitive-frame resolver, so a face word ("top") is resolved from the engine's topology (`resolveNamesFor`). A face whose centroid
  is in a hole needs a pick point, and the bridge passes one on only when `verifiedInnerPoint()` can back it.
- `verifiedInnerPoint()` checks that no OTHER face's surface comes near the point. `surfaceDistance()` knows planes and cylinders only. For a cone
  it returns null, and one null makes the answer null for every face of the body.
- So after a countersink (one cone face) no face of the part has a pick point. Measured in the page on a 40×30×10 plate: after a countersink all
  six flat faces come back with no pick point; after a counterbore all of them have one. `open: 'front'` is refused the same way as `open: 'top'`.
- The sentence then names the face as not found. The true reason is "the page cannot check a pick point on a part that has a cone face".
- The Node host route uses a stand-in (`test/topology-upstream.mjs` on the rig's topology build) that reports pick hits directly, so it does not
  have this limit. For parts with a cone face the Node sweeps therefore reach further than the page does. That errs on the safe side: the page refuses more.

Expected to follow from the same code, not measured: any feature that picks a face on a part with a cone, sphere or torus face is refused in the
page the same way. Not checked: whether upstream's `model.faces` describes a cone well enough for `surfaceDistance()` to handle it.

## Options (none made)

1. Refuse a hollow that opens the face a countersink's mouth is on. Simple and safe; it refuses the clean plate too. In the page that is already
   what happens. Needs a sentence: the existing G-HOLE sentence talks about a hole too close to a wall, which is not the reason here.
2. Narrow rule. For a countersink on the opened face use `mouth radius + wall / cos(angle / 2)` in `G-HOLE` (covers the side class with the existing
   sentence), and refuse when the mouth is within some number of walls of two side walls (the corner class). The number is not known: wrong at
   2.75, right at 2.78 in one case, out of time at 3.0. It needs a boundary sweep first, and the corner class has no geometric reason, so a
   margin is a guess.
3. Leave the guards and rely on the page's name-lookup refusal. Not recommended: nothing pins it, and it would stop holding the day that lookup is fixed.

Whichever is chosen, the page's refusal of a clean countersink-then-hollow is a separate question: fix the lookup, or keep it and give it a true sentence.
