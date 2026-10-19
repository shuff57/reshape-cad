// PERF: wall time of the exact solidcraft command lists the translator emits for the slow cases, 3 repeats each, nothing else running.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun perf.mjs --from=res-r2.json
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const res = JSON.parse(readFileSync(arg('from', 'res-r2.json'), 'utf8'));
const ids = arg('ids', '') ? arg('ids', '').split(',') : ['pf-cyl-whole-r3', 'pf-cyl-offc-whole-r3', 'pf-corner-then-join', 'ov-d-box-fillet-4', 'ov-d-box-fillet-9.99', 'ov-f-pair-cyl-10', 'ov-c-cyl-single-14.9'];
const out = []; const load = (await import('node:os')).loadavg();
for (const id of ids) {
  const r = res.find((x) => x.id === id);
  const cmds = r?.fx?.commands;
  if (!cmds) { console.log(id, 'no commands'); continue; }
  const times = [];
  let vol = null;
  for (let k = 0; k < +arg('repeats', 3); k++) {
    const t0 = Date.now();
    const o = JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
    times.push(Date.now() - t0);
    vol = o.ok ? o.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) : null;
  }
  out.push({ id, commands: cmds.length, times, volume: vol, loadavgAtStart: load.map((x) => +x.toFixed(1)) });
  console.log(id.padEnd(26), 'ms', times.join(' / '), 'vol', vol);
}
writeFileSync(arg('out', 'perf-results.json'), JSON.stringify(out, null, 1));
