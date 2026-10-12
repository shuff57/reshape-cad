# SPEC: reference and inactive sketch rules (FreeCAD Sketcher S1)

Status: LANDED in `b4d432c` (`packages/brep-rs/src/sketch/{mod,session,tangent}.rs`, diagnose JSON in `wasm.rs`).
Source: `freecad-probes/probe_s1_reference_inactive.py` and `probe_s1b_inactive_weld.py`, run headless on
FreeCAD 26.3.0 RC1 (`./AppRun freecadcmd`). Measured outputs only; no FreeCAD source was read (clean-room).

## Measured behaviour

| # | Fact | Case |
|---|---|---|
| F1 | `Constraint.Driving` defaults true; `IsActive` defaults true. | introspection |
| F2 | A reference (Driving=false) dimension contributes NO equation: DoF 0 -> 1 on a fully constrained rectangle. | B |
| F3 | A reference's stored `Value` becomes the MEASURED value after solve (12 -> 10). | D |
| F4 | Making a redundant dimension a reference removes the redundancy (solve -2 -> 0). | C |
| F5 | Making one of two conflicting dimensions a reference OR inactive resolves the conflict (solve -4 -> 0). | D |
| F6 | An inactive driving dimension is ignored (DoF 0 -> 1) and keeps its stored `Value`; re-activating restores DoF 0. | D, E |
| F7 | `setDriving(False)` is accepted only for Radius, Diameter, Distance, DistanceX, DistanceY, Angle; it raises for Horizontal, Vertical, Coincident, Equal, Parallel, Perpendicular, Symmetric, Block. | F |
| F8 | `setActive(False)` is accepted for EVERY kind tested (12 of 12). | F |
| F9 | Solve status codes seen: 0 ok, -2 redundant, -4 conflicting. DoF reads -1 under conflict. | A, C, D |
| F10 | `ConflictingConstraints` / `RedundantConstraints` are 1-BASED. | C, D |
| F11 | The conflict list is BROAD, not the minimal pair (10 vs 12 on one edge reported 8 constraints). | D |
| F12 | With ONE coincident of a 4-line rectangle switched off (any of the four), the sketch shape is still one closed wire of 4 edges and a Pad of length 10 is valid at volume 10000. FreeCAD builds the shape from geometry, not from rules. | probe_s1b |

## What brep-rs does

- Row fields: `"driving": false` (reference) and `"active": false` (switched off). Absent means true.
- `driving: false` on a kind that is not dimensional refuses at `SketchSession::open` in a sentence (F7).
- A rule that is not live (driving AND active) has zero residual rows, like `Lock`; solve, diagnosis and
  blame need no special case and blame indices keep pointing at the student's rules (F2, F5, F6).
- `Constraint::measured` reads a dimension's current number (lengths via the residual at value 0, angle via
  `atan2` in degrees); `SketchSession::reference_values()` returns `(rule index, value)` for every reference
  that is still active (F3). `sketch_diagnose` reports it as `"references": [{rule, value}]`. An inactive rule
  is not re-measured (F6).
- A switched-off `coincident` still welds the outline while its two points coincide in the solved state
  (F12); once they come apart the planner refuses with its loose-end sentence.
- Our indices stay 0-based; FreeCAD's lists are 1-based (F10), so a differential gate must normalise.

## Not measured

1. Reference and inactive rules on external geometry (waits for S5).
2. `PartiallyRedundantConstraints` and `MalformedConstraints` with a reference rule.
3. Persistence of Driving / IsActive across save and reload (only matters if `.FCStd` is ever read).
4. An open outline whose inactive weld's points are APART: our planner refuses; FreeCAD's wire would be open
   too, but a Pad on it was not probed.

## Open decision

Conflict-set comparison against FreeCAD's broad set (F11): subset-plus-culprit is the intended relation, not
strict equality. No differential gate exists for it yet.
