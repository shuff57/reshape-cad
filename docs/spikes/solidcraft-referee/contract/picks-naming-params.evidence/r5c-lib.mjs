// Round 5 (critic round 2). Library-level probes: checkModel greedy matching, generatedParams slot gaps, runScript({values}) sign handling.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> R3_OUT=<dir> bun r5c-lib.mjs
import { L, T, D, out, save } from './common.mjs';
const log = console.log;
const run = (src, values) => { const r = L.fromScript(src, values); if (r.errors.length) throw new Error(r.errors[0].message); return r; };
const J = (v) => JSON.stringify(v);
const res = {};
// ---------------------------------------------------------------- 1. checkModel greedy false negative
{
  const doc = run(`const a = box(40, 30, 20);\nconst b = box(10, 10, 10, { at: [60, 0, 0] });`).doc;
  const mc = L.mc;
  const A = mc.checkModel({ expect: [{ kind: 'box' }, { kind: 'box', width: 40 }] }, doc);
  const B = mc.checkModel({ expect: [{ kind: 'box', width: 40 }, { kind: 'box' }] }, doc);
  // independent bipartite (all permutations) matcher, same field semantics through checkModel on a one-entry probe
  const feats = doc.features.filter((f) => f.kind === 'box');
  const ok = (entry, f) => mc.checkModel({ expect: [entry] }, { ...doc, features: [f] }).passed;
  const exp = [{ kind: 'box' }, { kind: 'box', width: 40 }];
  const perm = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perm([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  const indep = perm(feats).some((p) => exp.every((e, i) => ok(e, p[i])));
  res.checkModel = { boxes: feats.map((f) => [f.id, f.size]), expectAnyThenWidth40: A, expectWidth40ThenAny: B, independentBipartiteMatch: indep };
  log('checkModel [{box},{box w40}] ->', J(A)); log('checkModel [{box w40},{box}] ->', J(B)); log('independent permutation matcher says satisfiable:', indep);
  // bigger: 3 expects order permutations
  const doc3 = run(`const a = box(40, 30, 20);\nconst b = box(10, 10, 10, { at: [60, 0, 0] });\nconst c = box(10, 20, 30, { at: [0, 60, 0] });`).doc;
  const E = [{ kind: 'box' }, { kind: 'box', width: 10 }, { kind: 'box', width: 10, depth: 20 }];
  const orders = perm(E); let fail = 0; for (const o of orders) if (!mc.checkModel({ expect: o }, doc3).passed) fail++;
  res.checkModel3 = { orders: orders.length, failingOrders: fail }; log('3 expects, 6 orders, failing orders (should be 0 for an order-insensitive matcher):', fail);
}
// ---------------------------------------------------------------- 2. generatedParams slot gaps
{
  const cases = {
    'pocket taper': `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]}); const p = extrude(sk1, 10);\nconst sk2 = sketch('top', 10); sk2.rect(10,10,{at:[20,15]}); pocket(sk2, p, 4, { taper: 5 });`,
    'pocket plain (control)': `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]}); const p = extrude(sk1, 10);\nconst sk2 = sketch('top', 10); sk2.rect(10,10,{at:[20,15]}); pocket(sk2, p, 4);`,
    'extrude taper': `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]}); extrude(sk1, 10, { taper: 5 });`,
    'extrude length2': `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]}); extrude(sk1, 10, { length2: 4 });`,
    'extrude direction': `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]}); extrude(sk1, 10, { direction: [0.2, 0, 1] });`,
    'extrude plain (control)': `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]}); extrude(sk1, 10);`,
  };
  res.slots = {};
  for (const [k, s] of Object.entries(cases)) {
    const r = L.rs.runScript(s, {});
    if (r.errors.length) { res.slots[k] = { error: r.errors[0].message }; log(k.padEnd(26), 'ERROR', r.errors[0].message); continue; }
    const doc = L.cg.solveDoc(r.doc);
    const f = doc.features.filter((x) => ['extrude', 'pocket'].includes(x.kind)).at(-1);
    const gp = r.params ?? [];
    const names = (L.cg.generatedParams ? L.cg.generatedParams(doc) : gp).map((p) => p.name ?? p.key ?? p);
    const stored = Object.fromEntries(Object.entries(f).filter(([a, v]) => ['taper', 'length2', 'direction', 'height', 'depth'].includes(a)));
    res.slots[k] = { stored, slotNames: names }; log(k.padEnd(26), 'stored', J(stored), '| slots', J(names));
  }
}
// ---------------------------------------------------------------- 3. runScript({values}) sign / zero
{
  const src = `const w = param('w', 40, { min: 20, max: 80, step: 5 });\nbox(w, 30, 20);`;
  res.values = [];
  for (const v of [40, 5, 0, -5, -40]) {
    const r = L.rs.runScript(src, { values: { box1_width: v } });
    if (r.errors.length) { log('values w=', v, 'ERROR', r.errors[0].message); res.values.push({ v, error: r.errors[0].message }); continue; }
    const doc = L.cg.solveDoc(r.doc);
    const bx = doc.features.find((f) => f.kind === 'box');
    const o = await D(`values w=${v}`, doc, { control: false });
    res.values.push({ v, valueKey: 'box1_width', size: bx.size, outcome: o.outcome, sc: o.truck?.volume, occt: o.ref?.occt?.volume, occtRefusals: o.ref?.occtRefusals, brep: o.ref?.brep?.volume, brepRefusals: o.ref?.brepRefusals, sentence: o.sentence });
  }
}
// ---------------------------------------------------------------- 4. extrude with negative height: cap names
{
  const base = (h) => `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]});\nconst e = extrude(sk1, ${h});\n`;
  await T('extrude -8 then hollow cap top?', base(-8) + `hollow(e, { wall: 1, open: 'top' });`, { control: false });
  await T('extrude -8 then hollow cap bottom?', base(-8) + `hollow(e, { wall: 1, open: 'bottom' });`, { control: false });
  await T('extrude +8 then hollow top (control)', base(8) + `hollow(e, { wall: 1, open: 'top' });`, { control: false });
  await T('extrude -8 then round top|front', base(-8) + `round(e.edge('top','front'), 1);`, { control: false });
  await T('extrude -8 then round bottom|front', base(-8) + `round(e.edge('bottom','front'), 1);`, { control: false });
  await T('extrude -8 then draft right 5', base(-8) + `draft(e.face('right'), 5);`, { control: false });
}
const cap = (e, end) => ({ cause: 'cap', feature: e, kind: 'face', end });
const swept = (e, s, k) => ({ cause: 'swept', feature: e, kind: 'face', from: s, edge: k });
const btw = (feature, a, b) => ({ cause: 'between', feature, kind: 'edge', of: [a, b] });
const skd = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] };
for (const H of [12, -12]) {
  for (const end of ['top', 'bottom']) await D(`ModelDoc extrude h=${H} cap ${end} as hollow open`, { version: 1, features: [skd, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }, { id: 'sh1', kind: 'shell', target: 'e1', thickness: 2, open: cap('e1', end) }] }, { control: false });
  for (const end of ['top', 'bottom']) await D(`ModelDoc extrude h=${H} round between(cap ${end}, swept1)`, { version: 1, features: [skd, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }, { id: 'r1', kind: 'fillet', target: 'e1', size: 2, style: 'fillet', edge: btw('e1', cap('e1', end), swept('e1', 'sk1', 1)) }] }, { control: false });
  await D(`ModelDoc extrude h=${H} draft swept1`, { version: 1, features: [skd, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }, { id: 'd1', kind: 'draft', target: 'e1', angle: 5, pull: 'z', neutral: 0, face: swept('e1', 'sk1', 1) }] }, { control: false });
}
save('r5c-lib.json');
import { writeFileSync } from 'node:fs';
writeFileSync((process.env.R3_OUT ? process.env.R3_OUT + '/' : '') + 'r5c-lib-summary.json', JSON.stringify(res, null, 1));
