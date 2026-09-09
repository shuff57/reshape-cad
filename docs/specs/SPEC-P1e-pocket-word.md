# SPEC P1e: the ModelDoc `pocket` word (the 29 → 30 parity lift)

Repo root (absolute): `C:\Users\shuff57\Documents\GitHub\reshape-cad`
Built by: opencode. Reviewed/gated by: claude (same loop as P1a–P1d).

## Why

`SPEC-P1-parity-closeout.md` §"Sequencing + gates" names **30/46 shipped** as
P1a's gate. `scripts/check-freecad-parity.mjs` reports **29/46**, and the whole
difference is one entry:

```
PartDesign_Pocket   reshape: null   status: queued
```

`pocket()` already works as a **P1b transpiler statement** over the FreeCAD
bridge (`packages/script/src/transpile.mjs:197`, gated by
`engine/bridge/pocket-test.mjs`). But the parity checker cross-checks the
**ModelDoc / reSHape DSL vocabulary** — it greps `packages/script/src/
reshape-script.ts` for the word — and there is no `pocket` there. So the
feature works on one surface and the ledger is honest about the other.

This is the **only** queued ledger entry not parked by an explicit decision.
The other five (`PartDesign_Plane/_Line/_Point/_CoordinateSystem` behind
sketch-on-plane; `PartDesign_Hole` staying partial per plan B3) are deferred in
`.msgbox/FUTURE.md` with reasons. Closing Pocket closes the last open number.

## A NEW GATE EXISTS. Read this before you assume the OCCT path is unprovable.

Every P1a ModelDoc kind — `prism`, `wedge`, `groove` — shipped **typed but
never executed**, because `packages/kernel/src/occt-build.ts` runs on
`replicad_single.wasm`, which is 23 MB, gitignored, and fetched at runtime by
`getKernelBaseUrl()` from the shCode app. Nothing in this repo called
`buildDoc`.

**Measured by the lead, 2026-09-09: that is no longer true.** The replicad
emscripten glue initialises under plain Node, and the repo's own
`packages/kernel/dist/occt-build.js` builds real solids against it:

| slice | measured |
|---|---|
| rect sketch 20×10 on `xy`, `extrude` height 5 | volume **1000.000** mm³ (exact) |
| 40×40×20 box, `groove` from an `xz` profile | **32000.000 → 30335.225** mm³ — real material removed |

So the pocket branch you write **will be executed against the real kernel**,
not merely type-checked. Write it as if it will be measured, because it will.

The harness is `scripts/occt-modeldoc-gate.mjs`. **It is LEAD-OWNED. Do not
create it, do not edit it, do not run it.** A builder running its own gate
proves nothing.

## Scope

Touch these files and nothing else:

1. `packages/script/src/model-types.ts`
2. `packages/kernel/src/occt-build.ts`
3. `packages/script/src/reshape-script.ts`
4. `packages/script/src/reshape-script-gen.ts`
5. `packages/script/src/model-codegen.ts`
6. `parity/freecad-partdesign.json`
7. `packages/script/test/` — one new test file, `pocket-word.test.mjs`

**NOT touched:** `scripts/check-freecad-parity.mjs` (lead-owned, per msgbox
#53 — the expected-id list is hardcoded there on purpose),
`packages/script/src/transpile.mjs` (the bridge `pocket` statement already
exists and is correct; this slice does not change it), `packages/studio/`,
`engine/`, `packages/sketch/`, `scripts/occt-modeldoc-gate.mjs`.

## 1. `model-types.ts` — the kind

### 1.1 `PocketFeature`, immediately after `GrooveFeature` (which ends line 130)

`GrooveFeature` is the template: same two references, a number instead of an
angle.

```ts
/** A subtractive extrude — the pocket. Pulls the target sketch's profile
 *  straight DOWN into an earlier solid and cuts it away. The ModelDoc twin of
 *  the bridge's PartDesign::Pocket emitter and of transpile.mjs's pocket()
 *  statement; the additive twin already exists as ExtrudeFeature. */
export interface PocketFeature {
  id: string;
  kind: 'pocket';
  name?: string;
  /** The sketch whose profile is pulled into the cutting block. */
  target: string;
  /** The solid the pocket is cut into. */
  into: string;
  /** How far into the solid to cut, in mm. Always positive; the DIRECTION is
   *  fixed (into the material, opposite the way extrude pulls) so a student
   *  cannot type a sign that silently cuts air. */
  depth: number;
}
```

### 1.2 `Feature` union, line 439-447

Add `| PocketFeature` on the `RevolveFeature | GrooveFeature | ...` line, right
after `GrooveFeature`.

### 1.3 `newPocket`, immediately after `newGroove` (line 826-828)

```ts
/** The pocket twin of newExtrude: same profile contract, but the pulled block
 *  is cut out of a named solid instead of standing on its own. `into` is
 *  required for the same reason groove's is — a pocket with nothing to cut is
 *  not a pocket. */
export function newPocket(doc: ModelDoc, target: string, into: string): PocketFeature {
  return { id: nextId(doc, 'pocket'), kind: 'pocket', target, into, depth: 5 };
}
```

### 1.4 label map, line 1144

Add `: f.kind === 'pocket' ? 'Pocket'` immediately after the `'groove'` line.

### 1.5 `dependsOn` — DO NOT TOUCH IT, but read this

`dependsOn()` (line 460) returns `[f.target, ...named]` for anything with a
`target` field. **`f.into` is invisible to it.** That is a pre-existing latent
gap that `groove` already has: delete the solid a groove cuts into and the
groove keeps a dangling reference.

`pocket` inherits it exactly, by design for this slice. **Do not fix it here.**
Fixing it changes `groove`'s behaviour too, and that is a separate slice with
its own regression surface. If you touch `dependsOn` this slice is rejected.
State in your reply that you left it alone.

## 2. `occt-build.ts` — the kernel branch

Insert a `pocket` branch immediately after the `groove` branch (which closes at
line 611, just before `} else if (f.kind === 'combine')`).

It is the **`extrude` branch's prism** (line 634-650) feeding the **`groove`
branch's cut** (line 610). Both already exist; write neither from scratch.

```ts
    } else if (f.kind === 'pocket') {
      // Subtractive extrude: pull the profile sketch straight into the named
      // solid and CUT the block away. The prism is the extrude branch's; the
      // cut is the groove branch's. No sweep history is recorded for the same
      // reason groove records none -- a cut's faces come from the boolean,
      // not from the prism.
      const face = built.get(f.target);
      const src = doc.features.find((x) => x.id === f.target);
      const base = built.get(f.into);
      if (face && src && src.kind === 'sketch' && base) {
        const a = PLANE_AXES[src.plane ?? 'xy'] ?? PLANE_AXES.xy;
        // NEGATIVE where extrude is positive: a pad pulls the profile up out
        // of the plane, a pocket pushes it down into the material. `depth` is
        // documented positive so this sign lives here, once, rather than in
        // every student's head.
        const h = -f.depth * a.dir;
        const v = new oc.gp_Vec(a.n[0] * h, a.n[1] * h, a.n[2] * h);
        const tool = new oc.BRepPrimAPI_MakePrism(face, v, false, true).Shape();
        shape = boolean('BRepAlgoAPI_Cut', base, tool, f.id, [f.into]);
      }
    }
```

Note `a.dir` is `-1` for `xz` (line 341) — that asymmetry is deliberate and
already load-bearing for extrude; reuse it, do not special-case a plane.

**The gate's exact expectation, so you can predict it:** a 40×40×20 box
(volume 32000) with a 10×8 rect sketch on `xy` pocketed 5 deep leaves
**31600.000 mm³** — exactly `32000 - 10*8*5`. If your branch returns 32000 the
cut went the wrong way (it cut air above the box) and the feature *succeeded
while doing nothing*, which is the failure this project keeps producing. If it
returns something between, the prism is not fully inside the material.

## 3. `reshape-script.ts` — the vocabulary word

### 3.1 `VOCABULARY`, line 178

The line currently reads:

```ts
  'prism', 'wedge', 'groove',
```

Make it:

```ts
  'prism', 'wedge', 'groove', 'pocket',
```

`pocket` is a **student word**, not an official-name alias — it goes in the
student block, not the official block at the bottom. FreeCAD calls the tool
Pocket and the transpiler statement is already `pocket(...)`; there is no
second name to alias.

### 3.2 the function, immediately after `groove` (line 778-786)

```ts
  // pocket(sketch, target, depth): the subtractive extrude — pull the profile
  // straight into the target solid and CUT the block out. Mirror of pull(),
  // with the solid it cuts named. Same argument order as groove() on purpose:
  // profile first, victim second, number last.
  function pocket(sk: unknown, target: unknown, depth: unknown): SolidHandle {
    if (!isSketchHandle(sk)) throw new Error('pocket() needs a sketch: pocket(sketch1, shape, depth).');
    if (!isHandle(target)) throw new Error('pocket() needs a shape to cut: pocket(sketch1, shape, depth).');
    requiredNumber('pocket', 'depth', depth);
    const f = newPocket(docNow(), sk.id, target.id);
    f.depth = num(depth, f.id, 'depth');
    pushFeature(f);
    return makeSolidHandle(f);
  }
```

Import `newPocket` and `PocketFeature` alongside the existing `newGroove` /
`GrooveFeature` imports.

### 3.3 the `fns` record, line 1392

```ts
    prism, wedge, groove, pocket,
```

`tsc` enforces both directions between `VOCABULARY` and `fns`, so 3.1 and 3.3
must land together or the build fails. That is the intended safety net.

## 4. `reshape-script-gen.ts` — round-trip

After the `groove` block (line 446-449):

```ts
    if (f.kind === 'pocket') {
      lines.push(`pocket(${v(f.target)}, ${v(f.into)}, ${numText(bindings, f.id, 'depth', lit(f.depth))})`);
      return;
    }
```

Note `groove` pushes a bare statement, not `const ${f.id} = ...`. Match that:
a cut modifies an existing solid, it does not introduce a new binding.

## 5. `model-codegen.ts` — the param slot

### 5.1 read side, after the `groove` block (line 111-112)

```ts
    } else if (f.kind === 'pocket') {
      push('depth', 'deep', f.depth);
```

`'deep'` is the student-facing label — it is what `hole` already uses for the
same measurement (`reshape-docs.ts:115`, `hole(b, { across: 6, deep: 10 })`).
Do not invent a second word for it.

### 5.2 write side, after the `groove` block (line 355-357)

```ts
    if (f.kind === 'pocket') {
      if (slot === 'depth') { changed = true; return { ...f, depth: value }; }
    }
```

## 6. `parity/freecad-partdesign.json`

The `PartDesign_Pocket` entry (line 180-187) becomes:

```json
    {
      "id": "PartDesign_Pocket",
      "group": "Subtractive",
      "label": "Pocket a selected sketch",
      "reshape": "pocket",
      "status": "shipped",
      "reason": null
    },
```

Change **only** those two fields on that one entry. Do not reorder anything —
the checker asserts the exact order against its own hardcoded list and will
fail loudly if you do.

## 7. `packages/script/test/pocket-word.test.mjs`

A new `node:test` file in the shape of the existing `transpile.test.mjs`.
Import from `../dist/` (the built output), matching how the sibling tests
resolve. Assert, at minimum:

| # | assertion |
|---|---|
| 1 | `newPocket(doc, 'sk1', 'box1')` returns `kind: 'pocket'`, `depth: 5`, and an id starting `pocket` |
| 2 | `pocket(sk, box, 7)` inside a run pushes a feature with `depth === 7` and `into === box.id` |
| 3 | `pocket(sk, box)` with no depth throws, and the message names `pocket` and `depth` |
| 4 | `pocket(box, box, 5)` — a solid where the sketch goes — throws `needs a sketch` |
| 5 | `toScript` of a doc with a pocket emits exactly `pocket(sk1, box1, 5)`-shaped text, and it round-trips: re-running the emitted script rebuilds a doc whose pocket has the same `target`, `into` and `depth` |
| 6 | `featureLabel` of a pocket is `'Pocket'` |
| 7 | codegen exposes a `deep` slot reading 5, and setting it to 9 returns a feature with `depth === 9` |
| 8 | `VOCABULARY` includes `'pocket'` |

Assertion 5 is the one that matters most — it is the same round-trip proof P1a
required, and it is what catches a word that can be typed but never re-read.

## Self-check before you reply

Run and report the exact numbers:

```
npm run build --workspaces
npm test --workspaces --if-present
node scripts/check-freecad-parity.mjs
```

The parity checker must print **`30/46 shipped, 5 queued, 11 refused`**. It
currently prints 29/46 with 6 queued; that flip is this slice's headline
number.

> **CORRECTION, after the build (the builder caught this and was right).**
> This section originally also demanded **exit 0**. That is unsatisfiable and
> always was: `check-freecad-parity.mjs:176` exits non-zero unless every
> non-refused entry is shipped, and five stay queued or partial *by explicit
> decision* (the four datum tools behind sketch-on-plane, and Hole staying
> partial per plan B3). Exit **1** with a clean 30/46 print and zero
> `problems` is the correct outcome for this slice. Verified independently by
> the lead: `30/46 shipped, 5 queued, 11 refused`, exit 1, no problems.

## What you CANNOT verify, and must say so plainly

You cannot run `scripts/occt-modeldoc-gate.mjs` (lead-owned) and you have no
browser. So the §2 kernel branch is **transcription, not proof** when it leaves
your hands — say that in your reply rather than implying the volume is right.
Everything in §1 and §3–§7 you can and must actually run.

## One unpinned decision, and I want your answer on it

`newPocket` defaults `depth: 5`. `newExtrude` defaults `height: 12`; `newGroove`
defaults `angle: 360`. A default is what a student gets from a toolbar click
before typing anything, so it should be a depth that visibly cuts a typical
part without punching through it. Tell me whether 5 is right, and why — I have
not measured it against anything.
