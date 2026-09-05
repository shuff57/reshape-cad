# reshape-cad

Browser-first CAD: reSHape Script (2D sketches + 3D parts, JavaScript) over a
headless FreeCAD kernel compiled to WebAssembly, with reSHape's own OCCT kernel
as the fallback. Writes `.FCStd` that opens in desktop FreeCAD 1.1.3.

Plan: `~/.claude/plans/freecad-browser.md` (phase 1: single user; phase 2: students).

## Layout
- `packages/kernel`  replicad OCCT wasm wrapper (from shCode `lib/occt-*.ts`)
- `packages/script`  reSHape Script + two emitters (replicad, FreeCAD Python)
- `packages/sketch`  sketch solver
- `packages/fcstd`   .FCStd read/write
- `packages/studio`  React UI (editor, viewer, timeline)
- `packages/engine`  loader + `freecad_run_python` bridge for the FreeCAD wasm
- `engine/`          FreeCAD wasm patch series + Docker toolchain (Track U)
- `parity/`          FreeCAD PartDesign parity list + checker
- `bench/`           yardstick tasks, record.json, measurement scripts
- `docs/`            device-log, upstream.json, spike report
