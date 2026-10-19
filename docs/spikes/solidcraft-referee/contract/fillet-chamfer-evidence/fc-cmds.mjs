// Turns reSHape Script texts into the SolidCraft command lists the rig sends (phase 0 translator, brep-rs picks), WITHOUT running OCCT comparisons,
// so fc-eval.mjs can ask the real truck topology (pane bridge) what the target body looked like just before each blend.
//   bun fc-cmds.mjs --from=fuzz-single.json,fuzz-pair.json --res=fc-cmds-fuzz.json      (rows with a .script)
//   bun fc-cmds.mjs --cases=./cases-r3.mjs --res=fc-cmds-r3.json
import { readFileSync, writeFileSync } from 'node:fs';
import { runScript } from '/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/reshape-script.js';
import { translateDoc, brep, arc, mt, solveDoc, runSC } from './base.mjs';
const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const out = arg('res', 'fc-cmds.json');
const items = [];
for (const f of arg('from').split(',').filter(Boolean)) {
  const d = JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
  for (const r of Array.isArray(d) ? d : d.rows) items.push({ id: `${f.replace('.json', '')}#${r.i}`, script: r.script });
}
if (arg('cases')) { const m = await import(new URL(arg('cases'), import.meta.url).href); for (const c of m.CASES) items.push({ id: c.id, script: c.script, doc: c.doc }); }
const res = [];
for (const it of items) {
  const row = { id: it.id, script: it.script };
  try {
    const r = it.doc ? { errors: [], doc: { version: 1, features: it.doc } } : runScript(it.script);
    if (r.errors.length) { row.interp = r.errors[0].message; res.push(row); continue; }
    const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
    const tr = translateDoc(solveDoc({ version: 1, features: r.doc.features }), { arc, mt, runSC, resolveAt });
    row.commands = tr.commands;
    row.features = tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal }));
  } catch (e) { row.error = e.message; }
  res.push(row);
  writeFileSync(out, JSON.stringify(res));
}
console.log('wrote', out, res.length, 'with commands', res.filter((r) => r.commands).length);
