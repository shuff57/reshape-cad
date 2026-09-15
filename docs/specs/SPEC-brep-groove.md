# SPEC — brep-rs groove (dispatch, 2026-09-15; send after hole passes)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.5, §4.7, §7). If any path in this spec does not exist, STOP and say so rather
than guessing.

## WORK STYLE — read first

Earlier runs on this kernel stalled while reading and reasoning, one of them for 20
minutes with zero edits. Keep every message short, put geometry into Rust plus
`cargo test`, and make your first code edit within 6 tool calls. The lead has already
read the code and measured OCCT, so everything you need is below. Ignore any older
message-center messages about sphere, pocket or hole: this dispatch is groove only.

## Goal

Make all 3 `groove` fixtures pass (refused today with "brep-rs does not build 'groove'
yet"), without regressing anything.

## What a groove is (from packages/kernel/src/occt-build.ts:596-619)

`{ id, kind: 'groove', target: <sketch id>, into: <solid id>, angle }` (degrees,
default 360).

A groove is a subtractive revolve: spin the profile sketch exactly as `revolve` does,
translate it by `offset * n` when the sketch has an offset, then
`Cut(built[into], tool)`. Record no sweep history.

brep-rs already has the full-turn tool. The `"revolve"` branch at `wasm.rs:684-740`
calls `profile_corners(sk)` and then `build::revolve_profile(&points, n, u_axis)`, and
applies the offset translation. The profile point `p` is laid at `p[0]*u + p[1]*n`,
and the spin axis is `n` through the world origin. Factor the tool-building into a
helper that revolve and groove both call; don't copy it. Then use
`ops::boolean("subtract", into_solid, tool)`. The enclosed-cavity path that pocket
added (`subtract_enclosed` in `ops.rs`) should handle all three fixtures, because
every groove tool here sits strictly inside the box.

## New: partial-angle revolve (needed for groove-half only)

`revolve_profile` is full-turn only today (`wasm.rs:698` refuses anything else).
Add an angle parameter:
- Rotation is right-handed about `n`: a profile point at angle 0 lies along `+u`,
  and at angle t along `u*cos(t) + (n x u)*sin(t)`. This matches OCCT's
  `BRepPrimAPI_MakeRevol(face, gp_Ax1(origin, n), angle)`. For the xz plane,
  n=+Y and u=+X, so n x u = -Z, which puts the half ring on the z <= 0 side.
- The walls are partial analytic surfaces: a cylinder with an `ArcRange`, which
  `geom::Cylinder` already supports from extrude, and planar annulus sectors
  bounded by `Curve::Arc`.
- Add 2 planar cap faces, each a copy of the profile polygon: one at angle 0 and one
  at angle t, with outward normals.
- Keep the `"revolve"` branch refusing non-360 angles, because no revolve fixture
  covers a partial turn. Only groove uses the new parameter. Say this in your report.

## The 3 fixtures (lead-measured OCCT reference)

Base: box 40x40x20 centred at the origin, so x[-20,20] y[-20,20] z[-10,10]. Each
profile is `newRectangleSketch(doc, 'xz', [r0, v0], [r1, v1])` with offset 0, so
radius r runs along +X, height along +Y (n), and the axis is the world Y axis.

| fixture | ring: radius, height (y) | angle | OCCT volume | OCCT faces |
|---|---|---|---|---|
| groove-full | r[4,8], y[5,12] | 360 | 30944.424868 (= 32000 - pi*(64-16)*7) | 10 (6 box + outer cyl, inner cyl, 2 annuli) |
| groove-half | r[4,8], y[5,12] | 180 | 31472.212434 (= 32000 - pi*48*7/2) | 12 (6 box + 2 half cyls, 2 half annuli, 2 rectangular caps) |
| groove-straddle | r[3,6], y[-4,4] | 360 | 31321.415987 (= 32000 - pi*(36-9)*8) | 10 |

Every tool is strictly inside the box (the ring's max radius of 8 is less than the
box's 10 half-thickness in z), so each result is the box plus a sealed inner void, and
the bbox equals the box.

## Constraints

1. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`.
2. No hard-coded constants for these fixtures. Analytic faces only; the gate fails any
   result above 2x OCCT's faces plus 4.
3. Every kind that is DONE when you start must stay DONE, especially revolve 3/3 and
   pocket 5/5. Run the full gate first and write down the baseline.
4. Add native tests: the partial-revolve tool volume for a half ring
   (pi*(r1^2-r0^2)*h/2, positive), and all three groove volumes.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind groove
node scripts/brep-parity-gate.mjs --kind revolve
node scripts/brep-parity-gate.mjs                     # full gate, before and after
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

- `--kind groove` exits 0 with 3 passed.
- The full gate passes = baseline + 3, with every DONE kind still DONE.
- cargo test passes, including the new tests.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence).
Include: per-fixture results with the worst delta and its field; face counts, brep vs
OCCT; the full-gate tally before and after; cargo test; gzipped wasm bytes; files
changed; spend written as USD with no dollar sign; ONE design decision this spec did
not pin down; and the checks you could NOT perform (you have no image input).
