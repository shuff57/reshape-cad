# Live-replay loop

`run-live-replays.sh` runs the layer's real-kernel replays in a fixed order, one at a time, and
stops on the first result a human has to see. It exists because five of the replays were written
and never run (patterns-mirror, booleans, revolve-groove, fillet-chamfer) or ran only to a partial
file (unified: 2780 of 5513 docs in ~8 h on 2026-10-27, stopped by hand).

It is a loop over PHASES, not a retry-until-green loop: a mismatch is a finding and the summary is
kept. Nothing is blessed by re-running it.

## Order

`<pin>` is `SOLIDCRAFT_PIN` (default 0.30.1, the pin since 2026-11-09); the rig is `~/.cache/solidcraft-<pin>-rig`. The committed `*-0.21.0.json` files are the record of the 0.21.0 runs.

| Phase | Replay | Evidence file | Why here |
|---|---|---|---|
| `pm` | `live-replay-patterns-mirror.mjs` | `live-replay-patterns-mirror-<pin>.json` | in-process, no topology; cheapest |
| `bool` | `live-replay-booleans.mjs` | `live-replay-booleans-<pin>.json` | one child per case, 90 s each |
| `rg` | `live-replay-revolve-groove.mjs` | `live-replay-revolve-groove-<pin>.json` | one child per case, 120 s each |
| `fc` | `live-replay-fillet-chamfer.mjs` | `live-replay-fillet-chamfer-<pin>.json` | needs the topology rig; scores closed forms |
| `unified` | `live-replay-unified.mjs` | `live-replay-unified-<pin>.json` | longest, and it compares against every single set |

Only the summary JSON is copied into `test/evidence/`; the per-case files stay in the rig's cache
(`$HOME/.cache/solidcraft-<pin>-rig/live-replay-loop/out/<phase>/cases`), so the repository keeps
one committed result per phase, as the earlier evidence files do.

## Stop rules

- **PASS** (0 differ / 0 hang / 0 built-wrong): next phase.
- **FINDINGS** (differ or hang, no built-wrong): stop, unless `--keep-going`.
- **BUILT-WRONG** (a result off its closed form, fillet-chamfer): always stop. A silently wrong
  solid outranks every other result, so `--keep-going` does not continue past it, including a
  built-wrong row already on disk after a cut chunk.
- **TIMEOUT / KILLED / ERROR**: the three case-writing phases (`bool`, `rg`, `fc`) resume at case
  level and retry, up to `LOOP_ATTEMPTS` (default 6) attempts of `TIMEOUT_*` seconds each. If the
  last attempt still ends non-zero, the phase stops. `pm` and `unified` have no case-level resume
  and stop on the first non-zero attempt.
- A phase whose evidence file already exists is skipped; `--force` re-runs it.
- A partial summary (`"partial": true`) is renamed `*.partial-<ts>.json` in the scratch dir and is
  never copied to evidence.

## Case-level resume (built in)

The three group replays write one row per case into `out/<phase>/cases/`, and both now accept
`--ids-out=<file>` (the full deduped case list, no engine work). The loop uses that:

1. On the first attempt of `bool`/`rg`/`fc` it writes `out/<phase>/case-ids.json`.
2. Before each attempt it asks `live-replay-cases.mjs remaining` which ids have no row on disk and
   passes only those to the replay.
3. After every attempt it rebuilds the phase summary from all row files
   (`live-replay-cases.mjs summary`), so earlier chunks count even when an attempt was cut by its
   wall timeout. `cases` is recomputed as `same + differ`, matching the replay's own convention.
4. A retry reuses the same `out/<phase>`; a case that already hung has a row and is not retried.

The manual merge path is still available for a summary produced outside the loop:

```bash
node packages/layer/test/merge-live-replay.mjs merged.json partial.json remaining.json
```

`merge-live-replay.mjs` concatenates rows, sums the counters, clears `partial`, and refuses a
duplicate id. It is for the group summaries; the unified summary has its own merger,
`merge-unified.mjs`.

The pm phase is the example of the older manual path: 3 h (its old cap) produced 266 of 503 cases
with 0 differ, so the 237 missing ids were run separately and merged. The defaults are 10 h for pm
and 8 h for the other group phases.

## Unified after its 24 h window

The unified corpus is 8,222 docs, not the 5,513 the 24 h default was sized for. At the measured
16 s/doc a full pass is ~36 h, so one window cannot finish it. `resume-unified.sh` waits for the
loop unit and the unified process to be gone, then runs the replay in further attempts with
`--skip=<the rows already on disk>` and merges each attempt into `out/unified/merged.json`:

```bash
systemd-run --user --unit=reshape-unified-resume --collect --working-directory="$PWD" \
  bash packages/layer/test/resume-unified.sh reshape-live-replays-<ts>
```

It stops when an attempt returns 0/1 (a complete pass), writes
`live-replay-unified-<pin>.json` into the evidence dir, and otherwise resumes from the merged rows
for up to `UNIFIED_ATTEMPTS` (default 8) windows of `TIMEOUT_UNIFIED` (default 24 h) each. A
built-where-a-set-refused is kept in the summary and the exit is still 0/1: it is a finding, not a
transient failure. `merge-unified.mjs` also has `skip` and `final` modes for manual use.

A resumed attempt enumerates the whole corpus again (the skip filter runs after each doc is solved),
so it spends a few minutes before its first new doc.

## Status page

`status-page.mjs` reads `state.tsv`, `current`, the per-case files and the logs, and writes
`$LOOP_DIR/status.html` (default `~/.cache/solidcraft-<pin>-rig/live-replay-loop/status.html`).
The page reloads itself every 10 s and shows each phase's bar, the cases being worked now, the last
few results and an ETA. Keep it fresh with a small detached watcher:

```bash
systemd-run --user --unit=reshape-status-page --collect -p Restart=always -p RestartSec=5 \
  --working-directory="$PWD" bash -c \
  'while :; do node packages/layer/test/status-page.mjs; sleep 5; done'
```

`run-live-replays.sh` writes `current` (`phase<TAB>started<TAB>attempt<TAB>cases`) for the running
attempt and removes it between phases, so the page follows the loop without touching its process.

## Use

```bash
sh packages/layer/test/run-live-replays.sh --status      # last state of each phase
sh packages/layer/test/run-live-replays.sh --dry-run     # the exact commands and caps
sh packages/layer/test/run-live-replays.sh               # everything not yet done
sh packages/layer/test/run-live-replays.sh --from=rg     # resume after a stop
sh packages/layer/test/run-live-replays.sh --only=pm,bool --keep-going
sh packages/layer/test/run-live-replays.sh --smoke       # one case per phase, scratch only
```

To run the whole thing past the end of a terminal (unified alone is around 16 h), start it detached;
it becomes a transient systemd user unit:

```bash
sh packages/layer/test/run-live-replays.sh --detach --keep-going
systemctl --user status reshape-live-replays-<ts>
systemctl --user stop   reshape-live-replays-<ts>
sh packages/layer/test/run-live-replays.sh --status
```

Environment: `SOLIDCRAFT_PIN` (default 0.30.1), `SOLIDCRAFT_RIG` (default `$HOME/.cache/solidcraft-<pin>-rig`), `SOLIDCRAFT_REFEREE_PKG` (default `$RIG/sc-referee-pkg`),
`SOLIDCRAFT_TOPOLOGY_PKG` (default `.../sc-referee-pkg-topology`), `TIMEOUT_PM`, `TIMEOUT_BOOL`,
`TIMEOUT_RG`, `TIMEOUT_FC`, `TIMEOUT_UNIFIED`, `LOOP_ATTEMPTS` (case-level retries, default 6),
`LOOP_MEM` / `LOOP_MEM_UNIFIED` (systemd `MemoryMax`), `LOOP_ULIMIT` / `LOOP_ULIMIT_UNIFIED` (KB of
address space, **0 = off by default**).

The replays' headers ask for `ulimit -v 2097152`, but on Node 22 (v22.23.1, 2026-11-01) the wasm
cannot start under any address-space cap up to 8 GB: it reserves a virtual range far larger than
the memory it touches, and `WebAssembly.Instance` fails immediately. The loop therefore caps real
memory with systemd `MemoryMax` and leaves the virtual-space limit off; set `LOOP_ULIMIT=2097152`
on a box where the older behaviour is wanted.

`--build` runs the `sketch -> script -> layer` chain first; the replays import `dist/`, so a stale
build is otherwise run silently.

## Caps, slow cases and the named exception

The default child-process caps are 90 s (booleans) and 120 s (revolve-groove, fillet-chamfer). On
the 0.21.0 rig ten cases crossed them and all ten turned out to be slow, not stuck: 113 s to 465 s,
every one identical to the original when re-run at 900 s. Two of them exceed even the booleans
group's own 150 s guarded runs. So a `HANG` row is a hypothesis, not a verdict: re-run it at 900 s
before it goes in the findings, and do not lower a group's evidence caps to match the replay.

The holes replay carries one named exception, `H4-CLOSED-SENTENCE`, the same one the holes
differential test carries (`c5ab5d23`, owner-approved): the original's closed-hollow sentence prints
its missing reason as `undefined`, the layer's is worded without one, and only that sentence is
rewritten before the comparison. Status, guard, commands and scene still have to match, and the row
records the exception so the evidence shows it instead of hiding it.

## What it does not prove

- It is not an oracle. Only fillet-chamfer scores built results (against its group's closed forms);
  the other four show that the port changes nothing on the real kernel, not that the solid is right.
- `{ budgetS }` is ignored by the in-process `runSC` of every replay, so the layer's time limit is
  not exercised here (NOTES.md, the advice-only case in each fold).
- patterns-mirror and unified run in-process; a kernel hang hangs the script until the phase
  timeout. The three child-per-case replays record a HANG per case instead.
- Results are 0.21.0 only. The contract pins 0.9.0 and is a separate measurement.

## Where the results go next

A passing phase is evidence for the plan's phase 4 ("live-reference score on every change") and
input to the phase 1 contract rebuild on 0.21.0. A finding is a guard gap: the row belongs in
`NOTES.md` and, if it is a built wrong solid, it stops the loop before anything else runs.
