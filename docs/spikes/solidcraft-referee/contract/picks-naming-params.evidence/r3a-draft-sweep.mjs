// Round 3 A. Draft angle sweep on the PAGE translator (phase7/pane/lib/translate-p4.mjs), with an independent closed form.
// box(w,d,h) centred at the origin; draft(b.face(word), a [, {from:'bottom'}]); pull z; neutral plane z=n (0 by default, -h/2 for from:'bottom').
// MEASURED law (neutral -10..10 on the 40x30x20 box, SolidCraft = OCCT to 1e-15): for a positive angle the drafted face moves OUT below the
// neutral plane and IN above it, by |z-n|*tan(a); a negative angle is the reverse. The part is a valid solid iff the inward move stays
// under W (the distance to the opposite face) over the whole height.
//   outward(z) = (n - z) * tan(a)      valid volume = Dp*(W*h + tan(a)*(n*h - (z1^2 - z0^2)/2))    (Dp = extent along the other lateral axis)
//   bun r3a-draft-sweep.mjs [--out=file]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { guardedTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3a-draft-sweep.json';
const dims = [[40, 30, 20], [40, 30, 5], [10, 30, 20]];
const faces = ['right', 'left', 'front', 'back'];
const angles = [1, 5, 30, 45, 60, 63, 64, 70, 75, 76, 80, 85, 89.5];
const rows = [];
let n = 0;
for (const [w, d, h] of dims) for (const word of faces) for (const from of [null, 'bottom']) for (const sgn of [1, -1]) for (const a0 of angles) {
  const a = a0 * sgn;
  const W = (word === 'left' || word === 'right') ? w : d;   // distance between the drafted face and the opposite face
  const Dp = (word === 'left' || word === 'right') ? d : w;  // extent along the other lateral axis
  const z0 = -h / 2, z1 = h / 2; const nz = from === 'bottom' ? z0 : 0;
  const t = Math.tan(a * Math.PI / 180);
  const inw = a >= 0 ? (z1 - nz) * t : (nz - z0) * -t; // largest inward move over the face height
  const feasible = inw < W - 1e-9;
  const closedV = Dp * (W * h + t * (nz * h - (z1 * z1 - z0 * z0) / 2));
  const src = `const b=box(${w},${d},${h})\ndraft(b.face('${word}'),${a}${from ? `,{from:'${from}'}` : ''})`;
  const r = L.fromScript(src); if (r.errors.length) { rows.push({ src, scriptError: r.errors[0].message }); continue; }
  const ref = L.references(r.doc); const row = await L.scored(r.doc, { ref });
  const o = { w, d, h, word, from, a, W, feasible, closedV, outcome: row.outcome, sentence: row.sentence?.slice(0, 160), truck: row.truck && { V: row.truck.volume, faces: row.truck.faces, bbox: row.truck.bbox }, occtV: ref.occt?.volume, occtRefusals: ref.occtRefusals, brepV: ref.brep?.volume, brepRefusals: ref.brepRefusals };
  o.dClosed = row.truck ? Math.abs(row.truck.volume - closedV) / closedV : null;
  // verdict against truth (closed form feasibility), not against "an oracle exists"
  if (row.outcome === 'REFUSED') o.verdict = feasible ? 'OVER-REFUSAL' : 'REFUSED-OK';
  else if (!feasible) o.verdict = 'SILENT-WRONG';
  else o.verdict = o.dClosed < 1e-9 ? 'EXACT' : 'WRONG-VOLUME';
  const g = await guardedTranslate(r.doc); const gm = g.features.find((f) => f.id === row.id);
  o.g = { status: gm.status, sentence: gm.refusal, raw: gm.rawRefusal?.slice(0, 120), V: gm.measure?.volume, unmapped: g.unmapped.length };
  o.gVerdict = gm.status === 'refused' ? (feasible ? 'OVER-REFUSAL' : 'REFUSED-OK') : !feasible ? 'SILENT-WRONG' : (row.truck && Math.abs(gm.measure.volume - row.truck.volume) < 1e-9 * Math.max(1, Math.abs(row.truck.volume)) ? 'EXACT' : 'CHANGED');
  // the limit the guard sentence states ("about X degrees") against an independent atan(W / D), D = distance from the neutral plane to the end that leans inward
  if (gm.status === 'refused') { const mm = /about ([0-9.]+) degrees/.exec(gm.refusal ?? ''); const D = a > 0 ? z1 - nz : nz - z0; const lim = (Math.atan(W / D) * 180) / Math.PI; o.limitStated = mm ? +mm[1] : null; o.limitIndep = lim; o.limitOK = !!mm && Math.abs(+mm[1] - Math.floor(lim * 10) / 10) < 1e-9 && +mm[1] <= Math.abs(a); }
  rows.push(o); n++;
  if (n % 40 === 0) console.error(n);
}
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const c = {}; for (const r of rows) c[r.verdict ?? 'SCRIPTERR'] = (c[r.verdict ?? 'SCRIPTERR'] ?? 0) + 1;
const cg = {}; for (const r of rows) cg[r.gVerdict ?? 'SCRIPTERR'] = (cg[r.gVerdict ?? 'SCRIPTERR'] ?? 0) + 1;
console.log('cases', rows.length, 'PAGE', JSON.stringify(c), 'GUARDED', JSON.stringify(cg));
console.log('stated limit == independent atan(W/D) floored to 0.1 and <= |angle|:', rows.filter((r) => r.g?.status === 'refused' && r.limitOK).length, '/', rows.filter((r) => r.g?.status === 'refused').length);
console.log('example guard sentences:', [...new Set(rows.filter((r) => r.g?.status === 'refused').map((r) => r.g.sentence))].slice(0, 6).join(' || '));
for (const r of rows.filter((r) => ['SILENT-WRONG', 'OVER-REFUSAL', 'WRONG-VOLUME'].includes(r.verdict)).slice(0, 400)) console.log(r.verdict, `${r.w}x${r.d}x${r.h}`, r.word, r.from ?? '-', r.a, 'truckV', r.truck?.V?.toFixed(3), 'closed', r.closedV.toFixed(3), 'faces', r.truck?.faces, 'occt', r.occtV?.toFixed?.(3) ?? JSON.stringify(r.occtRefusals).slice(0, 60), r.sentence ?? '');
