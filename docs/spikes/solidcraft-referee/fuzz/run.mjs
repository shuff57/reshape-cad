// Fuzz driver.  Stages (each resumable, per-case jsonl kept OUTSIDE the repo in $FZ):
//   node run.mjs gen    --seed 1 --n 2300
//   node run.mjs oracle [--workers 6]
//   node run.mjs cli    --bin /path/solidcraft-cli --tag p7 [--base 1]
//   node run.mjs report [--tags p7,base]      -> classify + write summary.json
// $FZ defaults to the session scratchpad fz/ dir.  CLI runs are strictly one process at a time, each under
//   systemd-run --user --collect --wait -p MemoryMax=8G -p MemorySwapMax=0   with  timeout 60.
import { fork, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { genCase } from './gen.mjs';
import { oracle, euclid } from './oracle.mjs';

const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
mkdirSync(FZ + '/scripts', { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const stage = process.argv[2];

// which cases can be cross-checked by true Euclidean erosion (complement has no convex corners)
export function euclidOK(m) {
  if (m.mode !== 'rect' || m.boxes.length !== 1 || (m.cuts || []).length || (m.rbosses || []).length) return false;
  if (!m.holes.length) return false;
  const [x0, x1, y0, y1, z0, z1] = m.boxes[0];
  return m.holes.every((h) => (h.type === 'cone') || (h.type === 'cyl' && (h.axis || 'z') === 'z' && h.range[0] < z0 && h.range[1] > z1));
}

if (stage === 'gen') {
  const seed = +arg('seed', 1), n = +arg('n', 2300); const out = [];
  let nul = 0;
  for (let i = 0; i < n; i++) { const c = genCase(seed, i); if (!c) { nul++; continue; } out.push(c); }
  writeFileSync(`${FZ}/cases-s${seed}.jsonl`, out.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log('generated', out.length, 'null', nul);
} else if (stage === 'oracle' || stage === 'euclid') {
  if (process.argv.includes('--child')) {
    process.on('message', (c) => {
      const t0 = Date.now(); const r = { id: c.id };
      try {
        const o = oracle(c.model); r.S = o.S; r.C = o.C; r.P = o.P;
        if (process.argv.includes('--euclid')) { const e = euclid(c.model); r.eS = e.S; r.eC = e.C; r.eP = e.P; }
      } catch (e) { r.error = String(e.stack || e).slice(0, 300); }
      r.ms = Date.now() - t0; process.send(r);
    });
  } else {
    const seed = +arg('seed', 1); const NW = +arg('workers', 6);
    const EU = stage === 'euclid';
    const cases = readJsonl(`${FZ}/cases-s${seed}.jsonl`).filter((c) => !EU || euclidOK(c.model)); const outF = `${FZ}/${EU ? 'euclid' : 'oracle'}-s${seed}.jsonl`;
    const done = new Set(readJsonl(outF).map((r) => r.id)); const todo = cases.filter((c) => !done.has(c.id));
    console.log('oracle todo', todo.length, 'of', cases.length);
    let i = 0, fin = 0;
    await new Promise((resolve) => {
      if (!todo.length) return resolve();
      for (let w = 0; w < NW; w++) {
        const ch = fork(new URL(import.meta.url).pathname, [stage, '--child', ...(EU ? ['--euclid'] : [])], { execArgv: ['--max-old-space-size=3000'] });
        const next = () => { if (i < todo.length) ch.send(todo[i++]); else ch.kill(); };
        ch.on('message', (r) => { appendFileSync(outF, JSON.stringify(r) + '\n'); fin++; if (fin % 100 === 0) console.log('oracle', fin, '/', todo.length); if (fin === todo.length) resolve(); next(); });
        next();
      }
    });
    console.log('oracle done');
    process.exit(0);
  }
} else if (stage === 'cli') {
  const bin = arg('bin'), tag = arg('tag'), seed = +arg('seed', 1), doBase = arg('base', '0') === '1';
  const cases = readJsonl(`${FZ}/cases-s${seed}.jsonl`); const outF = `${FZ}/cli-${tag}-s${seed}.jsonl`;
  const done = new Set(readJsonl(outF).map((r) => r.id));
  const lim = +arg('limit', 1e9);
  const idf = arg('idfile'); const only = idf ? new Set(readFileSync(idf, 'utf8').split('\n').filter(Boolean)) : null;
  const runOne = (file) => {
    const t0 = Date.now();
    const p = spawnSync('systemd-run', ['--user', '--collect', '--wait', '-P', '-q', '-p', 'MemoryMax=8G', '-p', 'MemorySwapMax=0', 'timeout', '60', bin, 'run', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const ms = Date.now() - t0;
    if (p.status === 124) return { status: 'timeout', ms };
    let j = null; try { j = JSON.parse(p.stdout); } catch { /* not json */ }
    if (j && j.total) return { status: 'ok', vol: j.total.volume_mm3, bodies: j.body_count, faces: j.total.faces, ms };
    const err = ((p.stderr || '') + '').trim().split('\n').filter((l) => !/^(Running as unit|Finished with|Main processes|Service runtime|CPU time|Memory peak)/.test(l.trim()) && l.trim()).pop() || `rc=${p.status} ${(p.stdout || '').slice(0, 100)}`;
    return { status: p.status === 137 || /oom|killed/i.test(err) ? 'killed' : 'error', error: err.replace(/^error:\s*/, '').slice(0, 400), rc: p.status, ms };
  };
  let n = 0;
  for (const c of cases) {
    if (done.has(c.id) || (only && !only.has(c.id))) continue; if (n++ >= lim) break;
    const f1 = `${FZ}/scripts/${c.id}.json`, f0 = `${FZ}/scripts/${c.id}-base.json`;
    writeFileSync(f1, JSON.stringify([...c.cmds, c.shell]));
    const row = { id: c.id };
    if (doBase) { writeFileSync(f0, JSON.stringify(c.cmds)); row.base = runOne(f0); }
    row.shell = runOne(f1);
    appendFileSync(outF, JSON.stringify(row) + '\n');
    if (n % 100 === 0) console.log(tag, n);
  }
  console.log('cli done', tag);
} else {
  console.error('stage?'); process.exit(2);
}
