// A copying move of TWO bodies on the pinned SolidCraft (0.30.1): does body_names name each copy, in order?
import { createRequire } from 'node:module';
const sc = createRequire(import.meta.url)((process.env.SOLIDCRAFT_REFEREE_PKG ?? process.env.HOME + '/.cache/solidcraft-0.30.1-rig/sc-referee-pkg') + '/solidcraft_referee.js');
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const names = (r) => r.ok ? r.measure.bodies.map(b => `${b.name}@${b.center_of_mass.map(v => +v.toFixed(6))}:${b.volume_mm3}`).join('  ') : JSON.stringify(r.failed);
const A = { command: 'solid.box', params: { length: 10, width: 10, height: 10, center: [0, 0, 0], body_name: 'A' } };
const B = { command: 'solid.box', params: { length: 4, width: 4, height: 4, center: [20, 0, 0], body_name: 'B' } };
console.log('body_names [A2, B2] ', names(run([A, B, { command: 'solid.move', params: { bodies: ['A', 'B'], translate: [0, 30, 0], copy: true, body_names: ['A2', 'B2'] } }])));
console.log('body_names reversed ', names(run([A, B, { command: 'solid.move', params: { bodies: ['B', 'A'], translate: [0, 30, 0], copy: true, body_names: ['B2', 'A2'] } }])));
