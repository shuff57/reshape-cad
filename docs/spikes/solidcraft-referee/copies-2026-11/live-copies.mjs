// Copying moves, live (plan A, 2026-11-20): each script is translated by the layer (planners 'unified', as the page) on the pinned SolidCraft, with
// allowCopies ON and OFF, and every built shape is scored against the OCCT referee's build of the same ModelDoc (packages/brep-adapter occt-build).
// brep-rs refuses copies (contract/move-turn-harness/m-copy.out), so OCCT is the one referee here.
//
//   cd docs/spikes/solidcraft-referee/copies-2026-11 && SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg \
//     flock ~/.cache/solidcraft-0.30.1-rig/rig.lock node live-copies.mjs > live-copies.out
//
// Each case lists the shapes to score (the top-level shapes at the end). Outcomes per shape: RIGHT (volume, box and centre of mass within planar 1e-9 /
// curved 3e-4 of OCCT), WRONG (built and not so: any is a stop), REFUSED (with its sentence), NO-OCCT (OCCT did not build it).
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

const CASES = {
  'box':                 `const a = box(20, 10, 6, { at: [5, 2, -1] });\nconst b = move(a, [30, -4, 6], { copy: true });`,
  'cylinder':            `const a = cylinder(12, 20, { at: [5, 2, -1] });\nconst b = move(a, [30, -4, 6], { copy: true });`,
  'sphere':              `const a = sphere(10);\nconst b = move(a, [25, 0, 0], { copy: true });`,
  'wedge':               `const a = wedge(20, 10, 8);\nconst b = move(a, [30, -4, 6], { copy: true });`,
  'holed box':           `const s = box(40, 30, 20);\nhole(s, { across: 8, at: [5, 3] });\nconst cp = move(s, [60, 0, 0], { copy: true });`,
  'copy then pattern':   `const a = box(10, 10, 10);\nconst b = move(a, [30, 0, 0], { copy: true });\nrepeat(a, { count: 3, step: [0, 20, 0] });`,
  'pattern of the copy': `const a = box(10, 10, 10);\nconst b = move(a, [30, 0, 0], { copy: true });\nrepeat(b, { count: 3, step: [0, 20, 0] });`,
  'copy of a copy':      `const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nconst c = move(b, [20, 0, 0], { copy: true });`,
  'join overlapping':    `const a = box(20, 10, 6);\nconst b = move(a, [10, 0, 0], { copy: true });\njoin(a, b);`,
  'cut by a copy':       `const a = box(30, 30, 10);\nconst c = cylinder(8, 30);\nconst d = move(c, [6, 4, 0], { copy: true });\ncut(a, d);`,
  'move the original':   `const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nmove(a, [0, 20, 0]);`,
  'hole in the copy':    `const a = box(30, 20, 10);\nconst b = move(a, [40, 0, 0], { copy: true });\nhole(b, { across: 6 });`,
  'turn the copy':       `const a = box(20, 10, 6);\nconst b = move(a, [40, 0, 0], { copy: true });\nturn(b, [0, 0, 90]);`,
};

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const worst = (a, b) => Math.max(...b.map((w, i) => Math.abs(a[i] - w)));
let wrong = 0;
for (const [name, script] of Object.entries(CASES)) {
  const r = runScript(script);
  if (r.errors.length) { console.log(`${name.padEnd(22)} SCRIPT ERROR ${r.errors.map((e) => e.message ?? e).join('; ')}`); continue; }
  const doc0 = r.doc; const ids = mt.topLevel(doc0).map((f) => f.id);
  const built = buildDoc(oc, doc0, arc);
  const doc = solveDoc(doc0);
  const cells = [];
  for (const allowCopies of [true, false]) {
    const tr = await layer.translateDoc(doc, { arc, mt, runSC, allowCopies });
    for (const id of ids) {
      const fr = tr.features.find((x) => x.id === id); const s = built.shapes.get(id); const o = s ? occtMeasure(s) : null;
      let out;
      if (!fr || fr.status !== 'built') out = `REFUSED (${(fr?.refusal ?? 'not reached').slice(0, 110)})`;
      else if (!o) out = 'NO-OCCT';
      else {
        const m = fr.measure; const curved = Object.keys(m.faceTypes ?? {}).some((k) => k !== 'plane') || o.types?.some?.((t) => t !== 'plane');
        const tol = curved ? 3e-4 : 1e-9; const diag = Math.max(Math.hypot(o.bbox[3] - o.bbox[0], o.bbox[4] - o.bbox[1], o.bbox[5] - o.bbox[2]), 1);
        const dV = rel(m.volume, o.volume); const dB = worst(m.bbox, o.bbox) / diag; const dC = worst(m.com, o.com) / diag;
        const ok = dV <= tol && dB <= tol && dC <= tol; if (!ok && allowCopies) wrong++;
        out = `${ok ? 'RIGHT' : 'WRONG'} dVol=${dV.toExponential(1)} dBox=${dB.toExponential(1)} dCom=${dC.toExponential(1)}`;
      }
      cells.push(`${allowCopies ? 'on ' : 'off'} ${id}: ${out}`);
    }
  }
  console.log(`${name.padEnd(22)} ${cells.join(' | ')}`);
}
console.log(wrong ? `WRONG: ${wrong}` : 'NO WRONG SOLID (copies on)');
process.exit(wrong ? 1 : 0);
