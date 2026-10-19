// Round 4: how long does a vertical / tilted cylinder take against a box turned several ways? (kernel slowness model, family 1)
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/booleans-r4/cost-grid1.mjs [--cpu=45]
import { prim, combine, timeRun } from './cost-lib.mjs';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'cost-grid1.jsonl');
const cpu = Number((process.argv.find((a) => a.startsWith('--cpu=')) ?? '--cpu=45').slice(6));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const CYL = { none: null, x45: [45, 0, 0] };
const BOX = { b0: null, bz45: [0, 0, 45], bx45: [45, 0, 0], by45: [0, 45, 0], bx45z45: [45, 0, 45], b45_60_45: [45, 60, 45], b20_30_10: [20, 30, 10], b30_20_10: [30, 20, 10] };
const OPS = { cutBoxByCyl: (a, b) => combine('cut', a, [b]), cutCylByBox: (a, b) => combine('cut', b, [a]), keep: (a, b) => combine('intersect', a, [b]), join: (a, b) => combine('join', a, [b]) };
for (const [cn, cr] of Object.entries(CYL)) for (const [bn, br] of Object.entries(BOX)) for (const [on, of] of Object.entries(OPS)) {
  const id = `cylbox-${cn}-${bn}-${on}`;
  if (done.has(id)) continue;
  const cmds = [...prim('box', 'A', { size: [30, 30, 30] }, br), ...prim('cylinder', 'B', { radius: 6, height: 50 }, cr), of('A', 'B')];
  const r = timeRun(cmds, { cpuLimitS: cpu });
  const row = { id, ...r };
  appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(id.padEnd(40), r.ok ? `cpu ${r.cpuS} s  vol ${r.bodies?.map((b) => b.v).join(',')} faces ${r.bodies?.map((b) => b.f).join(',')}` : r.killed ? `KILLED at ${cpu} s cpu` : `fail ${r.error}`, ` load ${r.load1}`);
}
