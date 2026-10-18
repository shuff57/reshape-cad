# Loop plan, reconciled with the work so far (2026-10-16)

Bar: DECISION.md acceptance items 1-5 (on origin/spike/solidcraft-referee). Rule: never a silently wrong solid; every sentence on the page is true; one heavy job at a time, all under systemd-run with MemoryMax and no swap; local commits only, nothing pushed, posted or filed without the user approving the exact text.

## Status of the five original pieces
| # | piece | status |
|---|---|---|
| 1 | apply sketch + shell patches to the page, re-run tables | done twice; rebuild 3 pending (below) |
| 2 | critic pass on the shell guard | 3 rounds so far: round 1 found round-face boss; round 2 found thin rim (fixed d9df6230); round 3 found hole/ligament narrower than 2t (fix in progress) |
| 3 | real bridge authentication | NOT STARTED (token is only a switch) |
| 4 | close/refuse sketch gaps | MEASURED, not closed: distance-pinned and Symmetric contacts solve silently with 6e-5..1.3e-4 mm contact error the residual cannot see. Page documents it. Decision below |
| 5 | Replace/Restore guard round 2, revolve of constrained sketch | NOT STARTED |

## Order of work
1. Hole-web shell fix (builder a65ee6d, running): ligament < 2t refuses; thin-wall threshold exact (2.002..2.005 bug); full gate set (19-body battery, critic cases, rim table, kernel, engine, goldens 0..3, clippy, fmt).
2. Phase 7 rebuild #3 (new builder): new shell patch; page fixes from critic round 2 (sketch text "circle or arc", line-to-round only, circle-circle distance pin is refused, "exact" scoped: planar 1e-15, cylinders 1e-5..1.2e-4 facet error, thin-wall sentence true, PROGRESS.md superseded lines marked, unit-test numbers tagged by tree); re-run all suites.
3. Critic round 4 (fresh, never saw earlier cases) on the rebuilt page. Loop 1-3 until ACCEPT. If round 4 finds yet another family, stop and escalate to the oracle fuzz (A1) before more hand rounds.
4. Upstream bisect (B1) and sketch rebase (B2) from the handoff.
5. Bridge auth (piece 3), sketch gap decision (piece 4), Replace/Restore + revolve (piece 5).
6. Commit accepted work to the clean branch (worktree scratchpad/spike-wt), local; ask before any push.

## Additions from this session (new, not in the original plan)
- A1. Oracle-driven shell fuzz. Three critic rounds each found a new wrong-volume family by hand: guards alone are whack-a-mole. Build a generator of planar and cylinder-holed plates (holes, bosses, rims, pockets, ligaments, open faces) and an independent plane-offset oracle (the critic's grid/closed form, pmodel.py in scratchpad/crit/), assert built == P within 1e-3 or refused. Run capped, shard by shard. This replaces hand-invented critic bodies as the main finder.
- A2. Known silent wrong solids still open, same as baseline, inside the bar's "anything else the scoring finds": n7 (boss touching the open face at one vertex: 2720 vs 2424) and n17b (box joined on a cylinder wall), plus the counterbore-plate case the shell builder listed. Each must be fixed or refused in a plain sentence. Add to the shell builder's list after the hole-web fix.
- A3. Sketch contact blind spot: the pane residual uses the touch-free tangent form (double root) and cannot see the contact error. Options: (a) add a post-solve contact check using the touch-point residual and flag "solved but contact off by > 1e-6" or refuse; (b) leave documented. Prefer (a) if it is a small change in the solver; decide on the measured cost.
- A4. Seed 18 flipped: failed on pristine fe3717f in earlier notes, passed in all_2 this round. Unexplained; run seed 18 several times capped to see if it is nondeterministic or load-dependent before calling any golden stale.
- A5. Ribbon flake unresolved: the new retry path never fired in 3 runs. Keep running it under load in the final critic round; a real race stays a finding.
- A6. Base drift. Everything above is verified on fe3717f; upstream is ~411 commits ahead. The handoff reports the margin-0 cut runs away on seed 48 on current main. Our verified patch cannot be assumed to hold there: B1 decides whether it can be ported. Until then seeds 48 (7044.773 -> 7141.547) and 53 (16607.03 -> 16943.64) re-recorded goldens are provisional; do not commit the tight gate or bless anything new before the bisect.
- A7. Docs are stale vs the work: REPORT.md and DECISION.md predate the shell and sketch findings; update with the measured results, the P/L convention, the refused families and the known gaps. AGENTS.md "separate product" wording stays unapplied until the user says.
- A8. Final-tree unit tests: re-run the full kernel suite, goldens, clippy and fmt on the exact tree the final page is built from, not a sibling.

## Handoff tasks (user-authorized, queued after step 3)
- B1. Bisect upstream for the commit that made the margin-0 cut on seed 48 runaway; replay s48/ with a 60 s timeout per probe (~9 builds at ~4 min). Report the culprit and whether a fix is feasible. No fix -> fall back to the tight gate and tell the user. Do not touch scratchpad/fix-shell (session 5774f515 holds uncommitted edits there); use new worktrees.
- B2. Rebase fixes/sketch-solver/sketch-solver.patch onto current upstream main on a new local branch; re-run its tests; note conflicts.

## Not authorized (do not do)
Push, PR, issue filing, PR/issue text drafting (the four drafts in upstream/ stay unfiled and are stale vs the patches), icon work, touching the `mom` playwright session.

## Decisions waiting on the user
1. Push 40315e1 and e4bc5e0 (patch + notes) to origin/spike/solidcraft-referee? (own spike branch only)
2. Chamfer corner convention; AGENTS.md "separate product" wording.
3. If the bisect finds no fix: accept the tight gate (seed 48/53 refuse) as the shipped behaviour.
