# engine/play — retired prototype UI, live wasm data pack

**The studio UI that used to live here is retired (2026-09-11).** It was the
original vanilla-JS FreeCAD modeler (`studio.html` + `studio.js` +
`play.js` + `pick3d.js` + `sketch.js`), used to prove the FreeCAD-wasm engine
end-to-end before `packages/studio` (mounted via `packages/sandbox-dev`)
reached feature parity with it. That parity work is
`docs/specs/SPEC-studio-canonical.md`; the decision to retire this prototype
is phase 5 there. `docs/specs/SPEC-engine-port.md` is the maintained detail
doc for the FreeCAD `EngineAdapter` those five files helped prove out.

**The retired UI files moved to `engine/play/_archive/`** (`git mv`, history
preserved, not deleted — see that folder's own README).

**What's still here, and still load-bearing:**

- `freecad-data.js` / `freecad-data.data` — the Emscripten data pack (Python
  stdlib + `Mod`/`Ext` trees, ~6 MB). **Do not move or delete these.**
  `packages/sandbox-dev/vite.config.ts`'s `engineStaticServer()` serves them
  from this exact directory as a fallback behind `engine/build/g5-artifacts/`
  (which holds the compiled `FreeCADCmd.js`/`.wasm` kernel itself) — every
  live FreeCAD-engine session in `sandbox-dev` depends on this path.
- `index.html` — the older, lower-level G5 playground (a raw-Python textarea
  + Run button), predating even `studio.html`. Left in place but its
  `<script src="/play.js">` now 404s since `play.js` moved into
  `_archive/`; nothing else references this page.
- `serve.mjs` — the standalone static server used to run the prototype
  locally outside `sandbox-dev`. No longer needed for day-to-day work
  (`sandbox-dev`'s own Vite dev server replaces it), left in place since it
  still correctly serves `/bridge/`, `/script/`, and the kernel paths if
  ever needed for low-level bridge probing.
- `_workspace/`, `.playwright-cli/` — unrelated local test-run artifacts,
  untouched by this retirement.

**Going forward, `packages/sandbox-dev` (packages/studio) is the canonical
sandbox** for both build and code sides of the FreeCAD/OCCT engines. See
`docs/specs/SPEC-studio-canonical.md` for the full story.
