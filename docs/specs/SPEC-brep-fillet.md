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
