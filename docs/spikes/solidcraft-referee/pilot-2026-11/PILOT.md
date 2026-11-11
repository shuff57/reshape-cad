# Student pilot, 2026-11-11

Plan phase 3 exit ("a walkthrough of 3 to 5 real student tasks") and phase 5 of the next-work loop. Pin SolidCraft v0.30.1 (`8e2b0cd6`), main at
`4df59be7` plus the two small page fixes below. Run in the real host page (`packages/solidcraft-host`, site folder
`~/.cache/solidcraft-0.30.1-rig/student-preview`), headless Chrome, normal time limit.

Who played the student: the agent, not a real student. Each task starts with what a student would plausibly type first. Where the page refused
something, the next script does what the sentence says. So this tests whether the page builds right and whether its sentences lead somewhere, not
whether a student finds the language easy.

Files: `tasks.mjs` (the 19 scripts and their closed forms), `run.mjs` (the runner), `pilot.json` (everything the page showed), four screenshots.
The run was done twice with identical outcomes and volumes.

## Result in one table

Volumes are checked against a closed form worked out by hand for each part (in `tasks.mjs`).

| task | first try | after following the sentences | final volume against the closed form |
|---|---|---|---|
| 1. L bracket: polygon sketch, extrude, two screw holes, a rounded edge | hole 2 refused, and the round after it | built | 1.8e-6 |
| 2. Parts tray with a countersunk screw hole | hollow refused | one piece of advice dead-ends, the other builds | 4.0e-6 (bottom opened), 4.2e-6 (plain hole) |
| 3. Flanged bushing: revolve, four bolt holes | all four holes refused | built from two cylinders instead | 1.3e-5 |
| 4. Dimensioned plate: constrained sketch, extrude, drilled hole, bevel | script error, nothing built | built | 6.8e-6 |
| 5. Moulded cup: draft the sides, hollow | built | (nothing to follow) | 9e-16 (two sides), 6e-15 (four sides) |
| 6. Common mistakes: round too big, hole too wide, wall too thick | three refusals | one more refusal, then built | 1.7e-6 |

- **Wrong solids: 0.** Every part that built matches its closed form: flat-faced parts to 1e-5 or better, the two with a curved outer wall (the revolve at
  9.3e-5, the cylinders at 1.3e-5) inside the layer's 3e-4 bar for curved volume.
- **Every task ended in the part the student wanted** except the bolt holes on the spun bushing, which need a different way of building it.
- **Speed:** the longest run took 8.1 s. Nothing came near the 45 s limit.
- 5 of 6 tasks needed a second or third try. In each the page said why in one sentence, and the rest of the part stayed on screen.

## Task by task

### 1. L bracket

```js
const sk = sketch('top')
sk.polygon([[0, 0], [60, 0], [60, 10], [10, 10], [10, 40], [0, 40]])
const part = extrude(sk, 30)
hole(part, { across: 5, along: 'y', at: [10, 0] })
hole(part, { across: 5, along: 'x', at: [5, 0] })
round(part.edge('top', 'right'), 2)
```

Page: extrude and hole 1 built. Then:

> hole2 (hole): it crosses hole1, a hole drilled in another direction, and crossing holes are not supported yet, so hole2 is shown without it -- drill the holes so they do not meet, or drill along one direction only.

> round1 builds on hole2, which is shown without its round, so round1 is shown without it too -- fix hole2 first.

Following "drill along one direction only" (both holes along y): everything built, 26598.765 against 26598.717.

Findings:
- **F1. The holes do not cross in the part.** Hole 1 goes through the horizontal leg, hole 2 through the upright leg. Their centre lines meet only in the
  empty corner of the L, outside the material. The guard looks at the drills, not at where there is material. Safe, but the sentence tells the student
  something that is not true of their part, and one screw hole in each leg of a bracket is the first thing a student will want.
- **F2. Wording slip.** "hole2, which is shown without its round": the thing hole2 is shown without is itself, not a round.

### 2. Parts tray with a countersunk screw hole

```js
const b = box(80, 50, 30)
hole(b, { across: 4, countersink: { across: 8, angle: 90 } })
hollow(b, { wall: 2, open: 'top' })
```

Page (the HALT-8 guard):

> shell1 (hollow): not supported yet because hole1 has a countersink on the face being opened, so shell1 is shown without it -- open a different face, or drill after hollowing.

The sentence gives two ways out:
- "drill after hollowing" (hollow first, then the same hole): the hollow builds, then the hole is refused:
  > hole1 (hole): a countersink is cut from the top of the part, but the part is not flat and level under this spot, so hole1 is shown without it -- move the hole onto a flat top.
- "open a different face" (`open: 'bottom'`): builds, 23118.059 against 23118.152.

A plain hole drilled first, then the hollow opened at the top: builds, 23142.346 against 23142.442.

Findings:
- **F3. "or drill after hollowing" is a dead end, every time.** The countersink's mouth is on the face being opened, so after the hollow there is no
  flat top left under it. The sentence is new (2026-11-10) and the advice was carried over from the hole-guard sentence, where it does work. It should
  offer something that works: a plain hole instead of the countersink. Needs the owner's wording.
- A student cannot get what they most likely want here, a countersunk screw hole in the floor of an open tray, by any order of these steps.

### 3. Flanged bushing

```js
const sk = sketch('front', 0)
sk.polygon([[5, 0], [20, 0], [20, 5], [10, 5], [10, 25], [5, 25]])
const part = revolve(sk, 360)
hole(part, { across: 3, at: [15, 0] })   // and three more round the flange
```

Page: the revolve built (10601.884 against 10602.875, 9.3e-5). Then:

> hole1 (hole): drilling a spun shape is not supported yet, so hole1 is shown without it -- leave a gap for the hole in the sketch that is spun instead.

> hole2 (hole): the part it drills (hole1) could not be built, so hole2 is shown without it -- fix hole1 first.

(and the same for holes 3 and 4). Built from solids instead (`cylinder(40, 5)`, `cylinder(20, 25)`, `union`, a bore and four bolt holes): all eight features
built, 10461.367 against 10461.504.

Findings:
- **F4. The advice only works for a hole on the axis.** "Leave a gap in the sketch that is spun" gives a bore or a groove all the way round. It cannot give
  a bolt hole off the axis. The student has to think of building from cylinders on their own.
- **F5. One refusal becomes four.** Holes 2 to 4 are refused because hole 1 was, each with "the part it drills (hole1) could not be built". The part
  (the bushing) was built; it is the hole that was not. The same chain shows in task 6. It is honest, but a student reads four errors for one cause, and
  "the part it drills (hole1)" calls a hole a part.
- A slip of the agent's own, worth knowing about: `cylinder(20, 5)` is 20 **across**, not radius 20. The bushing built at a quarter of the size with no
  complaint (correctly: that is what was typed). The page's own example said "12 mm radius" for `cylinder(12, 30)`; that comment is fixed below.

### 4. Dimensioned plate

A hand-drawn rectangle and circle, dimensioned (`sk.length`, `sk.diameter`, `sk.dx`, `sk.dy`), extruded 6, then `hole(part, { across: 4, at: [-15, 0] })` and a bevel.

Page: nothing built, and this in place of the feature table:

> SCRIPT ERROR (line 12): hole() cannot find how thick this extrude is along z yet, so it cannot drill all the way through. Give it a depth: hole(shape, { across: 4, deep: 20 }).

With `deep: 6` (the plate's thickness): sketch, extrude, hole and bevel all built, 8438.421 against 8438.363. With the error's own example value `deep: 20`
(deeper than the plate): built the same through hole, right.

Findings:
- **F6. The error is clear and its fix works**, including when the student copies the example number.
- **F7. But a through hole on an extruded, dimensioned sketch is the most ordinary thing in the course**, and it works without `deep:` on an extruded
  polygon (task 1). The difference (the sketch has dimensions, so its size is not known until it is solved) is invisible to a student. The thickness
  along the pull is the number they typed in `extrude(sk, 6)`.
- A script error throws away the whole run: unlike a refusal, nothing is shown, not even the plate.

### 5. Moulded cup

```js
const b = box(60, 40, 25)
draft(b.face('right'), 5, { from: 'bottom' })   // and left, front, back
hollow(b, { wall: 2, open: 'top' })
```

Built first time with two sides sloped and with all four, both to machine precision against the closed form. No findings.

### 6. Common mistakes

```js
const b = box(40, 30, 10)
round(b.edge('top', 'right'), 12)
hole(b, { across: 35 })
hollow(b, { wall: 6, open: 'top' })
```

Page:

> The round round1 is as big as or bigger than the face it cuts into (10 wide), so round1 is shown without it -- use a size under 10.

> hole1 (hole): the part it drills (round1) could not be built, so hole1 is shown without it -- fix round1 first.

> shell1 (hollow): it needs hole1, which could not be built, so shell1 is shown without it.

With sensible numbers (round 2, hole 6, wall 2):

> shell1 (hollow): the open edge of hole1 is rounded with a radius of 2, which is as large as the wall (2), so the rim would have no thickness and shell1 is shown without it -- make the round smaller than the wall.

With the round at 1: all built, 4851.129 against 4851.137.

Findings:
- **F8. Only the first mistake is reported.** The hole wider than the part and the wall thicker than the part are never checked, because each is refused
  for depending on the step before. The student fixes one, runs again, and meets the next. (F5 again.)
- **F9. Parts are named by their last step.** "the open edge of hole1", "the top face of hole1", "the part it drills (round1)". The student called it `b`,
  and it is a box. The sentences use the id of the last feature that changed the part.
- The rim sentence is right and its advice works first time.

## The page itself

- **F10. "total volume: undefined mm3"** in the result panel on every run. Fixed here: the total is now the sum of the bodies' volumes.
- **F11. Built features with a named edge show checker output to the student**, in the detail column: "name box1.edge[box1.face[+z] ^ box1.face[+x]] →
  solidcraft edge(s) F1:+x|F1:+z; candidates on the name's own shape: 1 ... cross-checks on the name's OWN shape only: geometry vs persistent names agrees"
  (screenshot `t6b-fixed.png`). Useful to us, noise to a student.
- The page header still says "SPIKE", and the panel titles are written for us ("FEATURES: WHAT SOLIDCRAFT BUILT OR REFUSED", "evaluated only in a sandboxed iframe").
- The 3D view is blank in these screenshots. Headless Chrome with software rendering did not draw SolidCraft's view, so the picture a student sees
  was not judged here. A person needs to look at it in a real browser.

## Fixed in this commit

- F10: the total volume line (`packages/solidcraft-host/pane/pane.js`).
- The example comment that called `cylinder(12, 30)` "12 mm radius" (`packages/solidcraft-host/pane/examples.json`).

## Needs the owner

Ordered by how much a student would feel it.

1. **F7:** let `hole()` drill through an extruded dimensioned sketch without `deep:`. A language change in `packages/script`, not a sentence.
2. **F3:** new advice for the countersink-on-the-opened-face sentence. Exact text needed.
3. **F1:** crossing-holes guard refuses holes whose centre lines meet outside the material. Either a narrower guard (needs its own sweep) or a sentence that
   says what is actually checked.
4. **F5, F8:** one refusal blocking every later step on the same part, and the wording "the part it drills (hole1)". A design question: later steps
   could be checked against the part as it stands.
5. **F9:** name the part by the student's shape, not by its last step. Touches most sentences.
6. **F4, F2:** two sentence fixes. Exact text needed.
7. **F11** and the page's titles: what a student should and should not see in the panel.
8. A person looking at the 3D view in a real browser for these six tasks.

## Follow-up, 2026-11-11 (owner chose: F7, F1, F5/F8 and the sentence slips; F3 wording approved)

Evidence in `followup/`.

### F3, done: the countersink sentence

It now ends "-- open a different face, or use a plain hole without the countersink." (owner's choice). Both ways out build right in the pilot.

### F7, done: a through hole on an extruded dimensioned sketch

`packages/script/src/model-types.ts` (`extrudeRange`): along its pull an extrude is as long as the pull, whatever is drawn, so that extent no longer
needs the sketch's outline. Across the pull a dimensioned sketch's size is still unknown before the solver runs, and `hole()` there still asks for
`deep:` with the same error. Tests in `packages/script/test/extent-extrude.test.mjs`. In the page (`plate-pilot.json`):

| script | result against the closed form |
|---|---|
| the pilot's plate, as first typed (through hole, bevel) | built, 6.8e-6 |
| blind hole 3 deep (it now starts at the top face; before, its place along the pull was unknown) | built, 7.0e-7 |
| counterbored through hole | built, 2.2e-6 |
| two through holes | built, 3.8e-6 |
| sketch on the front plane, pulled 8, drilled along the pull | built, 1.4e-6 |

### F1, measured, then narrowed (below): the crossing-holes guard

`G-CROSS` (`packages/layer/src/holes.ts`) refuses a hole whose drill meets an earlier drill in another direction. It compares the drills (finite
cylinders as long as the part's bounding box), not the holes in the material. Seeded family `cx61`: 72 extruded L, U and T brackets with one hole
through the base along y and one through an upright along x, Node host route on 0.30.1, guard on and then off for the measurement.

| | scripts | guard on | guard off |
|---|---|---|---|
| the drills meet only in empty space (the holes do not meet in the part) | 45 | all refused by G-CROSS | all built, within 4.8e-6 of the closed form, 1.5 s at most |
| the same with a counterbore on the first hole | 15 | refused by G-TOP | refused by G-TOP |
| the holes truly cross inside one block of material | 12 | all refused by G-CROSS | all built, within 4.7e-6 of the closed form (the overlap of the two bores added back), 6 to 21 s |

So the 45 are over-refusals: the part is right and fast when the guard is out of the way. The 12 true crossings also built right here, more slowly;
the guard's own note records 98 s and over 200 s for a crossing in a box on an earlier measurement, so 12 cases on 0.30.1 are not grounds to drop it.

Options:
1. Narrow the guard for an extruded outline: allow the hole when the place where the two drills meet lies wholly outside the outline. The layer
   has the outline. A box is its own outline, so nothing changes there. Needs the seeded family as a test and a re-run of the holes replays.
2. Keep the guard and change only the sentence so it says what is checked (the drills' paths, not the holes).
3. Re-measure true crossings on 0.30.1 widely (boxes, blind holes, three holes) to see whether the guard is still needed at all. The largest job.

### F5, F8, looked at, not changed: one refusal blocks later steps

When a step is refused the part's "latest step" still moves on to it, and each feature group then refuses anything that builds on a refused step.
It is not one rule: holes (`holes.ts`), hollow and draft (`shell-draft.ts`, twice), extrude and pocket, revolve and groove, patterns and mirror,
and the shared translator each have their own check and their own sentence, and about 20 test files pin the behaviour.

Options:
1. Leave the behaviour and fix the wording only (below).
2. Let later steps build on the part as it stands, skipping the refused step. The part on screen is then exactly what the remaining steps describe,
   and each later mistake gets its own sentence in the same run. The risk is in the guards that read the script's history instead of the part
   (the hollow's hole check walks the list of holes, for one): each must either ignore a refused step or be shown to err on the safe side when
   it counts one. Every group's differential test and the long live replays would need re-running. Large.
3. A middle way: keep the block, but check each blocked step's own numbers (size against the part, wall against the part) and report those too.
   Smaller than 2, and it removes "fix one, run again, meet the next".

### F1, done (owner chose option 1): G-CROSS narrowed for an extruded outline

`crossInAir()` in `packages/layer/src/holes.ts`, mirrored in the contract copy `holes4-translate.mjs`. When the part is a plain polygon pulled straight
along z and both drills run across the pull, the place where the drills can meet is a rectangle in the outline's plane. If that rectangle, grown by
0.01 mm, has no point in common with the outline, the hole is let through. A box, a circle, a rounded or dimensioned outline, a tilted or tapered pull,
a moved part, or an outline that does not match the measured part keep the refusal. Unit tests: `packages/layer/test/cross-in-air.test.mjs`.

With the guard ON, two seeded families (`cx61-narrow.jsonl`, `cx62-narrow.jsonl`, 144 scripts):

| | scripts | result |
|---|---|---|
| the drills meet only in empty space | 90 | all built, within 5.9e-6 of the closed form, 2.4 s at most |
| the same with a counterbore | 30 | refused by G-TOP, as before |
| the holes truly cross inside the material | 24 | all refused by G-CROSS, as before |

In the page the pilot's bracket (task 1, as first typed) now builds first time: 26598.765 against 26598.717.

Side effects, checked on 0.30.1: 0 of 4784 host-route rows changed across the six corpora; the holes live replay is 353 of 353 identical; `npm test` 1014 tests,
1008 pass, 6 skipped, 0 fail.

### Sentence slips, done (owner approved the exact text)

- F2: "round1 builds on hole2, which could not be built, so round1 is shown without it too -- fix hole2 first."
- F5: "hole2 (hole): it comes after hole1, which could not be built, so hole2 is shown without it -- fix hole1 first."
- F4: "hole1 (hole): drilling a spun shape is not supported yet, so hole1 is shown without it -- for a hole down the middle, leave a gap in the sketch
  that is spun; for other holes, build the part from cylinders instead."

### F5, F8 (owner chose "also check blocked steps"): not built, because it would catch almost nothing

Checking a blocked step's own numbers without the kernel was looked at step by step. The checks that are pure arithmetic are few: a hole under the
smallest size, a countersink angle too flat, a recess too small, a hole wholly off the part, and a hollow's wall against a plain box. The mistakes a
student makes are decided by building: a hole wider than the part, a round bigger than its face, a wall too thick for a shape that is not a box.
In the pilot's own example (task 6) the number check finds nothing: the wall of 6 fits that box, and the hole of 35 is only found by cutting it.

What would work: test-build each blocked step on the part as it stands, without showing it, and report its own refusal if it has one. The step stays
blocked, so what is on screen does not change. It costs kernel time for every blocked step and a change to each feature group's step function and its
contract copy. Owner's call.
