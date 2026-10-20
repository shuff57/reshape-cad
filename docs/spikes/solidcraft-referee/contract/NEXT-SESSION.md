# Finish Phase 1: prompt for a fresh session (written 2026-10-19)

Read first, in order: `RESUME.md` (this folder), `docs/PLAN-scripting-layer.md` (Phase 1 section), `RIG.md` (this folder), `../REPORT.md`.

## Goal
Finish Phase 1 of the scripting-layer plan: produce `docs/spikes/solidcraft-referee/LAYER-CONTRACT.md`, the measured contract of what the layer supports, refuses, or gets wrong, with every claim backed by evidence in this folder. Then STOP and report. Do not start Phase 2, and do not push, file or post anything without the owner approving.

## State at the stop (from RESUME.md, unverified)
- The Phase 1 workflow run `wf_a59f30c4-db7` was stopped during the Contract stage.
- The builders' rows for the groups are committed as `<group>.json` here, with their evidence and harness files beside them. There are 13 such files (RESUME.md says 14; checked 2026-10-19): blend-loft, booleans, extrude-pocket, fillet-chamfer, holes, move-turn, patterns-mirror, picks-naming-params, primitives, revolve-groove, shell-draft, sketch-constraints, sketch-geometry. `outline-guard.mjs` is a guard module, not a group with rows. Look for a 14th group (e.g. in the workflow script or git log of f133555e) before assuming one is missing; if none is found, say so in the contract. The plan names no group list.
- Which groups a critic accepted is NOT recorded. That record lived in the local workflow journal and was lost. Treat every group as not accepted until a critic accepts it in this session.
- `LAYER-CONTRACT.md` does not exist.

## Steps
1. Rebuild the rig (nothing from the old session's scratchpad exists on this box):
   - Toolchain on this box as of 2026-10-19: `bun`, `cargo` and `wasm-pack` are NOT on PATH (`~/.cargo/bin` exists, check it; install bun and wasm-pack if absent). `node` is /usr/bin/node. `archive/brep-rs/pkg` does not exist yet. `RIG.md` and the harness scripts call `bun` and `systemd-run`.
   - `~/solidcraft` already exists and contains commit `fe3717f`; use `git archive fe3717f` from it rather than cloning, and do not disturb its checkout.
   - Build the wrapper per `../REPORT.md`. Its `Cargo.toml` hardcodes `/home/shuff57/solidcraft`, so patch a copy, not the repo file.
   - In `archive/brep-rs`: `wasm-pack build --release --target web --out-dir pkg`, then `bun install` at the repo root.
   - Repoint the paths in `RIG.md` at the new locations. Do not edit the committed `RIG.md` in place without saying so.
2. Run one independent critic per group over its rows and evidence. The critic must be harsh and must not have seen the builder's reasoning. Record accepted or not accepted, with reasons, in a new file (for example `contract/CRITIC-VERDICTS.json`), so the record travels this time.
3. For each rejected group, send it back to a builder, fix it, and re-critique. Cap this at 2 rounds per group. Anything still rejected goes into the contract as "unresolved", not as supported.
4. Assemble `LAYER-CONTRACT.md` from the accepted groups only. Per the plan's Phase 1 exit the plan's Phase 1 exit is "a table checked against live results", and Phase 1 also asks for: every script feature, 2D and 3D, as supported / refused (with its sentence) / unsupported; a comparison against what brep-rs supported (chamfer on convex edges, counterbore, countersink, groove, cone and sphere bores); and a re-runnable rig recipe with one evidence command per row. The thresholds, adapter-only swap note and one-command re-run are Phase 5's exit; include them as the owner's addition, and add that command or script.
5. Commit the verdict file, the contract and any fixes, and report: groups accepted, groups unresolved, and what was not measured.

## Watch
- Run builders, critics and any long sweep so partial results are committed or written to disk as they finish. The last run died with partial sweeps and lost state.
- Never add a `depth: 0` fixture. It hangs OCCT.
- Do not edit the lead-owned gate scripts (`scripts/brep-*.mjs`, `check-record.mjs`, `occt-modeldoc-gate.mjs`).
- Do not delete the OCCT referee apparatus under `packages/brep-adapter/src/` or `packages/script/src/topo-history.ts`.
- `3b961429` says the kernel was retired to `archive/` and Phase 2 stopped. Phase 2 stays stopped unless asked.
- Check `.msgbox` claims (`node .msgbox/msg.mjs owners` if it exists on this box) before editing a package another agent holds.
