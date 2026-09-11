# reSHape sandbox (dev)

A local Vite dev server for `ReshapeStudio` (Build side only) wired to a real
kernel, for clicking through 2D/3D CAD tools without shCode.

## Before you run it

`packages/studio` (and its deps: `kernel`, `script`, `sketch`) must already be
built, since this package imports `@shuff57/reshape-studio/ReshapeStudio` from
its compiled `dist/`, not its TS source:

```
npm run build
```

## Kernel assets

The wasm kernel (`replicad_single.wasm`/`.js`, `runner-brep.html`, etc.) isn't
in this repo -- it's a pre-built artifact from shCode. `vite.config.ts`
defaults to `../../../shCode/public/reshape/kernel` (a sibling checkout under
the same `GitHub/` directory). If your shCode checkout lives elsewhere, point
`RESHAPE_KERNEL_DIR` at its `public/reshape/kernel` before starting:

```
RESHAPE_KERNEL_DIR=/path/to/shCode/public/reshape/kernel npm run dev
```

## Run it

```
npm run dev
```

or from the repo root: `npm run dev:sandbox`. Boots on Vite's default port
(`http://localhost:5173`).

## Switching engines

Defaults to the replicad/OCCT kernel above. Set `VITE_RESHAPE_ENGINE=freecad`
to boot with the FreeCAD kernel instead (`engine/build/g5-artifacts` +
`engine/play/freecad-data.*`, served at `/reshape/engine/` -- see
`vite.config.ts`'s own `engineStaticServer()`). Only a narrow subset of
`ModelDoc` builds on that engine today; see
`packages/kernel/src/freecad-engine-adapter.ts`'s own header, or
`docs/specs/SPEC-engine-port.md`'s "Known gaps" section, for exactly what:

```
VITE_RESHAPE_ENGINE=freecad npm run dev
```
