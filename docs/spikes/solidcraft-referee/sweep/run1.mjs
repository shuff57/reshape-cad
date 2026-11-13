// run1.mjs <pkg>: read {commands} JSON on stdin, run it on that SolidCraft referee pkg, print {ms, res} (the probe Worker's stand-in: one fresh process per run)
import { createRequire } from 'node:module'; import path from 'node:path'; import { readFileSync } from 'node:fs';
const sc = createRequire(import.meta.url)(path.join(process.argv[2], 'solidcraft_referee.js'));
const inp = readFileSync(0, 'utf8'); const t0 = performance.now();
let res; try { res = JSON.parse(sc.run(inp)); } catch (e) { res = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
process.stdout.write(JSON.stringify({ ms: Math.round(performance.now() - t0), res }));
