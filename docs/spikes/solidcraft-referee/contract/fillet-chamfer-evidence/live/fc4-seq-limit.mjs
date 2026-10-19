// SPIKE, referee only. ROUND 4, the critic's missing row: the kernel limit when touching edges are blended ONE AFTER THE OTHER (what the translator emitted before grouping) versus ONE CALL.
// Raw solidcraft commands on the rig wasm, no resolver and no guard in the way: for a loop of edges (the 4 top edges of a 40x30x10 plate, the rim of a 10x10x4 pocket, the rim of a 20x10x4 pocket in a 60x40x12 plate)
// and a list of sizes, step k of the sequence is sent on top of steps 1..k-1; the first step the kernel refuses is reported with its exact message, next to the same edges in ONE call and OCCT's simultaneous maker.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun live/fc4-seq-limit.mjs [--res=../fc4-results-seq-limit.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateDoc, mt, arc, solveDoc, runSC, buildDoc, oc, occtMeasure } from '../base.mjs';
import { runViaBundle } from '../../../phase7/bundle-run.mjs';
import { occtSim } from './fc-oracle.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const PL = "const sk1 = sketch('top')\nsk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\n";
const SETS = [
  { id: 'plate-top4', base: PL, picks: [[20, 0, 10], [40, 15, 10], [20, 30, 10], [0, 15, 10]], what: 'the 4 top edges of the 40x30x10 plate, in loop order' },
  { id: 'plate-top4-reversed', base: PL, picks: [[0, 15, 10], [20, 30, 10], [40, 15, 10], [20, 0, 10]], what: 'the same 4 edges in the opposite order' },
  { id: 'plate-top4-skip', base: PL, picks: [[20, 0, 10], [20, 30, 10], [40, 15, 10], [0, 15, 10]], what: 'front, back, right, left (two opposite edges first)' },
  { id: 'pocket10-rim', base: PL + "const sk2 = sketch('top', 10)\nsk2.rect(10, 10, { at: [20, 15] })\nconst part = pocket(sk2, plate, 4)\n", picks: [[20, 10, 10], [25, 15, 10], [20, 20, 10], [15, 15, 10]], what: 'the rim of the 10x10x4 pocket (FreeCAD fillet-after-pocket geometry)' },
  { id: 'pocket20x10-rim', base: "const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10,{at:[0,0]})\nconst part = pocket(sk2, plate, 4)\n", picks: [[0, -5, 6], [10, 0, 6], [0, 5, 6], [-10, 0, 6]], what: 'the rim of a 20x10x4 pocket in a 60x40x12 plate' },
];
const SIZES = [['fillet', 0.5], ['fillet', 1], ['fillet', 2], ['fillet', 3], ['chamfer', 1], ['chamfer', 2], ['chamfer', 3], ['chamfer', 4]];
const rows = [];
for (const S of SETS) {
  const { doc, errors } = runViaBundle(S.base + 'const z = 0');
  if (errors.length) { console.log(S.id, 'SCRIPT', errors[0].message); continue; }
  const baseDoc = { version: 1, features: doc.features.filter((f) => f.kind !== 'sketch' || true).filter((f) => !(f.kind === 'datum')) };
  const tr = translateDoc(solveDoc(baseDoc), { arc, mt, runSC, resolveAt: () => null });
  const built = tr.features.filter((f) => f.status === 'built').at(-1);
  if (!built) { console.log(S.id, 'BASE NOT BUILT', tr.features.map((f) => f.refusal).filter(Boolean)[0]); continue; }
  const body = built.measure.bodies[0];
  const V0 = built.measure.volume;
  for (const [style, size] of SIZES) {
    const cmd = (pts) => ({ command: style === 'chamfer' ? 'solid.chamfer' : 'solid.fillet', params: { edges: pts, [style === 'chamfer' ? 'distance' : 'radius']: size, body } });
    const row = { set: S.id, what: S.what, style, size, V0, steps: [] };
    let cmds = [...tr.commands];
    for (let k = 0; k < S.picks.length; k++) {
      cmds = [...cmds, cmd([S.picks[k]])];
      const r = runSC(cmds);
      if (!r.ok) { row.steps.push({ k: k + 1, refused: `${r.failed?.command}: ${r.failed?.error}`.slice(0, 160) }); row.firstRefusedStep = k + 1; break; }
      const m = r.measure.bodies.find((b) => b.name === body);
      row.steps.push({ k: k + 1, volume: m.volume_mm3, faces: m.faces });
    }
    const one = runSC([...tr.commands, cmd(S.picks)]);
    row.oneCall = one.ok ? (({ volume_mm3, faces }) => ({ volume: volume_mm3, faces }))(one.measure.bodies.find((b) => b.name === body)) : { refused: `${one.failed?.command}: ${one.failed?.error}`.slice(0, 160) };
    // OCCT simultaneous on the same picks, base doc from the script
    row.occtSim = occtSim(baseDoc, S.picks, size, style);
    rows.push(row);
    const last = row.steps.at(-1);
    console.log(S.id.padEnd(20), style.padEnd(8), String(size).padEnd(4), 'steps:', row.steps.map((s) => (s.refused ? 'REFUSED' : s.volume.toFixed(2))).join(' > '), '| one call:', row.oneCall.refused ? 'REFUSED ' + row.oneCall.refused.slice(0, 70) : `${row.oneCall.volume.toFixed(4)} f${row.oneCall.faces}`, '| OCCT sim:', row.occtSim.refused ? 'REFUSED' : `${row.occtSim.volume.toFixed(4)} f${row.occtSim.faces}`);
  }
}
writeFileSync(path.resolve(HERE, arg('res', '../fc4-results-seq-limit.json')), JSON.stringify(rows, null, 1));
console.log('wrote', rows.length);
