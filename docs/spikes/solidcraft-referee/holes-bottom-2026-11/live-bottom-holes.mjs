// Holes from the bottom, live (plan B step 1, 2026-11-20): each script is translated by the layer (planners 'unified', as the page) on the pinned
// SolidCraft with allowBottomHoles ON and OFF, and every built shape is scored against the OCCT referee's build of the same ModelDoc (a plain bore is built
// about the hole's centre there, so a hole from the bottom is its own independent build) and, where given, a volume worked out by hand.
//
//   cd docs/spikes/solidcraft-referee/holes-bottom-2026-11 && BREP_RS_PKG=<archive/brep-rs/pkg> SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg \
//     flock ~/.cache/solidcraft-0.30.1-rig/rig.lock node live-bottom-holes.mjs > live-bottom-holes.out
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const H = path.join(HERE, '..', 'contract', 'move-turn-harness');
const { oc, runScript, solveDoc, buildDoc, runSC, mt } = await import(pathToFileURL(path.join(H, 'runner.mjs')).href);
const { occtMeasure } = await import(pathToFileURL(path.join(H, 'helpers.mjs')).href);
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await imp('packages/sketch/dist/sketch-arc.js');
const { createTranslator } = await imp('packages/layer/dist/index.js');
const layer = createTranslator({ planners: 'unified' });
const PI = Math.PI;

const CASES = {
  'box, z':               [`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 8, from: 'bottom' });`, 24000 - PI * 9 * 8],
  'box, x':               [`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 10, along: 'x', from: 'bottom' });`, 24000 - PI * 9 * 10],
  'box, y':               [`const b = box(40, 30, 20);\nhole(b, { across: 4, deep: 12, along: 'y', at: [5, 3], from: 'bottom' });`, 24000 - PI * 4 * 12],
  'holes(), corners':     [`const b = box(40, 30, 20);\nholes(b, { across: 4, deep: 5, apart: [20, 10], from: 'bottom' });`, 24000 - 4 * PI * 4 * 5],
  'cylinder':             [`const c = cylinder(30, 20);\nhole(c, { across: 6, deep: 8, at: [5, 0], from: 'bottom' });`, PI * 225 * 20 - PI * 9 * 8],
  'pulled sketch':        [`const sk = sketch('top');\nsk.rect(40, 30);\nconst p = pull(sk, 20);\nhole(p, { across: 6, deep: 8, from: 'bottom' });`, 24000 - PI * 9 * 8],
  'bottom and top':       [`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 8, from: 'bottom' });\nhole(b, { across: 6, deep: 8 });`, 24000 - 2 * PI * 9 * 8],
  'through, from bottom': [`const b = box(40, 30, 20);\nhole(b, { across: 6, from: 'bottom' });`, 24000 - PI * 9 * 20],
  'sphere pole':          [`const s = sphere(30);\nhole(s, { across: 4, deep: 6, from: 'bottom' });`, null],
  'sphere, top (as before)': [`const s = sphere(30);\nhole(s, { across: 4, deep: 6 });`, null],
  'counterbore (refused)': [`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 8, from: 'bottom', counterbore: { across: 10, deep: 3 } });`, null],
};

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const worst = (a, b) => Math.max(...b.map((w, i) => Math.abs(a[i] - w)));
let wrong = 0;
for (const [name, [script, hand]] of Object.entries(CASES)) {
  const r = runScript(script);
  if (r.errors.length) { console.log(`${name.padEnd(22)} SCRIPT ERROR ${r.errors.map((e) => e.message ?? e).join('; ')}`); continue; }
  const doc0 = r.doc; const id = doc0.features.at(-1).id;
  const built = buildDoc(oc, doc0, arc); const s = built.shapes.get(id); const o = s ? occtMeasure(s) : null;
  const doc = solveDoc(doc0); const cells = [];
  for (const allowBottomHoles of [true, false]) {
    const tr = await layer.translateDoc(doc, { arc, mt, runSC, allowBottomHoles });
    const fr = tr.features.find((x) => x.id === id); let out;
    if (!fr || fr.status !== 'built') out = `REFUSED (${(fr?.refusal ?? 'not reached').slice(0, 100)})`;
    else if (!o) out = 'NO-OCCT';
    else {
      const m = fr.measure; const curved = Object.keys(m.faceTypes ?? {}).some((k) => k !== 'plane');
      const tol = curved ? 3e-4 : 1e-9; const diag = Math.max(Math.hypot(o.bbox[3] - o.bbox[0], o.bbox[4] - o.bbox[1], o.bbox[5] - o.bbox[2]), 1);
      const dV = rel(m.volume, o.volume); const dB = worst(m.bbox, o.bbox) / diag; const dC = worst(m.com, o.com) / diag;
      const dH = hand === null ? null : rel(m.volume, hand);
      const ok = dV <= tol && dB <= tol && dC <= tol && (dH === null || dH <= (curved ? 3e-4 : 1e-9)); if (!ok && allowBottomHoles) wrong++;
      out = `${ok ? 'RIGHT' : 'WRONG'} dVol=${dV.toExponential(1)} dBox=${dB.toExponential(1)} dCom=${dC.toExponential(1)}${dH === null ? '' : ` byHand=${dH.toExponential(1)}`} comZ=${m.com[2].toFixed(4)}`;
    }
    cells.push(`${allowBottomHoles ? 'on ' : 'off'} ${out}`);
  }
  console.log(`${name.padEnd(22)} ${cells.join(' | ')}`);
}
console.log(wrong ? `WRONG: ${wrong}` : 'NO WRONG SOLID (bottom holes on)');
process.exit(wrong ? 1 : 0);
