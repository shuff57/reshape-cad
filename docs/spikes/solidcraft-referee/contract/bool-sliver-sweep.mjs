#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Raw SolidCraft (no translator): how thin can the overlap of a cut / keep / join be before SolidCraft
// silently ignores it?  Axis-aligned part and a part rotated 30 degrees about y (tool rotated the same, so its face stays parallel to the part's face).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/bool-sliver-sweep.mjs [--out=booleans-r2/sliver-sweep.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRaw } from './bool-raw.mjs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const rotY = (n, deg) => ({ command: 'solid.move', params: { bodies: [n], axis: [0, 1, 0], angle: deg } });
const mv = (n, t) => ({ command: 'solid.move', params: { bodies: [n], translate: t } });
const comb = (operation) => ({ command: 'solid.combine', params: { target: 'a', tools: ['t'], operation } });
const DEPTHS = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.007, 0.005, 0.003, 0.002, 0.0015, 0.001, 0.0005, 0.0001];
const rows = [];
const volOf = (r) => (r.ok ? (r.bodies.find((b) => b.name === 'a')?.volume ?? null) : null);
for (const setup of ['axis-aligned', 'rotated-30deg']) {
  for (const operation of ['cut', 'intersect', 'join']) {
    for (const d of DEPTHS) {
      const cmds = setup === 'axis-aligned'
        ? [box('a', 40, 40, 20, [0, 0, 0]), box('t', 10, 10, 10, [0, 0, 15 - d]), comb(operation)]
        : [box('a', 40, 40, 20, [0, 0, 0]), rotY('a', 30), box('t', 10, 10, 10, [0, 0, 0]), rotY('t', 30), mv('t', [Math.sin(Math.PI / 6) * (15 - d), 0, Math.cos(Math.PI / 6) * (15 - d)]), comb(operation)];
      const expected = operation === 'cut' ? 32000 - 100 * d : operation === 'intersect' ? 100 * d : 33000 - 100 * d;
      const r = runRaw(cmds, { timeoutS: 60 });
      const v = volOf(r);
      const verdict = !r.ok ? (r.hang ? 'HANG' : 'REFUSED') : v === null ? 'NO-BODY' : Math.abs(v - expected) <= 1e-9 * Math.max(1, expected) ? 'exact' : (operation === 'cut' && Math.abs(v - 32000) < 1e-9) ? 'SILENT NO-OP' : (operation === 'join' && Math.abs(v - 33000) < 1e-9) ? 'ignored overlap (joined as if separate)' : 'other';
      rows.push({ setup, operation, depthMm: d, expected, scVolume: v, verdict, error: r.ok ? undefined : (r.failed?.error ?? r.note ?? r.error)?.slice(0, 120) });
      console.log(setup.padEnd(14), operation.padEnd(9), String(d).padEnd(7), 'expected', expected.toFixed(4).padEnd(12), 'SC', String(v === null ? '-' : v.toFixed(4)).padEnd(12), verdict);
    }
  }
}
const first = (setup, operation) => { const ok = rows.filter((r) => r.setup === setup && r.operation === operation && r.verdict === 'exact').map((r) => r.depthMm); return ok.length ? Math.min(...ok) : null; };
const summary = {};
for (const s of ['axis-aligned', 'rotated-30deg']) for (const o of ['cut', 'intersect', 'join']) summary[`${s}/${o}`] = { thinnestExactMm: first(s, o), silentBelow: rows.filter((r) => r.setup === s && r.operation === o && r.verdict !== 'exact').map((r) => `${r.depthMm}:${r.verdict}`) };
writeFileSync(path.resolve(arg('out', path.join(HERE, 'booleans-r2', 'sliver-sweep.json'))), JSON.stringify({ rows, summary }, null, 1));
console.log(JSON.stringify(summary, null, 1));
