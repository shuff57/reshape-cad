// REAL-KERNEL measure of the open-outline pre-flight (src/open-outline.ts). Not part of `npm test`: needs the SolidCraft wasm rig.
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-open-outline.mjs --sweep [--out=f.json]
// The boundary sweep of the 0.30.1 halt (~/.cache/solidcraft-0.30.1-rig/HALT.md, step2/gap-sweep.json): the 30 x 20 rect drawn as four lines with no rule, line 3 ending
// g short of line 4 (gap-x) or line 4 starting g below line 3 (gap-y), pulled 10, g = 1e-7 ... 1e-2; and the same rows cut as a pocket 5 deep into box(60, 50, 20)
// spanning z 0..20, g = 1e-6, 1e-4, 1e-3. Every case is an OPEN outline (OCCT and brep-rs refuse every one: "edge 1 has a loose end"). Each doc runs through all nine
// sets twice on the same kernel: the check OFF (ctx.skipOpenOutline, = the layer before it) and ON (production). Every other check is on in both runs.
// "open built" = a pull or pocket of an open outline that the layer built. The pass condition is 0 after.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const SG = path.join(REPO, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness');
if (!process.env.SOLIDCRAFT_REFEREE_PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const C = await import(pathToFileURL(path.join(SG, 'sg-core.mjs')).href);
const L = await import(pathToFileURL(path.join(REPO, 'packages/layer/dist/index.js')).href);
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const OUT = arg('out');
const NINE = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(NINE.map((p) => [p, L.createTranslator({ planners: p })]));

const line = (id, a, b) => `{ k: 'line', id: ${id}, a: [${a}], b: [${b}] }`;
const rows = (gx, gy) => `[${line(1, '0, 0', '30, 0')}, ${line(2, '30, 0', '30, 20')}, ${line(3, '30, 20', `${gx}, 20`)}, ${line(4, `0, ${+(20 - gy).toPrecision(12)}`, '0, 0')}]`;
const CASES = [];
for (const g of [1e-7, 1e-6, 1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 1e-2]) {
  CASES.push({ id: `gap-y-${g}`, script: `const sk = sketch('top'); sk.geom(${rows(0, g)}); const part = pull(sk, 10);` });
  CASES.push({ id: `gap-x-${g}`, script: `const sk = sketch('top'); sk.geom(${rows(g, 0)}); const part = pull(sk, 10);` });
}
for (const g of [1e-6, 1e-4, 1e-3]) CASES.push({ id: `gap-pocket-${g}`, script: `const b = box(60, 50, 20, { at: [0, 0, 10] }); const sk = sketch('top', 20); sk.geom(${rows(0, g)}); pocket(sk, b, 5);` });

async function layer(set, doc, on) {
  try {
    const tr = await TR[set].translateDoc(structuredClone(doc), { arc: C.arc, mt: C.mt, runSC: C.runSC, soups: {}, resolveAt: () => null, ...(on ? {} : { skipOpenOutline: true }) });
    return tr.features;
  } catch (e) { return { threw: String(e.message) }; }
}

if (process.argv.includes('--sweep')) {
  const rowsOut = []; const T = { runs: 0, openBuiltBefore: 0, openBuiltAfter: 0, refusedAfter: 0, byGuardAfter: {}, threw: 0 };
  for (const c of CASES) {
    const run = C.runScript(c.script);
    if (run.errors.length) { console.log(`${c.id}\tSCRIPT-ERROR ${JSON.stringify(run.errors).slice(0, 200)}`); rowsOut.push({ id: c.id, scriptError: run.errors }); continue; }
    const doc = C.solveDoc(run.doc);
    const fid = doc.features.find((f) => f.kind === 'extrude' || f.kind === 'pocket').id;
    for (const set of NINE) {
      const off = await layer(set, doc, false); const on = await layer(set, doc, true);
      T.runs++;
      if (off.threw || on.threw) { T.threw++; rowsOut.push({ id: c.id, set, threw: off.threw ?? on.threw }); console.log(`${c.id}\t${set}\tTHREW ${off.threw ?? on.threw}`); continue; }
      const b = off.find((f) => f.id === fid); const a = on.find((f) => f.id === fid);
      if (b.status === 'built') T.openBuiltBefore++;
      if (a.status === 'built') T.openBuiltAfter++; else { T.refusedAfter++; T.byGuardAfter[a.guard ?? '(none)'] = (T.byGuardAfter[a.guard ?? '(none)'] ?? 0) + 1; }
      const row = { id: c.id, set, before: { status: b.status, volume: b.measure?.volume ?? null, guard: b.guard ?? null, refusal: b.refusal ?? null }, after: { status: a.status, volume: a.measure?.volume ?? null, guard: a.guard ?? null, refusal: a.refusal ?? null } };
      rowsOut.push(row);
      console.log(`${c.id}\t${set}\tbefore ${b.status}${b.status === 'built' ? ` ${b.measure?.volume}` : ` [${b.guard ?? ''}]`}\tafter ${a.status}${a.status === 'built' ? ` ${a.measure?.volume} OPEN-BUILT` : ` [${a.guard ?? ''}] ${a.refusal}`}`);
    }
  }
  console.log(`DONE ${JSON.stringify(T)}`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ pkg: process.env.SOLIDCRAFT_REFEREE_PKG, T, rows: rowsOut }, null, 1));
  process.exit(T.openBuiltAfter || T.threw ? 1 : 0);
}
console.error('usage: --sweep');
process.exit(2);
