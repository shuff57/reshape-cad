#!/usr/bin/env node
// SPIKE (phase 7). Shell probes THROUGH THE APP (the page's own bridge, window.__host.bridge.execute, the path the pane uses):
//  1 rim family: a 10x10 rim, 6 mm tall, wall w, flush in the corner of a 40x30x10 plate, shell 1 mm opened at the plate top,
//    against the plane-offset closed form P(w) = 2872 - 48 (w - 2) (w > 2t exact; w <= 2t refused)
//  2 the critic cases n6 n9 n10 n11 n13 (+ n4, n8b), reference = the P figures recorded in fixes/shell-stub/NOTES.md (OCCT box compositions)
// Session `p7shell` (throwaway, closed at the end; never `mom`).  node probe-shell-rim.mjs [--url=http://127.0.0.1:8801]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = arg('url', 'http://127.0.0.1:8801'); const OUT = arg('out', new URL('./probe-shell-rim-results.json', import.meta.url).pathname);
const pw = (...a) => execFileSync('playwright-cli', ['-s=p7shell', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const ev = (fn) => { const o = pw('eval', fn); const m = o.match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error('no result ' + o.slice(0, 300)); let v = JSON.parse(m[1]); if (typeof v === 'string') v = JSON.parse(v); return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { pw('open', `${BASE}/?webgl&pane=on`); } catch { pw('goto', `${BASE}/?webgl&pane=on`); }
pw('resize', '1280', '720'); await sleep(6000);
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const comb = (t, tool, op) => ({ command: 'solid.combine', params: { target: t, tools: [tool], operation: op } });
const shell = (pt, t = 1) => ({ command: 'solid.shell', params: { faces: [pt], thickness: t, body: 'b1' } });
const plate = box('b1', 40, 30, 10, [0, 0, 0]);
const rim = (w) => [plate, box('b2', 10, 10, 6, [15, 10, 8]), box('h', 10 - 2 * w, 10 - 2 * w, 8, [15, 10, 8]), comb('b2', 'h', 'cut'), comb('b1', 'b2', 'join'), shell([-17, -12, 5])];
const fil = (pts, r) => ({ command: 'solid.fillet', params: { edges: pts, radius: r, body: 'b1' } });
const corners = [[20, 15, 0], [-20, 15, 0], [20, -15, 0], [-20, -15, 0]];
const cases = [];
for (const w of [3, 2.5, 2.05, 2.006, 2.002, 2.0, 1.95, 1.5]) cases.push({ name: `rim w=${w}`, cmds: rim(w), P: w > 2 ? 2872 - 48 * (w - 2) : null, expect: w > 2 ? 'exact' : 'refused' });
// hole ligament family: plate 40x30x10, vertical through hole r2, shell 1 mm opened at the top. web = gap from the hole edge to a side wall
// (or, for two holes, between the two hole edges). Closed form (plane offset): clear 2424 + 41 pi; two clear holes 2424 + 82 pi;
// web 1.0 east 2524.93, north 2524.87, 1.9 east 2551.88, two holes, edge gap 1.0 2661.10 (these four are the critic's / the notes' figures, not mine)
const hole = (n, cx, cy) => [{ command: 'solid.cylinder', params: { radius: 2, height: 20, base: [cx, cy, -10], body_name: n } }, comb('b1', n, 'cut')];
const holes = (list) => [plate, ...list.flatMap(([cx, cy], i) => hole('h' + (i + 1), cx, cy)), shell([-10, -8, 5])];
const one = 2424 + 41 * Math.PI, two = 2424 + 82 * Math.PI;
cases.push(
  { name: 'ligament: hole web 1.0 east', cmds: holes([[17, 0]]), P: 2524.93, expect: 'refused' },
  { name: 'ligament: hole web 1.0 north', cmds: holes([[0, 12]]), P: 2524.87, expect: 'refused' },
  { name: 'ligament: hole web 1.5 east', cmds: holes([[16.5, 0]]), P: null, expect: 'refused' },
  { name: 'ligament: hole web 1.9 east', cmds: holes([[16.1, 0]]), P: 2551.88, expect: 'refused' },
  { name: 'ligament: hole web 2.0 east (exactly 2t)', cmds: holes([[16, 0]]), P: one, expect: 'built' },
  { name: 'ligament: hole web 2.1 east', cmds: holes([[15.9, 0]]), P: one, expect: 'exact' },
  { name: 'ligament: hole web 3.0 east', cmds: holes([[15, 0]]), P: one, expect: 'exact' },
  { name: 'ligament: two holes, edge gap 1.0', cmds: holes([[-2.5, 0], [2.5, 0]]), P: 2661.10, expect: 'refused' },
  { name: 'ligament: two holes, edge gap 1.9', cmds: holes([[-2.95, 0], [2.95, 0]]), P: null, expect: 'refused' },
  { name: 'ligament: two holes, edge gap 2.1', cmds: holes([[-3.05, 0], [3.05, 0]]), P: two, expect: 'exact' },
  { name: 'ligament: hole clear of the wall (centre)', cmds: holes([[0, 0]]), P: one, expect: 'exact' },
  { name: 'counterbore plate (r2 hole at (-8,-6), r4 x 2 counterbore), open top', cmds: [plate, ...hole('h1', -8, -6), { command: 'solid.cylinder', params: { radius: 4, height: 3, base: [-8, -6, 3], body_name: 'h2' } }, comb('b1', 'h2', 'cut'), shell([0, 8, 5])], P: 2424 + 65 * Math.PI, expect: 'exact' },
  { name: 'n7 boss 8x8x8 touching the open face at one vertex', cmds: [plate, box('b2', 8, 8, 8, [24, 19, 9]), comb('b1', 'b2', 'join'), shell([0, 0, 5])], P: 2720, expect: 'built (the notes: a separate piece, hollowed closed)' },
);
cases.push(
  { name: 'n6 rounded-corner plate, wall-flush boss', cmds: [plate, fil(corners, 3), box('b2', 10, 10, 8, [15, 0, 9]), comb('b1', 'b2', 'join'), shell([-5, 8, 5])], P: 2729.646, expect: 'exact' },
  { name: 'n9 corner boss with a hole through it', cmds: [plate, box('b2', 10, 10, 8, [15, 10, 9]), comb('b1', 'b2', 'join'), { command: 'solid.cylinder', params: { radius: 2, height: 30, base: [15, 10, -10], body_name: 'h1' } }, comb('b1', 'h1', 'cut'), shell([0, 0, 5])], P: 3002.195, expect: 'exact' },
  { name: 'n10 round boss r4 at (16,11)', cmds: [plate, { command: 'solid.cylinder', params: { radius: 4, height: 6, base: [16, 11, 5], body_name: 'b2' } }, comb('b1', 'b2', 'join'), shell([0, 0, 5])], P: 2584.221, expect: 'refused' },
  { name: 'n11 round pocket floor open', cmds: [plate, { command: 'solid.cylinder', params: { radius: 8, height: 4, base: [0, 0, 2], body_name: 'p1' } }, comb('b1', 'p1', 'cut'), shell([0, 0, 2])], P: 3393.752, expect: 'refused' },
  { name: 'n13 bottom-rounded box r2 (MY reconstruction: the critic script is not in the repo; r2 chosen because the notes hand loss of ~92 mm3 fits r2), corner boss', cmds: [plate, fil([[0, 15, -5], [0, -15, -5], [20, 0, -5], [-20, 0, -5]], 2), box('b2', 10, 10, 8, [15, 10, 9]), comb('b1', 'b2', 'join'), shell([0, 0, 5])], P: null, expect: 'whatever it measures (notes: 2686.883 for the critic case, not independently verified; 2776 ignores the rounding)' },
  { name: 'n8b pad 0.5 mm, t=1', cmds: [plate, box('b2', 10, 10, 0.5, [15, 10, 5.25]), comb('b1', 'b2', 'join'), shell([0, 0, 5])], P: 2474, expect: 'refused' },
  { name: 'control: plain open top 40x30x10 t=1 (no material on the open face)', cmds: [plate, shell([0, 0, 5])], P: 40 * 30 * 10 - 38 * 28 * 9, expect: 'exact' },
);
const results = { generatedAt: new Date().toISOString(), url: BASE, cases: [] };
for (const c of cases) {
  const r = ev(`async () => { const x = await window.__host.bridge.execute(${JSON.stringify(c.cmds)}, { fresh: true }); const m = x.measure; return JSON.stringify({ ok: x.ok, failed: x.failed && { command: x.failed.command, error: x.failed.error || x.failed.message || x.failed.reason || JSON.stringify(x.failed).slice(0, 600) }, keys: Object.keys(x), bodies: m && (m.bodies || m).map ? (m.bodies || m).map((b) => ({ n: b.name, v: b.volume_mm3, f: b.faces })) : null }); }`);
  const v = r.ok ? (r.bodies ?? []).reduce((s, b) => s + b.v, 0) : null;
  const row = { name: c.name, expect: c.expect, ok: r.ok, volume: v, P: c.P, relToP: v !== null && c.P ? Math.abs(v - c.P) / c.P : null, refusal: r.failed?.error ?? null, failedAt: r.failed?.command ?? null, bodies: r.ok ? r.bodies : undefined };
  results.cases.push(row); console.log(JSON.stringify(row).slice(0, 700));
}
writeFileSync(OUT, JSON.stringify(results, null, 1));
pw('close');
