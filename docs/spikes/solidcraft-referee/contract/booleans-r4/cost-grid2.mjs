// Round 4, family 2+: sphere, cone, parallel cylinders, planar solids, and "surfaces never meet" cases, each with a calibration run right before (cost in calibration units).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/booleans-r4/cost-grid2.mjs [--cpu=30]
import { prim, combine, timeRunCal } from './cost-lib.mjs';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'cost-grid2.jsonl');
const cpu = Number((process.argv.find((a) => a.startsWith('--cpu=')) ?? '--cpu=30').slice(6));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const S = (kind, p, rot, c) => ({ kind, p, rot: rot ?? null, c: c ?? [0, 0, 0] });
const OPS = { cutAbyB: (a, b) => combine('cut', a, [b]), cutBbyA: (a, b) => combine('cut', b, [a]), keep: (a, b) => combine('intersect', a, [b]), join: (a, b) => combine('join', a, [b]) };
const FAM = [];
const fam = (id, A, B, ops = Object.keys(OPS)) => FAM.push({ id, A, B, ops });
// sphere x box (a box 20 cube: the r10 ball sticks out of its faces)
fam('sph-box-aligned', S('sphere', { radius: 10 }), S('box', { size: [20, 20, 20] }));
fam('sph-box-bx45', S('sphere', { radius: 10 }), S('box', { size: [20, 20, 20] }, [45, 0, 0]));
fam('sph-box-b30_20_10', S('sphere', { radius: 10 }), S('box', { size: [20, 20, 20] }, [30, 20, 10]));
// the same with a 16 mm box (the r10 ball pokes out of every face; the 20 mm box above is tangent to it and is a degenerate case)
fam('sph-box16-aligned', S('sphere', { radius: 10 }), S('box', { size: [16, 16, 16] }));
fam('sph-box16-bx45', S('sphere', { radius: 10 }), S('box', { size: [16, 16, 16] }, [45, 0, 0]));
fam('sph-box16-b30_20_10', S('sphere', { radius: 10 }), S('box', { size: [16, 16, 16] }, [30, 20, 10]));
fam('sph-sph-r10-r10-off8', S('sphere', { radius: 10 }), S('sphere', { radius: 10 }, null, [8, 0, 0]));
fam('sph-sph-r10-r6-off8', S('sphere', { radius: 10 }), S('sphere', { radius: 6 }, null, [8, 0, 0]));
fam('sph-cylcentre-aligned', S('sphere', { radius: 10 }), S('cylinder', { radius: 4, height: 30 }));
// cone x box / coaxial cylinder
fam('cone-box-aligned', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, null, [0, 0, 5]));
fam('cone-box-offaxis', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, null, [6, 0, 5]));
fam('cone-box-bz45', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, [0, 0, 45], [6, 0, 5]));
fam('cone-box-bx45', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, [45, 0, 0], [0, 0, 5]));
// cone with the box clear of the apex plane (the family above puts the box top ON the apex)
fam('cone2-box-aligned', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, null, [0, 0, 0]));
fam('cone2-box-offaxis', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, null, [6, 0, 0]));
fam('cone2-box-bz45', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, [0, 0, 45], [6, 0, 0]));
fam('cone2-box-bx45', S('cone', { radius: 10, height: 20 }), S('box', { size: [10, 10, 10] }, [45, 0, 0], [0, 0, 0]));
fam('cone-cyl-coax', S('cone', { radius: 10, height: 20 }), S('cylinder', { radius: 4, height: 30 }));
// cylinder x cylinder, parallel axes
fam('cyl-cyl-par', S('cylinder', { radius: 10, height: 30 }), S('cylinder', { radius: 6, height: 40 }, null, [8, 0, 0]));
fam('cyl-cyl-par-tilted', S('cylinder', { radius: 10, height: 30 }, [45, 0, 0]), S('cylinder', { radius: 6, height: 40 }, [45, 0, 0], [8, 0, 0]));
// planar x planar, turned
fam('box-box-b30_20_10', S('box', { size: [30, 30, 30] }), S('box', { size: [20, 20, 20] }, [30, 20, 10], [8, 0, 0]));
fam('prism6-cyl-tilted', S('prism', { sides: 6, radius: 12, height: 30 }), S('cylinder', { radius: 4, height: 50 }, [45, 0, 0]));
fam('wedge-cyl-vert', S('wedge', { width: 30, depth: 20, height: 20 }), S('cylinder', { radius: 4, height: 30 }, null, [4, 0, 0]));
fam('prism6-cyl-vert', S('prism', { sides: 6, radius: 12, height: 30 }), S('cylinder', { radius: 4, height: 50 }, null, [4, 0, 0]));
fam('prism6-cyl-horiz', S('prism', { sides: 6, radius: 12, height: 30 }), S('cylinder', { radius: 4, height: 50 }, [90, 0, 0]));
// cylinder x box, surfaces never meet (cylinder wholly inside a turned box), and cylinder aligned with a turned box
fam('cyl-inside-box-bx45', S('cylinder', { radius: 3, height: 10 }), S('box', { size: [40, 40, 40] }, [45, 0, 0]));
fam('cyl-box-aligned-pair-bx45', S('cylinder', { radius: 6, height: 50 }, [45, 0, 0]), S('box', { size: [30, 30, 30] }, [45, 0, 0]));
fam('cyl-box-aligned-pair-b30_20_10', S('cylinder', { radius: 6, height: 50 }, [30, 20, 10]), S('box', { size: [30, 30, 30] }, [30, 20, 10]));
// torus the contract lets through
fam('tor-box-around', S('torus', { ringRadius: 14, tubeRadius: 4 }), S('box', { size: [50, 50, 20] }), ['cutBbyA', 'join']);
for (const f of FAM) for (const on of f.ops) {
  const id = `${f.id}-${on}`;
  if (done.has(id)) continue;
  const cmds = [...prim(f.A.kind, 'A', f.A.p, f.A.rot, f.A.c), ...prim(f.B.kind, 'B', f.B.p, f.B.rot, f.B.c), OPS[on]('A', 'B')];
  const r = timeRunCal(cmds, { cpuLimitS: cpu });
  appendFileSync(OUT, JSON.stringify({ id, ...r }) + '\n');
  console.log(id.padEnd(46), r.ok ? `cpu ${String(r.cpuS).padStart(6)} s  cal ${r.calS}  ratio ${String(r.ratio).padStart(6)}  vol ${r.bodies?.map((b) => b.v).join(',')} f ${r.bodies?.map((b) => b.f).join(',')}` : r.killed ? `KILLED at ${cpu} s cpu (cal ${r.calS})` : `fail ${r.error}`, ` load ${r.load1}`);
}
