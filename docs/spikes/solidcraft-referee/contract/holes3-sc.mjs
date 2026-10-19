// Hang-safe SolidCraft runner for the round-3 holes tools: each command list runs in its own child process (truck is synchronous in wasm, so
// the only way to stop a hang is to kill the process). runIso returns {result, cpuMs, wallMs} or {timeout:true, wallMs} / {crashed:true}.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(path.join(process.env.H3_TMP ?? tmpdir(), 'h3-'));
let n = 0;
export function runIso(cmds, timeoutMs = 240000) {
  const f = path.join(TMP, `c${n++}.json`);
  writeFileSync(f, JSON.stringify(cmds));
  const t0 = Date.now();
  const p = spawnSync(process.execPath, [path.join(HERE, 'holes3-sc-child.mjs'), f], { env: process.env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1 << 28, encoding: 'utf8' });
  if (p.error || p.status !== 0 || !p.stdout) {
    return { timeout: p.signal === 'SIGKILL' || p.error?.code === 'ETIMEDOUT', crashed: !!(p.status && p.status !== 0), stderr: (p.stderr ?? '').slice(0, 300), wallMs: Date.now() - t0, timeoutMs };
  }
  return JSON.parse(p.stdout.trim().split('\n').at(-1));
}
