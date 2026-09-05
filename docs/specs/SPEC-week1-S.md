# SPEC week 1, shared tasks S1 S2 S4 (reshape-cad)

Repo root (absolute): C:\Users\shuff57\Documents\GitHub\reshape-cad
Only touch: bench/, scripts/check-record.mjs, scripts/measure-load.py, docs/device-log.md, docs/device-log.json, docs/schemas/. Nothing under packages/ or engine/.
If any path named here does not exist, STOP and say so; do not invent paths.
Plain Node 25 ESM (.mjs), no npm dependencies for check-record.mjs. Python 3.14 + playwright (python) for measure-load.py.

## S1. Yardstick tasks and record template
Write three engine-neutral task cards, each with: Goal, Steps (numbered, plain words, no tool names), Dimensions (exact mm), Finished-state assertion (a measurable fact: volume within 1%, count of holes, file reopens).
- bench/tasks/Y1-bracket.md: L-bracket 80 x 60 x 10 mm plate, second leg 60 x 40 x 10 mm at 90 degrees; Pad from a sketch; Pocket a 30 x 20 x 5 mm recess in the big face; three through Holes, 6 mm, on the big face at (15,15), (65,15), (40,45) from the plate corner. Expected volume: compute it and state it.
- bench/tasks/Y2-flanged.md: cylinder 40 mm dia x 30 mm, flange 70 mm dia x 6 mm at the base; Fillet 3 mm on the flange top edge; linear pattern of four 5 mm holes along one axis, pitch 12 mm, on the flange; then EDIT: change the cylinder height to 45 mm and recompute. Expected volume before and after.
- bench/tasks/Y3-handoff.md: save Y1 as .FCStd, open in desktop FreeCAD 1.1.3 (C:\Users\shuff57\AppData\Local\Programs\FreeCAD 1.1\bin\freecadcmd.exe), change the Pad length to 12 mm there, save, reopen in the browser; assertion: browser shows the new volume.
- bench/record.json: template with one row per candidate id C1, C2, C3. Fields per row: candidate, engine, build_sha, date, device, transfer_mb_gz, cold_load_s, cached_load_s, peak_ram_mb, pad_recompute_ms, opens_in_freecad_113 (bool|null), constraints_roundtrip (bool|null), y1, y2, y3 (each "pass"|"fail"|null), notes. Rows start with every measurement null.
- docs/schemas/record.schema.json: the required-field list for bench/record.json rows, as a plain JSON object {"required": [...], "numeric": [...], "boolean": [...], "enum": {"y1": ["pass","fail"], ...}}. No JSON Schema library.

## check-record.mjs (the lead-owned gate)
scripts/check-record.mjs <record.json> [--schema <schema.json>] [--require-complete <id,...>]
- Loads the record (an array of rows, or an object with a rows array). Default schema: docs/schemas/<basename>.schema.json.
- A row "claims a run" when any measurement field is non-null. For each claiming row, every field in required must be present and non-null, numeric fields must be finite numbers, booleans must be true/false, enum fields must be in their list.
- --require-complete C1,C2 makes those rows fail if ANY field is null.
- Prints one line per problem: "<file> row <candidate>: <field> <problem>", exits 1 on any problem, 0 otherwise, prints "OK <n> rows checked".
- Also handles docs/device-log.json (rows keyed by build+device) and docs/upstream.json (rows keyed by patch) using their own schema files; write those two schema files too: device-log rows require build_sha, device, date, transfer_mb_gz, cold_load_s, cached_load_s, peak_ram_mb; upstream rows require patch_sha, subject, files, classification in ["upstreamable","wasm-only","undecided"], reason (non-empty string), and a top-level "hunk_counts" object is optional.

## S2. Measurement script
scripts/measure-load.py <url> --runs 2 [--out bench/record.json --candidate C1]
- Playwright python, Chromium headed by default (flag --headless). For each run: new browser context with an empty cache, navigate, wait until the page reports ready (network idle plus a --ready-selector or --ready-js expression the caller passes), record cold_load_s; reload in the same context and record cached_load_s; peak_ram_mb = max over polling every 500 ms of the renderer process working set, found via CDP SystemInfo.getProcessInfo (type renderer) and Windows tasklist / Get-Process for that pid; pad_recompute_ms is left null unless --recompute-js is given (a JS expression to evaluate, timed).
- Two runs must agree within 15% on every timing cell; otherwise print "UNSTABLE <field> run1 run2" and exit 2. On success print the numbers and, with --out, merge them into the candidate's row.
- transfer_mb_gz: sum of encoded response sizes over the cold load via CDP Network events.

## S4. Device log
docs/device-log.md: a table with columns build_sha, device, date, transfer_mb_gz, cold_load_s, cached_load_s, peak_ram_mb, notes; two starting rows: "windows-11-lead" and "home-laptop", both empty. docs/device-log.json: the same as rows with nulls. State in the md that the Chromebook row and its 60 s / 1500 MB thresholds arrive in phase 2.

## Self-check before replying
node scripts/check-record.mjs bench/record.json  -> "OK 3 rows checked", exit 0
node scripts/check-record.mjs docs/device-log.json -> OK, exit 0
node scripts/check-record.mjs docs/upstream.json -> if the file is absent, print "missing docs/upstream.json" and exit 1 (that is correct today).
python scripts/measure-load.py https://example.com --runs 2 --headless -> prints numbers, exit 0.
Reply with the exact output of those four commands and ONE design decision you made that the spec did not pin.
