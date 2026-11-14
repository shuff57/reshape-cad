# Plan: what the second pilot left open

Written 2026-11-13, at `a689780e`, pin SolidCraft v0.30.1 (`8e2b0cd6`). The evidence for every number here is in
`pilot-2026-11b/PILOT-2.md`, from "Q7, where the time goes" to the end. This plan covers the eight items that report closes on, and lists
the older open items so they are not lost. It replaces nothing in `docs/PLAN-scripting-layer.md`; it is the next stretch of its phases 2 and 3.

## Where we start from

- 7468 final solids judged on what they build, none wrong. The last change (a hole across a hollowed cylinder is refused) takes 7 of those
  builds and 4 steps built on them out; the count has not been re-run since.
- The page and the Node host route agree step by step on 7784 documents but for explained rows.
- The scoring harness is in the repo (`sweep/`), the OCCT referee reads what the documents say, and the page survives an engine crash.

## The rules this plan works under

Unchanged, from the repo's AGENTS.md: built or refused, never a silently wrong solid; no new or changed sentence or page text without the
owner's exact wording; nothing pushed, filed or posted without the owner approving it; upstream is not patched; `archive/` and the frozen gate
scripts are not edited; a number is not blessed without a second oracle. A change to the layer is swept before and after on every corpus and
on the new documents (`pilot-2026-11b/cross-hole/compare-sweeps.mjs` is the comparison), and the six page checks are run before a commit.

## Order

| # | item | why here | size | the owner decides |
|---|---|---|---|---|
| 1 | Sweep bookkeeping | makes every later check cheaper and removes the rig-only copies | half a day | nothing |
| 2 | A cylinder's wall in the page | probably nothing to fix; cheap to prove | an hour or two | nothing, unless something turns up |
| 3 | A progress line for long runs | the one thing a student sees every day | half a day | the exact words |
| 4 | A hole across a solid cylinder | the layer refuses what the engine builds right | one to two days | allow it or not, and the limits |
| 5 | A step that hangs without a crash | the last way the page can freeze | one day of machine time | what to do if a class is found |
| 6 | The referee's hollow at an inside corner | the last place OCCT disagrees by meaning | half a day | nothing |
| 7 | What we know about the engine, for upstream | four findings nobody upstream has heard | half a day to draft | every word, and whether to send |
| 8 | brep-rs's disagreements | archived; record, do not fix | with item 1 | nothing |

Items 1 and 2 first because they are cheap and item 1 pays for the rest. Item 3 before 4 because it helps every long run, including the
ones item 4 would add. Items 5 to 8 can go in any order and do not block each other.

## 1. Sweep bookkeeping

**Known.** A sweep of everything leaves 40 rows that are not a plain RIGHT, each explained by hand in PILOT-2.md. The next sweep will show
the same rows and somebody has to recognise them again. The rig still has two older harness copies (`h16/host-route-x.mjs`,
`next-loop/hg/host-route-com.mjs`) without the two scoring rules. The page side (`pilot-2026-11b/timing/inc.mjs`) and the comparison
(`page-sweep/vs-node.mjs`) live in a pilot folder.

**Do.**
1. `sweep/known.json`: the explained rows by case id, each with its class and the line of PILOT-2.md that settles it. `tally.mjs` prints
   them as "known" and prints anything else as NEW. The classes: brep-rs disagrees, a curved wall's box, a hollow at an inside corner, both
   oracles refuse and the closed form agrees, the case's stored form is about another step.
2. `tally.mjs` classes a curved wall by rule, not by list: both oracles agree with each other, the volume is inside the tolerance, the box is
   within a stated number of millimetres. The number is taken from the eleven rows seen (the largest is 1.3e-3 mm) and written down, so a
   row that is further out is NEW.
3. Move `inc.mjs`, `vs-node.mjs` and `compare-sweeps.mjs` into `sweep/` and give `score-built.sh` a page pass, so one command runs the page,
   Node and the oracles and prints the three comparisons.
4. Replace the two rig copies with a file that says where the harness is.

**Done when.** One command over the six corpora and the 3000 new documents ends with "NEW: 0", and the same command on a tree with a fault
put in on purpose (the old pick box, say) ends with the rows that fault makes.

## 2. A cylinder's wall in the page

**Known.** The page gives no pick point for either half of a cylinder's wall: a point on one half lies on the other half's surface, so the
check cannot tell them apart, and it says nothing sooner than guess. But the two steps that would pick the wall are refused by the layer's
own rule before any pick: a hollow opened at "side" and a draft of "side" both say it is a curved wall, not a flat face. And on 7784
documents the page refuses nothing that Node builds.

**Do.** Twenty scripts a student would write on a cylinder, a cone and a round pad: `face('side')` wherever the script layer takes a face,
rounds and bevels of the rim, a pocket and a hole on a cap, the same after a move and a turn. Run them in the page and in Node.

**Done when.** The page and Node give the same result for all twenty, and the item is closed in PILOT-2.md; or the page-only refusals are
listed with what each would need. A way to tell the two halves apart (the side of the seam the point is on) is only worked out if a step
turns up that needs it.

## 3. A progress line for long runs

**Known.** During a run the page says "translating and building in solidcraft..." and nothing else until the end. With the holes across a
hollowed cylinder refused, the slowest scripts of the new documents still took 66 to 90 s in the page; the knob of the pilot takes 15 s. SolidCraft computes on the page's own thread, so
nothing can be drawn while one engine call runs; the line can only change between calls.

**Do.**
1. The layer tells its caller which step it is on: one optional callback in the translate loop (`ctx.onStep(id, kind, index, count)`),
   called before a step is planned. No result depends on it; the contract copies do not need it.
2. The page writes the step into the status line and yields to the browser once so it is drawn before the engine is called.
3. The words. Proposal for the owner, to change freely: `building step 4 of 9: hole1 ...`, and after 10 s on one step
   `building step 4 of 9: hole1 ... (this one is slow)`. No seconds are shown: a count that stops while the engine works reads as a freeze.

**Done when.** The owner has approved the exact words; `live-pane` shows the line changing on a slow script; the six page checks are
otherwise unchanged; the Node sweep is unchanged step for step.

**Not here.** Showing a spinner or a bar during one engine call needs the engine off the page's thread, which is upstream's to do.

## 4. A hole across a solid cylinder

**Known.** The layer refuses it at once (G-CURVED). Asked directly, 0.30.1 cuts a bore of radius 1 to 3 across a cylinder of radius 10 in 3
to 10 s, within 3.4e-5 of a volume worked out by hand. That is three cases. brep-rs refuses a hole across a curved wall, so the second
oracle is OCCT and the hand-worked volume. Across a HOLLOWED cylinder the same cut takes 15 s and stays refused whatever is decided here.

The guard still does not see a cylinder behind anything but a hole or a hollow. `rg combined seed 1184` drills across a MIRRORED cylinder:
the hole goes to the engine and is stopped by the time budget after 45 s (the script takes 86 s in the page). How many such steps there are
behind a mirror, a move, a copy, a round or a draft has not been counted.

**Do.**
0. First the cheap half, which does not wait for the family below: count, in the 7784 documents, the holes across a curved wall that the
   guard does not see because of the step in between, with what each costs in time. Then one question to the owner: should the guard look
   through the steps that leave the wall and its axis as they are (a move, a mirror, a copy, a round), as it now looks through a hollow?
   Same sentence, same sweep before and after.
1. A family of about 400 cases, the guard switched off: cylinder radius 4 to 30; bore from a twentieth to nine tenths of it; through the
   axis, off it, grazing the wall, breaking out of the side; through and blind; with a counterbore and a countersink; a cone; a round pad;
   the cylinder turned so that "across" is another axis; a second hole across the first.
2. For each: the engine's time in the worker, the volume against the integral (`cross-hole/cross-solid-cylinder.mjs` has it for the plain
   case; the grazing and breaking-out cases need their own), OCCT, the face count, and whether the other hole guards (wide, tangent, top,
   crossing) still say what they should when this one is silent.
3. A table by bore-to-cylinder ratio and offset: right or not, and how long.

**The owner decides,** on that table: allow it or not; if allowed, up to what ratio and how near the wall; and what time is acceptable
for one hole (a 10 s hole is computed twice and replayed by every later step). If part of the range is allowed, the guard refuses the
rest with the sentence it has. If the sentence needs to say why some are built and some not, that is new wording.

**Done when.** The decision is recorded; if anything is allowed, the family is swept with the guard as decided (0 wrong), every corpus and
the new documents are compared before and after, and the page checks pass.

**Stop if** any case is built wrong within the range one would allow: then the guard stays, and the case goes into item 7.

## 5. A step that hangs without a crash

**Known.** 13806 of 19624 engine runs in the page have no time budget (pulls, pockets, drafts, rounds, moves and plain shapes in a script
without a hole, and every topology reading). A crash in one is now caught. A hang is not: the page's own thread is the engine's, so nothing
on the page can interrupt it. In the corpora the slowest such run took 4.2 s. Budgeting every run costs 46% on the slow scripts and the
owner chose not to.

**Do.** Look for a hang class before paying for cover against one.
1. In Node, where a child process can be killed: the unbudgeted kinds on awkward input, about 5000 cases from the existing generators with
   the hole steps taken out and the sizes pushed to the edges (thin walls, near-tangent outlines, tapers near closing, rounds near the
   limit, pockets at a rim). Limit 120 s a case.
2. Every case over 20 s is looked at: which command, and what in the input makes it slow.
3. Re-measure the slowest unbudgeted run in the page on the new documents now that the cross holes are refused.

**The owner decides,** only if a class is found: refuse it before the engine is asked (a guard with a sentence, the layer's usual answer),
or give that kind of step the budget.

**Done when.** Either "5000 cases, none over N s" is written down as the size of the risk, or the class has a guard or a budget and its
family is swept.

## 6. The referee's hollow at an inside corner

**Known.** OCCT's hollow rounds the wall at an inside corner (`GeomAbs_Arc` in `packages/brep-adapter/src/occt-build.ts`); the page's is
the plane offset, sharp there, which `remeasure-0.30.1/HALT-7.md` fixed as the reference. After a counterbore the two are 0.36% apart
(`fc combined seed 476`), so that row can never be RIGHT. The layer itself refuses a hollow of a part with a pocket or a groove for the
same reason (G-CONVEX); a through hole with a counterbore passes it.

**Do.**
1. Try the mitred join (`GeomAbs_Intersection`) on the HALT-7 controls and on the two rows of the sweeps. The file's own notes say other
   argument combinations failed on this kernel build, so this may not work.
2. If it works and matches the plane offset: use it, add the cases to `occt-sweep-options.test.mjs`, run both frozen gates, rescore.
3. If it does not: the referee refuses a hollow of a part that has an inside corner, by name, as it now refuses the other things it cannot
   build. It then says nothing on those rows, and the closed form is the reference.

**Done when.** `fc combined seed 476` and `440` are RIGHT or have a silent OCCT, no RIGHT moves, both gates pass 78 of 78.

**Worth asking while here:** whether a hollow after a counterbore should pass G-CONVEX at all, given that the layer refuses the same
thicker wall after a pocket. It is built to the reference today, so this is a question of meaning for the owner, not a fault.

## 7. What we know about the engine, for upstream

**Known.** Four things measured on 0.30.1 that are upstream's:
- a pocket into a drafted cylinder panics (`truck-geotrait-0.4.0/src/algo/curve.rs:78`, "tolerance must be no less than 1e-6"), which in
  the web build ends the engine for good; the command list is in `pilot-2026-11b/timing/continue/engine-stop-case.json`;
- a round of several edges is not repeatable: two runs of the same commands differ in the last digits and in the order of the faces;
- a cylinder's wall is not exactly round and less so after a cut (the box up to 1.3e-3 mm off, the volume up to 1.9e-4 low);
- a measured box that is higher than the part (6.0084 for 6) with no material there.

**Do.**
1. Run the four on the newest SolidCraft release in a scratch rig, not the pin, and check SolidCore's status page (plan phase 5): a fault
   that is gone is not reported.
2. For each that remains: a draft of an issue with the smallest command list that shows it and the numbers, as a file under
   `docs/spikes/`, not sent.

**The owner decides** every word and whether anything is sent.

**Done when.** The drafts exist and the owner has said yes, no, or changed them. The re-probe result goes into AGENTS.md's kernel note with
the owner's wording.

## 8. brep-rs's disagreements

**Known.** On 13 of the 7468 solids OCCT agrees with the page and brep-rs does not: a hole or a pocket after a draft or a move of a
cylinder or box, and reversed pulls of an outline with a round or a bulge (once 34 times the volume). It also refuses a hole across a
curved wall, a pocket whose tool is not enclosed, and a taper on a rounded outline. brep-rs is archived and is not edited.

**Do.** With item 1: the 13 go into `sweep/known.json` under "brep-rs disagrees", and the sweep's README lists what brep-rs refuses, so
that nobody takes a verdict on those steps for two oracles when it is one.

**Done when.** Item 1 is. **Revisit if** brep-rs is restored from the archive (the plan's fallback): these are then its first faults.

## Carried over from earlier lists, not planned here

Each is a refusal or a wording, none a wrong solid. Listed so that they are picked up when someone is in that file anyway.

- Sketch refusals that still name "brep-rs" to the student.
- A blocked move or turn is worded three ways.
- Grooves, spins and pulls beside a second part are not measured (holes, hollows, drafts, rounds, pockets, joins, moves, mirrors and
  repeats are).
- A pocket's result still reads 0 for `from:`.
- The "undefined face" sentences of a hollow and a sphere have no approved wording.
- Nobody has looked at the 3D view while these scripts run: every check reads numbers.
- "Run only the new steps" is built and off; it saves 5 to 12%. The two things that would save more (the worker keeping its design between
  probes, and returning SolidCraft to the accepted commands after a check without replaying them) are not attempted.

## How the work is run

As before. Anything over two minutes as a `systemd-run --user` unit with a memory cap, kernel runs under the rig's lock, no `dist` rebuilt
while a sweep that imports it is running. Each item ends with its evidence in the repo, a section in a dated report, a local commit, and a
question to the owner about pushing. An AGENTS.md change is its exact text, approved first.
