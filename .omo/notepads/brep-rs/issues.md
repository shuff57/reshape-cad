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

# Issues (open problems, appended only)

## 2026-09-17 Open after W9a
- STEP import not started; trim-recovery hazard documented in W9a entry.
- cone/sphere/torus STEP export surfaces refused (degenerate topology).
- brep-step-gate.mjs does not exist; export_step is ungated (scratch harness only).
- occt-build.ts whole-draft stale-handle bug (drafts 2 of 4 walls) blocks the
  draft-whole fixture; lead-owned reference path.
- packages/script TDZ test fails under bun only (environment, not a regression).

## 2026-09-17 Open after W9b (STEP import, planar half)
- STEP import handles PLANE + LINE only: 23 of 61 corpus files. Cylindrical
  faces and circular edges refuse in plain words and are the next slice
  (18 corpus files are waiting on exactly that, plus 3 more whose refusal
  currently names "cylindrical" whereas the end state should name spherical or
  toroidal -- those files carry both).
- BREP_WITH_VOIDS refused on import (10 corpus files). Needs the
  ORIENTED_CLOSED_SHELL orientation flag handled: a void shell whose faces were
  not reversed ADDS its volume instead of subtracting.
- Assembly placements refused on import (3 corpus files carrying
  ITEM_DEFINED_TRANSFORMATION).
- `/tmp/opencode/step-import-parity.mjs` still asserts the END-STATE 41/20, so
  it exits 1 and lists the 21 cylinder-gap fixtures. That is deliberate: it is
  an honest progress meter and goes green only when import is finished. The
  native census in step_in.rs pins the current 23/38 exactly.
- build.rs: prism_solid and wedge_solid give each face its own edge handles
  rather than sharing one per adjacent pair (36 for 18, 18 for 9), which
  contradicts topo.rs's stated identity rule. Harmless for volume, wrong for
  any consumer that counts or walks edges.
- DELEGATION FAILURE MODE, recorded for the next session: four worker runs
  (deep x2, quick, ultrabrain) produced ZERO code on the step_in.rs slice, each
  spending its whole budget on correct-but-unshipped analysis. Categories deep
  and quick route to glm-5.3 / glm-5.3-flash. What did work: very small,
  single-deliverable tasks with every fact inline (the parser, the gate, the
  corpus harness all landed first or second try). What did not: a 12-rule slice
  needing 5000 lines of context. Split to one deliverable per call, or write it
  in the orchestrator.
