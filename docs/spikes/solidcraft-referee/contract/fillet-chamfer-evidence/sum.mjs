import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2] ?? 'res-run2.json'));
const only = process.argv[3];
const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
for (const r of rows) {
  if (only && !r.id.startsWith(only)) continue;
  if (r.interp) { console.log(r.id.padEnd(36), 'SCRIPT-REFUSED', (r.interp.errors?.[0] ?? r.interp.threw).slice(0, 150)); continue; }
  if (r.harnessError) { console.log(r.id, 'HARNESS ERROR', r.harnessError.slice(0, 200)); continue; }
  const fx = r.fx; const t = fx.truck; const m = r.doc?.split(' ').pop().split(':')[1];
  const occRef = fx.occtRefusals ? Object.entries(fx.occtRefusals).map(([k, v]) => k + '=' + v).join('; ') : '';
  const brRef = fx.brepRefusals ? Object.entries(fx.brepRefusals).map(([k, v]) => k + '=' + v).join('; ') : '';
  const occV = fx.occt?.volume;
  const truckV = t?.volume ?? r.scOnly?.volume;
  const cf = r.closed;
  console.log(r.id.padEnd(36), (fx.outcome ?? 'OCCT-INVALID').padEnd(8),
    `O=${occV?.toFixed(4)}${occRef ? ' [OCCT REFUSED: ' + occRef.slice(0, 110) + ']' : ''}`,
    `B=${fx.brep?.volume?.toFixed(4) ?? (fx.brep?.refused ? 'REF' : '-')}${brRef ? ' [BREP REFUSED: ' + brRef.slice(0, 90) + ']' : ''}`,
    `T=${truckV?.toFixed(4) ?? 'REF'}`, cf !== undefined ? `CF=${cf.toFixed(4)} dT/CF=${ex(r.truckVsClosed ?? r.scOnly?.vsClosed)} dO/CF=${ex(r.occtVsClosed)} dB/CF=${ex(r.brepVsClosed)}` : '',
    `faces O/B/T ${fx.occt?.faces}/${fx.brep?.faces ?? '-'}/${t?.faces ?? r.scOnly?.faces ?? '-'}`,
    t?.refused ? `TRUCK-REFUSED: ${t.refused.slice(0, 200)}` : '', r.scErrors?.length ? `scErr[${r.scErrors.length}]: ${r.scErrors.map((e) => e.slice(0, 90)).join(' || ').slice(0, 330)}` : '',
    (r.fx.truckFeatures ?? []).some((f) => f.variantsTried > 1) ? 'VARIANT>1' : '');
}
