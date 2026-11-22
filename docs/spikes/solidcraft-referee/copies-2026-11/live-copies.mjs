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
const { loadUpstream } = await imp('packages/layer/test/topology-upstream.mjs');
const { hostFromUsage } = await imp('packages/solidcraft-host/pane/src/host-entry.mjs');
const up = loadUpstream();
const topologyOf = async (cmds) => {
  const topology = await up.topologyOf(cmds);
  if (!topology.ok) return topology;
  const result = await up.runSC(cmds);
  return result.ok ? { ...topology, measure: result.measure } : topology;
};
const { aggregateOf } = await imp('packages/layer/dist/holes.js');
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
  // a primitive with no at: is put beside the one before it (reSHape), so the cylinder is placed at the origin to lie inside the box
  'cut by a copy':       `const a = box(30, 30, 10);\nconst c = cylinder(8, 30, { at: [0, 0, 0] });\nconst d = move(c, [6, 4, 0], { copy: true });\ncut(a, d);`,
  'move the original':   `const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nmove(a, [0, 20, 0]);`,
  'hole in the copy':    `const a = box(30, 20, 10);\nconst b = move(a, [40, 0, 0], { copy: true });\nhole(b, { across: 6 });`,
  'hole in the original': `const a = box(30, 20, 10);\nconst b = move(a, [40, 0, 0], { copy: true });\nhole(a, { across: 6 });`,
  'hole in both':        `const a = box(30, 20, 10);\nconst b = move(a, [40, 0, 0], { copy: true });\nhole(a, { across: 6 });\nhole(b, { across: 4, at: [5, 0] });`,
  'turn the copy':       `const a = box(20, 10, 6);\nconst b = move(a, [40, 0, 0], { copy: true });\nturn(b, [0, 0, 90]);`,
  // a part of several bodies (2026-11-21): a join of two boxes apart, and a row of three
  'several bodies, joined': `const a = box(10, 10, 10, { at: [0, 0, 0] });\nconst b = box(4, 4, 4, { at: [20, 0, 0] });\nconst j = join(a, b);\nconst c = move(j, [0, 30, 0], { copy: true });`,
  'several bodies, a row': `const a = box(10, 10, 10, { at: [0, 0, 0] });\nrepeat(a, { count: 3, step: [20, 0, 0] });\nconst c = move(a, [0, 30, 0], { copy: true });`,
  'hollow open copy': `const a = box(30, 20, 14); const b = move(a, [40, 3, 7], { copy: true }); hollow(b, { wall: 2, open: 'top' });`,
  'hollow closed copy': `const a = box(30, 20, 14); const b = move(a, [40, 3, 7], { copy: true }); hollow(b, { wall: 2 });`,
  'copy closed hollow': `const a = box(30, 20, 14); hollow(a, { wall: 2 }); const b = move(a, [40, 3, 7], { copy: true });`,
  'draft copy face': `const a = box(30, 20, 14); const b = move(a, [40, 3, 7], { copy: true }); draft(b.face('right'), 5, { from: 'bottom' });`,
  'draft copy whole': `const a = box(30, 20, 14); const b = move(a, [40, 3, 7], { copy: true }); draft(b, 5, { whole: true, from: 'bottom' });`,
  'draft copy of copy': `const a = box(30, 20, 14); const b = move(a, [40, 3, 7], { copy: true }); const c = move(b, [60, 0, 10], { copy: true }); draft(c.face('right'), 5, { from: 'bottom' });`,
  'opposite recesses': `const a = box(50, 40, 20); hole(a, { across: 4, counterbore: { across: 16, deep: 3 } }); hole(a, { across: 3, at: [6, 0], deep: 8, from: 'bottom', counterbore: { across: 5, deep: 2 } });`,
  'bottom bore in copy': `const a = box(30, 20, 14); const b = move(a, [40, 3, 7], { copy: true }); hole(b, { across: 6, deep: 8, from: 'bottom' });`,
};

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const worst = (a, b) => Math.max(...b.map((w, i) => Math.abs(a[i] - w)));
let wrong = 0;
let unverified = 0;
for (const [name, script] of Object.entries(CASES)) {
  const r = runScript(script);
  if (r.errors.length) { unverified++; console.log(`${name.padEnd(22)} SCRIPT ERROR ${r.errors.map((e) => e.message ?? e).join('; ')}`); continue; }
  const doc0 = r.doc; const ids = mt.topLevel(doc0).map((f) => f.id);
  const built = buildDoc(oc, doc0, arc);
  const doc = solveDoc(doc0);
  const byId = new Map(doc0.features.map((feature) => [feature.id, feature]));
  const occtRefused = (id, seen = new Set()) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const feature = byId.get(id);
    return built.refusals?.has(id) || (feature && mt.dependsOn(feature).some((dep) => occtRefused(dep, seen)));
  };
  const cells = [];
  for (const allowCopies of [true, false]) {
    const tr = await layer.translateDoc(doc, { arc, mt, runSC, allowCopies, allowBottomHoles: true, followMoves: true, topologyOf, fromUsage: hostFromUsage(doc, { recorded: true }) });
    const replay = await up.runSC(tr.commands);
    const expected = ids.flatMap((id) => tr.features.find((f) => f.id === id && f.status === 'built')?.measure?.bodies ?? []);
    const actual = replay.measure?.bodies?.map((body) => body.name) ?? [];
    if (allowCopies && (!replay.ok || new Set(expected).size !== expected.length || actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some((name) => !expected.includes(name)))) {
      wrong++;
      cells.push(`on final replay body mismatch (expected: ${expected.join(', ')}, got: ${actual.join(', ')})`);
    }
    for (const id of ids) {
      const fr = tr.features.find((x) => x.id === id); const s = built.shapes.get(id); const o = s ? occtMeasure(s) : null;
      let out;
      if (!fr || fr.status !== 'built') out = `REFUSED (${(fr?.refusal ?? 'not reached').slice(0, 110)})`;
      else if (!o || occtRefused(id)) out = `NO-OCCT (${built.refusals?.get(id) ?? 'shape or dependency was not built'})`;
      else if (!aggregateOf(replay, fr.measure.bodies)) out = 'WRONG (final replay lost the body)';
      else {
        const m = aggregateOf(replay, fr.measure.bodies); const curved = Object.keys(m.faceTypes ?? {}).some((k) => k !== 'plane') || o.types?.some?.((t) => t !== 'plane');
        const tol = curved ? 3e-4 : 1e-9; const diag = Math.max(Math.hypot(o.bbox[3] - o.bbox[0], o.bbox[4] - o.bbox[1], o.bbox[5] - o.bbox[2]), 1);
        const dV = rel(m.volume, o.volume); const dB = worst(m.bbox, o.bbox) / diag; const dC = worst(m.com, o.com) / diag;
        const ok = dV <= tol && dB <= tol && dC <= tol;
        out = `${ok ? 'RIGHT' : 'WRONG'} dVol=${dV.toExponential(1)} dBox=${dB.toExponential(1)} dCom=${dC.toExponential(1)}`;
      }
      if (allowCopies && out.startsWith('WRONG')) wrong++;
      if (allowCopies && (out.startsWith('REFUSED') || out.startsWith('NO-OCCT'))) unverified++;
      cells.push(`${allowCopies ? 'on ' : 'off'} ${id}: ${out}`);
    }
  }
  console.log(`${name.padEnd(22)} ${cells.join(' | ')}`);
}
const guardCases = [
  {
    label: 'intersecting bores in a copy', guard: 'G-CROSS',
    script: `const a = box(40, 40, 20); hole(a, { across: 6, deep: 8, from: 'bottom' });
      const b = move(a, [60, 0, 15], { copy: true }); hole(b, { across: 6, along: 'x', at: [0, -5] });`,
    forbidden: (cmd) => cmd.command === 'solid.cylinder' && cmd.params.operation === 'cut' && cmd.params.axis === 'X',
  },
  {
    label: 'hollow with holes before and after copy', guard: 'G-HOLE',
    script: `const a = box(40, 40, 20); hole(a, { across: 6 }); const b = move(a, [60, 0, 10], { copy: true });
      hole(b, { across: 6, at: [7, 0] }); hollow(b, { wall: 2, open: 'top' });`,
    forbidden: (cmd) => cmd.command === 'solid.shell',
  },
  {
    label: 'blocked bottom bore in copy', guard: 'dependency',
    script: `const a = box(40, 40, 20); const b = move(a, [60, 0, 10], { copy: true });
      hollow(b, { wall: 21, open: 'top' }); hole(b, { across: 6, deep: 5, from: 'bottom' });`,
  },
  {
    label: 'same-mouth nesting', guard: 'G-NEST',
    script: `const a = box(50, 40, 20); hole(a, { across: 4, counterbore: { across: 16, deep: 3 } });
      hole(a, { across: 3, at: [6, 0], deep: 8, counterbore: { across: 5, deep: 2 } });`,
  },
];
for (const {label, guard, script, forbidden} of guardCases) {
  const r = runScript(script);
  if (r.errors.length) { unverified++; console.log(label, 'SCRIPT ERROR', r.errors); continue; }
  let attempted = false;
  const guardedRun = async (commands) => {
    if (forbidden && commands.some(forbidden)) {
      attempted = true;
      return { ok: false, failed: { error: 'expected preflight refusal' } };
    }
    return up.runSC(commands);
  };
  const tr = await layer.translateDoc(solveDoc(r.doc), { arc, mt, runSC: guardedRun, allowCopies: true, allowBottomHoles: true, followMoves: true, topologyOf, probeBlocked: true });
  const last = tr.features.at(-1);
  const ok = last?.status === 'refused' && last.guard === guard && !attempted && tr.features.every((f) => f === last || f.status !== 'refused' || guard === 'dependency' && f.kind === 'shell');
  if (!ok) unverified++;
  console.log(`${label}: ${ok ? 'PASS' : 'FAIL'} ${last?.guard ?? last?.status} (${last?.refusal ?? 'no refusal'})`);
}
console.log(wrong ? `WRONG: ${wrong}` : 'NO WRONG SOLID (copies on)');
if (unverified) console.log(`UNVERIFIED: ${unverified} expected on-results lacked an oracle match`);
process.exit(wrong || unverified ? 1 : 0);
