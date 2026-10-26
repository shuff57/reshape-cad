# Holes rows: proposed changes after the 0.21.0 measurement (PROPOSAL, not applied)

Source: `holes4-results.json` (SolidCraft v0.21.0, round-4 translator). `holes4-rows.mjs` stops at these 12 rows (plus 7 sentence-lint complaints, see the end). Nothing below has been written to `holes.json`; the committed rows are still round 3 / 0.9.0. Reading this and saying "apply" is the next step.

## A. Same status, different guard or reason (5 rows). Proposed: keep the status, change the evidence and the sentence the row quotes.
| Row | Row expected | 0.21.0 measured | Status |
|---|---|---|---|
| deep given: blind into a sphere (`blind-in-sphere`) | refused by G-TOP | refused by **G-BUDGET** (took over 45 s of computing) | refused -> refused |
| counterbore or countersink on a part that is not flat and level under the bore (`cb-revolve-wall`) | refused by G-TOP | refused by **G-REVOLVE** | refused -> refused |
| the same counterbored hole drilled twice (`cb-twice`) | refused by G-NOOP | refused by **G-NEST** | refused -> refused |
| hole on a cone turned to lie along x (`rot-cone-turned-through`) | refused by G-ENGINE | refused by **G-CURVED** | refused -> refused |
| hole on a revolve result, blind (`revolve-hole-wall-blind`) | refused by G-TOP | refused by **G-REVOLVE** | refused -> refused |
Caution on the first: it is now refused for TIME, so on a faster box it might build. It is a guard result that depends on this machine.

## B. Status changes (6 rows). Each is built -> refused or supported -> refused; none is refused -> built.
| Row | Was | 0.21.0 | Why |
|---|---|---|---|
| countersink whose cone leaves through the bottom of the plate (`cs-wide-mouth-wider-than-plate`) | supported | **refused** | round-4 guard G-CSEDGE: the mouth reaches past the side of the part. Round 3 had no such guard, so this is the translator, not the kernel |
| countersink whose cone breaks out of a side face (`cs-ring-breaks-out-side`) | unsupported | **refused** | G-CSEDGE, same reason |
| countersink with a nearly flat cone, 179 degrees (`cs-angle-179`) | unsupported | **refused** | G-CSFLAT: angles over 170 degrees are refused. Round-4 guard |
| hole on a cylinder lying along y, bore along z (`rot-cylinder-x90-hole-z`) | unsupported (built, 144 s) | **refused** | G-CURVED. Round-4 guard; built correctly but took minutes |
| cross-bore through a cylinder (`cross-bore-through-cylinder`) | unsupported (built, 124 s) | **refused** | G-CURVED. The row's second case `round-box-hole-37` is also off: the row expected "slow but built" and it now builds without being slow |
| holes() with counterbore or countersink, four recesses (`holes-countersink`, `holes-cs-blind`) | supported | **refused** | G-BUDGET: 46.6 s of computing against a 45 s budget (24.8 s in round 3). Whether the kernel or this box is slower cannot be told from this data |
The four G-CS*/G-CURVED changes come from guards added in round 4, so they are not a kernel change. Only the last (and the first row of section A) is a time effect.

## C. A sentence defect (1 row)
- hole through a closed hollow() (`closed-hollow-hole`): refused as expected, but the shell sentence contains the word "undefined" and the group's own lint flags it as engine jargon. Cause (found by the holes fold): `SHELL_SENTENCE.closed` is called with one argument and takes two. This was already true in round 4; it is not new on 0.21.0. Fixing it changes a student-facing sentence.

## Sentence lint (7 complaints)
These quote the interpreter's own script-error text verbatim (round 4 chose that), for example `hole has no option called "radius". It takes across, size, deep, at, along, counterbore, countersink.` The lint flags them for naming code (`hole()`, `{ across: 6 }`). No kernel is involved.

## What I recommend applying
A and C: keep status, update evidence (C also needs the sentence fix, your call). B: apply all six as refused, noting for each whether it is a guard or a time effect. Do not promote anything to supported.
