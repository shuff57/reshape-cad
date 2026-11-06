// One kernel run in its own process (so a hang can be killed): node child.mjs <pkg dir> <commands.json> [js glue name]
// Prints one line: @@R@@{ok, ms, measure|failed}. The wasm load is outside the timed span.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const [pkg, file, glue = 'solidcraft_referee.js'] = process.argv.slice(2);
const sc = createRequire(import.meta.url)(path.join(pkg, glue));
const cmds = JSON.parse(readFileSync(file, 'utf8'));
const t0 = performance.now();
let out;
try { out = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { out = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
const ms = performance.now() - t0;
process.stdout.write('@@R@@' + JSON.stringify({ ...out, ms }) + '\n');
