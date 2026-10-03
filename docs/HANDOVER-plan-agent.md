# Where we stand on the 3D and 2D scripting layers (2026-10-03)

Nothing is pushed in either repo (reshape-cad, shCode). Latest reshape-cad commit: `3e07bde`; shCode vendor: `bb477642`.
The full plan and its progress log are `docs/PLAN-scripting-layers.md` (sections 8-11).

## Status

**3D (reSHape Script over brep-rs):** all 22 ModelDoc feature kinds build, round-trip (toScript fixpoint) and are
pinned by `packages/kernel/test/coverage-matrix.test.mjs` (`3D: 22/22 kinds`). Datum planes (`plane()`), Stages 1-3, are in,
including clicking a plane in the 3D view. Holes find the thickness of extrudes, unions, linear patterns, moves, wedges, turned
boxes/cylinders and (provable cases of) polar patterns, and blind holes start at the drilled face. A bore down a cone's own
axis and a bore across a cylinder's side build exactly.

**2D (sketch soup):** 4/4 geometry kinds, 16/16 rule kinds, 11/11 refusals, multi-loop builds are covered by the same matrix.
Slots, standard hole sizes (`size:`), a sketch frame, tangent chains and surplus-argument errors are done.

**Contract:** the kernel never returns a wrong solid silently; whatever it cannot build exactly it refuses per feature in a plain
sentence, and the docs preview shows that sentence.

**Numbers:** sketch 9, script 259, kernel 432, studio 239 pass; cargo 337 pass + 1 known failure
(`spike_coplanar_chamfer_on_a_boolean_result_is_exact`, K2b); gates parity 70/2, mesh 70/2, step 64/0/6, occt 17/0 (the two
parity/mesh reds are honest refusals). shCode gates all green (docs, codegen 148/148, script 237/237).

## Known limits (all honest refusals or documented)

- Cone bore: only down the cone's own axis. Across a cone, off-axis reaching the wall, and a countersink on a cone refuse.
- Transverse bore across a cylinder: refuses above r/R 0.95, off-centre/skew axes, through a cap; any further cut on a bored
  part refuses; STEP export of a bored part refuses (needs an INTERSECTION_CURVE or B-spline writer).
- Polar-pattern thickness for cones/prisms/tori/wedges or derived targets about another axis: still "cannot find how thick".
- Blind hole in a multi-copy pattern: the kernel refuses ("cannot cut this hole yet").
- Round beyond a box (ball blend), chamfer on a boolean result (K2b, gated on K1a which failed its stop rule): refuse.
- A tool that only meets a concave part's bounding box is not refused as "misses part".
- Pocket/hole removal after a fillet refuses (kernel limit); STEP gate reads a half-turn groove as 1 solid/1 shell.
- No fixture for the new bores in the parity gate (lead-owned file); no browser check of the new solids.
- `inside_solid` uses a 5-ray vote (shared code; revertible hunk in `21b1044`).

## Waiting on the owner

1. Push (held; shCode may deploy on push).
2. Human review of the four clean-room notes in `docs/clean-room/` before any implementer uses them.
3. Licence holder string in `NOTICE` (currently `shuff57`).
4. Authorisation to add parity fixtures for the new bores (lead-owned `scripts/brep-parity-fixtures.mjs`).

## Rules that apply to any follow-up work

- Do not edit lead-owned gates: `scripts/brep-*.mjs`, `check-record.mjs`, `occt-modeldoc-gate.mjs`, `brep-parity-fixtures.mjs`
  (except where the owner explicitly authorises named edits). New tests go in `packages/*/test`.
- Never return a wrong solid silently. K1a is closed (do not retry; never apply `stash@{0}`).
- Strictly clean-room for third-party kernels (policy in `docs/clean-room/README.md`); no fifth Rust dependency without evidence.
- Do not touch shCode's unrelated dirty files (other agents' lesson/component/curriculum edits).
- Toolchain: `export PATH="$HOME/.cargo/bin:$PATH"`; `bun test` not `npm test`; tsc order sketch -> script -> kernel -> studio;
  never run a root `bun run build`; rebuild wasm with `wasm-pack build --release --target web --out-dir pkg` first.
- After kernel or docs changes, follow section 5 of the plan (shCode re-vendor checklist) and restart shCode's dev server
  (`rm -rf .next`, then `bun server.js`).

---

# Prompt to hand to the plan agent

You are the planning agent for reshape-cad (`/home/shuff57/Documents/GitHub/reshape-cad`), a browser-first CAD app: reSHape
Script (2D sketches and 3D parts in JavaScript) over brep-rs, an independent Rust B-rep kernel compiled to WebAssembly. The host
app shCode vendors it under `vendor/reshape-cad`.

Read first: `AGENTS.md`, `docs/HANDOVER-plan-agent.md` (current state, known limits, rules), then
`docs/PLAN-scripting-layers.md` sections 8-11 (decisions Q1-Q10 and the progress log), `docs/specs/SPEC-transverse-bore.md`,
`docs/specs/SPEC-datum-family.md`, `docs/parity.md`.

Situation: the 3D and 2D scripting layers are feature-complete against the coverage matrix (22/22 feature kinds, 4/4 sketch
geometry kinds, 16/16 rule kinds). The previous plan is finished apart from the known limits listed in the handover file.

Task: produce the NEXT plan, ordered by value to students and risk. Do not implement anything. For each task give: goal,
files, a closed-form or independent-referee test that proves it, the gate numbers that must not drop (parity 70/2, mesh 70/2,
step 64/0/6, occt 17/0, cargo 337 + 1 known failure), who can do it (builder vs reader in the clean-room process), and what
needs the owner. Cover at least:

1. The remaining kernel refusals, ranked by how often a student would hit them (cone across/off-axis, bored-cylinder further
   cuts, blind hole in a multi-copy pattern, polar thickness for cones/prisms/wedges, round beyond a box, chamfer on a boolean
   result). Say which can be done without new curve types and which need the clean-room notes reviewed first.
2. STEP export of the new analytic curves (INTERSECTION_CURVE or a B-spline writer) versus leaving it refused.
3. Verification we lack: browser checks of the new solids and the datum picking, a parity fixture for the new bores (needs
   the owner to edit the lead-owned fixtures file), and a baseline for wasm size (now 774,941 bytes).
4. Student-facing quality: docs pages and `public/reshape/docs/reference.md` parity, refusal sentences that name the next step,
   shCode lesson/starter impact of each change.
5. Release readiness: push and deploy plan, licence holder name, the clean-room note review, JS dependency notices upkeep.

Challenge the plan before you finish: list what could silently produce a wrong solid and which test would catch it. Use the
existing format of `docs/PLAN-scripting-layers.md` (tasks with ids, order of execution, decisions needing the owner as a
table). Write the result to `docs/PLAN-next.md` and do not edit gate scripts.
