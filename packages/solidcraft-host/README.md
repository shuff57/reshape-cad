# solidcraft-host

Same-origin host page for the pinned SolidCraft web build. The embedding app (shCode) posts JSON; `src/bridge.mjs` checks it against an allowlist of the command ids our translators emit; `src/host.mjs` calls upstream `window.solidcraft` in the SolidCraft iframe. Nothing is patched upstream. Design and decisions: `docs/PLAN-scripting-layer.md` (Phase 3, open decision 1).

- `npm test` runs the allowlist unit tests (no browser).
- `test/live.mjs` is the real-browser check against the 0.21.0 build.
- Modelling lock: `{type:'lock', on:true|false}` from the embedding window shows an overlay over the ribbon. A classroom control, not a safety feature (shortcuts and the command palette still reach upstream tools). `--ribbon-h` in `host.html` is still 0: the ribbon height has not been measured.
- Script pane (`pane/`): the spike's pane (editor, example gallery, sandboxed interpreter, features built/refused, sketch solver report), re-wired onto upstream's API by `src/upstream-bridge.mjs` (file.new for a fresh run, engine.batch, document.inspect, sketch.inspect). `sh pane/build.sh` makes `pane/bundle/` (git-ignored; needs `npm run build` first). Checked live: `test/live-pane.mjs`.
- NOT built or not checked (was: the scripting pane):
  - no restore or stash of the student's own design (a run replaces it, after asking; the pane says so);
  - no named picks (topology is unavailable on upstream, so those features refuse in a sentence);
  - no guards: the pane still uses the 0.9.0 spike translator, so it is not covered by the never-a-wrong-solid promise until Phase 2 is folded in;
  - the sketch-solver and shell fixes of the spike were patches against 0.9.0 and are not in 0.21.0;
  - the ribbon height for the lock overlay (`--ribbon-h`) is unmeasured; of the spike's 56 example scripts only one has been run on 0.21.0.

## Example scripts on SolidCraft 0.21.0 (2026-10-25, `test/examples-0.21.0.json`)

56 example scripts from the spike, each run through the pane in headless Chrome and compared with an independent reference (closed form, brep-rs, OCCT; the references are the spike's, stored in `pane/examples.json`).

- **38 pass** (all 3D primitives and booleans tried, every constrained or friendly sketch, 12 misuse scripts).
- **18 do not pass, and all 18 are refusals, none a built wrong solid.** 17 of them are named edge or face picks (`box1.face[+z]`, a named fillet edge, a named shell opening): the adapter reports no topology, so the pick is refused in a sentence. The 18th is a counterbore, which the spike translator never mapped. Six of the 18 are the old shell-stub family; with no topology they are refused before the kernel is asked, so **this run says nothing about whether 0.21.0 still builds a stub shell wrong.**
- Did **not** check: whether any of the 38 would still pass with the guards of Phase 2 in place, or any script outside these 56.
- Upstream does have the data needed for named picks (`model.faces`, `model.edges` through `engine.execute`: index, name, area, centroid, normal, point, cylinder; edge midpoint, length, ends). The spike's resolver also reads a nearest-face check (`centroid_hit`) and edge names that upstream does not give directly, so supplying topology needs its own checked effort (a wrong pick is a wrong solid).

## With the layer wired in (2026-10-25, `test/examples-0.21.0-with-layer.json`)

The pane's translator is now `packages/layer` with the extrude-pocket planner set (Phase 2 fold 1), not the spike's `translate-p4.mjs`. The same 56 examples: **38 pass, 18 do not, exactly as before the wiring** (same pass/fail, same volumes to 1e-6).

The first wiring run gave 36: the group's translator replaces every pull refusal with a generic "does not close up cleanly" sentence, which hid the sketch diagnosis in `diag-conflict` and `diag-redundant`. Owner chose to carry the diagnosis through, in plain words (no `sketch.dimension`, `k10`, `driven: true`): `plainKernelSentence` in `packages/layer/src/extrude-pocket.ts` now says "a rule or dimension in this sketch conflicts with the others (it would over-constrain the sketch)…" and "a dimension in this sketch is already determined by the other rules…". This is a deliberate deviation from `translate-ep.mjs`, covered by `packages/layer/test/sketch-diagnosis.test.mjs`. Only those two diagnoses measured on 0.21.0 are handled; any other solver message still gets the generic sentence.
