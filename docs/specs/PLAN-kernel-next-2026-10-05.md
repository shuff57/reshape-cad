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

**W2. General sphere booleans: sphere x box, cylinder, sphere (about 160 pair scripts, 935 sphere booleans in all families).**
Plane x sphere is a circle and sphere x sphere is a circle, so the curves exist; what is missing is a sphere face trimmed by several
arcs and a mesher for it. The new `sphere_hull.rs` triangulates a sphere with any number of holes given their loops and an inside
test (it needs no pole), which is exactly that. A sphere is isotropic so its frame can be chosen freely. Scope in slices: (a) one
plane cutting a ball at any orientation (a cap or its remainder); (b) a box against a ball (several planes, circles that meet on the
box's edges: arc-bounded regions); (c) a cylinder against a ball; (d) ball x ball. Start with a pre-check on what S4h already
covers (`SPEC-brep-boolean-split-classify.md` status line) and read how the 322+444 sphere records distribute over (a)-(d).
Derived, not verified: that the arcs-with-corners boundary can use the hull mesher unchanged (the conformity argument assumes a smooth
densely sampled boundary; corners need the corner vertex on the loop, which it is).

**W3. Cone booleans (about 270 pair scripts, 506 in other families) and holes in a cone (505).** Cone x plane is a conic (ellipse,
parabola or hyperbola), cone x cylinder and cone x sphere are quartics. This needs new curve types and is the largest item; the
sphere track's pattern (a `Curve` variant, a `Cross`-style wall, an exact box, a mesher, STEP by a fitted spline, a closed-form net)
is the template. Do after W2 so the arcs-with-corners mesher exists.

**W4. Holes in a torus (the "ring" shape): 560 of the 1,539 generic hole refusals.** Derived, not verified: a bore parallel to
the torus's axis meets it in a curve that is a graph over the bore's own angle (on the cylinder `rho(phi)` is known, so
`z = +-sqrt(a^2 - (rho - R)^2)`), the same shape as `Curve::SphCyl`, so the sphere pattern applies. A torus face is not a sphere,
so the hull mesher does not: use a (u, v) triangulation with holes (`earcutr` is already a dependency). Holes across the tube
(`along: 'x'`) are a different, harder curve.

**W5. Successive bores that meet (237 hole-only scripts).** A second bore through the first inside a box or cylinder: planar faces
plus a cylinder face cut by a perpendicular cylinder. `Curve::CylCyl`, the cylinder cross bore and `cylinder_pair_boolean` exist for
cylinder x cylinder; the planar-with-bored-cylinder case is the gap. This is also the crossing-bores case (a cross-drilled ball)
the sphere track could not reach.

**W6. Hollow beyond box and cylinder (275 scripts).** Sphere (34) is a concentric cavity (`subtract_enclosed` exists), a ring is a
concentric torus, and a prism or wedge is a planar inward offset. A cone is an offset cone.

**W7. Script-level errors (1,654 scripts, 11 %), an owner decision, not kernel work.** `turn()` refuses a shape that is not directly
a primitive (539: after a hole, fillet, combine or mirror), "Repeat Around spins copies about the middle of the world" (224), and
"hole() cannot find how thick this combine is" (340). A rotation of a derived solid is an exact kernel transform, so the first is a
policy choice; ask before changing the language.

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
