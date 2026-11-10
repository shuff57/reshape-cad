# solidcraft-host

Same-origin host page for the pinned SolidCraft web build. The embedding app (shCode) posts JSON; `src/bridge.mjs` checks it against an allowlist of the command ids our translators emit; `src/host.mjs` calls upstream `window.solidcraft` in the SolidCraft iframe. Nothing is patched upstream. Design and decisions: `docs/PLAN-scripting-layer.md` (Phase 3, open decision 1).

- `npm test` runs the allowlist unit tests (no browser).
- `test/live.mjs` is the real-browser check against the pinned build (0.30.1 since 2026-11-09; first written against 0.21.0).
- Modelling lock: `{type:'lock', on:true|false}` from the embedding window shows an overlay over the ribbon. A classroom control, not a safety feature (shortcuts and the command palette still reach upstream tools). `--ribbon-h` in `host.html` is still 0: the ribbon height has not been measured.
- Script pane (`pane/`): the spike's pane (editor, example gallery, sandboxed interpreter, features built/refused, sketch solver report), re-wired onto upstream's API by `src/upstream-bridge.mjs` (file.new for a fresh run, engine.batch, document.inspect, sketch.inspect). `sh pane/build.sh` makes `pane/bundle/` (git-ignored; needs `npm run build` first). Checked live: `test/live-pane.mjs`.
- NOT built or not checked (was: the scripting pane):
  - no restore or stash of the student's own design (a run replaces it, after asking; the pane says so);
  - named picks and fillet/chamfer now work through the topology adapter below (2026-10-27); a loft between two sketches (`blend`) is still refused in the pane (`NOT_YET` in `pane/src/host-entry.mjs`: its guards are not folded in);
  - the sketch-solver and shell fixes of the spike were patches against 0.9.0 and are not in 0.21.0;
  - the ribbon height for the lock overlay (`--ribbon-h`) is unmeasured; of the spike's 56 example scripts only one has been run on 0.21.0.

## Pin: SolidCraft 0.30.1 (2026-11-09)

The pin moved from 0.21.0 corrected to **v0.30.1** (`8e2b0cd6`, truck kernel), unmodified, by owner decision against the Stage B recommendation (`docs/spikes/solidcraft-referee/remeasure-0.30.1/REMEASURE-0.30.1.md`, "Owner decision"). "Corrected" at 0.21.0 meant our wrapper's build settings only (upstream's release profile and root `[patch]` block); 0.30.1 is built the same way.

What changes for students (all measured by Stage B through the host route; nothing else changed there):
- A box with rounded bottom edges can no longer be hollowed. It is refused: "shell1 (hollow): round4 could not be hollowed with this wall and open side, so shell1 is shown without it -- try another wall or another open side." (0.30.1 builds it wrong; the hollow check catches it.)
- One keep() is refused (a large cylinder dipping 5 mm into a box, `r6h-top-keep-r120-d5`).
- A hollow now runs under the same 45 s time budget as holes, combines and grooves. A hollow that runs out of time is refused with the existing sentence "shell1 (shell): building this took longer than 45 seconds of computing, so it was stopped and shell1 is shown without it." Before, a failing hollow could keep the page busy for minutes on 0.30.1.
- Rounded outlines 1e5 to 1e6 mm from the origin now build.
- The page is heavier: the SolidCraft page wasm is 101.0 MB (0.21.0: 52.0 MB) and the time-budget kernel 73.7 MB (0.21.0: 35.4 MB). It is the engine that grew (code section 50.2 MB against 25.4 MB), not debug data: wasm-bindgen drops DWARF, and `debug = false` was measured 0.02% smaller with slightly different code, so the wrapper keeps upstream's profile verbatim.
- No sentence was written or changed.

Build:
- Web build: `git archive v0.30.1` into `~/.cache/solidcraft-0.30.1/src`, then `trunk build --release` in `apps/solidcraft-web` (writes `dist/web`; peaked at 11 GB, twice killed at an 8 GB cap). The site folder is `~/.cache/solidcraft-0.30.1-rig/student-preview` (symlinks: host.html, pane, src, kernel -> `kernel/dist`, solidcraft -> that `dist/web`).
- Time-budget kernel: `sh kernel/build.sh` (default source `~/.cache/solidcraft-0.30.1-rig/sc-src`). It now copies upstream's `Cargo.lock` in first. Without it cargo had resolved 26 crates newer than upstream pins (the 0.21.0 template had no lock copy either). With it, the wasm is byte-identical to the package Stage B measured (sha256 `9dc93a11…2b03936e`, 73,741,446 B), so Stage B's numbers are this kernel's.
- Fixed on our side: `src/probe-kernel.mjs` (the hand-ported glue) lacked an import the 0.30.1 wasm needs (`Date.now`). Without it every probe failed and the pane refused every budgeted run (a box with a hole, a join). `probe.test.mjs`'s real-wasm test now runs against the 0.30.1 package.

Checked on 0.30.1 (real browser, one headless Chrome):
- `test/live.mjs`: API up, `file.export` and a raw request refused by the allowlist, `solid.box` builds (area 2200, bbox 30 x 20 x 10), inspect measures it, the lock overlay shows. As on 0.21.0.
- `test/live-pane.mjs`: box with a hole builds 11717.30363 mm3 (0.21.0: 11717.30363; closed form 11717.26); a second run asks before replacing the design.
- `test/live-examples.mjs` (`test/examples-0.30.1.json`): **46 of 56 pass, the same 46 as 0.21.0 with the adapter**; the same 10 do not, with the same sentences (9 refusals, and refuse-shell-closed, which builds right at 11264 and whose expectation is out of date). 51 volumes are bit-identical to 0.21.0, and the largest difference is 2.9e-13.
- Second oracle, `host-route-com.mjs` with an `examples` corpus (`docs/spikes/solidcraft-referee/remeasure-0.30.1/repin/`): the 30 examples its interpreter takes, through the host route, scored on volume, box and centre of mass against OCCT and brep-rs: 26 RIGHT, 4 REFUSED, 0 WRONG, every COM checked, the same verdicts on 0.21.0 corrected. Not run there: the 12 misuse scripts, the 8 friendly-sketch scripts and the 6 stubs (its interpreter rejects them; the pane run above scores the friendly ones against their stored references and refuses the stubs).
- `test/live-fillet.mjs` (`test/fillet-0.30.1.json`): all 13 identical to 0.21.0 (7 built and right on their closed forms, 6 refused as expected).
- `test/live-budget.mjs` (`test/budget-0.30.1.json`): the slow four-countersink script with a 2 s cap is refused G-BUDGET and the box stays (longest page stall 921 ms; 0.21.0: 582 ms); probe off it builds 31363.385 as on 0.21.0. The 150-hole run times out at 5.18 s, longest stall 180 ms. 56 examples, probe on and off: volumes and statuses identical in 56 of 56. 20 scripts send a budget (0.21.0: 18; the two new ones are hollows), 32 probes, every probe volume equal to the page's.
- `test/live-hollow-budget.mjs` (`test/hollow-budget-0.30.1.json`): a plain open hollow with every budget cut to 0.05 s is refused with the budget sentence and the box stands. Uncapped it is probed under 45 s and builds 2424 mm3 (closed form 2424). A family-C hollow is probed (0.9 s) and then refused by the hollow check.
- Root `npm run build && sh pane/build.sh && npm test`: 997 tests, 991 pass, 0 fail, 6 skipped.

Not shown: a real hollow that runs past 45 s in the browser (the 35 slow fuzz shells are command lists, and whether a student script reaches them past G-HOLE, G-BLIND and G-CONVEX was not tested). The cap test above runs the same code path.

## Example scripts on SolidCraft 0.21.0 (2026-10-25, `test/examples-0.21.0.json`)

56 example scripts from the spike, each run through the pane in headless Chrome and compared with an independent reference (closed form, brep-rs, OCCT; the references are the spike's, stored in `pane/examples.json`).

- **38 pass** (all 3D primitives and booleans tried, every constrained or friendly sketch, 12 misuse scripts).
- **18 do not pass, and all 18 are refusals, none a built wrong solid.** 17 of them are named edge or face picks (`box1.face[+z]`, a named fillet edge, a named shell opening): the adapter reports no topology, so the pick is refused in a sentence. The 18th is a counterbore, which the spike translator never mapped. Six of the 18 are the old shell-stub family; with no topology they are refused before the kernel is asked, so **this run says nothing about whether 0.21.0 still builds a stub shell wrong.**
- Did **not** check: whether any of the 38 would still pass with the guards of Phase 2 in place, or any script outside these 56.
- Upstream does have the data needed for named picks (`model.faces`, `model.edges` through `engine.execute`: index, name, area, centroid, normal, point, cylinder; edge midpoint, length, ends). The spike's resolver also reads a nearest-face check (`centroid_hit`) and edge names that upstream does not give directly, so supplying topology needs its own checked effort (a wrong pick is a wrong solid).

## With the layer wired in (2026-10-25, `test/examples-0.21.0-with-layer.json`)

The pane's translator is now `packages/layer` with the extrude-pocket planner set (Phase 2 fold 1), not the spike's `translate-p4.mjs`. The same 56 examples: **38 pass, 18 do not, exactly as before the wiring** (same pass/fail, same volumes to 1e-6).

The first wiring run gave 36: the group's translator replaces every pull refusal with a generic "does not close up cleanly" sentence, which hid the sketch diagnosis in `diag-conflict` and `diag-redundant`. Owner chose to carry the diagnosis through, in plain words (no `sketch.dimension`, `k10`, `driven: true`): `plainKernelSentence` in `packages/layer/src/extrude-pocket.ts` now says "a rule or dimension in this sketch conflicts with the others (it would over-constrain the sketch)…" and "a dimension in this sketch is already determined by the other rules…". This is a deliberate deviation from `translate-ep.mjs`, covered by `packages/layer/test/sketch-diagnosis.test.mjs`. Only those two diagnoses measured on 0.21.0 are handled; any other solver message still gets the generic sentence.

## Topology adapter (2026-10-27, `test/examples-0.21.0-with-topology.json`, `test/fillet-0.21.0.json`)

`createUpstreamBridge(sc).topologyOf(commands)` (also `execute(cmds, {topology:true})`) gives the layer the `topologyOf` it needs. It starts from an empty design (`file.new`), runs the commands with one `engine.batch`, then reads `model.faces` and `model.edges` of every body and `inspect({measure:true})`. The reply is `{ok, topology:{bodies:[{name, faces, edges}]}, measure:{bodies}, results:[{feature}]}`; `measure` carries the face count the fillet-chamfer set needs, `results[k].feature` is upstream's own feature number of command k (the persistent-name check). The pane's ctx is now `{arc, mt, runSC, soups, followMoves: true, topologyOf}` (the old `resolveAt: () => null` is gone: a present `resolveAt` forces the shell-draft group's brep-rs path, which always answered null here). Pure pieces (unit-tested in `test/upstream-bridge.test.mjs`, no browser): `adaptBody`, `verifiedInnerPoint`, `surfaceDistance`.

- **Passed through as upstream says it:** face `index`, `name` (`F1:+z`), `area`, `centroid`, `plane_normal`, `cylinder`; edge `index`, `name` (`A|B`, `~n`), `start`, `mid`, `end`, `length`.
- **Derived, and only when exact:** `inner_point` + `inner_hit` (the layer's "pick point that lands on this face"). Upstream calls `point` a point that picks the face. It is passed on only if the point is on the face's own plane (or cylinder), inside the box of the face's boundary edges, and no other face's surface comes within 1e-3 mm of it. Otherwise the face has none and a pick of it is refused in a sentence. Still taken from upstream's word: that the point lies within the face (not in a hole, not past an edge) and that its nearest-face rule agrees. A body with a sphere, cone or torus face (no surface data) gets no pick points at all.
- **Absent, not invented:** `centroid_hit` (upstream does not say which face a pick at the centroid lands on), any edge name beyond upstream's `A|B` form, and history records for 'split' / 'made' names.
- **Cost:** every `topologyOf` replays the accepted commands from scratch (like `runSC` with `fresh`), so it is slow on long scripts; as before, a run replaces the student's design.

### Example scripts with the adapter (same 56)

**46 pass, 10 do not (the earlier 38 and 18).** Nothing that passed before stopped building right. Changed results:

- Newly pass (9, all built and compared with OCCT by the pane's own check): named-fillet-edge (rel 1.6e-6), named-bevel-edge (exact), named-shell-open-top (exact), named-draft-face (7e-16), named-cylinder-rim (1.1e-4, bar 3e-4), named-edge-after-cut (6e-7), named-hole-then-round (1.5e-6), named-hole-then-shell (5e-6), named-pocket-wall-round (2e-7).
- named-counterbore-round: still FAIL, but it now builds more: base + post + the rounded box = 14997.8526 against the reference 14997.8540 (rel 9e-8); the hole stays refused, with the layer's "2 separate pieces" sentence instead of the spike's "counterbore" one, which is what the check wants to see.
- refuse-shell-closed: pass to FAIL, and the solid is right. The check expected a refusal (the spike did not map a closed hollow); the layer's closed-hollow path builds it: 11264 mm3 = the OCCT and closed-form reference (40*40*20 - 36*36*16). The expectation in `pane/examples.json` is out of date, not the build. Counting it as right, 47 of 56 are right.
- The 9 that still fail are all refusals, none a built wrong solid: refuse-name-two-faces, refuse-name-swept-arc (different sentence from the one the check wants), and the 6 shell stubs (stub-*), which are now refused by the layer's own guard ("... the part has inside corners ... where the new wall would come out thicker than ...") before the kernel is asked; before they were refused for lack of topology. This still says nothing about whether the kernel builds a stub shell wrong.

### Fillet and chamfer scripts (`test/live-fillet.mjs`, closed-form volumes)

| script | result |
|---|---|
| 40x40x20 box, `round(b.edge('top','front'), 3)` | built, 31922.693 vs 31922.743 (1.6e-6) |
| same, radius 10 | built, 31141.030 vs 31141.593 (1.8e-5) |
| `chamfer(b.edge('top','right'), 3)` | built, 31820 exact |
| two far edges rounded 3 | built, 31845.385 vs 31845.487 (3.2e-6) |
| box placed with `at: [15,5,7]`, rounded | built, 1.6e-6 |
| cylinder rim round 3 | built, 3327.864 vs 3328.239 (1.1e-4) |
| box then `move(b, [15,5,7])`, then round or chamfer its edge | refused: "The edge for round1 was already changed by an earlier move, so round1 is shown without it -- round the edge before that step, or name an edge it left alone." (edges are not followed through a move) |
| radius 30 or 20 on that edge | refused: "The round round1 is as big as or bigger than the face it cuts into (20 wide) ... use a size under 20." (chamfer 25 likewise) |
| radius 0 or -2 | refused: "The round size of round1 is zero, negative or smaller than 0.01 ..." |

### What is not proven

- 56 example scripts and 13 fillet scripts, one machine. Not a fuzz: the layer's own real-kernel replays of the fillet-chamfer set (`packages/layer/test/live-replay-fillet-chamfer.mjs`) were not run here.
- `inner_hit` rests partly on upstream's `point` claim (above). The outcomes (opened face, drafted face, rounded edge) match OCCT or a closed form in every example, which is the real check, but there is no adversarial test with a face whose pick point is wrong.
- Moved parts: faces follow a move (`followMoves`), edges do not (refused in a sentence). Not exercised in the pane: turned parts, patterns/mirrors behind a pick, faces with holes beyond the two examples.
- `blend` (loft) is still blocked in the pane.

## Time budget: kernel in a worker (2026-10-27, `test/budget-0.21.0.json`, `test/live-budget.mjs`, design: PLAN Phase 3a)

Since the 0.30.1 pin (2026-11-09) hollows send a budget too, and the kernel is the 0.30.1 one; numbers on 0.30.1 are in "Pin" above. The section below is the 0.21.0 record.

`createUpstreamBridge(sc, { prober })`: `execute(cmds, { fresh, budgetS })` first replays `cmds` on a scratch session in a fresh Worker (`src/probe-client.mjs`, `src/probe-worker.mjs`, `src/probe-kernel.mjs`) and terminates it when `budgetS` runs out. In time: the commands are applied in SolidCraft as before and the reply carries `cpuMs` (the Worker's engine time). Out of time: `{ ok:false, timedOut:true, cpuMs, failed:{command:'(budget)', error:'TIME BUDGET: exceeded N ms'} }`, SolidCraft untouched. Worker trap or kernel not served: `{ ok:false, probeError:true, failed:{command:'(probe)'} }`, SolidCraft untouched. No `budgetS` (every unbudgeted run): no probe. The pane wires it (`pane.js`; `?probe=off` switches it off, `?budgetCapS=N` shortens every budget, for tests).

Setup: `sh kernel/build.sh` (needs the rig's `sc-src`, cargo, wasm-bindgen; a few minutes, 8 GB or more at 0.30.1: run under `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0`) makes `kernel/dist/`; serve that folder as `kernel/` next to `pane/` (the preview folder has a symlink). `npm test` has 12 unit tests for the pure parts (fake Worker and clock) and one against the real wasm if the rig is there.

Real browser (one headless Chrome, 3 GB cap), against the 0.21.0 web build:
- **Slow, refused:** four countersunk blind holes (about 3 s of engine time) with every budget cut to 2 s: the third probe timed out at 2000 ms, `hole1` is refused with the layer's G-BUDGET sentence beside the built box, the box stays intact, and the host page's event loop never stalled longer than 582 ms (50 ms heartbeat). The same script with the probe off builds (7 s) and freezes the page for 2623 ms at a time. The sentence still says "45 seconds": the layer's fixed wording, whatever the actual budget.
- **Far over the budget:** 150 countersunk holes in a 200 mm plate (minutes of engine time), `runSC(cmds, { budgetS: 5 })`: `timedOut` at 5.09 s, longest page stall 95 ms, the page builds a 10 mm cube afterwards. The probe Worker's thread kept burning CPU for up to 2 s after `terminate()` (sampled every 250 ms), then went away; the page was responsive throughout.
- **Fast, same solid:** the 56 example scripts, probe on and off: volumes and feature statuses identical for all 56 (12 of them are misuse scripts the interpreter rejects, in both modes). 18 scripts send a budget (holes, patterns, booleans): 30 probes; probe volume against the real run on the same commands equal to the last digit in 30 of 30. Cost: 41 ms per probe on average (first one about 110 ms: it compiles the 35 MB module), at most 293 ms of probing per script, total 1.2 s over the 18 scripts whose runs took 8.7 s without it (+12%); median +20 ms per script. Scripts without a budget cost nothing.

What this does not prove: a real over-45 s run (the layer's own predictive guards refuse the known slow classes before the engine; the slow case above reaches the same code path with a shorter budget); that the Worker build equals the page build on every command (equal on the 30 runs above, 18 scripts; they are two compilations of the same sources); behaviour on a loaded machine or a school Chromebook (the probe is a second engine instance of about 100 MB; the Worker is slower than the page if the machine is, and a probe that finishes can still be followed by a page run that does not).
