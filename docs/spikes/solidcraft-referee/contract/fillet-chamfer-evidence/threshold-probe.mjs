import { createRequire } from 'node:module';
const sc = createRequire(import.meta.url)(process.env.SOLIDCRAFT_REFEREE_PKG + '/solidcraft_referee.js');
const run = (cmds) => { const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); return r.ok ? r.measure.bodies[0].volume_mm3.toFixed(3) + ' f' + r.measure.bodies[0].faces : 'REFUSED ' + (r.failed?.error ?? '').slice(0, 70); };
const box = [{ command: 'solid.box', params: { length: 40, width: 30, height: 20, center: [0, 0, 0], body_name: 'b' } }];
const ch = (p, d) => ({ command: 'solid.chamfer', params: { edges: [p], distance: d, body: 'b' } });
for (const d of [20, 25, 40, 45, 49, 49.9, 50, 50.1, 55, 60, 70, 100]) console.log('top/front (legs 20,30; sum 50) d', d, run([...box, ch([0, -15, 10], d)]));
for (const d of [30, 40, 60, 69, 70, 71, 80]) console.log('front/left vertical (legs 30,40; sum 70) d', d, run([...box, ch([-20, -15, 0], d)]));
