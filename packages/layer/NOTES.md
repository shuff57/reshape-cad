# Oddities noticed in the original while porting (NOT fixed; the port preserves each one)

Source: `docs/spikes/solidcraft-referee/phase7/pane/lib/`. Each item below is behaviour the differential test shows the port shares.
They are written down so that a later pass can decide, with the owner, whether to change them.

1. **`move` of a target that has no body can make `translateDoc` reject.** `planFeature` returns `produces: needBody(f.target)`, which is
   `null` when the target is a sketch or was never built. If the engine then ACCEPTS the command list, `aggregate(res, null)` throws
   `Cannot read properties of null (reading 'join')` outside the per-feature try/catch, so the whole call rejects instead of refusing that
   one feature. A real engine rejects `bodies: null`, so the spike never hit it; the fake engine can
   (see the `move-of-a-sketch-throws` doc, and 28 cases in the corpus that reach it). `rotate`, `mirror` have the same `bs!` shape but are
   stopped earlier by the missing `st.measure[...]`. This breaks the "refused per feature, alongside whatever built" promise on that input.
2. **`nameOf(id)` in sketch-map can be `undefined`** for a geometry kind that mapSketch itself refused ("does not draw ... point, line,
   circle and arc only"). `pt()` / `curve()` then read `n.points` / `.curve` on it and throw a TypeError. `translateDoc` catches it and
   reports `translator error: Cannot read properties of undefined (reading 'points')` instead of the sketch's rule sentence.
3. **Malformed primitives throw inside the planner and come out as `translator error: ...` sentences** (for example a `box` with no
   `size`: "Cannot read properties of undefined (reading '0')"). The student-visible text is a JavaScript error message, not a plain sentence.
4. **`SoupRule` (model-types.ts) does not declare `driving` or `active`**, which sketch-map and rule-check both read
   (`r.driving === false`, `r.active === false`). The port types them as `SoupRule & { driving?: boolean; active?: boolean }` (`RuleRow`).
5. **`frameOf` exists twice** with the same body (translate-p4 uses `ctx.mt.sketchFrameOf` first, sketch-map has its own copy, and
   `mapSketch` never consults `ctx.mt`). The two can disagree if `ctx.mt` is ever not the plain model-types function.
6. **`translateDoc` returns `_state`** (the internal state, including a `Map` and every accepted command) as part of its public
   result, because `resolveAfter` needs it. A caller that serialises the result gets the Map as `{}`.
7. **The `ctx` doc comment in the original lists `resolveAt`**, which nothing reads; the pane passes `resolveAt: () => null` anyway. The
   port's `TranslateCtx` has no `resolveAt`.
8. **`plan.noop` and refusals share one return shape by truthiness.** A refusal is detected by a truthy `refusal`; every refusal sentence is
   non-empty today, so `'refusal' in plan` (the port) and `plan.refusal` (the original) agree. An empty-string refusal would behave
   differently. None exists.
9. **`confirmOnTarget` / `makeEnv` call `ctx.topologyOf` unguarded.** `translateDoc` only resolves names when `ctx.topologyOf` exists, but
   `resolveAfter` does not check, so without it the call throws "ctx.topologyOf is not a function" inside a try and the message becomes the
   refusal text. The port keeps the call shape (a `!` assertion) so the text is identical.
10. **Combine `join` fallback for patterns tries two variants, the second without the join**, so a pattern whose join the engine refuses
    still "builds" as separate bodies; the feature is then `built` with several bodies, and every later feature that needs a single body
    refuses. This is intentional in the original ("keep them as separate bodies") but it means `built` does not imply one solid.
11. **`docProfileIndices` and `checkRules` index rows by id with no existence check**, so a rule naming a missing id throws a TypeError to
    the caller (the pane wraps them). Preserved; the differential test compares the thrown message.

# Oddities noticed in the extrude-pocket fork (contract/translate-ep.mjs) while porting (NOT fixed; the port preserves each one)

12. **The fork is not only the 'extrude' and 'pocket' cases.** Its header says so, the diff against phase7 translate-p4.mjs says otherwise. It also changes:
    the dependency sentences of EVERY kind ("was refused, so there is nothing to build on", "already used up by"), the "no usable outline" sentence
    (inSketch/profileCmds, so revolve, groove, blend, cone and prism sketches too), the whole 'combine' planner (pieces, join-contact guards, `verify`),
    the measure of a feature (split-off pieces "name (2)" count; `shells` added), the planner-error wording (+ `internalError`), the kernel-refusal wording
    (`plainKernelSentence`), `checks` on built notes, and `st.scene` / `st.curvedSlant` in the state. All of that rides in the 'extrude-pocket' Profile; base is untouched.
13. **Not a pure planner swap.** Because of 12, the seam is a `Profile` (planners + wording + bookkeeping hooks), not only a kind -> planner map.
14. **`ctx.skipVerify` and `ctx.unguardedSlant`** are measuring switches of the group's own harness living in the production translator. Ported as optional context fields.
15. **`optionPlan` for a pocket with `through` needs `before.bbox`**; with no measured target it refuses with "a through-all pocket needs the part it cuts, and it was not measured"
    (unreachable through planFeature's own flow except via an unmeasured body).
16. **`verify: undefined` is an own key** on every non-join combine plan, and the pull plan carries `flagCurvedSlant: false` as an own key; the port keeps both so plans compare deep-equal.
17. **Verification closures re-enter the engine** (`env.runSC`), so a doc with N material regions in a pocket costs N scratch sessions per piece; the differential test compares those calls too.
18. **`ep-results.json` lists 473 cases; 7 scripts do not run** under runScript (pl-both-midplane, pl-zero-length2, pt-90, pd-alongnormal-alone, pd-zero-vector, fc-pocket-depth-negative, fc-pocket-depth-zero): they are refusal cases the language itself rejects, so no ModelDoc exists for them.
19. **`soup-regions` `evenOddPicks` samples at 0.25 degree**, so a circle of any size becomes 1440 points; a doc with 24 circles is slow in pure JS (this is most of the test run time).
