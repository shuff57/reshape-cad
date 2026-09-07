# SPEC S2: official geometry names in the script vocabulary (reshape-cad)

Repo root (absolute): C:\Users\shuff57\Documents\GitHub\reshape-cad
Touched:
- packages/script/src/reshape-script.ts (VOCABULARY + fns: add official names as
  ALIASES of existing student words; NO behavior change to any fn body)
- packages/script/src/reshape-docs.ts (header comment: names-in-scope list grows
  the official aliases; NO page text changes in this pass)
- parity/freecad-partdesign.json (flip `reshape` fields of currently-shipped
  entries from student word to official name; statuses unchanged)
NOT touched: scripts/check-freecad-parity.mjs (checker greps the VOCABULARY file —
adding official words to that file makes the JSON flip pass the existing cross-check
with NO checker change, per #59/#60), packages/script/src/model-check.ts (studentWord
stays — failure messages still speak course words), transpile.mjs, engine/*, docs/parity.md.

## Why
Human directive (msgbox #58): the student-facing API moves to OFFICIAL geometry
names — cuboid, torus, fillet, chamfer, extrude, revolve, loft — because students
bind variables through these names and invented words (box, ring, round, bevel,
pull, spin, blend) don't transfer to real CAD. transpile.mjs v1 already models the
pattern (OFFICIAL_NAMES → STATEMENTS alias fold). Claude's #59/#60 call: (c) grow
VOCABULARY with official names NOW; the checker cross-check stays untouched; the
JSON never carries a soon-deprecated student word. Claude reviews the diff
(#60: "read the emitter diff + tests, kernel-container run if geometry is touched"
— no geometry is touched here, so no kernel run needed).

## The alias table (one row per renamed word; unlisted words keep their name)
box→cuboid, ring→torus, round→fillet, bevel→chamfer, pull→extrude, spin→revolve,
blend→loft, hollow→shell, cut→subtract, join→union, keep→intersect,
repeat→linearPattern, repeatAround→polarPattern, mirror→mirror (already official).
sphere, cone, cylinder, hole, holes, sketch, move, turn, draft, param: already
official (hole→holeThrough is transpiler-side only; the VOCABULARY hole(b, opts)
signature is a different API, not renamed here).

## Changes
1. reshape-script.ts VOCABULARY: extend the array with the 13 official names.
   Keep student words in the array. Comment the official-vs-student split once
   above the array (mirroring transpile.mjs's OFFICIAL_NAMES comment).
2. reshape-script.ts fns object (line ~1330): official names get the SAME function
   reference as their student word (cuboid: box, torus: ring, fillet: round,
   chamfer: bevel, extrude: pull, revolve: spin, loft: blend, shell: hollow,
   subtract: cut, union: join, intersect: keep, linearPattern: repeat,
   polarPattern: repeatAround). Same reference, not a wrapper — zero call
   overhead, zero drift.
3. reshape-docs.ts: header comment only — extend the names-in-scope sentence with
   the official aliases. (Page-by-page teaching copy is a later pass; scope-out
   comment states that.)
4. parity/freecad-partdesign.json: flip these shipped entries' reshape fields:
   PartDesign_AdditiveBox box→cuboid, PartDesign_AdditiveTorus ring→torus,
   PartDesign_Fillet round→fillet, PartDesign_Chamfer bevel→chamfer,
   PartDesign_Pad pull→extrude, PartDesign_Revolution spin→revolve,
   PartDesign_AdditiveLoft blend→loft, PartDesign_Thickness hollow→shell,
   PartDesign_Boolean join→union, PartDesign_LinearPattern repeat→linearPattern,
   PartDesign_PolarPattern repeatAround→polarPattern. Statuses stay shipped.
   (PartDesign_Hole stays hole — its reshape word is `hole`, which is official.)
   Queued entries stay null until their word ships (S2.1+).

## Self-check before replying (exact commands from repo root)
1. node scripts/check-freecad-parity.mjs → prints "17/46 shipped, 26 queued, 3
   refused" (same counts as today — statuses didn't move, only words), exit 1
   (queued remain), ZERO "problem:" lines (the cross-check must accept every
   flipped word: cuboid/torus/fillet/chamfer/extrude/revolve/loft/shell/union/
   linearPattern/polarPattern all appear quoted in reshape-script.ts).
2. node scripts/check-freecad-parity.mjs --json → valid JSON, ok:false, problems:[].
3. npm test → whole workspace green (transpile 11/11 + check-record OK).
4. Manual proof the alias is live: node -e importing dist is NOT possible before
   build; instead run a quick tsx-free check — run `npx tsc -p packages/script`
   is a build, out of scope. Instead: grep VOCABULARY contains all 13 names
   (rg "'cuboid'|'torus'|..." packages/script/src/reshape-script.ts) and tsc
   compiles the workspace: npm run build --workspaces --if-present → exit 0.

## Report (msgbox to claude, --re last)
- exact output of the four self-checks
- one design decision not pinned by this spec
- NOT verified: kernel-container run (no geometry touched — per #60 that means
  no kernel run is required for this pass; state it anyway)