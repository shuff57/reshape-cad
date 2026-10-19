// SPIKE, referee only (booleans group, round 4 / critic round 2). Raw SolidCraft command builders + a timing child, for the kernel-slowness model.
// One timing = ONE sc.run of a command list in a fresh child process (fresh wasm instance), cpu seconds from process.cpuUsage, with an rlimit on CPU so a runaway is killed.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const isZ = (v) => !v || v.every((x) => !x);
const rotc = (name, rot) => (isZ(rot) ? [] : ['x', 'y', 'z'].flatMap((a, i) => (rot[i] ? [{ command: 'solid.move', params: { bodies: [name], axis: AX[a], angle: rot[i] } }] : [])));
const mv = (name, c) => (isZ(c) ? [] : [{ command: 'solid.move', params: { bodies: [name], translate: c } }]);
/** a primitive as the phase0 translator builds it: made at the origin when turned, turned about the ORIGIN (x, y, z), then moved to `c` */
export function prim(kind, name, p, rot, c = [0, 0, 0]) {
  const at = isZ(rot) ? c : [0, 0, 0];
  let cmds;
  if (kind === 'box') cmds = [{ command: 'solid.box', params: { length: p.size[0], width: p.size[1], height: p.size[2], center: at, body_name: name } }];
  else if (kind === 'cylinder') cmds = [{ command: 'solid.cylinder', params: { radius: p.radius, height: p.height, base: [at[0], at[1], at[2] - p.height / 2], axis: 'Z', body_name: name } }];
  else if (kind === 'sphere') cmds = [{ command: 'solid.sphere', params: { radius: p.radius, center: at, body_name: name } }];
  else if (kind === 'torus') cmds = [{ command: 'solid.torus', params: { major: p.ringRadius, minor: p.tubeRadius, center: at, body_name: name } }];
  else if (kind === 'cone') cmds = [{ command: 'sketch.create', params: { name: `sk_${name}`, plane: { origin: [at[0], at[1], at[2] - p.height / 2], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } }, { command: 'sketch.line', params: { points: [[0, 0], [p.radius, 0], [0, p.height]], closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.revolve', params: { axis: 'y', sketch: `sk_${name}`, operation: 'new', body_name: name } }];
  else if (kind === 'prism' || kind === 'wedge') {
    const poly = kind === 'prism' ? Array.from({ length: p.sides }, (_, i) => [p.radius * Math.cos(2 * Math.PI * i / p.sides), p.radius * Math.sin(2 * Math.PI * i / p.sides)]) : [[-p.width / 2, -p.depth / 2], [p.width / 2, -p.depth / 2], [-p.width / 2, p.depth / 2]];
    cmds = [{ command: 'sketch.create', params: { name: `sk_${name}`, plane: { origin: [at[0], at[1], at[2] - p.height / 2], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: poly, closed: true } }, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: p.height, sketch: `sk_${name}`, operation: 'new', body_name: name } }];
  } else throw new Error('kind ' + kind);
  if (!isZ(rot)) cmds.push(...rotc(name, rot), ...mv(name, c));
  return cmds;
}
export const combine = (op, target, tools) => ({ command: 'solid.combine', params: { target, tools, operation: op } });   // op: join | cut | intersect

/** time ONE sc.run in a fresh child; cpuLimitS = rlimit on cpu seconds (the child dies of SIGXCPU) */
export function timeRun(commands, { cpuLimitS = 60, wallLimitS = 400, cpu = null } = {}) {
  const f = path.join(os.tmpdir(), `cost-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(commands));
  const load1 = +os.loadavg()[0].toFixed(1);
  const t0 = Date.now();
  const pin = cpu === null ? '' : `taskset -c ${cpu} `;   // cpu: pin the child to one logical cpu (the slow-down experiment pins it next to a busy sibling thread)
  const r = spawnSync('sh', ['-c', `ulimit -t ${cpuLimitS}; exec ${pin}"$0" "$@"`, process.execPath, fileURLToPath(import.meta.url), `--one=${f}`], { encoding: 'utf8', timeout: wallLimitS * 1000, env: process.env, maxBuffer: 1 << 26 });
  const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@LAT@@')).pop();
  const wallS = +((Date.now() - t0) / 1000).toFixed(1);
  if (line) return { ...JSON.parse(line.slice(7)), wallS, load1 };
  return { ok: false, killed: true, cpuLimitS, wallS, load1, signal: r.signal ?? null, status: r.status };
}
/** the calibration job: a vertical r6 cylinder through a 30 mm cube, cut. cpu seconds of it, measured right before a timed job, is the load / machine-speed unit */
export const CAL_CMDS = [...prim('box', 'A', { size: [30, 30, 30] }, null), ...prim('cylinder', 'B', { radius: 6, height: 50 }, null), combine('cut', 'A', ['B'])];
export function timeCal(opts = {}) { const r = timeRun(CAL_CMDS, { cpuLimitS: 30, ...opts }); return r.ok ? r.cpuS : null; }
/** timed job normalised by a calibration run just before it: ratio = cpu / cal (a load-robust cost in 'calibration units') */
export function timeRunCal(commands, opts = {}) { const cal = timeCal({ cpu: opts.cpu ?? null }); const r = timeRun(commands, opts); return { ...r, calS: cal, ratio: r.ok && cal ? +(r.cpuS / cal).toFixed(1) : null }; }
if (process.argv.some((a) => a.startsWith('--one=')) && import.meta.main !== false && process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmds = JSON.parse(readFileSync(process.argv.find((a) => a.startsWith('--one=')).slice(6), 'utf8'));
  const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
  const c0 = process.cpuUsage(); const w0 = Date.now(); let out;
  try {
    const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
    const c1 = process.cpuUsage(c0);
    out = { ok: r.ok, cpuS: +((c1.user + c1.system) / 1e6).toFixed(2), wallS: +((Date.now() - w0) / 1000).toFixed(2), error: r.ok ? undefined : r.failed?.error?.slice(0, 160), bodies: r.ok ? r.measure.bodies.map((b) => ({ n: b.name, v: +b.volume_mm3.toFixed(3), f: b.faces })) : undefined };
  } catch (e) { out = { ok: false, trap: true, error: String(e.message).slice(0, 160) }; }
  console.log('@@LAT@@' + JSON.stringify(out));
}
