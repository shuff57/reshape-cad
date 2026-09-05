# Y3 — Save / hand-edit / reopen (yardstick task)

## Goal

Prove the file round-trips: a model built in the browser engine is saved, opened
and edited in desktop FreeCAD 1.1.3, saved there, and reopened in the browser
showing the changed result.

## Steps

1. Rebuild the Y1 L-bracket model (or open an existing Y1 build) in the browser
   engine.
2. Save it as `Y1-bracket.FCStd` and move/copy the file somewhere desktop
   FreeCAD can reach.
3. Open `Y1-bracket.FCStd` in desktop FreeCAD 1.1.3
   (`C:\Users\shuff57\AppData\Local\Programs\FreeCAD 1.1\bin\freecadcmd.exe`
   or the matching GUI).
4. There, change the Pad length of the big plate from 10 mm to 12 mm, recompute,
   and save.
5. Reopen the saved file in the browser engine.

## Dimensions

| Feature | Size (mm) |
|---|---|
| Pad length edit | 10 → 12 on the 80 × 60 plate |

## Finished-state assertion

After reopening in the browser, the displayed volume equals the Y1 volume with
the big plate 12 mm thick instead of 10: big plate 80·60·12 = 57 600 (instead of
48 000), so expected volume = 68 151.77 + 9 600 = **77 751.77 mm³ ± 1 %**
(accept 76 974.25 – 78 529.29). The browser must show this new volume (or a
value within 1 % of it) after the round-trip; the file must open without
errors in both directions.