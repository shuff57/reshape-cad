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

### F5, F8: prototype for holes (owner chose "prototype on holes first"), off by default

`probeBlockedHole()` in `packages/layer/src/holes.ts`, used only when `ctx.probeBlocked` is set (nothing sets it: the page and every test run as before).
A hole that is blocked by a refused step is planned on the last step of that part that was built, with the usual guards, then cut on the engine and
put through the usual after-the-build check. Nothing is kept and the hole stays refused. If that test build has its own refusal, that sentence is
shown in place of "it comes after ...". Existing sentences only.

Nine scripts, switch off and on (`blocked.json`, `blocked-off.jsonl`, `blocked-on.jsonl`), Node host route on 0.30.1:

| blocked hole | off | on |
|---|---|---|
| 35 across on a 30 wide box, after a refused round (the pilot's task 6) | "it comes after round1 ..." | "it would leave 2 separate pieces where there is 1 now ... make the hole narrower than the part ..." |
| bolt holes 2 and 3 on a spun bushing (task 3) | "it comes after hole1 ..." | the spun-shape sentence, on each |
| a hole placed off the part | "it comes after round1 ..." | "it does not touch the part ... (check at:) ..." |
| a hole that would touch an earlier one along a line | "it comes after round1 ..." | "its hole would touch another hole along a line ..." |
| a countersink at 175 degrees, two steps after a refused hole | "it comes after hole3 ..." | "a countersink angle wider than 170 degrees ..." |
| a good hole after a refused round, and one after a refused hole | "it comes after ..." | unchanged: it would build, so only the block is reported |

No feature changed between built and refused in any script.

Corpora with the switch on, against the same corpora with it off:

| corpus | rows | blocked holes | own refusal found | built / refused changes | time |
|---|---|---|---|---|---|
| holes | 357 | 1 | 0 | 0 | 250 s to 196 s (noise) |
| combined | 600 | 333 | 151 (G-TOP 90, G-CURVED 21, G-BODIES 11, G-RECESS 9, G-CSEDGE 7, G-TANGENT 6, G-NOOP 4, three others 1 each) | 0 | 302 s to 587 s |
| mt | 1930 | 4 | 0 | 0 | 294 s to 290 s (noise) |

So in the combined corpus 45% of blocked holes had a mistake of their own that the student is not told today. The cost is about 0.9 s of kernel time
per blocked hole; on a student script with one or two blocked holes that is 0.2 to 0.6 s.

Then finished for holes (owner chose "turn it on for holes in the page"): mirrored in the contract copy `holes4-translate.mjs`; a differential test
runs both sides with the switch on over the holes corpus (equal output, no status change, own refusals found and not found); the host page sets
`probeBlocked: true`. In the page the pilot's task 6 hole now says "it would leave 2 separate pieces ... make the hole narrower than the part" and each
bolt hole of task 3 gets the spun-shape sentence. Not done: hollows, drafts, rounds and bevels (a hollow after a blocked hole still says
"it needs hole1").

### F10, F11 and the panel, done (owner approved the layout)

The panel a student sees is now: Your script, Steps (step, kind, result, what happened; "built" or "not built"; round and hollow by their script names),
Sketch check, The part (pieces, volume, size, faces, steps built). Everything written for us is in one collapsed section, "For teachers and developers":
the check against reference numbers, the run in detail, how each named edge or face was found, what Run does and known limits, the commands and the
document. The "SPIKE" tag is gone and the status line reads "built with 1 step not built". Screenshot: `followup/panel-after.png`.

Also changed, beyond the approved mock-up: a sketch step reads "drawn; it is built by the step that uses it"; the interpreter's warnings show under
the script instead of in the reference check; the "no reference numbers" line under the editor is gone for a student's own script; a script error's
status line is no longer overwritten by "ready" when the page has just loaded.

Not changed: the sketch check for a dimensioned sketch still shows the solver's own table (dof, residuals, "phase 2 rule-check"). It needs wording.

Checked on 0.30.1: `npm test` 1015 tests, 1009 pass, 6 skipped, 0 fail; the six browser checks pass; the 56 examples give the same 46 passes with the
same verdicts and refusals as recorded.

### F9, done for hollows and drafts (owner chose "the starting shape's name")

`packages/layer/src/part-name.ts`: a sentence that means the whole part names the step that made it (box1, pull1, cyl1, op1 for a join), found by
walking back through the holes, rounds, hollows, drafts, moves and turns that only change it. Used by every hollow and draft sentence
(`shell-draft.ts`, mirrored in `shell-draft-translate.mjs`) and by the hollow check. A sentence that means one particular step ("it comes after
hole1", "it crosses hole1") is unchanged.

In the page: "the open edge of box1 is rounded ..." (was "of hole1"), "Hollowing box1 to 12 thick would collapse it ...", "box1 is already hollow ...",
"Hollowing box1 is not supported yet because the part has a blind hole ...". A part made by a join reads "Hollowing op1 ...".

Not changed: two groove sentences ("... was left in 2 separate pieces", "... is not a single body") still name the last step.

Checked on 0.30.1: `npm test` 1019 tests, 1013 pass, 6 skipped, 0 fail; 0 of 4784 host-route rows changed in built / refused / guard; the shell-draft
live replay is 1085 of 1089 identical with the same 4 known differences as before; the six browser checks pass; the 56 examples give the same 46 passes.

### Sketch check, done (owner approved the wording, 2026-11-12)

What was there: the Sketch check card showed the solver's raw table (state, solver status, dof, failing, redundant, max residual, profiles). On this pin
the table was also mostly blank: the page read the solver's fields from where the spike's patched bridge put them (`report`), and upstream's bridge
reports them on the sketch itself, so status and dof showed "-" for every sketch. A sketch whose rules clash showed "No dimensioned sketch in this
script." (nothing was built, so there was no row).

Now, one line per dimensioned sketch, in the script's order (`packages/solidcraft-host/pane/src/sketch-check.mjs`):

| result | what it means |
|---|---|
| fully defined | Its rules fix every size and position. |
| not fully defined | It can still slide, turn or change size in 3 ways. It was built as you drew it; add rules or dimensions to pin it down. |
| rules clash | A length of 40 cannot hold together with the rules before it; remove or change one of them. |
| rule repeated | A length of 30 is already fixed by the rules before it; remove it. |
| not built | It is not fully defined, and its rules have to move it. See sk1 under Steps. |
| not confirmed | It was built, but this check could not confirm whether it is fully defined. |
| not checked | The step that uses it was not built. See Steps. / No step uses it yet. |

Two counts, not one. "Fully defined" and the number of free ways are said only when SolidCraft's own count (dof of the built sketch) and the
host's independent solver (`soup-solve.mjs`: the rank of the rules at the solution, no kernel) give the same number, SolidCraft reports the sketch
solved, and the independent rule check finds every rule met (worst residual at most 1e-6 mm). Anything else reads "not confirmed". Measured in the
real page on 0.30.1: 25 of 25 built sketches agree (17 with nothing free, 8 with 1 to 4 ways free); "not confirmed" was never reached.

The rule in a clash or a repeat is the student's own: SolidCraft refuses one command, the translator's record says which rule of the sketch that
command came from, and the line names that rule by kind and value as written ("a length of 40", "an up distance (dy) of 7", "an angle of 100",
"a horizontal rule"). The kernel's ids (k1, g3) are never shown. 11 of 11 clashes and repeats in the run name the rule the script added last.
The line says the rule "cannot hold together with the rules before it": SolidCraft stops at the first rule it cannot add, so the page knows
which rule that was, not which of the two the student meant to keep.

The raw table moved to "For teachers and developers" ("The sketch solver in detail"), reads the right fields, and shows both counts side by side.

Two sentence changes with it (owner approved the exact text):

- "... but leave 1 ways for it to slide ..." is now "... but leave 1 way for it to slide ..." (`host-guards.mjs`, mirrored in the contract's
  `sketch-geometry.guard.mjs`). The plural is unchanged.
- A step that pulls or cuts a refused sketch showed the sketch's whole sentence a second time. It now reads
  "pull1: it uses sk1, which could not be built; fix sk1 first." The sketch's own line keeps the full sentence; the guard code on both is unchanged.

Evidence: `followup/sketch-check.json` (44 scripts: the page's 18 sketch examples and 26 probes; per script the lines shown, both counts, and the
refused command of a clash), `followup/sketch-check-run.mjs` with its two case files, `followup/sketch-check-two.png`, `followup/sketch-check-clash.png`.
Tests: `packages/solidcraft-host/test/sketch-check.test.mjs` (7), `host-guards.test.mjs` (the singular, the pointer sentence).

Not covered: a sketch drawn as an outline of points, or dimensioned through the handle words (`sk.across`, `sk.up`), is solved by reSHape's own solver
before the build and gets no line here ("No dimensioned sketch in this script." when there is no other). The line does not say which rule is
missing, only how many ways are free. A tangent whose contact is pinned only by a distance is a known limit of both the count and the contact
(the known-limits card); no such sketch is in the 44.

Checked on 0.30.1: `npm test` 1027 tests, 1021 pass, 6 skipped, 0 fail; the 44 sketch scripts give the same lines, statuses and volumes before
and after the two sentence changes; the 56 examples give the same 46 passes as recorded; the pane check passes.

### F5, F8: hollows, drafts, rounds and bevels (owner chose "blocked hollows, drafts, rounds", then "turn it on in the page")

A hole that is blocked by a refused step already reports its own mistake. A hollow, draft, round or bevel still said only "it needs hole1,
which could not be built" / "round1 builds on hole1 ... fix hole1 first", even when it could never have been built either.

How it works (`probeBlockedSteps()` in `packages/solidcraft-host/pane/src/host-entry.mjs`, used only when `ctx.probeBlockedSteps` is set): when
a script has such a blocked step, the page translates the script **once more without the steps that were not built**. A step that is left out
hands its part on (what targeted the refused hole now targets the part the hole was drilled in). If the blocked step is refused in that second
translation for a reason of its own, that sentence is shown in place of the blocked one. Nothing else from the second translation is used: the
commands the page builds, the measures, and the built / not built result of every step are the first translation's. Existing sentences only.

It is done at the page's host level and not in the layer, because the hollow, draft and round guards read the whole history of the part ("the edge
was already changed by an earlier hole"), and a refused step must not count as history. Leaving it out of the script is the one way that is
right for every guard, and it needs no change to the layer or to the contract copies.

A blocked step keeps its blocked sentence when: it would build without the refused steps; the refused step made the part itself (a pull, a
join, a pattern: there is nothing to hand on); one of its own fields names a refused step (an edge named by a face of the hole that was not
built); or the second translation's refusal is about the translation and not about the student's step (a name that could not be resolved,
"is not a single solid", the engine's own words).

In the real page on 0.30.1 (`followup/blocked-steps-page.json`), each after `hole(b, { across: 35 })` on a 30 wide box, which is not built:

| blocked step | before | now |
|---|---|---|
| `hollow(b, { wall: 12, open: 'top' })` | "it needs hole1 ..." | "Hollowing box1 to 12 thick would collapse it ... the wall has to be under 10." |
| a second hollow | "it needs hole1 ..." | "box1 is already hollow and a second hollow is not supported yet ..." |
| `draft(b.face('top'), 5)` | "it needs hole1 ..." | "the top face is square to the pull direction (z), so it cannot be tilted ..." |
| `round(b.edge('top', 'front'), 25)`, and the bevel | "builds on hole1 ... fix hole1 first" | "The round round1 is as big as or bigger than the face it cuts into (20 wide) ... use a size under 20." |
| a hollow on a sphere; `open: 'left'` on a cylinder | "it needs hole1 ..." | "a sphere has no flat face to open ..."; "a cylinder only has flat top and bottom faces, not a left one to open ..." |
| a good hollow, a good draft, a good round | "it needs hole1 ..." | unchanged: they would build, so only the block is reported |
| hollow (wall 12), then a draft, then a round | each "it needs ..." | the hollow says it would collapse; the draft and the round still wait on the step before them |

Corpora, Node host route, the rows that hold a blocked hollow, draft or round, the page's settings, switch off against switch on
(`followup/blocked-steps.json`: every step that got its own sentence, before and after):

| corpus | rows | steps | blocked | own sentence found | built / not built changes | time, off to on |
|---|---|---|---|---|---|---|
| sd | 27 | 125 | 49 | 15 | 0 | 2 s to 4 s |
| combined | 312 | 1798 | 385 | 196 | 0 | 660 s to 748 s |
| rgcombined | 214 | 2159 | 253 | 126 | 0 | 314 s to 369 s |
| fccombined | 295 | 2050 | 545 | 190 | 0 | 512 s to 700 s |
| mt | 4 | 18 | 4 | 0 | 0 | under 1 s |
| all | 852 | 6150 | 1236 | 527 (43%) | 0 | 1488 s to 1821 s (+22%) |

By kind: 287 of 595 hollows, 166 of 334 drafts, 74 of 307 rounds and bevels. Most are refused before anything reaches the kernel: a part with
inside corners (91), a hollow with no open side on a changed part (73), a face that cannot be found on the part as it is (86), a sphere or a
cone with no flat face (58), a second hollow (24), an ambiguous face word (35). 49 come from a real build of the step (a draft the kernel
refuses, a tilt that could not be checked).

No step changed between built and not built, and no volume changed. Ten rows differed between the first off and on runs and were run three
more times each: all ten are the same off and on every time. They were stalls of the rig (a plain box "took longer than 45 seconds" in one run
and 0.8 s in the next) and last-digit noise in the kernel's volumes (1e-16), not the switch. One hole on a sphere sits at the 45 s budget and
gets the budget sentence in some runs and its own sentence in others; that is the hole probe, as before.

Cost: one more translation, only for a script that has a blocked hollow, draft, round or bevel; on those rows the whole run took 22% longer.
A script with nothing blocked is not translated twice. The sample scripts in the page take 1.6 to 5.0 s.

The owner chose to turn it on in the page: `pane.js` sets `probeBlockedSteps: true` beside the holes' `probeBlocked: true`. Any other caller of
the host's `translateDoc` gets it only by asking. Tests: `packages/solidcraft-host/test/blocked-steps.test.mjs` (7).

Limits: what is reported is the step's own mistake **if the refused steps were not there**. A mistake that exists only because of the step
that failed, or one the failed step hides, is not found.

A sentence slip fixed with it (owner approved the exact text): a hollow or draft that picks a face with no word (a side of a pulled outline)
read "d5 (draft): the undefined face of e2 could not be found on the part as it is now ...". It now reads "d5 (draft): that face of e2 could
not be found on the part as it is now, so d5 is shown without it." (`shell-draft.ts`, mirrored in the contract copy; a face that has a word
is unchanged). Two more places showed the same slip and got the owner's text next: "s5: that face cannot be found reliably after the part
was turned or copied, so s5 is shown without it -- apply it before turning the part." (4 times in the corpora) and "d5 (draft): that face of
e2 was tilted by d3, so d5 is shown without it." (not seen in any corpus). Still as it was, no text approved: the hollow form "the undefined
face was tilted by d3, so it can no longer be picked by name ..." and the sphere form, neither seen in any corpus.

Checked on 0.30.1 with the switch on in the page and the sentence fix in: `npm test` 1036 tests, 1030 pass, 6 skipped, 0 fail; the six browser
checks give the same results as the last recorded run (examples 46 of 56); the 44 sketch scripts and the 14 blocked-step page scripts are
unchanged on a second run; the host-route sweep of the six corpora (4784 rows, 24717 steps, default settings) has 0 changes in built / not
built, guard or volume against the sweep of 2026-11-11, and 13 sentences changed, all "the undefined face of" to "that face of".

### The page's second pass, swept (owner chose "sweep the page's second pass")

HALT-9 was a wrong solid made by the page's own second translation, and no sweep had found it: in the six corpora (4784 rows) the page's own
guards fire in 5 rows, and in none of them is anything built afterwards. So the path was unswept.

Method (`followup/second-pass-*`): every corpus row is run three ways through the Node host route with the page's settings.

- **O**: the row as it is.
- **G**: the row with a small block of steps injected (`second-pass-gadget.mjs`), far away from everything else (x, y around 500 to 600), that makes
  one of the page's own guards fire: a draft, hollow, round or bevel on a part a pocket or groove already cut (G-STALE), or a pull of a sketch
  whose rules move it and leave it free (the sketch guard), alone or with a draft, hollow or hole on its part, with and without `from:` words.
  The page then translates the row a second time without the refused step. The block goes at the start (6 in 10), at a random place (not
  between two rounds), or at the end.
- **R**: the same row with the block, and the left-out steps deleted by hand, so there is no second translation.

Two questions. **G against R**: is the second translation the same as deleting the step by hand (every other step's result, guard, sentence,
volume, box and face count, and the whole command list)? **G against O**: does an unrelated block change any step of the original row?

First run, seed 1, before the two-part hole change:

| corpus | rows | rows that went through a second translation | steps after a left-out step | G differs from R | G differs from O |
|---|---|---|---|---|---|
| sd | 1097 | 826 | 1622 | 0 | 25 |
| combined | 600 | 418 | 1582 | 0 | 158 |
| rgcombined | 400 | 288 | 1491 | 0 | 108 |
| fccombined | 400 | 258 | 1189 | 0 | 94 |
| holes | 357 | 264 | 455 | 0 | 205 |
| mt | 1930 | 1479 | 6471 | 0 | 271 |
| all | 4784 | 3533 | 12810 | 0 | 861 |

**G against R: 0 of 3533.** After the HALT-9 fix the page's second translation is the same as deleting the refused step by hand, command for
command. (This comparison was not run on the tree before the fix; the seeded family of HALT-9.md is the measurement of what was wrong there.)
Two of the eleven block kinds never reach a second translation, because the layer refuses the stale step itself first (a hollow on a pocketed
part: inside corners; the round after a groove).

**G against O: 861 rows changed, none of them a different solid.** No step that was built came out with another volume, and no step that was
refused got built. What changed:

- 228 holes that were built without the block are refused with it, and several hundred more are refused for another reason than before, with
  their dependents: "the part it drills is 2 separate pieces ...". A hole was refused whenever the script had any second part. That is the
  finding of this sweep; see GUARD-TWO-PARTS.md for the change the owner chose.
- The same blocked step is worded differently depending on what else is in the script: "m2 (move): its target b1 was refused (...)" in one
  document and "m2 (move): its target b1 was refused, so there is nothing to build on (...)" or "This step was skipped because an earlier step it
  depends on was not done; fix that earlier step first." in another (several hundred moves and turns in the mt and combined corpora). Each group of
  steps has its own wording, and which group words a step depends on which kinds of step the script uses. Honest either way; not changed.
- 16 rounds change their sentence. The two looked at say "The edge for f6 was already changed by an earlier round or bevel, mirror or repeat ..."
  where the round or bevel it lists is the block's, on another part: that sentence lists the kinds of the steps before it, not only the steps on
  its own part. Not changed.
- Counted names move as they should when the block adds a step of the same kind ("Move 2" becomes "Move 3").

Second run, seed 2 (other blocks at other places), on the code with the two-part hole change and the `from:` fix
(`followup/second-pass-final.txt`, `second-pass-final.json`):

| corpus | rows | rows that went through a second translation | steps after a left-out step | G differs from R | G differs from O | of those, a step built in one and not in the other |
|---|---|---|---|---|---|---|
| sd | 1097 | 908 | 1835 | 0 | 0 | 0 |
| combined | 600 | 501 | 1869 | 0 | 23 | 0 |
| rgcombined | 400 | 325 | 1772 | 0 | 45 | 0 |
| fccombined | 400 | 334 | 1504 | 1 | 14 | 0 |
| holes | 357 | 285 | 509 | 0 | 2 | 0 |
| mt | 1930 | 1556 | 6745 | 0 | 239 | 0 |
| all | 4784 | 3909 | 14234 | 1 | 323 | 0 |

- **G against R: 1 of 3909**, and it is not the second translation: in `fc combined seed 184` one hole sits at the 45 s budget and is refused with
  the budget sentence in one run and with its own sentence ("not flat and level under this spot") in the other. Refused both times.
- **G against O: 323 rows, all of them a step refused in both with other words.** No step is built in one and not in the other, and no built
  volume differs. The 228 holes of the first run build now (see GUARD-TWO-PARTS.md). What is left is the wording by group of steps described
  above (moves and turns after a refused step, 959 steps), "the part it drills is 3 separate pieces" where it said 2 (6 holes: the number in
  that sentence counts every body in the script, also the block's; not changed), 5 rounds that list the block's steps among "earlier" ones, 3
  grooves that are refused by a different guard of their group when the script has more parts, and the budget row above.
- One row (`fc combined seed 246`) went past the harness's 300 s limit with a block in it and is not in the table. It is not a hang: its hole takes
  22 s of kernel time, every later step replays it, and a second translation and the blocked-step test build replay it again. A script whose one
  step is that slow is slow in the page as well.

The machine was under heavy load from another job during part of this run (load 50 to 80 on 32 cores), and a starved run goes past the 45 s
budget. The 20 rows where a step was built in one run and not in the other, that showed the budget sentence, or that hung, were run again on the
idle machine (`second-pass-repair.sh.txt`): the 18 in sd came back equal; the 2 in fccombined are the budget row and the row at the harness
limit above.

### `from:` on a part pulled from a sketch (found by the sweep's block; owner chose "fix it")

`draft(face, angle, { from: 'top' })` turns the word into a plane by reading the size of the starting shape. The script only knew the size of a plain
box or cylinder; for a part pulled from a sketch it read 0 for every word. So `from: 'top'` on a pull from z = 0 to 10 asked for a tilt about
z = 0, and the build's G-FROM check refused it with a sentence that was not true: "from:'top' would put the neutral plane at 0, but the top of this
part is at 10 now (the part was moved, joined or turned)". `from: 'bottom'` worked only because 0 happened to be right; on a sketch plane lifted
by 5 it was refused too. Nothing wrong was built.

Now (`packages/script/src/reshape-script.ts` `primitiveExtreme`): for a pulled part the word reads the part's real start or end along that axis
when it is exact, from the same range function `hole()` uses: the pull's own length along the pull, the outline across it. Where it is not exact
(a tapered or slanted pull, a dimensioned sketch across the pull, a part that was cut by a pocket) it still reads 0, and G-FROM still compares
the plane with the built part. A plain box or cylinder is unchanged. The layer's copy of the reading (`shell-draft.ts` `interpreterExtreme`, used
for a document no script produced here) follows it.

Real kernel, Node host route, pull 40 x 30 x 10:

| script | before | now |
|---|---|---|
| `from: 'top'` | refused, G-FROM (measured: the sweep's blocks and the HALT-9 family) | built 12131.2330 = closed form, and equal to `neutral: 10` |
| `from: 'bottom'` | not run before the fix (the word read 0, which is the bottom) | built 11868.7670 = closed form |
| the sketch plane lifted by 5, `from: 'bottom'` | refused, G-FROM (the corpus row below) | built, RIGHT by the oracles |
| the sketch plane lifted by 5, `from: 'top'` | not run before the fix | built 12131.2330 |
| the pull moved up by 5 afterwards, `from: 'top'` | not run before the fix | refused: "... at 10, but the top of this part is at 15 now (the part was moved, joined or turned)", which is true |
| the top face tilted, `from: 'right'` | not run before the fix (the word read 0; the right of the part is at 40) | built 14099.7279 = closed form (the tilt about x = 40) |

In the corpora 1 row changes for this: `sd draft-from-bottom-extrude-lifted` goes from refused to built and is RIGHT by the oracles.
Tests: `packages/script/test/extent-extrude.test.mjs` (3 new).

### Other steps with a second part, and a correction (owner chose "other steps with two parts")

The hole fault raised the question for every other step: does a step meant for one part change a part next to it? A seeded family of 420
two-part scripts says no for the eleven kinds tried (hollow, draft, round, bevel, pocket, join, cut, move, mirror, repeat; the groove of the
family is refused with and without the second part): the second part came back exactly in 420 of 420, and the first part came out identical to
the same step on it alone in 392 of 392 built cases. Numbers and method: GUARD-TWO-PARTS.md, "Other kinds of step".

Writing that family showed an error in my own two-part tests: a shape written without `at:` is placed beside the shape before it, so "the other
part made first" had moved the part under test. The hole family was run again with the part placed explicitly. What changed: the kernel's
recessed hole cuts a neighbouring part **whichever was made first** (51 of 108 recessed holes refused by G-OTHERS, not 24), and the earlier
statement that it builds right with the other part made first was wrong. The check does not depend on the order, so no build was affected.
GUARD-TWO-PARTS.md carries the correction; the AGENTS.md note was corrected with the owner's approval.

Also done: the number in "the part it drills is N separate pieces" counts the drilled part's own pieces and its copies, not every body in the
script (owner decision).

### A shape without `at:` (owner chose "both"), and a join that joins nothing (owner chose "build it, but say so")

A shape written without `at:` is not put at the origin unless it is the first: it is placed beside the rightmost shape already there
(`packages/script` `newShape`: 10 past its right edge for a shape of the default size; deliberate, so a second box is not hidden inside the first). The page said nothing about it. Measured in the page
before the change (`followup/placement-page-before.json`): a pocket on the second box says "pocket1 does not touch the part ...", `keep()` says "The
two shapes do not overlap ...", a groove says "the ring does not cut the part ...", none with a word about where the box is; only the cut sentence
mentions `at:`. And `union()` of a plate and a peg that ended up 10 apart is built, one part in two lumps, with the card saying "pieces 1" and a
later hole saying "the part it drills is 2 separate pieces ... or join the pieces first".

Now (`followup/placement-page.json`, the same scripts):

- The script result records which shapes it placed by default (`RunResult.placed`, beside the doc, like the record of rule calls; the doc is
  unchanged). The page shows on that shape's step: "no at: given, so it was placed beside box1; its centre is at [40, 0, 0]".
- A pocket, `keep()` or groove that missed such a part gets a clause on its sentence: "... (box2 has no at:, so it was placed beside box1 with its
  centre at [40, 0, 0])." The layer's sentences are unchanged; the page adds the clause (`pane/src/placement.mjs`). Nothing is added when the
  part had an `at:` or is the first shape.
- A built join of two shapes whose boxes are apart shows: "box1 and cyl1 do not touch, so this join is 2 separate pieces; give one an at: position
  so they overlap". It is still built. The part card counts pieces as lumps, so it says 2.

Tests: `packages/solidcraft-host/test/placement.test.mjs` (6).

A join of three shapes that do not touch gets no note (the card still counts 3 pieces).

**A shape after a pulled or spun sketch** (owner chose "place it beside, same rule"). Only plain shapes were measured for the placement, so a box
made after a pulled plate went to the origin, inside the plate, with no note. Now a part pulled or spun from a sketch counts too, when its
reach along x is known exactly (a plain outline on a standard plane, no taper; a full spin): the box goes beside it, with the same note
("... placed beside pull1; its centre is at [50, 0, 0]"). Where it is not known exactly (a sketch with dimensions and rules, a tapered pull) and
there is nothing else to measure from, the shape stays at the origin and its step says "no at: given, so it is at the origin [0, 0, 0]; it may
overlap pull1". The same rule is used by the round-trip emitter and by the studio's "add a shape", which read the same function.

Does it change any existing script? Every script of twelve corpora (9066), the 56 page examples and the 19 pilot scripts was run through the
interpreter before and after: 0 documents differ. (233 corpus scripts have both a pulled part and a plain shape; the plain shape either has an
`at:` or stands beside an earlier plain shape that reaches further.) In the page (`followup/placement-page.json`): 15 of the 16 earlier scripts
are unchanged, the box after a pulled plate now stands beside it, and four new scripts show the two notes, the join note for a cylinder beside a
pulled plate, and the hint on a pocket that missed a box placed beside a pull.
