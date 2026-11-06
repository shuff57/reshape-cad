# Next-work loop, phase 1: Family C re-measure (0.21.0 rig)

Date: 2026-11-06. Spec: `.cache/PLAN-next-0.21.0.md`, phase 1. Previous state: `REMAINING-LOOP-PHASE1.md` finding 3 (family C not reached).
Kernel: `sc-referee-pkg` (pinned SolidCraft 0.21.0 wasm rig, wasm sha256 `b49e952d…`); shipped-path pass on `sc-referee-pkg-topology`
(the unmodified `phase2/wrapper2` build of the same rig, `packages/layer/NOTES.md` "Moved picks"). Pick source for path A: `archive/brep-rs/pkg`
(read-only, sha256 `85c94526…`). Independent oracles: OCCT (`replicad-opencascadejs` 1.1.0, the referee apparatus loaded from `packages/brep-adapter/dist/`
by path; nothing imports it) and the fuzz plane-offset oracle `oracle.mjs` (h = 0.05). Tolerance: 1e-3 rel, as in `README.md`.

## Verdict

**Family C is a measured tolerance, not a wrong solid.** On 0.21.0 the layer builds the plain R = 1.5t bottom-fillet hollow within
**1.7e-5 (t = 0.5, R = 0.75)** and **4.9e-6 (t = 1, R = 1.5)** of OCCT, and within 1.9e-5 over every R = 1.5t case run (t = 0.5 to 2.5, the
three documented repros). OCCT and the plane-offset oracle agree with each other to 4.5e-7 or better (6.5e-5 with a through hole, inside the
oracle's lattice accuracy). The documented 1.0–1.9e-3 offset (p8 CLI on the fe3717f-based patch) **does not reproduce on 0.21.0**: the repro
`p8-s1-00475`'s own command list now builds 958.0107 (documented 959.2526) against OCCT 958.0136 and P 958.0139.
Fuzz self-check passed first: 136/136 closed forms + 9/9 Euclid cross-checks within 1.5% (max 2.1e-3, same as the previous loop), 32/32.
No case has a wrong solid. The exit check ("R = 1.5t carries a measured, owner-visible tolerance, both oracles recorded") is met.

## The wiring (`packages/layer/src/shell-draft.ts`, `filletEdgeAt`)

Why it was not reached: the 'shell-draft' set planned a fillet with the base planner, which takes the edge only from the engine's topology
(`resolveNamesFor` + `confirmOnTarget`). The node rig returns measures and no topology, so every named fillet was refused ("could not be resolved to
a single edge") before the hollow was planned.

What changed: when the host supplies `ctx.resolveAt` (the group's primitive-frame pick source, the same seam the set already uses for the hollow's
open face and the draft's face), a fillet's `between` edge is picked at the point it returns: the midpoint of the edge on the primitive as made.
That point is used only when it is provably still on the same edge of the part being rounded, so the engine's nearest-edge pick cannot land elsewhere:

- the name is an edge between two different, non-opposite primitive faces of one plain box (no whole-shape round, no turn), so the edge is straight;
- every step from that box to the fillet's target is itself a fillet or bevel (no move, turn, hole, cut, join, mirror or pattern);
- no earlier fillet in that history is on the same edge, and each is smaller than half this edge's length (a neighbouring fillet trims this edge
  by at most its own size at the shared corner, so the midpoint survives);
- one candidate only (the phase0 original's three extra points one "radius" out exist for a closed circle; a box edge never is one).

Anything else returns null and the fillet is planned exactly as before (path B, the engine's topology), with the same sentences.
No refusal sentence or user-facing word was added or changed. No kernel is named (`ctx.resolveAt` is a context field; `pickedFrom` reads
`ctx.resolveAt (primitive frame; only fillets in the history)`, internal evidence). The 'fillet-chamfer' and 'unified' sets are untouched: unified
routes every fillet to the fillet-chamfer step. `dependsOn`/`VOCABULARY`, `archive/`, the frozen gates and `occt-build.ts` are untouched.

Tests: `packages/layer/test/fillet-resolve-at.test.mjs` (12 tests, fake engine): path A picks the four bottom edges at their midpoints with one
candidate, and a bevel and a vertical edge too. Path B is kept for a move in the history, the same edge twice, an earlier fillet at half the edge
length, a turned box, a whole-shape round, a hole in the history, opposite faces, a face of another feature, no resolver, and a resolver that answers
nothing, a face, or an edge with no length. A one-fillet doc comes out deep-equal to the run with no resolver.

## Second-oracle finding: OCCT `buildDoc` does not build this doc's solid

Scored first against `buildDoc(oc, doc)`, all eight family-C cases came out 3e-3 to 1.9e-2 off. The unshelled part was already off (box with
four bottom fillets, 40x30x10, R 1.5: buildDoc 11915.346 vs closed-form oracle S 11933.696, layer 11933.670). Step by step: round1 and round2 match
the closed form exactly (each removes 19.31417 = (1 - pi/4) R^2 L). Round3 (`bottom`/`left`) removes 23.01273 and adds two faces of area 20.0
at (-19.45, +-14.45, 5.75). Those are quarter cylinders of R 1.5 over 8.5 mm, i.e. OCCT also rounded the two vertical left edges. OCCT's
`BRepFilletAPI_MakeFillet` follows the tangent-continuous chain: the bottom-left edge runs tangent into the arc that round1 left on the left face,
and that arc runs tangent into the vertical edge. SolidCraft rounds only the named edge, which is what the doc asks for.

So the OCCT number the verdict uses is OCCT built **directly** from the case (in `family-c-run.mjs`, `occtDirect`): the four bottom edges
(picked by geometry) in one `MakeFillet` (four edges at right angles, no chain into the vertical edges), through holes as a cylinder cut, and the
hollow by the same `MakeThickSolidByJoin(..., BRepOffset_Skin, ..., GeomAbs_Arc)` call `occt-build.ts` makes, with the top face removed. Its
unshelled part matches S to 1.7e-7 (1.3e-5 with a hole). Both OCCT numbers are recorded per case. The buildDoc behaviour is an apparatus
finding (OCCT's propagation is not SolidCraft's or the doc's meaning of "round this edge"). It is not fixed here: the apparatus wiring stays as it
is. Whether any frozen gate builds adjacent sequential fillets was not checked.

## Cases and numbers

Harness: `packages/layer/test/family-c-run.mjs` (one script → one ModelDoc → layer / OCCT direct / OCCT buildDoc / P, plus the unshelled part, plus
the repro's raw command list). Layer = `createTranslator({ planners: 'shell-draft' })` with `ctx.resolveAt`, scene volume of the accepted commands.

| case | verdict | layer | OCCT (direct) | P | layer/OCCT | layer/P | OCCT/P | OCCT buildDoc (layer/bd) | raw repro list now / documented p8 |
|---|---|---|---|---|---|---|---|---|---|
| `control-plain-box-t1` | MATCH | 2424.0000 | — (buildDoc used) | 2424.0000 | 3.8e-16 | 1.9e-16 | — | 2424.0000 (3.8e-16) | — |
| `C-plain-40x30x10-t0.5-R0.75` | MATCH | 1240.5590 | 1240.5800 | 1240.5802 | 1.7e-5 | 1.7e-5 | 1.8e-7 | 1236.3774 (3.4e-3) | — |
| `C-plain-40x30x10-t1-R1.5` | MATCH | 2364.7170 | 2364.7286 | 2364.7293 | 4.9e-6 | 5.2e-6 | 3.1e-7 | 2348.2758 (7.0e-3) | — |
| `C-plain-40x30x10-t1.5-R2.25` | MATCH | 3376.0134 | 3376.0586 | 3376.0597 | 1.3e-5 | 1.4e-5 | 3.4e-7 | 3339.8445 (1.1e-2) | — |
| `C-plain-40x30x10-t2-R3` | MATCH | 4278.1031 | 4278.1828 | 4278.1845 | 1.9e-5 | 1.9e-5 | 3.9e-7 | 4215.2330 (1.5e-2) | — |
| `C-plain-40x30x10-t2.5-R3.75` | MATCH | 5074.6799 | 5074.7141 | 5074.7145 | 6.7e-6 | 6.8e-6 | 6.9e-8 | 4978.5904 (1.9e-2) | — |
| `C-repro-s1-00475` (30x24x12, t 0.5) | MATCH | 958.0107 | 958.0136 | 958.0139 | 3.1e-6 | 3.4e-6 | 3.0e-7 | 952.9526 (5.3e-3) | 958.0107 / 959.2526 |
| `C-repro-s2-00591` (30x24x6, t 0.5) | MATCH | 640.0114 | 640.0136 | 640.0139 | 3.6e-6 | 4.0e-6 | 4.5e-7 | 637.5278 (3.9e-3) | 640.0113 / 641.2128 |
| `C-gen-s2-01562` (24x20x6 + through hole, t 0.5; regenerated by `gen.mjs`, no repro file existed) | MATCH | 504.8562 | 504.8588 | 504.8259 | 5.0e-6 | 6.0e-5 | 6.5e-5 | 502.3730 (4.9e-3) | 504.8563 / — |
| `B-gen-s1-01725` (bfillet R 1.5t + blind hole) | REFUSED (G-BLIND) | — | — (OCCT offset not done) | 1414.1543 | — | — | — | refused by OCCT too | — |
| `B-gen-s2-00829` (bfillet R t + blind hole) | REFUSED (G-BLIND) | — | — (OCCT offset not done) | 2752.2761 | — | — | — | refused by OCCT too | — |

Unshelled part (the hollow's target), relative to the closed-form oracle S: layer 6.5e-7 to 1.3e-5, OCCT direct 1.5e-8 to 1.3e-5,
OCCT buildDoc 3.9e-4 to 9.1e-3 (the propagation above). The layer reads slightly low on every curved case (2e-6 to 1.9e-5, growing with R).
Why was not established. A volume measured on a faceted surface would do it, but that was not tested.

**Shipped path** (the 'unified' set, edges from the engine's own topology, no `ctx.resolveAt`, on `sc-referee-pkg-topology`): all eight family-C
cases build every fillet (the fillet-chamfer step) and the hollow, and match OCCT direct: 1.69e-5, 4.93e-6, 1.34e-5, 1.87e-5, 9.02e-6, 3.08e-6,
3.58e-6, 4.94e-6 (same row order). So the tolerance holds for what a student gets, not only for the shell-draft set. On the same rig the
'shell-draft' set on its own (path B) refuses round3 with the base's existing sentence ("... that edge is no longer present whole ..."): round1
and round2 trim the bottom-left edge. That refusal is unchanged.

**Measured tolerance to record for R = 1.5t:** |layer − OCCT| / OCCT ≤ 1.9e-5 (max over t = 0.5 to 2.5 and the repros; 1.7e-5 at t = 0.5,
4.9e-6 at t = 1), with OCCT and the plane-offset oracle agreeing to ≤ 4.5e-7. The old 1.0–1.9e-3 figure belongs to the p8 patch CLI and is
superseded on 0.21.0.

## Guard-layer fuzz re-run (the previous loop's 30 cases, `fuzz-guard-run.mjs`)

0 WRONG. MATCH 9 (was 7), REFUSED 21 (was 19), not reached 0 (was 4). The two family-C rows now build and MATCH P
(`C-bfillet-t1-R1.5` 5.2e-6, `C-bfillet-t0.5-R0.75` 1.7e-5). The two convex family-A rows (vertical fillets + hole, ligament 1.5 in (t, 2t)) are now
reached and refused by the guard that belongs to them (G-HOLE for the through hole, G-BLIND for the blind one). Every other row is
unchanged. `fuzz-guard-run.mjs` now resolves the repo from its own location (it was the main checkout's absolute path, so the value there is the
same). That lets it score the tree it lives in, and `live-gate.sh` behaves as before.

## Controls

- Negative control: `NEGATIVE_CONTROL=1` (both OCCT numbers × 1.01) → 9 WRONG + 8 shipped WRONG, exit 1. The verdict is not vacuous.
- Plain open box: layer, OCCT and P agree to 4e-16.

## Reproduce (each under the shared rig lock, one at a time)

```
R=~/.cache/solidcraft-0.21.0-rig
flock $R/next-loop/rig.lock env SOLIDCRAFT_REFEREE_PKG=$R/sc-referee-pkg BREP_PKG=<main checkout>/archive/brep-rs/pkg \
  OUT=<out.json> node packages/layer/test/family-c-run.mjs                      # exit 0 iff 0 WRONG (layer and shipped path)
flock $R/next-loop/rig.lock env SOLIDCRAFT_REFEREE_PKG=$R/sc-referee-pkg BREP_PKG=... OUT=<out.json> node packages/layer/test/fuzz-guard-run.mjs
(cd <copy of fuzz/oracle.mjs + selfcheck*.mjs> && node selfcheck.mjs && node selfcheck2.mjs)   # writes selfcheck*.json beside it, not into the repo
```

Evidence: `next-loop-p1-family-c.json` (this directory; the run above, with the per-case features, picks, both OCCT numbers, the unshelled
volumes and the shipped-path rows). Raw logs and the other JSON are outside the repo: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/p1-*.log` and
`state/p1-{famc,famc-neg,fuzz-guard}.json`, with `state/p1-selfcheck/selfcheck{,2}.json`.

## Open

- OCCT `buildDoc` builds adjacent sequential per-edge fillets wrong: it also rounds the edges along the tangent chain. It is not a referee for
  that shape class until its fillet branch is told to stop at the named edge. That code is not touched here.
- Family B on a bottom fillet (blind hole) has no OCCT number: OCCT's offset does not finish there. The layer refuses those shapes (G-BLIND), so no
  wrong solid is possible.
- The layer's small low bias on curved faces (≤ 1.9e-5) is not explained.
