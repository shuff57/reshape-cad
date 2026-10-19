# Phase 1 resume note (2026-10-18, written when the run was stopped to switch computers)

State: the Phase 1 workflow (run wf_a59f30c4-db7) was STOPPED during the Contract stage. Not done: the critic's final verdict on
several groups, the Assemble stage, and docs/spikes/solidcraft-referee/LAYER-CONTRACT.md (does not exist yet).
What is committed: the 14 per-group <group>.json files, the evidence/harness folders next to them, and RIG.md (rig recipe).
The group JSONs are the builders' latest rows. Treat a group as NOT accepted unless a critic accepted it; the accepted/not-accepted
record lived in the local workflow journal and did not travel. Re-run a critic per group (or re-run the workflow) to find out.

Does not travel (local only): the workflow journal and script under ~/.claude, the built solidcraft wasm pkg and the shadow root in
the old session's scratchpad (RIG.md paths point at it), node_modules, dist, archive/brep-rs/pkg.
To rebuild the rig on a new machine: clone bherbruck/solidcraft, check out fe3717f (not the local/loading-screen branch), build the
wrapper per docs/spikes/solidcraft-referee/REPORT.md, `wasm-pack build --release --target web --out-dir pkg` in archive/brep-rs, then `bun install`.
Note the wrapper/Cargo.toml hardcodes /home/shuff57/solidcraft: patch a copy, not the repo file.

Next (per docs/PLAN-scripting-layer.md): finish Phase 1, then stop and review before Phase 2. Do not start Phase 2 unasked.
