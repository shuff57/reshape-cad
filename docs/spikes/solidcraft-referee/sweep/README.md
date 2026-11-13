# The host-route sweep: is what the layer builds right?

Every case of a corpus goes through the page's own route in Node (the same `translateDoc` the page calls, the same settings) and the step it
measures is compared with two independent kernels, OCCT and brep-rs, and with a closed form or a stored reference where the case has one.
Moved into the repo on 2026-11-13 from the rig (`~/.cache/solidcraft-0.30.1-rig/h16/host-route-x.mjs`), with the two rules the second pilot's
sweeps added. What those sweeps found is in `../pilot-2026-11b/PILOT-2.md`, from "1500 new documents" on.

## What it needs

- The repo built: `npm run build` (the sweep reads the `dist` folders of script, sketch, layer and brep-adapter), and `archive/brep-rs/pkg`
  (see the repo's AGENTS.md for building it).
- The kernels, which are not in the repo: `$RIG/sc-referee-pkg` and `$RIG/sc-referee-pkg-topology` (`RIG` defaults to
  `~/.cache/solidcraft-0.30.1-rig`; `packages/solidcraft-host/kernel/build.sh` and the rig's own notes say how they are built).
- `replicad-opencascadejs` installed (a root devDependency).
- Do not rebuild a `dist` folder while a sweep is running: the sweep imports it.

## Running it

```sh
# a corpus as written, then cut down to what each case builds, then the tally
sh score-built.sh /tmp/sweep holes sd mt

# the three generators take seeds; the corpora's own are 0-600 (combined) and 0-400 (rgcombined, fccombined)
SEED_FROM=1100 SEED_TO=1600 sh score-built.sh /tmp/sweep-new combined

# one pass by hand
node host-route-sweep.mjs --corpus=holes --out=/tmp/x [--only="id one,id two"] [--no-oracle]
node tally.mjs /tmp/x
```

`score-built.sh` runs each corpus twice. The second pass is the one that matters, and the reason is simple: the harness scores ONE step per
case (the step the case names, else its last), and a generated document ends on a refused step more often than not. Scored as written, 1500 new
documents had 39 built final steps; cut down to their built steps (`mkdrop.mjs` writes the list, `DROP_FILE` applies it), 1411. So:

1. **full**: the cases as written. Tells which steps are built and which refused, and scores the cases whose measured step is built.
2. **built**: each case without its refused steps (and without sketches left at the end). The measured step is now the last built one, so the
   oracles judge the final solid. A case's stored reference goes with the step it was about.

Seeds scored so far: `combined` 0 to 1099, `rgcombined` and `fccombined` 0 to 899. Use fresh ones to look at documents the layer has not met.

## Reading the verdicts

| verdict | meaning |
|---|---|
| RIGHT | every oracle that built the step agrees with the page route (volume, box, centre of mass), at least one did |
| REFUSED | the page route refused the measured step; nothing to judge (this is what the second pass removes) |
| ORACLES-SPLIT | one oracle agrees and the other does not |
| WRONG | no oracle that built it agrees |
| BUILT-ORACLES-REFUSE | built, and both oracles refuse |
| PIPELINE-DIFF | the kernels agree with the page route but the case's own closed form does not |
| HANG / CRASH | no answer in the time limit (machine load does this too: run the row again) |

A row that is not RIGHT is not yet a wrong solid, and a RIGHT is only as good as the oracles. Before calling anything, look at the numbers
(`tally.mjs` prints them). On the 6050 final solids judged so far every such row was one of these, and nothing was built wrong:

- **brep-rs disagrees, OCCT agrees** (9): a hole or pocket after a draft, reversed pulls of an outline with a round or a bulge. brep-rs is
  archived and is not changed.
- **A curved wall, within the tolerance on the volume and just outside it on the box** (8 cylinders, 3 cones): both oracles agree with each
  other; the page route is up to 1.9e-4 low in volume and 3.2e-4 to 1.3e-3 mm off in the box (the harness's box figure is relative to the
  coordinate, limit 3e-4). The engine's own accuracy, larger after a cut.
- **A hollow at an inside corner** (1, after a counterbore): OCCT rounds the wall there, the page route's plane offset is sharp, and
  `../remeasure-0.30.1/HALT-7.md` fixed the plane offset as the reference. About 0.4% apart.
- **Both oracles refuse a hollow** (7): work the volume out by hand.
- **The case's stored closed form is about another step** (1, `cb-seq-apart`).

When no oracle confirms a build, work its volume out with no kernel: `../pilot-2026-11b/new-seeds/closed-forms.mjs` and
`../pilot-2026-11b/old-seeds/closed-forms.mjs` are 35 such forms (closed, or a midpoint integral), each with what it assumes. A number is not
blessed without a second oracle (the repo's AGENTS.md); a form worked out by hand is one.

## What the oracle side does and does not do

- OCCT (`packages/brep-adapter/src/occt-build.ts`) reads the options of a pull and a pocket, a hole's counterbore and countersink, and tilts
  every wall of a whole-body draft, since 2026-11-13 (`packages/brep-adapter/test/occt-sweep-options.test.mjs` pins each against a hand-worked
  volume). What it does not build it refuses by name.
- A refusal by OCCT of the measured step, or of any step it rests on, counts as OCCT saying nothing. The referee passes a refused step's part on
  unchanged, so without this rule a later step is scored against a part the document does not describe. The rig's older harness copies do not
  have this rule.
- A stored reference (`sd`, `holes`, `ep`) is taken before the live oracles. All RIGHT rows of `sd` as written are judged by one.

## The page

This sweep runs in Node. The same cases in the real page, and the page compared with a sweep row by row, are
`../pilot-2026-11b/timing/inc.mjs` (it takes the cases from `DUMP_FILE=<file> node host-route-sweep.mjs --corpus=<c> --out=<dir> --no-oracle --child`)
and `../pilot-2026-11b/timing/page-sweep/vs-node.mjs`. The page and Node are different builds of the engine: one solid in 6050 differed, by 2.5e-9.

## Files

| file | |
|---|---|
| `host-route-sweep.mjs` | the sweep; its header lists the environment variables |
| `score-built.sh` | both passes and the tally |
| `mkdrop.mjs` | from a full pass, the list of steps that were not built |
| `tally.mjs` | verdict counts and every row that is not RIGHT, with its numbers |
| `run1.mjs` | one engine run in a fresh process: the time budget's stand-in for the page's worker |
| `gadget.mjs` | injects a block that makes one of the page's own guards fire (`GADGET_SEED`; the first pilot's three-way sweep) |

## Checked

Run from this folder on 2026-11-13 and compared with the rig runs the write-up is built on: the holes corpus as written and cut down (357 rows
each) and `combined` seeds 600 to 699 cut down (92 rows) give the same verdict and the same page-route volume (1e-9) in every row.

