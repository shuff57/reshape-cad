# SPEC B2: switch the parity bar to FreeCAD 1.x PartDesign (reshape-cad)

Repo root (absolute): C:\Users\shuff57\Documents\GitHub\reshape-cad
Only touch: parity/, scripts/check-freecad-parity.mjs, docs/parity.md. Nothing under packages/, engine/, bench/.
If any path named here does not exist, STOP and say so; do not invent paths.
Plain Node ESM (.mjs), no npm dependencies.

## Why
The old bar was Onshape's 75-tool list (shCode `.gauntlet/parity.json`, `scripts/check-onshape-parity.mjs`). The new bar is the FreeCAD 1.x PartDesign workbench toolbar. The checker is a lead-owned gate: it must not be satisfiable by editing the tool list.

## parity/freecad-partdesign.json
An object: { "source": "FreeCAD 1.1.3 PartDesign workbench toolbar, https://wiki.freecad.org/PartDesign_Workbench", "tools": [ ... ] }.
One entry per tool, in this exact order and with these exact `id` values (FreeCAD command names):
Structure: PartDesign_Body, PartDesign_NewSketch, PartDesign_Plane, PartDesign_Line, PartDesign_Point, PartDesign_CoordinateSystem, PartDesign_ShapeBinder, PartDesign_SubShapeBinder, PartDesign_Clone.
Additive: PartDesign_Pad, PartDesign_Revolution, PartDesign_AdditiveLoft, PartDesign_AdditivePipe, PartDesign_AdditiveHelix, PartDesign_AdditiveBox, PartDesign_AdditiveCylinder, PartDesign_AdditiveSphere, PartDesign_AdditiveCone, PartDesign_AdditiveEllipsoid, PartDesign_AdditiveTorus, PartDesign_AdditivePrism, PartDesign_AdditiveWedge.
Subtractive: PartDesign_Pocket, PartDesign_Hole, PartDesign_Groove, PartDesign_SubtractiveLoft, PartDesign_SubtractivePipe, PartDesign_SubtractiveHelix, PartDesign_SubtractiveBox, PartDesign_SubtractiveCylinder, PartDesign_SubtractiveSphere, PartDesign_SubtractiveCone, PartDesign_SubtractiveEllipsoid, PartDesign_SubtractiveTorus, PartDesign_SubtractivePrism, PartDesign_SubtractiveWedge.
Transformation: PartDesign_Mirrored, PartDesign_LinearPattern, PartDesign_PolarPattern, PartDesign_MultiTransform, PartDesign_Scaled.
Dress-up: PartDesign_Fillet, PartDesign_Chamfer, PartDesign_Draft, PartDesign_Thickness.
Boolean: PartDesign_Boolean.
Each entry: { "id", "group" (Structure|Additive|Subtractive|Transformation|Dress-up|Boolean), "label" (FreeCAD's menu label), "reshape" (the reSHape Script word(s) that cover it, or null), "status": "shipped"|"queued"|"refused", "reason" (required non-empty when status is refused; e.g. ShapeBinder/SubShapeBinder/Clone are multi-body plumbing a single-body student tool does not need). Fill "reshape" and "status" from the CURRENT reSHape vocabulary in packages/script/src (read lib/reshape-script.ts's VOCABULARY export and the reference in packages/studio or shCode public/reshape/docs/reference.md): box/cylinder/sphere/cone/torus -> the additive primitives; pull -> Pad; spin -> Revolution; hole -> Hole (partial: simple only); hollow -> Thickness; round -> Fillet; chamfer -> Chamfer; blend -> AdditiveLoft; repeat -> LinearPattern; repeatAround -> PolarPattern; mirror -> Mirrored; cut/join/overlap -> Boolean; sketch -> NewSketch; draft angle -> Draft. Anything without a word is "queued". Do not mark anything shipped that has no word today.

## scripts/check-freecad-parity.mjs
- Loads parity/freecad-partdesign.json. Validates: every id above is present exactly once and in that order (hardcode the expected id list INSIDE the script so deleting an entry from the JSON fails the check); every entry has the required fields; refused entries have a reason; shipped entries have a non-null reshape word.
- Prints: "FreeCAD PartDesign parity: <shipped>/<total> shipped, <queued> queued, <refused> refused" then one line per queued tool.
- Exit 0 only when every non-refused tool is shipped; otherwise exit 1. (Refused-with-reason does not block.)
- --json prints the summary as JSON.

## docs/parity.md
Short: what the bar is, why Onshape's list was retired, how to add a word (edit the script vocabulary AND flip the JSON status; the checker fails if the JSON claims shipped for a word that does not exist in packages/script/src, so also implement that cross-check: grep the vocabulary file for each shipped entry's reshape word).

## Self-check before replying
node scripts/check-freecad-parity.mjs  -> prints the summary, exits 1 (queued tools remain today; that is correct).
node scripts/check-freecad-parity.mjs --json -> valid JSON.
Temporarily delete one entry from the JSON, run again, confirm it fails with a "missing id" line, restore it.
Reply with the exact output of the first two commands, the shipped/queued/refused counts, and ONE design decision the spec did not pin.
