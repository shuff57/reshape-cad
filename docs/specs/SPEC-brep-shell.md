# SPEC — brep-rs shell (dispatch, 2026-09-15; send after groove passes)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.5, §4.6, §4.7, §7). If any path in this spec does not exist, STOP and say so
rather than guessing.

## WORK STYLE — read first

Keep every message short, put geometry into Rust plus `cargo test`, and make your
first code edit within 6 tool calls. The lead has already read the code and measured
OCCT, so everything you need is below. Ignore any older message-center messages about
other kinds: this dispatch is shell only.

## Goal

Make both `shell` fixtures pass (refused today with "brep-rs does not build 'shell'
yet"), without regressing anything.

## What a shell is (from packages/kernel/src/occt-build.ts:1050-1200)

`{ id, kind: 'shell', target: <solid id>, thickness, open?: <TopoName of a face> }`

1. `src` = the built target. If missing, do nothing.
2. If `thickness <= 0`, refuse with
   `"<label>'s thickness must be greater than zero -- <label> is shown without it."`
3. `smallest` = the smallest bbox extent of src. If `2*thickness >= smallest`, refuse
   with `"Hollowing <label> to <t> thick would collapse it -- the wall has to be under <floor(smallest/2*10)/10>. <label> is shown without it."`
4. If `open` is set, resolve it the way the other name-resolving branches in `wasm.rs`
   do (`resolve_face` and the history). If it does NOT resolve, refuse with
   `"<label> could not find the face to leave open -- <label> is shown closed."`
   and still build the CLOSED hollow. This is the one refusal that keeps a result.
5. Closed hollow: `src - inner`, where inner is src offset inward by `thickness` on
   every face.
6. Open hollow: the same, but the chosen face is not offset. Inner reaches all the way
   to that face, so the cut removes it and leaves an opening.

## Scope for this slice: planar-faced boxes only

OCCT uses a general offset (`MakeThickSolidByJoin`), which is out of scope here.
brep-rs builds the inner solid directly for a solid whose faces are all planar
and which is an axis-aligned box (6 planar faces, and its volume equals its bbox
volume). For any other solid, refuse with a plain reason, for example
`"brep-rs can only hollow a box yet -- <label> is shown without it."`
Never return a wrong solid.

- Closed inner = `build::` box of the bbox shrunk by `t` on all six sides. Then
  `ops::boolean("subtract", src, inner)` takes the enclosed-cavity path that pocket
  added.
- Open inner = the bbox shrunk by `t` on five sides, with the open face's side left
  flush with the outer face. Then `ops::boolean("subtract", src, inner)` is a
  coplanar-flush subtract, the same configuration as the passing
  `coplanar-subtract-flush-top` combine fixture. If the boolean refuses a flush face,
  fix that in `ops.rs` with a native test; do not fake it in `wasm.rs`.
- Put the shared logic in a helper; don't duplicate the box-building from the `"box"`
  branch.

## The 2 fixtures (lead-measured OCCT reference)

Base: box 40x40x20 centred at the origin, so x[-20,20] y[-20,20] z[-10,10]; thickness 2.

| fixture | inner solid | OCCT volume | OCCT faces |
|---|---|---|---|
| shell-2 | x[-18,18] y[-18,18] z[-8,8], enclosed | 11264 (= 32000 - 36*36*16) | 12 (6 outer + 6 inner) |
| shell-open-top (open = face b1 +z) | x[-18,18] y[-18,18] z[-8,10], flush with the top | 8672 (= 32000 - 36*36*18) | 11 (5 outer + a top ring with a square hole + 5 inner walls/floor) |

The bbox stays the outer box in both cases. `open` is `{cause:'primitive', feature:'b1', kind:'face', part:'+z'}`.

## Constraints

1. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`.
2. No hard-coded constants for these fixtures.
3. Every kind that is DONE when you start must stay DONE, especially combine 13/13
   and pocket 5/5. Run the full gate first and write down the baseline.
4. Add native tests for both volumes and for the collapse refusal.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind shell
node scripts/brep-parity-gate.mjs                     # full gate, before and after
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

- `--kind shell` exits 0 with 2 passed.
- The full gate passes = baseline + 2, with every DONE kind still DONE.
- cargo test passes, including the new tests.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence).
Include: per-fixture results with the worst delta and its field; face counts, brep vs
OCCT; the full-gate tally before and after; cargo test; gzipped wasm bytes; files
changed; spend written as USD with no dollar sign; ONE design decision this spec did
not pin down; and the checks you could NOT perform (you have no image input).
