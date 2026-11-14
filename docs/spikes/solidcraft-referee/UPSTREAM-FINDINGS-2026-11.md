# Four engine findings, tried on the newest release: nothing to report upstream

Written 2026-11-14 for item 7 of `PLAN-open-2026-11.md`. Nothing here was sent, filed or posted. Upstream was read (its tags, one release
fetched into a scratch rig, SolidCore's status page) and not changed.

## The result

The second pilot measured four faults on the pin, SolidCraft v0.30.1 (`8e2b0cd6`, the truck kernel). All four are still there on the pin and
all four are gone on the newest release, v0.41.0 (`3c8efdb5`, released after v0.40.1; its only kernel is solidcore). The plan's rule for this
item is that a fault that is gone is not reported. So there is no draft of an issue: upstream no longer ships the kernel these are faults of.

They stay what they were for us: faults of the pin, each covered on our side (the crash guard, no comparing of two runs of a rounded part,
the curved-wall rule of the sweep, a measured box that is not taken for material).

| | v0.30.1 (the pin) | v0.41.0 |
|---|---|---|
| 1. A pocket into a drafted cylinder (a cylinder r 12, its wall drafted 2 degrees, a through pocket, then a pocket 1 deep across the wall) | the last cut panics: `WASM TRAP: unreachable` (truck-geotrait `curve.rs:78`); the web build never answers again | builds: 13311.488337. OCCT's volume for the same part: 13311.488332 |
| 2. A 20 x 20 x 10 box with all twelve edges rounded r 2, read five times (four in one engine, one in another process) | 2 different volumes (2.4e-16 apart), the 26 faces in 4 different orders | 1 volume, 1 order |
| the same box's volume against the closed form 3839.032405 | 3838.937125 (2.5e-5 low) | 3839.032405 |
| 3. A cylinder r 8, h 30: volume against pi 64 30, and its box | 1.25e-4 low; the box 2.2e-4 mm off | 1.1e-11; the box exact (3.6e-15 mm) |
| the same with a 6 x 4 pocket 2 deep at its side: volume against a hand-worked 6017.423776 | 1.92e-4 low; the box 4.6e-4 mm off | 5.3e-9; the box exact |
| 4. A five-sided prism, z -6 to 6, hollowed 2 with the top open, a bore of radius 3 along x through the rim: where the measured box ends | z = 6.008372 (8.4e-3 mm above the part) | z = 6.000000 |

The panic on the pin needs both pockets: with only the second one (6 commands) the engine answers (13340.421). The list of 10 commands is the
smallest one found.

## How it was run

- `pilot-2026-11b/upstream/capture.mjs` wrote the command lists the layer sends on the pin (`commands-0.30.1.json`).
- `pilot-2026-11b/upstream/reprobe.mjs <label> <package> <topology package>` runs them raw, with no layer, every engine run in its own process,
  and prints the table's numbers: `reprobe-0.30.1.txt` and `.json`, `reprobe-0.41.0.txt` and `.json`.
- The v0.41.0 rig is `~/.cache/solidcraft-0.41.0-rig` (outside the repo): upstream's tag fetched unmodified, and the wrapper of the
  0.40.0-rc.2 probe (`solidcore-0.40.0-rc.2/rig/`) with its manifest brought in line with 0.41.0's own (the same release profile; the patch list
  is now two crates, `accesskit_macos` is no longer vendored) and upstream's `Cargo.lock` copied in. Package hashes:
  `30716c66…` (`solidcraft_referee_bg.wasm`), `93fe4e6f…` (`solidcraft_referee_p2_bg.wasm`).
- The build needs two compiler processes of 4 to 5 GB at its end. Run beside anything else on this machine it starves it: do it alone
  (`--jobs 2`, under the rig's lock).

## What this does not say

That v0.41.0 is fit for the layer. These are five raw command lists. The contract has not been remeasured on any solidcore release, and the
pin was kept at 0.30.1 by the owner's decision of 2026-11-09. And one fault of solidcore's own is still there, next.

## One fault that is still there on v0.41.0: a draft, not sent

The probe of 0.40.0-rc.2 (`SOLIDCORE-PROBE-0.40.0-rc.2.md`, "Wrong solids") found that rounds sent one edge a call also round edges nobody
named. The same probe on v0.41.0 (`solidcore-0.40.0-rc.2/fillet-sequence-probe.mjs`, output in
`pilot-2026-11b/upstream/fillet-sequence-0.41.0.txt`) gives the same numbers to the last digit shown. It is not on the pin
(truck; `fillet-sequence-0.30.1.txt`: 10 faces and 11933.6696 for the same four calls). On our
side it is covered: the layer sends the edges of one round in one call and refuses the chain it cannot (`GUARD-FILLET-CHAIN.md`). Nothing
of ours depends on upstream fixing it; it would matter the day the pin moves to a solidcore release.

This is the only draft this item produced. Every word of it is the owner's to change, and whether it is sent at all.

> **Title:** `solid.fillet`: rounding a box's four bottom edges one call at a time also rounds the vertical edges (v0.41.0)
>
> A 40 x 30 x 10 box, its four bottom edges rounded with radius 1.5.
>
> ```json
> [{ "command": "solid.box", "params": { "length": 40, "width": 30, "height": 10, "center": [0, 0, 5], "body_name": "b1" } },
>  { "command": "solid.fillet", "params": { "edges": [[0, -15, 0]], "radius": 1.5, "body": "b1" } },
>  { "command": "solid.fillet", "params": { "edges": [[0, 15, 0]], "radius": 1.5, "body": "b1" } },
>  { "command": "solid.fillet", "params": { "edges": [[-20, 0, 0]], "radius": 1.5, "body": "b1" } },
>  { "command": "solid.fillet", "params": { "edges": [[20, 0, 0]], "radius": 1.5, "body": "b1" } }]
> ```
>
> | | volume | faces |
> |---|---|---|
> | one `solid.fillet` call with the four edges | 11933.6947 | 10 (4 cylinders, 6 planes) |
> | the four calls above | 11915.3462 | 18 (8 cylinders, 4 others, 6 planes) |
> | after the first two calls (front, back) | 11961.3717 | 8 (2 cylinders, 6 planes) |
> | after the third (left) | 11938.3589 | 13 (5 cylinders, 2 others, 6 planes) |
> | the box with only its four bottom edges rounded, by closed form | 11933.6958 | |
>
> The first two calls round the edge they name. The third also rounds the two vertical edges that the earlier rounds run into (3 new
> cylinders for 1 edge named), and the fourth the other two. The result is 18.35 mm3 short of the part the commands describe. Each call
> answers ok. v0.30.1 (truck) gives 10 faces and 11933.6696 for the same four calls.
>
> Expected: a call that names one edge rounds that edge, or fails.

## SolidCore's status page, 2026-11-14

`tangency-labs.github.io/solidcore`, generated from commit `9e91f89d` (2026-11-14 05:20 UTC): 254 of 282 units green, 27 partial, 1 blocked;
99.3% of lines ported, 89.8% of lines green (it was 100% green on 2026-10-30 and 89.7% on 2026-11-07; the page gives no reason, and warns
that these are port-plan statuses, not CI verdicts). Every module at 100% of its units but blend (24 of 25, 93% of lines). 9 of 9 primitives
build. No version number. Its surface/surface intersection corpus, labelled historical: 78 of 119 pass in Rust (81 in the C++), 10 with wrong
topology (11), 21 incomplete (25); "a golden proves an output unchanged, not correct". Nothing about the wasm build or speed.
