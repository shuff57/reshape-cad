#!/usr/bin/env node
// Driver: runs holes-run.mjs in a child process, restarting after a case that hangs (truck runs synchronously in wasm, so a
// hang cannot be timed out in-process). A case with no result within --timeout seconds is recorded as { verdict: 'timeout' }.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/holes-drive.mjs --out=<dir> [--timeout=90] [--only=a,b]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './holes-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const OUT = path.resolve(arg('out', HERE));
const TIMEOUT = Number(arg('timeout', '90')) * 1000;
const only = arg('only').split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });
let todo = CASES.map((c) => c.id).filter((id) => !only.length || only.includes(id));
const results = new Map();
const byId = new Map(CASES.map((c) => [c.id, c]));

while (todo.length) {
  const batch = todo;
  let current = null; let timer = null; let buf = '';
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, 'holes-run.mjs'), `--only=${batch.join(',')}`, `--out=${OUT}`], { env: { ...process.env, HOLES_DRIVER: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { console.log(`TIMEOUT ${current}`); child.kill('SIGKILL'); }, TIMEOUT); };
    arm();
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line.startsWith('@@START ')) { current = line.slice(8); arm(); }
        else if (line.startsWith('@@RESULT ')) { const r = JSON.parse(line.slice(9)); results.set(r.id, r); current = null; arm(); }
        else if (line) console.log(line.slice(0, 400));
      }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  const stuck = current;
  todo = todo.filter((id) => !results.has(id));
  if (stuck && todo.includes(stuck)) {
    const c = byId.get(stuck);
    results.set(stuck, { id: stuck, row: c.row, script: c.script, note: c.note, verdict: 'timeout', timeoutSeconds: TIMEOUT / 1000 });
    todo = todo.filter((id) => id !== stuck);
  } else if (todo.length) {
    // child died without a hang marker: record the first remaining case as a crash to avoid looping forever
    const id = todo[0]; const c = byId.get(id);
    results.set(id, { id, row: c.row, script: c.script, note: c.note, verdict: 'crash' });
    todo = todo.slice(1);
  }
}
const ordered = CASES.filter((c) => results.has(c.id)).map((c) => results.get(c.id));
writeFileSync(path.join(OUT, 'holes-results.json'), JSON.stringify(ordered, null, 1));
console.log(`wrote ${path.join(OUT, 'holes-results.json')} (${ordered.length} cases)`);
