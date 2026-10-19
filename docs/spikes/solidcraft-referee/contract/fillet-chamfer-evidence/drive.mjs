// driver: script text -> ModelDoc -> OCCT / brep-rs / solidcraft, via the phase 0 harness copy (base.mjs)
import { runScript } from '/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/reshape-script.js';
import { toScript } from '/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/reshape-script-gen.js';
import { writeFileSync, readFileSync } from 'node:fs';
import { runFixture, rel, translateDoc, brep, arc, mt, solveDoc, runSC } from './base.mjs';
import { CASES } from './cases.mjs';

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const exact = process.argv.includes('--exact');
if (process.argv.includes('--list')) { for (const c of CASES) if (!only.length || only.some((o) => c.id.startsWith(o))) console.log(c.id); process.exit(0); }
const outFile = (process.argv.find((a) => a.startsWith('--res=')) ?? '--res=res.json').slice(6);
const from = (process.argv.find((a) => a.startsWith('--from=')) ?? '').slice(7);
const res = [];
let started = !from;
for (const c of CASES) {
  if (c.id === from) started = true;
  if (!started) continue;
  process.env.STAGEFILE && writeFileSync(process.env.STAGEFILE, 'case ' + c.id);
  if (only.length && !only.some((o) => (exact ? c.id === o : c.id.startsWith(o)))) continue;
  const row = { id: c.id, row: c.row, script: c.script, expect: c.expect ?? null };
  let r;
  try { r = c.doc ? { errors: [], doc: { version: 1, features: c.doc } } : runScript(c.script); } catch (e) { row.interp = { threw: e.message }; res.push(row); console.log(c.id, 'INTERP THREW', e.message); continue; }
  if (r.errors.length) { row.interp = { errors: r.errors.map((e) => e.message) }; res.push(row); console.log(c.id.padEnd(34), 'SCRIPT-REFUSED:', r.errors[0].message); continue; }
  const feats = r.doc.features;
  row.doc = feats.map((f) => f.kind + ':' + f.id).join(' ');
  row.docJson = feats;
  const measure = c.measure ?? feats[feats.length - 1].id;
  let fx;
  try { fx = runFixture({ id: c.id, kind: 'fillet-case', tol: 'approx', features: feats, measure, pickOf: undefined }); } catch (e) { row.harnessError = e.stack.slice(0, 600); res.push(row); console.log(c.id, 'HARNESS ERROR', e.message); continue; }
  row.fx = fx;
  if (fx.invalid) {
    // OCCT could not build it: still ask brep-rs and solidcraft, report them with no OCCT comparison
    try { const got = JSON.parse(brep.measure_doc(JSON.stringify({ version: 1, features: feats }))); const s = got.shapes?.[measure]; row.brepOnly = s ? { volume: s.volume, faces: s.faces } : { refused: got.refusals?.[measure] ?? 'no shape' }; } catch (e) { row.brepOnly = { refused: 'threw ' + e.message }; }
    try {
      const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
      const tr = translateDoc(solveDoc({ version: 1, features: feats }), { arc, mt, runSC, resolveAt });
      const mf = tr.features.find((f) => f.id === measure);
      row.scOnly = mf?.status === 'built' ? { volume: mf.measure.volume, faces: mf.measure.faces, faceTypes: mf.measure.faceTypes, bbox: mf.measure.bbox } : { refused: mf?.refusal ?? 'not built', first: tr.features.find((f) => f.status === 'refused')?.refusal };
      if (c.closed) row.scOnly.vsClosed = rel(row.scOnly.volume, c.closed());
    } catch (e) { row.scOnly = { error: e.message }; }
    console.log(c.id.padEnd(34), 'OCCT-INVALID', fx.invalid, '| brep', JSON.stringify(row.brepOnly), '| solidcraft', JSON.stringify(row.scOnly).slice(0, 400));
  }
  if (c.closed) { const v = c.closed(); row.closed = v; if (fx.truck?.volume !== undefined) row.truckVsClosed = rel(fx.truck.volume, v); row.occtVsClosed = rel(fx.occt?.volume, v); row.brepVsClosed = fx.brep?.volume !== undefined ? rel(fx.brep.volume, v) : null; }
  if (c.control) { try { const ctl = runFixture({ id: c.id, kind: 'fillet-case', tol: 'approx', features: feats, measure, pickOf: undefined }, { control: true }); row.control = { outcome: ctl.outcome, dVol: ctl.truck?.dVol, dCom: ctl.truck?.dCom, refused: ctl.truck?.refused }; } catch (e) { row.control = { error: e.message }; } }
  res.push(row); writeFileSync(outFile, JSON.stringify(res, null, 1));
  const t = fx.truck;
  const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  console.log(c.id.padEnd(34), String(fx.outcome ?? fx.invalid).padEnd(8), 'OCCTvol', fx.occt?.volume?.toFixed(4), 'brep', fx.brep?.refused ? 'REFUSED' : ex(fx.brep?.dVol), 'truck dV', ex(t?.dVol), 'dCom', ex(t?.dCom), 'faces O/B/T', `${fx.occt?.faces}/${fx.brep?.faces ?? '-'}/${t?.faces ?? '-'}`, t?.faceKey ? '' : (t?.refused ? '' : 'FACE?'), row.closed !== undefined ? `closed dT ${ex(row.truckVsClosed)} dO ${ex(row.occtVsClosed)}` : '', t?.refused ? 'REFUSED: ' + t.refused : '', fx.invalid ?? '');
}
writeFileSync(outFile, JSON.stringify(res, null, 1));
