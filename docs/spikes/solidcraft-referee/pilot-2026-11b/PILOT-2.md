# Second student pilot, 2026-11-12

`main` at `2cf126be`, pin SolidCraft v0.30.1, the real page in headless Chrome (`run.mjs`, one fresh page per script). Owner chose "a second
student pilot" after the changes since the first one (two-part scripts, placement notes, blocked steps, the sketch check, `from:` on pulled parts).

Method, as in the first pilot: for each of nine small design tasks, the script a student would plausibly type first; then, where the page refuses
or notes something, the script they would type after reading it. 30 scripts in all (`tasks.mjs`, results in `pilot.json`). Where the finished part
is clear its volume is checked against a closed form written before the run. I am not a student; the "plausible first script" is my guess.

## Result

- **No wrong solid.** 22 scripts built every step, 7 built with one or two steps not built, 1 stopped with a script error. Of the built scenes, 18
  have a closed form that applies: all 18 are within 3e-4 (worst 7.0e-5, a spun shape). Two of my expectations were wrong, not the builds (below).
- **The page's sentences were enough to get to the part in 6 of 9 tasks**: the student reads the note or the refusal, changes one thing, and it
  builds. The three where they were not: repeating a drilled block (Q1), a spun shape that lies on its side (Q2), and placing a hole on a boss,
  where the sentence says to check `at:` but not what it is measured from (Q4).
- Slowest script 17.4 s (the join of a spun knob with a base that crosses it); the others 1 to 12 s.

| script | result | scene volume | off the closed form | seconds |
|---|---|---|---|---|
| p1a-box-lid | built | 18874.307 | 3.3e-7 | 1.1 |
| p2a-plate-peg | built | 13570.535 | - | 2.1 |
| p3a-bracket-boss | 1 not built | 28608.228 | - | 2.2 |
| p4a-cup-pulled | built | 13413.331 | 8.7e-15 | 2.7 |
| p4b-cup-from-top | built | 62187.217 | 2.3e-16 | 2.3 |
| p5a-plate-forgot | 2 not built | 560.741 | - | 3.0 |
| p6a-standoffs | 2 not built | 18077.143 | - | 8.7 |
| p7a-cut-tool | 1 not built | 34355.803 | - | 1.2 |
| p8a-row | script error | - | - | 0.1 |
| p9a-knob | built | 8424.893 | - | 2.3 |
| p1b-lid-on-top | built | 18874.307 | 3.3e-7 | 2.1 |
| p1c-lid-counterbore | 1 not built | 18912.000 | - | 2.3 |
| p1d-lid-first | built | 18817.764 | 6.2e-7 | 2.7 |
| p2b-peg-at | built | 13570.535 | 1.9e-5 | 1.9 |
| p2c-peg-hole | built | 13256.538 | 7.4e-6 | 2.6 |
| p3b-boss-at | 1 not built | 27402.057 | - | 2.4 |
| p3c-boss-hole-first | built | 27301.564 | 1.1e-6 | 3.2 |
| p5b-plate-fixed | built | 9560.741 | - | 2.5 |
| p5c-plate-spacer-at | built | 9560.741 | 3.5e-6 | 2.6 |
| p6b-standoffs-drilled-first | built | 17964.134 | 4.4e-6 | 11.8 |
| p7b-cut-at | built | 30429.465 | 8.6e-6 | 1.9 |
| p8b-row-then-drill | 1 not built | 18000.000 | - | 1.6 |
| p8c-row-touching | built | 17717.304 | 2.7e-6 | 2.0 |
| p8d-three-by-hand | built | 17151.911 | 8.2e-6 | 3.1 |
| p9b-knob-base-at | built | 7304.394 | - | 17.4 |
| p9c-knob-top-plane | built | 8424.893 | 7.0e-5 | 2.7 |
| p9d-knob-alone-front | built | 4825.201 | 5.9e-5 | 1.3 |
| p8e-holes-in-a-row | built | 11151.911 | 1.3e-5 | 2.7 |
| p6c-standoff-through | built | 17907.596 | 3.8e-6 | 9.3 |
| p3d-boss-hole-centre | built | 26924.636 | 1.3e-6 | 2.6 |

"-" in the fourth column: no closed form applies (a first attempt whose result is not what the student meant, or a step was not built).
`p9b-knob-base-at` built 7304.394; I had expected 8425.486 for a knob standing on the base. The knob lies along y and passes through the base;
for that the closed form (by quadrature of the overlap) is 7304.849, and the build is 6.2e-5 off it. See Q2.

## What worked

- **Where a shape went.** In six tasks the first script left out `at:`. In five the step said "no at: given, so it was placed beside box1; its
  centre is at [60, 0, 0]" (or "beside pull1", "beside rev1"); in one, after a pulled dimensioned sketch, "no at: given, so it is at the origin
  [0, 0, 0]; it may overlap pull1". A join of the two said "box1 and cyl1 do not touch, so this join is 2 separate pieces; give one an at:
  position so they overlap". Adding `at:` put the shape where it was meant each time (p1b, p2b, p3b, p5c, p7b, p9b).
- **Two parts.** A hole in the lid of a box, a hole in a spacer beside a plate, three drilled blocks written out by hand: built, each right.
- **A counterbore in a lid that sits on the box** is refused ("cutting it would also cut box1, which is in the way of this hole ... drill this
  hole before you make box1"). Moving the lid and its hole above the box in the script builds it right (p1d). The student has to reorder; the
  sentence says so.
- **`from:` on a pulled part.** A cup pulled from a sketch and drafted `from: 'bottom'`, and the same drafted `from: 'top'`: built, equal to the
  closed form to 1e-14 (p4a, p4b). Before 2026-11-12 the second was refused.
- **The sketch check.** A forgotten dimension: "not built -- It is not fully defined, and its rules have to move it. See sk1 under Steps.", the
  step explains, and the pull says "it uses sk1, which could not be built; fix sk1 first." With the dimension added: "fully defined" (p5a, p5b).
- **Drilling before joining.** A boss drilled and then joined to a bracket, standoffs drilled and then joined into a box: built, right (p3c, p6b).

## Findings

**Q1. A drilled block cannot be repeated, and the page sends the student in a circle.** `linearPattern(b, ...)` after `hole(b, ...)` repeats the
*hole*, not the block (p8e: three holes in one block, right). With a step wider than the block the copies of the hole fall outside it and the
script stops with an error that names things a student has never heard of:

> repeat() of a hole drills a copy of the hole at each place, and copy 2 of the hole reaches the edge of the part, so brep-rs cannot yet cut through an edge and match the face count FreeCAD gives. Drill the extra holes yourself, one hole(...) each.

Nothing is built. So the student repeats the plain block first and drills the row (p8b), and is told "the part it drills is 3 separate pieces and
a hole cannot tell which one to drill ... drill each piece before copying it" -- which is the script that gave the error. What works is writing
the three blocks out by hand (p8d), or making the copies touch (p8c). Two separate things: the wording of the script error (it says "brep-rs" and
"FreeCAD"), and there being no way to repeat a part that has a hole.

**Q2. A profile spun on the front plane lies on its side.** `revolve()` reads the sketch as (distance from the axis, height along the axis), and the
axis is the sketch plane's own normal. A profile drawn on `sketch('front')` therefore gives a part whose axis runs front to back (p9d: 24 x 14 x 24),
not one standing up; the same profile on `sketch('top')` stands up (p9c). A student who draws the profile where they see it, on the front plane,
gets a knob lying down, and a base "under" it is cut through the middle of the knob (p9b: built, and right for what was built). Nothing on the
page says which way a spun part stands. This is how the language is defined, not a build error; the first pilot's bushing was drawn on the front
plane too and nobody looked at which way it stood.

**Q3. A blind hole into a standoff inside a box.** After the posts are joined into the box, `hole(body, { ..., deep: 8 })` is refused: "a hole that
stops short of the other side starts on the top of the part, but the part is not flat and level under this spot ... move the hole onto a flat top,
or let it go all the way through" (p6a). A blind hole starts at the top of the whole part, which here is the rim of the box, in the air above
the post. Both ways out work: through holes (p6c), or drilling each post before joining it (p6b). The sentence offers the first and not the second.

**Q4. `at:` of a hole is measured from the middle of the part.** A student who places a boss at `[35, 5, 34]` writes `hole(both, { at: [35, 5] })`
and is told "it does not touch the part ... move the hole onto the part (check at:) or make it wider" (p3b). `at: [5, -15]` is right (p3d). The
sentence says to check `at:` but not what it is measured from.

**Q5. A hole after a join that joined nothing.** "the part it drills is 2 separate pieces and a hole cannot tell which one to drill ... drill each
piece before copying it, or join the pieces first" (p3a). The pieces *are* joined, by a join that missed; the join's own note above says why. The
hole's advice is the wrong way round here.

**Q6. "it may overlap pull1" when pull1 was not built.** In p5a the sketch was refused, so there is no pull1; the spacer's note still says it may
overlap it. Harmless, but not quite true.

**Q7. A join can take long.** The knob through the base took 17.4 s, the standoffs 9 to 12 s. Nothing was refused for time.

## Not covered

Grooves, repeats around an axis, mirrors, rounds on joined parts, hollows of joined parts, more than two parts in contact. A person looking at the
3D view: the screenshots of a headless browser show a blank viewport, so which way the knob stands was read from its size, not seen.

Files: `tasks.mjs`, `run.mjs`, `show.mjs` (prints what the page told the student per script), `pilot.json`, three screenshots of the panel.

## After the pilot: Q1 to Q6 (owner approved each text)

The sticking points were run again in the page after the changes, and the new option with closed forms (`tasks-after.mjs`, `pilot-after.json`).

**Q1, repeating a drilled block.**
- The eleven script errors about repeats and mirrors no longer name a tool. "..., so brep-rs cannot yet cut through an edge and match the face
  count FreeCAD gives" is now "..., which is not supported yet", and so on for the others (`packages/script/src/reshape-script.ts`).
- New option, as `draft()` already has it: `linearPattern(b, { count: 3, step: [40, 0, 0], whole: true })` (and `repeat`, `polarPattern`,
  `repeatAround`) repeats the **part** with its holes and pockets. The error of a hole repeat now ends "To repeat the whole part instead, add
  whole: true." The round-trip emitter writes `whole: true` for such a repeat, so it comes back as the same document.
- Real page, against closed forms: a drilled block three times apart 17151.911 (17151.770), counterbored 16699.561 (16699.381), a pocketed block
  twice 23784.000 (exact), a drilled block four times around 22869.223 (22869.027), three touching 17151.911, a block with two holes twice along y
  11183.296 (11183.186). Worst 1.1e-5. A further hole in a row of separate copies is refused as before ("3 separate pieces").
- Does `whole` change an existing script? No: every script of twelve corpora (9066) gives the same document before and after.

**Q2, a spun shape that lies down.** A built spin on the front plane now says "its axis runs front to back (y); for a part that stands upright,
draw the profile on sketch('top')", on the side plane "its axis runs left to right (x); ...", on the top plane nothing. Measured for the three
planes (the same profile: 24 x 24 x 14 on top, 24 x 14 x 24 on front, 14 x 24 x 24 on side). The rule itself is unchanged.

**Q3.** A blind hole into a part made by a join, not flat under it: "... -- move the hole onto a flat top, let it go all the way through, or drill
the piece before you join it." (p6a again: both standoff holes show it.)

**Q4.** A hole that misses: "... -- move the hole onto the part (at: is measured from the middle of the part) or make it wider." (p3b again.)

**Q5.** A hole in a join whose pieces do not touch: "... -- drill each piece before you join them, or move the pieces so that they overlap."
(p3a again.) A part in pieces that was not made by a join keeps "drill each piece before copying it, or join the pieces first".

**Q6.** A shape left at the origin beside a pulled part that was not built: "no at: given, so it is at the origin [0, 0, 0]" (p5a again).

Still open from this pilot: Q7 (a join can take 10 to 17 s). Seen while doing Q1 and not changed: the sketch mapper's refusals also name
"brep-rs" (for example "equal across a line and a circle/arc is refused by brep-rs too").

Checked on 0.30.1: `npm test` 1059 tests, 1053 pass, 6 skipped, 0 fail; the browser checks give the same results as the last run (examples 48 of
56, the 44 sketch scripts, the 14 blocked-step scripts and the 13 two-part scripts unchanged); the host-route sweep of the six corpora (4784
rows, 24717 steps) has 0 changes in built / not built, guard or volume, and 15 sentences changed: 11 the `at:` sentence, 3 the two join
sentences, and 1 that now names the other part (the G-OTHERS sentence, newer than the sweep it is compared with).

## Q7, where the time goes (owner chose "slow joins and extra passes")

Every engine call the page makes was timed for a set of scripts in the real page (`timing/time.mjs`; `timing/before.json`).

**One operation is computed several times.** The knob through the base (`p9b`, 15.6 s): the join takes 4.1 s of engine time. The page computes

1. the join in the time-budget worker (4.3 s), so that a hang can be stopped;
2. the same join in SolidCraft itself (3.2 s), whose reply the guards read;
3. the cut the join's volume check needs (3.2 s);
4. the join once more at the end (3.4 s), because after the check SolidCraft holds the cut, not the result.

**Every later step replays everything before it, twice** (worker and SolidCraft), because each run starts from an empty design. So one slow step
early in a script makes every step after it slow. The same steps with a 4 s join first or last (`timing/slow-memory-off.json`, the last two rows):

| script | time | engine runs |
|---|---|---|
| the slow join alone | 15.7 s | 5 |
| the slow join, then a part with a step the page leaves out (second translation) | 67.9 s | 21 |
| the slow join, then a part with a blocked hollow (test build) | 46.3 s | 12 |
| the slow join, then both | 163.5 s | 33 |
| both first, the slow join last | 46.4 s | 33 |

**Done: the engine's replies are remembered within one run of the script** (`packages/solidcraft-host/src/reply-memory.mjs`, used by `pane.js`). A
run starts from an empty design, so the reply to a command list depends on that list alone; a list that was already run is answered from memory,
with the time it took, so that the layer's time accounting and every result stay what they are. A run stopped by the time budget is not
remembered, and a remembered reply is not used under a smaller budget than the time it took. `?memo=off` switches it off.

The final replay, which puts SolidCraft on the accepted commands for the 3D view, is skipped only when SolidCraft already holds exactly that list
**and a fresh reading of SolidCraft shows the bodies of that reply** (names, face counts and volumes, exactly). Otherwise the list is really run,
never answered from memory.

| script | before | after | |
|---|---|---|---|
| ordinary scripts (eleven, `timing/before.json`, `after.json`) | 1.2 to 15.6 s | 1.2 to 15.6 s | 0 to 11% less (the join alone: no change) |
| the slow join, then a second translation | 67.9 s | 48.0 s | 29% less |
| the slow join, then a blocked hollow | 46.3 s | 36.1 s | 22% less |
| the slow join, then both | 163.5 s | 119.4 s | 27% less |
| both first, the slow join last | 46.4 s | 37.9 s | 18% less |

(`timing/slow-memory-off.json`, `slow-memory-on.json`. Single runs on a machine that was not idle: the percentages are good to a few points.)

**A fault in the first version of this change, found before it was committed.** The first version also answered the final replay from memory.
SolidCraft was then left on the last list it had really run, which can be a variant a guard tried and threw away, so the 3D view showed a solid
the report did not describe. The reports themselves were right, and so every comparison of reports passed (examples, sketch scripts,
blocked-step scripts, two-part scripts, both pilot runs: all unchanged). It was found by reading SolidCraft itself after each run and comparing
its bodies with the report (`timing/held.mjs`):

| | scripts | SolidCraft holds what the report says | final replay skipped |
|---|---|---|---|
| first version, memory on (`timing/held-first-attempt.json`) | 55 | **53** | 26 |
| memory off | 50 | 50 | 0 |
| fixed, memory on (`timing/held.json`) | 55 | 55 | 26 |
| fixed, memory on, every reading of SolidCraft during the run given a wrong volume | 15 | 15 | 0 |

The two were `p4b-cup-from-top` (report 62187.217, the closed form; SolidCraft held 61468.608, a list a guard had tried) and the slow
join with a left-out draft (the pulled part: report 11600, SolidCraft 11555). With the memory off the page never had this fault; it existed only
in the uncommitted change. The scripts are the 30 of the pilot, the 15 after the fixes, and the timing cases; with the memory on and off the 50
scripts compared give the same steps, sentences, notes, volumes and bodies, and so do the 15 with the tampered readings.

Tests: `packages/solidcraft-host/test/reply-memory.test.mjs` (15, a fake bridge that keeps "what SolidCraft holds"; each rule of the memory was
removed in turn and a test failed each time, the fault above included).

Checked on the fixed page: `npm test` 1074 tests, 1068 pass, 6 skipped, 0 fail; the six browser checks, the 44 sketch scripts, the 14
blocked-step scripts, the 13 two-part scripts and both pilot runs give the same results as the last recorded runs (examples 48 of 56).

**Not done, and the larger part.** The memory only removes repeats of the *same* list. What is left is the double run of every step (worker, then
SolidCraft) and the replay of the whole history for each step. Two ways to cut that, neither attempted:

- *Continue where SolidCraft is*: when the list to run only adds commands to what SolidCraft already holds, run just the added ones. That would
  make SolidCraft's half grow with the script, not with its square. It rests on the engine giving the same result as from an empty design, which
  would have to be measured on the corpora first.
- *Read the guards' numbers from the worker and run SolidCraft once at the end*: the worker is our build of the same engine source, not the build
  the student sees, so the final result would have to be compared with the worker's before it is shown.

Nothing tells the student that a long run is still working beyond the status line "translating and building in solidcraft...".
