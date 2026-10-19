// How good is the curve-size estimate? For every case the UNGUARDED path built (results/*.json) that has a curve and a reference value, compare the guard's
// estimate (estimateCurveError, safety 1) with the measured floor-free volume error against the best reference (closed form, else OCCT, else brep-rs).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun calibrate.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { arc, solvedGeoms } from './sg-core.mjs';
import { sketchInfo, estimateCurveError, LIMITS } from '../sketch-geometry.guard.mjs';
const dir = new URL('./results/', import.meta.url).pathname;
const gdir = new URL('./results-guarded/', import.meta.url).pathname;
const otherGuard = new Set(); // cases the guarded run refused for a reason that is not the curve-size rule: not this rule's business
for (const f of readdirSync(gdir).filter((x) => x.endsWith('.json') && x !== 'solve-moves.json')) for (const r of [JSON.parse(readFileSync(gdir + f, 'utf8'))].filter(Array.isArray).flat()) { if (r.truck?.refused !== undefined && r.truck.guard !== 'curves-too-small') otherGuard.add(r.id); if (r.outcome === 'SCRIPT-REFUSED') otherGuard.add(r.id); }
const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'solve-moves.json')) {
  for (const r of [JSON.parse(readFileSync(dir + f, 'utf8'))].filter(Array.isArray).flat()) {
    if (r.custom || r.truck?.volume === undefined || !r.doc || otherGuard.has(r.id)) continue;
    const feats = r.doc.features ?? r.doc; const ext = feats.find((x) => x.id === r.measureId && x.kind === 'extrude'); if (!ext) continue;
    const sk = feats.find((x) => x.id === (ext.target ?? ext.sketch)); if (!sk || sk.kind !== 'sketch') continue;
    if (feats.filter((x) => x.kind !== 'sketch').length !== 1) continue; // one extrude only
    let info; try { info = sketchInfo(sk, { arc, solvedGeoms: (s) => solvedGeoms({ geoms: s.geoms, rules: s.rules }) }); } catch { continue; }
    if (!info.curved) continue;
    const est = estimateCurveError(info, ext.height, ext.length2);
    const ref = r.exact?.volume ?? r.occt?.volume ?? r.brep?.volume; if (typeof ref !== 'number' || !(ref > 0)) continue;
    const meas = Math.abs(r.truck.volume - ref) / ref;
    if (meas > 1e-2) continue; // not tessellation: the unguarded profile picker took the wrong regions (ctl-noprofiles-*, thin rings), judged by the reconciliation check instead
    rows.push({ id: r.id, est: est.err, meas, ratio: est.err > 0 ? meas / est.err : Infinity, bad: meas > r.truck.tol });
  }
}
rows.sort((a, b) => b.ratio - a.ratio);
console.log('curved built cases with a reference:', rows.length);
console.log('max measured/estimated ratio (want < 1/safety = ' + (1 / LIMITS.safety).toFixed(2) + ' wherever the estimate is under the limit):');
for (const r of rows.slice(0, 25)) console.log(r.id.padEnd(40), 'est', r.est.toExponential(2), 'meas', r.meas.toExponential(2), 'ratio', r.ratio.toFixed(2), r.bad ? 'OVER-BAR' : '');
// decision table: accepted = est*safety <= bar
const acc = rows.filter((r) => r.est * LIMITS.safety <= LIMITS.curvedError);
console.log('accepted by the rule:', acc.length, 'of which over the bar:', acc.filter((r) => r.bad).map((r) => r.id).join(', ') || 'none', '| refused:', rows.length - acc.length, 'of which within the bar:', rows.filter((r) => r.est * LIMITS.safety > LIMITS.curvedError && !r.bad).length);
const ratios = acc.map((r) => r.ratio).filter(Number.isFinite);
console.log('among accepted: max ratio', Math.max(...ratios).toFixed(2));

console.log('REFUSED by the rule although within the bar (over-refusals):'); for (const r of rows.filter((r) => r.est * LIMITS.safety > LIMITS.curvedError && !r.bad)) console.log('  ', r.id.padEnd(36), 'est x1.5', (r.est * LIMITS.safety).toExponential(2), 'meas', r.meas.toExponential(2));
console.log('ACCEPTED and over the bar:', acc.filter((r) => r.bad).map((r) => r.id).join(', ') || 'none');
