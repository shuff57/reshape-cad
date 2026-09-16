# Paste-in prompt: opencode as a brep-rs builder

Launch opencode in the repo, then paste the block below, replacing the TASK line.

```
opencode
```

Pick the model for the KIND of work (measured 2026-09-15):
- wiring an existing thing up (a new feature kind, an adapter, a UI fix) -> `ollama-cloud/glm-5.3-flash` or `ollama-cloud/deepseek-v4.1-flash`
- deriving new 3D geometry (fillets, rounds, trimmed surfaces) -> a Claude model. Both flash
  models burned their full 32,000-token output budget on those and made zero edits.

Switch model inside opencode with `/models`.

---

## The prompt

```
You are building in C:/Users/shuff57/Documents/GitHub/reshape-cad, a CAD app whose Rust/wasm
B-rep kernel (packages/brep-rs) is checked against OpenCascade by a gate.

TASK: <one sentence -- e.g. "make the 3 `round` fixtures pass", or "add a chamfer option to
hole", or read docs/specs/SPEC-<name>.md and carry it out>

HOW I WANT YOU TO WORK -- this matters more than the task:
- Work in small compiled steps: edit, build, run the gate, READ the result, then decide the
  next edit. Never more than about 150 lines in one edit.
- Never reason for more than a few paragraphs in one message. If you catch yourself deriving
  geometry in your head, stop and write it as Rust plus a cargo test instead, and let the
  test tell you if you are wrong.
- Make your first code edit within your first few tool calls. Reading the whole kernel first
  is how previous runs died without writing a line.
- One fixture at a time. Get the simplest case green before you touch the next one.
- If you are stuck or the spec is ambiguous, ASK ME. I am sitting here.

THE GATE IS THE JUDGE, and I own it -- you may not edit it:
  node scripts/brep-parity-gate.mjs              volume/bbox/faces vs OCCT, all fixtures
  node scripts/brep-parity-gate.mjs --kind X     just one kind
  node scripts/brep-mesh-gate.mjs                the tessellation: watertight, volume, size
  node scripts/brep-parity-gate.mjs --reference-only --kind X    what OCCT itself measures
Do not edit scripts/brep-*.mjs or scripts/brep-parity-fixtures.mjs. File claims will block
the write anyway; that is deliberate, not a puzzle to route around.

BUILD AND TEST:
  cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
  cd packages/brep-rs && cargo test --release && cd ../..
  npm run build            (type-checks the TypeScript packages)
Rebuild the wasm before running either gate, or you are measuring the old binary.

FIRST, measure the baseline and tell me the numbers before you change anything: both gates and
cargo test. Every kind that passes now must still pass when you are done.

RULES:
- Edit only packages/brep-rs/ unless the task says otherwise.
- Never return a wrong solid. If a case is outside what you built, refuse it with a plain
  sentence naming what is not supported, exactly as the existing refusals do.
- Real analytic geometry only -- no sampling a curve into hundreds of flat facets to make a
  number match. The gate fails any result with more than 2x OCCT's face count plus 4.
- No hard-coded fixture constants. Compute from the geometry.
- If any path I gave you does not exist, STOP and say so rather than guessing another one.

WHEN YOU FINISH, report in this order:
1. Status first. Anything that failed, was skipped, or you could not check goes in the first
   sentence -- before the good news.
2. Per-fixture gate results, with the worst relative delta and which field it was on.
3. Face counts, yours vs OCCT.
4. Both gate tallies, cargo test, and the gzipped wasm size.
5. Files changed.
6. One design decision the task did not pin down, and what you chose.
7. What you could NOT verify. You have no eyes: if you did not look at a render, say so.
```

---

## Why the prompt is shaped like this

Every rule above is a failure that actually happened on 2026-09-15:

| Rule | What went wrong without it |
|---|---|
| small steps, short reasoning | two runs spent all 32,000 output tokens on one message and made ZERO edits |
| first edit early | a run read for 20 minutes, then died mid-thought |
| one fixture at a time | the same spec that failed whole succeeded when sliced with the maths pinned |
| rebuild before gating | gate results measured a stale wasm and looked unchanged |
| refuse, never guess | an early boolean faked cylinders as 8192-sided polygons and passed on volume |
| status first | reports led with the wins and buried "4 of 58 still fail" |
| say what you could not check | a builder implied a mesh looked right; it had no eyes at all |
