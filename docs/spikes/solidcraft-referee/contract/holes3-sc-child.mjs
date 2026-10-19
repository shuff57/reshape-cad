// Child process for hang-safe engine runs: reads the command list JSON from the file in argv[2], runs it on the SolidCraft rig, prints one JSON
// line {result, cpuMs, wallMs}. cpuMs is user+system CPU of THIS process (load-independent, unlike wall time on a shared box).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const cmds = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const c0 = process.cpuUsage(); const t0 = Date.now();
let result;
try { result = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { result = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
const c1 = process.cpuUsage(c0);
console.log(JSON.stringify({ result, cpuMs: (c1.user + c1.system) / 1000, wallMs: Date.now() - t0 }));
