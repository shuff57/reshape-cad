// Round 1 (this run) probe: a SECOND turn/move on a shape that was already turned (composition, not replacement).
// cd docs/spikes/solidcraft-referee/contract/move-turn-harness && SOLIDCRAFT_REFEREE_PKG=<pkg> bun s1-turn-compose.mjs
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { line, verdict } from './cases.mjs';
const mk = {
  box: 'box(20, 10, 6, { at: [5, 2, -1] })',
  cylinder: 'cylinder(12, 20, { at: [5, 2, -1] })',
  cone: 'cone(14, 18, { at: [5, 2, -1] })',
  prism: 'prism(6, 20, 12, { at: [5, 2, -1] })',
  wedge: 'wedge(20, 10, 8, { at: [5, 2, -1] })',
};
const SEQ = {
  'turn;turn': (s) => `turn(s, [30, 0, 0]);\nturn(s, [0, 40, 0]);`,
  'turn;turn;turn': (s) => `turn(s, [30, 0, 0]);\nturn(s, [0, 40, 0]);\nturn(s, [0, 0, 50]);`,
  'turn;move;turn': (s) => `turn(s, [30, 0, 0]);\nmove(s, [7, -3, 2]);\nturn(s, [0, 40, 25]);`,
  'move;turn;turn': (s) => `move(s, [7, -3, 2]);\nturn(s, [0, 40, 25]);\nturn(s, [60, 0, 0]);`,
};
const out = []; const summary = { PASS: 0, FAIL: 0, REFUSED: 0, other: 0 };
for (const [k, c] of Object.entries(mk)) for (const [sn, f] of Object.entries(SEQ)) {
  const script = `const s = ${c};\n${f()}`;
  const r = runCase({ script });
  if (r.errors.length) { out.push({ k, sn, error: r.errors }); console.log(k, sn, 'SCRIPT ERROR', r.errors); summary.other++; continue; }
  const id = r.features.at(-1).id; const v = verdict(r, id); const t = r.truck[id];
  summary[v] = (summary[v] ?? 0) + 1;
  out.push({ k, sn, kinds: r.features.map((x) => x.kind).join('>'), v, dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom, faces: t.faces, occtFaces: t.occtFaces, brepDVol: r.brep[id]?.dVol, brepDBbox: r.brep[id]?.dBbox, tr: t.refused });
  console.log(line(`${k}/${sn} [${r.features.map((x) => x.kind).join('>')}]`, r, [id]));
}
writeFileSync('s1-turn-compose-results.json', JSON.stringify({ out, summary }, null, 1));
console.log(JSON.stringify(summary));
