# Critic round for picks-naming-params (repro scripts, not part of the contract JSON)

Both scripts run on the standard rig (RIG.md) and print one line per case with the closed form, both oracles and SolidCraft.

* `concave-chamfer.mjs`: chamfer of a swept^swept edge at a reflex vertex of an extruded L/T/U polygon builds a wrong solid with no sentence (page translator too: `window.__host.translateRaw`).
  Contract row 12 ("swept ... edge(swept, swept) ... supported") only measured rectangles and a fillet on one non-rectangular outline.
* `draft-after-hollow-pierce.mjs`: hollow, then draft a carried face by an angle whose inward move exceeds the wall (the tilted plane enters the cavity). Contract row 16 ("carried through hollow ... draft face") has no such case.
* Not scripted here (reproduced through the phase 7 page, session `ppspike`): `const b = cuboid(40,40,20)\nconst c = cuboid(10,50,10,{at:[0,0,10]})\nconst d = subtract(b,c)\nround(d.edge('bottom','front'),2)`
  is refused by the page with "matches 3 separate edges ... that do not form one closed loop" although OCCT, brep-rs and the phase-0 translator all build 29965.66; r3-guard.mjs plainFor() has no rule for that text, so a student would see the raw sentence.
