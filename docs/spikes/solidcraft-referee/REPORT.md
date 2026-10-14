# solidcraft referee spike: summary of phases 0-3

Status: spike, **referee/demo only**. Not an EngineAdapter, not in `npm test`, no engine mode, nothing under
`packages/brep-adapter`. The AGENTS.md one-kernel rule is untouched; whether solidcraft is ever more than a referee
is an **undecided policy question** for the owner.

Subject: https://github.com/bherbruck/solidcraft @ `fe3717f2e400010a4cd0e7dd4f294e7091c25625` (MIT OR Apache-2.0),
a truck-based Rust CAD kernel with an egui web app. Each phase was built, then attacked by a separate harsh critic
with fresh context; the corrected claims below are what survived.

| Phase | Dir | What | Result |
|---|---|---|---|
| wasm proof of concept | `wrapper/`, `run.mjs`, `demo/`, `egui-demo/` | solidcraft-engine to wasm, run under Node and in an egui page | builds; 23 MB raw / 4.3 MB gzip (no wasm-opt); 11 fixtures agree with OCCT within tessellation error |
| 0 | `phase0/` | ModelDoc to solidcraft commands, scored vs live OCCT and brep-rs on 78 parity fixtures + 14 asymmetric pick fixtures | 74 PASS, 1 FAIL (`box-round-chamfer`, truck 1.46e-3 off, brep-rs exact), 1 REFEREE-ARTIFACT (OCCT bbox padding), 2 REFUSED (closed shell) |
| 1 | `phase1/` | `window.solidcraft.execute/inspect` bridge patch (`bridge.patch`), sandboxed host page | script runs in solidcraft's viewport, within 3.4e-6 of OCCT/brep-rs on the demo script; token is an opt-in, not authentication |
| 2 | `phase2/` | constraints and dimensions mapped to solidcraft's solver | 86 cases; rough start 19/43 PASS; tangency residual ~1e-4 mm while reporting solved; DoF/redundancy misreported for exactly-tangent starts |
| 3 | `phase3/` | one-command reviewable page, 20 examples | `sh docs/spikes/solidcraft-referee/phase3/run.sh` |

## What is established
- Truck matches live OCCT on volume, bbox and centre of mass for the covered feature classes (primitives, extrudes,
  revolves, booleans, bores, fillet, shell, draft) at 1e-9 planar / 3e-4 curved; wrong-feature picks, adjacent and
  opposite, are rejected at 26x the bar or more on an asymmetric body.
- Its volume is tessellation-derived (`crates/kernel/src/measure.rs`), so curved deltas of ~1e-4 are the measurer's.
  It cannot see a wrong-rim fillet of about 0.1 mm or smaller.

## What is not
- Face fidelity is verified by count per surface type only.
- Named picks (`between`) come from brep-rs `resolve` in Node, and are refused in the browser.
- Solidcraft solver diagnostics are not a reliable referee for DoF on tangent-heavy sketches.

## Known solidcraft defects (repros recorded in phase0/phase2 PROGRESS.md)
1. `solid.chamfer` on all 12 edges of a box builds the union of wedge prisms (29184, 18 faces) without the corner
   triangles OCCT and brep-rs produce (26 faces); 1.46e-3 volume delta.
2. Endpoint tangency is ~1e-4 mm off while the report says `solved`, `failing: []` (mapper-independent repro).
3. An exactly-tangent start reports dof 7 and a redundant tangent; the hand count is 6, and a 0.05 mm jitter gives 6.

## Open
Policy (referee vs product), browser-side named picks, WebGPU/Firefox/Safari, wasm trap behaviour, bridge
authentication (not for deployment). Per-phase limits are in each `PROGRESS.md`/`README.md`.

---

# Spike: solidcraft (truck) compiled to wasm as a third referee

Status: minimal proof of concept. **Referee only.** Not an EngineAdapter, not in `npm test`, not a gate.
AGENTS.md's one-kernel rule is untouched: nothing here selects or falls back to another engine.

- solidcraft: https://github.com/bherbruck/solidcraft @ `fe3717f2e400010a4cd0e7dd4f294e7091c25625` (MIT OR Apache-2.0)
- toolchain: rustc 1.99.0, wasm32-unknown-unknown, wasm-bindgen CLI 0.2.128 vs crate `=0.2.129` (mismatch; ran anyway, unsupported)
- wasm: 23.4 MB raw, 4.3 MB gzipped (`gzip -9`); **no wasm-opt run** (not installed)

## Claim (as accepted by the critic pass)
solidcraft's headless engine, built against its vendored truck patches, compiles to wasm and runs under Node
through a wasm-bindgen wrapper. On 4 primitives and 7 feature fixtures its results match live OCCT, with
volume deltas at or below 1.5e-4 on curved solids, and `1e-16` on planar ones.

## Results (relative deltas vs live OCCT, unrounded; brep-rs for comparison)
| fixture | brep-rs dVol | truck dVol | truck dBbox | faces O/B/T | truck ms |
|---|---|---|---|---|---|
| box | 1.5e-16 | 1.5e-16 | 0 | 6/6/6 | 10 |
| cylinder | 4.0e-16 | 1.1e-4 | 2.7e-5 | 3/3/3 | 241 |
| sphere | 1.3e-16 | 7.1e-5 | 1.2e-16 | 1/1/1 | 2553 |
| torus | 1.9e-15 | 1.5e-4 | 9.0e-5 | 1/1/1 | 6168 |
| boolean-cut | 1.3e-16 | 2.4e-5 | 1.2e-15 | 7/7/7 | 158 |
| boolean-union | 2.0e-16 | 1.9e-5 | 2.3e-15 | 10/10/10 | 353 |
| boolean-intersect | 5.1e-16 | 9.6e-5 | 2.7e-5 | 3/3/3 | 215 |
| boolean-cut-x-axis-cylinder | 1.3e-16 | 1.8e-5 | 5.3e-16 | 7/7/7 | 211 |
| round-one-edge (fillet) | 1.2e-12 | 2.8e-6 | 5.3e-16 | 7/7/7 | 46 |
| shell-open-top | 2.1e-16 | 2.1e-16 | 0 | 11/11/11 | 7 |
| shell-closed | 1.6e-16 | **refused** | - | 12/12/- | - |

`shell-closed`: OCCT and brep-rs build a hollow solid with an enclosed void (11264 mm3). solidcraft's
`solid.shell` requires a face pick, and returned a structured per-command error, not a wrong solid:
`invalid parameters for solid.shell: faces must be a list of points`.

## What this does and does not say
- truck's volume/bbox are **tessellation-derived** (`crates/kernel/src/measure.rs`), so curved deltas of
  ~1e-4 are the measurer's, not the B-rep's. Honest tolerance: curved volume >= 5e-4; planar bodies ~1e-12.
  It would catch a wrong solid or an added void, not a sliver.
- Face counts here are solidcraft's merged count; the primitive and most feature cases are small, so
  agreement is weak evidence about parity on real parts.
- 11 fixtures, all single-body, all hand-translated. Edge and face picks are 3D points.
- **Not tested:** a forced panic/trap under wasm `panic=abort` (a trap would kill the instance, not refuse
  one feature); `std::time::Instant` in `config_certificates.rs` on wasm32; chamfer; multi-body results;
  throughput at gate scale (sphere 2.5 s and torus 6 s for one primitive).
- The `[patch.crates-io]` block in `wrapper/Cargo.toml` is hand-copied from solidcraft's root manifest
  (cargo ignores patches from a non-root manifest). If solidcraft's vendor patches change, it drifts silently.

## Reproduce
```bash
# 1. build the wrapper (paths in wrapper/Cargo.toml are absolute to ~/solidcraft)
cd docs/spikes/solidcraft-referee/wrapper
CARGO_TARGET_DIR=/tmp/sc-referee cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target nodejs --out-dir /tmp/sc-referee-pkg /tmp/sc-referee/wasm32-unknown-unknown/release/solidcraft_referee.wasm
# 2. needs `npm run build` at repo root and packages/brep-rs/pkg (wasm-pack build --release --target web --out-dir pkg)
SOLIDCRAFT_REFEREE_PKG=/tmp/sc-referee-pkg node docs/spikes/solidcraft-referee/run.mjs
```

## Browser demos (both load the same engine, no network)
- `egui-demo/`: eframe/egui 0.36 (glow/WebGL2) app with `solidcraft-engine` **linked straight in**, no JS bridge: the
  same stack as solidcraft-web. 13 MB wasm after trunk's wasm-opt. Build: copy `~/solidcraft/Cargo.lock` here (pins
  eframe 0.36.2 etc.), then `trunk build --release` and serve `dist/` (or `trunk serve --release`, port 8782).
  Verified in headless Chromium: wasm ready, box minus cylinder gives 27979.429346 mm3, 7 faces, in ~175 ms.
- `demo/`: plain HTML + wasm-bindgen `--target web` build of `wrapper/` (output into the gitignored `demo/pkg`),
  serve the folder over HTTP (`python3 -m http.server`).
