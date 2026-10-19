// Raw truck probe: bounding box and volume of a cylinder whose top rim is chamfered/filleted by d close to the radius R (cylinder(2R, H)). The true bbox is exactly
// +-R by +-R by H (the opposite rim is untouched). Output: bbox-probe.txt. SOLIDCRAFT_REFEREE_PKG=<pkg> bun bbox-probe.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const run = (R, H, cmd, d) => {
  const cmds = [{ command: 'solid.cylinder', params: { base: [0, 0, -H / 2], axis: [0, 0, 1], radius: R, height: H, body_name: 'c' } },
    { command: cmd, params: { edges: [[R, 0, H / 2]], ...(cmd === 'solid.fillet' ? { radius: d } : { distance: d }), body: 'c' } }];
  const t0 = Date.now(); const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); const ms = Date.now() - t0;
  if (!r.ok) return `R${R} H${H} ${cmd.slice(6)} d${d}: REFUSED ${r.failed?.error ?? r.error}`;
  const b = r.measure.bodies[0]; const bb = b.bbox; const ex = [0, 1, 2].map((i) => bb.max[i] - bb.min[i]);
  const err = Math.max(Math.abs(ex[0] - 2 * R) / (2 * R), Math.abs(ex[1] - 2 * R) / (2 * R), Math.abs(ex[2] - H) / H);
  return `R${R} H${H} ${cmd.slice(6)} d${d}: bbox extents ${ex.map((v) => v.toFixed(4)).join(' x ')} (true ${2 * R} x ${2 * R} x ${H}) worst bbox error ${err.toExponential(2)}; volume ${b.volume_mm3.toFixed(4)}; ${ms} ms`;
};
const out = [];
for (const [R, H] of [[15, 20], [10, 20]]) for (const cmd of ['solid.chamfer', 'solid.fillet']) for (const f of [0.9, 0.99, 0.993, 0.995, 0.997, 0.998, 0.999, 0.9993]) { const l = run(R, H, cmd, +(R * f).toFixed(4)); console.log(l); out.push(l); }
