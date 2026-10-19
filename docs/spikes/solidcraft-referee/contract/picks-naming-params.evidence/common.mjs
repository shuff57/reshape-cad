import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
export { L };
export const out = [];
export const tnText = (n) => L.tn.formatName(n);
export async function T(label, src, { values, consumer, control = true } = {}) {
  const r = L.fromScript(src, values);
  if (r.errors.length) { const o = { label, src, scriptError: r.errors[0].message, line: r.errors[0].line }; out.push(o); console.log(label.padEnd(44), 'SCRIPT ERROR:', r.errors[0].message); return o; }
  return D(label, r.doc, { consumer, control, src, r });
}
export async function D(label, doc0, { consumer, control = true, src, r } = {}) {
  const doc = L.cg.solveDoc(doc0);
  const ref = L.references(doc);
  const row = await L.scored(doc, { ref });
  let ctl;
  const cid = consumer ?? doc.features.filter(f=>['fillet','shell','draft'].includes(f.kind)).at(-1)?.id;
  if (control && cid && row.outcome !== 'REFUSED' && (ref.occt?.bbox || ref.brep?.bbox)) ctl = L.mirrorControl(row, cid, ref);
  const names = doc.features.filter(f=>f.edge||f.open||f.face).map(f=>tnText(f.edge??f.open??f.face));
  const o = { label, src, ...L.strip(row), control: ctl, names, params: r?.params, namedParams: r?.namedParams };
  out.push(o);
  const refNote = row.outcome === 'REFUSED' ? ` | OCCT:${ref.occt?.refused ?? (ref.occtRefusals && Object.keys(ref.occtRefusals).length ? 'refusals ' + JSON.stringify(ref.occtRefusals).slice(0,100) : 'builds V=' + ref.occt?.volume?.toFixed(4))} BREP:${ref.brep?.refused ?? (Object.keys(ref.brepRefusals ?? {}).length ? 'refusals ' + JSON.stringify(ref.brepRefusals).slice(0,100) : 'builds V=' + ref.brep?.volume?.toFixed(4))}` : '';
  console.log(label.padEnd(40), L.brief(row), ctl ? `| ctl ${JSON.stringify({rej:ctl.rejected, dCom: ctl.dCom?.toExponential?.(1), refused: ctl.refused?.slice(0,60), skipped: ctl.skipped})}` : '', refNote);
  if (names.length) console.log('    names:', names.join(' ; '));
  return o;
}
export const save = (f) => writeFileSync((process.env.R3_OUT ? process.env.R3_OUT + '/' : '') + f, JSON.stringify(out, null, 1));
