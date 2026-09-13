# `exportDrawing()` phase-2 — PDF output and automatic dimensioning

Closes the two gaps between what `SPEC-techdraw-export.md` shipped (SVG only, no
dimensions) and what `~/.claude/plans/freecad-browser.md`'s own "Must Have" list asks for
("SVG and PDF, with dimensions"). Measured 2026-09-12 against the `fc-kernel-techdraw-full`
Docker image and, for the PDF half, against the **real bytes the shipped
`FreeCadEngineAdapter.exportDrawing()` produces today** — not a mock sheet.

Both recommendations were implemented and tested during this investigation. Every number in
the verification tables was read off a run, not estimated.

---

## Part 1 — PDF

### The central question, answered

> Does PDF need to be produced inside the FreeCAD kernel, or can it happen entirely in
> JS/the browser after `exportDrawing()` returns its SVG bytes?

**Entirely in JS, and there is no second option.** The kernel half is not "harder" — it is
absent. Four independent probes agree:

| Probe (inside `fc-kernel-techdraw-full`) | Result |
|---|---|
| `QPdfWriter` occurrences in `FreeCADCmd.wasm` | **0** |
| `QPrinter`, `QPagedPaintDevice`, `QPdfEngine` | **0** each |
| `QSvgRenderer`, `QSvgGenerator` | **0** each |
| `QPainter` | 52 (TechDraw's own `QPen`/`QColor` use, via Widgets) |
| `import PySide` / `PySide2` / `PySide6` / `PyQt5` / `PyQt6` / `shiboken2` / `shiboken6` | `ModuleNotFoundError`, all seven |
| `import reportlab` / `fpdf` / `cairo` / `cairosvg` / `weasyprint` / `PIL` | `ModuleNotFoundError`, all six |
| `import FreeCADGui`, `import TechDrawGui` | `ModuleNotFoundError` |
| `dir(TechDraw)` — all 22 exports | only `writeDXFPage` is page/print-shaped; **no PDF writer** |
| 446 importable top-level Python modules | zero PDF-capable. `PythonQt` exists as a file but `import PythonQt` dies with `ModuleNotFoundError: No module named 'PySide'` |

The toolchain question the task raised — did `PrintSupport` arrive transitively when
`Dockerfile.kernel`'s sed patch requested only `Widgets`? — answers **no, but it is
available**:

```
/opt/toolchains/qt-wasm/lib/libQt6PrintSupport.a   PRESENT  (never linked -- 0 symbols in the wasm)
/opt/toolchains/qt-wasm/lib/libQt6Svg*.a           ABSENT   (QtSvg was never built for wasm at all)
```

So `PrintSupport` could be linked with a CMake change and no Qt rebuild. **It would still be
useless**, and this is the finding that actually closes the kernel direction: `QPrinter` is a
C++ class with no Python binding in this build, and there is no Python binding layer at all
(no PySide, no shiboken). `freecad_run_python()` is the *only* way the app talks to this
kernel. A linked-but-unreachable class is not a capability. Reaching it would mean writing new
C++ and rebuilding a 63 MB wasm kernel — to emit a file format that is ~200 lines of
plain-text generation in JS.

```
               kernel PDF                              JS PDF
  ┌────────────────────────────────┐     ┌──────────────────────────────┐
  │ link libQt6PrintSupport.a      │     │ exportDrawing() -> SVG bytes │
  │   (CMake change, ~40min build) │     │            │                 │
  │ write C++ QPrinter glue        │     │            ▼                 │
  │ expose it to Python (no        │     │  svgToPdf(bytes) -> PDF      │
  │   PySide exists -> new binding)│     │   420 lines, 0 deps, 0.5ms   │
  │ rebuild browser artifacts too  │     └──────────────────────────────┘
  └────────────────────────────────┘
            BLOCKED                                 SHIPPED + TESTED
```

There is also no server to fall back on: `packages/sandbox-dev` is a Vite dev app and
`engine/play/serve.mjs` is a static file server. Nothing in `packages/` has a backend. Whatever
converts must run in the browser tab.

### Which JS library — none of them

| Package | Version | Unpacked | Verdict |
|---|---|---|---|
| `svg2pdf.js` | 2.8.1 | 2.44 MB | **rejected** — see below |
| `jspdf` (svg2pdf's required peer) | 4.2.1 | 30.19 MB | rejected with it |
| `pdfkit` + `svg-to-pdfkit` | 0.20.2 / 0.1.8 | 10.53 + 4.20 MB | rejected — Node-first; needs `fontkit`, `linebreak`, `png-js` browser shims |
| `canvg` | 4.0.3 | 1.29 MB | rejected — rasterises to canvas; a raster "drawing" is not a drawing |
| `pdf-lib` | 1.17.1 | 19.46 MB | **viable fallback** — no DOM, but no SVG *document* support either (only `drawSvgPath()` for a bare `d` string), so the SVG parser still has to be written |
| **first-party `svgToPdf()`** | — | **0 deps, 420 lines** | **recommended** |

The decisive fact is not bundle weight. This app already ships a 63 MB wasm kernel, so a few
hundred KB is noise, and any argument resting on size would be dishonest. The decisive fact is
from `svg2pdf.js`'s own README, verbatim:

> "It requires a fully functional DOM implementation and **does not work with JSDOM**. The
> library is designed to run client-side in the user's browser."

Confirmed in its shipped bundle: 6 × `document.createElement`, `getBBox`, `SVGElement`,
`ownerDocument`.

`packages/studio`'s test script is `node --test "test/*.test.mjs"`. A DOM-only converter cannot
be tested by it, and cannot be tested with jsdom either. That is the same reasoning
`mesh-export.ts` already wrote down for itself in its own header — *"Input is structural, not
three.js… a plain Node script can hand it arrays and check the bytes"* — and the same reason
`writeSTL`/`writeOBJ` are first-party rather than vendored. This is repo convention, not taste.

The remaining objection to hand-writing — "you are writing an SVG parser" — does not survive
contact with the actual input. The SVG is generated by `fc-drawing.mjs` plus
`freecad-engine-adapter.ts`'s own `makeSheet()` template. Enumerated from the real 6085-byte
golden output:

| | Measured, exhaustively |
|---|---|
| elements | `svg`, `g`, `rect`, `path`, `circle`, `text` — six, no more |
| path commands | `M`, `L`, `A` (`C` handled too; `fc-drawing.mjs`'s bbox extractor already anticipates it) |
| transforms | `translate()` only |
| attributes | `d`, `fill`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `x`, `y`, `width`, `height`, `transform`, `font-family`, `font-size`, `cx`, `cy`, `r`, `xmlns`, `viewBox` |
| absent | CSS, classes, gradients, filters, images, `foreignObject`, `use`, clip paths, opacity groups, entities |

No general SVG engine is needed because no general SVG is produced.

One real parsing trap, worth stating because it breaks the obvious regex: TechDraw emits a
space **before** the `=`, as `<circle cx ="10" cy ="-5" r ="8" />`, and mixes comma and space
separators inside `d` (`M18, 12.5 L17.7994, 12.5`).

### Recommendation — a separate pure function, not an `exportDrawing()` option

```
engine capability                    pure byte transform
─────────────────                    ───────────────────
EngineAdapter.exportDrawing(doc)     svgToPdf(svgBytes)
  needs a live kernel session          needs nothing
  OcctEngineAdapter throws             engine-agnostic
  packages/kernel/                     packages/studio/  (beside mesh-export.ts)
```

`svgToPdf(exportDrawing(doc))`, composed by the UI. **Not** `opts.format: 'svg'|'pdf'`:

- `mesh-export.ts`'s `writeSTL`/`writeOBJ`/`write3MF` are already separate pure functions the
  UI composes, deliberately *not* methods on `EngineAdapter`. PDF conversion is the same
  shape: bytes in, bytes out, no kernel.
- An `opts.format` would make one signature return two different content types, forcing every
  caller to branch on the option it just passed to pick a MIME type and file extension.
- `OcctEngineAdapter` would have to refuse `format:'pdf'` for a reason that has nothing to do
  with OCCT — the conversion never needed an engine at all.
- It keeps the conversion testable without a kernel: the 18 tests below run in bare Node in
  milliseconds, no Docker, no wasm.

`DrawingOptions` is unchanged for Part 1. Place the file at
**`packages/studio/src/svg-pdf.ts`**, exported as `"./svg-pdf": "./dist/svg-pdf.js"` in
`packages/studio/package.json`, alongside the existing `"./mesh-export"` entry.

### `packages/studio/src/svg-pdf.ts`

Tested as written (18/18, below). Types added; logic byte-for-byte the prototype that produced
every measurement in this document.

```ts
// First-party SVG -> PDF writer for the narrow SVG subset exportDrawing()
// emits. Pure bytes-in/bytes-out, no DOM, no dependencies -- testable under
// `node --test`, exactly like mesh-export.ts's writeSTL.
//
// WHY NOT A LIBRARY. svg2pdf.js (the standard choice) states in its own
// README that it "requires a fully functional DOM implementation and does not
// work with JSDOM" -- untestable by this package's own test script. pdfkit is
// Node-first and needs fontkit/linebreak/png-js shims in a browser. canvg
// rasterises. pdf-lib has no SVG document support (only drawSvgPath for a
// bare `d` string), so the parser below would still have to be written; it
// remains the fallback if the PDF container ever needs features this does not
// have (compression, embedded fonts, multiple pages).
//
// WHY THIS IS NOT "writing an SVG parser". The input is generated by
// fc-drawing.mjs plus freecad-engine-adapter.ts's own makeSheet(). Measured
// exhaustively against real output: six element types (svg/g/rect/path/
// circle/text), three path commands (M/L/A, plus C anticipated), one
// transform (translate). See SPEC-drawing-pdf-dimensions.md.

const MM_TO_PT = 72 / 25.4; // 2.8346456692913384

// Note the `\s*` before `=`: TechDraw emits `<circle cx ="10" ...>`, with a
// space BEFORE the equals sign. A `([\w-]+)="` regex silently matches nothing
// on those and the circles vanish from the output.
const TAG = /<(\/)?([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/)?>/g;
const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function attrs(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(s))) o[m[1]] = m[2];
  return o;
}

const unesc = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Match EVERY letter, not just the supported ones. Restricting the character
// class here instead is a silent-wrong-output bug -- an unsupported command
// (Q, S, H, V, ...) is then simply not tokenized, its operands are swallowed
// as continuation coordinates of the PREVIOUS command, and the refusal branch
// in pathOps() is never reached: the drawing comes out wrong with no error at
// all. Found by test, not by reading.
const PATH_TOK = /([A-Za-z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

function tokenizePath(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  let m: RegExpExecArray | null;
  PATH_TOK.lastIndex = 0;
  while ((m = PATH_TOK.exec(d))) out.push(m[1] !== undefined ? m[1] : parseFloat(m[2]));
  return out;
}

type Cubic = [number, number, number, number, number, number];

/** SVG elliptical arc -> cubic Beziers (W3C SVG 1.1 F.6.5 endpoint->centre
 *  parameterisation, then <=90deg segments). Verified against the real
 *  isometric-view arcs: 30/30 sampled true-ellipse points land on inked
 *  pixels at +-0.2mm. */
function arcToCubics(
  x1: number, y1: number, rx: number, ry: number, rotDeg: number,
  large: number, sweep: number, x2: number, y2: number,
): Cubic[] {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = cos * dx2 + sin * dy2;
  const y1p = -sin * dx2 + cos * dy2;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const rx2 = rx * rx, ry2 = ry * ry, xp2 = x1p * x1p, yp2 = y1p * y1p;
  const num = Math.max(0, rx2 * ry2 - rx2 * yp2 - ry2 * xp2);
  const den = rx2 * yp2 + ry2 * xp2;
  const co = (large !== sweep ? 1 : -1) * Math.sqrt(den === 0 ? 0 : num / den);
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    const a = Math.acos(Math.min(1, Math.max(-1, d)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const th1 = ang(1, 0, ux, uy);
  let dth = ang(ux, uy, vx, vy);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const step = dth / n;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const E = (t: number): [number, number] =>
    [cx + rx * cos * Math.cos(t) - ry * sin * Math.sin(t),
     cy + rx * sin * Math.cos(t) + ry * cos * Math.sin(t)];
  const Ed = (t: number): [number, number] =>
    [-rx * cos * Math.sin(t) - ry * sin * Math.cos(t),
     -rx * sin * Math.sin(t) + ry * cos * Math.cos(t)];
  const segs: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = th1 + i * step, t1 = t0 + step;
    const [p0x, p0y] = E(t0), [d0x, d0y] = Ed(t0);
    const [p1x, p1y] = E(t1), [d1x, d1y] = Ed(t1);
    segs.push([p0x + alpha * d0x, p0y + alpha * d0y,
               p1x - alpha * d1x, p1y - alpha * d1y, p1x, p1y]);
  }
  return segs;
}

const K = 0.5522847498307936; // circle -> 4 cubics

type Num = (v: number) => string;

function circleOps(cx: number, cy: number, r: number, n: Num): string[] {
  const k = K * r;
  return [
    `${n(cx + r)} ${n(cy)} m`,
    `${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`,
    `${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c`,
    `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`,
    `${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`,
    'h',
  ];
}

function pathOps(d: string, n: Num): string[] {
  const t = tokenizePath(d);
  const ops: string[] = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  let cmd: string | null = null;
  const num = () => t[i++] as number;
  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++] as string;
    if (cmd === 'Z' || cmd === 'z') { ops.push('h'); cx = sx; cy = sy; continue; }
    if (typeof t[i] !== 'number') break;
    switch (cmd) {
      case 'M': cx = num(); cy = num(); sx = cx; sy = cy;
        ops.push(`${n(cx)} ${n(cy)} m`); cmd = 'L'; break;
      case 'm': cx += num(); cy += num(); sx = cx; sy = cy;
        ops.push(`${n(cx)} ${n(cy)} m`); cmd = 'l'; break;
      case 'L': cx = num(); cy = num(); ops.push(`${n(cx)} ${n(cy)} l`); break;
      case 'l': cx += num(); cy += num(); ops.push(`${n(cx)} ${n(cy)} l`); break;
      case 'C': {
        const a = num(), b = num(), c = num(), e = num(), f = num(), g = num();
        ops.push(`${n(a)} ${n(b)} ${n(c)} ${n(e)} ${n(f)} ${n(g)} c`);
        cx = f; cy = g; break;
      }
      case 'A': case 'a': {
        const rx = num(), ry = num(), rot = num(), la = num(), sw = num();
        let ex = num(), ey = num();
        if (cmd === 'a') { ex += cx; ey += cy; }
        for (const s of arcToCubics(cx, cy, rx, ry, rot, la, sw, ex, ey)) {
          ops.push(`${n(s[0])} ${n(s[1])} ${n(s[2])} ${n(s[3])} ${n(s[4])} ${n(s[5])} c`);
        }
        cx = ex; cy = ey; break;
      }
      default:
        throw new Error(
          `svgToPdf: unsupported path command '${cmd}' -- exportDrawing() emits `
          + `only M/L/A (measured); refusing rather than silently dropping geometry.`,
        );
    }
  }
  return ops;
}

function colour(v: string | undefined): [number, number, number] | null {
  if (!v || v === 'none') return null;
  let m = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (m) {
    return [parseInt(m[1].slice(0, 2), 16) / 255,
            parseInt(m[1].slice(2, 4), 16) / 255,
            parseInt(m[1].slice(4, 6), 16) / 255];
  }
  m = /^#([0-9a-fA-F]{3})$/.exec(v);
  if (m) {
    const [a, b, c] = [...m[1]].map((ch) => parseInt(ch + ch, 16) / 255);
    return [a, b, c];
  }
  if (v === 'black') return [0, 0, 0];
  if (v === 'white') return [1, 1, 1];
  return null;
}

const INHERIT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray',
                 'stroke-linecap', 'stroke-linejoin', 'font-size', 'font-family',
                 'text-anchor'] as const;
const CAP: Record<string, number> = { butt: 0, round: 1, square: 2 };
const JOIN: Record<string, number> = { miter: 0, round: 1, bevel: 2 };

// Helvetica (Base-14) advance widths, /1000 em. Needed ONLY to honour
// text-anchor: PDF has no concept of text alignment, so the writer must shift
// the text origin itself. Unlisted characters fall back to 556 (the digit
// width), the right guess for a numeric dimension label.
const HELV_W: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667,
  "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333,
  '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584,
  '?': 556, '@': 1015, '[': 278, ']': 278, '^': 469, '_': 556, '`': 333,
  '{': 334, '|': 260, '}': 334, '~': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  'Ø': 778, '°': 400, '±': 584,
};
const textWidth = (s: string, size: number): number => {
  let w = 0;
  for (const ch of String(s)) w += HELV_W[ch] ?? 556;
  return (w / 1000) * size;
};

// PDF literal-string escaping. Non-Latin-1 is transliterated to '?': the
// Base-14 Helvetica used here is WinAnsiEncoding and cannot represent
// anything above U+00FF at all, so honest substitution beats a corrupt glyph.
// (This is why the dimension emitter writes U+00D8 'O-slash' and not U+2300
// 'DIAMETER SIGN' -- the latter has no WinAnsi code point. FreeCAD's own
// getText() returns the U+2300 form.)
function pdfString(s: string): string {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c < 32 || c > 255) out += '?';
    else if (c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out;
}

/** An SVG transform LIST -> a sequence of PDF `cm` operators, applied in the
 *  same left-to-right order SVG defines. Anything unrecognised is refused
 *  rather than ignored: a dropped transform puts geometry in the wrong place
 *  with no other symptom. */
function transformOps(tr: string, n: Num): string[] {
  const out: string[] = [];
  const RE = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let seen = false;
  while ((m = RE.exec(tr))) {
    seen = true;
    const f = m[1];
    const v = m[2].trim().split(/[\s,]+/).filter((s) => s !== '').map(Number);
    if (v.some((x) => !Number.isFinite(x))) {
      throw new Error(`svgToPdf: non-numeric transform arguments in '${tr}'`);
    }
    if (f === 'translate') {
      out.push(`1 0 0 1 ${n(v[0] || 0)} ${n(v[1] || 0)} cm`);
    } else if (f === 'scale') {
      const sx = v[0] ?? 1, sy = v[1] ?? sx;
      out.push(`${n(sx)} 0 0 ${n(sy)} 0 0 cm`);
    } else if (f === 'rotate') {
      const th = ((v[0] || 0) * Math.PI) / 180;
      const c = Math.cos(th), s = Math.sin(th);
      if (v.length >= 3) out.push(`1 0 0 1 ${n(v[1])} ${n(v[2])} cm`);
      out.push(`${n(c)} ${n(s)} ${n(-s)} ${n(c)} 0 0 cm`);
      if (v.length >= 3) out.push(`1 0 0 1 ${n(-v[1])} ${n(-v[2])} cm`);
    } else if (f === 'matrix' && v.length === 6) {
      out.push(`${v.map((x) => n(x)).join(' ')} cm`);
    } else {
      throw new Error(`svgToPdf: unsupported transform function '${f}()' in '${tr}'`);
    }
  }
  if (!seen && tr.trim()) throw new Error(`svgToPdf: unparseable transform '${tr}'`);
  return out;
}

/**
 * Convert the SVG `EngineAdapter.exportDrawing()` produces into single-page
 * PDF bytes. Page size comes from the SVG's own width/height in mm (falling
 * back to the viewBox); every drawing coordinate is written in SVG user units
 * verbatim, under one page-level flip transform, which is what makes the
 * output auditable against the input by eye.
 *
 * Throws on anything outside the measured subset rather than dropping it --
 * a silently-skipped element is a wrong drawing with no symptom.
 */
export function svgToPdf(svg: Uint8Array | string): Uint8Array {
  const text = typeof svg === 'string' ? svg : new TextDecoder('utf8').decode(svg);

  const root = /<svg\b([^>]*)>/.exec(text);
  if (!root) throw new Error('svgToPdf: no <svg> root element found');
  const ra = attrs(root[1]);
  const mm = (v: string | undefined) => {
    const m = /^\s*(-?[\d.]+)\s*(mm)?\s*$/.exec(v || '');
    return m ? parseFloat(m[1]) : NaN;
  };
  let W = mm(ra.width), H = mm(ra.height);
  if (!Number.isFinite(W) || !Number.isFinite(H)) {
    const vb = (ra.viewBox || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite)) { W = vb[2]; H = vb[3]; }
  }
  if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) {
    throw new Error('svgToPdf: <svg> has no usable width/height (mm) or viewBox');
  }

  const n: Num = (v) => {
    const r = Math.round(v * 1e4) / 1e4;
    return Object.is(r, -0) ? '0' : String(r);
  };
  const ops: string[] = [];
  type Style = Record<string, string>;
  const stack: Style[] = [{
    fill: 'none', stroke: 'none', 'stroke-width': '1',
    'font-size': '10', 'font-family': 'sans-serif',
  }];
  const top = () => stack[stack.length - 1];

  // One transform for the whole page: mm -> pt AND SVG's Y-down -> PDF's Y-up.
  ops.push(`${n(MM_TO_PT)} 0 0 ${n(-MM_TO_PT)} 0 ${n(H * MM_TO_PT)} cm`);

  let usedFont = false;

  function paint(st: Style): string {
    const f = colour(st.fill), s = colour(st.stroke);
    if (f) ops.push(`${n(f[0])} ${n(f[1])} ${n(f[2])} rg`);
    if (s) {
      ops.push(`${n(s[0])} ${n(s[1])} ${n(s[2])} RG`);
      ops.push(`${n(parseFloat(st['stroke-width'] ?? '1'))} w`);
      const da = st['stroke-dasharray'];
      ops.push(da && da !== 'none'
        ? `[${da.trim().split(/[\s,]+/).map((x) => n(parseFloat(x))).join(' ')}] 0 d`
        : '[] 0 d');
      if (st['stroke-linecap'] in CAP) ops.push(`${CAP[st['stroke-linecap']]} J`);
      if (st['stroke-linejoin'] in JOIN) ops.push(`${JOIN[st['stroke-linejoin']]} j`);
    }
    return f && s ? 'B' : f ? 'f' : s ? 'S' : 'n';
  }

  interface Pending { st: Style; x: number; y: number; tr?: string }
  const pending: Pending[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = TAG.exec(text))) {
    const [, close, name, attrStr, selfClose] = m;
    if (close) {
      if (name === 'text' && pending.length) {
        const { st, x, y, tr } = pending.pop()!;
        if (tr) { ops.push('q'); ops.push(...transformOps(tr, n)); }
        const body = unesc(text.slice(last, m.index)).trim();
        const size = parseFloat(st['font-size'] ?? '10');
        const f = colour(st.fill) || [0, 0, 0];
        if (body) {
          usedFont = true;
          const anchor = st['text-anchor'] || 'start';
          const w = anchor === 'start' ? 0 : textWidth(body, size);
          const ax = x - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0);
          ops.push('BT', `${n(f[0])} ${n(f[1])} ${n(f[2])} rg`, `/F1 ${n(size)} Tf`,
            // Re-flip Y in the text matrix so glyphs are upright under the
            // page-level Y-down CTM above.
            `1 0 0 -1 ${n(ax)} ${n(y)} Tm`, `(${pdfString(body)}) Tj`, 'ET');
        }
        if (tr) ops.push('Q');
      } else if (name === 'g' || name === 'svg') {
        if (stack.length > 1) stack.pop();
        ops.push('Q');
      }
      last = TAG.lastIndex;
      continue;
    }

    const a = attrs(attrStr);
    const st: Style = { ...top() };
    for (const k of INHERIT) if (a[k] !== undefined) st[k] = a[k];

    if (name === 'svg') { stack.push(st); ops.push('q'); last = TAG.lastIndex; continue; }
    if (name === 'g') {
      ops.push('q');
      if (a.transform) ops.push(...transformOps(a.transform, n));
      if (!selfClose) stack.push(st); else ops.push('Q');
      last = TAG.lastIndex;
      continue;
    }
    if (name === 'rect') {
      const op = paint(st);
      ops.push(`${n(+a.x || 0)} ${n(+a.y || 0)} ${n(+a.width)} ${n(+a.height)} re`, op);
    } else if (name === 'path') {
      const op = paint(st);
      ops.push(...pathOps(a.d || '', n), op);
    } else if (name === 'circle') {
      const op = paint(st);
      ops.push(...circleOps(+a.cx || 0, +a.cy || 0, +a.r, n), op);
    } else if (name === 'line') {
      const op = paint(st);
      ops.push(`${n(+a.x1)} ${n(+a.y1)} m`, `${n(+a.x2)} ${n(+a.y2)} l`, op);
    } else if (name === 'text') {
      pending.push({ st, x: +a.x || 0, y: +a.y || 0, tr: a.transform });
    }
    last = TAG.lastIndex;
  }
  while (stack.length > 1) { stack.pop(); ops.push('Q'); }

  // ---- PDF container: 4 objects (5 when the page has text), xref, trailer.
  // No compression (a 6KB drawing gains nothing and stays greppable), no
  // embedded font (Helvetica is one of the 14 every reader must provide).
  const stream = ops.join('\n') + '\n';
  const objs: Array<string | null> = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W * MM_TO_PT)} `
    + `${n(H * MM_TO_PT)}] /Resources << ${usedFont ? '/Font << /F1 5 0 R >> ' : ''}>> `
    + '/Contents 4 0 R >>';
  objs[4] = null; // the content stream, written specially below
  if (usedFont) {
    objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica '
      + '/Encoding /WinAnsiEncoding >>';
  }
  const N = usedFont ? 5 : 4;

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let len = 0;
  const push = (s: string) => { const b = enc.encode(s); chunks.push(b); len += b.length; };
  const offsets: number[] = [];

  push('%PDF-1.4\n%\xC2\xB5\xC2\xB6\n');
  for (let i = 1; i <= N; i++) {
    offsets[i] = len;
    if (i === 4) {
      const body = enc.encode(stream);
      push(`4 0 obj\n<< /Length ${body.length} >>\nstream\n`);
      chunks.push(body); len += body.length;
      push('\nendstream\nendobj\n');
    } else {
      push(`${i} 0 obj\n${objs[i]}\nendobj\n`);
    }
  }
  const xref = len;
  let x = `xref\n0 ${N + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= N; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${N + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
```

### UI wiring

`ReshapeStudio.tsx`'s `exportDrawing()` already builds a Blob and clicks an `<a>`. PDF is the
same function with one extra call — it does **not** need its own engine guard, because it
never touches the engine.

**Implemented as a relative import, not the self-package import shown below** — a
self-referencing `@shuff57/reshape-studio/svg-pdf` import resolves through `package.json`'s
`exports` field to `./dist/svg-pdf.js`, which does not exist yet during that SAME package's own
`tsc` build (a chicken-and-egg failure on a fresh build). `ReshapeStudio.tsx` already imports
`mesh-export.ts` (in the same package) via a relative path for the identical reason, so
`import { svgToPdf } from './svg-pdf.js';` matches existing convention. The `"./svg-pdf"` package
export entry is still correct and needed for any OTHER package that wants to import
`svgToPdf()` from outside `packages/studio`.

```tsx
import { svgToPdf } from '@shuff57/reshape-studio/svg-pdf';

// 2D engineering drawing. `format` only changes what happens to the bytes
// AFTER the kernel returns them -- the kernel has no PDF writer at all
// (docs/specs/SPEC-drawing-pdf-dimensions.md Part 1), so the conversion is a
// pure byte transform here, the same split mesh-export.ts's writeSTL/writeOBJ/
// write3MF already use.
function exportDrawing(format: 'svg' | 'pdf' = 'svg') {
  const engine = engineRef.current;
  if (!engine) return;
  try {
    const svg = engine.exportDrawing(docRef.current);
    const bytes = format === 'pdf' ? svgToPdf(svg) : svg;
    const type = format === 'pdf' ? 'application/pdf' : 'image/svg+xml';
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(format);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    window.alert(`Could not export drawing: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

Keep the existing button as `onClick={() => exportDrawing('svg')}` and add a second
`Export PDF` beside it with the identical `engineKind === 'freecad' && hasMesh` gate — the
gate is for `exportDrawing()`, not for `svgToPdf()`.

---

## Part 2 — dimensioning

### The finding that decides the design

`TechDraw::DrawViewDimension` **works headlessly** — it can be added to a page, given
`References2D`, and recomputed to `['Up-to-date']` with a correctly measured value. It just
cannot be **drawn**:

| Probe | Result |
|---|---|
| `addObject('TechDraw::DrawViewDimension')` + `page.addView()` + `References2D` + recompute | `['Up-to-date']` |
| `Type` enum | `['Distance','DistanceX','DistanceY','DistanceZ','Radius','Diameter','Angle','Angle3Pt','Area']` |
| `dim.getRawValue()` (diameter on the r8 hole) | `16.0` |
| `dim.getText()` | `'⌀16.00 mm'` |
| `dim.getLinearPoints()` | `[Vector(-30, 12.5, 0), Vector(-30, -12.5, 0)]` — real endpoints |
| `dim.getArcPoints()` (diameter) | centre `(-10,0)` + both ends `(-2,0)`, `(-18,0)` |
| **`dim.getArrowPositions()`** | **`[(0,0,0), (0,0,0)]`** — never computed at App level |
| **`TechDraw.viewPartAsSvg(dim)`** | **`''`** |
| **`TechDraw.viewPartAsDxf(dim)`** | **`''`** |
| `viewPartAsSvg(view)` contains dimension text | `False` |
| `TechDraw.writeDXFPage(page, path)` | 9 `DIMENSION` entities — the data is real, DXF-only |
| `Diameter` referencing a straight edge | refuses: `"Dia0 2d reference is a Line"` |
| `TechDraw.makeDistanceDim(view, 'DistanceX', p1, p2)` | works; snapped my arbitrary points to `('Vertex4','Vertex5')` |
| `TechDraw.makeExtentDim(view, [], 0)` | works → a `DrawViewDimExtent` object |
| `dim.getDimValue()` | **does not exist** (`AttributeError`) — the obvious name is wrong; it is `getRawValue()` |

The arrows and dimension lines live in `ViewProviderDimension`, in the GUI layer that
`BUILD_GUI=OFF` did not build. So the same structural answer as Part 1 applies one level down:
**the app must draw the dimension graphics itself.** And once it is drawing them, creating the
kernel dimension objects buys nothing — no graphics, one full `doc.recompute()` of the page per
dimension, and three more object types to clean up. The recommendation therefore does not
create them at all; it measures the projected geometry directly.

### The trap that would have shipped a wrong number

The two accessors for a view's projected 2D geometry return **different coordinate spaces**,
and are indistinguishable at the default scale of 1.0. Measured on one Top view at four scales:

| `view.Scale` | `getEdgeByIndex(i)` | `getVisibleEdges()` | `viewPartAsSvg()` | circle radius by accessor |
|---|---|---|---|---|
| 1.0 | −30.000 … 30.000 | −30.000 … 30.000 | −30.000 … 30.000 | idx 8.0 / vis 8.0 / svg 8.0 |
| 0.5 | −30.000 … 30.000 | −15.000 … 15.000 | −15.000 … 15.000 | idx 8.0 / vis **4.0** / svg 4.0 |
| 2.0 | −30.000 … 30.000 | −60.000 … 60.000 | −60.000 … 60.000 | idx 8.0 / vis **16.0** / svg 16.0 |
| 0.2 | −30.000 … 30.000 | −6.000 … 6.000 | −6.000 … 6.000 | idx 8.0 / vis **1.6** / svg 1.6 |

Edge lengths tell the same story: `getEdgeByIndex` reports `[40, 50.2655, 60]` at *every*
scale, `getVisibleEdges` reports `[20, 25.1327, 30]` at 0.5 and `[80, 100.531, 120]` at 2.0.

- `getEdgeByIndex(i)` → **unscaled** true model mm.
- `getVisibleEdges()` → **scaled** page mm, tracking `viewPartAsSvg()` exactly.

The first draft of the emitter below used `getVisibleEdges()` for measurement *and* multiplied
by `view.Scale` for placement. At 1:1 every test passed. At 0.5 it labelled a 60 mm box
**"30"** — and autoscale (`ScaleType='Automatic'`) is `exportDrawing()`'s default, so the wrong
number is the *normal* path, not an edge case. This is the single most important thing for the
implementing agent to preserve:

```
getVisibleEdges() ──▶ placement   (page mm, verbatim -- matches the fragment)
        │
        └─ ÷ view.Scale ──▶ value (true mm, what the label says)
```

Use one accessor and divide, rather than pairing the two: `getEdgeByIndex` enumerates
**visible + hidden together** (the Front view: 12 edges = 4 visible + 8 hidden), so index
alignment between the two lists is not a given.

Two more measured traps:

- **HLR reports the same circle in both the visible and the hidden list.** The golden Top view
  has `visible=5, hidden=5` with byte-identical coordinates, and the shipped SVG already
  contains `<circle cx ="10" cy ="-5" r ="8" />` twice for this reason. A naive pass draws
  every hole diameter twice. Dedupe on `(centre, radius)` rounded to 4 dp.
- **Curve types are not all dimensionable.** A through hole seen from the side projects as
  `BSplineCurve` edges, not `Line`s; the isometric view projects `Ellipse` edges and skewed
  `Line`s. Filter to `Line` and closed `Circle`, and never dimension the isometric view at all.

### Recommended scope: overall extents plus hole diameters — named as such

Ship `dimensions: 'overall'`, not "auto-dimensioning". For each **orthographic** view:

1. one horizontal dimension = the view's overall projected width,
2. one vertical dimension = the view's overall projected height,
3. one `Ø` leader per distinct visible circle.

Isometric views get nothing. This is what a drafter puts on a simple part first, it matches
what `makeExtentDim()` does natively (horizontal/vertical extent of a whole view), and it is
honest about not being GD&T.

**What it does not do, explicitly deferred again:** feature-relative positions (hole centre
distances from a datum), radii of fillets, angles, chamfers, tolerances, datum references,
section and detail views, dimension collision avoidance between views, and any user control
over which dimensions appear or where. Same shape of scope-down as `draft`'s `pull:'z'`-only
v1 — a narrower thing that is correct, rather than a general thing that is wrong.

### Honest assessment of the `Feature`-data alternative

The task proposed deriving dimensions from the `ModelDoc` `Feature` rows instead of the
projected B-rep. **Recommend against it.** It is more work *and* less correct:

- It still cannot place anything. A dimension needs the projected edge it attaches to and the
  view it belongs in, so the projected geometry has to be read anyway — at which point the
  number is already there, free, and exactly right.
- It covers less. Of the 21 `kind`s in `model-types.ts`, 8 carry their own defining numbers
  (`box`, `cylinder`, `sphere`, `cone`, `torus`, `prism`, `wedge`, and `hole`'s `diameter`).
  The other 13 — `sketch`, `extrude`, `revolve`, `pocket`, `groove`, `blend`, `combine`,
  `mirror`, `pattern`, `shell`, `fillet`, `draft`, `move` — do not. Measuring the projection
  covers all 21, and gets `Ø10` on a pocket of a circular sketch just as readily as on a
  `hole`.
- **It can be confidently wrong**, which is the real objection. A `box` keeps `size:[60,40,25]`
  in the document after a `pocket`, a `shell`, a `mirror` or a `move` has changed what the
  solid actually is. The label would then describe the design intent of one row rather than
  the part on the sheet. Measuring the projection cannot drift from the drawing, because it
  *is* the drawing. That is the same "no answer over a wrong one" rule as `whyCannotBlend()`
  and `notInABody()`.

Its one genuine advantage — nominal design intent (an exactly-`16` hole rather than a measured
`15.9999`) — is covered by rounding to 2 dp, which the emitter already does.

### Interface addition

```ts
// packages/kernel/src/engine-adapter.ts -- add to DrawingOptions

export interface DrawingOptions {
  // ... existing fields unchanged ...

  /** Overall-extent dimensions on the orthographic views: the view's own
   *  projected width and height, plus a diameter callout per visible circle.
   *  Default 'none'.
   *
   *  'overall' is the honest name and the whole scope. It is NOT GD&T
   *  auto-dimensioning: no feature-relative positions, no fillet radii, no
   *  angles, no tolerances, no datums, and nothing at all on an isometric
   *  view (its edges project as ellipses and skewed lines, which cannot be
   *  dimensioned meaningfully). See docs/specs/SPEC-drawing-pdf-dimensions.md
   *  Part 2 for what was measured and what was deferred.
   *
   *  A view whose projection yields no straight edge and no closed circle
   *  gets NO dimensions and is reported in `skipped` rather than guessed at. */
  dimensions?: 'none' | 'overall';
}
```

`session.exportDrawing()`'s JSON gains `dimensions: Array<{view, values}>` and
`skipped: string[]`, so a caller can tell "no dimensions were possible here" from "dimensions
were not requested" — the refusal has to be legible, not silent.

### `packages/engine/src/fc-drawing.mjs` — the dimension emitter

Emitted Python, appended to `emit.exportDrawing()`'s snippet. Sizes are **page mm constants**,
which is correct precisely because placement coordinates are already page mm: dimension text
stays 3.5 mm tall whether the part is drawn at 2:1 or 1:20.

```python
TEXT_H  = 3.5   # dimension text height, page mm
ARROW_L = 2.5   # arrowhead length, page mm
ARROW_W = 0.9   # arrowhead half-width, page mm
GAP     = 2.0   # outline -> start of extension line
OFFSET  = 10.0  # outline -> dimension line
EXT     = 2.0   # extension line overrun past the dimension line
DTOL    = 1e-6

def _fmt(v):
    # 2dp, trailing zeros trimmed: 60.0 -> "60", 15.875 -> "15.88"
    s = ("%.2f" % round(v, 2)).rstrip("0").rstrip(".")
    return s or "0"

def _dline(x1, y1, x2, y2, w):
    return ('<path d="M %.4f %.4f L %.4f %.4f" fill="none" stroke="#000000" '
            'stroke-width="%g"/>\n' % (x1, y1, x2, y2, w))

def _arrow(x, y, dx, dy):
    # Filled triangle, TIP at (x,y), pointing along (dx,dy).
    m = math.hypot(dx, dy)
    if m < DTOL:
        return ""
    ux, uy = dx / m, dy / m
    px, py = -uy, ux
    bx, by = x - ux * ARROW_L, y - uy * ARROW_L
    return ('<path d="M %.4f %.4f L %.4f %.4f L %.4f %.4f Z" fill="#000000" '
            'stroke="none"/>\n'
            % (x, y, bx + px * ARROW_W, by + py * ARROW_W,
               bx - px * ARROW_W, by - py * ARROW_W))

def _label(x, y, s, anchor="middle"):
    return ('<text x="%.4f" y="%.4f" font-family="sans-serif" font-size="%g" '
            'fill="#000000" text-anchor="%s">%s</text>\n'
            % (x, y, TEXT_H, anchor, s))

def _linear(a, b, base, value, vertical, flip):
    # `a`,`b` span the measured direction; `base` is the outline edge the
    # extension lines grow from. All PAGE mm.
    sgn = -1.0 if flip else 1.0
    dl = base + sgn * OFFSET
    g  = base + sgn * GAP
    e  = dl + sgn * EXT
    out = []
    if not vertical:
        out.append(_dline(a, g, a, e, 0.18))
        out.append(_dline(b, g, b, e, 0.18))
        out.append(_dline(a, dl, b, dl, 0.25))
        out.append(_arrow(a, dl, -1, 0))
        out.append(_arrow(b, dl, 1, 0))
        out.append(_label((a + b) / 2.0, dl - 1.2, _fmt(value)))
    else:
        out.append(_dline(g, a, e, a, 0.18))
        out.append(_dline(g, b, e, b, 0.18))
        out.append(_dline(dl, a, dl, b, 0.25))
        out.append(_arrow(dl, a, 0, -1))
        out.append(_arrow(dl, b, 0, 1))
        # Rotated text goes on the GROUP, not on the <text>: keeps the PDF
        # writer's transform handling to one code path.
        out.append('<g transform="translate(%.4f,%.4f) rotate(-90)">'
                   '<text x="0" y="0" font-family="sans-serif" font-size="%g" '
                   'fill="#000000" text-anchor="middle">%s</text></g>\n'
                   % (dl - 1.2, (a + b) / 2.0, TEXT_H, _fmt(value)))
    return "".join(out)

def _diameter(cx, cy, rp, value):
    # A 45deg leader out of the circle with the value at its end. An in-circle
    # dimension line is unusable on a small hole (no room for text) and
    # collides with the hole's own edges; a leader never does.
    k = 0.70710678
    sx, sy = cx + rp * k, cy - rp * k
    ex, ey = cx + (rp + 6.0) * k, cy - (rp + 6.0) * k
    # U+00D8 (O with stroke), NOT U+2300 (DIAMETER SIGN) which FreeCAD's own
    # getText() returns: U+2300 has no WinAnsiEncoding code point, so it cannot
    # survive into a Base-14 PDF at all. U+00D8 is 0xD8 and is the conventional
    # engineering substitute.
    return (_dline(sx, sy, ex, ey, 0.18)
            + _dline(ex, ey, ex + 1.5, ey, 0.18)
            + _arrow(sx, sy, sx - cx, sy - cy)
            + _label(ex + 2.2, ey - 1.0, u"Ø" + _fmt(value), "start"))

def _dimension_view(view):
    """(svg, extent, values) for ONE orthographic view.

    `extent` is (minx, maxx, miny, maxy) in PAGE mm INCLUDING the dimension
    graphics -- the composer MUST fold this into its fit/recentre maths (see
    the spec: a 120x80 plate with four holes overflows an A4 frame by 47mm
    when only the part geometry is measured).
    """
    S = float(view.Scale) or 1.0
    lines, circles = [], []
    for e in view.getVisibleEdges():          # PAGE mm -- see the scale table
        k = type(e.Curve).__name__
        if k == "Line":
            a, b = e.Vertexes[0].Point, e.Vertexes[-1].Point
            lines.append((a.x, a.y, b.x, b.y))
        elif k == "Circle" and e.isClosed():
            c = e.Curve
            circles.append((c.Center.x, c.Center.y, c.Radius))
    if not lines and not circles:
        return "", None, []

    xs, ys = [], []
    for (ax, ay, bx, by) in lines:
        xs += [ax, bx]; ys += [ay, by]
    for (cx, cy, r) in circles:
        xs += [cx - r, cx + r]; ys += [cy - r, cy + r]
    px0, px1, py0, py1 = min(xs), max(xs), min(ys), max(ys)

    out, vals = [], []
    ex, ey = [px0, px1], [py0, py1]
    w_true = (px1 - px0) / S          # divide -> true mm
    h_true = (py1 - py0) / S
    if w_true > DTOL:
        out.append(_linear(px0, px1, py1, w_true, False, False))
        vals.append(round(w_true, 4)); ey.append(py1 + OFFSET + EXT)
    if h_true > DTOL:
        out.append(_linear(py0, py1, px0, h_true, True, True))
        vals.append(round(h_true, 4)); ex.append(px0 - OFFSET - EXT)

    # Dedupe: HLR reports the SAME circle in both the visible and the hidden
    # list, so a naive pass draws every hole diameter twice.
    seen = set()
    for (cx, cy, r) in circles:
        key = (round(cx, 4), round(cy, 4), round(r, 4))
        if key in seen:
            continue
        seen.add(key)
        out.append(_diameter(cx, cy, r, 2 * r / S))
        vals.append(round(2 * r / S, 4))
        ex.append(cx + (r + 6.0) * 0.7071 + 14.0)
        ey.append(cy - (r + 6.0) * 0.7071)
    return "".join(out), (min(ex), max(ex), min(ey), max(ey)), vals
```

Inside `compose_once()`, per item — note the extent must come from `_dimension_view` when
dimensions are on, *instead of* `_extent(frag)`, not in addition to it:

```python
dims, dext, dvals = "", None, []
if DIMENSIONS == "overall" and it.Type != "FrontTopRight":
    dims, dext, dvals = _dimension_view(it)
    if dvals:
        dim_report.append({"view": it.Type, "values": dvals})
    else:
        skipped.append(it.Type)          # honest refusal, never a guess
elif DIMENSIONS == "overall":
    skipped.append(it.Type)              # isometric: deliberately never dimensioned

ex = dext if dext is not None else _extent(frag)
if ex:
    minx = min(minx, ox + ex[0]); maxx = max(maxx, ox + ex[1])
    miny = min(miny, oy + ex[2]); maxy = max(maxy, oy + ex[3])
frags.append((it.Name, it.Type, ox, oy, frag + dims))
```

The existing scale-stepping loop (`[1.0, 0.5, 0.2, 0.1, 0.05]`) then handles overflow for
free, because it re-measures after every step — **provided** the dimension extent feeds it.
This is the one place where getting it wrong is a correctness bug rather than a cosmetic one,
and it is measured below.

---

## Verification

All figures below are from actual runs on 2026-09-12. Kernel probes:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "<scratch>:/out" \
  -v "$(pwd)/engine/scripts:/host-scripts:ro" -e SMOKE_PY_FILE=/out/<probe>.py \
  fc-kernel-techdraw-full node --experimental-wasm-exnref \
  /host-scripts/smoke.mjs /work/build/bin/FreeCADCmd.js /tmp/out
```

Real SVG produced through the shipped adapter (dual-mount, as
`freecad-drawing.manual.mjs` documents):

```bash
MSYS_NO_PATHCONV=1 docker run --rm --privileged -v "$(pwd):/repo" \
  -v "$(pwd):/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad" \
  -v "<scratch>:/out" fc-kernel-techdraw-full \
  node --experimental-wasm-exnref /out/dump-svg.mjs /work/build/bin/FreeCADCmd.js /out
```

### Part 1 — conversion, measured

| Input (real `exportDrawing()` bytes) | SVG | PDF | time |
|---|---|---|---|
| golden, A4 landscape, 1:1, no dims | 6 085 B | 6 401 B | 0.47 ms |
| golden, A3 landscape, 1:2, title "Bracket" | 6 117 B | 6 369 B | 0.30 ms |
| golden + dimensions | 10 328 B | 8 495 B | 0.55 ms |
| 120×80×10 plate, 4 × Ø10 + dimensions | 18 330 B | 18 221 B | 0.87 ms |
| golden + dimensions at scale 0.5 | 10 284 B | 8 425 B | 0.54 ms |

Validated by two independent parsers plus a rasteriser, none of them mine:

| Claim | Tool | Measured |
|---|---|---|
| valid single-page PDF | `pdfinfo` (xpdf 4.06) | `Pages: 1` |
| A4 landscape page size | `pdfinfo` | `841.89 x 595.276 pts (A4)` |
| A3 landscape page size | `pypdf` 6.10.2 | MediaBox `[0, 0, 1190.551, 841.89]` |
| titleblock text survives | `pdftotext` | `UNTITLED / Scale 1:1 / 2026-09-13` |
| dimension values survive | `pypdf` | `DIMTEST 60 25 60 40 Ø16 40 25` |
| `Ø` encodes correctly | content stream + `pdftotext -enc Latin1` | `\330` in the stream; bytes `d8 31 36` = `Ø16` |
| deterministic output | byte compare of two runs | identical |

Geometric fidelity, by rasterising at 254 dpi (exactly 10 px/mm) and probing the pixels
against coordinates parsed independently out of the source SVG:

| Claim | Measured |
|---|---|
| raster dimensions for a 297×210 mm sheet | 2971 × 2101 px |
| ink bbox vs the sheet's inner frame (10…287, 10…200 mm) | 9.70…287.10, 9.70…200.10 mm — the 0.25 mm stroke half-width, plus rounding |
| every straight-line endpoint inked (undimensioned golden) | **224 / 224** |
| visible-outline endpoints inked (dimensioned golden) | **42 / 42** |
| hidden-line (dashed `2,1`) endpoints inked | 134 / 182 — misses are dash gaps; correct rendering, not a defect |
| circle ring at (115.645, 80.0) r 8, sampled every 5° | **72 / 72** inked; centre clear; 1 mm inside the ring clear (honours `fill="none"`) |
| arc endpoints, all three isometric arcs | **6 / 6** inked |
| true-ellipse points along those arcs, independent centre-parameterisation | **30 / 30** inked at ±0.2 mm |
| dimension lines and extension lines | **40 / 40** inked |
| arrowheads (filled triangles) | **39 / 39** vertices inked; **13 / 13** centroids inked at zero tolerance |

Converter unit tests — **18 passed, 0 failed**, in bare `node --test`-style Node with no
Docker, no wasm, no DOM:

| Test | Result |
|---|---|
| refuses no `<svg>` root | throws `no <svg> root element found` |
| refuses no width/height/viewBox | throws `no usable width/height (mm) or viewBox` |
| refuses path command `Q`, `H` | throws `unsupported path command '…'` |
| refuses `transform="skewX(10)"` | throws `unsupported transform function 'skewX()'` |
| viewBox-only fallback | 100×50 → MediaBox `[0 0 283.4646 141.7323]` |
| no `/Type /Font` when the page has no text; xref sizes to 5 | pass |
| `/Type /Font` present with text; xref grows to 6 | pass |
| `(`, `)`, `\` escaped; `Ø` → `\330`; CJK → `?` | pass |
| `text-anchor` start/middle/end on `"60"` at size 10 | x = 20 / 14.44 / 8.88 (Helvetica 556+556 = 11.12 mm) |
| `translate()` + `rotate()` compose in SVG order | `1 0 0 1 10 20 cm` then `0 -1 1 0 0 0 cm` |
| deterministic, and accepts `string` as well as `Uint8Array` | pass |

One bug this suite caught that reading did not, worth keeping as a regression test: restricting
the path tokenizer's character class to the supported commands made an unsupported `Q` **fail
silently** — it was not tokenized at all, its operands were swallowed as continuation
coordinates of the preceding `L`, and the refusal branch was never reached. The fix is to
tokenize every letter and reject unknown ones. The repo's own "refuse rather than guess"
discipline is only real if the refusal path is reachable.

### Part 2 — dimension values, measured

Identical values at 1:1 and 1:2 is the proof the scale handling is right; it is the assertion
to pin.

| Fixture | `grp.Scale` | Front | Top | Right | Iso |
|---|---|---|---|---|---|
| 60×40×25 box − Ø16 hole | 1.0 | 60, 25 | 60, 40, Ø16 | 40, 25 | skipped |
| 60×40×25 box − Ø16 hole | **0.5** | **60, 25** | **60, 40, Ø16** | **40, 25** | skipped |
| 120×80×10 plate − 4 × Ø10 | 1.0 | 120, 10 | 120, 80, Ø10 ×4 | 80, 10 | skipped |

Every value matches the fixture's construction exactly. The 4-hole plate produced **4**
diameter callouts from 8 reported circles (4 visible + 4 hidden), confirming the dedupe.

**The fit failure, measured — this is the must-fix:**

| Fixture | ink bbox after conversion | inside frame (10…287, 10…200)? |
|---|---|---|
| golden + dimensions | x 9.70…287.10, y 9.70…200.10 | **yes** |
| golden + dimensions @ 0.5 | x 9.70…287.10, y 9.70…200.10 | **yes** |
| 120×80 plate + dimensions | x 9.70…**297.00**, y **0.00**…200.10 | **NO — off the sheet edge on two sides** |

The plate's dimension block measures x 76.50…**334.21** against a frame ending at 287. The part
geometry alone fits; the dimensions do not. An implementation that keeps `_extent(frag)` and
appends dimension SVG will pass every "did it produce bytes" check and silently ship drawings
with dimensions running off the paper. Feeding `_dimension_view`'s extent into the existing
scale-stepping loop is what fixes it, and a plate-shaped fixture is what tests it — the golden
60×40 case does **not** catch this.

### Still to verify, not done here

- **Browser, not just Node.** Every Part 2 number came from the Docker/Node kernel. The
  browser artifacts already have TechDraw compiled in and `LineGroup.csv` in the data pack
  (`SPEC-techdraw-export.md`'s resolved prerequisite), and `getVisibleEdges()`/`getEdgeByIndex`
  are statically linked C++ with no resource dependency — but that is an inference, not a
  measurement. Run the dimensioned golden case in a real tab before believing it.
- **`svgToPdf()` in a browser tab.** It uses only `TextEncoder`/`TextDecoder`/`Math`, so there
  is no reason for it to differ, but the download path (`Blob` + `application/pdf`) has not
  been clicked in the real Studio UI.
- **Opening the PDFs in Acrobat / Chrome's viewer / macOS Preview.** `pdfinfo`, `pypdf` and
  `pdftoppm` all accept them, which is three independent implementations, but not the ones
  users will use.
- **A pre-existing warning, unrelated to this work but visible in these runs:**
  `Warning - DPG (ReshapeGroup/ReshapeGroup) may be corrupt - Anchor deleted`, emitted during
  the shipped `exportDrawing()`'s own cleanup. It does not affect the output (the composed SVG
  is correct and complete), and it predates this spec — worth a look, not a blocker.
