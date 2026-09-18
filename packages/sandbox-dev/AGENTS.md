# packages/sandbox-dev

## OVERVIEW
Vite dev harness, the only runnable app in the repo: mounts `ReshapeStudio` (Build + Code sides) against real kernel artifacts for local click-through of 2D/3D CAD tools.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App entry | src/App.tsx | Mounts ReshapeStudio; no engine selection, there is one kernel |
| Script runner iframe | src/ReshapePreview.tsx | Sandboxed iframe + postMessage handshake; read its header comment before touching |
| Runner page | script-runner.html + src/script-runner-entry.ts | Runs `runScript()` inside the iframe; posts `reshape-doc` / `reshape-rebuilt` / `preview-error` |
| Static kernel serving | vite.config.ts | One middleware for `/reshape/kernel/brep-rs/`; COOP/COEP headers |
| Editor state shim | src/script-context.tsx | Plain Context standing in for a host app's file store |
| Code editor | src/CodeEditor.tsx | CodeMirror wrapper passed to ReshapeStudio as its `CodeEditor` prop |

## CONVENTIONS
- Consumes siblings as compiled output: `@shuff57/reshape-studio`, `-kernel`, `-script` are `file:` deps resolved from their `dist/`. Run root `npm run build` first or the dev server imports stale or missing code.
- No build, tests, or lint of its own. tsconfig is `noEmit`; Vite compiles on serve. Verify with `npm run dev:sandbox` (port 5173) plus `tsc --noEmit` when types changed.
- The kernel wasm IS in this repo, as gitignored build output: `/reshape/kernel/brep-rs/` serves `packages/brep-rs/pkg`. No sibling checkout, no env override. Build it with `wasm-pack build --release --target web --out-dir pkg` or the dev server warns at startup and the viewport never loads.
- Env-provided dirs go through `path.resolve()`, never `path.join()` on the raw env string. On win32 a forward-slash override makes `filePath.startsWith(dir)` silently fail, so every request falls through to the SPA fallback with a 200 instead of a 404.
- `.wasm` responses must carry `Content-Type: application/wasm`; streaming `WebAssembly.instantiate` rejects any other MIME type.
- Keep the COOP/COEP headers in vite.config.ts (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`); the kernel needs the cross-origin-isolated context they create.

## ANTI-PATTERNS
- Never import `reshape-script` into the main app origin. Script text runs only inside the `script-runner.html` iframe.
- `sandbox="allow-scripts allow-same-origin"` in ReshapePreview.tsx is a measured, dev-only deviation (an opaque-origin iframe breaks Vite's own HMR preamble, so the runner never executes). Do not copy it into anything with a real backend or real users; that path stays `allow-scripts` only.
- Do not re-add a generic `/reshape/kernel/` branch beneath the brep-rs one. The sub-path would be shadowed by it, which is the bug the two-branch version existed to dodge; with one kernel there is nothing else to serve.
- Do not add an engine switch back. There is one kernel and `setEngineMode()` no longer exists; the old `VITE_RESHAPE_ENGINE` read here is what a second engine would reappear through.
- Never post `reshape-doc` for an empty doc (comment-only script); it would wipe Build-side state on mount hydration.
- Do not add a backend, session, or cookies here. This package is a stateless local harness; its relaxed iframe sandbox is only safe because no real user data exists to protect.