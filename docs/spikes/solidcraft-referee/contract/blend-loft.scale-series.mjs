import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const ang = 20 * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
const areaOf = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i]; const [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const ruled = (p0, p1, h) => { const m = p0.map((a, i) => [(a[0] + p1[i][0]) / 2, (a[1] + p1[i][1]) / 2]); return h / 6 * (areaOf(p0) + 4 * areaOf(m) + areaOf(p1)); };
for (const k of [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 100]) {
  const w = 30 * k, h = 20 * k, g = 20 * k;
  const A = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const B = A.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const cmds = [
    { command: 'sketch.create', params: { name: 'a', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: A, closed: true } }, { command: 'sketch.finish', params: {} },
    { command: 'sketch.create', params: { name: 'b', plane: { origin: [0, 0, g], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: B, closed: true } }, { command: 'sketch.finish', params: {} },
    { command: 'solid.loft', params: { sections: [{ sketch: 'a' }, { sketch: 'b' }], operation: 'new', body_name: 'L' } }];
  const r = run(cmds); const b = r.measure.bodies[0]; const an = ruled(A, B, g);
  console.log('k', k, 'truck', b.volume_mm3, 'analytic', an, 'rel', Math.abs(b.volume_mm3 - an) / an, 'faceTypes', JSON.stringify(b.face_types), 'faces', b.faces, 'kfaces', b.kernel.faces);
}
