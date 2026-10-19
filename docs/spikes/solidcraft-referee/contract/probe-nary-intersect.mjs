#!/usr/bin/env node
// SPIKE, referee only. Why does keep(a,b,c) come out wrong? Runs SolidCraft ONLY, on the exact command lists the phase0 translator emits
// (solid.combine {target, tools:[b,c], operation:'intersect'}) and on a pairwise rewrite (intersect a,b; then that result with c).
// OCCT's left fold ((a & b) & c) is the oracle; the closed forms below are independent of any kernel.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/probe-nary-intersect.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const vols = (r) => (r.ok ? r.measure.bodies.map((b) => `${b.name}=${b.volume_mm3.toFixed(4)}`).join(' ') : `ERR ${r.failed?.error}`);
const comb = (target, tools, operation) => ({ command: 'solid.combine', params: { target, tools, operation } });

// three overlapping slabs: A x[-10,10], B x[5,25], C x[20,40], all 20 x 20 in y,z.   A&B = x[5,10]; A&B&C = empty; A&(B|C) = x[5,10] (2000)
const A = box('A', 20, 20, 20, [0, 0, 0]); const B = box('B', 20, 20, 20, [15, 0, 0]); const C = box('C', 20, 20, 20, [30, 0, 0]);
console.log('A,B,C slabs. closed form: A&B&C = empty (0); A&(B|C) = 2000');
console.log('  n-ary, as the translator emits    :', vols(run([A, B, C, comb('A', ['B', 'C'], 'intersect')])));
console.log('  pairwise fold (A&B) then &C      :', vols(run([A, B, C, comb('A', ['B'], 'intersect'), comb('A', ['C'], 'intersect')])));

// A x[-20,20] y[-20,20] z[-10,10];  P = x[-10,10] slab;  Q = y[-10,10] slab;  A&P&Q = 20x20x20 = 8000;  A&(P|Q) = 16000+16000-8000 = 24000 ... (cross-shaped)
const A2 = box('A', 40, 40, 20, [0, 0, 0]); const P = box('P', 20, 60, 60, [0, 0, 0]); const Q = box('Q', 60, 20, 60, [0, 0, 0]);
console.log('A, slab P (|x|<10), slab Q (|y|<10). closed form: A&P&Q = 20*20*20 = 8000; A&(P|Q) = 2*(20*40*20)-8000 = 24000');
console.log('  n-ary, as the translator emits    :', vols(run([A2, P, Q, comb('A', ['P', 'Q'], 'intersect')])));
console.log('  pairwise fold                    :', vols(run([A2, P, Q, comb('A', ['P'], 'intersect'), comb('A', ['Q'], 'intersect')])));

// cut: the n-ary form is right (A - (P|Q) = 8000 as four 2000 corner blocks). A pairwise rewrite is NOT a valid fix there when the first cut
// splits the target, because the second cut would name only one of the pieces; that is why only intersect needs the fold.
console.log('cut A-P-Q. closed form: 32000 - 24000 = 8000 (four corner blocks of 2000)');
console.log('  n-ary                            :', vols(run([A2, P, Q, comb('A', ['P', 'Q'], 'cut')])));
