// SPIKE, referee only (booleans group, round 2). Raw SolidCraft helper: run a solidcraft command list with no translator in the loop.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/bool-raw.mjs --cmds=<file.json> [--timeout=60]   -> one JSON line on stdout (child process, hard timeout)
// Also exported: runRaw(commands, {timeoutS}) for scripts that spawn this file.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
export function runRaw(commands, { timeoutS = 60 } = {}) {
  const f = path.join(os.tmpdir(), `bool-raw-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(commands));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--cmds=${f}`], { encoding: 'utf8', timeout: timeoutS * 1000, env: process.env, maxBuffer: 64 << 20 });
  const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@RAW@@')).pop();
  const wallS = (Date.now() - t0) / 1000;
  if (line) return { ...JSON.parse(line.slice(7)), wallS };
  return { ok: false, hang: true, wallS, note: `no result within ${timeoutS} s (child ${r.signal ?? r.error?.code ?? 'exit ' + r.status})` };
}
if (arg('cmds')) {
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const cmds = JSON.parse(readFileSync(arg('cmds'), 'utf8'));
  const t0 = Date.now();
  let out;
  try { const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); out = r.ok ? { ok: true, ms: Date.now() - t0, bodies: r.measure.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces, shells: b.kernel.shells, kernel: b.kernel, face_types: b.face_types, bbox: b.bbox })) } : { ok: false, ms: Date.now() - t0, failed: r.failed }; }
  catch (e) { out = { ok: false, trap: true, ms: Date.now() - t0, error: e.message }; }
  console.log('@@RAW@@' + JSON.stringify(out));
}
