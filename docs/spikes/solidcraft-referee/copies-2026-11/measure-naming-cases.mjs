// Naming cases on the pinned SolidCraft (0.30.1): a copy with no body_name; a copy named b_<id> then a pattern of the original;
// a copy of a copy; a body_name that is taken already.
import { createRequire } from 'node:module';
const sc = createRequire(import.meta.url)((process.env.SOLIDCRAFT_REFEREE_PKG ?? process.env.HOME + '/.cache/solidcraft-0.30.1-rig/sc-referee-pkg') + '/solidcraft_referee.js');
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const names = (r) => r.ok ? r.measure.bodies.map(b => `${b.name}@${b.center_of_mass.map(v => +v.toFixed(6))}:${b.volume_mm3}`).join('  ') : JSON.stringify(r.failed);
const box = { command: 'solid.box', params: { length: 20, width: 10, height: 6, center: [0, 0, 0], body_name: 'b_box1' } };
const copy = (src, name, t) => ({ command: 'solid.move', params: { bodies: [src], translate: t, copy: true, ...(name ? { body_name: name } : {}) } });
const pat = { command: 'solid.pattern.rectangular', params: { bodies: ['b_box1'], dir1: [0, 1, 0], count1: 3, spacing1: 20 } };
console.log('no body_name        ', names(run([box, copy('b_box1', null, [30, 0, 0])])));
console.log('named, then pattern ', names(run([box, copy('b_box1', 'b_move1', [30, 0, 0]), pat])));
console.log('unnamed, then pattern', names(run([box, copy('b_box1', null, [30, 0, 0]), pat])));
console.log('copy of a copy      ', names(run([box, copy('b_box1', 'b_move1', [30, 0, 0]), copy('b_move1', 'b_move2', [30, 0, 0])])));
console.log('name taken          ', names(run([box, copy('b_box1', 'b_box1', [30, 0, 0])])));
