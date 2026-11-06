# SolidCore probe: SolidCraft v0.40.0-rc.2 (stage A)

Date: 2026-11-06. Worktree from main @ 06e5ce18. Kernel under test: SolidCraft **v0.40.0-rc.2** (`777f9609`, pre-release 2026-11-03), whose
only kernel is solidcore (`tangency-labs/solidcore` rev `8ddce901`, crate version 1.0.1; `solidcore-record` rev `f5e8e9a2`).
Compared with: SolidCraft 0.21.0 (truck), from the committed reports (`fuzz/NEXT-LOOP-PHASE1.md`, `fuzz/REMAINING-LOOP-PHASE{1,3}.md`,
`fuzz/README.md`, `phase7/README.md`). Nothing upstream was modified, nothing was pushed, filed or posted. No layer source or sentence changed.

## Wrong solids (listed first)

**One wrong-solid class, confirmed by two independent oracles. It is new on solidcore and absent on 0.21.0.**

**Named edge fillets sent one edge per call round edges the doc did not name.** Take a box whose four bottom edges are rounded by four
`fillet(b.edge('bottom', side), R)` features. solidcore rounds the named edge on the first two calls. On the third call (bottom/left) it also rounds the
vertical edges the earlier rounds run tangent into: 3 cylindrical faces appear where 1 was asked for. After four calls the part has 18 faces
(8 cylinders, 4 blends) instead of 10 (`evidence/fillet-sequence.json`, raw command lists, no layer):

| 40 x 30 x 10, R 1.5, bottom edges | rc.2 volume / faces | 0.21.0 volume / faces | S (closed form, fuzz oracle) |
|---|---|---|---|
| one `solid.fillet` call, four edges | 11933.6947 / 10 | 11933.6697 / 10 | 11933.6958 |
| four single-edge calls (front, back, left, right) | **11915.3462 / 18** | 11933.6696 / 10 | 11933.6958 |
| three calls (front, back, left) | 11938.3589 / 13 (5 cylinders) | 11947.5135 / 9 (3 cylinders) | – |

This is the behaviour `NEXT-LOOP-PHASE1.md` found in OCCT's `buildDoc` (tangent-chain propagation). On rc.2 the layer's part equals `buildDoc`'s to 1e-10.

**Through the layer.** `createTranslator({ planners: 'shell-draft' })`, which is what the live gate (`fuzz-guard-run.mjs`, `live-gate.sh`)
and path A of `family-c-run.mjs` drive, sends one call per named edge (`packages/layer/src/translate.ts:550`). It therefore builds the wrong part and reports it as built:

- `family-c-run.mjs`: **8 of 8 bottom-fillet hollows WRONG**, 3.4e-3 to 1.9e-2 off. The two references agree with each other: OCCT built directly from the
  case (`occtDirect`, four edges in one `MakeFillet`) and the plane-offset oracle P, to ≤ 4.5e-7 (6.5e-5 with a through hole).
  The unshelled filleted part is already wrong in all 10 fillet docs, 3.9e-4 to 9.1e-3 off both S and OCCT-direct (which agree to ≤ 1.3e-5).
  That includes the two family-B rows whose hollow is refused, so the student is shown a wrong filleted box beside the refusal.
- `fuzz-guard-run.mjs` (30-case guard fuzz): **2 WRONG** (`C-bfillet-t1-R1.5` 2348.2758 vs P 2364.7293, 7.0e-3; `C-bfillet-t0.5-R0.75`
  1236.3774 vs P 1240.5802, 3.4e-3). They are the same scripts as the family-C plates above, whose OCCT-direct values (2364.7286, 1240.5800) are the second oracle. The gate exits 1.
- **The `unified` set (the shipped path, edges from the engine's own topology) is correct on all 8:** within 2.4e-9 of OCCT-direct. Its
  fillet step (`fillet-chamfer.ts`) groups consecutive same-size fillets on one chain into **one call per connected edge chain**, which
  solidcore builds exactly, and it carries a post-build net ("a blend of one straight planar edge added exactly one face"). Not measured: fillets
  that are not consecutive or differ in size, which `unified` sends as separate calls. The net should refuse those, but no case here exercises it.

No other built solid disagrees with two oracles. Two suspects that rest on one oracle only, neither of them built wrong through the layer:
- `n7` (boss touching the open face at one vertex), raw kernel: 2936.0000 = plate shell 2424 + the **solid** 8³ boss. P = 2720 is the plate
  shell plus the boss hollowed closed. OCCT's thick solid does not build it. Truck 0.21.0 built 2720 and the p8 CLI refused it. `fixes/shell-stub/NOTES.md` calls the
  reading "a policy choice, not a measured error". **Through the layer it is refused** (`shell-draft`: G-PICK; `unified`: G6), so there is no wrong solid for a student.
- Far sphere (r 1 at 1e6): the engine answers `ok` with a body whose measure is an error ("a NURBS form that is not its analytic surface"),
  volume 0, no bbox. **The layer's `translateDoc` throws a TypeError** in all three planner sets, so there is no sentence and no solid.
  That is a crash on our side of the seam, not a wrong solid. The contract's pre-flight guard (`primitives.guard.mjs`, "too-far-curved") would refuse it, but the
  layer does not apply that guard: at 1e4 the layer builds, and solidcore is exact there (4.1887902050 against 4.1887902048). At 1e5 the engine refuses.

## Build recipe (`~/.cache/solidcraft-0.40.0-rc.2-rig/`, recipe copied to `solidcore-0.40.0-rc.2/rig/`)

- `sc-src`: `git -C ~/solidcraft archive 777f9609 | tar -x` (unmodified).
- Manifests mirror rc.2's own root `Cargo.toml`, never a patch of ours: `[profile.release]` opt-level 3, lto "thin", codegen-units 16,
  debug "line-tables-only". The `[patch.crates-io]` list is copied as is, and in rc.2 it holds only UI crates (`egui-wgpu`, `winit`, `accesskit_macos`):
  **rc.2 vendors no truck crate any more**, so the 0.21.0 "missing truck-geometry patch" trap cannot recur. `build.rs` is a byte copy of
  `apps/solidcraft-web/build.rs` (`-zstack-size=8388608`, the 8 MiB wasm stack solidcore's README asks for, which the upstream web build uses).
  `serde_json` takes the workspace's `float_roundtrip` feature. Toolchain: rustc 1.99.1, wasm-bindgen 0.2.129 (= rc.2's `Cargo.lock`), `--jobs 8`.
- `sc-referee-pkg` (wasm sha256 `70bf9e2d…`, 110 MB with line tables): **the referee wrapper compiled unchanged**
  (`packages/solidcraft-host/kernel/src/lib.rs` = `wrapper/src/lib.rs`). Build 5 m 17 s.
- `sc-referee-pkg-topology` (sha256 `3c6661c4…`): the 0.21.0 rig's `wrapper-topology` (phase-2 wrapper2) needed **one change**.
  `Region2::interior_point` moved into the `solidcraft_geom::Region2Geom` trait, so the copy adds `use solidcraft_geom::Region2Geom;` and a
  `solidcraft-geom` path dependency (`rig/wrapper-topology.lib.rs.diff`, `rig/wrapper-topology.Cargo.toml`). It is a test-only wrapper outside `src/`, and no kernel
  is named in the layer.
- Every engine-level API the harnesses use is unchanged: `Session::new(Document::new(..))`, `execute(id, params)`, `inspect.measure`,
  `model.faces`/`model.edges`, `@sketch` fields.
- The shadow repo root `shadow/` follows the RIG.md recipe for contract harnesses that hard-code `archive/brep-rs/pkg`. It holds symlinks plus copies of
  `docs/spikes/solidcraft-referee/{contract,phase0,phase2,phase7,fuzz}`, and the brep-rs pkg is the main checkout's built one (sha256 `85c94526…`, read-only).
  Nothing under `archive/` was touched.

Harness changes: none to existing harnesses (`family-c-run.mjs`, `fuzz-guard-run.mjs`, `live-replay-*.mjs`, `primitives-sweep.mjs` and
`extrude-pocket-slant-timing.mjs` all take the pkg from `SOLIDCRAFT_REFEREE_PKG` / `SOLIDCRAFT_TOPOLOGY_PKG` / `BREP_PKG`). New, referee-only, in
`solidcore-0.40.0-rc.2/`: `lib.mjs` (child-process kernel runner with a wall limit, so a hang is recorded as a hang; OCCT built directly from a raw
command list), `child.mjs`, `raw-probe.mjs`, `sketch-contact-probe.mjs`, `primitives-spec.mjs`, `timing-oracles.mjs`, `fillet-sequence-probe.mjs`,
`summarize.mjs`, `run-all.sh`.

Run hygiene: the chain ran as `systemd-run --user --unit=reshape-sA-* -p MemoryMax=8G` under `flock rig.lock`, one step at a time, at load 2–3
(stage B was building in parallel). One step's EXIT=0 was not real. `extrude-pocket-slant-timing.mjs` exits 0 even when every child fails, and the shadow
root lacked `phase7/` (`translate-ep.mjs` imports `phase7/pane/lib/sketch-map.mjs`). The failed log is kept as
`logs/t-slant-failed-no-phase7.log`, and the step was re-run after copying `phase7/`. Every other step log was checked for errors behind its exit code.
The two remaining primitive "harness-error" rows are the far-sphere layer throw described above, not a harness fault.

## Oracles

- Fuzz self-check first, fresh copies under the rig: **136/136 closed forms** (`evidence/selfcheck.log`, `selfcheck.json`). The Euclid cross-check gives **9/9 within
  1.5 %** (max 2.1e-3, the same as the previous loops; the log prints the five above 1e-3 as `diff`, as it always has), and **32/32** for `selfcheck2`.
- P: `fuzz/oracle.mjs` (h = 0.05), or the hand closed forms recorded with each critic case (`fixes/shell-stub/NOTES.md`, `phase7/probe-shell-rim.mjs`).
- OCCT (`replicad-opencascadejs` 1.1.0): `occt-build.ts` `buildDoc` where the doc is fillet-free, `family-c-run.mjs`'s `occtDirect` for the
  bottom fillets, saved live OCCT values (`contract/ep-results.json`, `revolve-groove-results/r5`), and `lib.mjs occtFromCommands` for raw lists
  (shell by `MakeThickSolidByJoin`, Intersection = the P convention, Arc = `occt-build.ts`'s).
  **Limit found:** on boolean-joined parts OCCT's thick solid often reports done and returns the part un-hollowed (rims, n9, n10). `lib.mjs`
  uses an OCCT shell number only when BRepCheck passes and at least 10 % of the part was removed, and records the rejected number. Rows without a usable
  OCCT number are labelled `MATCH(P only)`. **A WRONG verdict needs both references.**
- brep-rs (archived, read-only) where it builds (one boolean timing row).
- Tolerance: 1e-3 rel (fuzz README) for shells and fillets. Primitives use the contract bars (planar 1e-9, curved 3e-4, plus bbox, COM and faces).

## Counts, side by side with truck

A "match" is a build within tolerance of every usable reference. "Refused" means refused by the engine or the layer. "Wrong" means built and off **both** references. "Hang" means the wall limit was reached (300 s per case).

| set | cases | rc.2 match / refused / wrong / hang | truck: same set | notes |
|---|---|---|---|---|
| raw kernel probe (`raw-probe.mjs`): 16 fuzz repros, rim 8, ligament 11, critic 7 (incl. control), n7, n17b | 44 | 37 / 5 / 0 / 0 (+1 one-oracle suspect n7, +1 no oracle) | no 0.21.0 raw run; on the p7/p8 CLIs **15 of the 16 repros were WRONG**, 1 refused | of the 37: 15 agree with P **and** OCCT (Intersection join), 21 with P only, 1 (`lig-web1.5-east`, no P) with OCCT only. OCCT Arc misses `n17b` and the counterbore by 1.4e-3 and 2.5e-3, a convention difference: Arc rounds concave offsets |
| family C, path A (`shell-draft` + `ctx.resolveAt`) | 11 | 1 / 2 / **8** / 0 | 0.21.0: 9 / 2 / 0 / 0 | the wrong-solid class above |
| family C, shipped `unified` path | 8 | 8 / 0 / 0 / 0 | 0.21.0: 8 / 0 / 0 / 0 | within 2.4e-9 of OCCT-direct (0.21.0: ≤ 1.9e-5, facets) |
| guard fuzz (`fuzz-guard-run.mjs`) | 30 | 5 / 23 / **2** / 0 | 0.21.0: 9 / 21 / 0 / 0 | 2 WRONG = family C; web and gap exactly 2t now refused by the engine (MATCH on 0.21.0) |
| primitives (contract evidence main+edge+far) | 236 | 170 / 19 / 0 / 0 (+45 script-refused, +2 layer throw) | fe3717f evidence: 178 built, 13 refused, 45 script-refused; far curved shapes built wrong volumes, refused by the guard | 2 of the 170 (chamfered boxes) equal the closed form exactly; OCCT's corner convention differs (as on truck) |
| timing rows (8 slanted bores, 6 booleans, 1 groove, 1 fillet) | 16 | 16 / 0 / 0 / 0 | 0.21.0 corrected build: 15 built, `sx-plain-block` traps; 9–218 s | all within 8.6e-7 of OCCT (or of the saved reference) |
| **total (solid verdicts)** | **345** | **237 / 49 / 10 / 0** | – | the 10 wrong rows are one class (8 distinct docs). The other 49 are 45 script refusals, 2 layer throws, 1 one-oracle suspect and 1 row without an oracle |

The sketch contact gap is a separate measure (27 solves), below.

## Per-case tables

### Raw kernel probe (`evidence/raw-probe.json`; guard bypassed, so this measures the kernel, not the shipped verdict)
n/u = the OCCT thick solid was not usable (see Oracles). The truck column is the p7/p8 fe3717f-based CLI record kept in each repro file.
| case | family | rc.2 | V | P | OCCT int / arc | rel P | rel OCCT | s | truck (where recorded) |
|---|---|---|---|---|---|---|---|---|---|
| repro-p8-s1-00475 | repro p8 (A/B/C) | MATCH | 958.0136 | 958.0139 | n/u / 958.0136 | 3.0e-7 | 3.1e-9 | 0.75 | p8 WRONG 959.2526 |
| repro-p8-s1-01097 | repro p8 (A/B/C) | MATCH(P only) | 1596.6968 | 1596.7064 | n/u / n/u | 6.0e-6 | – | 0.80 | p8 WRONG 1635.1680 |
| repro-p8-s1-01455 | repro p8 (A/B/C) | MATCH(P only) | 3774.0889 | 3774.0921 | n/u / n/u | 8.3e-7 | – | 0.78 | p8 WRONG 3708.5304 |
| repro-p8-s1-01589 | repro p8 (A/B/C) | MATCH(P only) | 2170.7608 | 2170.7518 | n/u / n/u | 4.2e-6 | – | 0.75 | p8 WRONG 2196.5776 |
| repro-p8-s2-00591 | repro p8 (A/B/C) | MATCH | 640.0136 | 640.0139 | n/u / 640.0136 | 4.5e-7 | 1.8e-9 | 0.64 | p8 WRONG 641.2128 |
| repro-p8-s2-01541 | repro p8 (A/B/C) | MATCH(P only) | 2557.3500 | 2557.3500 | n/u / n/u | 5.3e-16 | – | 0.35 | p8 WRONG 2635.3500 |
| repro-s1-00031 | repro p7/sweep (A) | MATCH | 1092.7011 | 1092.7044 | 1092.7011 / n/u | 3.0e-6 | 7.8e-12 | 0.61 | p7 WRONG 1117.0315 |
| repro-s1-00038 | repro p7/sweep (A) | MATCH | 3383.7723 | 3383.6788 | 3383.7723 / n/u | 2.8e-5 | 1.2e-11 | 0.75 | p7 WRONG 3390.7693 |
| repro-s1-00201 | repro p7/sweep (A) | MATCH(P only) | 2186.9897 | 2187.0095 | n/u / n/u | 9.0e-6 | – | 0.63 | p7 WRONG 2354.6269 |
| repro-s1-00501 | repro p7/sweep (A) | REFUSED: solid.shell: invalid input: shell: the 2.5 mm walls would meet along a line (between a hol | – | 2320.2219 | n/u / n/u | – | – | 0.35 | p7 WRONG 2353.9684 |
| repro-sw-0164 | repro p7/sweep (A) | MATCH | 2542.6768 | 2542.6720 | 2542.6768 / n/u | 1.9e-6 | 4.6e-11 | 0.58 | p7 WRONG 2553.1870 |
| repro-sw-0177 | repro p7/sweep (A) | MATCH | 2674.3547 | 2674.3420 | 2674.3547 / n/u | 4.7e-6 | 2.0e-11 | 0.92 | p7 WRONG 2681.8593 |
| repro-sw-0195 | repro p7/sweep (A) | MATCH(P only) | 2571.6549 | 2571.6492 | n/u / n/u | 2.2e-6 | – | 0.48 | p7 WRONG 2585.7772 |
| repro-sw-0196 | repro p7/sweep (A) | MATCH(P only) | 2736.0000 | 2736.0000 | n/u / n/u | 8.3e-16 | – | 0.28 | p7 WRONG 2776.0000 |
| repro-sw-0286 | repro p7/sweep (A) | REFUSED: solid.shell: invalid input: shell: the 1 mm walls would meet along a line (between a hole  | – | 2864.0000 | n/u / n/u | – | – | 0.25 | p7 REFUSED |
| repro-sw-0310 | repro p7/sweep (A) | MATCH | 2733.1085 | 2733.1006 | 2733.1085 / n/u | 2.9e-6 | 1.7e-11 | 0.64 | p7 WRONG 2752.1508 |
| rim-w3 | A rim on the open face | MATCH(P only) | 2824.0000 | 2824.0000 | n/u / n/u | 1.6e-16 | – | 0.38 |  |
| rim-w2.5 | A rim on the open face | MATCH(P only) | 2848.0000 | 2848.0000 | n/u / n/u | 1.6e-16 | – | 0.32 |  |
| rim-w2.05 | A rim on the open face | MATCH(P only) | 2869.6000 | 2869.6000 | n/u / n/u | 1.6e-16 | – | 0.33 |  |
| rim-w2.006 | A rim on the open face | MATCH(P only) | 2871.7120 | 2872.0000 | n/u / n/u | 1.0e-4 | – | 0.32 |  |
| rim-w2.002 | A rim on the open face | MATCH(P only) | 2871.9040 | 2872.0000 | n/u / n/u | 3.3e-5 | – | 0.32 |  |
| rim-w2 | A rim on the open face | REFUSED: solid.shell: invalid input: shell: the 1 mm walls would meet along a line (between a hole  | – | 2872.0000 | n/u / n/u | – | – | 0.25 |  |
| rim-w1.95 | A rim on the open face | MATCH(P only) | 2865.5425 | 2865.5425 | n/u / n/u | 3.2e-16 | – | 0.33 |  |
| rim-w1.5 | A rim on the open face | MATCH(P only) | 2802.2500 | 2802.2500 | n/u / n/u | 1.6e-16 | – | 0.39 |  |
| lig-web1.0-east | A hole ligament | MATCH(P only) | 2524.9280 | 2524.9300 | n/u / n/u | 8.1e-7 | – | 0.62 |  |
| lig-web1.0-north | A hole ligament | MATCH(P only) | 2524.9280 | 2524.8700 | n/u / n/u | 2.3e-5 | – | 0.68 |  |
| lig-web1.5-east | A hole ligament | MATCH(occtInt only) | 2542.6768 | – | 2542.6768 / n/u | – | 6.2e-11 | 0.64 |  |
| lig-web1.9-east | A hole ligament | MATCH | 2551.8804 | 2551.8800 | 2551.8804 / n/u | 1.7e-7 | 5.2e-11 | 0.68 |  |
| lig-web2.0-east | A hole ligament | REFUSED: solid.shell: invalid input: shell: the 1 mm walls would meet along a line (between a hole  | – | 2552.8053 | n/u / n/u | – | – | 0.39 |  |
| lig-web2.1-east | A hole ligament | MATCH | 2552.8053 | 2552.8053 | 2552.8053 / 2552.8053 | 1.2e-12 | 1.2e-12 | 0.51 |  |
| lig-web3.0-east | A hole ligament | MATCH | 2552.8053 | 2552.8053 | 2552.8053 / 2552.8053 | 2.8e-13 | 2.8e-13 | 0.54 |  |
| lig-two-gap1.0 | A hole ligament | MATCH(P only) | 2661.3536 | 2661.1000 | n/u / n/u | 9.5e-5 | – | 1.09 |  |
| lig-two-gap1.9 | A hole ligament | NO-ORACLE | 2680.9550 | – | n/u / n/u | – | – | 1.00 |  |
| lig-two-gap2.1 | A hole ligament | MATCH | 2681.6106 | 2681.6106 | 2681.6106 / 2681.6106 | 5.2e-12 | 5.2e-12 | 0.82 |  |
| lig-centre | A hole ligament | MATCH | 2552.8053 | 2552.8053 | 2552.8053 / 2552.8053 | 3.0e-13 | 3.0e-13 | 0.57 |  |
| counterbore-open-top | critic | MATCH(P) | 2628.2035 | 2628.2035 | 2628.2035 / 2621.7628 | 1.5e-12 | 1.5e-12 | 0.65 |  |
| n7-vertex-boss | n7 | WRONG?(one oracle) | 2936.0000 | 2720.0000 | n/u / n/u | 7.9e-2 | – | 0.24 |  |
| n17b-box-on-cylinder-wall | n17b | MATCH(P) | 3760.8537 | 3760.8537 | n/u / 3755.6357 | 1.0e-8 | 1.4e-3 | 0.69 |  |
| n6-rounded-plate-boss | critic | MATCH(P only) | 2729.6460 | 2729.6460 | n/u / n/u | 4.7e-9 | – | 0.74 |  |
| n9-corner-boss-hole | critic | MATCH(P only) | 3002.1947 | 3002.1950 | n/u / n/u | 1.1e-7 | – | 0.51 |  |
| n10-round-boss | critic | MATCH(P only) | 2586.1526 | 2584.2210 | n/u / n/u | 7.5e-4 | – | 0.52 |  |
| n11-round-pocket-floor-open | critic | MATCH | 3393.7522 | 3393.7520 | n/u / 3393.7522 | 6.5e-8 | 5.7e-13 | 0.49 |  |
| n8b-pad-0.5 | critic | REFUSED: solid.shell: not supported yet: SMLib shell for this geometry | – | 2474.0000 | n/u / n/u | – | – | 0.21 |  |
| control-plain-open-top | control | MATCH | 2424.0000 | 2424.0000 | 2424.0000 / 2424.0000 | 3.8e-16 | 0.0e+0 | 0.21 |  |

Reading: **every documented truck wrong-solid repro builds correctly on solidcore.** That covers family A (hole web or gap in [t, 2t), blind hole or pocket floor
toward the open face, rim on the closed face), family B (convex plate with blind hole), family C (R = 1.5t bottom fillet in ONE call), the
474-sweep rows, and the stepped-body large-offset rows. The largest repro deviation from P is 2.8e-5. Where a usable OCCT number exists in the same convention, it agrees to ≤ 3.1e-9.
The hole-ligament and rim sweeps that truck p8 refused for gaps in (t, 2t) now build and match: `lig-two-gap1.9` (no P in the source probe) builds 2680.9550. The guard fuzz P for the same geometry is 2680.94 (5.6e-6).
The engine itself now **refuses exactly 2t** ("the 1 mm walls would meet along a line ...", `rim-w2`, `lig-web2.0-east`, and in the guard fuzz
`A-thru-web-2`, `A-twohole-gap-2`), which 0.21.0 built and matched. A pad thinner than t (`n8b`) is refused as "not supported yet: SMLib shell for
this geometry". The stepped L body `s1-00501` is refused (walls meet along a line); truck p7 built it 1.5 % wrong. The rim P for w ≤ 2t comes from `oracle.mjs`
on the self-checked rim model. An earlier draft of this probe extrapolated the w > 2t line there, which was wrong (`run1` flagged 2 false suspects).

### Family C (`evidence/family-c.json`, `family-c-run.mjs` unchanged)
| case | path A (shell-draft, ctx.resolveAt) | layer V | OCCT direct | P | rel vs OCCT direct | rel vs P | unshelled part: layer vs direct | OCCT buildDoc | shipped (unified) | 0.21.0 path A / shipped |
|---|---|---|---|---|---|---|---|---|---|---|
| control-plain-box-t1 | **MATCH** | 2424.0000 | – | 2424.0000 | 0.0e+0 | 5.6e-16 | – | 2424.0000 | – | MATCH 3.8e-16 / – |
| C-plain-40x30x10-t0.5-R0.75 | **WRONG** | 1236.3774 | 1240.5800 | 1240.5802 | 3.4e-3 | 3.4e-3 | 3.9e-4 | 1236.3774 | MATCH 1.2e-9 | MATCH 1.7e-5 / MATCH |
| C-plain-40x30x10-t1-R1.5 | **WRONG** | 2348.2758 | 2364.7286 | 2364.7293 | 7.0e-3 | 7.0e-3 | 1.5e-3 | 2348.2758 | MATCH 1.5e-9 | MATCH 4.9e-6 / MATCH |
| C-plain-40x30x10-t1.5-R2.25 | **WRONG** | 3339.8445 | 3376.0586 | 3376.0597 | 1.1e-2 | 1.1e-2 | 3.4e-3 | 3339.8445 | MATCH 5.1e-10 | MATCH 1.3e-5 / MATCH |
| C-plain-40x30x10-t2-R3 | **WRONG** | 4215.2330 | 4278.1828 | 4278.1845 | 1.5e-2 | 1.5e-2 | 5.9e-3 | 4215.2330 | MATCH 2.1e-10 | MATCH 1.9e-5 / MATCH |
| C-plain-40x30x10-t2.5-R3.75 | **WRONG** | 4978.5904 | 5074.7141 | 5074.7145 | 1.9e-2 | 1.9e-2 | 9.1e-3 | 4978.5904 | MATCH 5.9e-10 | MATCH 6.7e-6 / MATCH |
| C-repro-s1-00475 | **WRONG** | 952.9526 | 958.0136 | 958.0139 | 5.3e-3 | 5.3e-3 | 6.6e-4 | 952.9526 | MATCH 3.1e-9 | MATCH 3.1e-6 / MATCH |
| C-repro-s2-00591 | **WRONG** | 637.5278 | 640.0136 | 640.0139 | 3.9e-3 | 3.9e-3 | 6.4e-4 | 637.5278 | MATCH 1.8e-9 | MATCH 3.6e-6 / MATCH |
| C-gen-s2-01562 | **WRONG** | 502.3730 | 504.8588 | 504.8259 | 4.9e-3 | 4.9e-3 | 1.0e-3 | 502.3730 | MATCH 2.4e-9 | MATCH 5.0e-6 / MATCH |
| B-gen-s1-01725 | **REFUSED** | – | – | 1414.1543 | – | – | 4.0e-3 | 4590.2793 | – | REFUSED  / – |
| B-gen-s2-00829 | **REFUSED** | – | – | 2752.2761 | – | – | 4.5e-3 | 5616.1987 | – | REFUSED  / – |

### Guard fuzz (`evidence/fuzz-guard.json`, `fuzz-guard-run.mjs` unchanged; 0.21.0 = `~/.cache/solidcraft-0.21.0-rig/next-loop/state/p1-fuzz-guard.json`)
| case | rc.2 | V | P | rel | guard | 0.21.0 | 0.21.0 V |
|---|---|---|---|---|---|---|---|
| plain-open-top | MATCH | 2424.0000 | 2424.0000 | 5.6e-16 |  | MATCH | 2424.0000 |
| plain-centered-hole | MATCH | 2552.8053 | 2552.7998 | 2.1e-6 |  | MATCH | 2552.7953 |
| A-thru-web-0.95 | REFUSED | – | 2522.8931 | – | G-HOLE | REFUSED | – |
| A-thru-web-1 | REFUSED | – | 2524.9252 | – | G-HOLE | REFUSED | – |
| A-thru-web-1.05 | REFUSED | – | 2526.9178 | – | G-HOLE | REFUSED | – |
| A-thru-web-1.5 | REFUSED | – | 2542.6720 | – | G-HOLE | REFUSED | – |
| A-thru-web-1.9 | REFUSED | – | 2551.8731 | – | G-HOLE | REFUSED | – |
| A-thru-web-2 | REFUSED | – | 2552.7998 | – | engine | MATCH | 2552.7962 |
| A-thru-web-2.05 | MATCH | 2552.8053 | 2552.7998 | 2.1e-6 |  | MATCH | 2552.7953 |
| A-thru-web-3 | MATCH | 2552.8053 | 2552.7998 | 2.1e-6 |  | MATCH | 2552.7953 |
| A-twohole-gap-1 | REFUSED | – | 2661.3441 | – | G-HOLE | REFUSED | – |
| A-twohole-gap-1.5 | REFUSED | – | 2674.3420 | – | G-HOLE | REFUSED | – |
| A-twohole-gap-1.9 | REFUSED | – | 2680.9402 | – | G-HOLE | REFUSED | – |
| A-twohole-gap-2 | REFUSED | – | 2681.5997 | – | engine | MATCH | 2681.5906 |
| A-twohole-gap-3 | MATCH | 2681.6106 | 2681.5997 | 4.1e-6 |  | MATCH | 2681.5906 |
| A-blind-floor-0.5 | REFUSED | – | 2559.0830 | – | G-BLIND | REFUSED | – |
| A-blind-floor-1 | REFUSED | – | 2565.3661 | – | G-BLIND | REFUSED | – |
| A-blind-floor-1.05 | REFUSED | – | 2565.9944 | – | G-BLIND | REFUSED | – |
| A-blind-floor-1.5 | REFUSED | – | 2571.6492 | – | G-BLIND | REFUSED | – |
| A-blind-floor-1.9 | REFUSED | – | 2576.6757 | – | G-BLIND | REFUSED | – |
| A-blind-floor-2 | REFUSED | – | 2577.9323 | – | G-BLIND | REFUSED | – |
| A-blind-floor-3 | REFUSED | – | 2562.2250 | – | G-BLIND | REFUSED | – |
| B-boss-open-top | REFUSED | – | 2664.0000 | – | G-CONVEX | REFUSED | – |
| C-bfillet-t1-R1.5 | **WRONG** | 2348.2758 | 2364.7293 | 7.0e-3 |  | MATCH | 2364.7170 |
| C-bfillet-t0.5-R0.75 | **WRONG** | 1236.3774 | 1240.5802 | 3.4e-3 |  | MATCH | 1240.5590 |
| A-pocket-floor-1.5 | REFUSED | – | 2916.0000 | – | G-CONVEX | REFUSED | – |
| A-pocket-floor-2 | REFUSED | – | 2976.0000 | – | G-CONVEX | REFUSED | – |
| A-pocket-floor-3 | REFUSED | – | 2928.0000 | – | G-CONVEX | REFUSED | – |
| A-convex-vfillet-thru-gl1.5 | REFUSED | – | 2534.1191 | – | G-HOLE | REFUSED | – |
| A-convex-vfillet-blind-gl1.5 | REFUSED | – | 2515.4950 | – | G-BLIND | REFUSED | – |

### Primitives (`evidence/primitives.json`; the contract `primitives` group's 236 live cases, `primitives-sweep.mjs`, phase0 translator, no guard)
Built 170: box 45, cylinder 34, cone 22, torus 23, sphere 16, prism 20, wedge 8, turned 2. Worst volume error vs OCCT is 2.5e-9 for curved shapes
(`cyl-needle`) and 5e-16 for planar ones. The exceptions are the two all-edge chamfered boxes: 13086 and 6464, **exactly** the independent chamfer-polytope
closed form (`contract/primitives-evidence/chamfer-polytope.txt`) and the same as truck. OCCT's corner convention gives 13068 and 6421.3 with 26 faces, against 18.
Faces, bbox and COM are inside the contract bars on every other built row. 19 are refused by the engine: over-large rounds; horn, spindle and degenerate tori;
fillet 1e-6; far rounded boxes at 1e4 and above and a far sphere at 1e5, all "SMLib's check refuses the result". On truck the far curved shapes built wrong.
Median kernel time is 130 ms, p90 461 ms, max 1.8 s (`cyl-disc`). Every primitive kind in the contract (box, cylinder, sphere, cone, torus, prism, wedge, rounded box,
rounded cylinder) builds and matches OCCT and the closed form wherever the engine builds it. Every built row passes the contract bars, apart from the two chamfers explained above.

### Timing (`evidence/timing-*.json`, `timing-slant.txt`, `timing-oracles.json`)
Walls are the harnesses' own (child process per case, so the wall includes the 110 MB module's compile). Truck walls are the corrected 0.21.0
build's (`fuzz/REMAINING-LOOP-PHASE3.md`). No case hung or trapped on rc.2.

| case | rc.2 wall | rc.2 status | rc.2 vs reference | 0.21.0 corrected wall / status |
|---|---|---|---|---|
| `fz7-038-cyl-sph-sub` | 2.7 s | built (same as original translator) | OCCT 9.9e-12 | 40.5 s, built |
| `r3-split-cone-slab` | 2.2 s | built | OCCT 2.1e-8 | 10.5 s |
| `fz17-043-box-con-box-uni` | 1.8 s | built | OCCT 4.3e-9 | 46.1 s |
| `fz17-109-wed-con-uni` | 1.5 s | built | OCCT 5.2e-9 | 9.0 s |
| `fz23-087-sph-box-uni` | 3.4 s | built | OCCT 8.5e-9 | 22.8 s |
| `r6-tiny-cone-minus-ball-r12.5` | 1.9 s | built | OCCT 3.1e-10, brep-rs 3.1e-10 | 10.5 s |
| `R5-frustum-wall-mid-90` (groove) | 1.1 s | built | saved OCCT 57378.35331601 vs 57378.35331561 (7e-12) | 16.5 s |
| `pf-corner-then-join` (fillet) | 7.3 s | built (same as original) | none (a fillet chain; buildDoc is not a valid referee there) | 218.1 s |
| `sx-plain-block` (raw, kernel only) | 0.18 s | built 35858.6283 | OCCT 2.1e-7 | **traps** (0.2 s) |
| `sx-hole-clear` | 0.18 s | built | OCCT 4.3e-7 | 0.9 s |
| `sx-hole-cross` | 0.33 s | built | OCCT 9.8e-8 | 10.3 s |
| `sx-hole-cross-a` | 0.28 s | built | OCCT 2.1e-7 | 4.2 s |
| `sx-hole-cross-d` | 0.26 s | built | OCCT 3.1e-8 | 9.1 s |
| `sx-hole-cross-e` | 0.20 s | built | OCCT 8.6e-7 | 1.1 s |
| `sx-pocket-cross` | 0.19 s | built | OCCT 5.0e-7 | 0.75 s |
| `sx-pocket-cross-a` | 0.17 s | built | OCCT 6.1e-7 | 0.69 s |

The 45 s bore budget (G-BUDGET) and the slanted-round class guard were set by truck's walls; on rc.2 none of these rows comes near them.
No guard is changed here, and promotion still needs the guard fuzz plus FreeCAD agreement (`fuzz/NEXT-LOOP-PHASE2.md`).

### Sketch contact gap and tangency residual (`evidence/sketch-contact.json`; SolidCraft's own sketch solver, not solidcore)
Same probes, same LCG starts as `phase7/probe-sketch-limit.mjs`, mapped by `phase2/sketch-map.mjs`, read from the topology wrapper's `@sketch` dump.
The reference is the foot of the circle centre on the solved line (closed form).

| probe | rc.2 contact error (mm) | solver report | phase 7 (fe3717f + local solver patch) |
|---|---|---|---|
| circle, distance-pinned | 7.4e-5 .. 1.26e-4 on 8 of 8 | solved, dof 2, nothing failing or redundant, residual ≤ 1e-9 | 6.7e-5 .. 1.08e-4 |
| circle, Symmetric-tied | 1.26e-4 .. 1.36e-4 on 8 of 8 | solved, dof 2 | 7.6e-5 .. 1.16e-4 |
| arc, distance-pinned | 8.9e-5 .. 9.0e-5 on 8 of 8 | solved, dof 4 (the open arc cannot be extruded) | 6.3e-5 .. 1.14e-4 |
| exact-tangent starts | circle: refused ("already determined ..."); Symmetric 2.8e-7 (one redundant); arc 2.2e-5 | as phase 7 | same pattern |

**Unchanged:** a line-to-round contact held only by a distance or a Symmetric still lands about 1e-4 mm off and is reported "solved" with no warning.
The touch-free tangent residual (≤ 1e-9) cannot see it. This is SolidCraft's solver, so moving to solidcore does nothing for it, and the planned post-solve contact check is still needed.

## C1–C4, updated (swap conditions, `docs/PLAN-scripting-layer.md` phase 5; this morning: `SOLIDCORE-REPROBE-2026-11.md`)

| # | Condition | This morning | Now | Evidence |
|---|---|---|---|---|
| C1 | primitive, boolean, offset, blend units all green | not met | **not met (not re-read)** | Site-level unit status was not re-probed. rc.2 pins solidcore rev `8ddce901` (1.0.1). This probe's whole-solid results do not change a unit-parity reading |
| C2 | a release newer than 0.0.x | met, caveat | **met** | solidcore 1.0.1, now shipped as the only kernel of a SolidCraft release candidate. The stable 0.30.1 is still truck |
| C3 | browser-loadable wasm API | unknown | **met for the engine API; browser page load not exercised here** | The unmodified rc.2 engine builds for wasm32 with our referee wrapper **unchanged** (one trait import in the test-only topology wrapper). It is JS-callable through wasm-bindgen and the same `execute` / `inspect.measure` API. Upstream itself ships `solidcraft-web-0.40.0-rc.2.zip` running solidcore in the browser. Costs: 110 MB with line tables, an 8 MiB stack link argument. Still to do: a `--target web` load in a page and a Worker |
| C4 | whole-solid checks beyond the 9 primitives against an independent oracle | not met | **checked; one wrong-solid class** | This probe: booleans (6 timing rows, ≤ 2.1e-8 vs OCCT), slanted cuts (8, ≤ 8.6e-7), shells (37 raw builds vs P and OCCT, 0 wrong; all 16 truck repros fixed), groove and fillet. **Fails on named fillets sent one edge per call (tangent-chain propagation), wrong vs two oracles** |

## Recommendation

**Wait for 0.40 stable; do not run the full contract remeasure on rc.2.** On the kernel itself solidcore is the better kernel by every measure taken
here. Every documented truck wrong-solid repro (families A, B, C; 16 rows) builds within 2.8e-5 of P. Curved volumes are exact rather than
faceted. There are no hangs or traps, and it is 4–35x faster on the old hang and slant rows. So the move should be planned, not dropped. But the first thing it shows is
a **new silent wrong solid through the layer's `shell-draft` set**, which the live gate catches (2 WRONG, exit 1) and the guard layer does not. It
also shows two layer behaviours to fix first: the layer throws on an `ok` reply that carries an errored body, and the engine now refuses exactly 2t and some thin pads. And rc.2 is a pre-release whose
own notes list fillet and shell failures. Before 0.40 stable the work is on our side of the seam and does not depend on the rc. Send named fillets on
one body as one call per connected chain in every planner set (as `fillet-chamfer.ts` already does), or refuse otherwise. Add a post-build face-count or
S check to the fillet step. Turn an errored body into a refusal sentence. Then remeasure the full contract on 0.40.0 stable.

## Reproduce

```sh
R=~/.cache/solidcraft-0.40.0-rc.2-rig        # rig: sc-src, wrapper{,-topology} (manifests in solidcore-0.40.0-rc.2/rig/), shadow/, logs/, out/
systemd-run --user --unit=reshape-sA-build --collect -p MemoryMax=8G sh -c "$R/build.sh > $R/logs/build.log 2>&1; echo EXIT=\$? >> $R/logs/build.log"
# oracle self-check first (copies of fuzz/{oracle,selfcheck,selfcheck2}.mjs under $R/selfcheck)
systemd-run --user --unit=reshape-sA-probe --collect -p MemoryMax=8G sh -c \
  "flock $R/rig.lock sh docs/spikes/solidcraft-referee/solidcore-0.40.0-rc.2/run-all.sh"    # STEPS="raw familyc guard sketch prims timing"
node docs/spikes/solidcraft-referee/solidcore-0.40.0-rc.2/fillet-sequence-probe.mjs [pkg]    # the wrong-solid mechanism, any pkg
BREP_PKG=$R/shadow/archive/brep-rs/pkg node docs/spikes/solidcraft-referee/solidcore-0.40.0-rc.2/timing-oracles.mjs $R/out/timing-booleans/live-replay-booleans.json
node docs/spikes/solidcraft-referee/solidcore-0.40.0-rc.2/summarize.mjs > docs/spikes/solidcraft-referee/solidcore-0.40.0-rc.2/evidence/summary.json
```
Evidence: `solidcore-0.40.0-rc.2/evidence/` (raw JSON for every table, the self-check logs, pkg hashes). The 0.21.0 comparisons read
`~/.cache/solidcraft-0.21.0-rig/next-loop/state/p1-{famc,fuzz-guard}.json` (read only). The 0.21.0 rig's pkgs were not touched; the
`fillet-sequence-probe.mjs` 0.21.0 column loads `sc-corrected-pkg` read-only.
