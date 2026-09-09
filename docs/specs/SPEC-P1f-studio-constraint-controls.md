# SPEC P1f: controls for the four constraints the solver already honours

Repo root (absolute): `C:\Users\shuff57\Documents\GitHub\reshape-cad`
Built by: opencode. Reviewed/gated by: claude (same loop as P1a–P1e).

## Why

`packages/sketch/src/sketch-solve.ts:38-55` declares eleven constraint kinds.
The solver solves all eleven. `packages/studio/src/model/SketchConstraints.tsx`
— the Rules panel, the only place a student can create, see or remove a
constraint in the React studio shCode embeds — offers seven. Four are
unreachable:

| kind | shape | indexes |
|---|---|---|
| `distanceX` | `{ a, b, value }` | two CORNERS |
| `distanceY` | `{ a, b, value }` | two CORNERS |
| `symmetric` | `{ a, b, center }` | three CORNERS |
| `angle` | `{ edge, other, degrees }` | two EDGES |

This is the same defect the panel's own gate was written for: `equal` was
declared, solved, scored, described and marked shipped while having no control
anywhere. Nothing failed, because nothing was asking.

shCode's `npm test` is **red right now** on exactly this
(`scripts/check-constraint-ui.mjs`), so this slice unblocks a downstream repo.

## The gate that named this was itself broken. Read this before trusting it.

`check-constraint-ui.mjs` parsed the union with `/kind:\s*'([a-z]+)'/` — a
lowercase-only class that cannot match a camelCase kind. It captured the
leading `distance` off `distanceX`/`distanceY`, found no `'distance'` control,
and reported **only** `symmetric` and `angle`, because `distanceX` was never in
the list to be missing from. Fixed by the lead 2026-09-09 (shCode `9507d464`);
it now reports all four.

**That checker is a grep tripwire, not a proof.** It strips comments and asks
whether the panel text contains `'symmetric'`. Writing
`const UNUSED = ['symmetric', 'angle']` would satisfy it completely. So it is
**necessary and nowhere near sufficient**, and §5 below is the check that
actually holds. Do not treat a green tripwire as done.

## Scope

Touch these and nothing else:

1. `packages/studio/src/model/SketchConstraints.tsx`
2. `packages/studio/package.json` — add a `test` script (§5)
3. `packages/studio/test/point-rules.test.mjs` — new

**NOT touched:** `packages/sketch/` (the solver already handles all eleven —
this slice adds no solver work), `packages/script/`, `packages/kernel/`,
`engine/`, `parity/`, anything in shCode (a different repo, and its checker is
lead-owned).

## 1. The interaction model, decided — do not redesign it

`engine/play` already shipped these four in P1d, and its model is the right
one: pick geometry on the canvas, buttons enable when the selection fits,
a popup asks for the number. **You are not porting that.** It drives the
FreeCAD bridge (`sess().constrainAngle(...)`); this panel writes
`Constraint[]` for the TypeScript least-squares solver, and it has no canvas
selection channel at all — it receives `points` and renders grids.

So: **a new "Point rules" section**, appended after the existing corner
controls, in the panel's own idiom (selects and number boxes, like the Length
and Round boxes already there). Four rows:

| row | inputs | writes |
|---|---|---|
| Dist X | corner A select, corner B select, number | `{ kind: 'distanceX', a, b, value }` |
| Dist Y | corner A select, corner B select, number | `{ kind: 'distanceY', a, b, value }` |
| Symmetric | corner A, corner B, "about" corner select | `{ kind: 'symmetric', a, b, center }` |
| Angle | edge A select, edge B select, degrees | `{ kind: 'angle', edge, other, degrees }` |

Plus a list of the rules of these four kinds that currently exist, each with a
remove control. A student must be able to **create, see and remove** one —
that is the sentence the gate's own failure message uses, and all three verbs
are required.

**Why not fold Angle into the existing edge-pair picker**, which already
handles two edges and to which angle is semantically a generalisation: that
picker is a one-click keyboard-navigable popup whose choices take no value
(`PAIR_CHOICES`, line 244). Angle needs a number, which breaks both its
one-click contract and its arrow-key model. Kept separate deliberately.

**The UX tradeoff, stated rather than hidden:** selects are clumsier than
clicking geometry. They are what this panel can do today without a canvas
selection channel, and adding that channel is a larger slice than this one.
Say so in your reply if you disagree; do not silently build something else.

## 2. Rules the writes must obey

- **Normalise the pair.** Every existing pair write puts the lower index in the
  first field and the higher in the second (`setPairKind`, line 234-240), so a
  pair stored one way can never be read as a different pair. Do the same for
  `distanceX`/`distanceY` (`a` < `b`) and for `angle` (`edge` < `other`).
  `symmetric` is NOT symmetric in its arguments — `center` is a distinct role —
  so normalise `a`/`b` only and leave `center` alone.
- **One rule per (kind, pair).** Adding a `distanceX` for a pair that already
  has one REPLACES it, exactly as `setPairKind` replaces. Two contradictory
  distances on one pair is not a state the solver should ever see.
- **Refuse degenerate selections.** `a === b` is not a rule; for `symmetric`,
  `center` equal to either endpoint is not a rule. Refuse in the UI (disabled
  control) rather than writing a constraint the solver must then fight.
- **Route every write through `settle()`** (line 533), never `onChange`
  directly. That is what runs `addConstraintSettling` and produces the
  "removed also" note; bypassing it silently drops the panel's conflict
  handling.
- **Signed values are real.** `distanceX`, `distanceY` and `angle` are SIGNED
  in this solver — a negative gap or a negative turn is a distinct, meaningful
  ask, and `engine/play/sketch.js:874-877` says so explicitly. Do not
  `Math.abs()` them and do not reject a minus sign.
- **Degrees, not radians.** The union field is `degrees`. Store what the
  student typed.

## 3. What NOT to do

- Do not add kinds to the `Constraint` union. All four already exist.
- Do not touch `PairKind`, `PAIR_CYCLES`, `PAIR_CHOICES`, `pairKind`,
  `cyclePair` or `setPairKind`. The existing pair machinery is load-bearing and
  carries its own history; this section is additive.
- Do not "fix" the legacy `bulges` branches or anything else you notice on the
  way through. The file is 1226 lines and most of what looks odd is documented
  in place. Mention it in your reply instead.

## 4. Pure functions, exported — this is the part that matters

Put every constraint-writing decision in **exported pure functions** that take
`Constraint[]` and return `Constraint[]`, with the JSX calling them. At minimum:

```ts
export function setPointRule(
  cs: Constraint[], kind: 'distanceX' | 'distanceY', a: number, b: number, value: number
): Constraint[]

export function setSymmetric(
  cs: Constraint[], a: number, b: number, center: number
): Constraint[]

export function setAngle(
  cs: Constraint[], edge: number, other: number, degrees: number
): Constraint[]

export function removeRule(cs: Constraint[], rule: Constraint): Constraint[]
```

The reason is not tidiness. **JSX is not gateable in this repo** — there is no
React test harness and no browser in your session — so anything that lives only
inside a component is proven by nothing but `tsc`. Logic in an exported
function is proven by §5. This is the split between what gets measured and what
gets type-checked, and I want it explicit rather than accidental.

## 5. `packages/studio/test/point-rules.test.mjs` — the real check

`packages/studio` has no `test` script today. Add one:

```json
"test": "node --test \"test/*.test.mjs\""
```

> **CORRECTED after the build.** This originally said `node --test test/`.
> That was wrong: `packages/script` and `packages/sketch` both already use the
> quoted-glob form, so the glob *is* "matching how `packages/script/test/`
> resolves" — the sentence right below. The builder deviated deliberately, said
> so, and offered to flip it back; it was right and the spec was not.

so `npm test --workspaces --if-present` picks it up from the root. Import from
`../dist/`, matching how `packages/script/test/` resolves.

Assert at least:

| # | assertion |
|---|---|
| 1 | `setPointRule([], 'distanceX', 3, 1, 12)` normalises to `a: 1, b: 3` |
| 2 | applying `distanceX` twice to the same pair leaves ONE rule, with the second value |
| 3 | a `distanceX` and a `distanceY` on the same pair coexist — they are different kinds |
| 4 | `setSymmetric` normalises `a`/`b` but leaves `center` exactly as given, including when `center < a` |
| 5 | `setAngle(cs, 4, 2, 30)` normalises to `edge: 2, other: 4` and keeps `degrees: 30` |
| 6 | a negative value survives all three writers unchanged (−5, −5, −30) |
| 7 | `removeRule` removes exactly the named rule and nothing else, including when a rule of another kind shares the pair |
| 8 | none of the writers mutates the array it was given |

Assertion 8 is not ceremony: every caller here passes the live `constraints`
prop, and a writer that mutates it corrupts React state in a way that shows up
much later as a rule that will not clear.

## Self-check before you reply

Report the exact numbers:

```
npm run build --workspaces
npm test --workspaces --if-present
node ../shCode/scripts/check-constraint-ui.mjs
```

The third must print `constraint UI: 11 solver kinds, all reachable from the
Rules panel` and exit 0. Remember it is a tripwire — passing it is the floor,
not the ceiling.

## What you CANNOT verify, and must say so plainly

No browser, so nothing about the rendered controls is proven: whether the
selects populate, whether disabled states are right, whether the remove control
is reachable, whether it looks like the rest of the panel. Say that; do not
imply the UI works because `tsc` was clean.

## One unpinned decision, and I want your answer on it

Where the "Point rules" section goes, and whether it is one section with four
rows or two (corner rules, then the angle row, which is edge-indexed and
arguably belongs with the other edge rules). I have not seen the rendered panel
and you will have read the whole file — tell me which reads better and why.
