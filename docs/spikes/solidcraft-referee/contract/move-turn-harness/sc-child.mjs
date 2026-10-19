// child process for the time-boxed solidcraft call: reads {commands} JSON on stdin, prints the result JSON on stdout.
// The parent (runner.mjs, SC_BOX_MS set) kills it at the time limit. This stands in for "run solidcraft in a Worker and terminate it".
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const input = readFileSync(0, 'utf8');
const c0 = process.cpuUsage();
let out;
try { out = sc.run(input); } catch (e) { out = JSON.stringify({ ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }); }
const cu = process.cpuUsage(c0);
process.stderr.write(`CPU_MS:${Math.round((cu.user + cu.system) / 1000)}`);
process.stdout.write(out);
