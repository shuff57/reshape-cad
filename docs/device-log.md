# Device log (benchmarks)

One row per (build_sha, device) measurement. Same data lives machine-readable
in `docs/device-log.json` (an object with a `rows` array, same fields, nulls
when not yet measured).

| build_sha | device | date | transfer_mb_gz | cold_load_s | cached_load_s | peak_ram_mb | notes |
|---|---|---|---|---|---|---|---|
|  | windows-11-lead |  |  |  |  |  |  |
|  | home-laptop |  |  |  |  |  |  |

Note: the Chromebook row, and its 60 s cold-load / 1500 MB peak-RAM pass
thresholds, arrive in phase 2.