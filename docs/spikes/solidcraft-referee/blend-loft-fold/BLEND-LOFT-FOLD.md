# The blend-loft fold (2026-11-24)

Before this, the page refused every loft: `packages/solidcraft-host/pane/src/host-entry.mjs` listed `blend` under `NOT_YET` ("a loft between two
sketches is not available in this version yet"), because the group's guard (`contract/blend-loft.guard.mjs`, "accepted" in LAYER-CONTRACT.md) was
never imported by `packages/` (LAYER-CONTRACT.md wrong rows 2 and 33: "the guard is NOT WIRED").

## What changed

- `packages/layer/src/blend-loft-guard.ts`: a TypeScript port of the guard, behaviour-preserving (same thresholds, order, sentences), plus two additions
  for the open defects of the group's last critic review:
  - **NEEDLE**: a straight-sided loft whose gap is over 1000 times its sketches' in-plane size is refused (the critic's major: at length / width
    1e4 .. 1e6 the kernel dropped faces, and the guard had no upper bound).
  - **PRISMATOID**: the after-the-build check covered circle <-> circle only. A ruled loft between two straight-sided outlines with fixed corner
    pairs has a cross section whose area is quadratic in the height, so `V = h/6 (A1 + A2 + 4 Am)` is exact. Every straight-sided pair the guard
    passes is now checked against it (bar 1e-6 for exactly parallel sides, 2.5e-4 for sides up to the guard's 2e-3 sine).
- `packages/layer/src/blend-loft.ts`: the 'unified' set (the page's) routes every `blend` to this step whatever the document's style: the guard before
  the engine runs (guard code `BL-<code>`), then the generic step with the base planner (`solid.loft`), then the closed-form check (`BL-volume`).
  No other set runs either check (their differential tests compare against originals that have none).
- `packages/script/src/reshape-script.ts` `blend()`: the guard's `datum` case is refused in the script. The page translates the doc only, so it
  cannot pass the guard's `neutral` map; a second sketch placed at a height the gap contradicts is the one case that needs it. Without `neutral` the
  guard keeps its conservative rule: a sketch a loft uses must not be used by another step. Without `argOrder`, "first" and "second" in a sentence
  follow the doc's bottom-first order (they differ from the written order only for a negative gap).
- `host-entry.mjs`: `NOT_YET` is empty.

## Measured on the page (SolidCraft 0.30.1, the pinned engines), against OCCT

The rig is in this folder: `drive.mjs` runs scripts through the guarded host page (`host.html?storage=off`, served with the pinned wasm),
`oracle.mjs` rebuilds the page's own doc on OCCT (`packages/brep-adapter` `buildDoc`, ThruSections ruled) and compares volumes. Bar: 1e-9 for
exactly parallel straight sides, 3e-4 for anything curved or slightly warped (the group's bars). Also in shCode: `npm run check:cad-docs` builds
the docs page's loft example.

| Run | Cases | Built | Refused | Built and off the OCCT volume | Worst difference |
|---|---:|---:|---:|---:|---|
| hand cases (`mkcases.mjs`) | 21 | 15 | 6 (all expected) | 0 | straight 1e-14, curved 5.0e-5 |
| random (`fuzz.mjs 7101 400`) | 400 | 225 | 175 | 0 | straight exact 3.9e-13, warped 4.3e-6, curved 1.0e-4 |
| window edges (`edge.mjs 3`) | 300 | 281 | 18 | 0 | 1.08e-4 (regular polygon <-> circle at the 0.02 rad phase limit) |

The guard's windows were calibrated on the referee build of an earlier SolidCraft; the edge run puts cases just inside every window (tilt 3..5,
coarse 20..39, rectangle aspect 1.6..2, rectangle gap 1..1.2 long sides, circle size 0.25..0.35 and 1.7..2, polygon phase within 0.02 rad, regular
gap 0.3..0.4, rounded aspect up to 1.1, gap 100..999 x size, gap 1.5..4.5e-4 x size, sides 5e-4..1.9e-3 off parallel) and found no wrong solid on 0.30.1.
Face counts differ from OCCT for a circle against a rectangle (6 vs 7) and a rounded square (3 vs 11): the kernel merges the ruled faces. The group
accepted that; the volume is the check.

## Not shown

- The guard's `ambiguous` and `start` sentences are reached by the original's own battery, not by `test/blend-loft.test.mjs`.
- A loft as a later step's input (a hole, round or hollow on a lofted part) runs those groups' own guards; this fold measured the loft alone.
- The studio's Build button path calls the same page translator, so it is guarded too; it was not driven here.
