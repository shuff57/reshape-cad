// Round 4: equal-radius coaxial cylinders (and other shared-wall pairs) through raw SolidCraft, all three operations.
import { prim, combine, timeRun } from './cost-lib.mjs';
const cyl = (n, r, z0, z1) => prim('cylinder', n, { radius: r, height: z1 - z0 }, null, [0, 0, (z0 + z1) / 2]);
const OPS = { join: 'join', cut: 'cut', keep: 'intersect' };
const pairs = {
  'overlap(-10..10 | 0..20)': [cyl('A', 10, -10, 10), cyl('B', 10, 0, 20)],
  'contained(-10..10 | -5..5)': [cyl('A', 10, -10, 10), cyl('B', 10, -5, 5)],
  'longer(-10..10 | -20..20)': [cyl('A', 10, -10, 10), cyl('B', 10, -20, 20)],
  'stacked-touch(-10..0 | 0..10)': [cyl('A', 10, -10, 0), cyl('B', 10, 0, 10)],
  'unequal r10|r6 coaxial overlap': [cyl('A', 10, -10, 10), cyl('B', 6, 0, 20)],
};
for (const [pn, pre] of Object.entries(pairs)) for (const [on, op] of Object.entries(OPS)) {
  const r = timeRun([...pre.flat(), combine(op, 'A', ['B'])], { cpuLimitS: 40 });
  console.log(pn.padEnd(34), on.padEnd(5), r.ok ? `ok cpu ${r.cpuS} vol ${r.bodies.map((b) => b.v)} faces ${r.bodies.map((b) => b.f)}` : r.killed ? 'KILLED' : `FAIL ${r.error}`);
}
