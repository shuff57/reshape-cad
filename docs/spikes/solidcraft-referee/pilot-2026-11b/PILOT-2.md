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
