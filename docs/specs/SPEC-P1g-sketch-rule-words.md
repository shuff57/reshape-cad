# SPEC P1g: reSHape Script words for the four P1d sketch rules

Repo root (absolute): `C:\Users\shuff57\Documents\GitHub\reshape-cad`
Built by: opencode. Reviewed/gated by: claude (same loop as P1a–P1f).

## The decision, and why it went this way

`reshape-script-gen.ts:144` **throws** when it meets a `distanceX`,
`distanceY`, `symmetric` or `angle` constraint:

> `toScript(): no reSHape Script word for 'distanceX' yet -- P1d added the solver rule but not the DSL syntax.`

The two options were: add the words, or have `toScript` skip a constraint it
cannot represent. **Add the words.** Three reasons, in the order that decided
it:

1. **Skipping is silent data loss.** `toScript` feeds Build → Code. A student
   adds a Symmetric rule, switches to Code, and the rule is gone; switching
   back rebuilds a doc without it. shCode's `test-reshape-script.mjs` asserts
   `runScript(toScript(doc)).doc equals the original doc` through
   `docsEqualUpToIds`, which deep-compares each feature — so a skip either
   fails that test or, worse, quietly loses a student's work in a path they
   take constantly. A throw is bad; losing work without saying so is worse.
2. **The throw's own justification argues for this.** Its comment says *"Fail
   loud rather than emit a call the interpreter cannot parse back."* That is
   correct, and its premise is that an unparseable call is the thing to avoid.
   Making the call parseable dissolves the dilemma instead of picking a side of
   it.
3. **It is small and symmetric.** Seven rule methods already exist on
   `SketchHandle`; this adds four more in the same shape, one per Point rules
   row. Compare P1e's `pocket`, which needed a feature kind, a kernel path, a
   codegen slot and a parity flip. This needs none of that — these are sketch
   rules, not features.

The original comment called this "an unscoped DSL addition." That was true when
nothing could create these constraints and the throw was unreachable. **P1f
made it reachable** — the Point rules panel creates all four — so the scope
question was answered by shipping the panel, and this is the other half of that
slice.

## Scope

Touch these and nothing else:

1. `packages/script/src/reshape-script.ts`
2. `packages/script/src/reshape-script-gen.ts`
3. `packages/script/test/sketch-rule-words.test.mjs` — new

**NOT touched:** `packages/sketch/` (the solver already honours all four),
`packages/studio/` (the panel already creates them), `packages/kernel/`,
`parity/`, `engine/`, anything in shCode. In particular **do not** touch
`scripts/check-freecad-parity.mjs` or the parity JSON: these are sketch rules,
not PartDesign tools, and no ledger entry moves.

## 1. The four names, pinned

The file's own rule (`reshape-script.ts:547-550`) is that a rule method carries
**the Rules panel's own word, not a renamed synonym**. The panel labels its
four rows `Dist X`, `Dist Y`, `Symmetric`, `Angle`. So:

| method | signature | writes |
|---|---|---|
| `distX` | `(a, b, value)` | `{ kind: 'distanceX', a, b, value }` |
| `distY` | `(a, b, value)` | `{ kind: 'distanceY', a, b, value }` |
| `symmetric` | `(a, b, center)` | `{ kind: 'symmetric', a, b, center }` |
| `angle` | `(edge, other, degrees)` | `{ kind: 'angle', edge, other, degrees }` |

**`distX` and not `across`.** `.across(edge)` already exists and means "this
edge is level". The panel overloads the word — its Dist X rules read
*"corner 1→3 across = 12"* — but a DSL cannot, because `.across(3)` and
`.across(1, 3, 12)` differing only by arity is exactly the cleverness that
produces a bug report nobody can read. `distX`/`distY` transcribe the row
labels and collide with nothing.

**All numbers are 1-based**, like every existing rule method, because they are
the numbers the panel shows a student.

## 2. `reshape-script.ts`

### 2.1 The `SketchHandle` interface (line 539-558)

Add after `pin`:

```ts
  distX(a: unknown, b: unknown, value: unknown): SketchHandle;
  distY(a: unknown, b: unknown, value: unknown): SketchHandle;
  symmetric(a: unknown, b: unknown, center: unknown): SketchHandle;
  angle(edge: unknown, other: unknown, degrees: unknown): SketchHandle;
```

### 2.2 The implementations, beside `pin` (line 1028)

Follow `equal()` (line 1001-1009) exactly: read the live feature, convert with
`wholeIndex`, refuse the degenerate case with a sentence, normalise the pair,
then `applyConstraint`.

```ts
      distX(a, b, value) {
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const i = wholeIndex('.distX()', 'corner', a, count);
        const j = wholeIndex('.distX()', 'other', b, count);
        if (i === j) throw new Error('.distX() needs two DIFFERENT corners.');
        const v = requiredNumber('.distX()', 'value', value);
        applyConstraint(id, {
          kind: 'distanceX', a: Math.min(i, j), b: Math.max(i, j),
          value: num(v, id, `dx${Math.min(i, j)}_${Math.max(i, j)}`),
        });
        return handle;
      },
```

`distY` is the same with `'.distY()'` and `kind: 'distanceY'`.

`symmetric(a, b, center)`: normalise `a`/`b` the same way, but **leave `center`
exactly as given** — it is a distinct role, not a pair member, and may be lower
than both endpoints. Refuse `a === b`, and refuse `center === a || center === b`
with *".symmetric() needs the about corner to be a THIRD corner."*

`angle(edge, other, degrees)`: `wholeIndex` on both against `cur.points.length`,
refuse `edge === other`, normalise to `Math.min`/`Math.max`, store `degrees`.

**Use `requiredNumber`, NOT `positiveNumber`.** All three numeric values are
SIGNED here — a negative gap or a negative turn is a distinct, meaningful ask.
`engine/play/sketch.js:874-877` says the same, and `packages/studio`'s writers
already keep the sign. `.length()` uses `positiveNumber` because a negative
length is meaningless; do not copy that line.

### 2.3 `VOCABULARY` — DO NOT TOUCH IT

`VOCABULARY` lists top-level DSL words and is what the parity checker greps.
These four are **methods on a sketch handle**, exactly like `across`, `pin` and
`equal`, none of which appear there. Adding them would move the parity ledger
for something that is not a PartDesign tool. If you find yourself editing
`VOCABULARY` or `fns`, stop — you have taken a wrong turn.

## 3. `reshape-script-gen.ts` — delete the throw

Replace the whole `if (c.kind === 'distanceX' || ...) { throw ... }` block
(lines ~135-144) with emission, keeping the 1-based convention every other line
in that function uses:

```ts
  if (c.kind === 'distanceX') return `${v}.distX(${c.a + 1}, ${c.b + 1}, ${lit(c.value)})`;
  if (c.kind === 'distanceY') return `${v}.distY(${c.a + 1}, ${c.b + 1}, ${lit(c.value)})`;
  if (c.kind === 'symmetric') return `${v}.symmetric(${c.a + 1}, ${c.b + 1}, ${c.center + 1})`;
  if (c.kind === 'angle') return `${v}.angle(${c.edge + 1}, ${c.other + 1}, ${lit(c.degrees)})`;
```

Leave a short comment recording that this used to throw and why it no longer
does — the throw was correct while the constraints were unreachable, and P1f
made them reachable.

Note the final line of that function is the equal/parallel/perpendicular
fallthrough reading `c.edge`/`c.other`. Your four branches must come BEFORE it,
as the throw did, or `distanceX` (which has no `.edge`) falls into it and emits
`undefined`.

## 4. `packages/script/test/sketch-rule-words.test.mjs`

Import from `../dist/`, same as `pocket-word.test.mjs`. Assert:

| # | assertion |
|---|---|
| 1 | `sk.distX(1, 3, 12)` stores `{kind:'distanceX', a:0, b:2, value:12}` — 1-based in, 0-based stored |
| 2 | `sk.distX(3, 1, 12)` normalises to the same thing |
| 3 | `sk.symmetric(3, 1, 2)` stores `a:0, b:2, center:1` — a/b normalised, center untouched |
| 4 | `sk.angle(4, 2, 30)` stores `edge:1, other:3, degrees:30` |
| 5 | negative values survive all three numeric methods (`-5`, `-5`, `-30`) |
| 6 | `sk.distX(2, 2, 5)` throws naming DIFFERENT corners; `sk.symmetric(1, 3, 1)` throws naming a THIRD corner |
| 7 | an out-of-range corner is refused by `wholeIndex` (whatever it already says — assert the throw, not the wording) |
| 8 | **ROUND TRIP, the one that matters.** Build a doc containing all four rule kinds, `toScript` it, re-run the emitted text, and assert the rebuilt sketch's `constraints` deep-equal the original's. This is the assertion that would have caught the throw, and the one a skip-instead-of-emit design could never pass. |

## Self-check before you reply

```
npm run build --workspaces
npm test
node ../shCode/scripts/test-reshape-script.mjs --occt ../shCode/public/reshape/kernel
```

All three must exit 0. The third is shCode's own round-trip suite (99/99 as of
`5488d11a`) and it exercises `toScript` hard — if these four words are wrong, it
is likelier to say so than anything in this repo.

## What you CANNOT verify

The browser half. `shCode/scripts/drive-point-rules.py` currently ALLOWS these
throws as a known state and fails on any other page error; once this lands, the
throws should stop. **Do not edit that script** — it is in another repo and the
lead will re-run it and tighten it.

## One unpinned decision, and I want your answer on it

`distX`/`distY` versus some other pair of names. I chose them to transcribe the
panel's row labels and to avoid the `.across()` collision described in §1. If,
having written the methods beside `across`/`up`/`pin`, you think a reader meets
a worse ambiguity than the one I avoided, say so and name the alternative.
