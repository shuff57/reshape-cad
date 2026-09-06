# reSHape Studio (browser modeler) — run it locally

A parametric CAD modeler running entirely in the browser: FreeCAD's headless
kernel compiled to WebAssembly, driven by the command bridge
(`engine/bridge/fc-session.mjs` + `fc-commands.mjs`), rendered with three.js.

## Run

```sh
node engine/play/serve.mjs 8791
```

Then open **http://localhost:8791/studio.html** in Chrome or Edge.

The server sets the COOP/COEP headers the kernel needs (`crossOriginIsolated`),
and serves three paths:

| Path              | Serves                                            |
|-------------------|---------------------------------------------------|
| `/`               | this folder (`studio.html`, `studio.js`, the data pack) |
| `/kernel-browser/`| the browser wasm kernel — `engine/build/g5-artifacts/` |
| `/bridge/`        | the command bridge modules — `engine/bridge/`     |

First load fetches a ~53 MB wasm kernel (~16 MB gzipped) plus a ~6 MB data
pack, so give it 30–90 s the first time; the status pane at the bottom logs
progress and every command result.

## What the buttons do

1. **New Body** — start a PartDesign Body.
2. **Rect Sketch** (W × H) or **Circle Sketch** (r) — draw a profile on the body.
3. **Pad** (Length) — extrude the profile into a solid.
4. **Set Length** — change the current Pad's length; the solid updates live (parametric edit).
5. **Save .FCStd** — download a real FreeCAD file (opens in desktop FreeCAD 1.1.3).
6. **Open .FCStd** — load a `.FCStd` back in.

Pocket / Fillet appear disabled — they need interactive face/edge selection,
which isn't wired yet.

## The two pages

- `studio.html` — the modeler (this doc).
- `index.html` — the older G5 playground: a raw-Python textarea + Run, used to
  bring the engine up first. Kept as a low-level probe.

## Rebuilding the kernel / data pack

The wasm kernel is built by `engine/docker/Dockerfile.kernel` (target
`kernel-artifacts-browser`); the preload data pack (FREECAD_HOME subset incl.
`Mod/PartDesign` + a pruned Python stdlib) is staged and packed with
emscripten's `file_packager.py` inside the kernel-build container. Both are
checked in under `engine/build/g5-artifacts/` and here (`freecad-data.*`) so the
studio runs from a clone without the toolchain.
