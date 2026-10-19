// SHIPPING PATH: runs reSHape Script texts through the REAL phase 7 pane in a browser (interpreter in the sandbox iframe, translate-p4 with
// the browser-side name resolver resolve-names.mjs, the real solidcraft wasm app). No brep-rs pick, no pick-retry loop of the phase 0 rig.
//   sh docs/spikes/solidcraft-referee/phase7/run.sh   (or: node phase7/serve.mjs --port=8801)   then, from OUTSIDE the repo:
//   cd <scratch> && bun <repo>/docs/spikes/solidcraft-referee/contract/fillet-chamfer-evidence/browser-run.mjs --ids=a,b,c --out=<file> [--url=http://127.0.0.1:8801]
// Session name `fcspike` (never `mom`). Output rows: {id, script, ok, error, refusals, features, volume, faces, bbox, com}.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = arg('url', 'http://127.0.0.1:8801');
const ids = arg('ids', '').split(',').filter(Boolean);
const prefixes = arg('prefix', '').split(',').filter(Boolean);
const OUT = arg('out', 'browser-results.json');
const SESSION = '-s=fcspike';
const pw = (...a) => execFileSync('playwright-cli', [SESSION, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn) => {
  const o = pw('eval', fn);
  const m = o.match(/### Result\n([\s\S]*?)\n### /);
  if (!m) throw new Error('no result: ' + o.slice(0, 300));
  let v = JSON.parse(m[1]);
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* keep string */ } }
  return v;
};
const all = new Map();
for (const f of ['cases.mjs', 'cases-r2.mjs', 'cases-r2b.mjs', 'cases-r2c.mjs', 'cases-seq.mjs', 'cases-fc.mjs', 'cases-r3.mjs', 'cases-r3f.mjs']) {
  const m = await import(pathToFileURL(path.join(HERE, f)).href);
  for (const c of m.CASES) if ((c.script || c.doc) && !all.has(c.id)) all.set(c.id, c);
}
const want = [...all.keys()].filter((k) => ids.includes(k) || prefixes.some((p) => k.startsWith(p)));
for (const i of ids) if (!all.has(i)) console.log('UNKNOWN ID (doc-only or missing):', i);
try { pw('dialog-accept'); } catch { /* none */ }
try { pw('goto', `${BASE}/?webgl&pane=on`); } catch { pw('open', `${BASE}/?webgl&pane=on`); }
pw('resize', '1280', '720'); await sleep(6000);
const out = [];
for (const id of want) {
  const c = all.get(id);
  let r;
  try {
    if (c.doc) {
      // ModelDoc-only case: the pane's own translateRaw (same translator, no script, no sandbox)
      const t = ev(`async () => JSON.stringify(await window.__host.translateRaw({ version: 1, features: ${JSON.stringify(c.doc)} }))`);
      const bodies = (t.bodies ?? []).map((b) => ({ name: b.name, volume: b.volume, faces: b.faces }));
      r = { ok: true, volume: bodies.reduce((s, b) => s + b.volume, 0), bodies, features: t.features, refusals: (t.features ?? []).filter((f) => f.status === 'refused').map((f) => f.refusal) };
    } else {
      r = ev(`async () => { window.__host.setScript(${JSON.stringify(c.script)}); const r = await window.__host.run({ confirmed: true }); return JSON.stringify(r); }`);
    }
  } catch (e) { r = { error: 'DRIVER: ' + String(e.message).slice(0, 200) }; }
  const row = {
    id, script: c.script ?? JSON.stringify(c.doc), ok: r?.ok ?? null, error: r?.error ?? null, verdict: r?.verdict ?? null, noNewBuild: r?.noNewBuild ?? null,
    refusals: r?.refusals ?? null, features: (r?.features ?? []).map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, pick: f.pick })),
    volume: r?.volume ?? null, faces: (r?.bodies ?? []).reduce((s, b) => s + b.faces, 0), bodies: (r?.bodies ?? []).length, bbox: r?.bodies?.[0]?.bbox ?? null,
  };
  out.push(row);
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(id.padEnd(40), row.error ? 'ERROR ' + String(row.error).slice(0, 120) : `vol ${row.volume?.toFixed(4)} faces ${row.faces} refusals ${JSON.stringify(row.refusals)?.slice(0, 220)}`);
  await sleep(200);
}
console.log('wrote', OUT);
