// Round 3 H. The same scripts through BOTH translators, to reconcile statuses between contract files that used different ones:
//   page   = phase7/pane/lib/translate-p4.mjs (the product)         phase0 = phase0/translate.mjs (fillet-chamfer.json, patterns-mirror.json ...)
// phase0 picks by brep-rs resolve (archive/brep-rs/pkg) in the primitive's own frame; the page picks by solidcraft topology.
//   bun r3h-reconcile.mjs [--out=file]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3h-reconcile.json';
const P0 = await import(pathToFileURL(`${L.SPIKE}/phase0/translate.mjs`).href);
const resolveAt = (prefix, name) => { try { return JSON.parse(L.brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
const cases = {
  'round top|front then round top|right (adjacent, r2)': `const b=box(40,30,20,{at:[5,-3,2]})\nround(b.edge('top','front'),2)\nround(b.edge('top','right'),2)`,
  'bevel top|front then bevel top|right (adjacent, d2)': `const b=box(40,30,20,{at:[5,-3,2]})\nbevel(b.edge('top','front'),2)\nbevel(b.edge('top','right'),2)`,
  'triangular pocket rim round 1': `const sk1=sketch('top');sk1.rect(40,30,{at:[20,15]});const p=extrude(sk1,10);const sk2=sketch('top',10);sk2.polygon([[10,10],[22,10],[16,20]]);const q=pocket(sk2,p,4)\nround(q.rim(sk2),1)`,
  'move box(40,30,4) up 2 then round top|front 1.5': `const b=box(40,30,4)\nmove(b,[0,0,2])\nround(b.edge('top','front'),1.5)`,
  'hollow open bottom of a cone (shell-draft row 5)': `const c=cone(30,20)\nhollow(c,{wall:2,open:'bottom'})`,
  'draft 80 deg on the 40x30x20 box': `const b=box(40,30,20)\ndraft(b.face('right'),80)`,
  'bevel 2 on the 1 mm thin edge (40x30x1)': `const b=box(40,30,1)\nbevel(b.edge('top','front'),2)`,
};
const out = [];
for (const [label, src] of Object.entries(cases)) {
  const r = L.fromScript(src); if (r.errors.length) { out.push({ label, scriptError: r.errors[0].message }); console.log(label, 'SCRIPT ERROR', r.errors[0].message); continue; }
  const doc = r.doc; const ref = L.references(doc); const id = ref.id;
  const page = await L.scored(doc, { ref });
  let p0; try { const tr = P0.translateDoc(doc, { arc: L.arc, mt: L.mt, runSC: L.runSC, resolveAt }); const mf = tr.features.find((f) => f.id === id); p0 = mf?.status === 'built' ? { built: true, V: mf.measure.volume, faces: mf.measure.faces, com: mf.measure.com, bbox: mf.measure.bbox } : { built: false, sentence: (mf?.refusal ?? tr.features.find((f) => f.status === 'refused')?.refusal ?? 'not built').slice(0, 200), statuses: tr.features.map((f) => `${f.id}:${f.status}`) }; } catch (e) { p0 = { error: String(e.message).slice(0, 200) }; }
  const row = { label, src, page: page.outcome === 'REFUSED' ? { built: false, sentence: page.sentence?.slice(0, 200) } : { built: true, V: page.truck?.volume, faces: page.truck?.faces, com: page.truck?.com, outcome: page.outcome }, phase0: p0, occt: ref.occt?.volume !== undefined ? { V: ref.occt.volume, faces: ref.occt.faces, com: ref.occt.com, refusals: ref.occtRefusals } : { refused: ref.occt?.refused }, brep: ref.brep?.volume !== undefined ? { V: ref.brep.volume, faces: ref.brep.faces, refusals: ref.brepRefusals } : { refused: ref.brep?.refused } };
  out.push(row); console.log(label.padEnd(56), 'PAGE', JSON.stringify(row.page).slice(0, 150), '\n   PHASE0', JSON.stringify(row.phase0).slice(0, 180), '\n   OCCT', JSON.stringify(row.occt).slice(0, 140), 'BREP', JSON.stringify(row.brep).slice(0, 100));
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
