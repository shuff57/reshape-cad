// One live measurement on the pinned SolidCraft (0.30.1): what solid.move with copy: true names the copy, with and without body_name.
import { createRequire } from 'node:module';
const sc = createRequire(import.meta.url)((process.env.SOLIDCRAFT_REFEREE_PKG ?? process.env.HOME + '/.cache/solidcraft-0.30.1-rig/sc-referee-pkg') + '/solidcraft_referee.js');
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const box = { command: 'solid.box', params: { length: 20, width: 10, height: 6, center: [0, 0, 0], body_name: 'A' } };
const r = run([box, { command: 'solid.move', params: { bodies: ['A'], translate: [30, 0, 0], copy: true, body_name: 'Acopy' } }]);
console.log(JSON.stringify(r).slice(0, 1500));
