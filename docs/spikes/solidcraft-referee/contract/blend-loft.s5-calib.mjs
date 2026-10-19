// Calibration of the rounded-rectangle <-> circle class (round 4). Live truck vs live OCCT, TRUE relative error |T-O|/|O| (no floor at 1).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.s5-calib.mjs --out=file.json
import { writeFileSync } from 'node:fs';
import { circ, bl, full, roundedRectDoc, rel } from './blend-loft.live-lib.mjs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const rows = [];
const relT = (a, b) => Math.abs(a - b) / Math.abs(b);
for (const w of [10, 30]) for (const asp of [1, 1.15, 1.35]) for (const rf of [0.05, 0.2, 0.4, 0.49]) for (const cf of [0.5, 0.8, 1.2]) for (const circleFirst of [true, false]) {
  const h = w; const hh = w / asp; const r = rf * Math.min(w, hh); const rc = cf * w / 2;
  const R = (id, off) => roundedRectDoc(id, 'xy', off, w, hh, r);
  const feats = circleFirst ? [circ('a', 0, 0, rc, 'xy', 0), R('b', h)] : [R('a', 0), circ('b', 0, 0, rc, 'xy', h)];
  const doc = { version: 1, features: [...feats, bl('a', 'b')] };
  const c = full(doc);
  rows.push({ w, asp, rf, r, cf, rc, circleFirst, h, guard: c.guard?.code ?? null, dT: c.truck.volume !== undefined && c.occt.volume !== undefined ? relT(c.truck.volume, c.occt.volume) : null, signed: c.signed ?? null, faces: [c.occt.faces, c.truck.faces], tr: c.truck.refused ?? null, oc: c.occt.refused ?? null });
}
rows.sort((a, b) => (b.dT ?? 0) - (a.dT ?? 0));
for (const x of rows) console.log(`w${x.w} asp${x.asp} r${x.r.toFixed(2)}(${x.rf}) rc${x.rc.toFixed(1)}(${x.cf}) ${x.circleFirst ? 'circle-first' : 'rounded-first'} | dT/O ${x.dT?.toExponential(2)} signed ${x.signed?.toExponential(2)} faces O/T ${x.faces} guard ${x.guard ?? 'PASS'} ${x.tr ?? ''}${x.oc ?? ''}`);
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
