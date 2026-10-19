#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Raw SolidCraft: when does join / cut of two overlapping balls come back with extra (cone-labelled) faces? One child process per probe.
// OCCT gives 2 faces for every pair below (checked in the analysis column by face count only: a union / cut of two overlapping balls has exactly 2 faces on the outside).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r3/sphere-sphere-sweep.mjs [--out=booleans-r3/sphere-sphere-sweep.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRaw } from '../bool-raw.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const S = (n, r, c) => ({ command: 'solid.sphere', params: { radius: r, center: c, body_name: n } });
const rows = [];
const PAIRS = [[15, 12], [15, 10], [12, 12], [10, 15], [15, 8], [20, 12], [10, 6]];
const OFFS = [[8, 0, 0], [10, 0, 0], [12, 0, 0], [0, 10, 0], [0, 0, 10], [7, 7, 0]];
for (const [R, r] of PAIRS) for (const off of OFFS) for (const op of ['join', 'cut']) {
  const d = Math.hypot(...off);
  if (!(d < R + r - 1 && d > Math.abs(R - r) + 1)) continue;   // the surfaces must cross
  const res = runRaw([S('a', R, [0, 0, 0]), S('t', r, off), { command: 'solid.combine', params: { target: 'a', tools: ['t'], operation: op } }], { timeoutS: 60 });
  const b = res.ok ? res.bodies[0] : null;
  const row = { R, r, off, op, ok: res.ok, faces: b?.faces, types: b?.face_types, kernelFaces: b?.kernel?.faces, volume: b?.volume, ms: res.ms };
  rows.push(row);
  console.log(`R${R} r${r} off ${off.join(',').padEnd(8)} ${op.padEnd(5)} ${res.ok ? `faces ${b.faces} ${JSON.stringify(b.face_types)} kernel ${b.kernel.faces}` : 'FAIL ' + (res.failed?.error ?? res.note ?? '').slice(0, 80)} ${res.ms}ms`);
}
writeFileSync(path.resolve(arg('out', path.join(HERE, 'sphere-sphere-sweep.json'))), JSON.stringify(rows, null, 1));
