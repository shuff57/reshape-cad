# packages/script

## OVERVIEW
reSHape Script interpreter, ModelDoc types, and the emitter that turns a doc back into source (round-trip).

## STRUCTURE
```
src/
├── reshape-script.ts      # Interpreter: runScript(), VOCABULARY, error line mapping
├── reshape-script-gen.ts  # toScript(): doc -> script source (round-trip)
├── model-types.ts         # ModelDoc, Feature union, new* constructors, dependsOn()
├── model-codegen.ts       # solveDoc(), generatedParams(), param slots
├── model-deps.ts          # Cascade delete: what removing a feature costs
├── model-handles.ts       # Drag-handle world positions (arithmetic, no picking)
├── model-selection.ts     # Viewport pick -> feature id
├── model-check.ts         # Lesson grading: student doc vs expected shapes
├── topo-name.ts           # Persistent face/edge names as history paths
├── topo-history.ts        # Per-operation face outcomes (kept/replaced/split/deleted)
├── hull.ts                # Own convex hull; no kernel ships one
├── script-surface.ts      # Which documented names survive a kernel swap
├── reshape-docs.ts        # In-app reference pages, every example runnable
└── docs-core.ts           # Shared docs types + search
test/                      # node --test *.test.mjs
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add or rename a script word | reshape-script.ts: VOCABULARY + the fns table (tsc enforces 1:1) |
| New feature kind | model-types.ts Feature union + new* ctor, then an emitter arm in reshape-script-gen.ts |
| Param/slider slots | model-codegen.ts pname() and generatedParams() |
| Face naming across booleans | topo-name.ts (algebra) + topo-history.ts (OCCT queries, referee-only) |
| Docs copy | reshape-docs.ts; coverage rule: every DSL call in at least two examples |

## CONVENTIONS
- The interpreter only builds a ModelDoc. No kernel calls, no geometry, no drawing; the kernel adapter consumes the doc.
- A script and the equivalent clicks must produce byte-comparable docs: always go through the same new* constructors and nextId().
- Error line numbers come from new Function + //# sourceURL. LINE_OFFSET is measured against this exact construction; re-measure if the wrapper changes.
- Subpath exports only, per package.json; index.ts re-exports the full surface.

## ANTI-PATTERNS
- VOCABULARY and the fns table are keyed 1:1 by tsc; docs and studio read the same list. Adding a word means touching all of them or the slice is rejected.
- reshape-script.ts evaluates only inside the sandboxed iframe (opaque origin, no same-origin fetch). Never import it into the main app origin.
- Never emit ordinal face names like split[..., 0]. A split piece is named by a geometric discriminator in the parent face's parameter space; ordinals break on rebuild.
- Never give an alias its own implementation. box(...) and cuboid(...) must emit identical commands.
- Do not weaken solveDoc()'s collapse gates (outlineOf + collapsedByRatio). The sketch solver satisfies rules by collapsing edges, so residual 0 lies.
- toScript() reads param values from generatedParams(doc), never namedParams[i].value. A slider drag makes the latter stale.