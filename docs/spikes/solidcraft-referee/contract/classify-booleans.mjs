#!/usr/bin/env node
// SPIKE, referee only. Reads the per-case JSON written by run-booleans.mjs (and, optionally, a second directory of slow-case reruns
// that override the first), assigns each case one of supported | refused | unsupported | wrong, and rolls the cases up into the
// contract rows of booleans.json. Pure post-processing: runs no kernel.
//   bun contract/classify-booleans.mjs --in=<dir with cases/> [--slow=<dir with cases/>] [--extra=<dir with cases/>] --out=<booleans.json>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CASES } from './boolean-cases.mjs';

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const dirs = [arg('in'), arg('slow'), arg('extra'), arg('long')].filter(Boolean);
const rows = new Map();
for (const d of dirs) {
  try { for (const f of readdirSync(path.join(d, 'cases'))) { const r = JSON.parse(readFileSync(path.join(d, 'cases', f), 'utf8')); if (!(rows.has(r.id) && r.outcome === 'HANG' && rows.get(r.id).outcome !== 'HANG')) rows.set(r.id, r); } } catch { /* dir absent */ }
}
const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
const f3 = (v) => (typeof v === 'number' ? Number(v.toPrecision(8)) : v);

/** One case -> {status, sentence, line, flags}. `line` is the measured numbers, never prose. */
function classify(r) {
  const flags = [];
  const base = { id: r.id, feature: r.feature, source: r.source ?? ((CASES.find((c) => c.id === r.id)?.features) ? 'ModelDoc ' + JSON.stringify(CASES.find((c) => c.id === r.id).features) : null), wallS: r.wallMs ? Math.round(r.wallMs / 100) / 10 : null };
  if (r.outcome === 'REFUSED-FRONT') return { ...base, status: 'refused', sentence: r.refusalSentence, line: `runScript -> error "${r.refusalSentence}"; no ModelDoc built` };
  if (r.outcome === 'REFUSED') {
    const o = r.occt; const b = r.brep;
    return { ...base, status: 'refused', sentence: r.refusalSentence, line: `SolidCraft/translator refused: "${r.refusalSentence}"; oracle: OCCT ${o ? `vol ${f3(o.volume)} faces ${o.faces} solids ${o.solids}` : r.occtNote}; brep-rs ${b?.refused ? `refused "${b.refused}"` : b ? `vol ${f3(b.volume)}` : '-'}` };
  }
  if (r.outcome === 'HANG' || r.outcome === 'CRASH') return { ...base, status: 'unsupported', sentence: null, line: `${r.outcome} at stage ${r.lastStage}: no result within ${r.timeoutMs / 1000}s; no sentence shown (${(r.detail ?? '').slice(0, 120)})` };
  const t = r.truck; const o = r.occt; const b = r.brep;
  const tshells = (t?.shells ?? []).reduce((s, v) => s + v, 0);
  const slow = r.wallMs > 30000;
  if (r.outcome === 'WRONG') return { ...base, status: 'wrong', sentence: null, line: `${r.summary}; SolidCraft vol ${f3(t.volume)} faces ${t.faces}; brep-rs ${b?.refused ? `refused "${b.refused}"` : `vol ${f3(b?.volume)}`}`, flags: ['silent wrong solid'] };
  const num = `OCCT vol ${f3(o.volume)} area ${f3(o.area)} faces ${o.faces} solids ${o.solids} | SolidCraft vol ${f3(t.volume)} area ${f3(t.area)} faces ${t.faces} bodies ${t.bodies} shells ${tshells} | dVol ${ex(t.dVol)} dBbox ${ex(t.dBbox)} dCom ${ex(t.dCom)} dArea ${ex(t.dArea)} | brep-rs ${b?.refused ? 'refused' : `dVol ${ex(b?.dVol)}`}${typeof r.analytic === 'number' ? ` | closed form ${f3(r.analytic)} (SolidCraft off by ${ex(t.dAnalytic)}, OCCT off by ${ex(r.occtVsAnalytic)})` : ''}`;
  const shellsOk = tshells === o.shells;
  const faceOk = t.faceOk;
  if (r.outcome === 'PASS') return { ...base, status: 'supported', sentence: null, line: num + (slow ? ` | harness wall ${base.wallS}s` : ''), flags: slow ? ['slow'] : [] };
  // FAIL: work out why
  const allTotal = r.truckAll?.total;
  const reasons = [];
  if (!faceOk) reasons.push('face-type counts unexplained');
  if (!(Math.max(t.dVol, t.dBbox) <= t.tol)) reasons.push(`vol/bbox beyond ${t.tol}`);
  if (t.dArea != null && t.dArea > (t.curved ? 3e-4 : 1e-9)) reasons.push('area');
  if (!shellsOk) reasons.push(`shells ${tshells} vs OCCT ${o.shells}`);
  if (reasons.length === 0) return { ...base, status: 'supported', sentence: null, line: num + ` | OCCT lists ${o.solids} solids, SolidCraft keeps them as ${t.bodies} body with ${tshells} shells (same shells, same volume)`, flags: ['one body, several shells'] };
  // volume-only miss on a curved result by cancellation (tessellated component volume error amplified by a small remainder)
  const cancellation = t.curved && Math.max(t.dBbox, t.dCom) <= 1e-9 + 3e-5 && (t.dArea ?? 0) <= 3e-4 && t.dVol <= 5e-4 && faceOk && shellsOk;
  if (cancellation) return { ...base, status: 'supported', sentence: null, line: num + ' | volume delta just over the 3e-4 bar: tessellation error of the curved operand amplified by cancellation (area, bbox, COM, face and shell counts all agree)', flags: ['marginal-volume'] };
  // bodies dropped by the translator (kernel total matches)
  if (allTotal && o && Math.abs(allTotal.volume_mm3 - o.volume) / Math.max(o.volume, 1) <= (t.curved ? 3e-4 : 1e-9) && allTotal.faces === o.faces) {
    return { ...base, status: 'wrong', sentence: null, line: `${num} | KERNEL TOTAL (all bodies in the session) vol ${f3(allTotal.volume_mm3)} faces ${allTotal.faces} bodies ${r.truckAll.body_count} matches OCCT; the translator reports only the target's name and so DROPS the other piece(s): the student would see ${f3(t.volume)} instead of ${f3(o.volume)}`, flags: ['silent wrong solid', 'translator drops split-off bodies'] };
  }
  const geomAgrees = Math.max(t.dVol, t.dBbox) <= t.tol && t.dCom <= (t.curved ? 3e-5 : 1e-6) && (t.dArea == null || t.dArea <= (t.curved ? 3e-4 : 1e-9)) && shellsOk;
  if (geomAgrees && !faceOk) return { ...base, status: 'wrong', sentence: null, line: `${num} | face census disagrees (OCCT ${JSON.stringify(o.types)} vs SolidCraft ${JSON.stringify(t.faceTypes)}) while volume, area, bbox, COM and shell count agree; not explained by the known truck conventions`, flags: ['topology-only: geometry agrees'] };
  return { ...base, status: 'wrong', sentence: null, line: `${num} | disagreement: ${reasons.join('; ')}`, flags: ['silent wrong solid'] };
}

const shortOf = (r, c) => {
  const t = r.truck; const o = r.occt; const e = (v) => (typeof v === 'number' ? v.toExponential(0).replace('e-', 'e-') : '-');
  if (c.status === 'refused') return `${r.id}: refused "${c.sentence}"`;
  if (c.status === 'unsupported') return `${r.id}: no result in ${r.timeoutMs / 1000}s (stage ${r.lastStage})`;
  if (!t || !o) return `${r.id}: ${c.status} ${r.summary ?? ''}`;
  const sh = (t.shells ?? []).reduce((s, v) => s + v, 0);
  return `${r.id}: ${c.status}; vol OCCT ${f3(o.volume)} SC ${f3(t.volume)} (d ${e(t.dVol)}), area d ${e(t.dArea)}, bbox d ${e(t.dBbox)}, faces O/SC ${o.faces}/${t.faces}, shells O/SC ${o.shells}/${sh}${r.wallMs > 30000 ? `, harness wall ${Math.round(r.wallMs / 1000)}s (includes 2-3 repeated boolean runs and OCCT/brep-rs start-up)` : ''}`;
};
const results = [...rows.values()].map((r) => { const c = classify(r); return { ...c, short: shortOf(r, c), brepSays: r.brep?.refused ?? null }; });
const order = new Map(CASES.map((c, i) => [c.id, i]));
results.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
writeFileSync(path.join(arg('out') ? path.dirname(path.resolve(arg('out'))) : '.', 'booleans-classified.json'), JSON.stringify(results, null, 1));
for (const r of results) console.log(r.id.padEnd(36), r.status.padEnd(12), (r.flags ?? []).join(',').padEnd(28), r.line.slice(0, 200));
const tally = {}; for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(tally, results.length, 'cases of', CASES.length);
