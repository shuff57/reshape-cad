// Sharded driver for the wrong-solid sweep. Spawns workers, restarts them after a crash or a stall (an OCCT or brep hang is
// recorded as its own class, never silently dropped), then leaves JSONL in <out>/<family>-<shard>.jsonl.
//   node wrong-solid-sweep-driver.mjs --family perm --count 4200 --shards 20 --seed 1 --out DIR [--timeout 60] [--chunk 400] [--no-occt]
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : d; };
const family = opt('family'), count = +opt('count', 1000), shards = +opt('shards', 8), seed = +opt('seed', 1);
const out = opt('out'), timeoutMs = +opt('timeout', 60) * 1000, chunk = +opt('chunk', 400), noOcct = args.includes('--no-occt');
mkdirSync(out, { recursive: true });

const lastLine = (f) => { try { const t = readFileSync(f, 'utf8').trimEnd().split('\n'); return t.length ? JSON.parse(t.at(-1)) : null; } catch { return null; } };

async function shard(k) {
  const lo = Math.floor((count * k) / shards), hi = Math.floor((count * (k + 1)) / shards);
  const file = path.join(out, `${family}-${k}.jsonl`);
  if (!existsSync(file)) writeFileSync(file, '');
  let cur = lo;
  while (cur < hi) {
    const stop = Math.min(hi, cur + chunk);
    const wargs = [path.join(HERE, 'wrong-solid-sweep-worker.mjs'), family, String(cur), String(stop), String(seed), file];
    if (noOcct) wargs.push('--no-occt');
    writeFileSync(`${file}.prog`, '');
    const child = spawn(process.execPath, wargs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    const verdict = await new Promise((resolve) => {
      let killed = false;
      const tick = setInterval(() => {
        try {
          if (Date.now() - statSync(`${file}.prog`).mtimeMs > timeoutMs && statSync(`${file}.prog`).size > 0) { killed = true; child.kill('SIGKILL'); }
        } catch { /* not yet created */ }
      }, 2000);
      child.on('exit', (code) => { clearInterval(tick); resolve({ code, killed }); });
    });
    const p = lastLine(`${file}.prog`);
    if (p && p.phase !== 'done') {
      // the worker died or was killed mid-script p.i
      const rec = { i: p.i, family, seed, tags: { family, index: p.i, seed }, cls: p.phase === 'brep' ? (verdict.killed ? 'BREP-HANG' : 'BREP-CRASH') : (verdict.killed ? 'OCCT-HANG' : 'OCCT-CRASH'),
        brep: p.brep, refusals: p.refusals, detail: `worker exit ${verdict.code}${verdict.killed ? ' (killed after ' + timeoutMs / 1000 + ' s without progress)' : ''}: ${err.slice(-300)}` };
      // regenerate the script text so the hang is reproducible from the record
      const { genScript } = await import('./wrong-solid-sweep-lib.mjs');
      rec.code = genScript(family, p.i, seed).code;
      appendFileSync(file, JSON.stringify(rec) + '\n');
      cur = p.i + 1;
    } else if (p && p.phase === 'done') cur = Math.max(stop, p.i + 1);
    else cur = stop;
    if (verdict.code && !p) { console.error(`shard ${k}: worker failed to start: ${err.slice(-500)}`); break; }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: shards }, (_, k) => shard(k)));
console.log(`${family}: ${count} scripts, ${shards} shards, ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}`);
