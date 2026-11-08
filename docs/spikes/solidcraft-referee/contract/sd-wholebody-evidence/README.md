# GUARD-SD-WHOLEBODY evidence (2026-11-08)

Live references for the shell-draft group's whole-body drafts (`dw2-*`), above all the 53 non-convex extrudes (`dw2-{L,T,U,Lthin}-*`, `dw2-fuzz-poly-*`)
that the host route scored RIGHT against the group's Simpson closed form, while the group's stored OCCT run disagreed on volume. Report:
[GUARD-SD-WHOLEBODY.md](../../GUARD-SD-WHOLEBODY.md).

- `sdw-oracle.mjs`: per `dw2-*` row, from the case's own script (runScript, then solveDoc). It records:
  - OCCT live, one `BRepOffsetAPI_DraftAngle` with every side face (`occtOne`);
  - the referee's own Body Draft (`occtSeq`, occt-build.ts `whole` branch);
  - the sequential method with each face found again in the current shape (`occtSeqRe`);
  - an exact polyhedron (`poly`) from the mitre offset of the outline at the bottom and the top, with volume, box and centre of mass by the divergence theorem;
  - the group's closed form (`simpson`);
  - brep-rs live (`brep`).

  It also records host numbers from the sd sweep rows passed on the command line.
- `sdw-run.sh <k> <out> <sweep021c> <sweep030>`: runs it on this worktree under the rig lock (ALL=1, every dw2 row). The references are kernel-independent,
  so the 021c and 030 runs gave byte-identical files. One is kept: `sdw-raw.json`, with the host numbers of both sd sweeps, `next-loop/sdw/sweep-{021c,030}/`.
- `sdw-sum.py`: scores `sdw-raw.json` into `sdw-results.json`: the 53, every dw2 row, and whether the referee's Body Draft re-run gives the stored number.
- `step4.sh`: host bundle, unified invariants at 'full', root npm test, live examples. Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/sdw-*.log`.

The sd corpus sweeps (host-route-com.mjs, both kernels) were run with `../we-evidence/sweep-com.sh <k> <this worktree> next-loop/sdw/sweep-<k> sd`.
