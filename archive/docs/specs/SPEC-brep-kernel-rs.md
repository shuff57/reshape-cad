# SPEC — independent Rust B-rep kernel (`brep-rs`)

Status: DRAFT. §4 is written from the truck source recon. Three items in §8 must
be settled by the lead before handoff. Everything else is settled.

## 1. Goal

A B-rep CAD kernel written in Rust, compiled to wasm with wasm-pack/wasm-bindgen,
that builds every reshape-cad `Feature.kind` in the browser with no server and no
Docker. It becomes a third `EngineAdapter` (`packages/kernel/src/engine-adapter.ts`)
beside `OcctEngineAdapter` and `FreeCadEngineAdapter`.

Why: OCCT works today but ships 21.91 MB (6.87 MB gzipped). FreeCAD's 63.6 MB wasm
cannot be served on Cloudflare Pages (25 MiB per-file limit). The only reason to
build this is to be smaller than OCCT without losing anything OCCT already does.

## 2. Hard constraints

- **No dependency on any `truck-*` crate.** truck (github.com/ricosjp/truck,
  Apache-2.0) is an architecture reference only. Read it; do not import it, and do
  not copy files verbatim.
- Target `wasm32-unknown-unknown`, built with `wasm-pack build --release --target web`.
- Pure Rust. No C/C++ dependencies (they would drag Emscripten back in).
- Do NOT add a `package.json` at `packages/brep-rs/` and do not edit the root
  `package.json`, `package-lock.json` or `.github/workflows/`. The root workspace
  glob is `packages/*`, so a crate-root `package.json` would pull the crate into
  `npm test --workspaces` and CI. wasm-pack's own `pkg/package.json` is fine.
- Do not edit `scripts/brep-parity-gate.mjs` or `scripts/brep-parity-fixtures.mjs`
  (claimed by the lead; writes are blocked).
- If any path in this spec does not exist, STOP and say so rather than guessing.

## 3. Scope — the 20 feature kinds

Source of truth: `packages/script/src/model-types.ts`. OCCT implementation to
match: `packages/kernel/src/occt-build.ts`.

box, cylinder, cone, sphere, torus, prism, wedge, groove, pocket, extrude, blend,
combine, revolve, mirror, pattern, hole, shell, fillet, draft, move

(An earlier draft said 19 and omitted `cone`, which `ShapeKind` includes. The
gate's reference-only run surfaced it.)

What the three hardest kinds actually ask for (read from model-types.ts, not assumed):

- `fillet`: ONE edge per feature, named by `TopoName`, `size`, `style` round | chamfer.
- `shell`: one target, `thickness`, optional ONE open face named by `TopoName`.
- `draft`: one named face, or `whole` (every side face), `angle` in degrees,
  `pull` axis, `neutral` position along it.

Also in scope: tessellation to a triangle mesh (`EngineMesh`: geometry plus
per-face ranges), edge polylines for `edges()`, and STEP export and import.

Out of scope: `saveDocument`, `openDocument`, `exportDrawing`. OCCT's adapter does
not implement them either.

Suggested build order, easiest first (the builder may reorder with a reason):
move, box, cylinder, sphere, torus, extrude, revolve, mirror, pattern, prism,
wedge, combine, pocket, groove, hole, blend, shell, draft, fillet.

## 4. Architecture

Informed by truck's layering, with three deliberate departures marked DEPARTURE.

### 4.1 Crate layering

One crate, layered as modules. Each layer depends only on layers above it in this
list:

```
math      vectors, points, matrices, tolerances, root finding
geom      curves and surfaces (4.3)
topo      vertex/edge/wire/face/shell/solid (4.2)
build     primitives, sweep, revolve, mirror, pattern, move (4.4)
ops       booleans, fillet/chamfer, shell, draft (4.5)
history   per-operation naming history (4.6)
mesh      tessellation for three.js
step      STEP read/write
wasm      wasm-bindgen surface, the only module that knows about JS
```

truck keeps topology and geometry independent of each other and of everything
above them. Keep that property: `topo` and `geom` must not import each other.

### 4.2 Topology

Shared-handle model, as in truck, not half-edge or winged-edge:

- `Vertex` holds a point. `Edge` holds two vertices, an orientation flag and a
  curve. `Wire` is an ordered list of edges. `Face` holds boundary wires (first is
  outer, the rest are holes), an orientation flag and a surface. `Shell` is a list
  of faces. `Solid` is a list of shells.
- Two faces that share an edge hold the SAME edge handle. A face that uses it in
  reverse holds the same handle with orientation flipped, not a twin object.
- Identity is handle identity, never geometry.

DEPARTURE 1: use `Rc<RefCell<T>>`, not truck's `Arc<Mutex<T>>`. The wasm target is
single-threaded, and a mutex buys nothing but size and overhead there.

DEPARTURE 2: store a parameter-space curve (pcurve) for every (edge, face) use,
on the topology, not only through a decorator as truck does. Booleans, fillet and
the `OnPoint` naming discriminator (4.6) all need an edge's position in its face's
own u/v space, so it has to be one lookup away.

### 4.3 Geometry

- **Analytic types are first-class:** line, circle, ellipse, plane, cylinder,
  cone, sphere, torus. truck does the same (`specifieds/`). Every primitive and
  most sweeps are analytic, which keeps volumes exact and intersections cheap.
- **NURBS is the fallback** for everything else: B-spline curves and surfaces with
  knot vectors, rational weights in homogeneous (x, y, z, w) control points.
- **Derived surfaces** for sweeps and blends: extruded curve, revolved curve,
  offset surface, and an edge-blend surface for fillets. truck's
  `decorators/edge_blend.rs` (a G1 blend built from two pcurves) is working math
  and is the right thing to read before writing ours.

### 4.4 Building operations

- Primitives are built directly as B-rep with analytic faces. truck has only
  `cuboid` internally; cylinder, sphere, torus, prism and wedge are ours.
- `extrude` and `revolve` follow truck's generic sweep: one function sweeps
  whatever dimension it is given (vertex to edge, edge to face, wire to shell,
  face to solid), with a translation or rotation connector.
- `mirror`, `pattern`, `move` are transforms plus, for pattern, a union.

### 4.5 Booleans, fillet, shell, draft

Booleans follow truck's pipeline: intersect every face pair into intersection
curves, classify faces in/out/on, split faces along the curves, reassemble.

DEPARTURE 3, and the single biggest risk in this project: truck states in its own
`truck-shapeops/src/lib.rs` that booleans work "only for shapes where faces
intersect transversally. Cases where faces are tangent to each other are not yet
supported." reshape-cad produces coplanar and tangent faces constantly: a pocket
whose floor lies flush, a hole through a face, a union of two boxes sharing a
face. Ours must handle coplanar and tangent faces. The gate (§5) includes
fixtures built to hit exactly these cases. Do not treat them as edge cases.

**REJECTED approach, do not repeat (2026-09-15, combine strike one).** Dispatch 6
built combine as a 2.5D Z-slab region boolean: slice both operands at every
critical Z, clip the cross-section polygons (Sutherland-Hodgman, convex clip
only), stack the per-slab prisms, with circles sampled into 8192-sided polygons.
It passed all ten combine fixtures, because every one was a Z-aligned box or
cylinder, and it refused a box minus an X-axis cylinder and a sphere minus a box
when probed directly. It is a faceted special case, not a B-rep boolean. The gate
now includes a rotated cylinder cut, a sphere cut and a non-convex profile cut,
and fails any result with more than 2x OCCT's face count plus 4 (§4.7). Booleans
must intersect real analytic and NURBS surfaces, in any orientation.

Fillet: truck's shipped fillet handles one edge whose end vertices each touch
exactly three faces; its broader attempt (`fillet/experiment.rs`) is marked "This
module is a prototype." One edge per feature is all reshape-cad asks for, so the
narrow case is the right target, but the three-face condition does not hold on
every solid a student can build (for example an edge created by a boolean). When
an edge falls outside what ours can round, return a refusal for that feature in
`EngineBuildResult.refusals` with a plain reason, exactly as `occt-build.ts` does.
Never return a wrong solid silently.

Chamfer shares fillet's edge-finding and face-cutting, with a planar face in place
of the blend surface.

Shell: offset every face inward by `thickness`, rebuild the inner shell, remove
the open face if named, and join. Draft: rotate the named faces (or every side
face) about the line where they meet the neutral plane, then re-intersect the
neighbours.

### 4.6 History and naming

This is required, not optional. Fillet, shell and draft address faces and edges by
`TopoName` (`packages/script/src/topo-name.ts`), and a name is a path through the
history that produced the shape, not a position in it.

Every operation returns, alongside its shape, a history map: for each output face
and edge, which input face or edge it was `modified` from, `generated` from, or
that an input was `deleted`. This is the same information OCCT's Modified and
Generated maps give `occt-build.ts` today. A boolean that splits one face into
several must report every piece as modified from that one face, so that the
`OnPoint` discriminator (a u/v fraction of the parent face) can pick between them.

Implement `resolveFace`, `resolveEdge`, `nameFace` and `nameEdge` against this
history.

### 4.7 The gate's contract (what `wasm` must export)

The gate (§5) calls exactly these, from Node, on the artifact at
`packages/brep-rs/pkg/brep_rs.js` + `brep_rs_bg.wasm` (`wasm-pack build --release
--target web`; the gate loads it with `initSync` and the wasm bytes). JSON in,
JSON out, so the gate stays independent of the Rust types. Do not change these
names or shapes; the gate is lead-owned.

```
version() -> string

measure_doc(doc_json: string) -> string
  // doc_json: a ModelDoc { version, features: [...] } exactly as model-types.ts
  // returns: { "shapes": { "<featureId>": { "volume": f64,
  //                                        "bbox": [[minx,miny,minz],[maxx,maxy,maxz]],
  //                                        "faces": u32 } },
  //   "faces": the number of B-rep faces in the result. Added 2026-09-15.
  //   The gate fails a result with more than 2x OCCT's face count plus 4.
  //   Reason: dispatch 6 passed every combine fixture with a 2.5D Z-slab
  //   method that sampled circles into 8192-sided polygons (volume within
  //   ~1e-8, thousands of flat faces) and refused anything not a Z-aligned
  //   prism. That is a faceted approximation, not the B-rep boolean §4.5
  //   requires. Booleans must work for any orientation and for curved
  //   operands (sphere, torus, rotated cylinder, non-convex profiles).
  //            "refusals": { "<featureId>": "<plain reason>" } }

resolve(doc_json: string, name_json: string) -> string
  // name_json: one TopoName, as topo-name.ts defines it
  // returns: { "kind": "face", "area": f64, "centroid": [x,y,z] }
  //       or { "kind": "edge", "length": f64, "centroid": [x,y,z] }
  //          (centroid, not midpoint: they differ on a curved edge)
  //       or null when the name does not resolve (never a guess)
```

The bounding box must be TIGHT (the exact extent of the solid), not padded.

## 5. The gate, owned by the lead, not the builder

The critic in the loop is a runnable parity harness, not a model.

- **What it does:** for each fixture ModelDoc, build it on OCCT
  (`replicad-opencascadejs` 1.1.0, as `scripts/occt-modeldoc-gate.mjs` already
  does) and on `brep-rs`, then compare.
- **What it compares:** volume and world bounding box of the result. For fixtures
  that name a face or edge, it also compares the RESOLVED face's area and centroid,
  or the resolved edge's length and midpoint, against OCCT's.
- **Coverage:** 55 fixtures across all 20 kinds, including 6 coplanar and tangent
  boolean fixtures (4.5) and 5 named-resolution fixtures (4.6). Every one was
  validated on OCCT with `--reference-only` before use. Two were added
  2026-09-15 (`name-extrude-side`, `name-extrude-cap-top`) after extrude passed on
  volume while recording no naming history.
- **Files (lead-owned, claimed, do not edit):** `scripts/brep-parity-gate.mjs`,
  `scripts/brep-parity-fixtures.mjs`.
- **How to run it:** `npm run build` at the repo root (NOT `--workspaces`: that
  also tries `packages/sandbox-dev`, which has no build script, and exits
  non-zero), then
  `node scripts/brep-parity-gate.mjs --kind <kind>` while working on a kind, and
  `node scripts/brep-parity-gate.mjs` for everything. Exit 0 means pass.
- **Tolerance:** relative 1e-6 for planar and analytic results. For fillet, blend
  and draft, OCCT's own surface approximation may not agree that tightly with a
  correct independent kernel. The lead sets those tolerances when writing the
  fixtures and records why. The builder never changes them.
- **Refusals:** where OCCT builds a feature and `brep-rs` refuses it, that fixture
  fails. A refusal is honest, but it is not parity.
- **Size check:** gzipped `brep-rs` wasm must come in under the production OCCT
  wasm's gzipped size, 7,250,252 bytes (§8 decision 3).
- **Ownership:** the lead writes the harness and fixtures BEFORE handoff, then
  claims them with `node ~/.claude/bin/msg.mjs claim --as claude <paths>`. The
  builder does not edit them. A builder that can edit its own gate eventually will.

A kind is **done** only when every fixture for that kind passes. Partial passes do
not count.

## 6. Builder and budget

- Builder: `ollama-cloud/deepseek-v4.1-flash`, launched with
  `node ~/.claude/bin/handoff.mjs --spec <abs path to this file> --model ollama-cloud/deepseek-v4.1-flash`.
- Hard ceiling: **$300** in credits. Stop and report when it is reached, with the
  per-kind pass/fail table as it stands.
- **Spend tracking.** opencode's own cost column for this model is always $0.00
  (its price table has zeros), so do not quote it. Instead run
  `node scripts/brep-spend.mjs --since 2026-09-15 --budget 300` (lead-owned,
  claimed; it takes about two minutes). It prices every deepseek-v4.1-flash
  message from ollama.com/pricing, doubling for peak hours (12:00-18:00 UTC,
  weekdays). Run it before every report and include its "ROUGH spend" line. If it
  exits 1 (over budget), stop immediately and report.
- Rework rule from CLAUDE.md applies per kind: after two failed reviews on the same
  kind, escalate that kind to `code-engineer` (sonnet) rather than sending deepseek
  a third time.

## 7. Reporting

After each kind, send a message with `msg.mjs send --from opencode --to claude
--re last` giving: the kind, gate pass/fail per fixture, the largest failing
delta, and current gzipped wasm size. Report what actually ran, not what was
intended. If a step failed or was skipped, say so first.

## 8. Decisions

1. **Crate location: `packages/brep-rs/` in this repo.** Settled 2026-09-15.
2. **Tolerances:** relative 1e-6 for planar and analytic results; relative 1e-4
   for fillet, blend and draft. Settled 2026-09-15. These may be tightened later.
   To keep that cheap, the gate prints every fixture's measured delta, not just
   pass/fail, so headroom is visible before tightening.
3. **OCCT size target: 7,250,252 bytes gzipped.** Settled 2026-09-15. The custom
   OCCT build was cancelled, so the target is the OCCT kernel reshape-cad ships
   today: `node_modules/replicad-opencascadejs/dist/replicad_single.wasm`,
   22,980,267 bytes raw, 7,250,252 bytes with zlib level 9 (the gate's own
   setting). Run with `node scripts/brep-parity-gate.mjs --size-target 7250252`.
   Judged on the finished artifact by the lead. It is not a per-kind blocker, so
   it does not hold up the handoff. The builder should still keep
   the wasm lean (no unused dependencies, release profile with `opt-level = "z"`
   or `"s"`, `lto = true`) and report the gzipped size after every kind.
