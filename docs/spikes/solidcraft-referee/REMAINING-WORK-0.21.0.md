# Remaining-work loop, 0.21.0 — closing report

Date: 2026-11-04. Spec: `.cache/PLAN-remaining-0.21.0.md`. Scope: guard-layer fuzz → contract table →
re-measure → gates. No student pilot, no SolidCore swap, never pushed. Raw output:
`/tmp/opencode/remaining-loop/`; loop state: `~/.cache/solidcraft-0.21.0-rig/remaining-loop/` (`state.tsv`).

## Phases, exit checks, commits

| phase | exit check | verdict | commit |
|---|---|---|---|
| 0 baseline | `npm test` root + `packages/layer` suite; nine live-replay evidence files describe HEAD | PASS — `npm test` exit 0 (all workspaces green; layer 107/107 standalone); the nine 0.21.0 evidence files internally consistent (all `differ` 0/empty), moved-picks byte-identical to its rig producer, unified evidence = merge of three recorded runs (single differ rerun equal); HEAD was the evidence commit itself — no drift. No commit (nothing changed; handoff: no commit unless a file actually changed). | — |
| 1 guard-layer fuzz | oracle self-check green (136/136 + 32/32) before scoring; built-or-refused, never wrong; plain student plates build | PASS — oracle self-checks freshly green (136/136 + 9/9 Euclid ≤ 1.5%, 32/32); 30 script+oracle cases on `sc-referee-pkg`: **0 WRONG** (7 MATCH, 19 shell-refused, 4 dependency-not-reached); both plain student plates build+match; over-refusal findings documented (G-BLIND refuses every blind hole incl. 3t floors; G-CONVEX refuses every pocket — honest refusals, stricter than the kernel). Family C could not be run (named-edge fillet resolution unwired in all planner profiles) — left open, not recorded as pass. | 7ccbfef6 |
| 2 contract table | table checked against the live replays; a disagreement is a regression | PASS — `CONTRACT-TABLE-0.21.0.md` written: every VOCABULARY verb + sketch sub-ops with status, verbatim sentence, and one evidence command per row; rig recipe included. Two source-check corrections (extrude option opts and whole/`from:` draft are **supported**, not refused) were caught against `extrude-pocket.ts`/`shell-draft-cases.mjs` before committing. No refusal sentence created or changed (quotes are verbatim from src/evidence). | 6da930ad |
| 3 time re-measure | every frozen time row re-run on the corrected build; supported-now-disagrees halts | PASS — ten hang rows: 9–54 s (from 113–465 s) on the corrected build, `pf-corner-then-join` 218 s inherent; slant probes ≤ 10 s, traps gone. No supported row disagrees (all `same: true`, statuses identical; full extrude-pocket replay 466/466 on corrected pkg). `sx-plain-block`'s frozen "build" is stale on both current builds (both trap) — documented, not a corrected-build regression. Promotions report-only; none made. | a8e0c07a |
| 4 gates | one-command gate incl. CI wiring; catches a wrong answer; passes on the current tree | PASS — `sh packages/layer/test/live-gate.sh`: SKIP (exit 0) without rig, PASS (exit 0, 0 WRONG) with rig, negative control (`NEGATIVE_CONTROL=1=wrong-oracle`) detects 7 WRONG (exit 1). CI step wired in `.github/workflows/ci.yml` (fail-safe: always runs after build; YAML validated). The gate scores the fuzz oracle's wrong-solid classes end-to-end. | d2936be0 |
| 5 report | this file: phases, exit checks, commits, evidence refreshed, open work | PASS — this file, committed. | (this commit) |

Mechanics: commits by phase, never pushed. No `dependsOn`/`VOCABULARY`, `archive/`, or frozen gate-script edits.
Two file reads in fuzz (`selfcheck.json`) were re-run and restored, leaving the tree clean between phases.

## Evidence refreshed

- `packages/layer/test/evidence/*` — unchanged (Phase 0 found no drift, so no refresh; evidence still
  describes HEAD).
- New tracked evidence-of-record: `docs/spikes/solidcraft-referee/CONTRACT-TABLE-0.21.0.md`,
  `docs/spikes/solidcraft-referee/fuzz/REMAINING-LOOP-PHASE{1,3}.md`,
  `packages/layer/test/fuzz-guard-run.mjs`, `packages/layer/test/live-gate.sh`.
- Raw evidence (untracked, in `/tmp/opencode/remaining-loop/`): `phase0-npm-full.log` (exit 0),
  `phase0-layer.log` (107/107), `phase1-selfcheck{,2}.log` (136/136, 32/32),
  `phase1-fuzz-final.json` (30 rows with verdicts), `phase3-slant.log`, `phase3-hang-*.log` (per-case walls),
  `phase3-sxplain-layer.json` (466/466 on corrected pkg),
  `phase4-gate-{pass,neg}.log`.

## Still open

1. **Student pilot walkthrough** (plan phase 3 exit: 3–5 real student tasks) — out of this loop's scope.
2. **SolidCore re-probe** (plan phase 5) — out of scope; the `EngineAdapter` spike was never run.
3. **Gates' final green run** — the gate passes on this box with the rig (`sc-referee-pkg`) and correctly
   detects a wrong oracle; a green run on CI (rig-less) will exercise only the SKIP path. A rig-bearing
   CI run (or a fixture-upload that fetches the pkg) is the remaining wiring step if the owner wants it.
4. **Family C re-measure** — needs named-edge fillet resolution wired up in the layer (currently unwired);
   the R=1.5t tolerance question stays open.
5. **Slant-promotion question** — several refused→builds rows on the raw path (kernel now builds what it
   used to reject) that the shipped layer still refuses; per policy they need guard-fuzz + FreeCAD
   agreement before any promotion, which this loop did not adjudicate.
