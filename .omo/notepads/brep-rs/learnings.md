# Learnings — brep-rs campaign

## 2026-09-17 Toolchain on this machine (no root, no C compiler, no npm)
- rustup minimal profile installed at ~/.cargo. Native `cargo test` needs a
  linker: `dnf download gcc glibc-devel libgcc` (no root needed), extract with
  `rpm2archive -n f.rpm | tar -x -C /tmp/opencode/sysroot`, then a `cc` shim:
  `exec /tmp/opencode/sysroot/usr/bin/gcc -B/tmp/opencode/sysroot/usr/libexec/gcc/x86_64-redhat-linux/16/ -B/tmp/opencode/sysroot/usr/lib/gcc/x86_64-redhat-linux/16/ -B/tmp/opencode/sysroot/usr/lib64/ "$@"`
  Export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/tmp/opencode/bin/cc.
  Fedora's libc.so is a linker script naming /usr/lib64/libc_nonshared.a by
  absolute path — repoint that one line at the extracted copy.
- `node` is a bun shim; npm does not exist. `bun install` populates
  node_modules (incl. replicad-opencascadejs). Build TS with
  node_modules/.bin/tsc -p tsconfig.json in the root script's order (sketch,
  script, engine, kernel, studio). JS suites: `bun test test/` (bun's
  `node --test` shim does not work). One pre-existing failure under bun only:
  packages/script scope-shadowing TDZ test (JSC appends a period; V8 does not).
- wasm-pack 0.13.1 binary at /tmp/opencode/wasm-pack-v0.13.1-x86_64-unknown-linux-musl/.
  Build: wasm-pack build --release --target web in packages/brep-rs.
- Gates, all green 2026-09-17: cargo 68/68, brep-parity-gate 61/0,
  brep-mesh-gate 61/61, occt-modeldoc-gate 17/17, kernel JS 98/98.

## 2026-09-17 The OCCT oracle (the single most useful thing here)
- The bundled OCCT wasm binds STEPControl_Reader AND STEPControl_Writer.
- Scratch harnesses live in /tmp/opencode/ (uncommitted, V0 tradition):
  stepcheck.mjs (read/write a step file, measure), step-parity.mjs (all 61
  fixtures: brep-rs export_step -> OCCT read -> compare vs measure_doc +
  BRepCheck_Analyzer), whyinvalid.mjs (which subshapes BRepCheck rejects),
  facearea.mjs / facepos.mjs / freeedges.mjs (per-face areas, centroids,
  edge-sharing), flipprobe.mjs (flip one same_sense, re-measure).
- Fixture docs dump: node /tmp/opencode/dump-fixtures.mjs ->
  /tmp/opencode/step/fixtures.json (61 docs, measure feature id included).
- OCCT constructor names have NO _1 suffix in this build (STEPControl_Reader,
  TopExp_Explorer, Message_ProgressRange). TopExp/TopTools maps are NOT bound;
  count edge-sharing by walking faces and IsSame().
- BRepGProp.SurfaceProperties (no _1) gives face area; VolumeProperties(shape,
  g, 1e-7, false, false) is the volume call the gates use.

## 2026-09-17 STEP format rules learned the expensive way (W9a)
- Complex entities list parts ALPHABETICALLY; only the redeclaring supertype
  takes `*`. Wrong order = NO error, OCCT falls back to METRE, everything 1e9x.
- A loop is CCW in the SURFACE's parameter space; same_sense + the bound's own
  orientation flag carry the flip. Never reorder the loop to flip a face.
- A cylinder's boundary CANNOT be translated from the face's wire: rim
  directions in the kernel's wires are bookkeeping and inconsistent
  (boolean-union wound twice in parameter space, lost 2608.37). Synthesise from
  vmin/vmax/arc — the fields the kernel itself integrates.
- A closed circle's seam vertex is arbitrary alone but NOT when a wall chains
  it to a seam ruling: write chained faces FIRST or wires disconnect.
- Weld edges per SHELL, not per solid: mirror's two boxes touch at x=20 and
  welding across them makes a non-manifold shell OCCT splits into 13 faces/12.
- STEP reals need a decimal point and `1.E-7` style exponents (Rust writes
  `1e-7`, which no parser accepts).
- OCCT heals orientation on read: flipping same_sense on any face changed
  nothing. Volume errors that survive face-area checks are connectivity, not
  orientation.

## 2026-09-17 Where the remaining kernel work is
- W5 general surface-surface intersection is the keystone (W8 counterbores,
  W3 shell, W2 fillet-on-boolean, and the one silent wrong volume: 4 corner
  bores flush with a face, 31038.672648 vs 31095.221316, no refusal).
- W9a did STEP EXPORT (55/61 fixtures verified via OCCT read-back). Left:
  STEP IMPORT (must refuse what it cannot represent exactly — a face's trim
  lives on the surface here, in the loops in STEP, and SphereSurf::trim cannot
  be recovered from loops), cone/sphere/torus export surfaces, and promoting
  /tmp/opencode/step-parity.mjs into a lead-owned brep-step-gate.mjs.
- Naming history exists only for move/combine/extrude/revolve. The parity gate
  calls only measure_doc/resolve/version — name_face/name_edge are ungated.
- Full closeout map: docs/kernel-campaign.md "Closeout map" section.

## 2026-09-17 W9b STEP import — what the OCCT corpus taught
- Build the foreign corpus FIRST: `node /tmp/opencode/occt-corpus.mjs` writes an
  OCCT-authored .step for all 61 fixtures plus index.json holding OCCT's own
  measurement of each. That pair (file + trusted number) is the only honest
  oracle for a reader; our writer's files cannot test our reader.
- Census the corpus before promising a number. Surface types alone said "54
  importable"; solid-level structure cut it to 41 (10 files carry
  BREP_WITH_VOIDS, 3 an ITEM_DEFINED_TRANSFORMATION, 1 has two roots).
- *** FACE_BOUND.orientation reverses the LOOP, ADVANCED_FACE.same_sense
  reverses the SURFACE, and the two COMPOSE. *** Reading only same_sense
  refused all 61 OCCT files while our own writer's output round-tripped
  perfectly -- a built solid has face.forward = true, so step.rs writes .T. on
  both flags and never exercises the difference. Self-round-trip could not have
  found this; the corpus found it in one run.
- Unwrap SURFACE_CURVE / SEAM_CURVE / TRIMMED_CURVE to param(1) BEFORE
  classifying a curve. Matching the outermost name refuses every cylinder OCCT
  has ever written, because a seam arrives as a SEAM_CURVE. Ignore PCURVE and
  DEFINITIONAL_REPRESENTATION entirely: b-spline PCURVEs are common in files
  whose 3D geometry is ordinary (draft-one-face, shell-open-top,
  tangent-subtract-touching, round-one-edge all carry them and all import).
- Check BREP_WITH_VOIDS BEFORE counting MANIFOLD_SOLID_BREP: groove-full has a
  void and ZERO manifold roots, so counting first names the wrong cause.
- STEP's typed/select parameters are real and every file has one:
  UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),...). A Value enum with
  no slot for them cannot parse the corpus.
- All 23 planar-importable fixtures are LINE-only; not one contains a CIRCLE.
  Every circular edge in the corpus belongs to a cylindrical face. So arcs are
  untestable until cylinders land, and are refused rather than guessed.
- `prism_solid` and `wedge_solid` do NOT share edge handles between adjacent
  faces: 36 handles for 18 distinct edges, 18 for 9. `box_solid` does (12/12).
  So `solid.edges().len()` over-counts on those builders, and a STEP round trip
  returns the true topological count. topo.rs documents shared handles as the
  identity rule, so this is a latent inconsistency in build.rs, not in the
  round trip.
- Measurement asymmetry worth re-reading before touching either half: a PLANE
  face is measured FROM ITS WIRES (face_edges -> planar_measure, exact for
  arcs), a CURVED face FROM SURFACE TRIM FIELDS ONLY, wires never consulted.
  `Face.uv_domain`, `EdgeUse.pcurve` and `Edge.forward` are read by NOTHING in
  the measurement path; `Face.forward` is read only by the STEP writer.
