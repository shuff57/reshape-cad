# FUTURE — reshape-cad

Parked work, newest first. Each entry says what was DECIDED and what is still
OPEN. Not a backlog of ideas: everything here has a measured reason for being
parked rather than done.

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

## 2026-09-09 — P1d-2: construction toggle + Trim

**Decided.** Specced in full at `docs/specs/SPEC-P1d2-construction-trim.md`,
ready to dispatch. Both APIs already read out of the vendored source
(`Mod/Sketcher/App/SketchObjectPyImp.cpp`), including the two `"O!"` traps:
`setConstruction` needs a real Python `True`/`False` (a `1` is a TypeError) and
`trim` needs an `App.Vector`, not a tuple. Bridge + `engine/play` only —
nothing in `packages/`, because the studio sketcher uses FreeCAD's solver, not
the TS relaxation solver.

**Open.** Not built. Blocked only on a coordination problem, not a technical one:
a second Claude Code session (cwd `~/Documents/GitHub/shCode`) writes into this
repo by absolute path *under the msgbox identity `claude`*, so it can release
this session's file claims and read messages addressed to others. Until that
session uses a distinct identity, the ownership guard cannot separate two
Claude sessions and a dispatched builder is unprotected.

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
