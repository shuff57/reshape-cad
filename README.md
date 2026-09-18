# reshape-cad

Browser-first CAD: reSHape Script (2D sketches + 3D parts, JavaScript) over
brep-rs, an independent B-rep kernel written in Rust and compiled to
WebAssembly. One kernel, no fallback: a shape brep-rs cannot build yet is
refused per feature, in a sentence, alongside everything that did build.

## Layout
- `packages/brep-rs`     the kernel: Rust B-rep, wasm-bindgen; `pkg/` is build output
- `packages/kernel`      the `EngineAdapter` seam and the brep-rs implementation of it
- `packages/script`      reSHape Script: interpreter, ModelDoc, round-trip emitter
- `packages/sketch`      2D sketch solver (constraints, arcs, outlines)
- `packages/studio`      React UI (editor, viewport, timeline) -- a library, not an app
- `packages/sandbox-dev` Vite harness that mounts studio; the only runnable app
- `scripts/`             lead-owned gates, run on demand (see below)
- `bench/`               yardstick tasks, record.json, measurement scripts
- `docs/`                specs, device log, kernel campaign ledger

## Build and run

```
npm run build          # dependency order: sketch -> script -> kernel -> studio
npm run dev:sandbox    # http://localhost:5173
npm test               # check-record, then the workspace suites
```

The kernel wasm is not in git. Build it before anything that loads it:

```
cd packages/brep-rs && wasm-pack build --release --target web --out-dir pkg
```

## Gates

The four gates under `scripts/` are lead-owned and run on demand, never from
`npm test`. Three of them measure brep-rs against OpenCascade, which is a
**referee, not a dependency**: every fixture is built twice and compared, so a
kernel whose signature failure is the wrong answer rather than the missing one
has an independent oracle. `replicad-opencascadejs` is a devDependency for
that reason and only that reason -- nothing OCCT ships or loads in the app.

```
node scripts/brep-parity-gate.mjs   # volume/bbox/face count vs OCCT
node scripts/brep-mesh-gate.mjs     # tessellation: watertight, bounded
node scripts/brep-step-gate.mjs     # STEP export, read back by OCCT
npm run gate:occt                   # ModelDoc semantics, script text -> solid
```
