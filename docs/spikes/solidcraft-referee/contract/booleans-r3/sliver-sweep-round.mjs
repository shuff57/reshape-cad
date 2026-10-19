#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Raw SolidCraft, no translator: how thin can the overlap of a ROUND tool be before cut / keep silently ignore it?
// Axis-aligned 40x40x20 box part (top face z = 10); tools reach DOWN into it by `d` mm: a cylinder with a vertical axis (flat cap enters), a cylinder lying on its side
// (curved surface enters), a sphere. Exact closed forms; truck is judged exact when |V - closed form| <= 3e-4 * closed form (the curved bar) or, for keep, when a body exists.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r3/sliver-sweep-round.mjs [--out=booleans-r3/sliver-sweep-round.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRaw } from '../bool-raw.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const cyl = (n, r, h, base, axis = 'Z') => ({ command: 'solid.cylinder', params: { radius: r, height: h, base, axis, body_name: n } });
const sph = (n, r, c) => ({ command: 'solid.sphere', params: { radius: r, center: c, body_name: n } });
const comb = (operation) => ({ command: 'solid.combine', params: { target: 'a', tools: ['t'], operation } });
const PI = Math.PI;
const DEPTHS = [2, 1, 0.7, 0.5, 0.35, 0.25, 0.2, 0.15, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
const segArea = (R, d) => R * R * Math.acos((R - d) / R) - (R - d) * Math.sqrt(2 * R * d - d * d);
const TOOLS = {
  'cylinder-vertical-r5': (d) => ({ cmds: [cyl('t', 5, 20, [0, 0, 10 - d])], cap: PI * 25 * d }),
  'cylinder-on-side-r10': (d) => ({ cmds: [cyl('t', 10, 20, [0, -10, 10 + 10 - d], 'Y')], cap: segArea(10, d) * 20 }),
  'sphere-r10': (d) => ({ cmds: [sph('t', 10, [0, 0, 10 + 10 - d])], cap: PI * d * d * (30 - d) / 3 }),
};
const rows = [];
for (const [tool, mk] of Object.entries(TOOLS)) for (const operation of ['cut', 'intersect']) for (const d of DEPTHS) {
  const { cmds, cap } = mk(d);
  const r = runRaw([box('a', 40, 40, 20, [0, 0, 0]), ...cmds, comb(operation)], { timeoutS: 120 });
  const v = r.ok ? (r.bodies.find((b) => b.name === 'a')?.volume ?? null) : null;
  const expected = operation === 'cut' ? 32000 - cap : cap;
  // cut: judged on the volume that is LEFT (bar 3e-4 of it, the group's curved bar) and a part returned exactly unchanged is a SILENT NO-OP; the removed volume against the closed-form cap is printed as `removedRatio`
  // (tessellation noise on the 32000 mm3 left is far above a sub-mm3 cap, so the ratio itself is not a pass/fail bar). intersect: judged on the kept volume with the same 3e-4 bar
  const got = v === null ? null : operation === 'cut' ? 32000 - v : v;
  const relErr = v === null ? null : operation === 'cut' ? Math.abs(v - expected) / expected : Math.abs(v - expected) / Math.max(expected, 1);
  const noop = operation === 'cut' && v !== null && Math.abs(v - 32000) < 1e-6;
  const verdict = !r.ok ? (r.hang ? 'HANG' : 'REFUSED') : v === null ? 'NO-BODY' : noop ? 'SILENT NO-OP' : relErr <= 3e-4 ? 'exact' : 'WRONG-VOLUME';
  const removedRatio = operation === 'cut' && got !== null ? got / cap : undefined;
  rows.push({ tool, operation, depthMm: d, expected, scVolume: v, relErr, removedRatio, verdict, ms: r.ms, error: r.ok ? undefined : (r.failed?.error ?? r.note ?? r.error)?.slice(0, 120) });
  console.log(tool.padEnd(22), operation.padEnd(10), String(d).padEnd(7), 'expected', expected.toPrecision(8).padEnd(12), 'SC', String(v === null ? '-' : v.toPrecision(8)).padEnd(12), verdict, relErr === null ? '' : relErr.toExponential(1));
}
const summary = {};
for (const tool of Object.keys(TOOLS)) for (const operation of ['cut', 'intersect']) {
  const rs = rows.filter((r) => r.tool === tool && r.operation === operation);
  // thinnest depth such that it and every thicker depth is exact
  let thinnest = null; for (const r of rs) { if (r.verdict === 'exact') thinnest = r.depthMm; else break; }
  summary[`${tool}/${operation}`] = { thinnestExactMm: thinnest, notExact: rs.filter((r) => r.verdict !== 'exact').map((r) => `${r.depthMm}:${r.verdict}`) };
}
writeFileSync(path.resolve(arg('out', path.join(HERE, 'sliver-sweep-round.json'))), JSON.stringify({ rows, summary }, null, 1));
console.log(JSON.stringify(summary, null, 1));
