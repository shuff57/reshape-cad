// round 3: how long does a ring (torus) take on its own, turned, and copied? CPU seconds of the solidcraft call inside the child (load independent).
import { runCase, scCalls } from './runner.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const C = {
  'ring alone': `const t = ring(30, 6);`,
  'ring turned [30,40,50]': `const t = ring(30, 6);\nturn(t, [30, 40, 50]);`,
  'ring copy-moved': `const t = ring(30, 6);\nmove(t, [0, 40, 0], { copy: true });`,
  'box alone': `const t = box(30, 20, 10);`,
  'cylinder alone': `const t = cylinder(20, 30);`,
  'sphere alone': `const t = sphere(30);`,
  'cone alone': `const t = cone(30, 40);`,
};
for (const [k, script] of Object.entries(C)) {
  scCalls.length = 0;
  const r = runCase({ script, translateFn: guard });
  const id = r.features.at(-1).id;
  console.log(k.padEnd(26), 'calls', scCalls.map((c) => `${(c.ms / 1000).toFixed(1)}s wall/${((c.cpuMs ?? -1000) / 1000).toFixed(1)}s cpu`).join(', '), '| last call is the full build', r.truck[id].refused ?? 'ok');
}
