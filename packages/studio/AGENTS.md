# packages/studio

## OVERVIEW
React UI library extracted from shCode's SandboxWorkspace: Build tools + kernel viewport + Code side, mounted by sandbox-dev (and lessons) as compiled `dist/` output.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Top-level shell / Build+Code contract | src/ReshapeStudio.tsx | `value`/`onChange` IS `script.js`'s text; on mount it re-runs `value` through the sandboxed runner once to rebuild `doc` |
| Build-side editor | src/model/ModelEditor.tsx | Ribbon, feature tree, rules panel; the feature list IS the timeline (horizontal strip, `TIMELINE_HEIGHT_PX`) |
| Viewport + engine loading | src/model/BrepViewportThree.tsx | ~3000 lines; loads three.js AND the `EngineAdapter` via dynamic `import()`; owns fallback swap + persistent "using OCCT" badge |
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
- **Engine mode is read live**: `getEngineMode()` is evaluated at the moment `loadEngine()` runs, not at module load, so a fallback swap mid-mount re-gates correctly.
- **File headers carry the WHY**: measured dates, spec references (SPEC-ui-revamp*, SPEC-engine-port, SPEC-drawing-pdf-dimensions), and rejected alternatives. Read the header before editing a file.

## ANTI-PATTERNS
- **Do not make the fallback swap reversible.** Once BrepViewportThree swaps to the fallback engine it stays there for the mount; re-probing FreeCAD on the next build recreates the refusal loop the badge exists to explain.
- **Do not add a PDF or SVG library.** svg2pdf.js needs a real DOM (fails under JSDOM), pdfkit needs Node shims; svg-pdf.ts's parser covers exactly the six element types exportDrawing() emits. Generalize only against real new output, never speculatively.
- **Do not import three.js into mesh-export.ts** (or jszip anywhere else). MeshInput is an inline polygon-soup type kept dependency-free on purpose.
- **Do not move selection/action logic into ContextBar.** It imports nothing from ReshapeStudio; giving it state couples the one floating element to the whole shell.
- **Do not mount ReshapeStudio without both injected props**; there is no default editor or preview inside this package, and adding one duplicates host chrome.
- **Do not restate parent rules here** (engine badge, state-indicator split, per-feature refusals): they live in the root AGENTS.md and the specs it cites.