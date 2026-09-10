# FUTURE — reshape-cad

Parked work, newest first. Each entry says what was DECIDED and what is still
OPEN. Not a backlog of ideas: everything here has a measured reason for being
parked rather than done.

---

## 2026-09-09 — CI is live, and the two things deliberately left off it

**Decided and shipped.** The repo is published at
`github.com/shuff57/reshape-cad` (public) and CI runs `npm ci`, an ordered
build, and `npm test` on every push and PR. Green at `f2cf59b` in 21 s with
zero annotations.

It **failed on its first run**, on the step it exists for. `npm run build
--workspaces` builds in workspace order (kernel, script, sketch, studio) while
the dependency order is sketch → script → kernel → studio, so `kernel`
compiled first and could not resolve `@shuff57/reshape-script/model-types` —
`dist/` is gitignored, so on a fresh checkout the `.d.ts` did not exist yet.
Every *"implicitly has an any type"* error in that log was downstream of it.
It had passed on every developer machine because `packages/*/dist` was already
lying there from an earlier build, which is the whole argument for having CI at
all.

### Open — put the browser test in CI

`shCode/scripts/drive-point-rules.py` is the only thing that exercises the
rendered Point rules panel, and **nothing runs it automatically**. Putting it in
CI needs a dev-server step: start `npm run dev` on :3002, wait for the port,
run the script, tear it down. Two known traps are already recorded above and
both would bite a naive workflow — `.next` does not pick up changes through a
`file:` symlink, and stopping the shell does not kill `npm run dev`'s node
child, so the port stays held and a "restart" silently binds nothing.

It would also have to live in **shCode's** CI, not this repo's: the script, the
server and the Playwright install are all there, and shCode has no workflows at
all today.

### Open — TypeScript project references, but not yet

`tsc -b` with project references would **derive** the build order from the
dependency graph instead of the hardcoded chain now in the root `build` script.
That is the better end state and it is deliberately parked.

**Why parked:** CI already catches a stale order, from a clean checkout, which
is exactly how the order bug surfaced. So `tsc -b` currently buys redundancy
over an existing check, at real cost — `composite: true` changes `rootDir`
handling, and shCode's `build-brep-kernel.mjs` compiles these same sources with
its own per-package `--rootDir` that its header documents as deliberate and
fiddly. Rewriting four tsconfigs, with the risk landing in a second repo, to
re-derive an order that is already enforced, is a bad trade today.

**Revisit when the workspace grows past four packages**, or when a new
dependency appears among the existing four. That is when hand-maintaining one
line starts costing more than the rewrite.

**Correction on the record:** the trailer on `12c89fe` says of the hardcoded
order "nothing checks it". True when written, false ten minutes later — CI
checks it on every push. `f2cf59b` says so.

---

## 2026-09-09 — P1f dogfooded in a browser; the caveat is closed

`3a3be70` shipped with `Not-tested: NO BROWSER`. That is now resolved, and the
run found two things worth keeping.

**All three rule types work end to end**, driven through shCode's `/sandbox` in
reSHape Build mode on a fresh rectangle sketch:

| step | observed |
|---|---|
| Dist X, corners 1→3, value 12 | listed as `corner 1→3 across = 12`, draft cleared, Set re-disabled |
| Symmetric, 1 and 3 about 2 | listed as `corner 2 centred between 1 and 3` |
| Angle, edges 1 and 2, 30° | listed as `edge 1 ∠ edge 2 = 30°` |
| remove (×) on each | removed exactly that rule; list emptied; section still rendered |

**The solver actually honoured them** — the part a rules list cannot prove.
With Dist X = 12 and the symmetric both live, the Dimensions panel read corner
1 across **18**, corner 3 across **30** (exactly 12 apart), and corner 2 at
**(24, 4)** — the exact midpoint of (18, −10) and (30, 18) on *both* axes. The
sketch began as a 40×25 rectangle, so it genuinely moved.

**The conflict machinery works on the new kinds, and reads well.** Adding the
angle while the symmetric was live made `settle()` drop the symmetric and say:
*"Corner 2 no longer has to stay centred between corners 1 and 3 so edge 1 can
stay at 30° to edge 2. Undo puts it back."* That is what routing every write
through `settle()` was for. Removing the angle and re-adding the symmetric
kept it, confirming the drop was a real conflict rather than a failed write.

Degenerate refusal is live too: setting Symmetric's "about" corner equal to an
endpoint disables Set with *"The about corner has to be a third corner."*

**TRAP, and it cost the first half of the run.** The panel appeared to be
missing entirely: the Rules panel rendered with no Point rules section. Two
causes stacked.

1. **`traycer_stop_shell` did not kill the dev server's child.** `npm run dev`
   spawns `node server.js`; stopping the shell left it holding port 3002, so
   the "restarted" server failed to bind with `EADDRINUSE` and the browser kept
   talking to the ORIGINAL process. The restart looked successful.
2. **Next's dev cache does not pick up changes through a `file:` symlink.**
   `node_modules/@shuff57/reshape-studio` symlinks to `packages/studio`, and
   `.next/` held a chunk compiled before the change.

Diagnosed by fetching every loaded `.js` and grepping the served bytes: the
chunk contained `Rules between two edges` (the old panel) and not
`Point rules`. **That is the check to run first** — the DOM cannot tell a
missing feature from a stale bundle. Fix: kill whatever holds the port
(`Get-NetTCPConnection -LocalPort 3002`), delete `.next`, restart.

**NOW COVERED**, by `shCode/scripts/drive-point-rules.py` — a Playwright drive
script in the house `drive-*.py` style, 32 checks, ALL PASS. It replays the
session above: the four rows, the disabled tooltips, create/see/remove for all
three rule types, the degenerate refusal, the settle() conflict note, and the
solver measurements. Not in `npm test` (it needs a dev server on :3002 and
Playwright, which is installed under Python here, not node).

Proven able to fail: it failed four times while being written, and one of those
was a real defect.

**FOUND BY IT, AND NOW FIXED — `toScript()` used to THROW on three of the
four kinds.** Adding a `distanceX`, `distanceY` or `symmetric` rule made
`reshape-script-gen.ts:144` throw on every render of the Code view: six
pageerrors from one short session. `angle` did not — only the three that
reached `toScript` first.

The *gap* was known: the message was deliberate, and msgbox #140 flagged that
these four constraints had no reSHape Script word. What was NOT known is that
it surfaced as a repeated **page error the moment a student used the panel**.
The manual dogfood missed it because console errors were not readable in that
session; the drive script read them on its first run.

**Decided: give them words, not a skip** (`SPEC-P1g`). `.distX()`, `.distY()`,
`.symmetric()` and `.angle()` now exist on `SketchHandle`, and `toScript`
emits them. The alternative — skipping a constraint `toScript` cannot express —
was rejected because it is **silent data loss**: Build → Code would drop the
rule and Code → Build would rebuild the doc without it, in a path students take
constantly. shCode's `docsEqualUpToIds` deep-compares features, so a skip either
fails that suite or quietly loses work. The throw's own comment ("fail loud
rather than emit a call the interpreter cannot parse back") argued for adding
the word, not for skipping: making the call parseable dissolves the dilemma.

`distX`/`distY` rather than overloading `.across()`, which already means "this
edge is level" — `.across(3)` and `.across(1, 3, 12)` differing only by arity
is the kind of cleverness that produces an unreadable bug report.

**Measured after:** the drive script reports **zero** throws, and its allowance
is now a wall — any page error fails the run. reshape-cad `npm test` 41+9+10
unit plus 12 gate slices; shCode's round-trip suite 213/213.

**Two review findings on the P1g build, both cosmetic and both fixed by the
lead:** `symmetric` wrapped its `center` — a corner INDEX — in `num()` behind a
double cast, which claims a student could bind a slider to "which corner"; and
`sameConstraint` grew a cross-kind branch that `a.kind !== b.kind` at the top of
that function already made unreachable.

**Pre-existing, and NOT a P1g regression — worth knowing before it is
rediscovered.** A `distX` and a `distY` on the same corner pair cannot coexist
on a rectangle: `addConstraintSettling` drops one, because fixing both dx and dy
across a diagonal over-constrains it. Measured directly against the solver, and
it reports the removal through `removed`, so the panel shows its note. The
later rule wins, in either order.

**Still not covered.** `check-constraint-ui.mjs` remains a grep tripwire and
`point-rules.test.mjs` covers the writers, not the JSX; the drive script is the
only thing exercising the rendered panel, and nothing runs it automatically.

---

## 2026-09-09 — P1e: the ModelDoc/OCCT surface became testable

**Decided and shipped.** `pocket` is now a ModelDoc vocabulary word, and the
parity ledger reads **30/46 shipped, 5 queued, 11 refused** — the number
`SPEC-P1-parity-closeout.md` named as P1a's gate, met at last. All five
remaining queued entries are now parked by an explicit decision; there is no
open ledger item.

**The bigger thing, and it was not the word.** `packages/kernel/src/
occt-build.ts` had **never been executed in this repo**. Its kernel is
`replicad_single.wasm` — 23 MB, gitignored, fetched at runtime from
`getKernelBaseUrl()` by packages/studio — so nothing here called `buildDoc()`,
and every ModelDoc kind P1a added (`prism`, `wedge`, `groove`) shipped typed
and unproven. The msgbox carries the admission verbatim: *"packages/kernel has
no wasm dep, no test script … I have no browser/replicad harness available."*

Measured 2026-09-09: replicad's emscripten factory **initialises under plain
Node** given a `locateFile` pointing at the sibling `.wasm`, and the repo's own
`dist/occt-build.js` builds real solids against it. No browser, no container,
no new dependency. `scripts/occt-modeldoc-gate.mjs` is that harness, and it
passes **6/6**:

| slice | measured |
|---|---|
| harness live: extrude 20×10 by 5 | 1000.000 mm³ |
| `groove` (P1a, retro-gated) | 32000.000 → 30335.225 mm³ |
| `pocket` on `xy`, 10×8 cut 5 deep | 31600.000 mm³ |
| `pocket` on `xz` (where `PLANE_AXES.dir` is −1) | 31600.000 mm³ |
| `pocket` depth 10 | 31200.000 mm³ |
| end to end, from student script text | 31600.000 mm³ |

Proven able to fail: on `main` before the build it read **2 passed, 3 failed**.

**CLOSED, and it found a real one.** Retro-gating `prism` and `wedge` the same
day: **neither had ever built, and both were marked `shipped`.** The gate went
straight to 4 failures, all the same `BindingError: parameter 0 has unknown
type 8gp_Torus`.

Cause: `BRepBuilderAPI_MakeFace(wire)` with **one argument**. replicad's embind
bindings expose no single-wire overload, so the call falls through to the
surface-taking ones and reports the first it cannot match — `gp_Torus` — from
inside code that has nothing to do with tori, which is why it read as a kernel
mystery instead of a missing argument. Every other `MakeFace` in the repo
(`occt-build.ts:238,458,467`, `occt-api.ts:721`) already passed `false`; only
the prism and wedge branches did not. Swept the repo: those two were the only
one-argument call sites.

Worse than a broken feature: `buildDoc` **throws**, so one prism took the
entire document down with it. Measured — a doc holding a 40×40×20 box and a
prism returned no shapes at all. The inverse of this project's usual defect:
not "succeeded and did nothing" but "one feature destroyed everything."

The geometry underneath was always right. With the argument supplied, all five
shapes match closed forms derived from `model-types.ts`'s own field docs rather
than read back off the implementation: prism hex 5196.152, triangle 2598.076,
12-gon 6000.000; wedge 600.000 and 1440.000. Gate now **10/10**.

No ledger change: `prism` and `wedge` were already `shipped` and stay `shipped`.
The status was not wrong about intent — it was just untrue until today.

**The trap was already documented, in the same file, and still violated
twice.** `occt-build.ts:465-467` carries the note *"the single-argument
overload binds to gp_Torus in this build"* on `sketchFace()`. So this was known,
written down where the next reader would meet it, and the prism and wedge
branches were written wrong anyway. A comment is not a gate.

**CLOSED — `groove` now has an exact number.** `revolveProfileFace()` maps a
sketch point `(u, v)` with `a.u` and **`a.n`**, not `a.u`/`a.v`, so the profile
is laid in the plane *containing* the rotation axis. That makes the groove a
Pappus solid of revolution, and a rectangle spanning radius r0..r1 and axial
v0..v1 turned `deg` removes exactly `π(r1²−r0²)(v1−v0)·deg/360`.

Why no number was derivable before: the original fixture's ring (radius 10..15)
stuck out past the box's `z = ±10` faces, so the cut was a **clipped** ring
with no simple closed form. Moving the fixture to radius 4..8 — wholly interior
— makes Pappus apply unmodified. Three slices now: a full ring (30944.425), a
half turn that must remove half (31472.212), and a ring straddling the axial
origin (31321.416), because a fixture entirely on the positive side cannot tell
a correct height from one measured off zero.

**Gate now 12/12, and every ModelDoc kind is measured against a closed form.**
No "it changed" assertions remain.

**CLOSED — the harness no longer needs a kernel path it does not own.**
`replicad-opencascadejs` is a real npm package shipping the same emscripten
build, so it is now a **pinned devDependency** (`1.1.0`, exact) and `npm ci` is
all the gate needs. It resolves in order — `RESHAPE_KERNEL_DIR`, then the
package via `require.resolve`, then the shCode checkout — and prints which one
it used and that file's size. Wired into `npm test` at the root, and runnable
alone as `npm run test:occt`.

The two builds are **not byte-identical**, and that was checked rather than
assumed. shCode's deployed `replicad_single.js` is byte-identical to the
package's; the `.wasm` differs — sha256 `69974ca4…` vs `4c9f22e9…`, 22 970 161
vs 22 980 267 bytes. Ten kilobytes on twenty-three megabytes, with identical
glue, reads as a different patch version rather than a custom build. (It is
**not** the STEP-stripped binary `shCode/scripts/inspect-occt-wasm.mjs` prices
out; that was step one of a rebuild that was never done.) Measured: **all twelve
slices return identical volumes on both**, so the kernel build is not a confound
for anything this gate asserts. If a slice ever disagrees across the two, that
disagreement is itself the finding — which is why the gate names its kernel.

**Still open — there is no CI to run it in.** Neither repo has
`.github/workflows`. The wasm was the blocker and it is gone; adding a workflow
is now a small, separate decision about runners and triggers, not a technical
obstacle.

**Open, deliberately not fixed here — `dependsOn` cannot see `into`.**
`model-types.ts:460` returns `[f.target, ...named]`, so the solid a `groove` or
a `pocket` cuts into is not a tracked dependency: delete it and the cut keeps a
dangling reference. Pre-existing in `groove`; `pocket` inherits it by design,
because fixing it changes `groove`'s behaviour and belongs in its own slice.

**Corrected, on the record.** The spec's self-check demanded the parity checker
exit **0**. It cannot: `check-freecad-parity.mjs:176` exits non-zero unless
every non-refused entry is shipped, and five are parked by decision. Exit 1
with a clean 30/46 print is correct. The builder caught this and was right.

**A message-center failure worth pinning.** The builder's threaded reply never
reached `log.jsonl` — `handoff.mjs`'s reply-counting guard exited 1 on exactly
the silent shape it exists to catch. The full report survived on stdout, so
nothing was lost this time, but the log has a gap where the reply should be.
The guard earned its keep.

---

## 2026-09-09 — after P1c-3: two hazards left standing, one unexplained

**Decided and shipped** (`e9f66d3`): the six P1c buttons that never shipped,
plus guards for the two silent failure modes running them exposed — a sweep
that succeeds while changing nothing, and a helix that grinds instead of
refusing.

**Open, unexplained.** An **offset helix profile** grinds even when the pitch
rule is satisfied: a circle at (15, 0) r=2 with pitch 6.67 mm against a 4 mm
profile ran **14 minutes at 3.4 GB** in the container before being killed, while
the same parameters with the profile centred on the axis finish in seconds.
`helixPitchGuard` does not catch this because the pitch rule is not violated.
Not gated: a check that may never terminate is not a check.

**Open, decided against for now.** The volume-change guard is applied to the
four two-sketch sweeps only. `groove` and both helixes are the same defect class
— a feature that reports success and moves no material — but neither was
measured failing that way, and `additiveHelix` cannot be re-run cheaply enough
to verify a guard on it.

**Open, and the reason Pipe is awkward.** Pipe and Sub Pipe need the path sketch
on a **different plane** from the profile, and `Rect Sketch` / `Circle Sketch`
only make XY sketches. The only route to a second plane is picking a face and
using New Sketch. The buttons now say so when it goes wrong, but nothing guides
a student there beforehand.

---

## 2026-09-09 — P1d-2: construction toggle + Trim (shipped `d775f6d`)

**Decided and shipped.** Construction geometry and Trim now work through the
FreeCAD Sketcher bridge and Studio sketcher; `packages/` remains deliberately
untouched. The bridge emits the measured strict types — literal Python
`True`/`False` for `setConstruction`, and `App.Vector` for `trim` — reports the
construction flag in sketch state, and clears client selection after Trim
because IDs can shift.

**Measured.** Lead-owned `engine/bridge/p1d2-test.mjs` passes **2/2** in the
kernel container: construction flag off → on → off round-trips while retaining
the 16 mm line, and trimming the selected half of two crossing 20 mm lines
changes their total from **40 mm to 30 mm**. Browser dogfood against the real
wasm kernel passed: construction enabled for a selected shape and rendered it
dashed; Trim shortened the clicked segment; no browser errors. `npm run build
--workspaces` and `npm test --workspaces --if-present` pass (32/32).

**Still deliberately absent.** `findShapeHit` has no Ellipse branch, so Trim
targets lines, circles, and arcs only. That was specified, not overlooked:
ellipse stroke picking needs rotated-frame distance and belongs in its own
slice when an actual whole-ellipse operation needs it.

---

## 2026-09-09 — the parity ledger's missing 30th word: Pocket

**Decided.** `SPEC-P1-parity-closeout.md` §"Sequencing + gates" names
`30/46 shipped` as P1a's gate. The checker reports **29/46**, and the
difference is Pocket: `pocket()` shipped as a P1b *transpiler statement* over
the bridge, but the ledger tracks **ModelDoc vocabulary words**, and Pocket has
none. So the feature works and the ledger is honest — the spec's number was
written before that split was understood.

**Open.** Adding a ModelDoc `pocket` kind would move the ledger 29 → 30 and
close the one gate number in the closeout spec that is not met. Small, and the
only ledger item not deferred by an explicit decision.

---

## 2026-09-09 — Export STL follow-ups (P1c-2 shipped as ec68c3e / 8a9197b)

**Decided and NOT done, each with its reason:**

- **`state.tip` can be a datum plane.** After a bare Rect Sketch the tip is
  `YZ_Plane`, because `render()` assigns it from `meshFaces()`, which returns
  whatever it can mesh. So Export STL and both pattern buttons are clickable
  with no solid present. The failure is now legible (the emitter says *"Only a
  solid has faces to mesh … Pad it into a solid first"*), but the derivation
  itself is untouched — tightening it reaches pocket, revolve, fillet, chamfer
  and the patterns, so it is a slice of its own.
- **`linPatBtn` / `polPatBtn` flicker on at session start.** They are in
  `setButtons`'s list *and* in `updateSweepButtons`. `exportStl` was kept out
  of that list and measurably does not flicker; fixing theirs means editing the
  list.
- **A radius-0 prism logs `+ prism r0 h30` after its own error.** Pre-existing,
  noticed while probing the error channel.
- **Ellipse stroke picking.** `findShapeHit` has no Ellipse branch. A
  whole-shape pick exists to feed a constraint that names a whole shape, and
  nothing shipped takes an ellipse that way; Delete already reaches one through
  its centre. Add the branch when a constraint needs it — it costs a
  rotated-frame distance, which is not free to get right.
- **`sketchSetDatum` needs the same deg→rad conversion an angle constraint
  needs.** Latent, not live: nothing in the UI calls `sketchSetDatum`.

**Open, unexplained.** Whether OCCT reuses a triangulation already attached to
a shape is **non-deterministic**: a sphere gave 26718 facets at both 0.01 and
1.0 on one shape, and the same padded cylinder gave 912/500 on one run and
912/912 on the next with nothing changed. The gate works around it by building
two fresh solids. Nobody has explained why it fires on some shapes and runs
and not others.

---

## 2026-09-08 — Tangent constraint: P1d candidate v2

**Decided.** Cut from P1d for an architecture reason, not capacity.
`packages/sketch/src/sketch-arc.ts:1-6` says it in its own header: `solveSketch`
is a relaxation loop over STRAIGHT edges. A curve is a **bulge** — one number
per edge, `tan(sweep/4)` — from which centre and radius are rebuilt *after* the
solve. The solver never holds a radius or a centre, so there is no arc inside
it for a tangency to be taken against.

**Open.** Making tangent real means promoting bulge to a solved unknown — a
solver-architecture change the size of P1a. The bridge side is unaffected:
FreeCAD's own solver does tangency, so a bridge-only `constrainTangent` is
available whenever the studio wants it without the TS solver.

---

## 2026-09-08 — sketch-on-plane, and the datum family behind it

**Decided.** Four ledger tools — `PartDesign_Plane`, `_Line`, `_Point`,
`_CoordinateSystem` — are deferred together with the *attachment story*, per
`SPEC-P1-parity-closeout.md` §"Out of scope". A datum is only useful once a
sketch can be attached to one, so they move as a group behind sketch-on-plane.

**Open.** sketch-on-plane itself. `sketchNewOnFace` already exists on the
bridge and the studio uses it for Pocket, so the gap is datum planes
specifically, not attachment in general.

---

## 2026-09-08 — Hole: stays partial, deliberately

**Decided.** `hole()` makes a simple through/depth hole. Counterbore,
countersink and thread are not implemented and the ledger says `partial` rather
than `queued`. `SPEC-P1-parity-closeout.md` §"Out of scope" keeps it that way
on purpose — the plan B3 wording stands.

**Open.** Nothing, unless the decision is revisited.
