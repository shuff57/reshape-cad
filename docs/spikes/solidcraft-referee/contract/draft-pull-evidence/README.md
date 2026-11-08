# GUARD-DRAFT-PULL evidence (2026-11-08)

Every stored draft row that the referee's draft defects can reach is re-scored here: a draft pulled along x or y, a whole/Body Draft, or a hollow right after a
draft. The rows come from every host-route corpus, plus the picks-naming-params evidence. Report: [GUARD-DRAFT-PULL.md](../../GUARD-DRAFT-PULL.md). The referee files
(occt-build.ts, topo-history.ts) are not edited.

- `dump-drafts.mjs`: a copy of `hg/host-route-com.mjs` with two changes:
  - corpus `extra` reads `[{ id, script }]` from `--extra=`;
  - `--dump=<file>` writes every ready item whose solved doc has a draft (doc, raw doc, reference) and runs nothing.

  It was run on all 16 corpora: 1130 draft docs, in `next-loop/dp/dump/*.jsonl`, outside the repo. `extra` was also run as a probe on both kernels.
- `pnp-evidence-drafts.json`: the two whole or x/y-pull draft scripts in the picks-naming-params evidence (`secK.mjs`, `resK.json` rounds 1, 3 and 5).
- `dp-oracle.mjs`: for every row in scope it records these references:
  - `occtBug`: the referee as it is;
  - `occtFixed`: the same `buildDoc`, given a proxy of the OCCT instance. Its `BRepOffsetAPI_DraftAngle` puts the neutral plane through neutral × pull, and finds
    a stale face again by its surface;
  - `occtOne`: one DraftAngle with every tilted face;
  - `occtChain`: for a hollow after a draft, the drafted solid, then `MakeThickSolidByJoin` with the open face found by its normal;
  - `poly`: exact geometry (polytope, mitre polyhedron, frustum, the bore through the cone integrated);
  - `brep`: brep-rs live.

  Host numbers come from the exit sweeps `next-loop/dp/exit-{021c,030}`, and for the corpora not re-swept from `we/sweep-5180-*`.
- `dp-run.sh`: runs it on this worktree, under the rig lock. `dp-raw.json` is its output.
- `dp-sum.py`: the verdict per row and kernel. RIGHT means at least two references agree with the host; OCCT counts once. It also finds the rows where the
  referee as it is was wrong. Output: `dp-results.json`.
- `step4.sh`: host bundle, unified invariants at 'full', root npm test, live examples. Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/dp-*.log`.
- Exit sweeps: `../we-evidence/sweep-com.sh <k> <this worktree> next-loop/dp/exit-<k> sd combined rgcombined fccombined`.
