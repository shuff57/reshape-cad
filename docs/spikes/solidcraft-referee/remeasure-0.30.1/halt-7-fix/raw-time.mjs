// raw-time.mjs <raw-v0.json> <pkg> <watchdogS>: each case's first hollow command list (the host route's first pick) run alone on <pkg>, one fresh process each, timed
import { spawnSync } from 'node:child_process'; import { readFileSync } from 'node:fs';
const RUN1 = new URL('./run1.mjs', import.meta.url).pathname; const W = Number(process.argv[4]) * 1000;
for (const c of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  const t0 = performance.now();
  const p = spawnSync(process.execPath, [RUN1, process.argv[3]], { input: JSON.stringify({ commands: c.cmds }), timeout: W, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
  const wall = Math.round(performance.now() - t0);
  if (p.signal) { console.log(JSON.stringify({ id: c.id, timeout: true, wallMs: wall })); continue; }
  const o = JSON.parse(String(p.stdout)); const r = o.res;
  console.log(JSON.stringify({ id: c.id, ms: o.ms, wallMs: wall, ok: !!r.ok, error: r.ok ? null : (r.failed?.error ?? null), vol: r.ok ? r.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) : null }));
}
