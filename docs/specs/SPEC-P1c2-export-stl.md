# SPEC P1c-2 — Export STL

Closes the one item `SPEC-P1-parity-closeout.md` §P1c left conditional:

> **Export STL** (session.exec of Mesh.exportToSTL or the FreeCAD Mesh module
> equivalent — lead confirms the wasm build's export surface; **if Mesh is not
> bound, Export STL is cut from P1c**).

Mesh **is** bound and the rule fired correctly: `import Mesh` succeeds but the
module is HOLLOW — `dir(Mesh)` has zero names matching `export` or `write`, so
`Mesh.export` does not exist. Export STL was rightly cut on that route.

**It is unblocked on a different one.** Probed in `fc-kernel-pd-final`:
`Part.makeBox(10,10,10).exportStl('/tmp/probe.stl')` returned rc=0 and wrote
**3052 bytes**. A `Part::TopoShape` carries its own `.exportStl()`, no Mesh
module involved.

---

## 0. What was measured, so nobody re-derives it

Read out of the vendored source, not guessed:

| Fact | Where |
|---|---|
| `Shape.exportStl(filename, deflection=0.01)` | `TopoShapePyImp.cpp:647-651`, `PyArg_ParseTuple(args, "et\|d", ...)` — filename required, deflection optional |
| Deflection is **absolute**, not relative | `TopoShape.cpp:1002-1013` — `BRepMesh_IncrementalMesh(shape, deflection, isRelative=Standard_False, ...)` |
| Output is **ASCII** STL, not binary | `StlAPI_Writer` default. Confirmed by arithmetic: a box is 12 triangles; binary would be `84 + 12*50 = 684` bytes, and the probe wrote **3052** |
| `Mesh.export` does not exist in this build | `dir(Mesh)` probe, zero `export`/`write` names |

Do not "fix" the ASCII output into binary. It is what OCCT's writer emits by
default, every slicer reads it, and the size is the only cost.

## 1. `engine/bridge/fc-session.mjs` — the emitter + the read-back

The read-back is the real work, and it already has an **exact precedent** in
this same file: `saveDocument` (`:193-200`) runs `doc.saveAs(path)` and then
returns `Module.FS.readFile(path)`. Export STL is the same shape with a
different write call, so put it in the **core**, directly beneath
`saveDocument` — not in `fc-commands.mjs`. The core is where FS access lives
(its own closing comment says the typed PartDesign/Sketcher commands live
elsewhere precisely so this stays the one place that touches `Module.FS`).

```js
// Export one object's solid to an ASCII STL and return its bytes
// (Uint8Array) for download. Same portable channel as saveDocument: the
// kernel writes into the engine FS (MEMFS in the browser, the host mount
// under NODERAWFS) and JS reads the file back out.
//
// Deflection is an ABSOLUTE chord tolerance in mm (TopoShape.cpp:1002 passes
// isRelative=false), so 0.01 means 0.01mm regardless of model size -- fine
// for a 10mm part, slow and enormous for a 1000mm one. It is a parameter
// rather than a constant for that reason, but nothing in the UI passes it
// yet; the default matches TopoShapePyImp.cpp's own.
function exportStl(objectName, stlPath = '/tmp/model.stl', deflection = 0.01) {
  const { rc, out } = exec(
    `import FreeCAD as App\n` +
    `_o = App.ActiveDocument.getObject(${JSON.stringify(objectName)})\n` +
    `if _o is None: raise ValueError('no such object: ' + ${JSON.stringify(objectName)})\n` +
    `_o.Shape.exportStl(${JSON.stringify(stlPath)}, ${Number(deflection)})\n`
  );
  if (rc !== 0) throw new Error(`exportStl failed:\n${out}`);
  return Module.FS.readFile(stlPath);
}
```

Add `exportStl` to the returned object beside `saveDocument` / `openDocument`.

**Two things the guard above is doing on purpose.** `getObject` returns `None`
rather than raising for a bad name, so without the explicit check the failure
surfaces as `AttributeError: 'NoneType' object has no attribute 'Shape'` —
true but useless. And `Number(deflection)` is interpolated rather than
`JSON.stringify`'d because a NaN would otherwise emit the literal `null` into
the Python source, which parses and then means something else entirely.

## 2. `engine/play/studio.html` — the button

The File group is at `:347-349` and currently holds two buttons. Add a third,
matching them exactly (`class="btn"`, `disabled`):

```html
<button id="exportStl" class="btn" disabled title="Export STL — download the current solid as an STL mesh">Export STL</button>
```

## 3. `engine/play/studio.js` — the handler and the gate on it

### 3.1 The handler

Clone the `save` handler at `:706-715`. Same Blob → object URL → `a.click()`
→ `revokeObjectURL` sequence; only the source call, the MIME type and the
filename change:

```js
// Export the current tip solid to STL and hand it to the browser download.
// Mirrors the Save .FCStd handler above -- same bytes-to-Blob channel, since
// the wasm FS is not reachable from the page any other way.
on('exportStl', 'click', guard(() => {
  if (!state.tip) return log('make a feature first (Pad, Prism, …)');
  const bytes = session.exportStl(state.tip);
  const blob = new Blob([bytes], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.tip}.stl`;
  a.click();
  URL.revokeObjectURL(a.href);
  log(`exported ${state.tip}.stl (${bytes.length} bytes)`);
}));
```

### 3.2 Enabling it — NOT in `setButtons`

`setButtons` (`:269-275`) flips a fixed list on when the session is ready.
`save` is in it because saving an empty document is meaningless but legal.
**Export STL is different: there is nothing to export until a solid exists**,
so it belongs with the tip-dependent buttons in `updateSweepButtons`
(`:694-703`), which `render()` re-runs on every tree change:

```js
  const stl = $('exportStl');
  if (stl) stl.disabled = !(session && state.tip);
```

Leave `exportStl` OUT of the `setButtons` list. Adding it to both means
`setButtons(true)` enables it on session start, before any solid exists, and
the first `render()` disables it again — a button that flickers on and then
off reads as a bug even though the end state is right.

## 4. What you must NOT touch

- **`engine/bridge/p1c2-test.mjs`** — the kernel gate. Lead-owned, written
  separately, deliberately not yours: a builder that can edit its own gate
  eventually will.
- Anything in `packages/`. This slice is bridge + studio only.
- The `save` / `open` handlers. Clone them; do not refactor them into a shared
  helper. Two eight-line handlers that read straight through beat one
  parameterised one, and the third caller does not exist.

## 5. Done means

1. `npm run build --workspaces` — green.
2. `npm test --workspaces` — 32/32, unchanged (this slice adds no unit tests;
   it is an FS + DOM path, and the gate in §4 plus the browser dogfood are
   what actually cover it).
3. Report what you could NOT check. You cannot run the kernel container and
   you cannot run a browser — say so rather than implying coverage.
4. Reply on the message center with `--re last`, and give me **one unpinned
   design decision** you had to make. That is where this spec's gaps show up.

If any path in this spec does not resolve, STOP and say so rather than
guessing a filename.

---

# Review + gate findings — closed

Built by the cheap builder against §1-§3 verbatim; the diff matched the spec
line for line. Everything below was found by the two gates AFTER that, which
is the point of having them.

## 6. Three defects the gates caught

### 6.1 The button never enabled (spec §3.2 was right, and not enough)

`#exportStl` stayed greyed out after the most ordinary path there is —
Rect Sketch → Pad. §3.2 put the enable rule in `updateSweepButtons`, which is
correct, and then assumed that function ran. It does not: `render()` is its
only caller, and **none of the five handlers that assign `state.tip` calls
`render()`** — pad, pocket, revolve, fillet, chamfer all call
`updatePocketButton()` / `updateRevolveButton()` and stop there.

So the feature shipped with a solid on screen and the button that ships it
greyed out. Fixed by adding `updateSweepButtons()` beside the existing calls
at all five sites. That also repairs **Linear Pattern and Polar Pattern**,
which were stale in exactly the same way and had been since P1c — the same
call, so it is not separable scope.

### 6.2 A failed export could hand back the PREVIOUS export's bytes

`Module.FS.readFile(stlPath)` reads whatever is at that path. An export that
writes nothing therefore returns the last successful export's file, and the
user downloads the wrong model under the right name — no error, no symptom,
correct-looking output. Fixed by unlinking the target before running, so
"the file exists afterwards" is real proof. Gate slice 5 exercises exactly
this: export a solid, then export a wire to the same path, and require a
throw rather than 3052 stale bytes.

### 6.3 A failed export crashed the handler and showed the user NOTHING

`Module.FS.readFile` throws an Emscripten `ErrnoError`, which carries no
`.message`. `studio.js`'s `guard()` does `e.message.split('\n')[0]`, so the
error escaped as an uncaught `TypeError: Cannot read properties of undefined
(reading 'split')` — no log line, no download, no visible failure at all.
Measured in the browser. Fixed in the emitter: the read-back is wrapped and
the failure becomes a real `Error` that says what to do
(*"Only a solid has faces to mesh … Pad it into a solid first."*).

`saveDocument` has the same exposure and never trips it, because
`doc.saveAs()` always writes a file. Export STL is the first caller that can
legitimately produce nothing, which is why the hole surfaced here.

## 7. Measured facts worth not re-deriving

- **OCCT may reuse a triangulation already attached to the shape, and whether
  it does is NOT deterministic.** Re-exporting one shape at a coarser
  deflection can hand back the finer mesh it already has. Measured three
  times: a PartDesign sphere gave **26718 facets at both 0.01 and 1.0** on one
  shape versus 26718 and 8002 on two fresh spheres; then a padded cylinder
  gave **912 then 500** on one run and **912 then 912** on the next, with
  nothing changed in between.

  An earlier draft of this section stated the reuse as a flat rule
  ("`BRepMesh_IncrementalMesh` skips re-meshing when what is attached is
  finer"). The cylinder contradicts it, and no explanation here covers both
  observations — so the honest statement is *sometimes*, and the gate must not
  depend on which way it lands. Slice 2 therefore builds **two fresh solids**,
  which have no triangulation to reuse; it then reports 912 vs 500 on every
  run. A same-shape comparison is a coin flip whose failure mode is a **false
  alarm** — it accuses the emitter of dropping an argument that is fine.
- **Python error text does reach the browser, and does not reach Node.** On
  the NODERAWFS node kernel Python's fd 1 bypasses `Module.print`, so the
  guard's `ValueError` never reaches JS and the thrown message is the bare
  `exportStl failed:` (gate slice 4 says so in place of asserting the text).
  In the browser it is captured: a deliberate radius-0 prism put
  `Prism: Circumradius of the polygon, of the prism, is too small` straight
  into the status log.
- **A cuboid is exactly 12 facets, 3052 bytes ASCII.** Both gates assert it
  and they agree, which is what makes the browser number trustworthy.

## 8. Recorded, deliberately NOT fixed here

- **`state.tip` can be a datum plane.** After a bare Rect Sketch the tip is
  `YZ_Plane` — `render()` assigns it from `meshFaces()`, which hands back
  whatever it can mesh. So Export STL (and both pattern buttons) are clickable
  with no solid in the document. Tightening `state.tip` reaches pocket,
  revolve, fillet, chamfer and the patterns, which is a slice of its own; §6.3
  makes the failure legible in the meantime.
- **`linPatBtn` / `polPatBtn` flicker on at session start.** They are in
  `setButtons`'s list *and* in `updateSweepButtons`, so they enable on session
  ready and disable on the first `render()`. `exportStl` was deliberately kept
  out of that list (§3.2) and measurably does not flicker. Fixing theirs means
  editing the list, which is theirs to own.
- **A radius-0 prism logs `+ prism r0 h30` after its own error.** Pre-existing,
  unrelated to this slice, noticed while probing the error channel.
