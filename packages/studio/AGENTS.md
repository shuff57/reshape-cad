# packages/studio

## OVERVIEW
React UI library extracted from shCode's SandboxWorkspace: Build tools + kernel viewport + Code side, mounted by sandbox-dev (and lessons) as compiled `dist/` output.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Top-level shell / Build+Code contract | src/ReshapeStudio.tsx | `value`/`onChange` IS `script.js`'s text; on mount it re-runs `value` through the sandboxed runner once to rebuild `doc` |
| Build-side editor | src/model/ModelEditor.tsx | Ribbon, feature tree, rules panel; the feature list IS the timeline (horizontal strip, `TIMELINE_HEIGHT_PX`) |
| Viewport + kernel loading | src/model/BrepViewportThree.tsx | ~2700 lines; loads three.js AND the `EngineAdapter` via dynamic `import()`. There is one kernel and it is never swapped mid-session |
| 2D overlay / drag handles | src/model/HandleOverlay.tsx | `projectOutline()`; fillet points project through the basis corner's anchor |
| Constraint writers | src/model/SketchConstraints.tsx | `setPointRule`, `setSymmetric`, `setAngle`, `removeRule`; the four kinds the solver honours |
| Context bar | src/model/ContextBar.tsx | Presentational only; selection state, actions, and anchor live in the caller |
| Params panel | src/ReshapeParamsPanel.tsx | `text` (full precision) vs resting display (format-number) are deliberately two strings |
| Status ticker taxonomy | src/notes.ts | One type per note, one color per severity, all `--reshape-*` tokens |
| Export writers | src/mesh-export.ts, src/svg-pdf.ts | STL/OBJ/3MF (jszip) and SVG→PDF; plain bytes in/out, no DOM, no three.js |
| Camera fit math | src/camera-fit.ts | Pure numbers in/out so it is testable without a renderer |

## CONVENTIONS
- **Library, not an app**: no dev server, no own entry page. Verify changes with root `npm run build` then `npm run dev:sandbox`; tests (`node --test test/*.test.mjs`) import from `dist/`, so build first.
- **Host-injected chrome**: `CodeEditor` and `ReshapePreview` are required props supplied by the host (shCode LessonWorkspace/SandboxWorkspace). Never bundle copies of either here.
- **three.js is dynamic-import only**, inside BrepViewportThree's `loadThree()`, so pages that never mount the viewport don't pay for it. Type imports (`import type * as THREE_NS`) are fine anywhere.
- **Pure modules stay pure**: camera-fit, format-number, mesh-export, svg-pdf, and notes take plain numbers/bytes and no DOM, which is what makes them testable under `node --test`.
- **One kernel, loaded once**: `loadEngine()` caches a single module-level promise, so two viewports in a session share the wasm. `onEngine` fires exactly once per mount -- a caller can read it as "the engine is ready".
- **File headers carry the WHY**: measured dates, spec references (SPEC-ui-revamp*, SPEC-engine-port, SPEC-drawing-pdf-dimensions), and rejected alternatives. Read the header before editing a file.

## ANTI-PATTERNS
- **Do not reintroduce a fallback engine.** A refusal is per-feature DATA (`EngineBuildResult.refusals`), surfaced beside whatever did build -- not an exception, and not a reason to retry on another kernel. Catching around `engine.build()` to retry would resurrect the swap this deliberately removed.
- **Do not add a PDF or SVG library.** svg2pdf.js needs a real DOM (fails under JSDOM), pdfkit needs Node shims; svg-pdf.ts's parser covers exactly the six element types exportDrawing() emits. Generalize only against real new output, never speculatively.
- **Do not import three.js into mesh-export.ts** (or jszip anywhere else). MeshInput is an inline polygon-soup type kept dependency-free on purpose.
- **Do not move selection/action logic into ContextBar.** It imports nothing from ReshapeStudio; giving it state couples the one floating element to the whole shell.
- **Do not mount ReshapeStudio without both injected props**; there is no default editor or preview inside this package, and adding one duplicates host chrome.
- **Do not restate parent rules here** (state-indicator vs message-color split, per-feature refusals): they live in the root AGENTS.md and the specs it cites.