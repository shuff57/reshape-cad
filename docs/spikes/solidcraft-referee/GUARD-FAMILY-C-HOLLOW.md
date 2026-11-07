# Guard: the hollow of a rounded part against its closed form (shell family C), then fix 1 (2026-11-07)

Two commits, on b2fad0b2 (main 4ed21ddf + the errored-body guard):

1. **The check** (`dd3558ac`, `packages/layer/src/hollow-check.ts`): after a hollow is built, its volume is compared with a closed form. On any kernel, a wrong
   family-C hollow is refused with an existing sentence.
2. **Fix 1** (the last commit): the halted patch from `GUARD-FILLET-CHAIN.md` (named fillets sent as one call per connected chain, plus a face count), applied
   unchanged on top. The owner accepted its truck volume shift on 0.21.0. The three hollows it got wrong on 0.30.1 are now refused by the check.

No new sentence. No kernel is named. `unified.ts` is not edited.

Rigs, each run under its own lock (as in `GUARD-FILLET-CHAIN.md`): SolidCraft 0.21.0 corrected (`sc-corrected-pkg`), 0.30.1 (`sc-referee-pkg`) and
0.40.0-rc.2 (`sc-referee-pkg`), each with its `-topology` package. Logs are in `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/fch-*`. Trees and rows are in
`.../next-loop/fcx/`:

- `fch-check`: check 1 alone, before the scope fix below;
- `fch-final`: both commits. The tree that ran is 958070ca; the last commit only adds the test change noted under fix 1 and this report.

`fcx/cmp.mjs fix2 <tag>` lists every change against the fix-2 tree, which is the base, b2fad0b2.

## The finding

`FIX1-HALT.md` and `GUARD-FILLET-CHAIN.md`, "Found on the way": on 0.30.1 the **shipped host route** (`unified`) built all 8 family-C hollows of
`family-c-run.mjs` wrong. A family-C hollow is a box with its four bottom edges rounded R = 1.5t, hollowed with a wall t, open at the top. The 8 were
1.06e-3 to 5.7e-3 off OCCT built directly and off the fuzz oracle P (those two agree to 4.5e-7). Each was built with the right commands and no refusal. The
filleted part itself was right. On 0.21.0 corrected and on rc.2 the same rows were right.

No pre-flight shell guard can see this, since the part has no concave edge. Testing the kernel version is not allowed: AGENTS.md forbids naming a kernel outside
the adapter. So the layer checks the result.

## The check (`hollow-check.ts`)

### The closed form

The covered class is a box hollowed with an open face. The box may be moved or turned. Its edges may be rounded or bevelled between two of its own faces. It may
have through holes along the open axis. No kernel is involved in the formula:

- **The part:**
  - the box volume;
  - less (1 − π/4) R² L for each rounded edge and d²/2 L for each bevelled one;
  - plus back the overlap where two blends of the same kind and size meet at a corner: R³ (5/3 − π/2) for two rounds, d³/3 for two bevels;
  - less π r² per hole, times the box's extent along the hole axis.
- **The cavity:** the box shrunk by t on every face except the open one.
  - An edge between two closed faces is rounded R − t (sharp when R ≤ t) or bevelled d − (2 − √2) t (sharp at or below zero).
  - A rim edge (one on the open face) leaves the cavity sharp when it is rounded R ≤ t. When it is bevelled, the cavity is bevelled d + (√2 − 1) t: the bevel face
    offset by t meets the open plane that far in. This is the "flat rim 2.83 wide" already noted in shell-draft.ts G-RIM.
  - Each hole removes π (r + t)² times the cavity's extent along the hole axis.
- **The hollow** is the part less the cavity.

Anything else is **not covered**: another root, a whole-shape round, a combine, a pocket, a draft, a copy, a blind or counterbored hole, a hole across the open axis
or one that reaches a blend, three blends at a corner, two different blends at a corner, a blend as wide as its face, a rim rounded more than the wall, or a name
carried through another step.

### What is refused

The check runs after a shell's engine run, in every step that can build a shell. Those are the generic loop and the holes, shell-draft, patterns-mirror, booleans,
revolve-groove and fillet-chamfer steps; unified sends every shell to the shell-draft step. It runs next to the existing checks that follow a build:

- **A covered hollow** is refused when the built hollow is off its closed form, or when the part before the hollow is off the part's closed form (then the part is
  not the one the formula describes). The bar is relative:
  - **1.5e-4** with a round or a hole. Right builds of family C measured at most 1.9e-5 off and wrong ones at least 1.06e-3; a faceted bore reads about 1e-6 low.
  - **1e-7** with bevels only.
- **An uncovered hollow with a round in its history** (family C itself) is refused, because there is no independent measure for it.
- **An uncovered hollow with bevels only** is left as before. It is not family C.
- **A hollow of a part with no blended edge** is not this check's job.

The sentence is the shell group's existing sentence for a hollow the build could not make, verbatim (`shell-draft.ts` `SENTENCE.openAxisEngine`):

`shell1 (hollow): round4 could not be hollowed with this wall and open side, so shell1 is shown without it -- try another wall or another open side.`

The function was moved into `hollow-check.ts` unchanged, and `SENTENCE.openAxisEngine` now calls it. Importing shell-draft.ts from the check would close an
import cycle through translate.ts. The guard code is `HOLLOW-ROUND`, and the note carries no numbers.

There are two switches, never set in production:

- `ctx.skipHollowCheck`, for measuring;
- `ctx.skipSketchVolume`, the existing switch the fake engines use to turn off every check after a build.

### Calibration before any kernel run

The closed form against recorded numbers:

- **Family-C cases:** on all 8 cases it matches OCCT direct to 1e-9 or better. The unshelled part matches the fuzz closed form S.
- **The sd and fc corpora** (the host-route rows of the fix-2 run on 0.21.0 and the HALT-4 run on 0.30.1):
  - every built hollow of a blended part is covered;
  - rounds are within 5.7e-6 of the built volume on both kernels;
  - bevels, rim bevels included, are within 3e-15;
  - every uncovered row was already refused by an existing guard (G-RIM, G-PICK, G-ROUND, G-CHAMFER, the fillet-chamfer guards, or the engine).

This makes the rim formulas measured, not assumed. The script is `scratchpad/calib.mjs`, outside the repo.

### Found during the live runs and fixed before commit (the scope fix)

The first version also checked a hollow with **no** blend at the planar bar. On 0.30.1 that refused 6 right rows of the fuzz harness: a plain box with through
holes, whose faceted bores read 1.4e-6 to 3.4e-6 low. These rows were `plain-centered-hole`, `A-thru-web-2`, `-2.05`, `-3`, `A-twohole-gap-2` and `-3`. The
fix: a hollow with no blended edge is not checked, and a hole always takes the curved bar. A test pins both. The `fch-check` runs predate the fix, so their fuzz
rows are not used below. Their family-C and chain rows are unaffected, since every family-C row has a round.

### Tests

`packages/layer/test/hollow-check.test.mjs` (6 tests, no kernel):

- the closed form against the 8 OCCT-direct numbers, the plain box, and S;
- the bar: every right family-C build (0.21.0) passes, and every wrong one (0.30.1, shipped) is outside it;
- in all nine sets and the host entry, on both pick paths, with the differential fake engine wrapped to report the measured volumes:
  - a right hollow builds;
  - a hollow 1.06e-3 off is refused with the sentence and `HOLLOW-ROUND`;
  - both switches turn the check off;
  - a part off its closed form is refused;
- bevels at the planar bar, and three blends at a corner: refused with rounds, unchecked with bevels;
- no blend is not checked, and a bevel with a hole is checked at the curved bar;
- what the form covers and what it does not, and that the sentence equals `SENTENCE.openAxisEngine`.

## Fix 1

`fix1.patch` was applied with `git apply --3way`. The only conflict was `types.ts`, where both new switches now sit side by side. The code is as described in
`FIX1-HALT.md`: one call per connected chain of same-style, same-size named fillets in every set but fillet-chamfer and unified, plus a face-count check after the
build (`FC-FACE-COUNT`).

The only other change is in `test/fillet-chain.test.mjs`. Its deep comparisons now drop the patterns-mirror step's `wallMs`, because two runs of the same doc
differed by 1 ms under load and failed twice.

## Live (`fcx/cmp.mjs fix2 fch-final`, HEAD 958070ca, every harness STEP rc=0)

### WRONG or THREW counts, before and after

| pkg | family C, path A (`shell-draft` + `ctx.resolveAt`) | family C, shipped (`unified`) | fuzz-guard | chain (152 runs) |
|---|---|---|---|---|
| rc.2 | 8 → **0** | 0 → 0 | 2 → **0** | 3 → **0** |
| 0.30.1 | 5 → **0** | 8 → **0** | 2 → **0** | 0 → 0 |
| 0.21.0 corrected | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

### rc.2

The kernel builds family C right once fix 1 sends the bottom fillets as one call.

- **Family C, path A:** the 8 WRONG rows are now MATCH, within 2.4e-9 of OCCT direct, as FIX1-HALT.md recorded.
- **Fuzz:** the 2 family-C rows are now MATCH.
- **Chain:** B4, B3 and B2-adj on path A are now MATCH. Path B in the seven non-fc sets builds them, where it refused them before. B4-bevel builds 11847, which is
  exactly the closed form. B2-mixed path A is refused by `FC-FACE-COUNT`.
- **The check on rc.2:** it refuses nothing in the final tree. With check 1 alone (`fch-check`), the 8 path-A hollows of the wrongly filleted part were refused
  (`HOLLOW-ROUND`), because the part was off its closed form.

### 0.30.1

**Every family-C hollow is refused:** all 8 on the shipped route and all 8 on path A, each with `HOLLOW-ROUND` and the sentence. That includes the three that fix 1
moved onto the wrong path:

| case | path A before (one call per edge) | the hollow fix 1 builds (FIX1-HALT.md) | final |
|---|---|---|---|
| `C-plain-40x30x10-t1.5-R2.25` | MATCH 3376.01344 | WRONG 3391.89365 | **refused, HOLLOW-ROUND** |
| `C-plain-40x30x10-t2-R3` | MATCH 4278.10307 | WRONG 4282.78717 | **refused, HOLLOW-ROUND** |
| `C-plain-40x30x10-t2.5-R3.75` | MATCH 5074.67994 | WRONG 5080.09221 | **refused, HOLLOW-ROUND** |

- **Fuzz:** the only changes are the 2 family-C rows, WRONG → refused.
- **Chain:** 0 WRONG; the 32 changes are fix 1's, as on 0.21.0.
- **Filleted parts:** they move by 1.2e-9 to 1.1e-7, fix 1's one-call shift.

### 0.21.0 corrected

- **Family C:** every row still MATCHes, on both paths. The hollows move by 1.6e-8 to 2.3e-6 (`t2.5-R3.75` 5074.679942 → 5074.668390), which is the accepted fix-1
  shift. The check refuses nothing here.
- **Fuzz:** the 2 family-C rows move by 1.6e-8 and 2.0e-8, and stay MATCH.
- **Chain:** the same 32 fix-1 changes as on rc.2: path B builds instead of refusing, and B2-mixed path A is refused by the face count.

### The host route (`port/host-route.mjs`, unified at `'full'` with pane.js's ctx, on 0.21.0 corrected; `port/cmp.mjs` against fix2)

| corpus | docs | verdicts after | new refusals | over-refusal | still wrong | other changes |
|---|---|---|---|---|---|---|
| fillet-chamfer (`fc`) | 2309 | RIGHT 864, REFUSED 1227, WRONG 119, ORACLES-SPLIT 54, BUILT-ORACLES-REFUSE 45 | **0** | 0 | 119 | 0 |
| shell-draft (`sd`) | 1097 | RIGHT 626, REFUSED 471 | **0** | 0 | 0 | 0 |

The verdicts are identical to the fix-2 run. The 119 WRONG are HALT-4's corner-convention rows, triaged as not wrong and unchanged. No row threw.

**New refusals: none outside family C.** The check refuses only these:

- the 8 family-C hollows on 0.30.1 (shipped) and the 8 on its path A (`family-c-run.mjs`);
- the 2 family-C fuzz rows on 0.30.1.

Each is `HOLLOW-ROUND` with the sentence above. Fix 1's own new refusal, B2-mixed path A by `FC-FACE-COUNT`, is the one FIX1-HALT.md already recorded.

### Unit and suite checks (final tree)

- **`unified.test.mjs`:**
  - default level: 9/9 pass; invariant 1 has 171512 refusals compared and **0 violations**; invariant 2 has 71463 equal and 0 differ;
  - `UNIFIED_EP_JOIN=full`: 9/9 pass; invariant 1 has 173585 compared and **0 violations**; invariant 2 has 68651 equal and 0 differ. The EP-JOIN class is the
    same as GUARD-MOVE-TURN.md's (776 + 2010 runs over 288 docs).
- **Root `npm test`** (`fch-npmtest-final.log`): **941 pass of 947, 0 fail**. The 6 skipped are the script package's existing skips. The layer suite is 164/164.

## Files

- `unified.ts`: **no hunk**. Unified routes every shell to `shellDraftStep`, which calls the check.
- New: `src/hollow-check.ts`, `test/hollow-check.test.mjs`, this report. Fix 1 adds `src/fillet-chain.ts` and `test/fillet-chain.test.mjs`.
- One small hunk each, next to the pocket-cut check: `translate.ts`, `holes.ts`, `shell-draft.ts` (plus the moved sentence), `patterns-mirror.ts`, `booleans.ts`,
  `revolve-groove.ts`, `fillet-chamfer.ts`.
- `types.ts` (`skipHollowCheck`) and `index.ts` (exports).
- `dependsOn`, `VOCABULARY`, `archive/`, the frozen gates and the harnesses are untouched.

## Open

- **Not covered, refused when a round is present:**
  - a rounded cylinder rim, a whole-shape-rounded box, rounds after a combine, mirror or pocket;
  - holes across the open axis or through a blend;
  - three blends at a corner, and two different blends at a corner.

  On the corpora these were all refused already. A student who asks for one gets the sentence above.
- **Bevel-only uncovered hollows are unchecked**, as before (for example `fc seed 426`, BUILT-ORACLES-REFUSE before and after).
- **The host route on 0.30.1 was not re-run over the corpora.** The calibration shows that no covered corpus row differs between 0.21.0 and 0.30.1, and that no
  corpus row is family C.
