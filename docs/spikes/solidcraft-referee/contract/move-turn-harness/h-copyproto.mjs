import { runCase } from './runner.mjs';
import { translateDoc } from './translate-proto.mjs';
import { line } from './cases.mjs';
const C = {
  'copyproto/box': [`const a = box(20, 10, 6, { at: [5, 2, -1] });\nconst b = move(a, [30, -4, 6], { copy: true });`, ['box1', 'move1']],
  'copyproto/cylinder': [`const a = cylinder(12, 20, { at: [5, 2, -1] });\nconst b = move(a, [30, -4, 6], { copy: true });`, ['cyl1', 'move1']],
  'copyproto/wedge': [`const a = wedge(20, 10, 8);\nconst b = move(a, [30, -4, 6], { copy: true });`, ['wedge1', 'move1']],
  'copyproto/hole': [`const s = box(40, 30, 20);\nhole(s, { across: 8, at: [5, 3] });\nconst cp = move(s, [60, 0, 0], { copy: true });`, ['hole1', 'move1']],
  'copyproto/chain': [`const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nconst c = move(b, [20, 0, 0], { copy: true });`, ['box1', 'move1', 'move2']],
  'copyproto/join-overlap': [`const a = box(20, 10, 6);\nconst b = move(a, [10, 0, 0], { copy: true });\njoin(a, b);`, ['op1']],
  'copyproto/join-touch': [`const a = box(20, 10, 6);\nconst b = move(a, [20, 0, 0], { copy: true });\njoin(a, b);`, ['op1']],
  'copyproto/cut-copy': [`const a = box(30, 30, 10);\nconst c = cylinder(8, 30);\nconst d = move(c, [6, 4, 0], { copy: true });\ncut(a, d);`, ['op1']],
  'copyproto/copy-then-move-orig': [`const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nmove(a, [0, 20, 0]);`, ['move1', 'move2']],
};
for (const [k, [s, ids]] of Object.entries(C)) {
  const r = runCase({ script: s, ids, translateFn: translateDoc });
  console.log(line(k, r, ids));
}
