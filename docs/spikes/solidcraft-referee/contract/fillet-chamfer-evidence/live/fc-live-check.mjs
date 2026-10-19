// SPIKE, referee only. EQUIVALENCE CHECK: the forked translator with every FC switch OFF (mode 'pane') must give what the shipping pane gave when it was driven through
// window.__host.run (browser-results*.json, recorded in earlier rounds by browser-run.mjs). Same script, same wasm, compared on volume (to 1e-9 relative), face count and the SET
// of refused feature ids. Any difference is printed. Writes live-check-results.json.
//   bun live/fc-live-check.mjs [--n=400] [--stride=1]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, runScriptLive, runDocLive } from './fc-live.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVD = path.resolve(HERE, '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const N = Number(arg('n', 400)); const STRIDE = Number(arg('stride', 1));
const seen = new Map();
for (const f of readdirSync(EVD).filter((x) => /^browser-results.*\.json$/.test(x)).sort()) for (const r of JSON.parse(readFileSync(path.join(EVD, f), 'utf8'))) seen.set(r.id, r);
const rows = [...seen.values()].filter((r) => r.script && !r.error && r.volume != null);
await openPage();
const out = []; let same = 0; let diff = 0;
for (let i = 0; i < rows.length && out.length < N; i += STRIDE) {
  const r = rows[i];
  let got;
  try { got = r.script.startsWith('[') ? runDocLive({ version: 1, features: JSON.parse(r.script) }, { mode: 'pane' }) : runScriptLive(r.script, { mode: 'pane' }); } catch (e) { got = { error: String(e.message).slice(0, 200) }; }
  const refGot = (got.features ?? []).filter((f) => f.status === 'refused').map((f) => f.id).sort().join(',');
  const refWas = (r.features ?? []).filter((f) => f.status === 'refused').map((f) => f.id).sort().join(',');
  const dv = got.volume == null ? Infinity : Math.abs(got.volume - r.volume) / Math.max(1, Math.abs(r.volume));
  const ok = dv <= 1e-9 && got.faces === r.faces && refGot === refWas;
  if (ok) same++; else { diff++; console.log('DIFF', r.id, 'volume', r.volume, '->', got.volume, 'faces', r.faces, '->', got.faces, 'refused', refWas, '->', refGot, got.error ?? ''); }
  if (out.length % 10 === 9) console.log(`progress ${out.length + 1}: identical ${same}, different ${diff}`);
  out.push({ id: r.id, ok, wasVolume: r.volume, gotVolume: got.volume ?? null, wasFaces: r.faces, gotFaces: got.faces ?? null, wasRefused: refWas, gotRefused: refGot });
}
writeFileSync(path.join(EVD, 'live-check-results.json'), JSON.stringify({ n: out.length, same, diff, stride: STRIDE, rows: out }, null, 1));
console.log(`compared ${out.length}: identical ${same}, different ${diff}`);
