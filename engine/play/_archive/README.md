# Retired: the vanilla-JS FreeCAD studio prototype

**Superseded 2026-09-11.** These five files were the original hand-rolled
browser UI for the FreeCAD wasm engine, built before `packages/studio` (via
`packages/sandbox-dev`) reached feature parity with them. See
`docs/specs/SPEC-studio-canonical.md` for the decision and the phase-by-phase
parity work, and `docs/specs/SPEC-engine-port.md` for the engine-adapter
detail that made the port possible.

Kept for reference, not deleted, per this repo's "archive, not delete"
convention (`git mv`, full history preserved). **Not maintained, not
guaranteed to still run** — `serve.mjs` and `../index.html` reference
`play.js` by its old path and will 404 on it now that it has moved here.

- `studio.html` / `studio.js` — the modeler UI (New Body, Sketch, Pad,
  Fillet/Chamfer, Save/Open `.FCStd`).
- `play.js` — the three.js viewport + wasm kernel bootstrap shared by
  `studio.html` and the older `../index.html` raw-Python probe.
- `pick3d.js` — face/edge raycasting for the viewport.
- `sketch.js` — the 2D sketch editor canvas and its own constraint UI.

If you need to run this again: copy these files back up to `engine/play/`,
or point a static server at this directory with `../freecad-data.js` /
`../freecad-data.data` and `engine/build/g5-artifacts/` reachable the way
`../serve.mjs` originally wired them (see that file's own routing comments).
The wasm data pack (`freecad-data.*`) was deliberately **not** moved here —
it is still live infrastructure, served today by
`packages/sandbox-dev/vite.config.ts`'s `engineStaticServer()`.
