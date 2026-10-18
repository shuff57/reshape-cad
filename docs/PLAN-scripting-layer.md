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
- Bridge authentication (today the token is only a switch).
- Decide how the bridge attaches to SolidCraft so it does not break on upstream drift: keep the patch pinned to one commit, rebase it on a schedule, or move to our own front end (open decision 1).
- Replace/Restore round and revolve of a constrained sketch.
- Sketch contact gap: distance-pinned and Symmetric contacts solve with 6e-5 to 1.3e-4 mm error the residual cannot see. Keep documented; add a post-solve contact check later.
- Exit: a walkthrough of 3 to 5 real student tasks.

### 4. Gates and critic
- A live-reference score on every change, as in phases 0-5.
- A fresh critic pass on the guard layer. Each earlier shell critic round found a new family, so cap hand rounds and prefer the oracle fuzz.
- Exit: accepted.

### 5. Kernel watch
- Re-check the SolidCore progress site periodically.
- Re-evaluate the swap when boolean, primitive and blend are all above 80% and a first end-to-end release exists. These thresholds are a proposal.
- Exit: thresholds written down, and a swap touches the adapter only.

## Parked, not continued

Truck patching from `LOOP-PLAN.md` (shell patch rebuilds, upstream bisect B1, sketch-solver rebase B2), the seed goldens (24, 61, 19 unblessed; 48 and 53 provisional; 18 unexplained), Phase 7 rebuild on the new shell rule, all FreeCAD parity slices (A3, B3, C2, C3), the upstream bisect and rebase (B1, B2), and the upstream issue/PR drafts. Upstream contributions are handled in a separate session, not by this plan. Nothing is pushed, filed or posted without the owner approving the exact text.

## Risks

- Truck is the weaker kernel: curved volumes are tessellation-derived (1e-5 to 1e-4 error versus 1e-16 for brep-rs) and shell still has wrong-solid families.
- Feature coverage may drop against brep-rs.
- SolidCore may stall. The fallback is restoring brep-rs from `archive/`.
- The gates no longer protect the product; the guard layer must.

## Open decisions

1. Front end: SolidCraft-web (egui) with our bridge, or our React studio on the SolidCraft engine. Recommendation: SolidCraft-web first, pinned to one upstream commit. Trade-off: quickest now, but the bridge is a patch against upstream and drifts. Our own studio removes that coupling at a much higher maintenance cost.
2. Gates: keep `scripts/brep-*` runnable by symlink to the archive, or archive them with brep-rs.
3. Approve phase 0a (changes what `npm test` covers) and the message text for 0c.
4. SolidCore swap thresholds (phase 5).
