// Round 4: the slant predictor (booleans.slow.mjs) against the measured grid (cost-grid1.jsonl): every case, predicted vs measured.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as SL from '../booleans.slow.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CYL = { none: null, x45: [45, 0, 0] };
const BOX = { b0: null, bz45: [0, 0, 45], bx45: [45, 0, 0], by45: [0, 45, 0], bx45z45: [45, 0, 45], b45_60_45: [45, 60, 45], b20_30_10: [20, 30, 10], b30_20_10: [30, 20, 10] };
const rows = readFileSync(path.join(HERE, 'cost-grid1.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let agree = 0; const dis = []; let slowN = 0; let fastN = 0;
for (const r of rows) {
  const [, cn, bn] = r.id.split('-');
  const cyl = { kind: 'cylinder', radius: 6, height: 50, center: [0, 0, 0], ...(CYL[cn] ? { rotate: CYL[cn] } : {}) };
  const box = { kind: 'box', size: [30, 30, 30], center: [0, 0, 0], ...(BOX[bn] ? { rotate: BOX[bn] } : {}) };
  const v = SL.slantedMeeting({ info: SL.primInfo(cyl), prim: cyl }, { info: SL.primInfo(box), prim: box });
  const predictedSlow = v === 'slant'; const measuredSlow = !!r.killed;
  if (measuredSlow) slowN++; else fastN++;
  if (predictedSlow === measuredSlow) agree++; else dis.push(`${r.id}: predicted ${v}, measured ${r.killed ? `>${r.cpuLimitS} s cpu` : r.cpuS + ' s cpu'}`);
}
console.log(`cases ${rows.length} (measured slow ${slowN}, fast ${fastN}); predictor agrees on ${agree}; disagrees on ${dis.length}`);
for (const d of dis) console.log('  ', d);
console.log('fast ones: ' + rows.filter((r) => !r.killed).map((r) => `${r.id} ${r.cpuS}s`).join(', '));
