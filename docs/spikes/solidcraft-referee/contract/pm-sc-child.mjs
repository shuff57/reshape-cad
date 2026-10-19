// SPIKE, referee only. One solidcraft session in its own process, so a caller can kill it at a time limit (the wasm call is synchronous and
// cannot be interrupted from inside). stdin = {commands:[...]}; stdout = the solidcraft result JSON, with ms added.
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const input = JSON.parse(readFileSync(0, 'utf8'));
const t0 = Date.now();
let out;
try { out = JSON.parse(sc.run(JSON.stringify({ commands: input.commands }))); } catch (e) { out = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
out.childMs = Date.now() - t0;
process.stdout.write(JSON.stringify(out));
