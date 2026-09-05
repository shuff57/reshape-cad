# A1 - Live demo measurement: magik.net/freecad

Date: 2026-09-05. Device: windows-11-lead. Browser: real Chrome channel via
playwright-cli, version 151.0.0.0, headed. Headless was never needed --
JSPI worked headed on the first attempt.

Full data: [a1-live-demo.json](./a1-live-demo.json). Screenshots in
[screenshots/](./screenshots/).

## Load timing

| Run | Cold load | Cached load |
|---|---|---|
| 1 | 18.71 s | 14.47 s |
| 2 | 18.14 s | 15.69 s |

Cached load used a second tab in the same warm browser profile (not a forced
reload, though a forced reload gave almost the same number: 15.02 s).

## The caching claim doesn't hold up

The landing page says "your browser caches it afterward." That's only true
for about 8.7 MB of the ~96 MB payload:

- ~13 small/medium `.data` chunks (mods, pyside, numpy, pivy, etc.) **do**
  come from disk cache on repeat visits (`transferSize: 0`).
- The two largest files -- `freecad.data` (9.26 MB) and `FreeCAD.wasm`
  (86.2 MB), ~91 MB combined -- are **re-downloaded in full every single
  visit**, cold or warm. Neither carries a `cache-control` header.

So "cached" transfer is ~91 MB versus ~103.7 MB cold -- a real but modest
saving, not the near-zero repeat load the framing implies. That's also why
cached load time (14.5-15.7s) is close to cold load time (18.1-18.7s) rather
than near-instant.

| | Cold run 1 | Cold run 2 | Cached run 1 | Cached run 2 |
|---|---|---|---|---|
| Transfer | 103.72 MB | 103.75 MB | 91.02 MB | 91.00 MB |

## Peak renderer RAM

| Run | Peak renderer working set |
|---|---|
| Cold 1 | 835.71 MB |
| Cold 2 | 696.34 MB |

Measured via `Get-Process -Id <renderer_pid> WorkingSet64` polled every
500 ms. The renderer pid was found by walking the Chrome process tree
(`Get-CimInstance Win32_Process`, filtered to `--type=renderer` descendants
of the browser's main pid) since Chrome refuses `SystemInfo.getProcessInfo`
over a page-level CDP session ("only supported on the browser target").
Each tab spins up 2-3 idle spare renderers alongside the real one; the real
one was unambiguous both times (700-800+ MB vs under 90 MB for the spares).

## Cross-origin isolation

`self.crossOriginIsolated` was `false` on every run, and `app.html` sends no
`Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` header at
all. **The task brief's assumption that COOP/COEP are required does not
hold for this build** -- it works fine without cross-origin isolation,
which implies no `SharedArrayBuffer`/pthreads are in use (single-threaded
WASM + JSPI only). The one requirement that actually mattered was the
browser-version gate (Chrome/Edge 137+); this box runs Chrome 151.

## Ready signal

The console message `FCLOG STARTUP_DONE`, printed by the app itself.
Cross-validated visually: at that moment the full Qt main window (menu bar,
toolbars, a "Welcome to FreeCAD" onboarding panel) is painted, and the
toolbar buttons flip from disabled to enabled.

One gotcha for anyone else automating this: the actual WebGL canvas
(`id="qt-window-canvas"`) lives inside a **shadow root**, not the plain
DOM. `document.querySelector('canvas')` returns `null` even after the app
is fully loaded and rendering. Pierce the shadow tree, or just use the
console signal.

Also worth flagging: the write-up says a demo document (box with a
cylindrical cut) opens automatically in a live 3D viewport on boot. In
practice, on both cold runs, boot landed on the "Welcome to FreeCAD"
onboarding panel instead, with an empty Model tree -- no document was open
at `STARTUP_DONE`.

## Interaction: new document + Part Box

Screenshot-verified, headed, in well under the 20-minute budget:

1. **File > New Document** via menu-bar coordinates -- opens an empty
   "Unnamed" document with a live WebGL viewport.
2. **Switch workbench, Part Design -> Part.** This is the one real gotcha:
   the workbench combobox opens its popup **on mousedown**, and behaves
   like a native press-drag-release control, not a normal click-to-open
   menu. A plain click (mousedown+mouseup with no movement) just closes the
   popup without changing the selection -- cost a couple of wasted attempts
   before landing on the right pattern: mousedown on the combobox, drag to
   the "Part" item while still held, mouseup there.
3. **Click the Box toolbar icon** -- a grey Cube solid renders immediately
   in the viewport, and "Cube" appears under "Unnamed" in the Model tree.

The whole FreeCAD GUI (menus, toolbars, comboboxes, viewport) is one WebGL
canvas with no accessible DOM structure underneath, so `playwright-cli`'s
ref/selector-based `click`/`find` commands can't target anything inside it
-- every interaction had to be a raw `page.mouse` move/down/up at pixel
coordinates read off a screenshot.

**Pad on a sketch: assessed, not attempted**, per the task's explicit time
cap. It's very likely attemptable with the same raw-coordinate technique
(enter sketch mode, draw a closed profile, run Part Design Pad, confirm the
length dialog), but every sketch point and every dialog field is another
blind coordinate guess with zero accessibility tree to query -- a real
attempt would need an iterative screenshot-click-verify loop per point,
not the one-or-two-shot clicks that worked for the Box primitive. Feasible,
but meaningfully slower and flakier than primitive creation.

## Could not measure

- Headless JSPI behavior -- not tested, headed worked first try.
- True first-ever cold load with no server/CDN-side warmup -- only
  client-side (browser profile) cache state was controlled.
