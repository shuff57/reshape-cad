# Guard: named fillets one call per chain, and an errored body (2026-11-07)

Two layer fixes from the SolidCore probe (`SOLIDCORE-PROBE-0.40.0-rc.2.md`):

- **Fix 2, an errored body: committed** (below).
- **Fix 1, named fillets one call per chain: halted, not committed.** On 0.30.1 it changes built volumes, and it turns three family-C hollows that were right into
  wrong ones. The record and the patch are outside the repo, in `~/.cache/solidcraft-0.21.0-rig/next-loop/fcx/hold/` (`FIX1-HALT.md`, `fix1.patch`), for the owner.

Rigs, each run under its own lock:

- SolidCraft 0.21.0 corrected: `~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, topology `sc-referee-pkg-topology`, lock `next-loop/rig.lock`.
- 0.30.1: `~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, topology `sc-referee-pkg-topology`, lock `rig.lock`.
- 0.40.0-rc.2: `~/.cache/solidcraft-0.40.0-rc.2-rig/sc-referee-pkg`, topology `sc-referee-pkg-topology`, lock `rig.lock`.

Logs are in `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/fcx-*`. Rows, trees and scripts are in `.../next-loop/fcx/`.

Each live harness ran on three trees:

- `base`: HEAD f040bbbc, built;
- `fix2`: fix 2 alone;
- `both`: both fixes.

`fcx/cmp.mjs <before> <after>` lists every status change and every built volume change over 1e-9 relative.

Oracles: OCCT (`replicad-opencascadejs`, built directly from the case's edges in one `MakeFillet`, as in `family-c-run.mjs` `occtDirect`), the fuzz closed form S and
the plane-offset oracle P (`fuzz/oracle.mjs`). brep-rs (`archive/brep-rs/pkg` of the main checkout, read-only) is the pick source of path A.

## Fix 2: an errored body is refused in one sentence

### The finding

`SOLIDCORE-PROBE-0.40.0-rc.2.md`, "Far sphere". On rc.2, `sphere(2, { at: [1000000, -1000000, 1000000] })` answers `ok`, and its body is an error:
`{ name, error: "the operation failed: SMLib: solidcore: flat arrays: a NURBS form that is not its analytic surface", material }`. It has no volume and no
bounding box. Every reader of a body result (`aggregate` and its copies, the scene, the after-the-build checks) reads `bbox.min`. So `translateDoc` threw
`TypeError: Cannot read properties of undefined (reading 'min')` in all nine sets. The student got no sentence and no part.

In production the primitives guard (f040bbbc) now refuses this sphere before any run ("too far from the origin"). The throw is still reached by any errored body
that guard does not cover. With `ctx.skipPrimitives` it is reached on this sphere, which is how it is measured here.

### The fix

`packages/layer/src/errored-body.ts`. `translateDoc` wraps `ctx.runSC` once (`withErroredBodies`):

- **An errored body is one that carries `error`, or has no bounding box to read.** An `ok` reply with one becomes a failed reply: `ok: false`, `erroredBody` names
  the bodies, and `failed` records the engine's text.
- **Every reader takes its existing failure path**, so nothing reads the missing box. That includes the scratch runs of the after-the-build checks.
- **Sync and async both pass through.** A synchronous engine stays synchronous, and the arguments and `this` pass through unchanged. An `ok` reply is returned as
  the same object.
- **Each set words the refusal the same way.** The generic loop and the holes, shell-draft, patterns-mirror, booleans (the combine executor too), revolve-groove
  and fillet-chamfer steps (the grouped blend too) refuse the feature with the owner's sentence, verbatim. `{id}` is the planners' prefix `id (kind)`:

  `ball1 (sphere): this shape could not be built, so it is shown without it; check its sizes and position.`

  The guard code is `ERRORED-BODY`. The patterns-mirror step keeps it as the student sentence, and the fillet-chamfer step keeps it in place of its mapped wording
  (the raw text stays in `st.refused`, as for every refusal of that step). Nothing else changes. `unified.ts` is not edited: it runs those steps.

No other sentence was added or changed, and no kernel is named.

### Tests

`packages/layer/test/errored-body.test.mjs` (3 tests, fake engine that answers a sphere at 1e5 or more the way the probe recorded it):

- in all nine sets and the host entry (`host-entry.mjs translateDoc`), on an async and a sync engine, a box beside the far sphere builds (1000 mm3). The sphere is
  refused with the sentence and `ERRORED-BODY`, nothing of it is accepted, and nothing throws;
- with the primitives guard on (production), the sphere is refused by `PRIMITIVES` before any engine call, in every set and the host;
- the wrapper unit: identity on an ok reply, sync stays sync, arguments and options pass through, wrapping twice is a no-op, a missing bounding box counts, and a
  failed reply is left alone.

Before the fix, HEAD threw in all nine sets on the same input (`TypeError ... reading 'min'`).

### Live

Harness: `packages/layer/test/fillet-chain-run.mjs`. It runs the far sphere through the host entry and every set, on both pick paths, with the primitives guard
on and off. The same harness also covers the fix-1 fillet cases. `fcx/cmp.mjs base fix2`:

| pkg | far sphere, guard on (production) | far sphere, `skipPrimitives` | every other row (family-C 30, fuzz 30, chain 133) |
|---|---|---|---|
| rc.2 | refused by `PRIMITIVES` (19 of 19), as before | **THREW 19 -> refused 19**, every one `ERRORED-BODY` with the sentence | 0 changes |
| 0.30.1 | refused by `PRIMITIVES`, as before | built, as before (this engine does not error there) | 0 changes |
| 0.21.0 corrected | as 0.30.1 | as 0.30.1 | 0 changes |

Errored-body throws: 19 before, **0 after**. Truck volume changes: **0** (every built volume equal to 1e-9 relative, on 0.21.0 and 0.30.1).

Through the host route on 0.21.0 corrected (`port/host-route.mjs`, the shipped `unified` set at `'full'` with pane.js's ctx; `port/cmp.mjs` fix2 against base,
`fcx/hr-fix2.cmp.json`):

| corpus | docs | before | after | new refusals | over-refusal | other changes |
|---|---|---|---|---|---|---|
| fillet-chamfer (`fc`) | 2309 | RIGHT 864, REFUSED 1227, WRONG 119, ORACLES-SPLIT 54, BUILT-ORACLES-REFUSE 45 | the same | 0 | 0 | 0 |
| shell-draft (`sd`) | 1097 | RIGHT 626, REFUSED 471 | the same | 0 | 0 | 0 |

The 119 WRONG are the corner-convention rows HALT-4 triaged as not wrong, unchanged. No row threw before or after.

Host checks (the bundle rebuilt with `sh packages/solidcraft-host/pane/build.sh`):

- `test/live-examples.mjs` in headless Chrome against the 0.21.0 web build (`fcx-live-fix2.log`, EXIT=0) gives **46 of 56**, identical to
  `test/examples-0.21.0-with-topology.json`: the same passes and volumes equal to 1e-6.
- `unified.test.mjs`:
  - default level: 9/9 pass; invariant 1 has 171735 refusals compared and 0 violations; invariant 2 has 71463 equal and 0 differ;
  - `UNIFIED_EP_JOIN=full`: 9/9 pass; invariant 1 has 173833 compared and 0 violations; invariant 2 has 68651 equal and 0 differ. The EP-JOIN classes are exactly
    GUARD-MOVE-TURN.md's (776 + 2010 runs over 288 docs). No named exception.
- Root `npm test` (`fcx-npmtest-fix2.log`, the brep-rs pkg not copied into the worktree): **953 pass of 959, 0 fail**. The 6 skipped are the script package's
  existing skips. The layer suite is 176/176.

## Found on the way (0.30.1, not fixed here): the shipped route builds family C wrong

`family-c-run.mjs` at HEAD f040bbbc on 0.30.1 (`fcx/out-base/famc-030.json`):

- **The shipped path (`unified`, the host's set) is WRONG on 8 of 8 family-C hollows**, 1.06e-3 to 5.7e-3 off OCCT direct and P. Those two agree to 4.5e-7 or better.
- **The filleted part is right** (2e-6 off OCCT direct). The fillet-chamfer step already sends the four bottom edges as one call.
- **The hollow of it is not.** The repro's raw one-call command list gives the same: `C-repro-s1-00475` raw 961.68 against OCCT 958.01.

On 0.21.0 corrected and on rc.2 the same rows MATCH. Path A (one call per edge) on 0.30.1 is WRONG on 5 of 8. So on the 0.30.1 kernel the hollow of a part
with rounded bottom edges is shell family C, and the guard layer does not refuse it there. This is also why fix 1 halted: sending one call on path A moves three
right rows onto this wrong kernel path.
