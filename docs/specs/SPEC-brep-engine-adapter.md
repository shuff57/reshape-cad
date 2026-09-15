# SPEC — BrepRsEngineAdapter (connect step 2, 2026-09-15; after the mesh gate passes)

If any path in this spec does not exist, STOP and say so rather than guessing.

## WORK STYLE — read first

NEVER reason for more than a few paragraphs in one message. Make your first code edit
within 6 tool calls. Ignore any older message-center messages: this dispatch is the
adapter only.

## Goal

Add a third `EngineAdapter` backed by brep-rs, so the studio viewport can build, draw
and pick models with the Rust kernel when the engine mode is `'brep-rs'`. OCCT and
FreeCAD keep working exactly as they do now, and the default mode stays `'freecad'`.

## The seam (read these, all short)

- `packages/kernel/src/engine-adapter.ts`: the `EngineAdapter` interface (11 methods).
- `packages/kernel/src/occt-engine-adapter.ts` (214 lines): the template. Copy its
  structure, doc-comment discipline, `THREE` constructor injection and
  `dynamicImportKernel` loader pattern.
- `packages/kernel/src/config.ts`: `getEngineMode`/`setEngineMode`, today typed
  `'occt' | 'freecad'`.
- `packages/studio/src/model/BrepViewportThree.tsx`: `loadEngine()` near line 355
  picks the adapter by mode, `enginePromiseMode` is typed by mode, and `onEngine`
  reports the kind. Read the build effect's OCCT fallback. brep-rs mode should use the
  SAME fallback when brep-rs refuses a feature, exactly as freecad mode does.
- `packages/sandbox-dev/vite.config.ts`: serves `/reshape/kernel/` from
  `RESHAPE_KERNEL_DIR`, and reads `VITE_RESHAPE_ENGINE` at startup.

## What to build

1. **wasm exports** in `packages/brep-rs/src/wasm.rs`. Add exports beside the existing
   `version`, `measure_doc`, `resolve` and `mesh_feature` (from step 1):
   - `build_doc_json(doc_json) -> String`: `{"built":[feature ids], "refusals":{id: reason}}`.
   - `face_size(doc_json, feature_id, face_index) -> String`: `[w,h]` (smallest first, rounded to
     0.01) for a planar axis-aligned face, else `null`. Same rule as
     `OcctEngineAdapter.faceSize`.
   - `edge_length(doc_json, feature_id, edge_index) -> String`: the true curve length,
     rounded to 0.01, or `null`.
   - Extend `resolve()`'s JSON to include `"faceIndex"` or `"edgeIndex"` (the index in
     `faces()`/`edges()` order) and `"feature"` when a name resolves. Keep existing
     fields, since the parity gate reads them.
   - `name_face(doc_json, feature_id, face_index) -> String`: a TopoName JSON for a face of
     a primitive (box ±x/±y/±z, the same `part` strings `resolve_primitive_face` accepts)
     or an extrude cap/side the sweep history records, else `null`. `name_edge` returns
     `null` in this slice.
   - Keep a single-entry thread_local cache of the last built doc (keyed by the doc JSON
     string), so repeated calls on the same doc don't rebuild.
2. **`packages/kernel/src/brep-rs-engine-adapter.ts`**: `class BrepRsEngineAdapter implements EngineAdapter`.
   - `load()`: dynamically import `${getKernelBaseUrl()}/brep-rs/brep_rs.js` and call its
     default init with `${getKernelBaseUrl()}/brep-rs/brep_rs_bg.wasm`.
   - Shape handles are plain objects the adapter owns: `{ doc: string, feature: string }`.
     Face and edge handles are `{ doc, feature, index }`. `build()` returns
     `{ shapes: Map(id -> handle) for every built id, refusals: Map }`.
   - `mesh()`: `JSON.parse(mesh_feature(...))` into a `THREE.BufferGeometry` with a
     `position` attribute (Float32Array), an index, `computeVertexNormals()`, and
     `faces` as `FaceRange[]` (also `addGroup` per face).
   - `edges()`: one `BufferGeometry` of line segments per polyline, paired with an edge
     handle. `faceAt()` checks the index against the mesh's face count.
   - `resolveFace`/`resolveEdge`: through `resolve()`, returning a face/edge handle or
     null. `nameFace`: `name_face`. `nameEdge`: null. `faceSize`/`edgeLength`: through the
     exports.
   - `saveDocument`/`openDocument`/`exportDrawing`: throw
     `'not supported on the brep-rs engine: ...'`, the same message family as OCCT.
3. **`config.ts`**: widen the mode type to `'occt' | 'freecad' | 'brep-rs'` everywhere it
   appears (grep for `'occt' | 'freecad'` across packages/kernel and packages/studio).
4. **`BrepViewportThree.tsx`**: `loadEngine()` constructs `BrepRsEngineAdapter` for
   `'brep-rs'`. The build-effect fallback to OCCT applies to brep-rs refusals too. Change
   nothing else.
5. **`packages/kernel/package.json`**: add `"./brep-rs-engine-adapter"` to `exports`.
6. **`packages/sandbox-dev/vite.config.ts`**: serve `/reshape/kernel/brep-rs/*` from
   `packages/brep-rs/pkg` (resolve relative to the repo), next to the existing kernel
   middleware, with the correct `application/wasm` content type. `VITE_RESHAPE_ENGINE=brep-rs`
   must select the new mode.

## Test (lead runs these)

Add `packages/kernel/test/brep-rs-engine-adapter.test.mjs`, in the same style as the
other `*.test.mjs` files in that folder (`node --test`). Load `packages/brep-rs/pkg`
via `initSync` in node instead of `load()`: add a small `loadFromBytes(bytes)` method on
the adapter for that, used only by tests. Import `three` from the repo's node_modules.
Assert:
- box 40x40x20: `build` has it, `mesh` gives 6 face ranges and a non-empty position
  attribute, `faceAt(shape,0)` is non-null and `faceAt(shape,6)` is null, `edges` gives
  12, `edgeLength` of an edge is 40, 40 or 20 as appropriate, and `faceSize` of the +z
  face is [40,40].
- `resolveFace({cause:'primitive',feature:'b1',kind:'face',part:'+z'})` resolves, and
  `nameFace` on that handle round-trips to the same name.
- A fillet fixture doc (round-one-edge) meshes with 7 face ranges.
- A refused feature shows up in `refusals`.

## Constraints

1. Do NOT edit `scripts/brep-*.mjs`. `node scripts/brep-parity-gate.mjs` stays 58/0, and
   `node scripts/brep-mesh-gate.mjs` stays all-pass.
2. `npm run build` at the repo root must pass (typecheck across kernel and studio).
   `npm test -w @shuff57/reshape-kernel` must pass, including the new test.
3. The default engine mode stays `'freecad'`. OCCT and FreeCAD behaviour is unchanged.
4. Don't copy OCCT or topo-resolve logic into TypeScript: the adapter is a thin forward
   to wasm exports.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cargo test --release && cd ../..
npm run build
npm test -w @shuff57/reshape-kernel
node scripts/brep-parity-gate.mjs
node scripts/brep-mesh-gate.mjs
```

## Report (one message)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first. Include: the build and test results (with counts), the parity gate and
mesh gate tallies, files changed, spend written as USD with no dollar sign, ONE design
decision this spec did not pin down, and the checks you could NOT perform. You have no
image input and did not run the studio in a browser, so say so.
