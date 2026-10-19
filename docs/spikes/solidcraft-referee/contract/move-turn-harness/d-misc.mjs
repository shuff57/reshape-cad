import { writeFileSync } from 'node:fs';
import { runCase, runScript } from './runner.mjs';
import { line } from './cases.mjs';
import { verdict } from './cases.mjs';
const out = {};
const run = (name, script, ids, opts = {}) => {
  const t0 = Date.now();
  let r;
  try { r = runCase({ script, ids, ...opts }); } catch (e) { console.log(name, 'THROW', e.message); out[name] = { throw: e.message }; return null; }
  const id = ids ?? [r.features?.at(-1)?.id];
  console.log(line(name, r, ids ?? undefined) + `   (${Date.now() - t0}ms)`);
  out[name] = { script, errors: r.errors, kinds: r.features?.map((f) => f.kind), v: Object.fromEntries((ids ?? [r.features?.at(-1)?.id]).map((i) => [i, r.errors?.length ? 'SCRIPT-ERROR' : verdict(r, i)])), truck: r.truck, brep: r.brep, truckFeatures: r.truckFeatures };
  return r;
};
const H = {
  hole_box: `const s = box(40, 30, 20, { at: [3, -2, 1] });\nhole(s, { across: 8, at: [5, 3] });`,
  corner_box: `const s = box(30, 20, 10, { corner: 2 });`,
  fillet_box: `const s = box(30, 20, 10);\nround(s.edge('top', 'front'), 2);`,
  hollow_box: `const s = box(30, 20, 10);\nhollow(s, { wall: 2 });`,
  join: `const s0 = box(30, 20, 10);\nconst c = cylinder(10, 30, { at: [10, 0, 0] });\nconst s = join(s0, c);`,
  cut: `const s0 = box(30, 20, 10);\nconst c = cylinder(10, 30, { at: [10, 0, 0] });\nconst s = cut(s0, c);`,
  mirror: `const s0 = box(30, 20, 10, { at: [20, 0, 0] });\nconst s = mirror(s0, 'left-right');`,
  repeat: `const s = box(10, 10, 10);\nrepeat(s, { count: 3, step: 15 });`,
  pull: `const sk = sketch('top');\nsk.rect(30, 20);\nconst s = pull(sk, 12);`,
};
const mode = process.argv[2];
if (mode === 'move') {
  for (const [k, b] of Object.entries(H)) run(`move/derived/${k}`, `${b}\nmove(s, [12, -7, 3.5]);`);
  const B = 'const a = box(20, 10, 6, { at: [5, 2, -1] });';
  run('move/zero', `${B}\nmove(a, [0, 0, 0]);`);
  run('move/negative', `${B}\nmove(a, [-100, -50.5, -20]);`);
  run('move/large', `${B}\nmove(a, [5000, -3000, 12000]);`);
  run('move/chain2', `${B}\nmove(a, [10, 0, 0]);\nmove(a, [0, 5, 0]);`);
  run('move/chain3-mixed', `${B}\nmove(a, [10, 0, 0]);\nturn(a, [0, 0, 30]);\nmove(a, [0, 5, 0]);`);
  run('move/after-turn-primitive', `${B}\nturn(a, [30, 40, 50]);\nmove(a, [7, -3, 2]);`);
  run('move/turn-after-move', `${B}\nmove(a, [7, -3, 2]);\nturn(a, [30, 40, 50]);`);
  run('move/join-moved', `const a = box(20, 10, 6);\nconst c = box(10, 10, 10);\nmove(c, [15, 0, 0]);\njoin(a, c);`);
  run('move/cut-moved-cyl', `const a = box(30, 30, 10);\nconst c = cylinder(8, 30);\nmove(c, [6, 4, 0]);\ncut(a, c);`);
  run('move/hole-after-move', `const a = box(30, 30, 10);\nmove(a, [10, 10, 10]);\nhole(a, { across: 6 });`);
  run('move/round-after-move', `const a = box(30, 30, 10);\nmove(a, [10, 10, 10]);\nround(a.edge('top', 'front'), 2);`);
}
if (mode === 'copy') {
  const P = { box: 'box(20, 10, 6, { at: [5, 2, -1] })', cylinder: 'cylinder(12, 20, { at: [5, 2, -1] })', sphere: 'sphere(14, { at: [5, 2, -1] })', cone: 'cone(14, 18, { at: [5, 2, -1] })', ring: 'ring(30, 6, { at: [5, 2, -1] })', prism: 'prism(6, 20, 12, { at: [5, 2, -1] })', wedge: 'wedge(20, 10, 8, { at: [5, 2, -1] })' };
  for (const [k, c] of Object.entries(P)) { if (process.argv[3] === 'derived') break;
    const r = runCase({ script: `const a = ${c};\nconst b = move(a, [30, -4, 6], { copy: true });` });
    const root = r.features[0].id, cp = r.features.at(-1).id;
    run(`copy/${k}`, `const a = ${c};\nconst b = move(a, [30, -4, 6], { copy: true });`, [root, cp]);
  }
  for (const [k, b] of Object.entries(H)) if (['hole_box', 'join', 'mirror', 'pull', 'hollow_box'].includes(k)) {
    const r = runCase({ script: `${b}\nconst cp = move(s, [60, 0, 0], { copy: true });` });
    run(`copy/derived/${k}`, `${b}\nconst cp = move(s, [60, 0, 0], { copy: true });`, [r.features.at(-1).target, r.features.at(-1).id]);
  }
  run('copy/chain', `const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nconst c = move(b, [20, 0, 0], { copy: true });`, ['box1', 'move1', 'move2']);
  run('copy/join-overlap', `const a = box(20, 10, 6);\nconst b = move(a, [10, 0, 0], { copy: true });\njoin(a, b);`);
  run('copy/join-touch', `const a = box(20, 10, 6);\nconst b = move(a, [20, 0, 0], { copy: true });\njoin(a, b);`);
  run('copy/offset-zero', `const a = box(20, 10, 6);\nconst b = move(a, [0, 0, 0], { copy: true });`, ['box1', 'move1']);
  run('copy/copy-false-explicit', `const a = box(20, 10, 6);\nmove(a, [10, 0, 0], { copy: false });`);
  run('copy/bad-option', `const a = box(20, 10, 6);\nmove(a, [10, 0, 0], { copies: true });`);
}
writeFileSync(`d-${mode}-results.json`, JSON.stringify(out, null, 1));
console.log('done', mode);
