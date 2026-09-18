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

The kernel is `packages/brep-rs`, in this repo, but its wasm is gitignored
build output. Build it once (and again after any Rust change):

```
cd ../brep-rs && wasm-pack build --release --target web --out-dir pkg
```

`vite.config.ts` serves that `pkg/` at `/reshape/kernel/brep-rs/`, which is
the URL `BrepRsEngineAdapter` builds from `getKernelBaseUrl()`. No sibling
checkout and no env var are involved; if the wasm is missing the dev server
says so at startup.

## Run it

```
npm run dev
```

or from the repo root: `npm run dev:sandbox`. Boots on Vite's default port
(`http://localhost:5173`).

There is one kernel, so there is nothing to switch: `VITE_RESHAPE_ENGINE` is
gone, along with the engine-mode API it used to call.
