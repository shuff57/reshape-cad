# packages/sketch

## OVERVIEW
2D sketch package: least-squares constraint solver, bulge arcs, outline derivation, and label layout. Pure TypeScript math, zero runtime deps, no browser APIs.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Constraint kinds / solving | src/sketch-solve.ts | `Constraint` union, `solveSketch()`, `residualsOf()`, `losingEdges()` |
| Adding a rule safely | src/sketch-solve.ts | `addConstraintSettling()` + `seedForNewRule()`; settling may drop older rules (`ConflictResolution`) |
| User-facing rule text | src/sketch-solve.ts | `describe()`, `describeRemovalNote()`: plain sentences for a beginner audience |
| Arcs from bulge | src/sketch-arc.ts | `arcFromBulge()`; center-side sign flips when `\|bulge\| > 1` (major arc) |
| Outline / tessellation | src/sketch-arc.ts | `tessellate()`, `outlineOf()`; `Outline.basis` maps each point back to a design corner |
| Fillet/chamfer/bow edits | src/sketch-arc.ts | `filletCorner()`, `chamferCorner()`, `bowEdge()`; each has `max*()` + `whyCannot*()` guards |
| Structural edits | src/sketch-arc.ts | `splitEdge()`, `reindex()`, `removeCorner()` remap points and constraints together |
| Labels for the overlay | src/sketch-outline.ts | `sketchLabels()`, `layoutLabels()` (label boxes vs obstacles) |
| Linear algebra | src/least-squares.ts | `leastSquares()`, `solveLinear()`: dense Gaussian elimination |
| Tests | test/sketch-solve.test.mjs | P1d solver additions + corner remap machinery |

## CONVENTIONS
- Zero dependencies, zero DOM. Everything reduces to plain arithmetic so the suite needs no browser.
- Indexing is 0-based here. The script API in `packages/script` exposes 1-based corner/edge numbers and converts at the boundary.
- Signed values are meaningful: negative `distanceY`, negative bulge bows inward. Never take abs() at the solver level.
- Corner-indexed rules (`lock`, `distanceX/Y`, `symmetric`) vs edge-indexed: gate with `indexesCorners()`, don't assume `'other' in c`.
- Consumers import subpaths only (`@shuff57/reshape-sketch/sketch-arc`). The bare `.` barrel namespaces `sketchArc` because `Point` is exported twice.
- `Point` is duplicated identically in sketch-solve and sketch-arc on purpose; keep the two definitions identical.

## ANTI-PATTERNS
- Never infer a circle from point count. `circleOf()` reads the `shape` tag only; a shapeless sketch is null, never guessed at.
- Never write derived outline `points`/`basis` back into a doc. Design corners are the source of truth; the outline is recomputed on every read.
- Don't simplify the `arcFromBulge` center-side sign. The `\|bulge\| > 1` flip is what keeps a major arc's center on the correct side of its chord.
- Don't add a constraint by pushing onto the array. Route through `addConstraintSettling()` so conflicts settle with an undo note instead of fighting the solver.
- Refusals are sentences, not clamps. When an edit can't be honored, return the `whyCannot*()` text; never silently shrink the radius, bow, or distance.