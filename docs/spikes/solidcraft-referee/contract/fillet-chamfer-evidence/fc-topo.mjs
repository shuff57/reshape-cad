// Fetches the REAL truck topology (model.faces / model.edges as the phase 4+ bridge snapshots them) of the target body JUST BEFORE each blend command, by sending
// the command-list prefix to the shipping pane's own bridge (window.__host.bridge.execute(cmds, {fresh:true, topology:true})) in a real browser.
//   bun fc-topo.mjs --in=fc-cmds-fuzz.json,res-r2.json,... --out=fc-topo.json [--session=fcspike2] [--url=http://127.0.0.1:8801]
// A prefix is keyed by its JSON; identical prefixes are fetched once. Session name fcspike2 (never `mom`).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const OUT = arg('out', 'fc-topo.json'); const SESSION = `-s=${arg('session', 'fcspike2')}`; const BASE = arg('url', 'http://127.0.0.1:8801');
const pw = (...a) => execFileSync('playwright-cli', [SESSION, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
export const keyOf = (prefix) => createHash('sha1').update(JSON.stringify(prefix)).digest('hex').slice(0, 16);
export const isBlend = (c) => c.command === 'solid.fillet' || c.command === 'solid.chamfer';
export function itemsOf(files) {
  const items = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
    const rows = Array.isArray(d) ? d : d.rows;
    rows.forEach((r) => { const cmds = r.fx?.commands ?? r.commands; if (cmds) items.push({ id: r.id ?? `${f}#${r.i}`, commands: cmds }); });
  }
  return items;
}
if (import.meta.main ?? process.argv[1]?.endsWith('fc-topo.mjs')) {
  const files = arg('in').split(',').filter(Boolean);
  const have = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const todo = new Map();
  for (const it of itemsOf(files)) it.commands.forEach((c, i) => { if (isBlend(c)) { const p = it.commands.slice(0, i); const k = keyOf(p); if (!have[k] && !todo.has(k)) todo.set(k, p); } });
  console.log('prefixes to fetch:', todo.size, 'cached:', Object.keys(have).length);
  try { pw('goto', `${BASE}/?webgl&pane=on`); } catch { pw('open', `${BASE}/?webgl&pane=on`); }
  await new Promise((r) => setTimeout(r, 6000));
  let n = 0;
  for (const [k, prefix] of todo) {
    const js = `async () => { const r = await window.__host.bridge.execute(${JSON.stringify(prefix)}, { fresh: true, topology: true }); return JSON.stringify({ ok: r.ok, topology: r.topology, measure: r.measure && { bodies: r.measure.bodies.map((b) => ({ name: b.name, volume_mm3: b.volume_mm3, faces: b.faces, bbox: b.bbox })) }, failed: r.failed, rejected: r.rejected }); }`;
    try {
      const o = pw('eval', js); const m = o.match(/### Result\n([\s\S]*?)\n### /);
      let v = JSON.parse(m[1]); if (typeof v === 'string') v = JSON.parse(v);
      have[k] = v.ok ? { bodies: v.topology.bodies, truncated: v.topology.truncated, measure: v.measure } : { error: JSON.stringify(v.failed ?? v.rejected) };
    } catch (e) { have[k] = { error: 'DRIVER ' + String(e.message).slice(0, 200) }; }
    if (++n % 10 === 0) { writeFileSync(OUT, JSON.stringify(have)); console.log(n, '/', todo.size); }
  }
  writeFileSync(OUT, JSON.stringify(have));
  console.log('wrote', OUT, Object.keys(have).length);
}
