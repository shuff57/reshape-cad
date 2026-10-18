# SPEC — brep-rs hole (dispatch, 2026-09-15; send after pocket passes)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.5, §4.7, §7). If any path in this spec does not exist, STOP and say so rather
than guessing.

## WORK STYLE — read first

Earlier runs died at the 32,000 output-token limit while reasoning, with zero
edits. Keep every message short, put geometry into Rust plus `cargo test`, and make
your first code edit within 6 tool calls. The lead has already read the code and
measured OCCT, so everything you need is below.

## Goal

Make all 4 `hole` fixtures pass (refused today with "brep-rs does not build 'hole'
yet", from `packages/brep-rs/src/wasm.rs`), without regressing anything.

## What a hole is (from packages/kernel/src/occt-build.ts:974-1049)

`{ id, kind: 'hole', target: <solid id>, diameter, depth, center: [dx,dy,dz], axis: 'x'|'y'|'z', corners?: {dx, dy} }`

1. `src` = the built target solid. If missing, do nothing, as OCCT does.
2. If `diameter <= 0 || depth <= 0`, refuse with
   `"<label>'s diameter and depth must both be greater than zero -- <label> is shown without it."`
   and keep src unchanged.
3. bbox = src's bbox. The centre is `bbox centre + f.center`. `f.center` is an OFFSET
   from the target's bbox centre, never a world position.
4. perp = the two bbox extents NOT along the axis (axis x uses y,z; y uses x,z; z uses
   x,y). If `diameter > min(perp)`, refuse with
   `"Boring <label> at diameter <d> would not fit <target label> -- <label> is shown without it."`
5. One bore = a cylinder of radius diameter/2 and length depth, CENTRED on its centre
   (it extends depth/2 each way), along the axis.
6. With `corners`, there are 4 bores at `(cx-dx, cy-dy, cz)`, `(cx+dx, cy-dy, cz)`,
   `(cx-dx, cy+dy, cz)`, `(cx+dx, cy+dy, cz)`. The corner offsets always move in world
   x and y, whatever the axis. Otherwise there is one bore at the centre.
7. OCCT fuses all bores into one tool and then does ONE cut. In brep-rs: if the bores'
   AABBs are pairwise disjoint, subtracting them one after another gives the same
   solid, so do that with `ops::boolean("subtract", ...)`. If any two bores overlap,
   refuse with a plain reason (fusing overlapping bores is a later dispatch).

Reuse what exists: `build::cylinder_solid(centre, radius, height, axis)` (it is
centred; see how the `"cylinder"` and `"extrude"` branches in `wasm.rs` call it) and
`ops::boolean`. Write the hole branch in `wasm.rs` near the pocket branch. Labels
come from the same place the other refusals in `wasm.rs` get them; if there is no
name map, use the id.

## The 4 fixtures (lead-measured OCCT reference; box 40x40x20 centred at the origin)

The box spans x[-20,20] y[-20,20] z[-10,10].

| fixture | bore(s) | kind of cut | OCCT volume | OCCT faces |
|---|---|---|---|---|
| hole-through | r3 axis z, centre (0,0,0), z[-11,11] | goes through top and bottom (the same shape as `boolean-cut`, which passes) | 31434.513322 (= 32000 - 9pi*20) | 7 |
| hole-blind | r3 axis z, centre (0,0,0), z[-5,5] | fully enclosed cavity (the same case as pocket-G5-circle) | 31717.256661 (= 32000 - 9pi*10) | 9 |
| hole-corners | 4 x r3 axis z at (+-15, +-10), z[-11,11] | 4 disjoint through holes | 29738.053289 (= 32000 - 4*9pi*20) | 10 |
| hole-x-axis | r3 axis x, centre (0,0,0), x[-21,21] | through along x (the same shape as `boolean-cut-x-axis-cylinder`) | 30869.026645 (= 32000 - 9pi*40) | 7 |

The bbox equals the box in every case.

If a case fails only inside `ops::boolean` (for example 4 successive cuts leaving the
top face with 4 holes), fix it in `ops.rs` with a native test; do not special-case it
in `wasm.rs`.

## Constraints

1. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`.
2. No hard-coded constants for these fixtures. Real analytic cylinder faces only; the
   gate fails any result above 2x OCCT's faces plus 4.
3. Every kind that is DONE when you start must stay DONE. Run the full gate first and
   write down the baseline.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind hole
node scripts/brep-parity-gate.mjs                     # full gate, before and after
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

- `--kind hole` exits 0 with 4 passed.
- The full gate passes = baseline + 4, with every DONE kind still DONE.
- cargo test passes, including a native test for 4 disjoint successive cuts.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence).
Include: per-fixture results with the worst delta and its field; face counts, brep vs
OCCT; the full-gate tally before and after; cargo test; gzipped wasm bytes; files
changed; spend written as USD with no dollar sign; ONE design decision this spec did
not pin down; and the checks you could NOT perform (you have no image input).
