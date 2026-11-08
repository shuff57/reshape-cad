# Audit FM-1 evidence (2026-11-07)

`fm1-host-route.json` is everything measured; the scripts are the ones that made it (paths into `~/.cache/solidcraft-0.21.0-rig/next-loop/hg` and the
scratch base tree are the run's own, as in the other spike evidence).

- `run.sh`: the fc, mt and sd docs with a named pick after a move or a turn (`fm1-ids-*.txt`) through the host route (`hg/host-route.mjs`), both rigs.
- `hg/sweep.sh` (not copied): the full 15-corpus host-route sweep of the tree under test. `sweepcmp.py` lists the docs whose verdict or refusals differ from
  a reference sweep; `run-base.sh` re-runs those on the base tree (1ced28e3); `basecmp.py` splits them into changed-by-this-work and not.
- `rescore.py`: the host-route verdict passes a build on the SCENE score, which has no centre of mass, so a build of the wrong edge with the right volume and
  box scores RIGHT. Every verdict here is rescored with the feature-level centre of mass against OCCT (COM-OFF).

Result, both rigs alike: 31 wrong builds now refused (21 fc, 10 mt), 3 fccombined docs refused earlier or with another sentence, 0 new wrong, 0 right build
of a measured feature lost. Details and the per-row reading: AUDIT-HOST-GUARDS.md FM-1, contract-overrides.json `ownerDecisions`.
