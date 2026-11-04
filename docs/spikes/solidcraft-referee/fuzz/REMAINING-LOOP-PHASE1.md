# Remaining-work loop, phase 1 — guard-layer fuzz (0.21.0 rig)

Date: 2026-11-04. Spec: `.cache/PLAN-remaining-0.21.0.md`, phase 1.
Kernel: `sc-referee-pkg` (pinned SolidCraft 0.21.0 wasm rig, `~/.cache/solidcraft-0.21.0-rig/sc-referee-pkg`).
Guard layer: `createTranslator({ planners: 'shell-draft' })` from `packages/layer` (built `dist`), picks via the retired brep-rs resolver exactly as `live-replay-shell-draft.mjs` wires them.
Oracle: `fuzz/oracle.mjs` at h=0.05; tolerance 1e-3 rel of P (same as `fuzz/README.md`).
Harness: `packages/layer/test/fuzz-guard-run.mjs` (scratch iteration in `/tmp/opencode/remaining-loop/fuzz-guard.mjs`).

## Method

The fuzz generator emits CLI command lists; the guard layer consumes `ModelDoc`s. Per the owner's choice, the loop drove the layer by **script**: each case is a reSHape Script (`box`/`hole`/`join`/`fillet`/`sketch`+`pocket`, then `hollow(..., { open: 'top' })`) plus the equivalent fuzz `model` for the oracle. One (script, model) pair in one consistent frame (plate centered in XY, z in [0,H]). Oracle self-checks were re-run fresh before scoring: `selfcheck.mjs` 136/136 non-Euclid closed forms + 9/9 Euclid within 1.5% (max 2.1e-3), `selfcheck2.mjs` 32/32 — green per `fuzz/README.md`'s acceptance rule.

## Result: exit met — built or refused, never wrong

30 cases run. **0 WRONG.** 7 MATCH (built, within 1e-3), 19 refused by the shell guard, 4 dependency refusals before the shell guard (see "not reached").

| family | cases | outcome |
|---|---|---|
| plain student plates | 2 | both build, MATCH (2424 exact; 2552.80 rel 1.8e-6) |
| A: through hole to wall, web in [t,2t) | 8 | refused via **G-HOLE** for web 0.95–1.9; MATCH at 2.0, 2.05, 3.0 (rel ≤ 1.8e-6) |
| A: two through holes, gap in [t,2t) | 5 | G-HOLE for gap 1–1.9; MATCH at 2, 3 (3.4e-6) |
| A: blind hole toward open face, floor 0.5–3 | 7 | all refused via **G-BLIND** (floor-blind blanket rule, see findings) |
| A: pocket toward open face, floor 1.5–3 | 3 | all refused via **G-CONVEX** (see findings) |
| B: box boss on open face | 1 | refused via **G-CONVEX** (inside-corner rule; family B expects refusal) |
| C: bottom fillet R=1.5t (t=1, t=0.5) | 2 | not reached: the per-edge `fillet` features are refused ("edge could not be resolved") before the shell guard |
| A convex variant (vfillet plate + hole) | 2 | not reached, same cause |

Raw evidence: `/tmp/opencode/remaining-loop/phase1-fuzz-final.json` (`rows[]` carry volume, P, rel, guards, refusal sentence, per-row `reached` flag).

## Findings (not verdicts — no wrong solid either way)

1. **The guard holds every named wrong-solid boundary.** Web/gap in (t,2t) → refused, not built-wrong; this is exactly the upstream family A, closed on our side.
2. **Over-refusal, documented, not silent:** G-BLIND refuses *every* blind hole in a shell target and G-CONVEX *every* pocket, including floors at 2t–3t where the upstream kernel builds correctly (fuzz README family 2 sweep: floor 2.0 MATCH). The layer's contract is stricter than the kernel's capability here; it refuses in a sentence rather than building wrong. Cost on this A/B-weighted slice: 19/26 reached rows refused (73%) — consistent with the ~74% p8 refusal rate the plan notes, but note this slice is deliberately boundary-heavy; the unbiased cost is the shell-draft differential corpus (8190 comparisons: shell built 1319, refused 3163).
3. **Family C stays untouched:** the documented-tolerance question (R=1.5t, 1.0–1.9e-3) could not be re-measured because named-edge `fillet` features refuse with "could not be resolved to a single edge" in every planner profile tried (shell-draft, fillet-chamfer, unified) — the known-unwired edge-resolution path (fillet docs are excluded from the shell-draft replay for the same reason). No second oracle could be run (Euclid cross-check needs `rect` models). The rows are recorded as not-reached, not as passes.
4. No changes to refusal sentences, `dependsOn`/`VOCABULARY`, `archive/`, or the frozen gate scripts were needed or made.
