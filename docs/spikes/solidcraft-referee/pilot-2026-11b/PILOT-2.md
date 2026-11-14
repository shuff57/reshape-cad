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
SolidCraft) and the replay of the whole history for each step. Of the two ways to cut that, the first was taken up next (below); the second was not
attempted: *read the guards' numbers from the worker and run SolidCraft once at the end* (the worker is our build of the same engine source, not the
build the student sees, so the final result would have to be compared with the worker's before it is shown).

Nothing tells the student that a long run is still working beyond the status line "translating and building in solidcraft...".

## Run only the new steps (owner chose it, 2026-11-12): measured, built, off unless asked for

When SolidCraft holds, from an empty design and run to the end, exactly the first commands of the list that is asked for, only the rest is run on
top (`upstream-bridge.mjs` `held`; the record of what SolidCraft holds is kept by `reply-memory.mjs`, set only from a run that came back ok and
dropped after anything else). The time budget still judges the whole list. The switch is `?inc=on`; without it the page is what it was.

**Is a continued run the run from empty?** Measured, not assumed (`timing/inc.mjs`, mode `on`): 4845 scripts in the real page (the 4784 rows of
the six corpora, as scripts or docs, and the 61 pilot and timing scripts) with continuation on, and a second SolidCraft in the same page as the
reference. Every real engine run of the page was repeated on the reference from an empty design and the two replies compared field by field,
exactly. After each script the design the page was left on was read (faces, edges, measure) and compared with the accepted commands from empty.

| | count |
|---|---|
| scripts | 4845 |
| engine runs compared | 19960 |
| of those, continued (41481 commands not run again; 52506 run) | 9518 |
| continued runs equal to the run from empty in every field, to the last digit | 9500 |
| continued runs not exact | 18 |
| runs from empty not exact against the reference's run from empty | 56 |
| scripts with any difference | 44 |
| scripts that built nothing (a script error, or the whole run refused before the engine) | 8 |
| scripts with no answer (`fc combined seed 215`, see "A step that stops SolidCraft") | 1 |

(`timing/continue/corpus-summary.json`, `corpus-rows.jsonl`.) The comparison can fail: with one number of each list's last command changed by one
part in a million on the reference, 30 of 36 sample rows report differences (`continue/control.jsonl`). The other 6 were not looked into; the
change is only made where the last command has a plain non-zero number among its parameters.

**The 74 runs that are not exact are the engine, not the continuing.** 56 of them are a run from empty against a run from empty. All 44 scripts
send the engine a round (20 have a round step, 24 make a box with `round:`). The 44 were
run again three ways (mode `on3`: the page's run, the reference's run from empty, and the reference's run from empty a second time; a pair is
"same solid" when every number agrees within 1e-9 and the faces and edges match by their geometry and names, whatever their order;
`continue/affected-three-way.jsonl`):

| 83 runs of the 44 scripts | page against reference | reference against itself |
|---|---|---|
| exact | 11 | 11 |
| same solid, not exact | 72 | 72 |
| not the same solid | 0 | 0 |
| largest difference of a volume | 7.2e-16 | 1.5e-14 |

All 20 continued runs among them are the same solid as the run from empty, and every one of the 83 lists has a round command in it: no list
without a round was inexact. So continuing adds nothing to what the engine does by itself. The final designs: 43 of 44 the same solid in both columns; in 1 (`holes round-box-hole-37`) two readings
from empty describe the wall of the hole with its axis up in one and down in the other (the same cylinder), and the page's reading differs from
the reference in the same way.

**Finding: the engine does not repeat a round to the last digit.** Two runs of the same commands from an empty design, in the same SolidCraft,
give volumes that differ in the last digits (up to 1.5e-14 of the volume), the faces of the part in another order, and a hole wall's axis in
either direction (`continue/round-four-readings.json`: a box with all twelve edges rounded, read four times: the 26 faces are the same faces, in
four different orders; `round-hole-four-readings.json`). A box with four edges rounded gave the same volume and the same order in four readings.
By a scan of the scripts and docs about 424 of the 4784 rows send a round or bevel; 44 showed a difference in one pass. The layer is not affected by the order: it sends a face or an edge as a point, never as a
place in the list (`packages/layer/src`: no command carries an index). It does mean that nothing may compare two engine runs of a rounded part
for equality, and that a recorded volume of a rounded part is good to about 1e-13, not to the last digit.

**What it saves** (`continue/timing-off-on.jsonl`; the same page, continuation off and on, one run each):

| | off | on | |
|---|---|---|---|
| the 55 pilot and timing scripts that build | 328.3 s | 289.0 s | 12% less |
| every tenth row of the six corpora (478) | 454.3 s | 433.2 s | 4.7% less |
| the slow join, then a second translation | 45.8 s | 35.6 s | 22% less |
| the slow join, then both extra passes | 117.3 s | 96.4 s | 18% less |
| the slow join alone | 13.5 s | 13.5 s | none |

All 533 give the same steps, sentences and bodies, and volumes equal to the last digit. The saving is smaller than was expected when this was
chosen, for two reasons the first timing study did not separate. The time-budget worker still replays the whole list for every budgeted step
(47.8 s of the 117.3 s), and continuing does not touch the worker. And a guard's check leaves SolidCraft on a variant, so the step after a
checked step starts from empty again; the slow join itself is always the new step. What would cut the rest is the worker keeping its design
between probes, and a way to return SolidCraft to the accepted commands after a check without replaying them; neither is attempted.

Tests: `packages/solidcraft-host/test/reply-memory.test.mjs` (26: among them 2000 random runs in random order against a reference that always
starts from empty, with a fake SolidCraft that counts every untrue `held` statement: none), `upstream-bridge.test.mjs` (8 for `held`). Each rule
was removed in turn in a copy and a test failed each time.

## A step that stops SolidCraft (found by the same run; fixed on our side)

The corpora had only ever been swept in Node. In the real page one row of 4784 never answered: `fc combined seed 215` (a cylinder, drafted, with
three pockets; `continue/engine-stop-case.json`), with continuation on or off, in 600 s and in 2400 s. It is not slow. The second pocket makes
the engine panic (`truck-geotrait-0.4.0/src/algo/curve.rs:78`, "tolerance must be no less than 1e-6"), which in the web build is a trap
("RuntimeError: unreachable"): upstream's `request()` then never answers, nor does anything asked of SolidCraft afterwards
(`continue/engine-stop-fc215-before.log`: no answer in 420 s; the panic's own words are in the second log below). The student would see "translating and building in solidcraft..." for ever. A pocket has no time
budget, so the worker, which would have caught the trap, was never asked. In Node the same trap is an exception the caller catches, and the step
is refused: "pk6: this pocket cannot be built from the sketch as drawn (the solid it makes does not close up cleanly), so nothing is cut; change
the sketch, the length or the options".

Fixed in the page (`packages/solidcraft-host/src/crash-guard.mjs`; upstream is not patched): the trap shows as an uncaught error on SolidCraft's
window. Every call that is waiting is then rejected, which the bridge already turns into a failed run and the layer into the step's own sentence;
SolidCraft's frame is loaded again, and calls made meanwhile wait for it. Only a wasm RuntimeError counts. No sentence is new. The same row in
the page now (`continue/engine-stop-fc215-with-guard.log`): 12 s, pk6 and pk8 refused with the sentences above, the part 13313.79584555072 mm3 with
5 faces, in the report and in SolidCraft, which is the Node sweep's result to the last digit.

Tests: `packages/solidcraft-host/test/crash-guard.test.mjs` (10, a fake frame whose engine stops answering and throws the error the page throws).

Limits: an engine that hangs without a trap, in a step that has no time budget, is still a page that waits; none was seen in the 4845 scripts.
A trap during a step costs the time to load SolidCraft again (about 2 s here).

Checked with both changes in (continuation off, as shipped): `npm test` 1104 tests, 1098 pass, 6 skipped, 0 fail, and the crash guard's eleventh
test after that run (the host package alone: 134 of 134); the six browser checks, the 44 sketch scripts, the 14 blocked-step scripts, the 13
two-part scripts and both pilot runs give the same results as the last recorded runs (examples 48 of 56).

## The corpora in the real page (owner chose "sweep the page for more freezes", 2026-11-13)

Until now the six corpora (4784 rows) were swept in Node, on a harness that mirrors the page's route. Here every row is run in the real page
(`timing/inc.mjs`, mode `off`: the page as shipped) and compared with the Node sweep, step by step (`timing/page-sweep/vs-node.mjs`).

**Found: the page refused every cylinder hollowed with its top or bottom open.** The first comparison (`page-sweep/vs-node-before-the-fix.json`)
had 24 rows where the page refused a step that Node builds, all of this kind, and 20 more where the page gave this sentence for a step that
Node refuses for another reason. The simplest one is a cup:

    const c = cylinder(24, 30, { at: [5, 3, 2] });
    hollow(c, { wall: 2, open: 'top' });

> shell1 (hollow): the top face of cyl1 could not be found on the part as it is now, so shell1 is shown without it -- open a different face, or hollow before drafting.

The face was there. The page does not take upstream's pick point of a face on trust (the Node stand-in does): `verifiedInnerPoint` checks, among
other things, that the point lies inside the box of the face's boundary edges. Upstream gives three points per edge, and the box was made of
those. A cylinder's cap on 0.30.1 is two half circles whose seam is not on an axis, so the circle reaches up to 2.2 beyond the six points, and
upstream's own pick point (0.7 inside the rim) fell outside the box: no face of any cylinder got a pick point in the page
(`packages/solidcraft-host/test/topology-cylinder-0.30.1.json`, measured in the page).

Fixed (`upstream-bridge.mjs` `edgeBox`): an edge whose three points are not on a line is boxed as the arc through them, from start to end
past mid; a whole circle given as one edge, as the circle in the face's plane. Everything else in the check is as it was: the point on the
face's own surface, no other face's surface within 0.001 of it. The two halves of a cylinder's wall still get no pick point (each is on the
other's surface), as designed. No sentence is new or changed.

After the fix (`page-sweep/page-rows.jsonl`, `vs-node-after.json`; Node side: the host-route sweep that mirrors the page):

| 4784 rows, the page against Node | count |
|---|---|
| every step built or not built alike, the same sentences, and the final volume equal (1e-9) where Node recorded one (1411 rows) | 4739 |
| a sentence differs: the three hole sentences approved after that Node sweep was recorded (`at:` 22, flat and level 19, separate pieces 2) | 43 |
| the page refuses the whole run before building: a dimension over 1,000,000 mm (the page's own limit) | 1 |
| the page stops a hole at the 45 s time budget, which the Node harness does not enforce (`fc combined seed 246`) | 1 |
| no answer | 0 |

The 24 rows now build and refuse as Node does. In the oracle-scored Node sweep the same rows carry the verdicts RIGHT (9, with the page's final
volume equal to Node's) and REFUSED (the measured step is a later one that both refuse). The cup above: 4774.728965992665 mm3 in the page and in
Node, 1.0e-4 under the closed form (pi x (144 x 30 - 100 x 28) = 4775.22; the engine's cylinder itself is 1.1e-4 under pi r2 h).

**Freezes.** In this run 13806 of 19624 engine runs had no time budget (4275 of the 4784 scripts have at least one): pulls, pockets, drafts,
rounds, moves, turns, spins and plain shapes in a script that drills no hole, and every topology reading. The slowest of them:

| slowest run without a budget, per script | scripts |
|---|---|
| under 1 s | 4722 |
| 1 to 5 s (the slowest 4.2 s, a pull or pocket) | 61 |
| the engine stop above (8.0 s, then refused) | 1 |

So in the 4784 rows, and the 61 pilot and timing scripts, the only way the page stopped answering was the engine stop, and that is fixed. What is
not covered: a step without a budget that hangs without a trap. None was seen.

**What a budget on every run would cost** (`page-sweep/budget-every-run.jsonl`; the harness gives every unbudgeted run from empty a 45 s budget,
so it goes through the worker first; topology readings are not covered; same steps, sentences and volumes in all 534 scripts):

| | as shipped | every run budgeted | |
|---|---|---|---|
| the 55 pilot and timing scripts | 372.9 s (worker 127.4 s) | 545.8 s (worker 262.1 s) | 46% more |
| of those, the slow join with both extra passes | 129.0 s | 220.8 s | 71% more |
| every tenth corpus row (479): time in the worker | 228.5 s | 252.7 s | 11% more; the median script 6% more |

(The tenth's totals come from two sessions with different load and are not compared; the worker's time and the per-script median are.) The cost
falls where a script is slow already: each replay of a slow step is then computed twice.

Tests: `packages/solidcraft-host/test/upstream-bridge.test.mjs` (5 for the box of a curved edge, on the measured cylinder: both caps keep their pick
point, a point past the rim, off the plane or within the clearance of the wall does not pass). Each rule was removed in turn in a copy; a test
failed for each one that can change an answer.

Checked with the fix in: `npm test` 1109 tests, 1103 pass, 6 skipped, 0 fail; the six browser checks, the 44 sketch scripts, the 14 blocked-step
scripts, the 13 two-part scripts and both pilot runs give the same results as the last recorded runs (examples 48 of 56).

## 1500 new documents, in the page and against the oracles (owner chose "new scripts in the page", 2026-11-13)

The two page-only faults above were found on documents the layer had been tuned on. Here: 1500 documents it has never seen, 500 fresh seeds of each
of the three generators (`combinedDoc` 600 to 1099, `rgCombinedDoc` and `fcCombinedDoc` 400 to 899), run in the real page as shipped and through
the Node host route with OCCT and brep-rs (`new-seeds/`; the harness is the rig's `host-route-x.mjs` with the seed range, `new-seeds/harness.diff`).

**The page.** Every document answered; the engine never stopped. 1403 took under 5 s, 83 from 5 to 30 s, 12 from 30 to 120 s, and 2 longer: 134 s and
330 s, both a hole drilled into a hollowed cylinder, where one replay of the script takes 20 to 40 s (`new-seeds/page-rows.jsonl`). The two runs
without a budget that took over 20 s are the final replay of steps that had passed the budget before.

**The page against Node, step by step** (`new-seeds/page-vs-node.json`): 1495 of 1500 identical in every step, sentence and recorded volume. Four
differed only because the Node run stalled at seeds 696 to 699 (a plain box "took longer than 45 seconds", one row hung); run again in Node, the four
are the same as the page. One gives another reason for the same refusal (`rg combined seed 568`, a draft: the page "the right face of b1 could not
be found on the part as it is now", Node "the right face cannot be found reliably after the part was turned or copied").

**Is what was built right?** The harness scores a document's last step, and in these documents the last step is usually refused: scored as they
are, 39 documents got a RIGHT and 1455 a REFUSED, which says nothing about the steps that were built. So each document was cut down to the steps
that were built (the refused steps and the sketches nothing was built from are dropped; the page's own route leaves the same steps out) and scored
again: the last step is then a built one and the oracles judge the final solid. The page's final volume for the whole document equals the judged
solid in all 1411 (1e-9); 89 documents build nothing.

| 1411 final solids | count |
|---|---|
| RIGHT: every oracle that built agrees | 1316 |
| one oracle agrees and the other does not: brep-rs agrees 73, OCCT agrees 2 | 75 |
| flagged WRONG (no oracle that built agrees), and a volume worked out by hand agrees | 15 |
| flagged WRONG: a part with a cylinder wall, the same solid within 2e-4 of the volume and 1.3e-3 mm of the box | 4 |
| both oracles refuse the hollow; the step before it is RIGHT by both and the hollow equals its closed form | 1 |

No wrong solid. The 95 that are not a plain RIGHT, each looked at (`new-seeds/flagged.json`: the class, both oracles' numbers and the document):

- **The OCCT referee does not read four options of a pull or pocket.** In 66 of the 73 where only brep-rs agrees the document has one of them:
  `reversed` 18, `taper` 28, `midplane` 16, `through` 8 (some have two). OCCT builds the pull without the option: the other way up, straight,
  one-sided, or a pocket only as deep as its number. The reversed case was on record (GUARD-UNIFIED-JOIN-FULL.md, `combined seed 50`); the other
  three were not. In the other 7 (a draft after a move, a hole after a mirror or a hollow, a hole in a prism or cylinder) OCCT is 6e-4 to 0.13
  off and brep-rs agrees to 4e-5 or better.
- **Sixteen solids against a volume worked out here** (`new-seeds/closed-forms.mjs`, no kernel: a closed form, or a midpoint integral where there
  is none): the largest difference is 7.9e-5, fifteen of them under 2e-5. They are five reversed pulls with pockets, two hollows after a
  counterbore, a counterbore after a draft, a through pocket at the rounded corner of a box, three tapered pulls of an outline with a rounded
  corner, a pocket into the wall of a hollowed box, two boxes with pockets and a cross bore, and the hollowed mirror pair. Where a form needed
  a reading of what the script means (which way `reversed` goes, that `through` cuts from the sketch plane to the far side, that a taper widens),
  the reading is the one brep-rs shares with the page route wherever brep-rs builds.
- **The engine's cylinder is not exactly round, and less so after a cut.** A plain cylinder of radius 8 measures 1.2e-4 to 2.1e-4 mm short in its
  box and 1.1e-4 low in volume; after a pocket or a join its wall is up to 5e-4 mm inside the true one and the volume up to 1.9e-4 low. The
  harness allows 3e-4 for both, so the volume passes and the box does not: four documents (a cylinder joined to a box, two cylinders with a
  pocket, a cylinder turned 45 degrees). Both oracles agree with each other on all four. This is accuracy of the kernel's curved wall, known at
  1e-4 for the volume, not a different shape.

**What this run changes about the corpora.** Scoring only the last step leaves most of a generated document's built steps unjudged: on these 1500,
39 final solids judged before the cut, 1411 after. The 1400 documents of the three generators already in the corpora have been scored the first way
only.

## The corpora's own generated documents, judged on what they build (owner chose it, 2026-11-13)

The same cut applied to the 1400 generated documents already in the corpora (`combinedDoc` 0 to 599, `rgCombinedDoc` and `fcCombinedDoc` 0 to
399): each cut down to the steps the host route builds, and scored against OCCT and brep-rs (`old-seeds/`). Scored as they were, most of these
rows end in a refused step; cut down, 1329 final solids are judged and 71 documents build nothing. No step is refused in a cut-down document.

| 1329 final solids | count |
|---|---|
| RIGHT: every oracle that built agrees | 1248 |
| one oracle agrees and the other does not: brep-rs agrees 53, OCCT agrees 2 | 55 |
| flagged WRONG, and a volume worked out by hand agrees (`old-seeds/closed-forms.mjs`, largest difference 9.9e-5) | 15 |
| flagged WRONG: a reversed pull; OCCT's solid sits the other way and its volume agrees to 2e-5 or better | 4 |
| flagged WRONG: a cylinder wall, within 1.4e-4 of the volume and 1.2e-3 mm of the box of both oracles | 3 |
| both oracles refuse the hollow, and it equals its closed form | 4 |

No wrong solid. The classes are the ones of the new documents (`old-seeds/flagged.json`):

- Of the 53 where only brep-rs agrees, 41 have a pull or pocket option the OCCT referee does not read (`midplane` 21, `reversed` 12, `taper` 7,
  `through` 5). In the other 12 (a hole after a hollow, a mirror or a pattern, a hole in a prism or cylinder, a hollowed ball, a draft after
  a move, a pocket in a hollowed join) OCCT is 2.5e-3 to 0.88 off and brep-rs agrees to 6e-5 or better.
- The nineteen worked out by hand: seven reversed pulls with pockets and holes, a pull about its mid plane with a through pocket, two tapered
  pulls, through pockets from the mid plane of a ball (two) and of a rounded box, a hollow with a hole and a drafted wall, and four hollows
  that both oracles refuse: three boxes hollowed to half their thickness ("would collapse"; 4780, 5000 and 1860 exactly) and a box with a cross
  bore.
- The four reversed pulls are `combined seed 50` (on record) and three more of the same kind.

**The page.** The page's final volume for the whole document equals the judged solid in 1327 of the 1329. One is `fc combined seed 246`, where the
page stops a hole at the 45 s budget that the Node harness does not enforce. The other is `combined seed 452` (a cross bore into a hollowed
prism): the page gives 324.9935417644 and Node 324.9935425924, 2.5e-9 apart, the same in two page runs; both are RIGHT (OCCT 324.99248). So the web
build and the Node build of the same engine source are not the same to the last digit on every solid, which the 1e-9 comparison of this report
would otherwise hide.

**Together**, the 2900 generated documents (1400 old, 1500 new): 2740 final solids judged; 2564 RIGHT by every oracle that built; 130 with one
oracle agreeing; 35 that agree with a volume worked out by hand; 4 where OCCT's volume agrees and its solid sits the other way; 7 cylinder walls
within tolerance of the volume and not of the box. Nothing built wrong was found.

## The OCCT referee reads the options of a pull and a pocket (owner chose it, 2026-11-13)

`packages/brep-adapter/src/occt-build.ts` built every pull as a plain prism above its sketch and every pocket as a plain prism below it. It now
builds what the document says (ExtrudeFeature and PocketFeature in `packages/script/src/model-types.ts`):

- a pull: `reversed` (the other side of the sketch plane), `midplane` (half either side; it wins over `length2`), `length2` (a second length the
  opposite way), `taper` (the walls lean outward as the pad lengthens for a positive angle; a round wall becomes a cone);
- a pocket: `reversed`, `midplane`, `length2`, `through` (to the far side of the solid in the direction it cuts, whatever `depth` says), `taper`.

What it still does not build it now **refuses by name** instead of building the plain prism: a custom `direction`, a taper together with a
two-sided or through sweep, and `through` together with a two-sided one. The harness counts a refusal as an oracle that says nothing, which is
what it is. A document with none of these options builds as before (the same calls with the same arguments), so the frozen gates see no change.

Tests: `packages/brep-adapter/test/occt-sweep-options.test.mjs` (12, on the real kernel, each option against a volume and a box worked out by
hand: for example a 24 x 20 outline with one corner rounded r 3, pulled 20 at a taper of 5 degrees, 11155.907; a through pocket from the mid
plane of a box in each direction, and which half is missing). Against the referee as it was, 11 of the 12 fail.

**The 2740 final solids scored again** (`old-seeds/rescored.jsonl`, `new-seeds/rescored.jsonl`: the verdict before and after):

| | before | after |
|---|---|---|
| RIGHT: every oracle that built agrees | 2564 | 2695 |
| one oracle agrees and the other does not | 130 | 27 |
| flagged WRONG | 41 | 13 |
| both oracles refuse | 5 | 5 |

Every solid that was RIGHT is still RIGHT (2564 of 2564), and no verdict moved away from RIGHT. 107 rows where only brep-rs agreed and 24 that
had only a volume worked out by hand (23 flagged WRONG and one reversed pull) are now RIGHT by OCCT as well; 4 flagged WRONG are now split, with
OCCT agreeing and brep-rs not (reversed pulls whose rounded or bulged outline brep-rs gets 8e-4 or more off). What is left:

- 27 split: brep-rs agrees in 19 (none has a pull or pocket option: a hole after a hollow, a mirror or a pattern, a hole in a prism or
  cylinder, a hollowed ball, a draft after a move), OCCT agrees in 8;
- 13 flagged WRONG: 7 are the cylinder wall's accuracy (above); 6 agree with a volume worked out by hand and OCCT is 1e-4 to 0.54 off: two
  hollows after a counterbore, a counterbore along y after a draft, a hollow with a hole and a drafted wall, a pocket into the wall of a
  hollowed join (OCCT does not hollow the join at all), and a through pocket at the edge of a disc (OCCT agrees to 9.9e-5 in volume now and
  misses the box by 5.8e-4, the cylinder's accuracy again);
- 5 hollows that both oracles refuse and that equal their closed form.

So the referee's remaining blind spots on these documents are a hollow after a counterbore, a counterbore after a draft and a hollow of a
join; they are listed, not fixed. One limit of the change itself: after a reversed pull, a step that names the pull's "top" or "bottom" cap
resolves on the referee by the sweep's own start and end, which may not be the end the script means. No row in the 2740 moved away from RIGHT,
so none shows it; it is not excluded.

Checked: `npm test` 1121 tests, 1115 pass, 6 skipped, 0 fail.

## The referee's remaining gaps (owner chose it, 2026-11-13)

The rows still resting on one oracle or on a hand-worked volume came down to three more things the OCCT referee did, and one the harness did:

- **It read no counterbore and no countersink.** Every hole was drilled as its plain bore. It now cuts the recess as one spun outline with the
  bore (HoleFeature: from the mouth inwards; the mouth is the +axis face, where the bore starts for a blind hole and the part's own face for one
  that runs through), on each drill axis and for a four-hole pattern. A recess it cannot make sense of (both kinds at once, a counterbore not
  wider or not shallower than its bore, a countersink without `angleDeg` or with a cone as deep as the hole) is refused by name.
- **A whole-body draft tilted some of the walls.** It tilted one face at a time, taking the faces from the ORIGINAL solid; after the first face
  its neighbours were new faces and were skipped without a word. A 40 x 20 x 10 box came back with two walls tilted of four and its volume
  unchanged: 8000, where the form is 8023.932. All side faces are now tilted in one draft, and when the kernel will not take them all the
  feature is refused instead of done on some.
- **The neutral plane of a draft ignored `neutral` unless the pull was along z** (the plane was put at (0, 0, neutral) whatever the pull). It is
  now at `neutral` along the pull.
- **The harness scored a step built on a refused one.** The referee leaves a refused step's part as it was ("shown without it") and builds the
  next step on it. A hollowed ball, refused, then moved, came back as the whole ball and was taken as OCCT's answer. In the harness used here
  (`new-seeds/harness.diff`) a refusal of the measured step or of any step it rests on is now the oracle saying nothing. The rig's other
  harness copies do not have this yet.

Tests: `packages/brep-adapter/test/occt-sweep-options.test.mjs`, now 23 (11 more: a counterbore on each axis and on a blind hole, a countersink
at 90 and 60 degrees, four holes with a recess each, the refusals; a whole-body draft of a box, moved, turned, off its neutral plane, of a
cylinder; one face with the pull along y). The two frozen gates run against the changed referee as they did before: parity 78 of 78 with the
same output but for one last digit, mesh 78 of 78.

**The 2740 final solids, at each stage** (`old-seeds/rescored.jsonl`, `new-seeds/rescored.jsonl`):

| | the referee as it was | with the pull and pocket options | with the hole recess, the draft and the harness fix |
|---|---|---|---|
| RIGHT: every oracle that built agrees | 2564 | 2695 | 2715 |
| one oracle agrees and the other does not | 130 | 27 | 9 |
| flagged WRONG | 41 | 13 | 9 |
| both oracles refuse | 5 | 5 | 7 |

No verdict moved away from RIGHT at either stage. The 25 that are not a plain RIGHT now:

- 9 split, and in all nine it is OCCT that agrees and brep-rs that does not (a hole after a draft or a move of a cylinder or box, a pocket in a
  drafted cylinder, reversed pulls of an outline with a round or a bulge). brep-rs is archived and is not changed.
- 8 flagged WRONG that are the cylinder wall's accuracy: both oracles agree with each other, the volume is within 1.9e-4 and the box is not
  within the harness's 3e-4 (which is relative to the coordinate: up to 8.5e-4; in millimetres up to 1.3e-3).
- 1 flagged WRONG that is a difference of meaning, already on record: a hollow after a counterbore (`fc combined seed 476`). The page route's
  1599.523 is the plane-offset hollow, the reference HALT-7.md fixed with its own oracle (closed form 1599.527); OCCT's 1593.760 rounds the
  wall at the inside corner of the recess, 0.36% away, inside the 0.25 to 0.8% that report measured between the two.
- 7 hollows that both oracles refuse and that equal their closed form (three walls of half the part's thickness, a box with a cross bore, a
  mirrored pair, a join with a pocket in its wall, a counterbored box).

So OCCT now agrees with the page route on 2724 of the 2740 (the 2715 and the 9 where brep-rs does not). The 16 others are the 8 cylinder
walls, the hollow after a counterbore, and the 7 hollows it refuses. What the referee still does differently from the page route is a hollow at
an inside corner: it rounds the wall there, where the plane offset is sharp.

Checked: `npm test` 1132 tests, 1126 pass, 6 skipped, 0 fail.

## The other corpora with the fixed referee, judged on what they build (owner chose it, 2026-11-13)

The three corpora that are not generated documents: holes (357 rows), hollows and drafts (`sd`, 1097) and moves and turns (`mt`, 1930), 3384 rows,
through the Node host route with the fixed referee and harness (`other-corpora/`).

**As written.** No verdict differs from the last recorded sweep: 1357 RIGHT, 2026 REFUSED and one known PIPELINE-DIFF, row for row. (Many of
these rows are judged by a reference stored with the case, not by the live referee: all 623 RIGHT rows of `sd` are, so the referee's fixes
could not move them.)

**Cut down to the built steps.** 1952 of the 2026 REFUSED rows build something before the refused step; that had never been judged. Cut down,
3310 final solids are judged (74 rows build nothing):

| 3310 final solids | holes | sd | mt |
|---|---|---|---|
| judged | 357 | 1089 | 1864 |
| RIGHT | 356 | 1089 | 1861 |
| of the 1952 judged for the first time, RIGHT | 155 of 155 | 466 of 466 | 1328 of 1331 |
| not RIGHT | 1 | 0 | 3 |

- The three in `mt` are a cone moved twice and moved or turned again (two rows are the same script): 1.8e-4 low in volume against both oracles,
  which is inside the tolerance, and 3.4e-4 to 3.7e-4 off in the box (the harness's relative measure; the same in millimetres here), which is
  just outside 3e-4. The cone's wall, like the cylinder's.
- The one in holes is `cb-seq-apart`, flagged in the last sweep too: two counterbored holes, built 30693.220; OCCT and brep-rs both give
  30693.097 (4e-6 apart), and the form for two such holes is 32000 - 2 x 653.451 = 30693.097. It is flagged because the closed form stored
  with the case, 31346.610, is the part after the FIRST hole. A fault of the case table, not of the build.

The page's final volume for the whole row (the page run above) equals the judged solid in 3309 of the 3310; the other is the row the page
refuses for a dimension over 1,000,000 mm.

**All corpora together.** 6050 final solids judged on what they build (2740 from generated documents, 3310 here): 6021 RIGHT by every oracle
that built, 9 with OCCT agreeing and brep-rs not, 11 curved walls (8 cylinders, 3 cones) inside the tolerance on the volume and outside it on
the box, 1 hollow after a counterbore where OCCT rounds the inside corner, 7 hollows both oracles refuse that equal their closed form, and 1
case with the wrong closed form stored. Nothing built wrong.

**Correction, 2026-11-13.** Three places above gave the box difference of the cylinder rows in millimetres from the harness's own figure, which is
relative to the coordinate (`|a - b| / max(|b|, 1)`), not a length. Measured in millimetres the eleven curved-wall rows are 3.2e-4 to 1.3e-3 off
in the box; the three places now say so. The verdicts and the classes are unchanged.

## 1500 more new documents, with the harness from the repo and the fixed referee (owner chose it, 2026-11-13)

`combinedDoc` 1100 to 1599, `rgCombinedDoc` and `fcCombinedDoc` 900 to 1399, in the real page as shipped and through `../sweep/score-built.sh`
(`fresh-seeds-2/`). The first such run found two faults of the page and five of the referee; this one looks for what is left.

**The page.** Every document answered. The engine stopped once (`rg combined seed 1215`, the pocket of the first run's `fc combined seed 215` in a
new document): the crash guard refused that pocket in its sentence and the run went on. 1407 documents took under 5 s, 76 from 5 to 30 s, 17
from 30 to 120 s (the slowest 86 s); none longer.

**The page against Node, step by step.** 1497 of 1500 identical. Two are Node at the 45 s budget: a hole into a hollowed cylinder that the page
built in time and Node stopped (run again in Node it is built, in 44.8 s, with the page's volume to the last digit), and a countersink for which
Node gave the budget's sentence and the page the hole's own. One is another reason for the same refused draft, as in the first run.

**What was built.** 1418 final solids judged (82 documents build nothing); the page's final volume equals the judged solid in all 1418.

| 1418 final solids | count |
|---|---|
| RIGHT: every oracle that built agrees | 1407 |
| OCCT agrees and brep-rs does not | 4 |
| flagged WRONG: a curved wall inside the tolerance on the volume and outside it on the box | 4 |
| both oracles refuse a hollow, and it equals its closed form (4100, 1860, 2705.469) | 3 |

No wrong solid, no new class, and nothing that rests on brep-rs alone or on a hand-worked volume except the three hollows the oracles refuse.
Of the four curved walls, three are the cylinder with a pocket or a cut seen before (the box 4e-4 to 1.1e-3 mm off). The fourth is the largest
box difference so far: `combined seed 1489`, a five-sided prism hollowed with its top open and a cross bore of 6 through the rim. Its volume is
5.2e-6 from OCCT's, and its box is 8.4e-3 mm higher than the part (6.0084 for 6). That is the engine's measured box, not material: cutting
away everything above z = 6 in the page leaves the volume the same to the last digit (1860.5959274237866), while cutting above 5.9 and above 5
takes 10.11 and 100.21 off (`fresh-seeds-2/above-the-top.mjs`, `.txt`). brep-rs refuses the hole.

Against the first run of new documents (1411 solids): 1316 RIGHT, 75 resting on one oracle, 19 flagged WRONG. The difference is the referee and
the harness, not the layer: the layer and the page are the ones of that run but for the cylinder pick fix.

