#!/usr/bin/env node
// SPIKE (phase 7). Pocket walls under 2t, through the app's own bridge. Plate 40x30x10, a pocket 6 mm deep cut from the top leaving a wall `w`
// ALL ROUND, shell 1 mm opened at the POCKET FLOOR (so the walls stand on the open face). No closed-form volume is claimed; this records which
// walls build and which sentence each refusal gives. Session `p7pocket` (throwaway, closed at the end; never `mom`).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = arg('url', 'http://127.0.0.1:8801'); const OUT = arg('out', new URL('./probe-pocket-walls-results.json', import.meta.url).pathname);
const pw = (...a) => execFileSync('playwright-cli', ['-s=p7pocket', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const ev = (fn) => { const o = pw('eval', fn); const m = o.match(/### Result\n([\s\S]*?)\n### /); let v = JSON.parse(m[1]); if (typeof v === 'string') v = JSON.parse(v); return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
pw('open', `${BASE}/?webgl&pane=on`); pw('resize', '1280', '720'); await sleep(6000);
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const comb = (t, tool, op) => ({ command: 'solid.combine', params: { target: t, tools: [tool], operation: op } });
const out = { generatedAt: new Date().toISOString(), url: BASE, rows: [] };
for (const w of [3, 2.05, 2.0, 1.95, 1.5, 1.4, 1.2, 1.1, 1.0, 0.5]) {
  const cmds = [box('b1', 40, 30, 10, [0, 0, 0]), box('p', 40 - 2 * w, 30 - 2 * w, 6, [0, 0, 3]), comb('b1', 'p', 'cut'), { command: 'solid.shell', params: { faces: [[0, 0, 0]], thickness: 1, body: 'b1' } }];
  const r = ev(`async () => { const x = await window.__host.bridge.execute(${JSON.stringify(cmds)}, { fresh: true }); const m = x.measure; return JSON.stringify({ ok: x.ok, failed: x.failed && (x.failed.error || x.failed.message || JSON.stringify(x.failed)), v: x.ok && m ? (m.bodies || m).map((b) => b.volume_mm3) : null }); }`);
  const row = { wall: w, ok: r.ok, volume: r.v, sentence: r.failed ? String(r.failed).slice(0, 160) : null, kind: !r.failed ? 'built' : /boolean/i.test(r.failed) ? 'boolean-Cut sentence' : /wall standing on the open face/.test(r.failed) ? 'wall sentence' : 'other' };
  out.rows.push(row); console.log(JSON.stringify(row));
}
writeFileSync(OUT, JSON.stringify(out, null, 1)); pw('close');
