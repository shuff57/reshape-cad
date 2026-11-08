# Guard over-refusal: winning back what the contracts allow (2026-11-07)

Status: **two ports committed** on top of 1ced28e3. The owner's ruling was "apply now, reduce later". This report covers the reduction for the move-turn guards (GUARD-MOVE-TURN.md) and the
primitives guard (GUARD-PRIMITIVES.md). Both ports come from the contracts themselves. Neither adds or changes a sentence.

| commit | port | code |
|---|---|---|
| b7ea394c | the move-turn chain repair, padded half, in all nine sets | `packages/layer/src/move-turn.ts` `motionRepair`, called at the seven `motionRefusal` sites |
| cab2267a | primitives `cone-turned-slender`: refuse only what its row calls wrong, a turn off Z | `packages/layer/src/primitives.ts` |

## Rigs, probe, oracles

These are the same as in GUARD-MOVE-TURN.md. The probe is `next-loop/or/host-route.mjs`, a copy of `hg/host-route.mjs` (the host route with `preflightScript`). It adds one thing: each feature's
`repaired` count goes into the row. Kernels:

- SolidCraft 0.30.1 (`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, under that rig's `rig.lock`);
- SolidCraft 0.21.0 corrected (`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, under `next-loop/rig.lock`).

Oracles:

- OCCT (the referee apparatus, by path);
- brep-rs (`archive/brep-rs/pkg`, copied into the gitignored `pkg/` for the runs and removed before `npm test`);
- the cases' closed forms.

Sweep: `or/sweep.sh`, all 15 corpora, 13,700 docs per kernel. Logs `next-loop/logs/or-sweep-030.log` and `or-sweep-021c.log`: EXIT=0, every corpus rc=0, no Error, ERR_ or FATAL. Comparisons:

- `or/cmpor.mjs`, against the main-line sweep `hg/sweep-{030,021c}` (`or/cmp-030.json`, `or/cmp-021c.json`);
- `or/over.mjs`, the over-refusal count against the pre-guard HALT-4 rows `step2c/hr-030` (`or/over-base-030.json`, `or/over-after-030.json`).

## Port 1: the move-turn chain repair (padded half)

The group's guarded translator (`contract/move-turn-harness/translate-guard.mjs`, "(round 4) repair") does not answer a failed rigid-motion invariant with a refusal straight away. It
re-runs the part with other command lists and checks each one with the same invariant. The move-turn rows say "the translator guard must ship", and the repair is part of that
translator. GUARD-MOVE-TURN.md left the repair out ("a retry, not a guard"). The group's measured reason for it: the engine's fault depends on how many moves a body has been through,
so one or two moves by [0, 0, 0] bring the count back to one where the part comes out right.

- **Ported:** the padded candidates, in the original's order (padded1, then padded2). A candidate is the feature's own commands plus n no-op translations of each body it leaves,
  sent as one variant. The candidate is re-run and checked by `motionRefusal` against the same part before (`lastRunOf(accepted)`). The first one that passes is built. The note
  carries `repaired: { pads, reason }`, and the accepted list carries the padding. If no candidate passes, the invariant's sentence stands as before.
- **Not ported: the folded candidates (`simplifyChain`).** A fold rewrites commands that earlier features own: it merges a body's translations across features. The layer
  keeps each feature's prefix of the accepted list fixed once it is accepted (`st.accLen`, `lastRunOf`, `resolveAfter`).
- **Not ported: repair of MT-PRIMITIVE.** It is repaired in the original. Here it stays a refusal. No primitive was over-refused by MT-PRIMITIVE.
- Switch `ctx.skipMoveTurnRepair`, for measuring only.
- Tests: `test/move-turn.test.mjs`, 2 new, every set.
  - A fake engine is made wrong at chosen move counts. It is repaired with 1 pad or with 2.
  - It is refused when wrong at 1, 2 and 3, with the dependant refused too.
  - A later move is repaired against the padded part.
  - MT-PRIMITIVE, a fault that padding cannot undo, and `skipMoveTurnRepair` all stay refused.

## Port 2: primitives cone-turned-slender as its row says

The guard was a line-for-line port of `contract/primitives.guard.mjs`. This is the one place where the original is narrower than its own row:

- the row is "cone turned (**not about Z only**) with tall/across above 10";
- its evidence is "A turn about Z only (z90) keeps 2 faces";
- the original refused any turn.

The port now refuses a turn with an x or y part (`turnedOffZ`). A cone turned about Z alone is judged by every other rule, including cone-turned-moved-flat, whose row says "any
rotate" and is unchanged.

I compared every other rule's limit with its row (`contract/primitives.json`: the supported ranges and the wrong-domain definitions). Each one matches the row exactly, so there is
nothing else to widen.

Tests: `test/primitives.test.mjs`, 1 new, every set.

- Built: Z-only turns at the origin and off it, and the folded `turn()` of a script.
- Refused with the row's sentence: x turns, and a y part of 1e-9.
- The original guard is recorded as refusing the Z-only ones.

## Results (both kernels identical)

| | 0.30.1 | 0.21.0 corrected |
|---|---|---|
| rows that were refused and now build | **42** (mt 32, prim 10) | **42**, the same ids |
| their verdict | 42 RIGHT | 42 RIGHT |
| measured face count = OCCT's = brep-rs' | 42 / 42 | 42 / 42 |
| new wrong solids | **0** | **0** |
| new refusals | 0 | 0 |
| any other changed row (verdict or volume) | 0 | 0 |

Every newly built row matches OCCT and brep-rs (`okO` and `okB` both true). For prim it also matches the closed form.

- **The 10 prim rows** are `e23-a-r{1,10,72.95}-t{18,25,40}-z90` and `e21-tcone-r72.95-h2625-0_0_90`.
  - They built 1.8e-4 off the closed form, which is tessellation inside the 3e-4 curved bar.
  - OCCT, brep-rs and the closed form agree with each other to 1e-15.
  - Each has 2 faces, as do OCCT and brep-rs.
- **The 32 mt rows**, examples:
  - `r4-conechain:cone#16`: turn1 and move2 each repaired with 1 pad, 318.290 against OCCT = brep-rs 318.348;
  - `r5-conechain-moves:moves#17`: move3 + 1 pad, 128.258 against 128.282.

  Of the 32, 10 were over-refusals, rows the pre-guard host built right. The other **22 were built WRONG** by the pre-guard host and refused by the guard. With the repair they now
  build RIGHT.

### Over-refusal, before → after (0.30.1, a refusal by these guards where the pre-guard probe scored the build RIGHT)

| guard | before | after |
|---|---|---|
| move-turn (MT-INVARIANT + MT-CONE-CHAIN) | 306 (143 + 163) | **296** (0 + 296) |
| primitives (PRIMITIVES, plus 7 downstream in mt) | 939 | **929** |
| total | 1245 | **1225** |

MT-INVARIANT over-refusals went from 143 to 0:

- 10 now build right;
- 133 now stop at **MT-CONE-CHAIN** on a later step of the same chain (163 → 296). The invariant had refused them earlier in the chain; once repaired, the chain reaches its
  4th move or turn.

There is no full pre-guard sweep on 0.21.0 corrected, so the over-refusal count is for 0.30.1 only. On 0.21.0 corrected the same 42 ids build, all right, and nothing else changes.

### What stays refused, and why

| over-refused rows (0.30.1) | guard / rule | why it stays |
|---|---|---|
| 296 (mt) | MT-CONE-CHAIN | Row "move() or turn() of a part with a conical face ... more than 3 times ... \| refused". This is a contract rule, not a measured edge. The repair cannot help, because the limit is checked before any run. |
| 876 (prim) | PRIMITIVES, by rule: too-far-planar 122, too-far-big-curved 108, cyl-round-too-flat 106, too-thin-planar 103, too-small 96, cone-too-flat 87, cone-turned-slender (x or y turn) 86, cyl-corner-vs-radius 60, cone-turned-moved-flat 40, box-round-too-thin 26, too-far-curved 23, too-big-curved 8, ring-tube 5, box-corner-too-small 4, box-corner-too-big 1, prism-sides 1 | Each input sits inside a row marked `wrong`, whose domain the guard reproduces exactly. Those rows put the limit a decade (or the stated factor) inside the measured edge. Winning these back means a contract change with new measurements, not a port. |
| 44 + 7 downstream (mt) | PRIMITIVES (cone-turned-moved-flat 24, too-far-planar 13, too-far 4, too-far-curved 3) | The same rows, on the placement the contract's own `guardDoc` folds in (turns and plain moves of the primitive itself). |
| 2 (fc) | PRIMITIVES box-corner-too-big, cyl-corner-vs-height | `r3-half-box-r10` / `r3-half-cyl-r10`, a corner of exactly half. The row "box option corner within 1e-4 of half the shortest side, **at half**, or above it" is `wrong`. The fillet-chamfer contract passes exactly half, so the two contracts disagree. The stricter one stays, and these builds are 1.3e-4 off their closed form. |

Not tried, because I was unsure: the folded repair, and any change to a rule's margin.

## Other exit checks

- `UNIFIED_EP_JOIN=full node --test test/unified.test.mjs` (`logs/or-unified-full.log`): 9/9.
  - Invariant 1: 173585 refusals compared, **0 violations**.
  - Invariant 2: 68651 equal, 0 differ.
- Layer suite (`logs/or-layertest.log`): 172 / 172.
- Root `npm test` (`logs/or-npmtest.log`, with the brep-rs pkg copy removed): **957 pass, 0 fail**. The 6 skipped are the script package's existing skips.
- Host bundle rebuilt (`sh packages/solidcraft-host/pane/build.sh`).
- `test/live-examples.mjs`, live in headless Chrome against the 0.21.0 web build (`logs/or-live-examples.log`, `or/live-examples.json`): **46 / 56**. This is identical to the main line
  (`hg/live-examples.json`): the same passes, the same refusals, and volumes equal to 1e-6.
- No edits to `dependsOn` / `VOCABULARY`, `archive/`, the gate scripts or `follow-moves.ts`. No kernel is named.
