// Round 4: does the cost in CALIBRATION UNITS (cpu of a job / cpu of the calibration job taken right before it) stay put when the machine gets slower?
// A controlled slow-down on THIS desktop (no student laptop or Chromebook was available): the job and its calibration are pinned to one logical cpu (JOB_CPU) while a busy loop runs on
// that cpu's SMT sibling (BUSY_CPU), which takes a share of the core's execution units. cpu seconds of every job grow; if the ratio stays the same, a page that measures its own
// calibration time can predict its own seconds as ratio x calibration seconds.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r4/slowdown-check.mjs [--job-cpu=11] [--busy-cpu=23] [--repeats=2]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prim, combine, timeCal, timeRun } from './cost-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const JOB_CPU = Number(arg('job-cpu', 11));
const BUSY_CPU = Number(arg('busy-cpu', 23));
const REPEATS = Number(arg('repeats', 2));

const JOBS = {
  'box minus ball (box 16, ball r10)': [...prim('box', 'A', { size: [16, 16, 16] }, null), ...prim('sphere', 'B', { radius: 10 }, null), combine('cut', 'A', ['B'])],
  'ball kept in box (box 16, ball r10)': [...prim('box', 'A', { size: [16, 16, 16] }, null), ...prim('sphere', 'B', { radius: 10 }, null), combine('intersect', 'A', ['B'])],
  'cylinder through box, join (aligned)': [...prim('box', 'A', { size: [30, 30, 30] }, null), ...prim('cylinder', 'B', { radius: 6, height: 50 }, null), combine('join', 'A', ['B'])],
  'cylinder tilted 45 in a box tilted 45, cut': [...prim('box', 'A', { size: [30, 30, 30] }, [45, 0, 0]), ...prim('cylinder', 'B', { radius: 6, height: 50 }, [45, 0, 0]), combine('cut', 'A', ['B'])],
};

const rows = [];
const measure = (cond, cpu) => {
  for (const [name, cmds] of Object.entries(JOBS)) {
    for (let i = 0; i < REPEATS; i++) {
      const cal = timeCal({ cpu });
      const r = timeRun(cmds, { cpuLimitS: 60, cpu });
      const row = { cond, name, rep: i, calS: cal, cpuS: r.ok ? r.cpuS : null, ratio: r.ok && cal ? +(r.cpuS / cal).toFixed(2) : null };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
};
measure('free (no pin)', null);
measure('pinned, sibling idle', JOB_CPU);
const busy = spawn('taskset', ['-c', String(BUSY_CPU), process.execPath, '-e', 'let x = 1; for (;;) { x = (Math.imul(x, 1664525) + 1013904223) | 0; }'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
measure('pinned, busy SMT sibling', JOB_CPU);
busy.kill('SIGKILL');
writeFileSync(path.join(HERE, 'slowdown-check.json'), JSON.stringify(rows, null, 1));
const by = {};
for (const r of rows) { const k = `${r.name}`; (by[k] ??= {})[r.cond] = (by[k][r.cond] ?? []).concat(r); }
for (const [name, conds] of Object.entries(by)) {
  console.log(name);
  for (const [c, rs] of Object.entries(conds)) console.log(`   ${c.padEnd(28)} cal ${rs.map((x) => x.calS).join('/')} s  job ${rs.map((x) => x.cpuS).join('/')} s  ratio ${rs.map((x) => x.ratio).join('/')}`);
}
