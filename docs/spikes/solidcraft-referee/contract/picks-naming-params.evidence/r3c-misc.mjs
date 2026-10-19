// Round 3 C. Misc re-measurements the critic asked for (params validation, slot-key mismatch, bow-tie corner slider, checkModel with
// several refusals, chamfer slot, handles after move). Page route for geometry = phase7 translator; everything else is the script layer.
//   bun r3c-misc.mjs [--out=file]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guardedTranslate, pageTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3c-misc.json';
const res = {}; const R = (k, v) => { res[k] = v; console.log(k.padEnd(34), JSON.stringify(v).slice(0, 700)); };
const run = (src, values) => L.rs.runScript(src, values ? { values } : {});
const errs = (r) => r.errors.map((e) => e.message);
const bigsize = (r) => r.doc?.features.find((f) => f.kind === 'box')?.size;

// 1. param() argument validation: what is accepted without a sentence
for (const [label, opt, val] of [['min>max', '{min:50,max:10}', 40], ['default above max', '{min:20,max:30}', 100], ['default below min', '{min:20,max:80}', 5], ['step 0', '{min:20,max:80,step:0}', 40], ['step negative', '{min:20,max:80,step:-5}', 40], ['step bigger than range', '{min:20,max:30,step:50}', 25], ['min=max', '{min:40,max:40}', 40], ['NaN min', '{min:NaN,max:80}', 40]]) {
  const r = run(`const w = param('w', ${val}, ${opt})\nbox(w, 30, 20)`);
  R('param ' + label, { errors: errs(r), namedParams: r.namedParams, size: bigsize(r) });
}
for (const [label, name] of [['name with a space', 'my width'], ['name starting with a digit', '2w'], ['empty name', ''], ['name with a dash', 'w-1'], ['reserved-looking name', 'box1_width']]) {
  const r = run(`const w = param(${JSON.stringify(name)}, 40, {min:20,max:80})\nbox(w, 30, 20)`);
  const r2 = r.errors.length ? null : run(`const w = param(${JSON.stringify(name)}, 40, {min:20,max:80})\nbox(w, 30, 20)`, { [name]: 60 });
  R('param ' + label, { errors: errs(r), named: r.namedParams?.map((p) => [p.name, p.slots]), valuesByThatName: r2 ? bigsize(r2) : null });
}
// 2. slot-key mismatch for a param bound to a sketch rect dimension
{
  const src = `const sk1=sketch('top');sk1.rect(40,30,{at:[20,15]});const p=extrude(sk1,10);const w=param('w',10,{min:4,max:30,step:1});const sk2=sketch('top',10);sk2.rect(w,8,{at:[18,14]});const q=pocket(sk2,p,4)`;
  const r = run(src);
  const gen = L.cg.generatedParams(r.doc).map((p) => p.name);
  R('rect param: namedParams', { errors: errs(r), named: r.namedParams, generatedKeys: gen.filter((n) => n.startsWith('sk2')) });
  const outline = (rr) => { const sk = rr.doc.features.find((f) => f.id === 'sk2'); const o = L.arc.outlineOf(L.cg.solveDoc(rr.doc).features.find((f) => f.id === 'sk2')); return o.ok ? o.points.map((p) => p.map((v) => +v.toFixed(3))) : 'no outline'; };
  const w0 = outline(r);
  const out = { default: w0 };
  for (const key of ['sk2_width', 'w', ...gen.filter((n) => n.startsWith('sk2'))]) { const rv = run(src, { [key]: 20 }); out[key] = { errors: errs(rv), changed: JSON.stringify(outline(rv)) !== JSON.stringify(w0), outline: outline(rv) }; }
  R('rect param: values by key', out);
}
// 3. bow-tie pocket sketch from a corner slider, page translator vs OCCT vs closed outline guard
{
  const src = `const sk1=sketch('top');sk1.rect(40,30,{at:[20,15]});const p=extrude(sk1,10);const sk2=sketch('top',10);sk2.rect(10,8,{at:[18,14]});const q=pocket(sk2,p,4)`;
  const base = run(src); const gen = L.cg.generatedParams(base.doc).filter((p) => p.name.startsWith('sk2_p'));
  R('pocket sketch slots', gen.map((p) => [p.name, p.value, p.min, p.max]));
  const OG = await import(pathToFileURL('/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/outline-guard.mjs').href);
  const cases = [];
  for (const p of gen) for (const lbl of ['min', 'max']) {
    const v = lbl === 'min' ? p.min : p.max; if (v === p.value) continue;
    const r = run(src, { [p.name]: v }); if (r.errors.length) { cases.push({ slot: p.name, lbl, v, scriptError: r.errors[0].message }); continue; }
    const doc = L.cg.solveDoc(r.doc); const ref = L.references(doc); const row = await L.scored(doc, { ref });
    const sk = doc.features.find((f) => f.id === 'sk2'); const o = L.arc.outlineOf(sk);
    const touch = o.ok ? OG.selfTouch(o, L.arc) : 'no-outline';
    const g = await guardedTranslate(doc); const gm = g.features.find((f) => f.id === row.id);
    cases.push({ slot: p.name, lbl, v, page: row.outcome, sentence: row.sentence?.slice(0, 120), scV: row.truck?.volume, occtV: ref.occt?.volume, occtFaces: ref.occt?.faces, scFaces: row.truck?.faces, dVol: row.score?.dVol, outlineGuard: touch, guardedStatus: gm.status, guardSentence: gm.status === 'refused' ? gm.refusal : null });
  }
  R('pocket corner sliders at min/max', cases);
  // the two named in the critique, plus a near-crossing sweep
  const sweep = [];
  for (const [slot, vals] of [['sk2_p0u', [10, 20, 30, 40, 50, 60]], ['sk2_p1u', [-20, -5, 0, 5, 10, 20]]]) for (const v of vals) {
    const r = run(src, { [slot]: v }); if (r.errors.length) { sweep.push({ slot, v, scriptError: r.errors[0].message }); continue; }
    const doc = L.cg.solveDoc(r.doc); const ref = L.references(doc); const row = await L.scored(doc, { ref });
    const o = L.arc.outlineOf(doc.features.find((f) => f.id === 'sk2'));
    const g2 = await guardedTranslate(doc); const gm2 = g2.features.find((f) => f.id === row.id);
    sweep.push({ slot, v, guardedStatus: gm2.status, guardSentence: gm2.status === 'refused' ? gm2.refusal : null, page: row.outcome, scV: row.truck?.volume, occtV: ref.occt?.volume, occtFaces: ref.occt?.faces, scFaces: row.truck?.faces, outlineGuard: o.ok ? OG.selfTouch(o, L.arc) : 'no-outline', occtRefusals: ref.occtRefusals });
  }
  R('pocket bow-tie sweep', sweep);
}
// 4. checkModel with four rim rounds, two refused (and the single-fillet probe)
{
  const { checkModel } = await import(pathToFileURL('/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/model-check.js').href);
  const src = `const sk1=sketch("top");sk1.rect(40,30,{at:[20,15]});const p=extrude(sk1,10);const sk2=sketch("top",10);sk2.rect(10,8,{at:[18,14]});const q=pocket(sk2,p,4);round(q.rim(sk2),1)`;
  const r = run(src); const doc = L.cg.solveDoc(r.doc);
  const g = await guardedTranslate(doc); const pg = await pageTranslate(doc);
  const refusalsPage = Object.fromEntries(pg.features.filter((f) => f.status === 'refused').map((f) => [f.id, f.refusal]));
  const refusalsPlain = Object.fromEntries(g.features.filter((f) => f.status === 'refused').map((f) => [f.id, f.refusal]));
  const exp = { expect: [1, 2, 3, 4].map(() => ({ kind: 'fillet', size: 1 })) };
  R('checkModel x4 rim rounds', { refusedIds: Object.keys(refusalsPage), noRefusals: checkModel(exp, r.doc), pageRefusals: checkModel(exp, r.doc, refusalsPage).failures ?? checkModel(exp, r.doc, refusalsPage), plainRefusals: checkModel(exp, r.doc, refusalsPlain), maps: refusalsPlain });
  const one = run(`const b=box(40,30,20)\nround(b.edge('top','front'),2)`); const g1 = await pageTranslate(L.cg.solveDoc(one.doc));
  R('checkModel single fillet built', checkModel({ expect: [{ kind: 'fillet', size: 2 }] }, one.doc, {}));
  const wd = run(`const w=wedge(30,20,10)\nround(w.edge('bottom','front'),2)`); const gw = await pageTranslate(L.cg.solveDoc(wd.doc));
  const rw = Object.fromEntries(gw.features.filter((f) => f.status === 'refused').map((f) => [f.id, f.refusal]));
  R('checkModel single refused fillet', { refusals: rw, result: checkModel({ expect: [{ kind: 'fillet', size: 2 }] }, wd.doc, rw) });
}
// 5. sketch chamfer slot vs sketch round slot
{
  for (const [label, call] of [['sk.round', 'sk.round(1, 3)'], ['sk.chamfer', 'sk.chamfer(1, 3)']]) {
    const src = `const sk=sketch('top');sk.rect(40,30,{at:[20,15]});${call};extrude(sk,10)`;
    const r = run(src); if (r.errors.length) { R('slot ' + label, { errors: errs(r) }); continue; }
    const gen = L.cg.generatedParams(r.doc).map((p) => p.name);
    const sk = r.doc.features.find((f) => f.id === 'sk1');
    R('slot ' + label, { generated: gen, sketchCorners: JSON.stringify(sk.corners ?? sk.rounds ?? Object.keys(sk)).slice(0, 200) });
  }
}
// 6. handles after move(): do the box handles sit on the moved solid?
{
  const { handlesFor } = await import(pathToFileURL('/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/model-handles.js').href);
  const rows = [];
  for (const [label, src] of [['unmoved', `const b=box(40,30,20)`], ['move x10', `const b=box(40,30,20)\nmove(b,[10,0,0])`], ['move z15', `const b=box(40,30,20)\nmove(b,[0,0,15])`], ['turn z30', `const b=box(40,30,20)\nturn(b,[0,0,30])`]]) {
    const r = run(src); const doc = L.cg.solveDoc(r.doc); const tr = await pageTranslate(doc);
    const last = [...tr.features].reverse().find((f) => f.status === 'built'); const bb = last.measure.bbox;
    const hs = r.doc.features.filter((f) => f.kind === 'box').flatMap((f) => handlesFor(f, r.doc));
    const off = hs.filter((h) => h.kind === 'size').map((h) => {
      const o = h.origin; const ax = h.axis ?? h.dir; // distance from the origin to the nearest point of the SC bbox
      const d = [0, 1, 2].map((i) => Math.max(bb[i] - o[i], 0, o[i] - bb[i + 3]));
      return { param: h.param, origin: o.map((v) => +v.toFixed(3)), gapToBbox: +Math.hypot(...d).toFixed(3), onExtreme: [0, 1, 2].some((i) => Math.abs(o[i] - bb[i]) < 1e-6 || Math.abs(o[i] - bb[i + 3]) < 1e-6) };
    });
    rows.push({ label, scBbox: bb.map((v) => +v.toFixed(3)), handles: off });
  }
  R('box handles vs solid', rows);
}
writeFileSync(OUT, JSON.stringify(res, null, 1));
