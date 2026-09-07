# SPEC S1: transpiler v1 — reSHape Script → bridge fc-commands (reshape-cad)

Repo root (absolute): C:\Users\shuff57\Documents\GitHub\reshape-cad
Touched: packages/script/src/transpile.mjs (rewritten), packages/script/test/transpile.test.mjs
(rewritten), docs/specs/ (this file), engine/bridge/fc-commands.mjs (additive: one new
emitter + wrapper, no existing emitter edited), engine/bridge/hole-test.mjs (NEW,
unit-testable half of the hole integration gate), engine/bridge/transpile-integration.mjs
(NEW, runs in the lead's kernel container).
NOT touched: engine/bridge/fc-session.mjs, every existing engine/bridge/*-test.mjs,
scripts/check-freecad-parity.mjs (per msgbox #53), packages/script/src/*.ts.
Plain Node ESM (.mjs), no npm dependencies.

## Why
v0 emitted raw `Part::` primitives (Part::Box / Part::Cut) as one Python blob. The
production path is PartDesign through the typed-command channel the studio UI already
uses (engine/bridge/fc-commands.mjs emit.* + attachCommands) — Claude flagged the retarget
as the v0 review's one gap (msgbox #24) and confirmed S1 as the next SPEC (#53): the
transpiler emits fc-commands DIRECTLY, no adapter layer; a word needing a missing bridge
command grows fc-commands.mjs instead (that's S2, but hole needs one now, so it's here).

## The command model
transpile(src) returns { commands, python } —
- commands: an ordered array of typed command objects, one per student statement,
  `{ op: 'newBody' | 'sketchRect' | 'sketchCircle' | 'pad' | 'pocket' | 'revolve', args: [...] }`.
  Each op maps 1:1 to an attachCommands() method of the same name with the same
  positional args — the studio wiring (S4) will run `session[cmd.op](...cmd.args)`.
- python: the concatenation of emit.<op>(...args) snippets, in order — the same Python
  the typed commands would send, so the lead's FreeCAD 1.1.3 oracle still gates the
  emitted strings (the proven #24 loop).

## Statement lowering (per word)
- box(l, w, h) → newBody + sketchRect + pad. Pad Length = h.
- cylinder(r, h) → newBody + sketchCircle + pad. Pad Length = h.
- hole(d[, x, y]) → sketchCircle (the cutting circle) + pocket. Requires a current
  solid (box or cylinder) in the SAME body; error otherwise ("hole needs a solid
  to cut, but no box or cylinder statement came before it"). Defaults x,y = the
  current solid's footprint center for a box, 0,0 otherwise (v0 semantics kept).
  The pocket needs a depth that reaches through: emit.pocket exists but its `length`
  is the ACTUAL pocket depth — for a through-hole the student means "cut all the
  way", so hole uses a new through-pocket emitter (below).
- spin(angle) [S1 extension, optional to implement last] — NOT in v0; listed only so
  the dispatch table shape is future-proof. Do not implement in S1.

## hole → through-pocket (the one fc-commands addition)
Add emit.holeThrough(bodyName, sketchName, holeName) to engine/bridge/fc-commands.mjs:
a PartDesign::Pocket with Type = 'ThroughAll' (the FreeCAD hole idiom — cuts through
the whole body regardless of depth, no depth number to compute and get wrong).
Clean-status wrapper like pocket: on Invalid/null shape, delete the feature and
recompute, raise a short message. attachCommands gains session.holeThrough returning
holeName. The sketch for the hole circle is created on the SAME body as the current
solid (a pocket on a body with no solid yet fails the clean-status guard — good,
that's the "no solid to cut" error surfaced at runtime).

## Naming
freshName() keeps FreeCAD's scheme (Body, Body001; Sketch, Sketch001; Pad, Pad001 …)
per body statement-chain. Each box/cylinder statement starts a NEW body (single-solid
model, one Body per student "thing" — the PartDesign model: features accumulate on
one body). hole does NOT start a body; it adds a sketch+pocket to the current body.

## Errors (transpile-time, student-facing)
- unknown word → "unknown reSHape statement \"<name>\" (v1 supports box, cylinder, hole)"
- non-number argument → "\"<name>\" argument \"<a>\" is not a number"
- wrong arity → same shape as v0
- hole with no current solid → "hole needs a solid to cut, but no box or cylinder
  statement came before it"

## Self-check before replying (exact commands, run from repo root)
1. node --test packages/script/test/transpile.test.mjs  → all pass, exit 0
2. node --test engine/bridge/commands-test.mjs          → all pass (regression: my
   fc-commands addition must not break existing emitters), exit 0
3. node --test engine/bridge/hole-test.mjs              → all pass (string-shape tests
   for holeThrough), exit 0
4. node --test "packages/script/test/*.test.mjs"       → whole package suite passes
5. Verify by hand: transpile('box(40, 40, 20); hole(6)') emits commands
   [newBody, sketchRect, pad, sketchCircle, holeThrough] and python that
   contains "ThroughAll" and no "Part::Cut" and no "Part::Box".

## Report (reply to the lead via msgbox, --re last)
- exact output of commands 1-4
- one design decision the spec did not pin
- what was NOT verified (Python-side execution needs the lead's kernel container;
  that's engine/bridge/transpile-integration.mjs, written but not run here — no
  wasm kernel on this box, per #27's known limit)