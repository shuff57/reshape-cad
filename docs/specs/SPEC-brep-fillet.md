# SPEC — brep-rs fillet (round and chamfer one box edge) (dispatch, 2026-09-15)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.5 fillet, §4.6 naming, §4.7, §7). If any path in this spec does not exist, STOP
and say so rather than guessing.

## WORK STYLE — read first

Keep every message short, put geometry into Rust plus `cargo test`, and make your
first code edit within 6 tool calls. The lead has already read the code and measured
OCCT, so everything you need is below. Ignore any older message-center messages about
other kinds: this dispatch is fillet only.

## Goal

Make `round-one-edge` and `bevel-one-edge` pass (refused today with "brep-rs does not
build 'fillet' yet"), keep `name-between-edge` passing, and regress nothing.

## What a fillet is (from packages/kernel/src/occt-build.ts:728-800 and 258-300)

`{ id, kind: 'fillet', target: <solid id>, size, style: 'fillet'|'chamfer', edge: <TopoName> }`

1. `src` = the built target. If missing, do nothing.
2. Resolve `edge` against the shape built so far. The fixtures use
   `{cause:'between', feature:'b1', kind:'edge', of:[face b1 +z, face b1 +x]}`, and
   brep-rs already resolves exactly this name: see `"between"` in `resolve()` at
   `wasm.rs:1199`, which `name-between-edge` exercises. Reuse that logic inside
   `build_doc`, factored into a helper; don't copy it.
3. Name not resolved: refuse with
   `"<label>'s edge could not be found -- <label> is shown without it."`
   and keep src.
4. style 'fillet' rounds the edge with radius `size`. style 'chamfer' bevels it with
   equal distance `size` on both faces (OCCT's `BRepFilletAPI_MakeChamfer.Add(size, edge)`).
5. If the size doesn't fit the edge, refuse with
   `"Rounding <label> at <size> would not fit its edge -- <label> is shown without it."`
   (or "Chamfering" for a chamfer) and keep src. OCCT's exact limit is not
   gate-checked. Refuse when `size >=` the shorter of the two adjacent face widths
   measured perpendicular to the edge.
6. Record no naming history in this slice. Say so in the report.

## Scope for this slice: one edge of an axis-aligned box

Honouring §4.5 ("never return a wrong solid"), support a target that is an axis-aligned
box: 6 planar faces with axis-aligned normals, and volume equal to bbox volume (the
same test the shell branch uses, so reuse it). The resolved edge must be a straight
edge between two perpendicular box faces. Anything else gets a plain refusal, for
example `"brep-rs can only round an edge of a box yet -- <label> is shown without it."`
> **SCOPE WIDENED 2026-10-01 (`f78f396`); the example sentence above is still live.**
> The scope is no longer only an axis-aligned box. `build_fillet` now has a general
> convex-edge **chamfer** path: it removes the corner with a triangular prism whose two side
> faces lie in the two selected face planes, so any convex straight edge between two
> planar faces is reachable. Measured: a hex prism -- which no cross-section can be
> extruded from, so all four earlier paths refused it -- chamfers to
> 5161.5114065552525 = 2980*sqrt(3) at 1e-6, watertight, with a second case whose bevel plane
> passes through the origin.
> What is unchanged, and why the sentence above still appears: a **round** is still
> refused, because a fillet tool is tangent to the very faces it blends and this path
> deliberately does not use the boolean for that (`wasm.rs:5510` routes `round` back to
> `NoBox`). Four refusals were added alongside it, each with its own sentence: a flat
> edge, a concave edge, an end vertex touching more than three faces, and a round on a
> general convex edge. Three of the four are pinned
> (`fillet_chamfer_flat_and_round_hex_edges_refuses`,
> `fillet_chamfer_concave_edge_refuses`). The fourth -- more than three faces at an end -- is
> implemented and refuses, but is **not pinned**: a >3-face vertex does not arise
> naturally (a box corner is three, a hex prism corner is three, and chamfering a corner
> splits its vertex), so a fixture would have to invent topology no user can build. Left
> unpinned deliberately, and recorded in the `f78f396` commit message.
> A chamfer on a **boolean result** still refuses, and that is K2b -- see
> brep-fix-plan.md, which gates it on the K1a that stopped at its stop rule (msgbox #430).

**Construction (exact, reuses tested code).** A box with one edge rounded is an
extrusion of the box's cross-section perpendicular to that edge, with the one matching
corner rounded or chamfered:
- The edge direction is the axis shared by both faces' planes. The cross-section
  plane is perpendicular to it.
- The cross-section is a rectangle of the box extents on the other two axes. The
  corner to modify is the one at the extremes named by the two faces (for +z and +x,
  the corner at x = xmax, z = zmax).
- Build it with the extrude machinery's corner rounds or chamfers (`build::extrude_profile`
  with `ProfileSeg::Arc` for a round, as the `rounded-corner` and `chamfered-corner`
  extrude fixtures do exactly), swept along the edge axis over the box's length.
- Make sure the resulting walls face outward, including when the sweep axis ordering
  is left-handed (extrude already had a negative-sweep bug; check with a native test
  that the volume is positive).

## Multi-edge: a second and later edge of the same box (2026-09-28)

The studio fans a multi-edge pick out into N sequential `fillet` features, so the second
edge arrives as a second feature aimed at the solid the first one produced. That solid is
no longer a box, and the 6-face test above refused it -- the first multi-edge pick got one
build and one refusal. The box path still applies here, and for the same reason it worked
the first time: **no boolean is involved.** A box carrying straight 45-degree chamfer
bevels is a prism along the axis its bevels share, so the cross-section is still a
rectangle with corners already cut, and re-extruding it with one more cut is exact.

**Recognising it.** Each world axis's lo/hi comes from the *axis-aligned* faces alone. A
bevel's normal sits at 45 degrees, so it is never axis-aligned and can never be mistaken
for a box face -- which is exactly what pairing planes by antiparallel normal (what
`box_local_frame` does) cannot promise here, since two *opposite* bevels are antiparallel
and would pair up as a third box axis. A bevel's size is read off its measured area,
`d * sqrt(2) * edge_length`. The recognised solid's **measured** volume is then checked
against the closed form `(rectangle area - sum of d^2/2) * shared edge length`; that
comparison is the safety net, so a shape that is not what we read refuses instead of
building.

**Refusals, all honest** (SPEC 4.5): a second edge whose existing bevels run along a
*different* axis, since the solid is then no longer a prism along any one of them and
re-extruding would silently drop material; a corner that already carries a bevel, because
two cuts meeting there is a corner blend, a different profile; a new cut that would overlap
a neighbour's across a shared face; a curved face anywhere in the solid, so a round fillet
leaves a cylinder and a later edge on that solid refuses rather than guessing. A *round*
cut is allowed to mix with existing straight bevels (the chamfer-then-round case).

**Known limit.** A *rotated* box that already carries bevels still refuses: the recogniser
reads world-axis-aligned faces only, and the rotated path refuses outright on any solid
that is not six faces.

**A wrong solid this found, now fixed and pinned.** The profile's two trim points were
always emitted pin-then-pout, which closes the loop only at the two *even* corners of the
cross-section. A single chamfer at `+z/-x` built a self-intersecting bowtie -- and every
fixture cut `+z/+x`, so nothing caught it. `fillet_one_edge_at_any_corner_is_not_a_bowtie`
now pins all four corners at the same 31680. The one-edge and multi-edge paths share one
profile builder (`box_profile_cuts`), so the ordering cannot drift apart again.

## The fixtures (lead-measured OCCT reference; tol for these two is `approx` = 1e-4)

Base: box 40x40x20 centred at the origin, so x[-20,20] y[-20,20] z[-10,10]. The edge
between +z and +x runs along Y at x=20, z=10. Size is 4.

| fixture | OCCT volume | OCCT faces |
|---|---|---|
| round-one-edge (fillet r=4) | 31862.654825 (= 32000 - (16 - 4pi)*40) | 7 |
| bevel-one-edge (chamfer 4) | 31680 (= 32000 - 8*40) | 7 |
| name-between-edge | 32000, resolves edge | 6 (must stay passing) |

The bbox is unchanged (x[-20,20] y[-20,20] z[-10,10]), since the other faces still reach
every extreme.

## Constraints

1. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`.
2. No hard-coded constants for these fixtures. Analytic faces only: the round is a
   real partial cylinder.
3. Every kind that is DONE when you start must stay DONE. The baseline is 54 passed /
   4 failed and cargo test 34/34; run the full gate first to confirm.
4. Add native tests for both volumes, the doesn't-fit refusal and the non-box refusal.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind fillet
node scripts/brep-parity-gate.mjs                     # full gate, before and after
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

- `--kind fillet` exits 0 with 3 passed.
- The full gate passes 56, with every DONE kind still DONE (only blend and draft remain).
- cargo test passes, including the new tests.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence).
Include: per-fixture results with the worst delta and its field; face counts, brep vs
OCCT; the full-gate tally before and after; cargo test; gzipped wasm bytes; files
changed; spend written as USD with no dollar sign; ONE design decision this spec did
not pin down; and the checks you could NOT perform (you have no image input).
