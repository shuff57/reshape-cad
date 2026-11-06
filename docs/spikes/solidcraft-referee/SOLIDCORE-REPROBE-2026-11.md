# SolidCore re-probe, 2026-11-06

Phase 3 of the next-work loop (`.cache/PLAN-next-0.21.0.md`), read-only. Judged against the
swap conditions in `docs/PLAN-scripting-layer.md` phase 5. Nothing was installed, built or filed.

- Probed: 2026-11-06.
- Site revision: "Generated from 1483513f (2026-11-06T08:08:41-05:00)", upstream reference
  usd-brep v1.0.1 (3fd5b95). <https://tangency-labs.github.io/solidcore/>
- Repo `main` at probe time: 2d469d13 (2026-11-06T15:29Z), newer than the site build.
- Earlier readings: 2026-10-18 113/261 green; 2026-10-25 (216cd66d) 250/262 green, 94.0% of lines green.
- Today: 257 green, 24 partial, 1 blocked of 282 units; 99.3% of lines ported, 91.3% green.
  Green lines fell from 99.3% (2026-11-04 03:01 UTC) to 91.1% (2026-11-06 04:28 UTC) on the
  site's timeline. Since 2026-10-27 the pin is usd-brep v1.0.1 (was v1.0.0, where it reached
  261/261 green).

## Verdict

| # | Condition | Verdict | Evidence |
|---|-----------|---------|----------|
| C1 | primitive, boolean, offset, blend units all green | **not met** | Module pages: primitive "Green 7, Partial 1" (`primitive.api_trim_ops` partial); boolean "Green 8, Partial 1" (`boolean.api_brep` partial); offset "Green 0, Partial 3", "Lines green 0.0%"; blend "Units ported 24 / 25, Green 20, Partial 4", `blend.feature_executive` blocked. <https://tangency-labs.github.io/solidcore/areas/{primitive,boolean,offset,blend}.html>, <https://tangency-labs.github.io/solidcore/units/index.html> |
| C2 | a release newer than 0.0.x | **met, with a caveat** | Annotated tag `solidcore-v1.0.1`, 2026-10-30: "solidcore 1.0.1: parity with SMLib 1.0.1 (usd-brep v1.0.1)"; crates.io `solidcore` max_version 1.0.1 (2 versions). Caveat: the version tracks the upstream SMLib release, and the README still says "The API is experimental (0.0.x)". <https://github.com/tangency-labs/solidcore>, <https://crates.io/api/v1/crates/solidcore> |
| C3 | browser-loadable wasm API (JS-callable, or a thin wrapper we write) | **unknown** | README: "builds for `wasm32-unknown-unknown`" and `cargo check -p solidcore --target wasm32-unknown-unknown`; wasm needs a larger stack (no guard page). No wasm-bindgen in the repo (code search), no npm package (`registry.npmjs.org/solidcore` 404). Whether a thin wrapper reaches the operations we need (booleans, fillets, shell, tessellation live partly in `solidcore-ops`, `solidcore-tess`) cannot be judged without a spike. |
| C4 | whole-solid checks beyond the 9 primitives (a boolean, a fillet, a shell) against an independent oracle | **not met** | Solids page: still "9 / 9 primitives pass". Cases page publishes fillets only: "225 pass, 19 are refused as they expect, 21 are known failing (265 in all)". The kernel-case corpus also holds booleans (124 cases) and shell (36), graded against SolidCraft's `expected.json` closed-form values (`known_failing.json`: 26 fillets, 1 shell), but the site publishes no boolean or shell results, and none is checked against our oracle (OCCT / brep-rs). <https://tangency-labs.github.io/solidcore/solids.html>, <https://tangency-labs.github.io/solidcore/cases.html>, `crates/solidcore/tests/kernel_cases/{README.md,manifest.json,known_failing.json}` |

Also noted, not a condition: the site's SSI corpus still shows upstream itself returning wrong
topology ("WRONG TOPOLOGY 11" for C++, 10 for Rust, of 119 cases), so "green" remains parity with
SMLib, not correctness.

**Spike warranted: no.** C1 and C4 are not met and C3 is unknown; a spike needs all four plus the owner's approval.
