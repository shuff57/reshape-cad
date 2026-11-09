// fz-wasm.mjs --seed S --tag T: the fuzz cases ($FZ/cases-sS.jsonl) sent RAW to the wasm kernel $SOLIDCRAFT_REFEREE_PKG (sc.run, the command lists run.mjs
// sends to the native CLI: base = cmds, shell = cmds + shell). Writes $FZ/cli-T-sS.jsonl in run.mjs's row format, so fuzz/report.mjs classifies it unchanged.
// --every N keeps case index % N == 0 (the README's every-4th subset). Resumable per case; one child per chunk with a 60 s no-progress watchdog (the CLI's timeout 60) (a stuck case is recorded as timeout).
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const FZ = process.env.FZ; const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const seed = arg('seed'), tag = arg('tag'); const outF = `${FZ}/cli-${tag}-s${seed}.jsonl`;
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const EVERY = +arg('every', 1);
const IDF = arg('idfile'); const ONLY = IDF ? new Set(readFileSync(IDF, 'utf8').split('\n').filter(Boolean)) : null;
const WD = +arg('watchdog', 60) * 1000;
const cases = readJsonl(`${FZ}/cases-s${seed}.jsonl`).filter((c) => c.index % EVERY === 0 && (!ONLY || ONLY.has(c.id)));
if (process.argv.includes('--child')) {
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const run = (cmds) => {
    const t0 = Date.now(); let j;
    try { j = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { status: 'error', error: `WASM TRAP: ${String(e.message).slice(0, 300)}`, ms: Date.now() - t0 }; }
    const ms = Date.now() - t0;
    if (j.ok) { const bs = j.measure.bodies; return { status: 'ok', vol: bs.reduce((s, b) => s + b.volume_mm3, 0), bodies: bs.length, faces: bs.reduce((s, b) => s + b.faces, 0), ms }; }
    return { status: 'error', error: `step ${j.failed?.index ?? '?'} (${j.failed?.command}): ${String(j.failed?.error ?? '').slice(0, 380)}`, ms };
  };
  const done = new Set(readJsonl(outF).map((r) => r.id));
  for (const c of cases) {
    if (done.has(c.id)) continue;
    process.stdout.write(`@@START@@${c.id}\n`);
    const row = { id: c.id, base: run(c.cmds), shell: run([...c.cmds, c.shell]) };
    appendFileSync(outF, JSON.stringify(row) + '\n'); process.stdout.write(`@@DONE@@${c.id}\n`);
  }
  process.exit(0);
}
for (;;) {
  const done = new Set(readJsonl(outF).map((r) => r.id));
  if (cases.every((c) => done.has(c.id))) break;
  const res = await new Promise((resolve) => {
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--child'], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
    let cur = null, timer = null, buf = '';
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ch.kill('SIGKILL'), WD); }; arm();
    ch.stdout.on('data', (d) => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, k); buf = buf.slice(k + 1); if (ln.startsWith('@@START@@')) { cur = ln.slice(9); arm(); } else if (ln.startsWith('@@DONE@@')) { cur = null; arm(); } } });
    ch.on('exit', (code, sig) => { clearTimeout(timer); resolve({ code, sig, cur }); });
  });
  if (res.cur) { appendFileSync(outF, JSON.stringify({ id: res.cur, base: { status: 'timeout' }, shell: { status: 'timeout' }, killed: res.sig ?? res.code }) + '\n'); console.log('timeout/crash on', res.cur, res.sig ?? res.code); }
  else if (res.code !== 0) { console.error('child failed', res); process.exit(3); }
}
console.log('done', tag, seed, readJsonl(outF).length);
