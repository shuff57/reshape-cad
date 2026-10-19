#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group). Curved-solid accuracy of the pinned truck: its volume_mm3 comes from a tessellation whose
// chord error grows with (size of the part) / (radius of the round shape). Pulls round bars of growing slenderness and drills a bore in growing
// plates, through BOTH routes: the shipped one (raw truck, what the numbers really are) and the contract one (translate-ep.mjs, which refuses when
// the bound table-error x curved-volume / part-volume exceeds the curved bar 3e-4).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-slender.mjs   -> extrude-pocket-slender-results.json
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const contract = await load('docs/spikes/solidcraft-referee/contract/translate-ep.mjs');
const shipped = await load('docs/spikes/solidcraft-referee/phase7/pane/lib/translate-p4.mjs');
const runSC = async (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { error: `TRAP ${e.message}` } }; } };
async function go(script, route) {
  const doc = solveDoc(runScript(script).doc);
  const tr = await route.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status !== 'built') return { refused: last?.refusal };
  const all = await runSC(tr.commands);
  return { volume: all.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) };
}
const rows = [];
const BAR = 3e-4;
const ratios = [5, 20, 35, 40, 45, 50, 75, 100, 150, 200, 500, 1000, 3000, 10000];
const d = 10;
for (const ratio of ratios) {
  const h = d * ratio;
  const script = `const sk = sketch('top'); sk.circle(${d}); const part = pull(sk, ${h});`;
  const exact = Math.PI * d * d / 4 * h;
  const raw = await go(script, shipped); const con = await go(script, contract);
  rows.push({ kind: 'bar', ratio: +(Math.hypot(d, d, h) / d).toFixed(1), d, h, rawErr: (raw.volume - exact) / exact, contract: con.refused ? 'REFUSED' : 'built', contractErr: con.refused ? null : (con.volume - exact) / exact, sentence: con.refused });
}
for (const L of [100, 300, 500, 1000, 2000, 5000]) {
  const PL = `const s1 = sketch('top'); s1.polygon([[0,0],[${L},0],[${L},${L}],[0,${L}]]); const plate = pull(s1, 10);`;
  const script = `${PL} const sk = sketch('top', 10); sk.circle(10, { at: [${L / 2}, ${L / 2}] }); const cut = pocket(sk, plate, 10);`;
  const exact = L * L * 10 - Math.PI * 25 * 10;
  const raw = await go(script, shipped); const con = await go(script, contract);
  rows.push({ kind: 'bore', ratio: +(Math.hypot(L, L, 10) / 10).toFixed(0), L, rawErr: (raw.volume - exact) / exact, rawErrOnHole: (raw.volume - exact) / (Math.PI * 250), contract: con.refused ? 'REFUSED' : 'built', contractErr: con.refused ? null : (con.volume - exact) / exact, sentence: con.refused });
}
const builtBad = rows.filter((r) => r.contract === 'built' && Math.abs(r.contractErr) > BAR);
const refusedN = rows.filter((r) => r.contract === 'REFUSED').length;
const f = (v) => (v === null || v === undefined ? '-' : v.toExponential(1));
const table = rows.map((r) => (r.kind === 'bar'
  ? `bar d${r.d} h${r.h} (diag/d ${r.ratio}): raw truck ${f(r.rawErr)} -> contract ${r.contract}${r.contract === 'built' ? ` ${f(r.contractErr)}` : ''}`
  : `plate ${r.L}^2 x 10 with a d10 bore (diag/d ${r.ratio}): raw truck total ${f(r.rawErr)} (on the hole's own volume ${f(r.rawErrOnHole)}) -> contract ${r.contract}${r.contract === 'built' ? ` ${f(r.contractErr)}` : ''}`)).join('\n');
const sentence = rows.find((r) => r.sentence)?.sentence ?? '';
const out = {
  status: builtBad.length ? 'wrong' : 'supported', sentence,
  evidence: `cmd: SOLIDCRAFT_REFEREE_PKG=$S/sc-referee-pkg systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/extrude-pocket-slender.mjs (results: contract/extrude-pocket-slender-results.json). Round 1 stated a curved bar of 3e-4 (about 1e-4 observed) from squat cases only. Measured: truck's volume error depends ONLY on diag / (2 r) (same table for d1 ... d100) and runs -1.7e-4 (ratio 20-35), -3.1e-4 (45), -4.5e-4 (50), -5.7e-4 (100), -1.8e-3 (200), -2.8e-2 (500), -4.9e-2 (1000), -58% (3000 and beyond): a slender rod a student can draw gives a silently wrong volume and mass. The contract mapping computes the bound  table-error(diag/(2 r)) x curved volume / part volume  after every pull and pocket and REFUSES when it exceeds 3e-4; ${builtBad.length} built case(s) exceed the bar, ${refusedN} refused with the sentence below. A pocket's bound uses the volume the tool removes, so a small bore in a big plate is allowed (plate 5000 x 5000: the hole's own volume is 4.9% off but the total only 1.5e-7). Limit: only the round shapes drawn in the pull/pocket sketch itself are checked, a curved face that came from an earlier feature is not.\n${table}`,
  rows,
};
writeFileSync(path.join(HERE, 'extrude-pocket-slender-results.json'), JSON.stringify(out, null, 1));
console.log(table); console.log(out.status, 'built-over-bar:', builtBad.length, 'refused:', refusedN); console.log('sentence:', sentence);
