# Architecture: reshape-cad Part Design (a rebuild of FreeCAD's core parametric loop)

Written 2026-10-09 from `recon.md`, `features.csv`, the 15 screenshots in `screens/`, `AGENTS.md`,
`packages/brep-rs/AGENTS.md`, `docs/specs/SPEC-brep-kernel-rs.md`, `docs/specs/PLAN-kernel-next-2026-10-05.md`
and `docs/kernel-campaign.md`. Planning only: nothing here is built, and nothing in this document edits a repo file
outside `docs/replica/freecad/`.

Scope is the recon's slice: Sketcher -> Part Design features -> feature tree / recompute -> expressions and a
parameter sheet -> STEP / STL -> 3D view and selection. One body per document. FreeCAD's other workbenches are out.

## 0. The one decision this document exists to make: the app shell

The user said "building it in Rust". The recon found the app is TypeScript + React (`packages/studio`, 33,759 lines of
TS across studio, script, sketch and kernel) over two Rust pieces: the B-rep kernel (`packages/brep-rs`, about 56,000
lines) and the 2D constraint solver inside it (`brep-rs/src/sketch/`, about 8,000 lines). Three shells were on the table.

| | (a) native Rust desktop (egui / iced / Slint + wgpu) | (b) Rust UI compiled to wasm (egui-web, Dioxus, Leptos) | (c) Rust core crates under the existing TS studio, plus a Tauri desktop wrapper |
| --- | --- | --- | --- |
| How much is Rust | everything | everything | everything FreeCAD calls `App::` (document, expressions, sketch solver, recompute, features, persistence, export) and the kernel; the `Gui::` layer stays TypeScript |
| Reuses the studio (viewport, sketch canvas, picking, timeline, 3MF/STL writers) | no: rewritten | no: rewritten | yes, extended with the FreeCAD-shaped panels |
| Keeps the browser deployment that is the reason brep-rs exists (SPEC §1: smaller than OCCT so it serves from Cloudflare Pages) | no | yes, but with a canvas-painted UI (egui) or an immature DOM framework for CAD-grade widgets | yes |
| Desktop app with native file dialogs and menus | yes | no | yes, through Tauri (Rust runs natively, no wasm hop) |
| Where the effort goes | 3 to 6 months of UI before any kernel gap closes | same, plus browser UI quality problems | straight at the 18 partial and 6 absent/refused must rows, which the recon says is where almost all the risk is |
| Language boundary | none | none | one JSON seam, which is already the repo's convention (`wasm.rs`: "JSON in, JSON out") |
| Risk to the gates and the referee apparatus | high (new consumers of the kernel) | high | none: `brep-rs/pkg` and the four gates are untouched |

**Recommendation: (c).** The Rust-first core is real (section 3 lays out the crates), both shells call the same crate, and
the kernel work list (section 9 and `build-order.md`) gets the hours. The runner-up is (a), and it wins only if the
goal is a single-language codebase for its own sake and the user is willing to give up the browser and the studio
to get it. (b) is the worst of both: it rewrites the UI and still ships a worse browser app.

What (c) does with each existing package:

| package | fate |
| --- | --- |
| `packages/brep-rs` | The kernel, unchanged location and exports. Becomes a Cargo workspace member and an `rlib` dependency of the core (its `Cargo.toml` already declares `crate-type = ["cdylib", "rlib"]`). Its own `pkg/` wasm keeps being built for the gates. `build.rs` is being edited by another agent and nothing here plans a change to it. |
| `packages/script` | Split. `model-types.ts` (the `ModelDoc` contract), `model-codegen.ts` (`solveDoc`), `model-deps.ts`, `model-check.ts`, `model-handles.ts`, `topo-name.ts` move to Rust (`reshape-doc`, `reshape-recompute`); their TS types are then generated from the Rust types so the two cannot drift. `reshape-script.ts` (the interpreter) and `reshape-script-gen.ts` (`toScript`) stay TypeScript and keep producing `ModelDoc`, under the existing rule that evaluation happens only in the sandboxed iframe. `topo-history.ts` stays: it is referee apparatus. |
| `packages/sketch` | Retired in two steps. The TS least-squares solver is a second solver beside the Rust one in `brep-rs/src/sketch`, which the studio already drives through `packages/kernel/src/sketch-session.ts`; two solvers is the sketch-level version of the "two engines" anti-pattern. `tessellate()` and the outline/slot helpers stay until a `sketch_outline` export replaces them (M3). |
| `packages/kernel` | `engine-adapter.ts` keeps its shape; `brep-rs-engine-adapter.ts` becomes a thin client of the core's wasm exports instead of calling the kernel per feature. `occt-build.ts`, `occt-mesh.ts`, `topo-resolve.ts` and `config.ts` are untouched (referee; the `getEngineMode()` pin). |
| `packages/studio` | Kept and extended: model tree with Body / Origin / Tip, task panels, property editor, parameter sheet grid, dependency graph, recompute badges. The viewport (`BrepViewportThree`), picking (`FaceRange`), sketch canvas and the mesh writers are reused as they are. |
| `packages/sandbox-dev` | Stays the browser harness. A new `apps/desktop` (Tauri) mounts the same studio bundle. |

## 1. Stack

Local-first tool. There is no server, no auth, no payments and no email in this slice; the skill's defaults for
those layers do not apply and are listed as "none" on purpose.

| layer | choice | why |
| --- | --- | --- |
| core | a Cargo workspace of Rust crates (section 3) | one language for the document, expressions, solver, recompute, features and files; unit-testable with `cargo test`; identical code in the browser and on the desktop |
| kernel | `brep-rs`, as a path dependency | the one kernel; no fallback; refusals are plain sentences per feature |
| expressions | `reshape-expr`, an own unit-aware expression language | FreeCAD-compatible grammar subset (`Params.width * 2`, `10 mm + 1 in`, `cos(30 deg)`); no JavaScript engine in the core; cycles and unit mismatches are errors, as observed in the recon |
| scripting | reSHape Script, TypeScript, sandboxed iframe | unchanged; it is a second producer of `ModelDoc`, not the document model |
| browser shell | the existing React 19 + three.js studio, Vite, core via `wasm-bindgen` | reuse; students; Cloudflare Pages |
| desktop shell | Tauri 2 around the same studio bundle; commands call the core natively | native open/save/export dialogs, menus, file associations; `rusqlite` works natively |
| document file | `.reshape`: a zip holding `document.json` (canonical key order) and optional cached meshes | diffable, pure Rust in wasm (SQLite's C source is ruled out by SPEC §2 "no C/C++ dependencies"), FCStd-like container shape without FCStd's contents |
| app-local store | SQLite via `rusqlite` (desktop); IndexedDB with the same logical tables (browser) | recent files, preferences, autosave snapshots, the per-feature build cache, the hole-standard tables; see `schema.sql` |
| export | STEP and STL through brep-rs; 3MF and OBJ already in `studio/mesh-export.ts` | |
| tests | `cargo test` per crate; the kernel suite; the four lead-owned gates run on demand and are not edited | |
| hosting | Cloudflare Pages for the browser build; GitHub Releases for desktop installers | zero servers |
| auth / payments / email / jobs | none | out of scope for a local tool |

## 2. The core idea: Document lowers to ModelDoc

`ModelDoc` (`{ version: 1, features: [...] }`) is the kernel's input contract, pinned by the gates and by
`build_doc_json`. It is concrete: every number is a number, every feature names its target by id, and there is no
expression, no body, no tip, no property grid.

The FreeCAD-shaped document (bodies, origin, properties, expressions, a parameter sheet, suppressed features, a tip)
is a **superset that lowers to a ModelDoc**:

```
Document  --evaluate expressions (reshape-expr)-->  concrete values
          --walk Body.features up to Tip, skip Suppressed-->  ModelDoc (kernel kinds)
          --brep-rs build_doc-->  shapes + refusals
```

This is the move that keeps every existing gate, fixture, census script and the reSHape Script interpreter working
unchanged while the app grows a property model above them. Lowering has its own refusals (a Pad "Symmetric" lowers to
nothing today, and says so in a sentence beside what did build) and they share one type with the kernel's: a feature
is either built, or refused with a sentence. Never a different solid.

## 3. Crate layout

```
Cargo.toml                       workspace: members = ["packages/brep-rs", "crates/*", "apps/desktop/src-tauri"]
crates/
  reshape-doc/        the document model: Document, Body, Origin, Object, Feature kinds, Sketch rows, Sheet cells,
                      Attachment, TopoName; serde; schema version 2; lower() to ModelDoc; JSON Schema + TS types
                      generated at build time (schemars + ts-rs) so packages/script and the studio import, not retype
  reshape-expr/       lexer, parser, evaluator; Quantity = f64 + unit dimensions; references by object name and
                      property path, and Sheet.alias; cycle detection; error values that print as sentences
  reshape-sketch/     the 2D solver. Step 1: a facade over brep_rs::sketch (session open / solve / diagnose /
                      profile). Step 2 (M3): the module moves here and brep-rs depends on it; wasm exports keep
                      their names
  reshape-recompute/  the dependency graph (feature chain, profile and support links, TopoName chains, expression
                      references); topological order; states UpToDate / Touched / Invalid / Stale; per-feature
                      input hashes for the mesh cache
  reshape-features/   Part Design semantics on top of the kernel: one module per feature kind; each produces the
                      kernel kinds it lowers to, or a refusal; TopoName resolve/name against build history
  reshape-io/         .reshape read/write (zip + canonical JSON), migration from ModelDoc v1 and from script text,
                      STEP / STL / 3MF export, autosave snapshots
  reshape-core/       the facade the shells call: Session { open, new, transactions, undo/redo, edit commands,
                      recompute, mesh, pick, measure, export }. One API, serde types in and out
  reshape-wasm/       wasm-bindgen over reshape-core, JSON strings in and out (the brep-rs convention); statically
                      links brep-rs so the browser ships ONE wasm; re-exports the kernel's gate-contract names
apps/
  desktop/            Tauri 2: src-tauri with #[tauri::command] wrappers over reshape-core; the web side is the
                      studio bundle from packages/sandbox-dev's build
packages/
  brep-rs/            the kernel, where it is
  studio/, script/, kernel/, sandbox-dev/   as in section 0
```

Dependency direction, strictly downward: `wasm`/`desktop` -> `core` -> `features`, `io`, `recompute` -> `doc`,
`expr`, `sketch` -> `brep-rs`. `doc` does not depend on the kernel; `features` is the only crate that calls it.

Why not fold the core into `brep-rs`: the kernel's `AGENTS.md` sizes the wasm against OCCT (gzipped under
7,250,252 bytes; measured today 563,484 bytes gzipped, 1,502,764 raw) and forbids a `package.json` at its root; keeping
the app layers in separate crates keeps the kernel's size, test time and gate surface what they are.

## 4. Document model (Rust, the real schema)

Observed in the recon from `Document.xml`, `PropertiesList` and the Python API; written here as the Rust types the
app will own. Property names follow FreeCAD's where the recon recorded them, so a FreeCAD user's muscle memory
carries, but the types are ours.

```rust
pub struct Document {
    pub schema: u32,                 // 2; ModelDoc is 1 and migrates in
    pub id: Uuid,
    pub label: String,
    pub units: UnitSystem,           // Metric (mm, kg, s, deg) first; Imperial decimal later
    pub objects: Vec<Object>,        // ordered, append-only ids; deletion tombstones for undo
}

pub struct Object {
    pub id: ObjectId,                // u32, unique for the document's life; the stable name is "Pad003"-style
    pub name: String,                // unique, stable, never shown as the label
    pub label: String,               // user-facing, editable
    pub visible: bool,
    pub kind: ObjectKind,
    pub bindings: Vec<Binding>,      // ExpressionEngine: property path -> expression source
}

pub enum ObjectKind {
    Body(Body), Origin(Origin), Sketch(Sketch), Datum(Datum), Feature(Feature), Sheet(Sheet), VarSet(VarSet),
}

pub struct Body { pub origin: ObjectId, pub features: Vec<ObjectId>, pub tip: Option<ObjectId> }
pub struct Origin { pub axes: [ObjectId; 3], pub planes: [ObjectId; 3], pub point: ObjectId }

pub struct Feature {
    pub base: Option<ObjectId>,      // BaseFeature: the previous feature in the body's chain
    pub suppressed: bool,
    pub refine: bool,
    pub op: FeatureOp,
}

pub enum FeatureOp {
    Pad { profile: ProfileRef, side: SideType, kind: LengthType, length: Q, length2: Q, offset: Q, taper: Q,
          reversed: bool, direction: Direction },
    Pocket { /* same fields; kind adds ThroughAll */ },
    Revolution { profile: ProfileRef, axis: AxisRef, angle: Q, angle2: Q, kind: AngleType },
    Groove { /* as Revolution */ },
    Fillet { edges: Vec<TopoName>, radius: Q, use_all_edges: bool },
    Chamfer { edges: Vec<TopoName>, mode: ChamferMode, size: Q, size2: Q, angle: Q, flip: bool },
    Hole { profile: ProfileRef, diameter: Q, depth: Q, depth_kind: DepthType, head: HoleHead, drill: DrillPoint,
           standard: Option<HoleStandard>, thread: Thread, tapered: Option<Q> },
    LinearPattern { originals: Vec<ObjectId>, dir: [DirRef; 2], mode: [PatternMode; 2], length: [Q; 2],
                    count: [u32; 2], transform: TransformMode, suppressed: Vec<u32> },
    PolarPattern { originals: Vec<ObjectId>, axis: AxisRef, mode: PatternMode, angle: Q, count: u32, .. },
    Mirrored { originals: Vec<ObjectId>, plane: PlaneRef },
    Thickness { faces: Vec<TopoName>, value: Q, mode: ThicknessMode },
    Draft { faces: Vec<TopoName>, angle: Q, neutral: PlaneRef, pull: DirRef },
    Loft { sections: Vec<ProfileRef>, ruled: bool, subtractive: bool },
    AdditivePrimitive(Primitive), SubtractivePrimitive(Primitive),
    Boolean { tool: ObjectId, op: BoolOp },
}

pub struct Sketch {
    pub attachment: Attachment,      // support: a datum/origin plane or a face TopoName; map_mode; offset placement
    pub geometry: Vec<SketchGeom>,   // point | line | circle | arc (+ construction flag); ellipse/bspline later
    pub constraints: Vec<SketchConstraint>, // the 16 SoupRule kinds + name, driving, active
    pub external: Vec<ExternalGeom>, // body edges projected in (M4; needs-kernel)
}

pub struct Sheet { pub cells: BTreeMap<CellAddr, Cell> }      // Cell { content, alias, unit, style }
pub struct Binding { pub path: PropertyPath, pub expr: String }  // "Length" -> "Params.thick"
pub type Q = Quantity;               // value + unit dimensions, always stored in mm / deg / kg / s
```

Not persisted: recompute state (`UpToDate | Touched | Invalid(sentence) | Stale`), built shapes, meshes, the build
cache. They are rebuilt or reloaded from the app-local store.

Relationships, as the recon observed them: Document 1-n Object; Body 1-1 Origin; Body 1-n Feature ordered, chained
through `base`; Feature n-1 Sketch (profile); Sketch n-1 support; Feature n-n sub-elements by `TopoName`; any
property n-n property through bindings (a DAG; a cycle is an error on the object that closes it).

What the recon flagged as a design decision, decided: **properties plus an expression engine, not `param()`.** The
FreeCAD way (every numeric property can carry an expression; a sheet's aliases are the parameters) is what the slice
clones, and it needs no JS engine. `param()` keeps existing on the script side: a script's `param()` lowers to a
`VarSet` property with a binding, so the slider panel keeps working on the same document.

## 5. Lowering rules (reshape-features)

| document feature | lowers to kernel kinds | refuses in lowering (a sentence, until the kernel row flips) |
| --- | --- | --- |
| Sketch on Origin plane | `sketch { plane, offset, geoms, rules }` | ellipse, B-spline, external geometry |
| Sketch on a face | `sketch { frame }` from the face's TopoName, resolved against the current build | support that does not resolve |
| Pad one side, Length | `extrude { target: sketch, height }` | Symmetric / Two sides / Reversed / UpTo* / taper / custom vector |
| Pocket blind | `pocket { target: sketch, into: previous, depth }` | ThroughAll, UpTo*, symmetric |
| Revolution / Groove | `revolve` / `groove` with `angle` | an axis other than world Z (today), up-to-face |
| Fillet / Chamfer, N edges | N `fillet { edge, size, style }` features in order (what the studio does today) | an edge the kernel cannot round: the kernel's own sentence is surfaced |
| Hole | `hole { target, diameter, depth, through, recess }` | drill point, tapered, modeled thread |
| Linear / Polar / Mirrored | `pattern` / `mirror` | non-world axis or plane (today) |
| Thickness / Draft / Loft | `shell` / `draft` / `blend` | per the kernel's partial rows |
| Additive / Subtractive primitive | `box` ... + `combine` | |
| Boolean | `combine { op, targets }` | |

Lowering refusals and kernel refusals are reported in the same place with the same type (`Refusal { object,
sentence }`), the tree shows the object red, and whatever did build is shown. No second engine, no retry.

## 6. Recompute semantics

- Graph edges: `base` chain; profile and support links; `TopoName` chains (`topoRefs` today); expression references
  (object.property and Sheet.alias). Built once per document edit by `reshape-recompute`.
- States: `UpToDate`, `Touched` (an input changed), `Invalid(sentence)` (its own build or solve failed), and
  **`Stale`**, which FreeCAD does not have: every consumer downstream of an `Invalid` object is marked stale and drawn
  dimmed, rather than kept "Up-to-date" on its last good shape (recon F07 observed FreeCAD doing the latter and called
  it a trap).
- The kernel replays the whole `ModelDoc` on every build (`EngineAdapter.build` is a full replay; `cached_build`
  memoises by the exact JSON string). The core therefore recomputes a body as one kernel call and reuses
  meshes per feature by input hash (the lowered JSON prefix up to and including that feature). Incremental kernel
  rebuilds are not promised and not needed for one-body documents.
- "Recompute on change" is a document flag; off, edits mark Touched and a manual Recompute runs the build.
- Transactions: every user action is a named transaction (`Pad`, `Edit Sketch`, `Set Params.width`); undo/redo is
  a snapshot of `Document` per transaction (documents are kilobytes; a diff log is a later optimisation).

## 7. File format and the licensing line

**Own format, `.reshape`.** A zip (the same container shape as `.FCStd` and `.3mf`, which is a shape, not a
copyright) holding:

```
document.json        the Document, canonical key order, 1e-9 number formatting, so git diffs are readable
script.js            optional: the reSHape Script source when the document was authored as one
thumbnail.png        optional
cache/<name>.mesh    optional per-feature meshes, dropped on any schema mismatch
```

`document.json` with `schema: 1` is a bare `ModelDoc` and migrates in; a script-text file (what `sandbox-dev` saves
in `localStorage` today) migrates by running the interpreter in the sandbox and importing the resulting `ModelDoc`.

**`.FCStd` is not read and not written, and the reason is licensing as much as effort.** FreeCAD is LGPL-2+. A file
format inferred from the program's own output and public API, as `recon.md` did, is not a derivative work; but
reading `.FCStd` correctly means reproducing PartDesign's exact semantics (55 map modes, element maps, OCCT's native
`.brp` shape format), and the practical way to get those right is to read FreeCAD's source, which would turn the
clean-room rebuild into a derivative. The rule stays: no one writing reshape code reads FreeCAD's source, and no
FreeCAD code, icon, translation or string table is copied (`docs/clean-room/README.md`). If `.FCStd` import is ever
wanted it is a two-team clean-room job from a written spec, and it is not in this plan. **STEP is the interchange
both ways:** export is live (gate 78/78), import is planar-only today and widens with the kernel work list.

## 8. The parts that bite

- **Topological naming.** A `TopoName` is a path through history, not an index, and the kernel resolves it against
  its own op records. Every new kernel capability must record history (`record_op`) or the fillet after it loses its
  edge. The core treats an unresolved name as `Invalid` with the sentence "the edge this fillet named is no longer
  there", never a guess.
- **Stale downstream.** Section 6; doing better than the original is cheap here and worth the behavioural difference.
- **Expression cycles and units.** `reshape-expr` rejects `1 mm + 1 s` and a cell that reaches itself, both observed
  in FreeCAD; the error lands on the object that closes the cycle, and the sheet is marked Invalid.
- **Two sketch solvers.** Until `packages/sketch` is retired (M3) the TS least-squares solver and the Rust one can
  disagree on an under-constrained drag. The slice uses only the Rust session.
- **Float determinism across shells.** The same Rust code runs as wasm in the browser and natively on the desktop;
  `f64::sin` and friends go through different libm implementations on the two targets and can differ in the last
  ulp. Volumes pinned at 1e-9 relative are safe; a build-cache key must hash the lowered JSON, never a float result.
  If exact cross-shell equality is ever needed, the kernel's transcendental calls go through the `libm` crate on both
  targets; that is a kernel change and is not scheduled here.
- **wasm size.** One shipped wasm (core + kernel). Today's kernel is 563 KB gzipped against a 7.25 MB ceiling; the
  core adds serde, zip and the expression parser, well under 1 MB more. Measured at every release, not assumed.
- **Tauri on Linux.** WebKitGTK's WebGL is slower than Chromium's and occasionally broken on NVIDIA; the desktop
  shell is verified on Windows (WebView2) and macOS first and Linux is "works, measured per release".
- **Autosave and crash recovery.** The app-local store keeps a snapshot every transaction commit beyond the last
  save (`snapshots` table); reopening offers the newer snapshot.
- **The iframe rule.** `reshape-script.ts` is never imported into the main app origin; the Tauri shell keeps the same
  sandboxed iframe for script evaluation, with the webview's own CSP, so the desktop is not weaker than the browser.
- **Large documents.** Not this slice: one body, tens of features. The cache tables are keyed so that a 1,000-feature
  document degrades to "slow", not "wrong".
- **Time zones, idempotency, races, GDPR.** Not applicable: no server, no accounts, no network. `created_at`
  columns in the local store are UTC for the day a sync layer appears.

## 9. Kernel gaps, from `features.csv`

The `brep_rs` column decides the build order (`build-order.md`). The vertical slice uses only `today` rows. The
`partial`, `needs-kernel` and `refused` rows become the ranked kernel work list in `build-order.md` section 6,
ordered must before should, and within a priority by the census evidence in `PLAN-kernel-next-2026-10-05.md` (bucket
size and the plan's own sizing) and by how often a student in the F01 to F09 flows meets the case. The plan's
2026-10-09 reading, "stop the hole line, measure rounds and chamfers next", is the first entry.

## 10. Summary

Stack in one line: Rust core crates (document, expressions, solver, recompute, features, files) over brep-rs, shipped
as one wasm under the existing React studio in the browser and as a Tauri desktop app around the same bundle.

Tables: 6 in the app-local store (`schema.sql`); the document itself is Rust types serialised to JSON. Commands: 45
(`api.md`). Riskiest parts: the kernel's partial must rows (fillets beyond a box, pockets, holes that meet), the
topological naming contract under every new capability, and keeping lowering honest (a refusal, never a different
solid). Next step: `/replica-design` for the FreeCAD-shaped panels (model tree, task panel, property grid, sheet).
