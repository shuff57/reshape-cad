import { runCase } from './runner.mjs';
import { line } from './cases.mjs';
const T = [
  ['sphere-turn-noop', `const b = sphere(20, { at: [5, 0, 0] });\nturn(b, [10, 20, 30]);`, undefined, undefined],
  ['sphere-turn-param', `const b = sphere(20, { at: [5, 0, 0] });\nturn(b, [param('rx', 30), 0, 0]);`, undefined, undefined],
  ['move-param', `const b = box(10, 10, 10);\nmove(b, [param('dx', 12), param('dy', -3), 0]);`, undefined, undefined],
  ['move-param+values', `const b = box(10, 10, 10);\nmove(b, [param('dx', 12), param('dy', -3), 0]);`, { move1_x: 40, move1_y: 9 }, undefined],
  ['turn-prim-param', `const b = box(10, 20, 30);\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`, undefined, undefined],
  ['turn-prim-param+values', `const b = box(10, 20, 30);\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`, { box1_rx: 75, box1_ry: -20, box1_rz: 10 }, undefined],
  ['turn-derived-param', `const b = box(30, 20, 10);\nhole(b, { across: 4 });\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`, undefined, undefined],
  ['turn-derived-param+values', `const b = box(30, 20, 10);\nhole(b, { across: 4 });\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`, { turn1_rx: 75, turn1_ry: -20, turn1_rz: 10 }, undefined],
  ['turn-cyl-param+values', `const b = cylinder(10, 30);\nturn(b, [param('rx', 30), 0, 0]);`, { cyl1_rx: 65 }, undefined],
];
for (const [name, script, values] of T) {
  const r = runCase({ script, values });
  if (r.errors.length) { console.log(name, 'ERR', r.errors); continue; }
  const id = r.features.at(-1).id;
  console.log(line(name, r, [id]), '| doc', JSON.stringify(r.features.map((f) => f.offset ?? f.angles ?? f.rotate ?? f.kind)));
}
