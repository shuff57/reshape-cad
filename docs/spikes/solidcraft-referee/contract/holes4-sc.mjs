// ROUND 4 execution budget for the holes contract (G-BUDGET). SPIKE, referee only.
//
// truck runs inside ONE synchronous wasm call (sc.run) with no cancel, so the only way to stop a hang is to kill whoever runs it. The page does that
// with a Worker it terminates; this rig does the same with a child process under a CPU-time limit:
//     sh -c 'ulimit -S -t <budget>; ulimit -H -t <budget+2>; exec bun holes3-sc-child.mjs <cmds.json>'
// The kernel sends SIGXCPU when the child has used <budget> seconds of CPU TIME (user+system, all threads), so the limit does not depend on how loaded the
// box is (load average 14 to 104 during these runs; wall time would not reproduce). Start-up of the child (23 MB wasm compile) is about 0.45 s CPU and
// is inside the budget.
//
// runBudgeted(cmds, {budgetS}) -> the parsed engine result (same shape as holes-base.runSC) with extra fields:
//     { timedOut: true, ok: false, cpuMs }   the budget ran out, no result at all
//     { cpuMs, wallMs }                      attached to every normal result
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(path.join(process.env.H4_TMP ?? tmpdir(), 'h4-'));
let n = 0;

/** the page-side rule: one engine run may use this much CPU */
export const BUDGET_S = Number(process.env.H4_BUDGET_S ?? 45);
/** the whole translation of one script (every replay and every guard probe) may use this much */
export const DOC_BUDGET_S = Number(process.env.H4_DOC_BUDGET_S ?? 180);

export function runBudgeted(cmds, { budgetS = BUDGET_S } = {}) {
  const f = path.join(TMP, `c${n++}.json`);
  writeFileSync(f, JSON.stringify(cmds));
  const t0 = Date.now();
  // budgetS > 1e6 means 'no budget' (negative controls): the run is still killed after H4_CTL_S CPU seconds (default 100) so the control ends, and is reported as a hang
  const lim = budgetS > 1e6 ? Number(process.env.H4_CTL_S ?? 100) : Math.ceil(budgetS);
  const p = spawnSync('sh', ['-c', `ulimit -S -t ${lim}; ulimit -H -t ${lim + 2}; exec "$0" "$1" "$2"`, process.execPath, path.join(HERE, 'holes3-sc-child.mjs'), f],
    { env: process.env, killSignal: 'SIGKILL', maxBuffer: 1 << 28, encoding: 'utf8', timeout: Math.max(20 * lim, 300) * 1000 });
  const wallMs = Date.now() - t0;
  const out = (p.stdout ?? '').trim().split('\n').at(-1);
  if (p.status === 0 && out) {
    try { const j = JSON.parse(out); return { ...j.result, cpuMs: j.cpuMs, wallMs }; } catch { /* fall through */ }
  }
  // killed by the CPU limit (SIGXCPU = 24, shell reports 128+24), or by the wall backstop
  const xcpu = p.signal === 'SIGXCPU' || p.status === 152 || p.signal === 'SIGKILL';
  if (xcpu) return { ok: false, timedOut: true, cpuMs: lim * 1000, wallMs, failed: { command: '(budget)', error: `TIME BUDGET: exceeded ${lim} s of CPU` } };
  return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP / child failure: status ${p.status} signal ${p.signal} ${(p.stderr ?? '').slice(0, 200)}` }, cpuMs: 0, wallMs };
}
