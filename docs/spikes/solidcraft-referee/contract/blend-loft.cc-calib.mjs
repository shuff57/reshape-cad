// Calibration of the circle<->circle tessellation error (round 4). Live truck vs live OCCT vs the closed-form frustum volume.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.cc-calib.mjs [--out=file.json]
import { writeFileSync } from 'node:fs';
import { circ, bl, full, frustumVolume, rel, lcg } from './blend-loft.live-lib.mjs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const rows = [];
const one = (r1, r2, h, lat) => {
  const doc = { version: 1, features: [circ('a', 0, 0, r1, 'xy', 0), circ('b', lat, 0, r2, 'xy', h), bl('a', 'b')] };
  const c = full(doc);
  const an = frustumVolume(r1, r2, h);
  const dAn = c.truck.volume !== undefined ? rel(c.truck.volume, an) : null;
  const dOAn = c.occt.volume !== undefined ? rel(c.occt.volume, an) : null;
  const diag = Math.hypot(Math.max(r1, lat + r2) + Math.max(r1, r2 - lat), 2 * Math.max(r1, r2), h);
  rows.push({ r1, r2, h, lat, d: c.d ?? null, dAn, dOAn, signed: c.signed ?? null, diag, rmin: Math.min(r1, r2), ratio: diag / Math.min(r1, r2), tr: c.truck.refused ?? null, oc: c.occt.refused ?? null, faces: [c.occt.faces, c.truck.faces] });
};
for (const r of [0.05, 0.25, 1, 3, 10, 30]) for (const h of [1, 10, 30, 100, 300, 1000]) { one(r, r, h, 0); one(r, r * 0.5, h, 0); }
for (const [r1, r2] of [[1, 1], [10, 10], [10, 3], [30, 5]]) for (const lat of [10, 100]) one(r1, r2, 30, lat);
rows.sort((a, b) => (b.d ?? 0) - (a.d ?? 0));
for (const x of rows) console.log(`r1 ${x.r1} r2 ${x.r2} h ${x.h} lat ${x.lat} | d(T/O) ${x.d?.toExponential(2)} d(T/an) ${x.dAn?.toExponential(2)} d(O/an) ${x.dOAn?.toExponential(1)} signed ${x.signed?.toExponential(2)} | ratio diag/rmin ${x.ratio.toFixed(1)} ${x.tr ?? ''}`);
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
