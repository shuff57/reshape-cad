# archive/

Retired 2026-10-17 (see docs/PLAN-scripting-layer.md). Nothing here is built, tested or continued.

- brep-rs/  the Rust B-rep kernel. Kept as the independent oracle. Restore with `git mv archive/brep-rs packages/brep-rs`.
- docs/specs/  kernel census, fuzz, prototypes and SPEC-brep-* specs.
- Tests that measured brep-rs live in packages/*/test/archived/ (outside the `test/*.test.mjs` glob).

The lead-owned scripts/brep-*.mjs gates still point at packages/brep-rs/pkg. Symlink it to archive/brep-rs to run them.

Archived tests (packages/brep-adapter/test/archived, packages/studio/test/archived, packages/script/test/archived) were
moved because they load the brep-rs wasm or the FreeCAD refs. At move time (bun test, 2026-10-17) the rest passed:
sketch 42, script 383 (6 skip), brep-adapter 2, studio 292. Helper scripts under brep-adapter/test were left in place.
