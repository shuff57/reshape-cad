// round 4: the critic's silent wrong solid. A cone (a revolve-built apex solid) in a chain of moves and turns. Seeded fuzz, shipped phase0 translator
// vs the guard translator (rigid-motion invariant + chain repair) vs live OCCT and brep-rs. Usage:
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r4-conechain.mjs [--n=100] [--seed=1] [--only=cone,copies,join,control] [--out=r4-conechain-results.json]
// Env MT_NOINVARIANT=1 (guard without the invariant = round-3 behaviour) and MT_NOREPAIR=1 (invariant only, no repair) are the negative controls.
import { writeFileSync } from 'node:fs';
import { runCase, runScript, mt, f } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guardRaw } from './translate-guard.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) ?? '').split('=')[1] ?? d;
const N = Number(arg('n', 100)); let seed = Number(arg('seed', 1)); const only = arg('only', 'cone,copies,join,control').split(',');
const OUT = arg('out', 'r4-conechain-results.json');
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const ri = (a, b) => Math.round(a + rnd() * (b - a));
const pick = (a) => a[ri(0, a.length - 1)];
let repairs = 0; let repairNotes = []; let tessBbox = 0;
let repairKinds = {};
const guard = (doc, ctx) => { const t = guardRaw(doc, ctx); for (const x of t.features) if (x.repaired) { repairs++; repairKinds[x.repaired.kind] = (repairKinds[x.repaired.kind] ?? 0) + 1; } return t; };
const ANG = [0, 0, 15, 30, 45, 60, 90, 135, 180, -30];
const vec = (r) => [ri(-r, r), ri(-r, r), ri(-r * 0.75, r * 0.75)];
const op = (v) => (rnd() < 0.5 ? `move(${v}, [${vec(40)}])` : `turn(${v}, [${[pick(ANG), pick(ANG), pick(ANG)]}])`);
const SC = {
  cone: () => { const n = ri(1, 10); const at = rnd() < 0.7 ? `, { at: [${vec(20)}] }` : ''; return [`let a = cone(${ri(4, 14)}, ${ri(8, 24)}${at})`, ...Array.from({ length: n }, () => op('a'))].join('\n'); },
  copies: () => { const n = ri(2, 9); const L = ['let a = cone(8, 15)']; let cur = 'a'; for (let i = 0; i < n; i++) { if (rnd() < 0.7) { L.push(`let c${i} = move(${cur}, [${vec(30)}], { copy: true })`); cur = `c${i}`; } else L.push(op(cur)); } return L.join('\n'); },
  join: () => { const n = ri(1, 8); return [`let b = box(30, 30, 6)`, `let k = cone(10, 16, { at: [0, 0, 3] })`, `let j = join(b, k)`, ...Array.from({ length: n }, () => op('j'))].join('\n'); },
  moves: () => { const n = ri(3, 8); const rot = rnd() < 0.6 ? [`turn(a, [${[pick(ANG), pick(ANG), pick(ANG)]}])`] : []; const at = rnd() < 0.6 ? `, { at: [${vec(20)}] }` : ''; return [`let a = cone(${ri(4, 14)}, ${ri(8, 24)}${at})`, ...rot, ...Array.from({ length: n }, () => `move(a, [${vec(40)}])`)].join(String.fromCharCode(10)); }, // round 5: the critic's scan: 3-8 translations after an optional rotation
  control: () => { const n = ri(1, 10); const mk = pick(['cylinder(8, 15)', 'box(10, 8, 6)', 'prism(6, 8, 15)', 'wedge(12, 8, 6)', 'sphere(9)']); return [`let a = ${mk}`, ...Array.from({ length: n }, () => op('a'))].join('\n'); },
};
const all = [];
for (const sc of only) {
  const tally = { shipped: {}, guard: {}, repaired: 0, wrongGuard: [], refusals: {} };
  repairs = 0; tessBbox = 0; repairKinds = {};
  for (let i = 0; i < N; i++) {
    const script = SC[sc]();
    const r0 = runScript(script); if (r0.errors.length) { tally.scriptErrors = (tally.scriptErrors ?? 0) + 1; continue; }
    const ids = mt.topLevel(r0.doc).map((x) => x.id).filter((id) => { const ft = r0.doc.features.find((x) => x.id === id); return ft.kind !== 'sketch' && ft.kind !== 'datum'; });
    const s = runCase({ script, ids });
    const g = runCase({ script, ids, translateFn: guard });
    // worst verdict over the shown shapes
    const rank = { PASS: 0, REFUSED: 1, FAIL: 2, NOTRUN: 3 };
    // verdict() flags a curved part whose RELATIVE bounding-box error tops 3e-4. When volume, centre of mass and face counts are inside the bar and the bounding box is inside
    // 1e-3 mm ABSOLUTE (a tessellation chord error, see s1-cone-bbox.mjs), it is the known metric artefact, not a wrong solid: counted as PASS and listed in tessBbox.
    const v2 = (rr, id) => { const v = verdict(rr, id); if (v !== 'FAIL') return v; const t = rr.truck[id]; const abs = Math.max(...t.bbox.map((x, i) => Math.abs(x - t.occtBbox[i]))); if (t.curved && t.dVol <= 3e-4 && t.dCom <= 3e-5 && t.faceOk && abs <= 1e-3) { tessBbox++; return 'PASS'; } return 'FAIL'; };
    const worst = (rr) => ids.map((id) => v2(rr, id)).reduce((a, b) => (rank[b] > rank[a] ? b : a), 'PASS');
    const vs = worst(s); const vg = worst(g);
    tally.shipped[vs] = (tally.shipped[vs] ?? 0) + 1; tally.guard[vg] = (tally.guard[vg] ?? 0) + 1;
    const gRef = ids.map((id) => g.truck[id]?.refused).filter(Boolean);
    for (const x of g.truckFeatures.filter((x) => x.status === 'refused')) tally.refusals[x.refusal.replace(/\d+(\.\d+)?/g, '#')] = (tally.refusals[x.refusal.replace(/\d+(\.\d+)?/g, '#')] ?? 0) + 1;
    const rec = { script, shipped: vs, guard: vg, shippedWorst: ids.map((id) => ({ id, v: verdict(s, id), dVol: s.truck[id]?.dVol, dCom: s.truck[id]?.dCom })).filter((x) => x.v === 'FAIL'), guardRefusal: gRef[0] };
    if (vg === 'FAIL') tally.wrongGuard.push(rec);
    if (vs === 'FAIL' && tally.shipped.examples === undefined) tally.shipped.examples = rec;
    all.push({ scenario: sc, ...rec });
  }
  tally.repaired = repairs; tally.repairKinds = repairKinds; tally.tessBbox = tessBbox;
  console.log(sc.padEnd(8), 'n', N, 'SHIPPED', JSON.stringify({ ...tally.shipped, examples: undefined }), 'GUARD', JSON.stringify(tally.guard), 'repaired steps', tally.repaired, JSON.stringify(tally.repairKinds), 'bbox-only artefact (counted PASS, both translators)', tally.tessBbox, 'guard WRONG', tally.wrongGuard.length);
  for (const [k, v] of Object.entries(tally.refusals)) console.log('   refusal x' + v + ': ' + k);
  for (const w of tally.wrongGuard.slice(0, 3)) console.log('   GUARD WRONG:', JSON.stringify(w).slice(0, 400));
  if (tally.shipped.examples) console.log('   shipped example:', JSON.stringify(tally.shipped.examples.script), JSON.stringify(tally.shipped.examples.shippedWorst));
  all.push({ scenario: sc, summary: { n: N, shipped: { ...tally.shipped, examples: undefined }, guard: tally.guard, repairedSteps: tally.repaired, repairKinds: tally.repairKinds, tessBboxArtefacts: tally.tessBbox, guardWrong: tally.wrongGuard.length, refusals: tally.refusals } });
  writeFileSync(OUT, JSON.stringify(all, null, 1)); // round 6: partial results after every scenario
}
