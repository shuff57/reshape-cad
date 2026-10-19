import { runCase } from './runner.mjs';
import { line } from './cases.mjs';
const P = {
  box: 'box(20, 10, 6, { at: [5, 2, -1] })',
  cylinder: 'cylinder(12, 20, { at: [5, 2, -1] })',
  sphere: 'sphere(14, { at: [5, 2, -1] })',
  cone: 'cone(14, 18, { at: [5, 2, -1] })',
  ring: 'ring(30, 6, { at: [5, 2, -1] })',
  prism: 'prism(6, 20, 12, { at: [5, 2, -1] })',
  wedge: 'wedge(20, 10, 8, { at: [5, 2, -1] })',
};
for (const [k, ctor] of Object.entries(P)) {
  const r = runCase({ script: `const s = ${ctor};\nmove(s, [10, -3.5, 7.25]);`, ids: [undefined].filter(Boolean) });
  const id = r.features.at(-1).id;
  const r2 = runCase({ script: `const s = ${ctor};\nmove(s, [10, -3.5, 7.25]);`, ids: [id] });
  console.log(line('move/' + k, r2));
}
