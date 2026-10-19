# Handoff: solidcraft scripting-layer spike (stopped 2026-10-17, ~8:45 PM)

Nothing is running. Nothing is pushed, posted or filed. Local commits only.

## What this is
reSHape Script (2D sketches + 3D parts) running on solidcraft-web, as a SEPARATE product from reSHape CAD (policy chosen: "Separate product"; only the DSL is shared; brep-rs stays reSHape CAD's one kernel). The work is on solidcraft, not on brep-rs or `packages/`.

## Done and verified
- Phases 0-6: ModelDoc -> solidcraft command translator, bridge (`window.solidcraft.execute/inspect`, allowlist of 33 command ids, CSP `frame-ancestors 'none'`), host page, constrained sketches, named picks, friendly sketch syntax, script pane with restorable ribbon hide.
- Sketch-solver fix (local patch). Remaining known gap: distance-pinned and Symmetric contacts solve silently with 6e-5..1.3e-4 mm contact error the residual cannot see. Page documents it. Not closed.
- Phase 7 combined page + verification harness (`phase7/`). Built as Rebuild #3 (wasm 23bf6c18). It PREDATES the general shell rule.
- Shell fixes against base `fe3717f`, under convention P (plane-offset): rim, ligament, exact 2t threshold, general cavity-thickness rule. Patch: `fixes/shell-stub/shell-stub.patch` + `NOTES.md`.
- Oracle-driven fuzz harness (`fuzz/`): independent oracle, 136/136 and 32/32 self-checks.

## Last fuzz result (patch head 430f0ec9, CLI vcli-p8final)
| set | MATCH | REFUSED | WRONG |
|---|---|---|---|
| seed 1 on Phase 7 patch | 554 | 924 | 303 |
| seed 1 on new patch | 477 | 1299 | 5 |
| held-out seed 2 on new patch | 461 | 1328 | 5 |
| 474 sweeps: baseline / new | 306 / 299 | 94 / 175 | 74 / 0 |

Refusal is ~74%; almost all justified under P (strict count: 2 over-refusals per seed). 16 cases timed out at 60 s.

## Still wrong (10 rows) - repros in `fuzz/repros/`
- A. Rim/boss on the closed face, wall between t and 2t, built not refused: `p8-s2-01541.json` (+3.1%, 2635.35 vs P 2557.35, t=2.5), `p8-s1-01455.json` (-1.7%).
- B. Convex plate + blind hole, ligament between t and 2t, plus fillet: `p8-s1-01097.json` (+2.4%), `p8-s1-01589.json` (+1.2%); two borderline (s1-01725, s2-00829).
- C. Plain bottom fillet R=1.5t off by 1.0-1.9e-3 (`p8-s1-00475.json`, `p8-s2-00591.json`): unknown whether facets, oracle, or real. I did not verify any of A/B/C myself.

I had sent A/B to the shell builder; it was STOPPED by you before committing anything. Its worktree `scratchpad/wt-gen` is at 430f0ec9, clean. A build in `scratchpad/wt-r6` was killed mid-way (may leave a partial target dir).

## Not done
- Fix/refuse A and B (fallback if no general fix: refuse any shell with a tracked gap < 2t).
- Rebuild Phase 7 on the new shell patch + fresh final critic.
- Bridge authentication (token is only a switch).
- Sketch contact decision (post-solve contact check vs documenting).
- Replace/Restore guard critic round 2; revolve of a constrained sketch.
- Upstream bisect (margin-0 cut runaway on seed 48) and sketch-solver rebase onto current main: handoff tasks from session 5774f515, local only; use NEW worktrees.
- Final-tree gates (kernel, goldens, clippy, fmt) on the exact tree used for the final page.
- Update REPORT.md and DECISION.md (stale).

## Unresolved / do not bless
- Goldens: seeds 24, 61, 19 moved to refusing; seeds 48, 53 provisional; seed 18 contested (deterministic under `fuzz-one 18`, but `all_2` failure unexplained; `all_2` is a cargo test the fuzz agent could not run).
- Refusal wording: ~25/seed still name kernel internals ("offset: a corner whose faces..."); ~350/seed say only "its inner wall meets the part's own faces in a way it cannot cut".

## Open decisions for you
1. Push local commits 40315e1, e4bc5e0, 680b036, ae3ba55, 29fb843 to origin/spike/solidcraft-referee?
2. Chamfer corner convention; AGENTS.md "separate product" wording.
3. If the bisect finds no fix: accept the tight gate (seeds 48/53 refuse)?
4. Whether to cut shell scope (refuse near-2t gaps) vs keep chasing families.
5. Package bisect + golden shards for your i9 desktop (I cannot reach it).

## Constraints that still stand
Heavy runs only via `systemd-run --user --collect --wait` with MemoryMax and MemorySwapMax=0, one at a time. Never touch the `mom` playwright session or `crit7m7`; do not touch `scratchpad/fix-shell` (session 5774f515 has uncommitted edits). No browser profiles/auth files committed. No push/PR/issue/PR-text/icon work without your approval of exact text.

## Where things are
- Plan: `docs/spikes/solidcraft-referee/LOOP-PLAN.md` (committed 29fb843); progress logs `phase7/PROGRESS.md`, `fuzz/PROGRESS.md`; fuzz summaries `fuzz/summary-*.json`, `fuzz/README.md` ("Update: vcli-p8final").
- Scratchpad: /tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/ (worktrees wt-gen, wt-rim, wt-web, wt-80c1e67, wt-fe3717f; fz/ has the per-case jsonl).
- Full transcript: /home/shuff57/.claude/projects/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df.jsonl
