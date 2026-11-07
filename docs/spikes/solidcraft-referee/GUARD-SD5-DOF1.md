# Host-route gaps SD-5 and DOF-1

Date 2026-11-07, from main @ e5785e7d. Both gaps are from AUDIT-HOST-GUARDS.md (rows SD-5 and DOF-1, "Live confirmation"). Live numbers below are the host
route as pane.js `run()` runs it, on the corrected 0.21.0 pkg (`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, topology `sc-referee-pkg-topology`), under
`flock ~/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock`. The probe is `next-loop/port/host-route.mjs` with every script item run as the pane does:
`runScript(withPreamble(src))` (the sandbox runner), then the host's own preparation of the doc (host-entry.mjs).

## SD-5: G-FROM reads what the interpreter executed

**Gap.** The from-bottom draft guard (G-FROM, shell-draft.ts `fromGuard`) needs to know, per draft, whether its neutral plane came from a `from:` word. The host
got that from `draftFromUsage(script)`, which counts every textual `draft(` (comments and strings included) and is paired with the doc's drafts by position. One
commented `draft(` line before a stale from-bottom draft built it wrong (29200.36 against the closed form 31300.09, live), and a loop that emits two drafts left
the second unguarded. `translateRaw` passed no usage at all.

**Fix.**
- The interpreter records it on the feature: `DraftFeature.neutralFrom` (model-types.ts) is set by `draft()` only when the call gave `from:` and no `neutral:`.
  It is per feature, from the call that ran, so text the interpreter never executed cannot misalign it and a loop records every draft it emits.
- The layer derives `ctx.fromUsage` from the doc: `fromUsageOfDoc(doc, { recorded, mt })` (shell-draft.ts), in the doc's draft order, which is the order
  `shellDraftStep` pairs by. The host wraps it as `hostFromUsage` (host-entry.mjs). pane.js `run()` passes `recorded: true` for the doc the sandbox returned.
- **A doc no script produced** (a ModelDoc example, `translateRaw`): `recorded: false`. A draft that carries `neutralFrom` is read as above. One that does not
  is **from-unknown**: every word along its pull whose extreme, computed as the interpreter computes it (primitiveExtreme: the centre plus or minus half the
  extent of a plain box or cylinder root, 0 for any other root), equals its neutral is a `maybe`, and G-FROM checks each one with its existing sentence. It is
  never built unchecked. The cost: a neutral set by hand exactly on such an extreme of a part that has since moved is refused, and a neutral of 0 on a root
  whose extent the interpreter cannot read (prism, extrude, sphere...) is checked against both ends. On the layer's fake engine over 1800 feature-only docs
  (combined 600, rgcombined 400, fccombined 400, sd-docs 400) this adds 24 G-FROM refusals, of which 3 were built before (the other 21 were already refused by
  another guard). No student path reaches it: the pane's ModelDoc examples have no draft.
- `toScript` writes the recorded word back (`from: 'bottom'`), so the record survives Code to Build to Code even when the target is a moved part
  (`draftFromWord` alone reads the direct target and gave `neutral: -10` there).
- `draftFromUsage` is unchanged and still exported, for the contract replays and the layer tests that use it.
- Not changed: G-FROM is still skipped when the target has no measure (shell-draft.ts `fromGuard`, `if (m)`); every accepted feature is measured, so this is
  reachable only through a refused target, which planDraft refuses first.

Shared files touched (kept minimal): `packages/layer/src/types.ts` (the `fromUsage` element type gains `maybe?`), `packages/layer/src/index.ts` (one export).
Not touched: unified.ts, translate.ts, the move-turn and primitives code, dependsOn, VOCABULARY. reshape-script.ts is still imported only by the sandbox runner.

**Tests.** `packages/solidcraft-host/test/from-usage.test.mjs` (host translateDoc on the fake engine): the record is set only for `from:` without `neutral:`;
plain, line-comment, block-comment, string and template variants are refused with the G-FROM sentence, while the textual reader builds every variant but the
plain one; a loop emitting two stale drafts refuses both (the textual reader built the second); no refusal for a hand-set neutral on a moved part, `from:` with
`neutral:`, `from:` on an unmoved part, or a default neutral after a commented `from:`; translateRaw mode refuses the stale case with its record removed and
builds a hand-set mid-part neutral; the toScript round trip keeps the record.

**Live (0.21.0 corrected, host route).**

| case | before (audit) | after |
|---|---|---|
| `// draft(x, 1, { neutral: 0 })` + box, move [0,0,30], `draft(m.face('right'), 5, { from: 'bottom' })` | built 29200.3628 (closed form 31300.0907) | refused, G-FROM |
| the same, plain / block comment / string holding `draft(` | plain refused; others not run | refused, G-FROM (all three) |
| a loop emitting draft1 and draft2 on two moved boxes | draft2 built (fake) | draft1 and draft2 refused, G-FROM |
| HALT-4 class A: draft-from-bottom-after-move, -after-turn, -after-join, -extrude-lifted, dw2-box-moved | refused (f0b2cd05) | refused, G-FROM (5/5) |

Equivalence on the whole shell-draft corpus (1097 scripts, 694 with a draft): the doc-derived usage equals the textual one on every script (0 differ), so the
host route's result on that corpus is unchanged by this fix.
