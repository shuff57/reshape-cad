// Raw truck probe with EXACT edge picks: the four rim edges of a 30x20x6 pocket in a 40x30x10 plate blended one after the other (what a resolver that relaxed the
// "edge touched" refusal would send). The rig's r3-rim-* cases are NOT this: its pick-retry loop re-aimed the second pick to [38.18,15,10] (the plate's outer edge at x=40).
// Independent closed form (chamfer): 8400 - P d^2/2 - 4 d^3/3 (P = 100 the rim length, the corner term is the pyramid the mitre adds at each of the 4 corners); brep-rs agrees.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rim-probe.mjs > rim-probe.txt
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const pre = [
  { command: 'sketch.create', params: { name: 'a', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: [[0, 0], [40, 0], [40, 30], [0, 30]], closed: true } }, { command: 'sketch.finish', params: {} },
  { command: 'solid.extrude', params: { distance: 10, sketch: 'a', operation: 'new', body_name: 'p' } },
  { command: 'sketch.create', params: { name: 'b', plane: { origin: [0, 0, 10], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: [[5, 5], [35, 5], [35, 25], [5, 25]], closed: true } }, { command: 'sketch.finish', params: {} },
  { command: 'solid.extrude', params: { distance: -6, sketch: 'b', operation: 'new', body_name: 't' } },
  { command: 'solid.combine', params: { target: 'p', tools: ['t'], operation: 'cut' } }];
const picks = [[20, 5, 10], [35, 15, 10], [20, 25, 10], [5, 15, 10]];
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const base = run(pre).measure.bodies[0];
console.log(`plate with pocket: volume ${base.volume_mm3} faces ${base.faces}`);
for (const cmd of ['solid.chamfer', 'solid.fillet']) for (const d of [1, 2, 3]) {
  const cmds = [...pre]; let last = null;
  for (let k = 0; k < 4; k++) {
    cmds.push({ command: cmd, params: { edges: [picks[k]], ...(cmd === 'solid.fillet' ? { radius: d } : { distance: d }), body: 'p' } });
    const t0 = Date.now(); const r = run(cmds); const ms = Date.now() - t0;
    if (!r.ok) { console.log(`${cmd.slice(6)} ${d}: edge ${k + 1} of 4 [${picks[k]}] REFUSED ${r.failed?.error} (${ms} ms)`); last = null; break; }
    last = r.measure.bodies.find((b) => b.name === 'p'); console.log(`${cmd.slice(6)} ${d}: after edge ${k + 1}: volume ${last.volume_mm3.toFixed(4)} faces ${last.faces} (${ms} ms)`);
  }
  if (last && cmd === 'solid.chamfer') { const cf = 8400 - 100 * d * d / 2 - 4 * d ** 3 / 3; console.log(`   closed form ${cf.toFixed(4)}  truck ${last.volume_mm3.toFixed(4)}  rel ${(Math.abs(last.volume_mm3 - cf) / cf).toExponential(2)}`); }
}
