# SPEC — brep-rs pocket (dispatch, 2026-09-15)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.5 booleans, §4.7 face-count bound, §7 reporting). If any path in this spec does
not exist, STOP and say so in your reply rather than guessing.

## WORK STYLE — read first

Two earlier runs on this kernel died at the 32,000 output-token limit while
reasoning, with zero edits. So:
- Keep every message short. Put geometry into Rust plus `cargo test`, not into
  your reasoning.
- Make your first code edit within your first 6 tool calls. Everything you need is
  in this spec: the lead has already read the relevant code and measured the OCCT
  reference numbers.

## Goal

Make all 5 `pocket` fixtures pass (they are refused today with "brep-rs does not
build 'pocket' yet", from `packages/brep-rs/src/wasm.rs:772`), without regressing
anything.

## What a pocket is (from packages/kernel/src/occt-build.ts:620-639)

A pocket feature is `{ id, kind: 'pocket', target: <sketch id>, into: <solid id>, depth }`.
OCCT builds the extrude prism of the sketch with the sweep NEGATED, then cuts it
from the `into` solid:

```
h = -depth * dir          // extrude uses h = height * dir
tool = prism(sketch face, n * h)
result = Cut(built[into], tool)
```

In brep-rs, the `"extrude"` branch at `wasm.rs:433` already builds that prism:
`build::extrude_profile(&segs, origin, u_axis, v_axis, scale(n, height * dir))`
for outlines, and `build::cylinder_solid(add(centre_w, scale(n, height*dir/2)), radius, height, n)`
for circles. The boolean is `ops::boolean("subtract", base, tool)` at `ops.rs:1373`.
Follow how the `"combine"` branch in `wasm.rs` looks up an earlier solid and
replaces it.

A pocket is therefore: tool = the extrude branch's solid with `height * dir`
replaced by `-depth * dir`, then `ops::boolean("subtract", into_solid, tool)`.
Factor the tool-building into a helper that extrude and pocket both call; don't
copy the code. Watch out: a negative sweep vector can turn the prism inside out
(faces pointing inward, so the volume comes out negative). Add a native test that
the tool's `solid_volume` is positive, and fix the orientation if it isn't. Record
no sweep history, the same as OCCT.

If `ops::boolean` returns `None`, refuse with an accurate reason. Never return a
wrong solid.

## The 5 fixtures (lead-measured OCCT reference)

Every one of them is a FULLY ENCLOSED CAVITY: the tool sits strictly inside the
base and touches none of its faces. The result is the base's outer shell plus one
inner void shell (the tool's faces, reversed so they point into the void). No face
of either solid intersects the other, which is why OCCT's face count is exactly
base plus tool.

| fixture | base box (x, y, z ranges) | tool | OCCT volume | OCCT faces |
|---|---|---|---|---|
| pocket-xy | [-20,20] [-20,20] [-10,10] | x[-5,5] y[-4,4] z[-5,0] | 31600 | 12 |
| pocket-xz | [-20,20] [-20,20] [-10,10] | x[-5,5] y[0,5] z[-4,4] (xz: n=+Y, dir=-1, so h=+5) | 31600 | 12 |
| pocket-G1-xy-slab | [-20,20] [-20,20] [0,8] | x[-5,5] y[-4,4] z[1,6] | 12400 | 12 |
| pocket-G3-yz-slab | [0,8] [-20,20] [-20,20] | x[1,6] y[-5,5] z[-4,4] (yz: n=+X, dir=+1) | 12400 | 12 |
| pocket-G5-circle | [-30,30] [-30,30] [0,8] | cylinder axis Z, centre (12,-6), r=5, z[1,6] | 28407.300918 (= 28800 - 125*pi) | 9 |

The bbox equals the base box in every case, since the void is inside.

Sketch fields: rectangles come from `newRectangleSketch(doc, plane, [-5,-4], [5,4])`
(u in [-5,5], v in [-4,4]) with `offset` set on the sketch. The circle sketch has
`shape: 'circle'`, `points: [[7,-6],[17,-6]]` (a diameter, which the existing
`circle_of_value` reads) and `offset: 6`. Plane frames are the existing
`plane_frame`: xy u=+X v=+Y n=+Z dir=+1, xz u=+X v=+Z n=+Y dir=-1, yz u=+Y v=+Z n=+X dir=+1.

## Probably needed in ops.rs: containment

The current boolean was built for faces that cross. First run the gate and see
whether it handles a tool strictly inside the base. If it refuses, or the volume or
face count is wrong, add containment handling to `ops::boolean`:
- subtract, b strictly inside a (every face of b classifies inside a, and no face of
  a is inside or touching b): keep a's faces unchanged, and add b's faces REVERSED
  as an inner shell. Planar faces already have `flip_planar`; the cylinder lateral
  face will need an equivalent.
- Use the existing classifiers (`inside_solid`, `process_face`). Refuse any mixed
  or touching configuration you are not sure about.
- Add native tests: the box-in-box cavity volume is 32000 - 400, and the
  cylinder-in-box volume is 28800 - 125*pi.

The void shell must be a real closed shell of real faces (the lateral cylinder face
is an analytic cylinder, not facets). The gate fails any result above 2x OCCT's
faces plus 4.

## Constraints

1. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`. The lead holds
   claims on them.
2. No hard-coded constants for these fixtures.
3. DONE kinds must stay DONE: box, move, cylinder, cone, sphere, torus, prism,
   wedge, extrude, revolve, mirror, pattern, combine. The baseline gate is 40 passed
   / 18 failed. Gzipped wasm is 96,972 bytes. cargo test is 20/20.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind pocket
node scripts/brep-parity-gate.mjs --kind extrude
node scripts/brep-parity-gate.mjs --kind combine
node scripts/brep-parity-gate.mjs                     # full gate, before reporting
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

- `--kind pocket` exits 0 with 5 passed.
- The full gate passes >= 45 with every DONE kind still DONE.
- cargo test passes, including the new tests.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

- STATUS FIRST: if anything failed, was skipped or was refused, say so in the first
  sentence.
- Per-fixture pocket results with the worst delta and its field; face counts, brep
  vs OCCT.
- The full-gate tally, plus confirmation that all 13 DONE kinds are still DONE.
- cargo test result, gzipped wasm bytes, files changed.
- Spend written as USD, with no dollar sign.
- ONE design decision this spec did not pin down.
- Which checks you could NOT perform (you have no image input).
