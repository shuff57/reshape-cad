import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2]));
const pre = process.argv[3] ?? '';
const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
for (const r of rows) {
  if (!r.id.startsWith(pre)) continue;
  if (r.interp) { console.log(r.id.padEnd(40), 'SCRIPT-REFUSED', (r.interp.errors?.[0] ?? r.interp.threw ?? '').slice(0, 160)); continue; }
  const fx = r.fx; if (!fx) { console.log(r.id, 'NOFX', JSON.stringify(r).slice(0, 200)); continue; }
  const t = fx.truck;
  const occRef = Object.keys(fx.occtRefusals ?? {}).length ? 'OCCT-REFUSED' : '';
  const brRef = (fx.brep?.refused || Object.keys(fx.brepRefusals ?? {}).length) ? 'BREP-REFUSED' : '';
  console.log(r.id.padEnd(40), String(fx.outcome ?? 'OCCT-INVALID').padEnd(8), `O=${fx.occt?.volume?.toFixed(4)} ${occRef} B=${fx.brep?.volume?.toFixed(4) ?? '-'} ${brRef} T=${t?.volume?.toFixed(4) ?? 'REF'}`,
    r.closed !== undefined ? `CF=${r.closed.toFixed(4)} dT/CF=${ex(r.truckVsClosed)} dO/CF=${ex(r.occtVsClosed)}` : '', `f O/B/T ${fx.occt?.faces}/${fx.brep?.faces ?? '-'}/${t?.faces ?? '-'}`,
    t?.refused ? 'TRUCK-REFUSED: ' + t.refused.slice(0, 170) : '', fx.truckFeatures?.some((f) => f.variantsTried > 1) ? 'VARIANT>1:' + JSON.stringify(fx.truckFeatures.filter(f=>f.variantsTried>1).map(f=>[f.id,f.variantsTried,f.pick?.edges])) : '', `ms=${fx.ms}`);
}
