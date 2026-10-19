// SPIKE, referee only (booleans group, round 2). The per-case classifier of classify-booleans.mjs (round 1), as an importable module, unchanged except for `export`.
// One case result row (from run-booleans.mjs) -> {status: supported|refused|unsupported|wrong, sentence, line, flags}.
import { CASES } from './boolean-cases.mjs';
await import('./boolean-cases-r2.mjs');
export const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
export const f3 = (v) => (typeof v === 'number' ? Number(v.toPrecision(8)) : v);

/** One case -> {status, sentence, line, flags}. `line` is the measured numbers, never prose. */
export function classify(r) {
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
  if (!((t.dVol <= t.tol && t.dBbox <= (t.tolBbox ?? t.tol)))) reasons.push(`vol beyond ${t.tol} or bbox beyond ${t.tolBbox ?? t.tol}`);
  if (t.dArea != null && t.dArea > (t.curved ? 3e-4 : 1e-9)) reasons.push('area');
  if (!shellsOk) reasons.push(`shells ${tshells} vs OCCT ${o.shells}`);
  if (reasons.length === 0) return { ...base, status: 'supported', sentence: null, line: num + ` | OCCT lists ${o.solids} solids, SolidCraft keeps them as ${t.bodies} body with ${tshells} shells (same shells, same volume)`, flags: ['one body, several shells'] };
  // round 2: no 'marginal volume' exception any more. One bar for curved results (3e-4 volume), applied the same way to every case.
  // bodies dropped by the translator (kernel total matches)
  if (allTotal && o && r.truckAll.body_count > 1 && Math.abs(allTotal.volume_mm3 - o.volume) / Math.max(o.volume, 1) <= (t.curved ? 3e-4 : 1e-9) && allTotal.faces === o.faces) {
    return { ...base, status: 'wrong', sentence: null, line: `${num} | KERNEL TOTAL (all bodies in the session) vol ${f3(allTotal.volume_mm3)} faces ${allTotal.faces} bodies ${r.truckAll.body_count} matches OCCT; the translator reports only the target's name and so DROPS the other piece(s): the student would see ${f3(t.volume)} instead of ${f3(o.volume)}`, flags: ['silent wrong solid', 'translator drops split-off bodies'] };
  }
  const geomAgrees = (t.dVol <= t.tol && t.dBbox <= (t.tolBbox ?? t.tol)) && t.dCom <= (t.curved ? 3e-5 : 1e-6) && (t.dArea == null || t.dArea <= (t.curved ? 3e-4 : 1e-9)) && shellsOk;
  if (geomAgrees && !faceOk) return { ...base, status: 'wrong', sentence: null, line: `${num} | face census disagrees (OCCT ${JSON.stringify(o.types)} vs SolidCraft ${JSON.stringify(t.faceTypes)}) while volume, area, bbox, COM and shell count agree; not explained by the known truck conventions`, flags: ['topology-only: geometry agrees'] };
  return { ...base, status: 'wrong', sentence: null, line: `${num} | disagreement: ${reasons.join('; ')}`, flags: ['silent wrong solid'] };
}

export const shortOf = (r, c) => {
  const t = r.truck; const o = r.occt; const e = (v) => (typeof v === 'number' ? v.toExponential(0).replace('e-', 'e-') : '-');
  if (c.status === 'refused') return `${r.id}: refused "${c.sentence}"`;
  if (c.status === 'unsupported') return `${r.id}: no result in ${r.timeoutMs / 1000}s (stage ${r.lastStage})`;
  if (!t || !o) return `${r.id}: ${c.status} ${r.summary ?? ''}`;
  const sh = (t.shells ?? []).reduce((s, v) => s + v, 0);
  return `${r.id}: ${c.status}; vol OCCT ${f3(o.volume)} SC ${f3(t.volume)} (d ${e(t.dVol)}), area d ${e(t.dArea)}, bbox d ${e(t.dBbox)}, faces O/SC ${o.faces}/${t.faces}, shells O/SC ${o.shells}/${sh}${r.wallMs > 30000 ? `, harness wall ${Math.round(r.wallMs / 1000)}s (includes 2-3 repeated boolean runs and OCCT/brep-rs start-up)` : ''}`;
};
