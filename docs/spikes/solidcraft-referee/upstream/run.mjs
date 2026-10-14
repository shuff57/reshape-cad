// Shared runner for the three repros. Usage: SOLIDCRAFT_REFEREE_PKG2=<dir> node run.mjs <script.json>...
// Feeds ONLY solidcraft command JSON to a wasm build of solidcraft_engine::Session (spike wrapper2: returns every
// command's output and appends an "@sketch" pseudo-command that dumps the evaluated sketch). Prints raw results.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG2;
if (!PKG) { console.error('set SOLIDCRAFT_REFEREE_PKG2 to the dir holding solidcraft_referee_p2.js'); process.exit(2); }
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee_p2.js'));
export function run(cmds) { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); }
if ((process.argv[1] ?? '').endsWith('run.mjs')) {
  for (const f of process.argv.slice(2)) {
    const r = run(JSON.parse(readFileSync(f, 'utf8')));
    console.log('==', f);
    for (const x of r.results) if (!x.ok) console.log('ERR', x.i, x.command, x.error);
    console.log(JSON.stringify(r.measure, null, 1));
  }
}
