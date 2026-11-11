# Can a student script reach the slow hollows?

2026-11-10, pin SolidCraft v0.30.1 (`8e2b0cd6`). Stage B found 35 failing fuzz shells that ran for over a minute, 4 of them past 600 s. This
asks whether a student script can reach them, and what the student sees. Evidence: `slow-hollows/` (before the HALT-7 fix) and `halt-7-fix/`
(after it). The work was interrupted twice by wrong builds: `HALT-7.md` (fixed, `adcb8c37`) and `HALT-8.md` (guarded, `23b47411`).

**Update, later on 2026-11-10:** this page was written before the HALT-8 guard. With `G-CSOPEN` in, a hollow opened on the face a countersink is on
is refused before the kernel runs, in the Node route and in the page, so the 21 to 32 s wrong builds and the one 45.8 s stop described below no
longer happen. In 524 further seeded scripts (`HALT-8.md`, follow-up sweep) no hollow run took over 10 s. No student script is known today that
reaches a slow hollow.

## Short answer

- **The 35 fuzz hollows: no.** After the HALT-7 fix all 35 are refused before the kernel runs the hollow.
- **Other slow hollows: yes, through the Node host route, up to the 45 s limit.** A hollow opened on the face a countersink is on, with the mouth
  near a corner, takes 21 to 32 s and builds wrong (`HALT-8.md`). One such case ran out the limit and was stopped at 45.8 s with the existing
  sentence.
- **In the real page: not seen.** The page refuses every hollow after a countersink that was tried, in 2.6 to 4.4 s, with a name-lookup sentence
  (`HALT-8.md`, "What a student sees"). No case was found that runs to the limit in the page after the fix. The limit itself works in the page:
  with the budget cut to 0.05 s a plain hollow is stopped with the sentence and the box stays (`halt-7-fix/live-hollow-budget.json`).
- **The longest a student waits on one hollow is now about 45 s** (45 s + 1.5 × the last accepted run), not 45 s for each of up to 10
  open-face points (`2acb75e6`).

## The 35 slow fuzz hollows

| | before the fix | after the fix |
|---|---|---|
| cannot be written as a script, or refused before the kernel | 31 | 35 |
| reach the kernel | 4 (s1-00872, s1-01024, s1-01180, s1-01396) | 0 |

After the fix (`halt-7-fix/reach35-stub-fix.jsonl`): 15 refused by G-HOLE, 10 by G-BLIND, 1 by G-CONVEX, 9 refused before the engine without a guard code.

## The 4 that reached the kernel, and their variants

Raw time is the hollow's first open-face point with no limit (900 s watchdog), the same on both kernels to within a few percent
(`halt-7-fix/raw-030.jsonl`, `raw-021c.jsonl`). "Limit" is the Node host route with the normal 45 s limit, before the fix
(`slow-hollows/budget-030.jsonl`, `halt-7-fix/budget-021c-pre.jsonl`).

| case | raw, 0.30.1 | raw result | before the fix, with the limit | after the fix |
|---|---|---|---|---|
| s1-00872 | 198 s | kernel error | stopped at 46.0 s | G-HOLE, under 4 s |
| s1-01024 | 81 s | built wrong, −3.9% | stopped at 47.7 s | G-HOLE |
| s1-01180 (top only) | 149 s | kernel error | stopped at 48.2 s | G-HOLE |
| s1-01396 | 304 s | kernel error | stopped at 45.3 s | G-HOLE |
| v-00872-round | 89 s | built wrong | stopped at 46.0 s | G-HOLE |
| v-00872-wall2 | 39 s | built wrong, −2.3% | **built wrong** in 37 s | G-HOLE |
| v-01024-round | 75 s | built wrong | stopped at 47.8 s | G-HOLE |
| v-01024-one | 27 s | built wrong, −2.8% | **built wrong** in 26 s | G-HOLE |
| v-01180-round | 73 s | built wrong | stopped at 48.2 s | G-HOLE |
| v-01396-round | 301 s | kernel error | stopped at 45.3 s | G-HOLE |
| v-01396-centre | 0.7 s | built wrong, +5.5% | **built wrong** in 0.8 s | G-HOLE |
| v-csink-plate (control) | 2.1 s | right | built right | built right, 2.9e-6 from the closed form |
| v-cbore-plate (control) | 0.3 s | right | built right | built right, 4.0e-6 |

Every slow case that builds at all builds wrong (−0.6% to −4.4%, and +5.5%). The slow hollows and the HALT-7 wrong hollows are the same class,
and G-HOLE with the mouth radius now refuses all of it. 0.21.0 corrected gives the same table (`budget-021c-pre.jsonl`, `budget-021c-fix.jsonl`).

## Sweep for the fix's side effects

| corpus | rows | hollow-with-hole rows | rows changed against Stage B |
|---|---|---|---|
| host route + centre-of-mass probe: sd, holes, combined, fccombined, rgcombined, mt | 4784 | 713 | 0 |
| guard fuzz shells | 30 | | 0 (7 built right, 23 refused, as Stage B) |
| shell-draft live replay | 1089 | | 0 (1085 identical, the same 4 known differences) |
| holes live replay | 353 | | 0 |
| unified live replay, the 425 hole+hollow documents | 425 | | built-where-a-set-refused: 0 of 934 binding refusals |

No new over-refusal in any existing corpus: none of them had a recessed hole close enough to a wall for the mouth radius to matter.

Seeded hollow-after-recess family, two seeds, 249 scripts (`halt-7-fix/sf7*`, `sf11*`): 100 built, 149 refused. Of the 100 built, 92 match the
closed form within 2e-5 and 8 are wrong: `HALT-8.md`.

## In the real page, normal limit

`halt-7-fix/browser-030.json`, fix tree, one fresh page per case.

| case | wall time | what the student sees |
|---|---|---|
| v-01396-centre (HALT-7, counterbore) | 2.1 s | G-HOLE sentence; box and hole stay |
| s1-01024 (slow, two holes) | 8.1 s | G-HOLE sentence; box and holes stay |
| v-cbore-plate (control) | 3.1 s | built |
| v-csink-plate (control) | 3.8 s | refused: "the top face of hole1 could not be found..." |
| 3 HALT-8 corner countersinks | 2.7 to 4.4 s | refused with the same name-lookup sentence |

The page's inspect call returned no volume in these runs, so the page run shows built or refused, not whether a built volume is right.

## The limit

- One budget for all of a hollow's points: unit tests in `packages/layer/test/hollow-budget.test.mjs` (shell-draft set, unified set, host entry).
  With the real kernel in the Node route, a hollow that fails at all ten points was sent 45.65 s, then 45.27 s, down to 42.22 s.
- In the page, `test/live-hollow-budget.mjs` confirms the first point is sent 45 s + 1.5 × the last run. Its hollow builds at the first point, so
  later points are not exercised in the page; no script was found that fails at more than one point there.
- Not measured: a hollow that reaches the limit in the page after the fix. None was found.
