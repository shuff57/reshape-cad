// Stored start of every r3 case: shipped (unguarded) SolidCraft route vs closed form, live brep-rs and live OCCT (OCCT builds the brep-rs-solved geometry).
import { writeFileSync } from 'node:fs';
const S = import.meta.dir;
const R3 = '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/sketch-constraints-r3';
process.env.SOLIDCRAFT_REFEREE_PKG2 = process.env.SOLIDCRAFT_REFEREE_PKG2 ?? S + '/pkg2shim';
const lib = await import(R3 + '/lib.mjs');
const refs = await import(R3 + '/refs.mjs');
const { CASES, plainRules, soupScript, H } = await import(R3 + '/cases.mjs');
const rel = lib.rel;
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const out = [];
for (const cs of CASES) {
  if (!cs.geoms || cs.legacy || cs.probe || cs.expect !== 'build') continue;
  if (only.length && !only.includes(cs.id)) continue;
  const rules = plainRules(cs.rules);
  const rec = { id: cs.id, feats: cs.feats, want: { volume: cs.area * H } };
  let r; try { r = lib.scSketch(cs.geoms, rules, { plane: 'xy', height: H }); } catch (e) { rec.sc = { thrown: String(e.message).slice(0, 120) }; out.push(rec); continue; }
  if (r.mapperRefused) rec.sc = { refused: 'mapper', sentence: r.mapperRefused[0] };
  else if (r.firstRefusal) rec.sc = { refused: 'solidcraft', sentence: r.firstRefusal.error };
  else if (!r.body) rec.sc = { refused: 'no-solid', sentence: r.extrudeError };
  else rec.sc = { volume: r.body.volume, faces: r.body.faces, bodies: r.body.bodies, bbox: r.body.bbox, dClosed: rel(r.body.volume, cs.area * H) };
  const x = refs.refsOfScript(soupScript(cs.geoms, rules));
  rec.brep = x.brep?.volume != null ? { volume: x.brep.volume, faces: x.brep.faces, dVsSc: rec.sc.volume != null ? rel(rec.sc.volume, x.brep.volume) : null, faceSame: x.brep.faces === rec.sc.faces } : (x.brep ?? x);
  rec.occt = x.occt?.volume != null ? { volume: x.occt.volume, dVsSc: rec.sc.volume != null ? rel(rec.sc.volume, x.occt.volume) : null } : (x.occt ?? null);
  out.push(rec);
  const f = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v).slice(0, 38));
  console.log(cs.id.padEnd(52), rec.sc.refused ? 'SC REFUSED ' + String(rec.sc.sentence).slice(0, 60) : `SC dClosed ${f(rec.sc.dClosed)} faces ${rec.sc.faces}`, '| brep', rec.brep.volume != null ? `d ${f(rec.brep.dVsSc)} faces ${rec.brep.faces}` : (rec.brep.refused ?? rec.brep.scriptError ?? rec.brep.error ?? '?').toString().slice(0, 50), '| occt', rec.occt?.volume != null ? `d ${f(rec.occt.dVsSc)}` : String(rec.occt?.refused ?? '-').slice(0, 50));
}
writeFileSync(S + '/out/stored-xcheck.json', JSON.stringify(out, null, 1));
