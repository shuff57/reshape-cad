# Phase 5: a friendly constrained-sketch syntax (spike layer over the existing soup)

**SPIKE. Referee/demo only: not an engine, not an `EngineAdapter`, no engine mode, nothing under `packages/`, `scripts/`, CI or
config, not in `npm test`, no change to the interpreter.** brep-rs stays the one kernel of reSHape CAD. Whether solidcraft is
ever a referee, or anything more, is **UNDECIDED**; this page exists so a person can look at it and help decide.

## What it is

Phases 3 and 4 wrote constrained 2D examples as raw rows (`sk.geom([{k:'line',id:1,...}])`, `sk.rules([{k:'coincident',a:1,aEnd:'b',...}])`).
Phase 5 designs a readable handle syntax (`sk.line`, `base.b`, `sk.tangent`, `sk.length(base, 40)`, `sk.fix(base.a)`, ...) and
implements it as a **shim** (`friendly-sketch.mjs`) that runs inside the sandboxed runner iframe bundle next to the
interpreter. The runner prepends one line (no newline, so script line numbers are unchanged) that shadows `sketch()` with a
wrapper around the interpreter's own. The wrapper accumulates shapes and rules and, on **every call**, lowers them to the
interpreter's existing `sk.geom([...])` and `sk.rules([...])` (which each *replace* what was there; measured).

Design and the full vocabulary table: **[SYNTAX.md](SYNTAX.md)**. Evidence and tables: **[VERIFY.md](VERIFY.md)**.

## What it is NOT

* **Not a language change.** `packages/script` is untouched. The friendly words do not exist in the interpreter, in
  `VOCABULARY`, in `dependsOn`, or in the ModelDoc. They exist only in this spike's runner bundle.
* **No new ModelDoc kind.** The output is the same `geoms` / `rules` soup. The phase 2 mapper and phase 4 translator are
  byte-identical copies and are not told anything about it.
* **Round trip is unchanged, and says so:** `toScript(doc)` of a friendly sketch emits the *soup* (`sk.geom([...])`,
  `sk.rules([...])`), never the friendly words. Feeding that text back gives the same doc (checked, VERIFY.md section 2b).
  A student who edits in the studio sees rows, not handles. Friendly text is input sugar, exactly like the interpreter's own
  `sk.slot()` ("toScript never reverse-engineers a composite").
* **Not enabled in the main app origin.** The shim is bundled into the sandboxed iframe (`sandbox="allow-scripts"`, no
  `allow-same-origin`); `reshape-script.ts` is still imported only there.
* **Not a solver.** The shim only writes rows. Solving is solidcraft's (browser demo) or brep-rs's / `solveDoc`'s, as before.
* **Depends on one internal name:** the preamble reads the interpreter's `with()` scope parameter, `__RESHAPE_SCOPE__`
  (`SCOPE_NAME` in `reshape-script.ts`). If that is renamed the shim fails loudly on every run, not silently.

## Launch (one command, one URL)

```sh
# once per checkout, if packages/*/dist does not exist yet:
npm run build

sh docs/spikes/solidcraft-referee/phase5/run.sh
```

Open **http://127.0.0.1:8798/** (the only URL it prints; the app is on :8799, framed by the host page only). Ctrl-C stops it.
It **reuses** the phase 4 patched solidcraft app at `~/.cache/solidcraft-bridge/dist-p4` (`bridge.patch` is byte-identical to
phase 4's, so the build stamp matches and nothing is rebuilt; `--rebuild` would only be needed if that dist is missing).
Phase 4 (`:8796`/`:8797`) and phase 3 can run beside it. The new gallery groups are at the top: **FRIENDLY SKETCH** (9) and
**FRIENDLY SKETCH misuse** (12); the 35 phase 4 examples follow, unchanged.

## Files

| | |
|---|---|
| `friendly-sketch.mjs` | the shim (no imports, no DOM) |
| `examples.mjs` | the 8 friendly examples and 9 misuse scripts |
| `host/` | copy of `phase4/host` + `src/runner-entry.mjs` that bundles the shim (`bundle/` is generated) |
| `make-reference.mjs` | measures the friendly group on live brep-rs / OCCT, merges into `host/examples.json` |
| `verify-equivalence.mjs` | Node: friendly vs soup through the real interpreter, `toScript` round trip, phase 4 scripts unchanged. Writes `equivalence-results.json` |
| `verify-misuse.mjs` | Node: gallery misuse, drift guard, reserved names, rollback, duplicate suppression, critic scripts. Writes `misuse-results.json` |
| `verify-browser.mjs` | headless playwright (`spike` session): whole gallery, browser equivalence, misuse. Writes `browser-results.json`, `screenshots/` |
| `run.sh`, `serve.mjs`, `bridge.patch` | phase 4's, ports 8798 / 8799 |

## Headline results (details in VERIFY.md)

* **Equivalence, Node:** 5 of 5 friendly re-expressions give the same ModelDoc as the soup original through the real
  interpreter: 4 STRICT (`deepStrictEqual` on the whole doc), 1 CANONICAL (one join row written in the other orientation).
* **Equivalence, browser:** 5 of 5 give the **same volume to the last bit** and the **same solidcraft sketch report**
  (status, dof, failing, redundant, profile count) as the soup original.
* **New examples:** bracket 18500.373 vs brep-rs 18500.389 (rel 8.8e-7, curved bar 3e-4); symmetric T 7000.000 = brep-rs =
  closed form; same T about `sk.yAxis` 7000.000 = closed form, brep-rs refuses an axis mirror (a kernel gap, not new).
* **Misuse:** 12 of 12 gallery scripts stop with one plain sentence on the right line, send nothing to solidcraft, and the
  document is unchanged; `verify-misuse.mjs` (Node) 48 of 48 checks, including the critic's 29 scripts (none throws, errors carry a line).
* **Phase 4 gallery:** 35 of 35 entries behave as in phase 4 (29 pass or expected refusal, 6 red `DIVERGES` by design), and the
  29 phase 4 *scripts* produce the identical ModelDoc with and without the preamble.

## Gaps (honest)

1. **No `toScript` for friendly text** (by design; see above). A round trip loses the handle names.
2. **A never-touched `sketch()` extrudes the interpreter's documented default 40 x 25 rectangle** (10000 mm3; phase 4 relies
   on it); the shim cannot see `extrude`, so this is stated, not refused (gallery `fr-untouched-default`, page limits box).
   A sketch EMPTIED by `sk.remove()` is refused (`misuse-remove-all`; this was a silent wrong solid in the first cut).
3. **Directed rules and arc words:** `sk.angle`/`dx`/`dy` are directed (solidcraft refuses a start on the other side) and
   `'cw'`/`'ccw'` picks which of two arcs you get, with no warning. See SYNTAX.md "Things that bite".
   **`sk.remove` drops every rule naming the shape** (also dimensions on other shapes); a refused removal is now rolled back.
4. **solidcraft misreports dof on an already-tangent start.** `fr-bracket-rounded` is drawn exactly tangent, so the report
   reads dof 8 with 8 "redundant" tangent rows (hand count 0); the slot reads dof 4, same as its soup original. The solid is
   right. This is phase 2's documented limit; it is not hidden and not fixed here.
5. **brep-rs refuses axis-keyed `symmetric` / `pointOnObject`** (`line -3 has zero length`); solidcraft builds it. So
   `fr-symmetric-axis` is scored against the closed form only. Use a construction line (`fr-symmetric-profile`) for a brep-rs-checked mirror.
6. **OCCT cannot referee any of these** (its reference reads rows rather than solving them and refuses constraints,
   construction geometry and axis rules); the friendly group's references are brep-rs live + closed form.
7. **The interpreter's own ReferenceError wording leaks through for an undefined name** (`rigth is not a tool here. Did you
   mean ring()?`): plain, on the right line, but its "did you mean" suggests a tool, not your handle. Not mine to change.
8. **Equality of row *order* is by construction, not a rule.** Four of five examples are strictly identical because they are
   written in the soup's order. Written another way, the doc is equal as a multiset, not as a list (the triangle).
9. **No `sk.fillet`.** Rounded corners are drawn as arcs plus `sk.tangent` (8 lines of script for the bracket).
10. **Eager lowering is O(n) per call, O(n^2) per sketch.** Fine at 60 shapes; not measured beyond that.
11. **One internal name** (`__RESHAPE_SCOPE__`) is relied on; a mismatch gives one drift sentence (tested), and `sketch` is
    replaced on the scope object, not declared, so a student's own `const sketch` shadows it harmlessly.
