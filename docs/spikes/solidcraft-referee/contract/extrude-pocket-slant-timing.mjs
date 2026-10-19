#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 3. How long does the pinned truck spend on a slanted ROUND pocket, by what it has to cut around?
// The translator is run against a stub kernel with the after-build checks switched off (ctx.skipVerify) and the round-3 slanted-round guard bypassed (ctx.unguardedSlant), so each case yields the exact command list the round-2 mapping would have sent; that list is then run ONCE in a child process with a hard time limit.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/extrude-pocket-slant-timing.mjs [--limit=300] [--ids=a,b] > extrude-pocket-slant-timing.txt
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const one = arg('one');
if (one) {
  const { contract, arc, mt, sc, docOf } = await import('./extrude-pocket-r3-lib.mjs');
  const { CASES } = await import('./extrude-pocket-cases.mjs');
  await import('./extrude-pocket-cases-r2.mjs'); await import('./extrude-pocket-cases-r3.mjs');
  const c = CASES.find((x) => x.id === one);
  // the real kernel for everything except a slanted (loft) cut: that command is NOT run here, the list is only collected (the cut is what is timed below)
  const { runSC } = await import('./extrude-pocket-r3-lib.mjs');
  const stub = async (cmds) => { const last = cmds[cmds.length - 1]; return (last.command === 'solid.loft' && last.params.operation === 'cut') ? runSC(cmds.slice(0, -1)) : runSC(cmds); };
  const tr = await contract.translateDoc(docOf(c.script), { arc, mt, runSC: stub, skipVerify: true, unguardedSlant: true, resolveAt: () => null });
  const t0 = Date.now();
  const res = JSON.parse(sc.run(JSON.stringify({ commands: tr.commands })));
  const ms = Date.now() - t0;
  console.log('@@T@@' + JSON.stringify({ id: one, ms, commands: tr.commands.length, result: res.ok ? res.measure.bodies.map((b) => `${b.name}=${b.volume_mm3.toFixed(4)}`).join(' ') : `ERR ${String(res.failed?.error).slice(0, 100)}` }));
  process.exit(0);
}
const limit = Number(arg('limit') || 300);
const ids = (arg('ids') || 'sx-plain-block,sx-straight-cross,sx-hole-clear,sx-pocket-cross,sx-hole-cross').split(',');
console.log(`# one child process per case, hard limit ${limit} s; load average at start ${os.loadavg().map((x) => x.toFixed(1)).join(' ')}; cpus ${os.cpus().length}`);
for (const id of ids) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [here, `--one=${id}`], { encoding: 'utf8', timeout: limit * 1000, env: process.env });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('@@T@@'));
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${id.padEnd(26)} ${line ? JSON.stringify({ ...JSON.parse(line.slice(5)), wallS: Number(wall) }) : `NO RESULT after ${wall} s (${r.error?.code ?? r.signal ?? `exit ${r.status}`}) ${(r.stderr ?? '').slice(0, 160)}`}   load ${os.loadavg()[0].toFixed(1)}`);
}
