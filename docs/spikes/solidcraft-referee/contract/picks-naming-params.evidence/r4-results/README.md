# Round 4 (rig rebuilt; critic follow-up)

* `page/` = unguarded page translator (translate-p4), `guarded/` = through r3-guard.mjs (`r3-run-sec.mjs` wrapper or the sweep script's own switch).
* `rerun-check/` = the round 1-3 measurement scripts re-run on the freshly rebuilt rig (pkg built from git archive fe3717f, RIG.md): every sec*/r2* log
  is line-identical to r3-results/sec once exponents are masked; resI/resI2/resP/resH match the saved json to 4 significant digits; resG has the same
  outcome tally (245 PASS / 7 FAIL / 6 NOOP / 4+26 REFUSED).
* Scripts: r4a-reflex (swept^swept bevel/round at convex and reflex vertices), r4b-draft-hollow (critic's draft-after-hollow), r4c-subtract-edge,
  r4d/r4e/r4f (pocket corner bevel: size x depth x thickness), r4g/r4h (hollow-then-draft-a-wall sweep vs OCCT and the exact half-space closed form),
  r4i (round before the cut workaround).
* r3-guard.mjs additions: G-DRAFTWALL, inside-corner sentence for G-BEVEL, plain rule for "matches N separate edges". r3a-r3i and every sec* log re-run
  unchanged after the additions.
