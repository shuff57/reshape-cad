# Plan: reSHape Script as a layer on SolidCraft

Status: DRAFT for review, 2026-10-17. Nothing in this plan has been executed except the brep-rs move (see "Already done").

## Direction (decided by the owner)

- reSHape CAD kernel development stops. The FreeCAD parity campaign is dead.
- The work now is the scripting layer only: reSHape Script (2D sketches and 3D parts) running on SolidCraft.
- Build on what SolidCraft has today (truck kernel). Move to SolidCore (its Rust port of NVIDIA SMLib) as it matures.
- First release covers 2D and 3D together. First audience is the owner's students.

## Why we are not waiting for SolidCore

Progress page, commit 60a6806f, 2026-10-18: 113 of 261 units green, 92 partial, 36 claimed, 20 todo. Module coverage: boolean 31%, offset 32%, primitive 8%, blend 3%. The README says nothing works end to end yet and the version is 0.0.x. There is no published roadmap. SolidCraft's current kernel is truck.

## Already done

- `packages/brep-rs` moved to `archive/brep-rs` with `git mv` (staged, not committed). `packages/sandbox-dev/vite.config.ts` and `.github/workflows/ci.yml` repointed. Not built or run since.
- Still pointing at the old path and therefore broken: `scripts/brep-*` gates (lead-owned, untouched), `docs/specs/census`, `docs/specs/fuzz`, `docs/replica` gauntlet scripts, prose in AGENTS.md.
- brep-rs is kept as the independent oracle, not deleted. Restoring it is a `git mv` back.

## What already exists, and what is missing

Exists and tested:
- The language: `packages/script` (interpreter `runScript`, `ModelDoc`, round-trip emitter `toScript`, `solveDoc`) and the 2D solver in `packages/sketch`.
- A working route onto SolidCraft, proved in the spike (phases 0-6): translator, bridge, host page, constrained sketches, named picks, sketch syntax, script pane. Verified per the handoff.

Missing or spike-grade:
- A safe kernel behind the route. Truck builds wrong shells in some cases and has narrower coverage than brep-rs. The guard layer (phase 2) does not exist yet.
- A clean bridge. It is a patch applied to upstream solidcraft-web, so it drifts with upstream (about 411 commits ahead when LOOP-PLAN.md was written). The token is a switch, not authentication.
- Measured translation coverage. Phase 0 scored 11 hand-translated fixtures; how much of the language maps cleanly is unknown until phase 1.
- Committed history. All spike work is untracked; Phase 7 sits on an outdated shell rule.

The language is not the gap. The kernel's correctness and the productization of the plumbing are.

## Architecture

```
reSHape Script (2D/3D DSL, unchanged)
  -> ModelDoc            packages/script
  -> translator          spike phase 0
  -> guard layer         NEW: refuses what the kernel gets wrong
  -> bridge / host page  spike phases 1-6
  -> SolidCraft engine   upstream, unmodified, pinned commit
```

The kernel stays behind one seam so a SolidCore swap touches the adapter only. Upstream is not forked or patched. Defects are handled on our side of the seam.

## Rule

Never a silently wrong solid. A feature the layer cannot build correctly is refused in one plain sentence, alongside whatever did build. With the brep-rs gates retired, the guard layer is what enforces this.

## Phases

### 0a. Retire
STATUS 2026-10-25: DONE, approved by the owner. `docs/replica/freecad` stays in place as reference data by decision (AGENTS.md), so it is not archived. The nine campaign branches are tagged locally as `archive/<name>` on their `origin/*` tips (nothing pushed). `npm test` passes, 292 of 292. `packages/script/test/pocket-rim.test.mjs` still looks for the old `brep-rs/pkg` path but skips the kernel part when it is missing. The list below is the original plan.
- Commit the uncommitted work locally: spike docs, fuzz, fixes, screenshots, HANDOFF.md, LOOP-PLAN.md, and the campaign edits in `docs/specs/census/defs.mjs` and three `docs/replica/.../refs/*.json`.
- Archive `docs/replica/freecad`, `docs/specs/census`, `docs/specs/fuzz` and the `SPEC-brep-*` files under `archive/`. Delete the stray untracked symlink `docs/replica/freecad/freecad` (it points at a stale worktree).
- Move the brep-rs-only tests (about ten in `packages/script/test` and `packages/brep-adapter/test` that read replica fixtures) out of `npm test`.
- Tag, do not delete, the old campaign branches (`fix-g1-g6`, `fix-g2-g3`, `fix-g4-g5`, `s4a-mirror`, `s4b-pattern`, `s4c-hole`, `s4d-hollow`, `s4-cleanup`, `audit-2d`).
- Exit: `npm test` passes on the script layer, the sketch solver and the bridge.

### 0b. Rewrite the rules (owner approves exact text first)
- AGENTS.md currently says one kernel, brep-rs, no fallback, and pins it in `packages/brep-adapter/test/config.test.mjs`. Both change.
- `docs/spikes/solidcraft-referee/DECISION.md` says SolidCraft is a separate product that only shares the DSL. That no longer matches "replace eventually".
- Exit: the docs match the repo.

### 0c. Tell the other sessions
- Sessions on this repo (reshape-cad-2e busy, reshape-cad-5e idle) may still write to `packages/brep-rs`. `.msgbox/log.jsonl` still shows a `freecad-rust` claim on `packages/brep-rs/src` and `docs/specs/census` with no later release.
- Each should commit or stash, stop kernel work, and note the kernel moved. Message text is shown to the owner before sending.

### 1. Layer contract
- List every script feature, 2D and 3D, as supported, refused (with its sentence) or unsupported on SolidCraft.
- Start from `docs/spikes/solidcraft-referee/phase0/COVERAGE.md` and the phase 2 constraint mapping.
- Compare against what brep-rs supported (chamfer on convex edges, counterbore, countersink, groove, cone and sphere bores) to see the capability drop before any student is promised a feature.
- Keep it re-runnable: the rig recipe (pinned SolidCraft commit, wasm build, oracle paths) and one evidence command per row are part of the deliverable, so the same contract can be measured again later against a newer SolidCraft or SolidCore (see phase 5).
- Exit: a table checked against live results.

### 2. Guard layer
- Pre-flight rules for the known truck wrong-solid classes: shell families A and B (wall or ligament between t and 2t), n7 (boss touching the open face at a vertex), n17b (box joined on a cylinder wall), and the tangency residual.
- Post-build check against an independent measure: planar closed-form volume, brep-rs on demand.
- Re-run `fuzz/repros/` first. The handoff states families A, B and C were not verified by its author.
- Family C (bottom fillet at R = 1.5t, off 1.0 to 1.9e-3) may be fillet facets or the oracle. Treat as a documented tolerance unless a second oracle disagrees.
- The shell fuzz oracle (`fuzz/oracle.mjs`) becomes the guard test harness, not a kernel-fix tool.
- Known cost: about 74% of fuzz shell cases currently refuse. Check that plain plates students will try still build.
- Exit: the fuzz shows built or refused for every case, never a wrong solid.

### 3. Student experience
- Reviewable script, plain-sentence refusals, DoF and redundancy report.
- Embedding (decided 2026-10-24, see open decision 1): shCode serves the pinned SolidCraft web build and a small same-origin host page of ours that calls upstream `window.solidcraft` (present from 0.21.0; browser-api.md). Student script stays sandboxed and posts JSON to the host page, which applies its own allowlist. The spike bridge and its token are dropped; the spike patch stays under `docs/spikes/`, unapplied.
- Modelling lock: a teacher can turn the ribbon off while students model and back on later. 0.21.0 has no `ui.set` field for this, and shortcuts and the command palette still start tools. Interim: a host-page overlay over the ribbon plus refusing tool-starting commands at the allowlist. It is a classroom control, not a safety feature; script is the only guarded building path. Upstream request drafted in `docs/DRAFT-upstream-ribbon-request.md` (not filed).
- Replace/Restore round and revolve of a constrained sketch.
- Sketch contact gap: distance-pinned and Symmetric contacts solve with 6e-5 to 1.3e-4 mm error the residual cannot see. Keep documented; add a post-solve contact check later.
- Exit: a walkthrough of 3 to 5 real student tasks.

#### 3a. Kernel in a worker (time budget), decided by the owner 2026-10-27
Problem: the guards for holes, patterns-mirror, booleans and groove cuts call `ctx.runSC(cmds, { budgetS })` and refuse with G-BUDGET on `{ timedOut: true }`. Truck runs as one synchronous wasm call inside SolidCraft's own page, so a slow boolean freezes the whole page and nothing can stop it; the pane's bridge used to ignore `{ budgetS }`.

What the browser can load. The 0.21.0 web build (`solidcraft-web_bg.wasm`, 52 MB) exports only `initSync` and `default` (init): it is the whole egui application and starts itself, so it is not a headless kernel and cannot be used in a Worker. What does exist, without touching upstream, is the rig's referee wasm: a 37 MB wasm-bindgen module built from the unmodified 0.21.0 engine crates by our wrapper (`docs/spikes/solidcraft-referee/wrapper/src/lib.rs`: `Session::new`, `execute(command, params)` per command, then `inspect.measure`). It was built for node; its imports are eight small stubs, so `packages/solidcraft-host/src/probe-kernel.mjs` instantiates it by hand in a browser Worker (no rebuild). The host has to serve the file (`kernel/solidcraft_referee_bg.wasm` next to the pane); without it the budget silently cannot be enforced, and the pane says so.

Design.
- What is probed: the command list of the run that carries `{ budgetS }`, replayed on a scratch session from an empty design. The layer already sends the accepted prior commands plus the feature being accepted in one list, so that is "the feature on a scratch copy of what came before". Runs without `{ budgetS }` (every other kind) are not probed. The sketch-profile pre-run is not probed.
- Where: a fresh Worker per probe (so terminate kills exactly that run), given the compiled module (compiled once on the main thread, posted to each Worker). The student's design is never touched by a probe.
- Limit: the layer's own `budgetS` (45 s + 1.5 x the last run, patterns-mirror 600 s + 2x), clamped to 1..3600 s. The timer is on the main thread and counts from the Worker being started (module instantiation included). On expiry the Worker is terminated.
- Reply: finished in time, the same commands are then applied in SolidCraft by the existing path, and the reply carries `cpuMs` = the Worker's engine time. Timed out: `{ ok:false, timedOut:true, cpuMs, failed:{ command:'(budget)', error:'TIME BUDGET: exceeded N ms' } }`, SolidCraft not touched. The Worker could not run it (wasm trap such as `unreachable`, kernel file missing): refused as `{ ok:false, probeError:true, failed:{ command:'(probe)', ... } }` and SolidCraft not touched, because the same trap in the SolidCraft page would take it down.
- What the student sees: the layer's own G-BUDGET sentence ("... took longer than 45 seconds of computing, so it was stopped and X is shown without it ..."), beside whatever did build, and a page that kept responding. Nothing new in the words.
- Cost: double execution. A budgeted run costs the engine time twice (Worker, then SolidCraft) plus module instantiation per probe, and the two run in parallel threads only in the sense that the page stays free, not that the work overlaps. Measured numbers are in packages/solidcraft-host/README.md.
- Not covered: a run that fits the budget in the Worker and then runs far longer in the page (load, memory); the same wasm trap on the Worker side is reported as a probe error, not as the kernel's refusal; the referee build and the web build are the same sources but two compilations, so a probe can finish where the page does not or the reverse (the real-browser check compares volumes). The layer's `H4_CTL_S` negative control (1e9 s) is clamped to 3600 s here.

### 4. Gates and critic
- A live-reference score on every change, as in phases 0-5.
- A fresh critic pass on the guard layer. Each earlier shell critic round found a new family, so cap hand rounds and prefer the oracle fuzz.
- Exit: accepted.

### 5. Kernel watch
- Re-check the SolidCore progress site periodically.
- Re-check weekly; open a swap spike only when ALL of these hold (APPROVED by the owner 2026-10-25, open decision 4):
  1. The primitive, boolean, offset and blend units are all green on the progress site, not just ported. "Ported" counts partial units and overstates it.
  2. A release newer than 0.0.x exists (today only `solidcore-v0.0.1`, 2026-10-13, tagged "early work in progress"), or the owner accepts pinning a commit.
  3. A wasm build exists that a browser can load: either a JS-callable API (today only `solidcore-ffi`, an `extern "C"` binding to the C++, and no wasm-bindgen was found) or a thin wrapper we write on our side of the seam, which is part of the spike's cost.
  4. Whole-solid checks pass for more than the 9 primitives: a boolean, a fillet and a shell, each against the independent oracle.
- A spike is the layer contract re-run on SolidCore (phase 1 doubling back), touching the adapter only.
- Probe 2026-10-25 (commit 216cd66d): 250 of 262 units green, 94.0% of lines green. The 12 partial units hold 4,186 deferred cases that reach stubbed calls between ported units (topology.face_p2/p4, topology.edge, intersect.curve_class_p4), 7 known Rust-vs-C++ mismatches and 0 failures, as of CI on 2026-10-23. Primitive construction is the only thing exercised end to end. The README calls the API experimental (0.0.x) and says integration is still in progress. wasm needs `-zstack-size=8388608` (no guard page). Conditions 1 to 4 are not met.
- Double back on phase 1 whenever SolidCraft or SolidCore moves (a new pinned commit, or a SolidCore milestone): re-run the layer contract on the new kernel and diff it against the last one.
  - A row that was refused and now builds and matches the oracle: promote it to supported and remove its guard, but only after the guard-layer fuzz and the saved FreeCAD results agree.
  - A row that was supported and now disagrees: mark it wrong, loudly, and add or restore a guard before anything ships.
  - New features in the kernel: add rows, and add script words only if the layer contract supports them.
  - Keep the previous contract in git history so each change in coverage can be traced to a kernel version.
- Exit: thresholds written down, a swap touches the adapter only, and the contract re-runs with one command.

## Parked, not continued

Truck patching from `LOOP-PLAN.md` (shell patch rebuilds, upstream bisect B1, sketch-solver rebase B2), the seed goldens (24, 61, 19 unblessed; 48 and 53 provisional; 18 unexplained), Phase 7 rebuild on the new shell rule, all FreeCAD parity slices (A3, B3, C2, C3), the upstream bisect and rebase (B1, B2), and the upstream issue/PR drafts. Upstream contributions are handled in a separate session, not by this plan. Nothing is pushed, filed or posted without the owner approving the exact text.

## Risks

- Truck is the weaker kernel: curved volumes are tessellation-derived (1e-5 to 1e-4 error versus 1e-16 for brep-rs) and shell still has wrong-solid families.
- Feature coverage may drop against brep-rs.
- SolidCore may stall. The fallback is restoring brep-rs from `archive/`.
- The gates no longer protect the product; the guard layer must.

## Open decisions

1. Front end: DECIDED 2026-10-24 by the owner. SolidCraft-web's UI, driven through upstream `window.solidcraft` from a same-origin host page inside shCode. Our React studio is a proof of concept and is not the student front end. No patch against upstream. Open: the ribbon toggle (phase 3) needs an upstream field or the interim overlay.
2. Gates: keep `scripts/brep-*` runnable by symlink to the archive, or archive them with brep-rs.
3. Phase 0a: DECIDED 2026-10-25, done. Still open: the message text for 0c, which the owner sees before anything is sent.
4. SolidCore swap thresholds (phase 5): DECIDED 2026-10-25 by the owner, as written in phase 5.
