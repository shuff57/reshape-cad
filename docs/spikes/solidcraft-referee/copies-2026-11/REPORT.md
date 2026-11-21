# Copying moves: plan A, steps 1 to 4 (2026-11-20)

Plan: `../PLAN-copies-low-holes-2026-11.md`, part A. The owner said to start part A and stop before the sweep. Copying moves are now
built by the layer **only with `ctx.allowCopies` set**; nothing sets it, so the page and every corpus still refuse them as before.

## 1. The live measurement (`measure-body-name.mjs`, `measure-naming-cases.mjs`, their `.out`)

On the pinned SolidCraft (0.30.1, `sc-referee-pkg`), `solid.move { bodies, translate, copy: true, body_name }`:

- keeps the source body where it was and builds the copy under the given `body_name` (`Acopy` at +30, both 1200 mm3);
- with no `body_name`, names the copy `<source> (2)`; a pattern of the source after that then names its instances `(3)`, `(4)`,
  while the layer's pattern planner expects `(2)`, `(3)`: the wrong-solid route the prototype found
  (`contract/move-turn-harness/translate-guard.mjs`, its "naive" variant);
- named `b_move1`, leaves a later pattern of the source its expected `(2)`, `(3)`;
- with a `body_name` already taken, silently renames the copy `<name> (2)`.

## 2. The layer (`packages/layer/src/translate.ts`, `move-turn.ts`, `types.ts`)

- `ctx.allowCopies` (off unless set). Off: the old refusal, word for word. On: a copying move of a single-body part is sent
  as `solid.move` with `copy: true` and `body_name: b_<move id>`, produces that name and consumes nothing (the original stays a
  shape of its own). A copy of a part made of several bodies is refused in a sentence.
- **G-COPY** (`copyRefusal`, always on, no switch turns it off): after the build, the copy must be in the reply under its own
  name (else refused: the engine renamed it); it must be the original moved by the offset in volume, surface area, faces of
  each kind (cylinders aside, which may re-split at the seam), centre of mass and box, to the move invariant's tolerances; and
  the original must be as it was in the run before. With no run before to measure against, the copy is refused, not passed.
- Kept refused, unchanged: face picks through a copy (`follow-moves.ts`), and shell, hollow and draft walks back through one.

## 3. Tests

- `packages/layer/test/copies.test.mjs`, 6 of 6: a right copy passes; a renamed copy, a copy with another volume, another
  place or other faces, a changed original, and a copy with no run before are each refused by G-COPY; the measuring switches
  that turn the move-turn checks off do not turn G-COPY off.
- The whole layer suite with the switch off: 244 of 244 (before `copies.test.mjs` was added), so the base and every set are
  exactly as they were. (With copying moves always on, 20 differential tests failed, as they must: they pin the shipped
  translator, which refuses every copy. Hence the switch.)

## 4. Live, against the OCCT referee (`live-copies.mjs`, `live-copies.out`)

15 scripts through the layer (13 at first) (planners `unified`, as the page) on the pinned engine, with the switch on and off, each top-level
shape scored against OCCT's build of the same ModelDoc (brep-rs refuses copies, so OCCT is the one referee):

- **No wrong solid.** Every shape built with the switch on matches OCCT in volume, box and centre of mass (planar to 1e-9,
  curved to 3e-4): box, cylinder, sphere, wedge, a holed box, a copy then a pattern of the original (the naming case), a pattern
  of the copy, a copy of a copy, a join of a part and its overlapping copy, moving the original after copying it, turning the copy.
- With the switch off, each copy is refused as before.
- **The two refusals found with the switch on, looked into (2026-11-20, the owner's "fix the two over-refusals"):**
  - *A cut by a copy* was not an over-refusal. In that script `cylinder(8, 30)` had no `at:`, and reSHape puts such a shape
    beside the one before it (x 31 to 39), so its copy (x 37 to 45) lay clear of the box and the guard was right that nothing
    would be removed. With the cylinder placed at the origin (`at: [0, 0, 0]`), the cut by its copy builds, right against OCCT.
  - *A hole in a copy* was one. The holes planner's G-BODIES test counted the copy as a piece of the part it was copied from,
    since `rootsOf` walked from the copy back to the original's primitive. With copies allowed, a copying move is now a root of
    its own (`holes.ts` `rootsOf(id, byId, copyIsRoot)`, set from `ctx.allowCopies` through the hole planner's `copyIsRoot`):
    the copy is a part of its own, so a hole in it, in its original, or in both, is a hole in one part among others, and
    G-OTHERS (every other body before and after) still checks the rest are untouched. Live: all three build, right against OCCT.
    Without the switch `rootsOf` is as before: `two-parts.test.mjs` pins it to the contract copy ("a copy of b1 shares its
    root"), which a first, unconditional version broke. Unit test: `copies.test.mjs` 7 of 7.
- After both: 15 scripts, every shape built with the switch on right against OCCT, and none refused but by its own fault.

## New sentences (shown to a student when a copy is refused; approved by the owner as written, 2026-11-20)

- `move1 (move): a copying move of a part made of several bodies is not mapped`
- `{move} is not built: the copy of {part} did not come back under its own name, so which body it is cannot be told, and it is shown without it.`
- `{move} is not built: {part} could not be measured before and after it was copied, so the copy cannot be checked, and it is shown without it.`
- `{move} is not built: the copy of {part} would not be {part} moved by [{30.0,0.0,0.0}] (its {volume is 1100 mm3 instead of 1200 mm3}), so it is shown without it -- build the copy as a part of its own.`
- `{move} is not built: copying {part} would change {part} itself (its {centre of mass is ...}), so it is shown without it.`

## Next (each the owner's to approve)

1. The sweep with the switch on (`sweep-all.sh`, about 6.5 h with the page): the `combined` corpus makes copies in about 15% of
   its move steps.
2. Then the owner's decision whether the page sets `allowCopies`; the host bundle is rebuilt and copied into shCode's
   `vendor/solidcraft-preview` only then.
