# SPEC-round-after-cut: a round after a hole

Status: BUILT 2026-10-03 (PLAN-next K-1a). Our own design; no third-party kernel was read.

## The case

`box(40,40,20)`, `hole(b, { across: 8 })`, then `round(b.edge('top','front'), 3)`. Before: refused ("can only round an edge of a box yet"), because
`build_fillet` needs the solid built so far to be a plain box (`box_extent`: six faces, volume equal to its bbox) and the hole made it a seven-face solid.
The refusal was governed by that geometric test, not by the order of the document. Round-then-hole always built.

## Design: replay, never a fillet on a boolean result

`build_doc` keeps a log (`ReplayStep`) of every hole (its tools) and every round (its request), keyed by the feature id that holds the result. When
`build_fillet` returns `NoBox`, `replay_round` walks the target's parents back to a root with no log entry. If the root is a plain box and the chain holds at
least one hole, it rounds the ROOT box (and any earlier rounds, oldest first), then subtracts the recorded tools. That is the order that already builds,
so nothing new is asked of the fillet code and K1a/K2b are not involved.

## The guard (the safety case)

The part of a box a round can change is the corner square of side `size` along the whole edge (the two faces' inner `size` bands). Every recorded tool's
bounding box is tested against that zone with a micron of slack; any overlap refuses with "round before you cut, or keep the cut away from that edge".
Bounding boxes can only refuse MORE than the exact intersection would, never less, so the test is sound. Each cut then goes back through `ops::boolean`
(its own guards still apply), and a result that gains a lump refuses.

## What still refuses (each in a sentence, the source shape shown)

- a hole whose tool reaches the rounded corner;
- a chamfer after a hole: the kernel cannot cut a hole into a chamfered box in either order ("chamfer then hole" refuses today), so the replay says so;
- a blind hole after a round (same reason, either order);
- a second round after a hole (a round on an already rounded box is not built);
- a hollow before the round (the root is shelled, not a plain box): K-1b, separate work;
- anything where the chain is not hole/round steps on a plain box.

## Measured

`box(40,40,20)` hole 8, round 3 on top/front: 30917.433689674344 = 32000 - pi 16 20 - (1 - pi/4) 9 40, 8 faces, equal to the round-first order and to OpenCascade
(volume 1e-7, same face count). An asymmetric box (40x30x20) proves the named edge is the rounded one for all three edge lengths. A sweep of the hole from the
centre to 0.5 mm of the front wall builds exactly or refuses, never another number; twenty-odd touching configurations all refuse with the sentence.
Tests: `packages/kernel/test/round-after-cut.test.mjs` (10). K2b's cargo failure is unchanged.

## Limits

Only holes are replayed (pockets and grooves are not logged). The slack is 1e-6 mm. The replay re-uses the stored tool, not the clamped retry tool, so a part
whose through hole needed the clamp (a cylinder or cone root) is not a replay root (the root must be a plain box).
