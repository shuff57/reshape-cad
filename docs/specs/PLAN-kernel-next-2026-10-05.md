# PLAN — brep-rs kernel: what to build next, from the 2026-10-05 census

Written at the end of a long session so a fresh one can start without the history. Everything below is measured unless it says
"derived" or "not verified". The raw numbers come from `docs/specs/prototypes/census/` (rerun them, do not trust this file past the
date). Read `AGENTS.md` first (the "never return a wrong solid, refuse in a sentence" rule is the contract), then this.

## 1. Where `main` is

`main` is at `4ddc115` (15 commits ahead of `origin/main`, nothing pushed: pushing is the owner's call). This session added, all
merged, all in `docs/specs/`:

| Spec | What |
|---|---|
| `SPEC-brep-soundness-guards.md` | G1 closure guard, G2 sphere/torus soundness, G3 surface table test, H7 (all done) |
| `SPEC-brep-boolean-split-classify.md` | the planned replacement for the failed K1a (spec only here; its S1/S2 are recorded as built in `docs/PLAN-next.md` sections 19-20) |
| `SPEC-brep-sphere-offset-bore.md` | S1 to S4: one off-centre bore in a sphere, through or blind, `e <= r` included, STEP export |
| `SPEC-brep-sphere-multi-bore.md` | up to four disjoint parallel bores, and the spherical Delaunay mesher (`sphere_hull.rs`) |

The sphere-bore track is finished and at diminishing returns (see section 3). The working tree has other agents' uncommitted files
(`docs/PLAN-next.md`, `packages/script/src/reshape-docs.ts`) and unmerged branches (`git branch` shows `fix-g1-g6`, `fix-g2-g3`,
`audit-2d`): check `node agent-evo/bin/msg.mjs owners` and `git log main..<branch>` before touching what they hold.

## 2. The census (seed 1, 15,000 scripts, current `main`)

`bun wrong-solid-sweep-driver.mjs` over eight families, via `docs/specs/prototypes/census/run-sweep.sh`:

| class | scripts |
|---|---|
| brep-rs wrong solid | **0** |
| REFUSED (honest sentence) | 7,977 (53 %) |
| SCRIPT-ERROR (the language, not the kernel) | 1,654 (11 %) |
| AGREE with OpenCascade / closed form | 5,253 |
| OpenCascade-side: refused 90, wrong 13, hung 10, suspect grid 3 | 116 |

Refusals by capability (`census/buckets.py`, one bucket per script by its first sentence):

| scripts | bucket |
|---|---|
| 1,539 | hole, generic sentence (no sphere or cone) |
| 935 | boolean involving a sphere |
| 606 | boolean, other pairs (wedge, prism, cylinder, box) |
| 506 | boolean involving a cone |
| 505 | hole in a cone |
| 435 | recess wider than the part |
| 333 | hole in a sphere (what is left after S1-S4 and multi-bore) |
| 302 + 265 + 229 | round/chamfer: flat edge, edge that is not plain, edge not found |
| 275 | hollow of anything but a box or straight cylinder |
| 269 | pattern whose copies overlap |
| 224 + 201 | hole reaching a rounded face; hole across a round part (limits) |
| 167 | boolean involving a torus |

### Three corrections this session had to make (read before trusting any count)

1. **The sphere "255 several-bore scripts" were 34** once scripts with a recess were removed (they refuse on the recess anyway),
   and only **2** were parallel and disjoint. A "recess" census of 63 was 21 once limited to the 0.95 R rule. Always filter a
   bucket to what the next slice can actually reach before quoting it.
2. **The pair family places the second solid touching the first.** So `keep` (intersect) of two shapes is very often genuinely
   empty. Asking OpenCascade for the result of each of the 766 refused pair scripts: **322 are empty** (an honest refusal with a
   misleading sentence: "an unsupported surface pair") and **444 are real gaps**.
3. **OpenCascade is not always right.** It centres a later blind hole on its own box of the bored part (shrunk by an earlier
   pole-swallowing blind bore) and cuts it at the wrong height; the referee code is off-limits (`AGENTS.md`), so use the closed form
   as the oracle whenever there is one.

### What the 444 real pair gaps are

Every one involves a sphere or a cone. Plane/cylinder booleans are essentially done (box x cylinder, either order: 15 real gaps in about 300 scripts):

| pair | join | cut | keep |
|---|---|---|---|
| cone x sphere | 49 | 39 | 17 |
| cylinder x sphere | 42 | 23 | 8 |
| box x sphere | 28 | 34 | 19 |
| box x cone | 28 | 21 | 32 |
| cone x cylinder | 17 | 21 | 24 |
| cone x cone | 5 | 9 | 6 |
| sphere x sphere | 6 | - | 1 |

### Hole-only scripts with two or more holes (637 refusing; `census/hole-interactions.mjs`)

237 build each hole alone but refuse together (bores that meet: 220 on a box, 14 cylinder, 3 prism): the **successive-bores**
class. The other 400 have one hole that cannot be cut alone: ring (140), cylinder (106, mostly countersinks), wedge (83), prism (64),
box (47).

## 3. The next slices, ranked

**W1. Say "nothing is left", not "unsupported surface pair" (small).** 322 of the 766 refused pair booleans (the same wording
appears in the csg family) are non-overlapping or touching solids. Detect it (disjoint or merely touching boxes first; the
tolerance-aware test the join path already has for "only touch along a line"), and refuse with the true sentence: "the two shapes do
not overlap, so keeping their overlap leaves nothing". A pre-check: how many of the 322 have separated or touching boxes (the
rest need an exact test). This is a refusal-wording fix, not a capability, and it changes what students are told. Do it first: a day,
and it makes every later census cleaner (the "real gap" numbers stop being diluted).

**W1 result (1930aea):** the exact-reach-box test rewords 196 of the 249 refused empties in the pair family (seed 1, 1500 scripts). 53 `keep`
refusals are still empty by OpenCascade but have overlapping boxes (e.g. sphere x far cylinder); they need a per-surface-pair exact test, so
they stay as "unsupported" and fold into W2/W3. The real gaps left in the pair family: 166 join, 151 cut, 107 keep.

**W2. General sphere booleans: sphere x box, cylinder, sphere (about 160 pair scripts, 935 sphere booleans in all families).**
Plane x sphere is a circle and sphere x sphere is a circle, so the curves exist; what is missing is a sphere face trimmed by several
arcs and a mesher for it. The new `sphere_hull.rs` triangulates a sphere with any number of holes given their loops and an inside
test (it needs no pole), which is exactly that. A sphere is isotropic so its frame can be chosen freely. Scope in slices: (a) one
plane cutting a ball at any orientation (a cap or its remainder); (b) a box against a ball (several planes, circles that meet on the
box's edges: arc-bounded regions); (c) a cylinder against a ball; (d) ball x ball. Start with a pre-check on what S4h already
covers (`SPEC-brep-boolean-split-classify.md` status line) and read how the 322+444 sphere records distribute over (a)-(d).
Derived, not verified: that the arcs-with-corners boundary can use the hull mesher unchanged (the conformity argument assumes a smooth
densely sampled boundary; corners need the corner vertex on the loop, which it is).

**W2 status (2026-10-05): slices (a) and (b) DONE, see SPEC-brep-ball-box.md.** A ball against a box at any orientation builds for
intersect, union and both subtractions; pair family 734 to 789 agree (with W1 and W8 included), full census 0 wrong. Open: (c) cylinder x ball
and (d) ball x ball, which need the cylinder-sphere quartic (a new spec). Method note that mattered: P0, the stop-rule prototype, found
the mesher's one real problem (a small patch with a huge hole) before any kernel edit; the full census then caught a bounding-box
mismatch that unit tests missed.

**W3. Cone booleans (about 270 pair scripts, 506 in other families) and holes in a cone (505).** Cone x plane is a conic (ellipse,
parabola or hyperbola), cone x cylinder and cone x sphere are quartics. This needs new curve types and is the largest item; the
sphere track's pattern (a `Curve` variant, a `Cross`-style wall, an exact box, a mesher, STEP by a fitted spline, a closed-form net)
is the template. Do after W2 so the arcs-with-corners mesher exists.

**W3 status (2026-10-06): S0 DONE, see SPEC-brep-cone-booleans.md.** Of 268 real cone gaps in the pair family, 99 needed no curve (a cone clear of, inside, or holding a ball, cylinder, box or cone); an exact convex-body test (GJK direction, proved by support functions; containment by closed forms) builds them: pair family 830 to 921 agree. 169 genuinely need conics or quartics (box 63, cylinder 49, sphere 45, cone 12); cone x box is next because it is conics only.

**W4. Holes in a torus (the "ring" shape): 560 of the 1,539 generic hole refusals.** Derived, not verified: a bore parallel to
the torus's axis meets it in a curve that is a graph over the bore's own angle (on the cylinder `rho(phi)` is known, so
`z = +-sqrt(a^2 - (rho - R)^2)`), the same shape as `Curve::SphCyl`, so the sphere pattern applies. A torus face is not a sphere,
so the hull mesher does not: use a (u, v) triangulation with holes (`earcutr` is already a dependency). Holes across the tube
(`along: 'x'`) are a different, harder curve.

**W4 pre-check result (2026-10-06, census seed 1, hole and holes families, 342 refused scripts on a ring, 610 holes that refuse alone).**
The premise above (a bore parallel to the ring's axis, a graph over the bore's angle) matches almost nothing the generator produces. By the
HARDEST hole in each script: **across the tube (x or y bore) 150**, **straddling one edge of the tube footprint 93**, **engulfing the
whole footprint 29**, **only missing the ring 68**, **wholly within the tube footprint (the clean case the design was derived for) 2**.
A hole's footprint here is its widest part about the ring's axis, a counterbore or countersink mouth included. So most z-bores are wider
than the tube, and a student drilling a ring would drill across the tube or down into it, which are the two hardest classes. **Do not
build W4 as planned**; the sphere track's pattern covers 2 scripts. What was cheap: the 68 are honest empties (a bore standing in the
ring's empty middle or beyond its outer edge takes no material) that said "cannot cut this hole yet". `tools_apart` was a bounding-box
test, and a ring fills its box far less than a block does; it now also asks `ops::radial_range_about` for the tool's exact nearest and
farthest distance from the ring's axis (cylinders, cones and circular caps about a parallel axis) and compares it with the torus's inner
and outer radii. 79 ring scripts now say "does not touch the part, so it cuts nothing" (0 before); class counts unchanged, cargo 515, gates
78/78/77+1/17. Test: `a_bore_clear_of_a_ring_says_it_cuts_nothing`, which also pins that a counterbore mouth reaching the tube, a bore in
the tube and a bore across it are not called misses.

**W5. Successive bores that meet (237 hole-only scripts).** A second bore through the first inside a box or cylinder: planar faces
plus a cylinder face cut by a perpendicular cylinder. `Curve::CylCyl`, the cylinder cross bore and `cylinder_pair_boolean` exist for
cylinder x cylinder; the planar-with-bored-cylinder case is the gap. This is also the crossing-bores case (a cross-drilled ball)
the sphere track could not reach.

**W5 pre-check result (2026-10-06, census seed 1, the 220 hole-only box scripts that build each hole alone and refuse together).** 218 reduce
to a failing PAIR of holes (2 need four together). Measured with OpenCascade (overlap = V(box) + V(both) - V(hole 1) - V(hole 2)):
**191 pairs genuinely MEET** and 27 do not overlap at all yet still refuse. Of the 191: perpendicular crossings 154 (a z bore with an x bore
53, with a y bore 82, an x bore with a y bore 19), parallel overlapping bores 37 (z+z 33, y+y 3, x+x 1). The hole forms are everywhere
(plain, counterbore, countersink, through, blind), so no one combination dominates. What builds today (probed): a through bore crossing a
through bore with INTERSECTING axes (centred); two overlapping parallel z bores. What refuses: the same crossing with the axes OFFSET (skew;
generic sentence) and a BLIND crossing bore ("this cut crosses a bore wall of the part", specific sentence). The sweep places holes at random
offsets, so almost every script is skew or blind. `Curve::CylCyl` has no axis offset (`center, d, n, a, big_r, r, sign` only), so skew needs
a new curve exactly as the sphere track's `SphCyl` did, with a `Cross`-style wall for each face; the sphere offset bore took slices S1 to S4h.
A cross-drilled hole is a routine student operation, which makes this the most realistic gap the census has shown. The 27 non-overlapping
refusals are a different, probably cheaper, problem (a counterbore or countersink beside a side bore) and are not yet looked at.

**W5 follow-up on the 27 non-overlapping refusals (2026-10-06): they are NOT one cheap problem.** OpenCascade confirms all 27 have exactly
zero volume overlap (|overlap| under 1e-10). One mechanism was found and fixed: a stepped tool (shaft cylinder plus countersink cone) beside
an earlier bore refused with "the u-clip arithmetic is only valid for cylinder tools" (`ops.rs`, the cylinder arm of `process_face`) even
when the cone could not touch that bore's wall, because `ConeCyl::Clear` set `saw_cone`. A new `ConeCyl::Apart` (no shared axial band, or the
wall outside the cone's widest circle) no longer sets it; a test (`a_countersink_beside_a_bore_it_does_not_reach_builds_exactly`) pins the
exact volume and that a funnel which does reach the bore still refuses. **It moved 0 of the 27 and the census by 1 script**: each of the 27
is stopped by a different guard (counterbore beside a side bore, countersink beside a counterbore, a bore through two side faces), and the
random generator rarely produces the clear-funnel case the fix covers. Not a bucket to chase; fold whatever remains into the skew-crossing work.

**W5 sizing (2026-10-06, the 218 pairs that reduce to a failing pair).** 170 are perpendicular crossings and 48 parallel. Of the perpendicular
ones: 63 are plain bore on plain bore, 85 have one recess (counterbore or countersink), 22 have two. By geometry, the smaller bore fits
inside the larger one's silhouette (the meeting curve is closed loops, a graph over the small bore's angle) in 87, and sticks out of it in
81 (a curve that runs onto the larger bore's wall edge at tangent points); 2 axes are too far apart to meet. Bore ends are mostly BLIND
(about two thirds of the pairs have at least one blind end), and in 59 the axes' crossing point lies outside one bore's length. So no one
regime dominates, and a first slice (plain on plain, closed loops, both ends past the crossing) would reach about 20 to 30 pairs, roughly
2% of the hole-only scripts, for a build the size of ball x box. The meshing is not the risk (each face is a ladder of columns over one
angle, as the cone x box P0 showed); the risk is the number of cases: faces, trims and the `Cross` machinery for each of through, blind,
pierced and sticking-out. **Recommendation: do not start W5 before the owner has said whether cross-drilling is a priority**; the same
effort on W7's language choices (11% of scripts) is worth more, if the owner agrees to them.

**W6. Hollow beyond box and cylinder (275 scripts).** Sphere (34) is a concentric cavity (`subtract_enclosed` exists), a ring is a
concentric torus, and a prism or wedge is a planar inward offset. A cone is an offset cone.

**W7. Script-level errors (1,654 scripts, 11 %), an owner decision, not kernel work.** `turn()` refuses a shape that is not directly
a primitive (539: after a hole, fillet, combine or mirror), "Repeat Around spins copies about the middle of the world" (224), and
"hole() cannot find how thick this combine is" (340). A rotation of a derived solid is an exact kernel transform, so the first is a
policy choice; ask before changing the language.

**W7 decisions and result (2026-10-06, owner answers).** (1) `turn()` is allowed on a built-up shape (the result of a hole, round, join or cut,
mirror, pull): a new feature kind `rotate { target, angles }`, in place about the centre of the target's bounding box (X then Y then Z, as
a primitive's own `rotate`), consuming its target like a move; the script writes it back as `turn(v, [rx, ry, rz])`. Built in the script
package (model-types, interpreter, emitter, parameter sliders), brep-rs (`"rotate"` beside `"move"`, with an OpRecord so names carry through),
the OpenCascade referee (one composed transform about `AddOptimal`'s box centre) and the studio's timeline line; the coverage matrix gained
the kind. A hole drilled AFTER such a turn still says "cannot find how thick" (the range function answers null for the new kind), by design.
(2) `turn()` on a ball is accepted and changes nothing. (3) `repeatAround`'s "nothing to spin around" now names the fix,
`move(shape, [30, 0, 0])`. **Census: script errors 1,654 to 997; agree 5,035 to 5,217 and analytic-only 465 to 494; refused 7,731 to 8,171 (the
newly reachable scripts that refuse for their other steps); no WRONG record for brep-rs.** 1,022 scripts call turn(): 285 agree with
OpenCascade (volume to about 1e-16), 627 refuse honestly for other reasons. The two countersink cases that read "analytic only" differ from
OpenCascade by 0.3 to 0.7 % with or without the turn: a standing difference in OpenCascade's countersink, not the turn.

**Found on the way, and fixed (2026-10-06): STEP export of a ball cut by a box.** The kernel suite had 12 real failures before the W7 work, all
about balls (and ten more that only fail under `bun test`'s default 5 s timeout, the suite having been written for `node --test`; give it
`--timeout`). The W2 ball x box work routes every ball-and-box boolean through `ball_box`, whose `SphTrim::Hull` sphere face the STEP writer
refused, so a ball sliced by one plane stopped exporting. Fixed in `step.rs`: (1) a hull face whose planes are all square to the sphere's axis
is written as the latitude zone or polar cap it is, through the existing zone writer (the part outside two planes is two caps, so two STEP
faces, `face_pieces`); (2) any other hull face is written from its own wires, turned the way the SURFACE faces when the face is reversed (the
wall of a cavity), in a frame chosen from the loops (`hull_frame`): both poles on the same side of the face, the best of pole clearance and the
seam's gap in longitude, refusing when neither is at least about 0.5 radian; (3) a face with one whole-circle loop AND one made of arcs
refuses, the one combination seen to read back wrong. **How it was found:** a randomized read-back (`step-ball-box.test.mjs`: tilted boxes
against a ball, four operations, every STEP read back by OpenCascade) showed OpenCascade reading several faces as the OTHER region of the
sphere, so some files described a different solid (a `join` reading back as 3,010 instead of 5,894). Hole width did not predict it (the wrong ones
were 21 to 55 degrees wide; correct ones reached 152); the seam gap and pole clearance did, and one mixed-loop combination remained. **Result:**
of 554 random cases, 488 write and read back, 66 refuse in a sentence, none reads back as another solid (410 of them a fresh sample the rules
were never tuned on). The STEP gate went from 77 passed + 1 refused to 78 passed. The read-back oracle gained a second opinion for these faces
(OpenCascade's own volume integral wanders by about 1e-5 and its 'optimal' box can reach past a face that is not a parameter rectangle, so the
meshed shape's extrapolated volume and box are accepted too, with the exact box still required to contain ours). Stale tests were corrected:
the box-sphere intersect entry (a closed form 2032 pi), the three ball-and-box cases that build (8000 + 272 pi, 8000 - 2032 pi, 2016 pi), a dome
on a plate is 7 faces (one sphere face holds both caps), a 0.1 deep bore in a sphere builds, and wording tests that now accept "do not overlap".
Kernel suite: 1,432 pass, 2 skipped, 0 fail.

**W8. Tangent walls: a box whose width equals a coaxial cylinder's diameter (12 of the 15 box x cylinder pair gaps).** Found while
checking W1. The box's four side faces touch the cylinder wall along a line each; join (8, box stacked on the cylinder) and cut (4, box
overlapping its end) are refused as "unsupported surface pair". Checked by volume against OpenCascade (first script: 25,014 + 13,997 =
39,011 vs OCCT 39,014), so the first argument of `cylinder()` is the diameter. A student can type this by hand (a square block that
exactly fits a round post), so it is likelier in real use than its 0.8 % of the sweep suggests. Not the same as the three "touch along
a line" box x cylinder refusals, which are two separate lumps in OpenCascade too and are correctly refused. Open: whether the plane-
cylinder intersection treats a tangent plane as a line (a degenerate conic) or as no intersection; that decides if this is a
classification fix or a new curve case. Pre-check before building: run the 12 and see which guard refuses.

**W8 scope widened by the W2 pre-check:** the same generator habit (box width = the round shape's diameter) hits spheres. 35 of the 81
box x sphere gaps are a ball tangent to the box's side walls at single points, and 10 of the 15 box x cylinder gaps are the tangent
cylinder case: 45 scripts in all. The 73 cylinder x sphere gaps have no equal-diameter cases. So W8 is bigger than W2 (b)'s non-tangent
remainder (46 box x sphere).

**W8 result, cylinder half (this commit):** a box stacked on a coaxial cylinder of the same width now joins and cuts exactly. Cause: the
box's bottom face splits at the four tangent points into four arcs, but the cylinder wall's rim stayed one whole circle, so the edges never
matched (every earlier guard was innocent; the refusal came from the edge-count check). Fix: `split_full_circle` in `split_t_junctions`
cuts a whole circle into arcs only when every piece is one a neighbouring face already has. A wider rule (any vertex on the circle, or any
partial arc of the circle) broke 20 tests and the mesh and STEP gates; the "every piece already exists" rule breaks none. Pair sweep: 734 to
743 agree, 0 wrong. **W8 correction, found by the full census (not by the pair sweeps):** the first version of the rim split built ONE wrong solid, perm
script 282 (a counterbored box, `repeatAround` 4, `mirror`): volume 0.6 % off OpenCascade and 240 open mesh edges, refused before W8. The
split fired on vertices where the pattern copies' edges CROSS the rim. Two guesses at a local test (every piece already exists; no
transverse edge at the vertex) both still passed it. What fixed it is evidence from the operands, not the result: `tangent_contacts(a, b)`
lists where a straight edge of one operand touches a circle of the other without crossing, and a rim is cut only there. Lesson for the
next slice: a pair-family sweep cannot see a bug that the perm family finds; run the whole census before calling a boolean change done.
Full census after the fix: 0 WRONG; agree 5,293 (was 5,253), refused 7,938 (was 7,977), script errors 1,654 (unchanged); gates 78/78/77+1/17.
No regression test pins script 282's shape yet (the case is only covered by the census and the W8 unit test).

**W8 result, sphere half:** a box exactly as wide as a ball builds when the ball touches its walls at the equator or a floor at a pole,
from inside (the ball on the solid side of the touching plane). Two causes, neither the circle-matching of the cylinder half: (1) the
planar path refused any plane that was not square to the axis unless clear of the ball, and a tangent plane is not clear but cuts nothing;
(2) the face classifier sampled the wall's centre, which is the tangent point itself, and read the boundary as "inside" (a wall that should
vanish was kept). Fix: a tangent plane or pole on the solid side cuts nothing; a sample on a ball's surface is re-read from four points a
millimetre away, which must agree. From outside, a tangent plate or pole still refuses (a union there is two lumps at a point; an existing
test pins it). Pair sweep: 743 to 764 agree, 0 wrong, and one new OCCT-WRONG (OpenCascade 12,057 vs the closed form 4,305.24 that brep-rs
matches to 12 digits). Still refused: a cut that leaves two lumps (the slab through a ball's middle) and a plane through the equator of a
ball that fits the box exactly (a circle through the face's edge midpoints, the cylinder case's cousin for a plane).

**W2 pre-check result:** of the 46 non-tangent box x sphere gaps, only 3 are cut by a single box plane (slice (a)); 2 are cut by none;
the other 41 cross 2 to 6 planes (8 two, 9 three, 14 four, 2 five, 8 six). So slice (a) alone moves about 3 sweep scripts: it is a
building block for (b), not a result. Plan (a) and (b) as one piece of work, with (a) as its first test.

**Not worth doing from this census:** "recess wider than the part" (435) and bevel/round of a sphere or other nonsensical edges
(302): the generator draws sizes and edges no student would, and the refusals are correct.

### Recommended order

W1 (a day, no risk, cleans the data) then W2 as the main work, in the slices above, with a pre-check first (the habit that paid
off all session: measure what the next slice can reach before promising a number, build the mesher or the closed form as a
standalone cargo test first). Then W5 or W4 depending on whether the owner would rather see crossing bores or torus holes.

## 4. How to work here (hard-won)

- **Environment:** `export PATH=$HOME/.cargo/bin:$PATH`. Rebuild the wasm before anything JS: `cd packages/brep-rs && wasm-pack build
  --release --target web --out-dir pkg`. The repo's `node` is a Bun shim: use `bun test`, `bun scripts/...`; `node --test` fails.
  Two coaxial sphere-cone tests (and about five others) time out at Bun's default 5 s on `main` too: not a regression.
- **Gates (lead-owned, never edit):** `node scripts/brep-parity-gate.mjs` (78/0), `brep-mesh-gate.mjs` (78/0), `brep-step-gate.mjs`
  (77/0/1), `npm run gate:occt` (17/0). Cargo is 499. Run the sweep alone (the machine idle): OpenCascade hangs under load.
- **Method that worked:** spec first (with the closed form or the oracle that does NOT share the kernel's algebra), then a pre-check
  prototype, then the builder with a closed-form safety net (`|got - want| <= 1e-9 V`), then tests that include a mutation check
  (break the thing the test claims to pin and watch it fail), then the sweep, then gates, then a spec "result" section. Two real
  latent wrong-solid bugs were found this way before they shipped (the S2 tool-end guard for `e < r`; the S3 bounding box).
- **Process traps:** stage explicit paths (`git add <file>`, never `git add -A packages`: a `node_modules` symlink from a scratch
  worktree once replaced the real ignored directory; memory `scratch-worktree-staging`). Other agents share the tree: do not mix
  their dirty files into your commits, and use a scratch worktree for anything long. A "tier-gate" hook warns on large inline writes:
  say in the reply why inline is the better call, then continue.
- **The owner likes multiple-choice questions and "merge when verified".** Ask which slice to take; do not assume.

## 5. Housekeeping still open

- Mirror the new refusal sentences into shCode's `reference.md` (owner decision #45).
- The `KNOWN_WRONG` mirror cells in the `surface_op_table` test (G3) could be cleaned up.
- If `packages/sandbox-dev` reports a missing dependency, run `npm install` at the root (the symlink incident deleted that
  directory's contents; the root `node_modules` covered it, but the loss is unverified).
- The 15 local commits are unpushed.

## Not verified

The W2 to W6 designs are derived from the census and the code read, not built; sizes are guesses. The tally of "real gaps" uses
OpenCascade's volume as the test for "non-empty" (it is the referee, with the box-centre quirk above, which does not affect an
empty/non-empty decision). Counts are one seed; a second seed would show how stable the ranking is.
