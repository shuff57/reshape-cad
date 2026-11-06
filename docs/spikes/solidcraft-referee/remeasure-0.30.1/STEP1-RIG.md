# Stage B step 1: the 0.30.1 rig

Date: 2026-11-06. SolidCraft `v0.30.1` = `8e2b0cd60d14b4152b12b8f1fdb2bcfdcd8c52f4` (stable, truck kernel), from the
`~/solidcraft` clone by `git archive` (the clone's checkout untouched). Rig dir: `~/.cache/solidcraft-0.30.1-rig/`.

## What was built

| dir | from | wasm sha256 |
|---|---|---|
| `sc-src/` | `git archive v0.30.1` (unmodified) | — |
| `sc-referee-pkg/` | `kernel/` = copy of `packages/solidcraft-host/kernel` (its `src/lib.rs` is byte-identical to `docs/spikes/solidcraft-referee/wrapper/src/lib.rs`) | `9dc93a11…2b03936e` |
| `sc-referee-pkg-topology/` | `wrapper-topology/` = copy of `docs/spikes/solidcraft-referee/phase2/wrapper2` (crate `solidcraft-referee-p2`) | `82cb23fa…6d95143bf2` |

`sc-referee-pkg` **is** the corrected kernel build (same `lib.rs`, same profile); there is no separate `sc-corrected-pkg` at
0.30.1. Builder: `step1-build-all.sh` (one shared `CARGO_TARGET_DIR`, `--jobs 8`), log `logs/rig-build.log`, 3 min 43 s,
`EXIT=0`. Generated manifest: `step1-kernel-Cargo.toml` (the topology one differs only in the crate name).

## Changes against the committed wrapper / kernel template (all in COPIES in the rig dir)

1. Dependency paths point at the rig's `sc-src` (as `run-contract.sh --rig` and `kernel/build.sh` already do).
2. `[patch.crates-io]` is upstream v0.30.1's root block **verbatim** (paths made absolute): the five truck/matext patches
   the template already lists, plus `egui-wgpu`, `winit`, `accesskit_macos`, which upstream added since 0.21.0. Cargo reports
   those three as "not used in the crate graph" (UI crates; the engine does not depend on them); the five truck patches are used.
3. `[profile.release]` is upstream v0.30.1's verbatim: opt-level 3, thin LTO, 16 codegen units (as the template), plus
   `debug = "line-tables-only"`, which upstream added. It roughly doubles the wasm (73.7 MB against 35.4 MB) and changes no code.
4. The topology wrapper is built with that same profile and patch list. At 0.21.0 both `sc-referee-pkg` and
   `sc-referee-pkg-topology` were the spike's opt-level "z" build without the `truck-geometry` patch (stock truck-geometry);
   the time-budget numbers used `sc-corrected-pkg` (corrected). At 0.30.1 every package is the corrected build, so the
   parity replays and the time numbers run on the same kernel. Consequence for comparisons: a row that moved between the
   0.21.0 evidence and 0.30.1 can be either the kernel change or the truck-geometry patch; a moved row is cross-checked on the
   0.21.0 rig's `sc-corrected-pkg` (0.21.0 + the patch), read-only, before it is attributed.
5. No source change was needed for API drift: `Session::new`, `execute`, `model.state().sketch()`, `report`, `profiles`,
   `region.interior_point()` all compile unchanged against v0.30.1. The wrapper `edition` stays 2021 (upstream is 2024).

## Exit check: PASS

- Both packages load under Node 22 (`run` on a box returns ok with a measure; the topology wrapper returns per-command results).
- The nine primitives (`box`, `cylinder`, `cone`, `sphere`, `torus`, `prism-hex`, `prism-tri`, `wedge`, `wedge-2`) through
  `phase0/run-phase0.mjs` (shadow root, as `contract/RIG.md` describes, because it hardcodes `packages/brep-rs/pkg`):
  **9 PASS / 0 FAIL against live OCCT**, brep-rs 9/9, 0 unexplained face-type mismatches, `EXIT=0`
  (`step1-primitives-last-run.txt`). Volume, bbox and face columns are identical to the committed 0.9.0 `phase0/last-run.txt`;
  only dCOM moves, at the 1e-17 level.
