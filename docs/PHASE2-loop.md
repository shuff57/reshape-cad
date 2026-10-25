# Phase 2 loop (one group per pass)

Decided 2026-10-24: target SolidCraft **0.21.0** (tag `v0.21.0`, rig in `/tmp/contract-0.21.0`, rebuild with `contract/run-contract.sh --rig --commit v0.21.0 --out /tmp/contract-0.21.0`), new layer in **TypeScript**, **one group per pass, stop on any row change**. One agent at a time, commands under `MemoryMax=1500M`. Nothing pushed, filed or posted. Do not edit `archive/`, the frozen gate scripts, or upstream. State lives in `docs/PHASE2-loop-state.json`; read it first, write it last.

Order: extrude-pocket, holes, shell-draft, patterns-mirror, booleans, revolve-groove, then the rest (see `PHASE2-guard-layer-work-plan.md`).

## One pass, for the first group whose state is not `done`
1. **Baseline on 0.21.0.** Measure the group into the scratch worktree (`contract/contract-commands.json` `measure`), then rebuild its rows (`rebuild`) so they really come from the new run. Check the inputs the rebuild reads were refreshed by the run (some measure commands write to `--out`, some overwrite a repo file; a fuzz run with one seed overwrites a two-seed merged file). Save the rows to `contract/measured-0.21.0/<group>.json`. If the baseline cannot be made honest, set the state to `blocked` with the reason and stop.
2. **Diff against the 0.9.0 rows by feature name** (not by index). Every changed status or sentence is listed in the state file with its evidence. A row that went from refused to builds-and-matches, or supported to wrong, is reported, not applied.
3. **Fold** that group's translator fork into the layer package (`packages/layer`, TypeScript, strict), starting from `phase0/translate.mjs`. Port its pure guards beside it.
4. **Replay** the group's rows through the layer. Required: every feature's status and sentence equals the 0.21.0 baseline from step 1.
5. If identical: run the package tests, commit (message ends with the Co-Authored-By trailer), mark the group `done` in the state file, and **stop the pass**. If anything differs: write it to the state file, commit the state only, and **stop for the owner**. Never carry on past a changed row.
