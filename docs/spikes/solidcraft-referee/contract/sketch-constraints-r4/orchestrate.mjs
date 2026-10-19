// one child process per case (all starts) with a time limit; on a timeout or crash every start of that case is rerun alone with a shorter limit.
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const S = import.meta.dir;
const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
const ids = execFileSync('bun', [S + '/listcases.mjs'], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split(' ')[1]);
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const N = 40;
const CASE_LIMIT = +(process.env.CASE_LIMIT ?? 100) * 1000;
const ONE_LIMIT = +(process.env.ONE_LIMIT ?? 20) * 1000;
const safe = (id) => id.replace(/[^\w-]/g, '_');
const results = [];
for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  const t0 = Date.now();
  const f = `${S}/out/cases/case-${safe(id)}.json`;
  const have = (() => { try { return JSON.parse(readFileSync(f, 'utf8'))[0]; } catch { return null; } })();
  if (have) { results.push(have); console.log('cached', id, JSON.stringify(Object.fromEntries(Object.entries(have.starts).map(([k, v]) => [k, v.tally])))); continue; }
  const r = spawnSync('bun', [S + '/shipped-sweep.mjs', '--only=' + id, '--n=' + N, '--json=' + f], { cwd: REPO, encoding: 'utf8', timeout: CASE_LIMIT, killSignal: 'SIGKILL' });
  if (r.status === 0) {
    results.push(JSON.parse(readFileSync(f, 'utf8'))[0]);
    console.log(r.stdout.trim().split('\n').pop().slice(0, 240), ((Date.now() - t0) / 1000).toFixed(1) + 's');
    continue;
  }
  console.log('SLOW/CRASH', id, 'status', r.status, 'signal', r.signal, '-> every start alone, limit ' + ONE_LIMIT / 1000 + 's');
  const rec = { id, hang: true, starts: {} };
  const modes = [['stored', 1]];
  if (!/probe|mode-request|side-opposite|side-matching/.test(id)) modes.push(['rough3.5', N], ['rough15', N]);
  for (const [m, n] of modes) {
    const tally = {}; const hangs = [];
    for (let k = 0; k < n; k++) {
      const q = spawnSync('bun', [S + '/shipped-sweep.mjs', '--one=' + [id, m, k].join('|')], { cwd: REPO, encoding: 'utf8', timeout: ONE_LIMIT, killSignal: 'SIGKILL' });
      let cls;
      if (q.status === 0) { const line = (q.stdout || '').split('\n').find((l) => l.startsWith('ONE ')); cls = line ? JSON.parse(line.slice(4)).cls : 'NO-OUTPUT'; }
      else { cls = 'HANG-KILLED'; hangs.push(k); }
      tally[cls] = (tally[cls] ?? 0) + 1;
    }
    rec.starts[m] = { n, tally, hangs };
    console.log('  ', id, m, JSON.stringify(tally), hangs.length ? 'hung starts ' + hangs.join(',') : '');
  }
  results.push(rec);
}
writeFileSync(S + "/out/shipped-sweep.json", JSON.stringify(results, null, 1));
