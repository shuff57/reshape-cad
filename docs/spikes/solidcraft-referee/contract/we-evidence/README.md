# GUARD-WRONG-EDGE evidence (2026-11-08)

`host-route-com.mjs` is a copy of the probe as run (it runs from `~/.cache/solidcraft-0.21.0-rig/next-loop/hg/`, beside `host-route.mjs`, which is unchanged;
md5 5f306da1f0e671ac9f816710b8436fe5). Its header says what it adds: the measured feature's centre of mass against OCCT (per solid) and brep-rs (its own mesh,
deflection 2e-5 of the diagonal, about the box centre), at 1e-6 (planar) and 2e-4 (curved) of the diagonal. The verdict is a pure function of the row,
recomputed by `comscore.py`.

- `val-com.sh`: the FM-1 pick-after-move/turn docs and the turned-cylinder rims on the pre-FM-1 tree 7183ea8f; `validate.py` scores it (`validate.json`).
- `sweep-com.sh`: all 15 corpora on 5180994a (`rig.sh` picks the rig). `sweepcom.py` gives `sweep-<k>.txt/json`.
- `flagtest.sh`: the preliminary sweep's flags at two brep-rs mesh deflections (the deflection and the absolute-coordinate fix).
- `mitre-oracle.mjs`: two references for a blend chain on one box, the literal mitre (closed form, volume and COM; and OCCT's intersection of the
  single-blended boxes). `mitresum.py` judges the flagged and triaged-WRONG fc rows (`mitre-<k>.txt/json`, `-judged.json`).
- `storedcom.py`: the RIGHT rows the probe scored on a stored reference with no COM, checked against the group's stored OCCT / analytic COM (`storedcom-<k>.json`).
- `livecom.mjs`: OCCT and brep-rs live on three such rows (MULTIPIECE's joins; `livecom-mpjoin-030.jsonl`).
- `step4.sh`: host bundle, unified at 'full', root npm test, live examples. Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/we-*.log`.
- `we-host-route.json`: everything above, summarised. Raw rows: `~/.cache/solidcraft-0.21.0-rig/next-loop/we/{sweep-5180,val2-7183}-<k>/`.
