# HALT-7: a hollow after a counterbore or countersink builds a wrong solid through the host route

2026-11-10, worktree branch `t3/429b33d9`, from main `fb662459`, pin SolidCraft v0.30.1 (`8e2b0cd6`). Found while working on the slow-hollow question (the 35 slow
failing fuzz shells). The work stopped here, as the brief says. `SLOW-HOLLOWS.md` was not written; what the slow-hollow work had found by then is listed at the end.

## Repro

Three short scripts, the kind a student writes. Each one builds through the host route on 0.30.1 with no refusal, and comes out the wrong size:

```js
// v-01396-centre: 467.650 mm3 built, 443.126 right (+5.5 %)
const b = box(12, 10, 6);
hole(b, { across: 2, counterbore: { across: 8, deep: 2 } });
hollow(b, { wall: 1, open: 'top' });

// v-01024-one: 1036.984 built, 1066.832 right (-2.8 %)
const b = box(22, 14, 6);
hole(b, { across: 2, at: [-4, -1], countersink: { across: 8, angle: 90 } });
hollow(b, { wall: 1.5, open: 'top' });

// v-00872-wall2: 2413.578 built, 2469.474 right (-2.3 %)
const b = box(18, 18, 12);
hole(b, { across: 3, countersink: { across: 12, angle: 90 } });
hollow(b, { wall: 2, open: 'top' });
```

How it was run: `slow-hollows/hr-reach.mjs wrong3.json --budget`, which is the host route as Stage B ran it (`stageB/hr-one.mjs`: host-entry `translateDoc`, planners
'unified', `HOST_EP_JOIN_CHECKS` 'full', pane.js ctx, `preflightScript`, `fromUsage`, `topologyOf` with measure), with a probe that behaves like the bridge's budget: a
fresh process for each budgeted run, killed when `budgetS` runs out. Every feature comes back `built` and no guard fires. Results: `slow-hollows/budget-030.jsonl` (0.30.1)
and `slow-hollows/wrong3-021c.jsonl` (0.21.0 corrected).

## The right answers, from two independent checks

- **Closed form, v-01396-centre:** S = 720 − π·1²·6 − π(4² − 1²)·2 = 606.90. The cavity is the inner box 10 × 8 × 5 = 400, minus the bore's offset tube (r 2, z −2..0)
  = 25.13, minus the counterbore's offset tube (r 5, z 0..3) clipped to |y| ≤ 4: (78.54 − 2 × 4.0875) × 3 = 211.09. So the cavity is 163.78 and P = 443.12.
  The plane-offset oracle gives 443.126.
- **Plane-offset oracle** (`fuzz/oracle.mjs`, copied as `slow-hollows/oracle-com.mjs` with a centre-of-mass sum added, h = 0.05). Two controls agree to 1e-5:
  a 40 × 30 × 10 plate with a d4 countersink (4946.567 built, 4946.621 oracle) and with a d4 counterbore (4989.502 built, 4989.529 oracle). The three cases above
  are off on volume by 2.3 to 5.5 % and on centre of mass by 3.6e-3 to 5.4e-3 of the diagonal.
- **Euclidean-erosion cross-check** (`euclid()`, which defines the hollow a little differently, so it reads 0.5 % low on the clean control): 439.7, 1069.4, 2475.4.
  It is 0.25 to 0.8 % from the plane oracle and 2 to 6 % from the host.

**0.21.0 corrected builds exactly the same wrong volumes** (`wrong3-021c.jsonl`). So this is not something the repin introduced. It is fuzz WRONG family A (README:
"a round hole's offset reaches the offset plane of a neighbouring wall: web in [t, 2t) built wrong"), reached here through the recess. In each case the mouth of
the counterbore or countersink sits between t and 2t from a side wall: 1 at t = 1, 2 at t = 1.5, and 3 at t = 2.

## Why no guard fires

`G-HOLE` (`packages/layer/src/shell-draft.ts:661`) checks the offset tube of each hole with **the bore radius only** (`r = h.diameter / 2`, then `R = r + wall`). It never looks
at `h.counterbore` or `h.countersink`, so a recess that reaches past that radius is never compared with the walls. Using the bore only, all three cases pass, with each
bore's tube clear of the walls. With the mouth radius instead (counterbore across / 2, countersink across / 2), every one would be refused:

| case | mouth R + wall | limit (half the side − wall) |
|---|---:|---:|
| v-01396-centre | 4 + 1 = 5 (y) | 5 − 1 = 4 |
| v-01024-one | 4 + 1.5 = 5.5, centre y −1 → −6.5 | −7 + 1.5 = −5.5 |
| v-00872-wall2 | 6 + 2 = 8 | 9 − 2 = 7 |

The two controls stay clear with the mouth radius (5 + 2 = 7 ≤ 13, and 4 + 2 = 6 ≤ 13), so this change would not refuse them. The hollow check
(`hollow-check.ts`) only covers parts with rounded or bevelled edges, and the shell's post check (volume down, faces up) cannot see a 2 to 5 % error.

## Proposed fix (not made: a HALT stops the work)

In `G-HOLE`, take the tube radius as `max(diameter, counterbore?.diameter, countersink?.diameter) / 2 + wall`. It would reuse the existing G-HOLE sentence ("not
supported yet because a hole would be too close to a wall or to another hole (the hole's wall allowance of N reaches the side wall)"), so no sentence changes.
That alone is not enough to close it:
- A recess is only at the mouth, but the tube check runs over the hole's whole length. That over-refuses a recess on the closed side, but it is safe.
- The fuzz README also lists family 3, a countersink from the open face whose straight length is in (t, 2t). It needs a check along the axis, not a radius.
- Before it is accepted, it needs a sweep (gap from t to 2t, counterbore and countersink, recess on the open side and the closed side) against the plane-offset
  oracle and a closed form.

This is for the owner to decide. The guard layer's promise is broken for this class, and it has been broken on both pins.

## What the slow-hollow work had found when it stopped

- **The 35 Stage B cases, as scripts** (`slow-hollows/fz2script.mjs`, `scripts35.json`, first pass with the hollow's kernel run stubbed: `reach-stub-030.jsonl`):
  - 11 cannot be written exactly, because hollow() opens one face (10 cases open two) or cannot name the top of the U body's wall (s1-02056). Their nearest scripts were run anyway.
  - 31 are refused before the kernel: G-HOLE 11, G-BLIND 10, G-CONVEX 1 (s1-00456, a pocket), and 9 through an earlier feature (G-TOP on a hole cut from a
    turned part ×7, the stale-target rule after a join ×2).
  - 4 reach the kernel: s1-00872, s1-01024, s1-01180 (its top-only nearest script) and s1-01396. All 4 are a single counterbore or countersink hole that passes G-HOLE
    on the bore radius alone, the gap above.
- **The 4 reached, on 0.30.1 under the bridge budget:** each first hollow run passes 45 s and is refused with G-BUDGET and the existing sentence. The hollow
  feature takes 46 to 58 s in all (45.3 to 48.2 s of that is the stopped run), and box and holes stay built. Student-plausible rounder variants do the same (4 of 5). The
  budget works here because the first run times out. A run that fails under 45 s goes on to the next of up to 10 candidate open-face points, each with its own
  45 s, and nothing caps the total. Not measured further.
- **The slow class is wider than the fuzz points, and some of it builds:** v-00872-wall2 builds after 37 s of kernel time and v-01024-one after 26 s, both
  under the budget. Both are wrong (above). In the page, a run that finishes in time is run a second time to apply it, so the wait there would be about twice that.
- **Not done:** the raw unbudgeted timing of the 4 reached cases on both kernels (the units were stopped), the 0.21.0 budgeted run of all 13, and the real-browser
  run at the normal budget.

Runner record: `~/.cache/solidcraft-0.30.1-rig/slow-state.tsv`, logs `~/.cache/solidcraft-0.30.1-rig/logs/slow-*.log`. Two early budget runs were thrown away
because of a bug in my probe stand-in: it passed spawnSync a fractional timeout. They are kept as `*.discarded*.jsonl` in the rig, not in this folder.
