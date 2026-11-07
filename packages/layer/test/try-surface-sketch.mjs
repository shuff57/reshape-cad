#!/usr/bin/env node
// Try a surface sketch in a running SolidCraft app (a dev tool, not part of `npm test`).
//
//   node packages/layer/test/try-surface-sketch.mjs <surface> <shape> [options]
//
//   surface   cylinder | sphere | wavy | corner[:<deg>[:inside]]        (corner default 90, outside)
//   shape     circle:<r> | rect:<w>:<h> | slot:<length>:<r> | ellipse:<a>:<b>
//   --at      where the sketch's centre goes:
//               cylinder  <angle deg>,<height mm>   (default 0,20)
//               sphere    <latitude>,<longitude>    (default 90,0 = the top)
//               wavy      <x>,<y>                   (default 0,0; the face spans -20..20)
//               corner    <distance>,<along>        (centre's distance from the edge, negative on the flat top,
//                                                    positive over the edge; default 0,0 = on the edge; along -20..20)
//   --turn    <deg>   turn the sketch about its centre (default 0)
//   --op      cut | raise | mark   (default cut)
//   --depth   <mm>    depth or height (default 1)
//   --square          measure the depth square to the surface (cylinder and sphere only)
//   --stretch <pct>   allow this much stretch on a sphere or a wavy face (default 1)
//   --new             start a new design with the starter part even if the window already has one
//   --port <n>        the app's control port (default: the last app started, control/current.port)
//   --cli <path>      solidcraft-cli of the SAME version as the app (default $SOLIDCRAFT_CLI)
//
// It builds the starter part when the window has no such body, plans the sketch with the layer, applies it inside an
// app checkpoint, measures the result in the app, and keeps it only if it matches the layer's prediction; otherwise
// the design goes back to the checkpoint and the layer's refusal sentence is printed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { planSurfaceSketch, verifySurfaceSketch, shapes, fitHeight, surfaceRefusal } from '../dist/surface-sketch.js';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--square', '--new'].includes(argv[i - 1])));
if (pos.length < 2) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(1); }
const [surfaceArg, shapeArg] = pos;
const CLI = opt('cli', process.env.SOLIDCRAFT_CLI);
if (!CLI) { console.error('give --cli <solidcraft-cli> (the same version as the app) or set SOLIDCRAFT_CLI'); process.exit(1); }
const ctlDir = path.join(process.env.HOME, '.local/share/solidcraft/control');
const PORT = opt('port', fs.existsSync(path.join(ctlDir, 'current.port')) ? fs.readFileSync(path.join(ctlDir, 'current.port'), 'utf8').trim() : '27878');
const rad = (d) => (d * Math.PI) / 180;
const num = (s) => s.split(',').map(Number);

// ------------------------------------------------------------------ the app, through solidcraft-cli mcp
const mcp = spawn(CLI, ['mcp', '--connect', `127.0.0.1:${PORT}`], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', nextId = 1;
const waiting = new Map();
mcp.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  }
});
const rpc = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
async function tool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) throw new Error(r.error.message);
  const text = r.result.content.find((c) => c.type === 'text')?.text ?? '';
  let val; try { val = JSON.parse(text); } catch { val = text; }
  if (r.result.isError) throw new Error(typeof val === 'string' ? val : JSON.stringify(val));
  return val;
}
const exec = (command, params = {}) => tool('execute', { command, params, verbose: false });

// ------------------------------------------------------------------ starter parts
const WH = (x, y) => 20 + 2 * Math.sin(x / 6) + 1.5 * Math.sin(y / 5 + x / 11) + 0.8 * Math.cos((x * y) / 150);
function starter(surface) {
  const [kind, degS, side] = surface.split(':');
  if (kind === 'cylinder') return { body: 'c', base: [{ command: 'solid.cylinder', params: { radius: 20, height: 40, body_name: 'c' } }], target: { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 20, extent: [0, 40] } };
  if (kind === 'sphere') return { body: 'b', base: [{ command: 'solid.sphere', params: { radius: 30, body_name: 'b' } }], target: { kind: 'sphere', center: [0, 0, 0], radius: 30 } };
  if (kind === 'wavy') {
    const ys = [-20, -12, -4, 4, 12, 20], base = [];
    ys.forEach((y, k) => {
      base.push({ command: 'sketch.create', params: { name: `w${k}`, plane: { origin: [0, y, 0], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } });
      base.push({ command: 'sketch.line', params: { points: [[-20, WH(-20, y)], [-20, 0], [20, 0], [20, WH(20, y)]] } });
      base.push({ command: 'sketch.spline.fit_point', params: { points: Array.from({ length: 11 }, (_, i) => { const x = 20 - 4 * i; return [x, WH(x, y)]; }) } });
      base.push({ command: 'sketch.finish', params: {} });
    });
    base.push({ command: 'solid.loft', params: { sections: ys.map((_, k) => ({ sketch: `w${k}` })), body_name: 'w' } });
    return { body: 'w', base, wavy: true };
  }
  if (kind === 'corner') {
    const deg = Number(degS ?? 90), convex = side !== 'inside', p = rad(deg);
    const mB = convex ? [-Math.cos(p), -Math.sin(p)] : [-Math.cos(p), Math.sin(p)];
    const nB = convex ? [Math.sin(p), -Math.cos(p)] : [-Math.sin(p), -Math.cos(p)];
    const B = [30 * mB[0], 30 * mB[1]];
    const poly = convex
      ? [[0, 0], [-30, 0], [-30, -40], ...(B[1] > -40 ? [[B[0], -40]] : []), B]
      : [[-30, 0], [0, 0], B, [B[0] - 15 * nB[0], B[1] - 15 * nB[1]], [Math.max(B[0] - 15 * nB[0], 1), -20], [-30, -20]];
    return {
      body: 'k',
      base: [
        { command: 'sketch.create', params: { name: 'k_profile', plane: { origin: [0, 20, 0], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
        { command: 'sketch.line', params: { points: poly, closed: true } },
        { command: 'sketch.finish', params: {} },
        { command: 'solid.extrude', params: { sketch: 'k_profile', distance: 40, operation: 'new', body_name: 'k' } },
      ],
      target: { kind: 'corner', edgePoint: [0, 0, 0], edgeDir: [0, 1, 0], normalA: [0, 0, 1], normalB: [nB[0], 0, nB[1]], pointB: [15 * mB[0], 0, 15 * mB[1]], extentA: { along: [-20, 20], away: 30 }, extentB: { along: [-20, 20], away: 30 } },
    };
  }
  throw new Error(`unknown surface ${surface}`);
}
function shapeOf(s) {
  const [k, a, b] = s.split(':'), A = Number(a), B = Number(b);
  if (k === 'circle') return shapes.circle([0, 0], A);
  if (k === 'rect') return shapes.rect(-A / 2, -B / 2, A / 2, B / 2);
  if (k === 'slot') return shapes.slot([0, 0], A, B);
  if (k === 'ellipse') return shapes.ellipse([0, 0], A, B);
  throw new Error(`unknown shape ${s}`);
}
function placement(surface, at, turn) {
  const kind = surface.split(':')[0], t = rad(turn);
  if (kind === 'cylinder') {
    const [ang, z] = at ? num(at) : [0, 20], a = rad(ang);
    const round = [-Math.sin(a), Math.cos(a), 0];
    return { anchor: [25 * Math.cos(a), 25 * Math.sin(a), z], xDir: [round[0] * Math.cos(t), round[1] * Math.cos(t), Math.sin(t)] };
  }
  if (kind === 'sphere') {
    const [lat, lon] = at ? num(at) : [90, 0], la = rad(lat), lo = rad(lon);
    const n = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    let east = [-Math.sin(lo), Math.cos(lo), 0];
    if (Math.abs(lat) > 89.9) east = [1, 0, 0];
    const north = [n[1] * east[2] - n[2] * east[1], n[2] * east[0] - n[0] * east[2], n[0] * east[1] - n[1] * east[0]];
    return { anchor: n.map((v) => v * 40), xDir: east.map((v, i) => v * Math.cos(t) + north[i] * Math.sin(t)) };
  }
  if (kind === 'wavy') { const [x, y] = at ? num(at) : [0, 0]; return { anchor: [x, y, 20], xDir: [Math.cos(t), Math.sin(t), 0] }; }
  const [d, along] = at ? num(at) : [0, 0];
  // the sketch's x axis points across the edge; its centre sits `d` from the edge (negative: on the flat top)
  return { anchor: [Math.min(d, -0.5), along, 0], xDir: [Math.cos(t), Math.sin(t), 0], shift: d < -0.5 ? 0 : d + 0.5 };
}

// ------------------------------------------------------------------ run
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reshape-surface-sketch', version: '0' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const st = starter(surfaceArg);
  const bodies = (await tool('measure', { summary: true })).bodies ?? [];
  if (flag('new') || !bodies.some((b) => b.name === st.body)) {
    console.log(`starting a new design with the ${surfaceArg} starter part`);
    await tool('new_design', { name: `surface sketch ${surfaceArg}` });
    const r = await tool('batch', { commands: st.base, verbose: false });
    if (r.ok === false) throw new Error(`the starter part did not build: ${JSON.stringify(r.failed)}`);
    await tool('screenshot', { view: 'iso' }).catch(() => {});
  }
  let target = st.target, fit;
  if (st.wavy) {
    const faces = (await exec('model.faces', { body: st.body })).faces.filter((f) => !f.plane_normal && f.centroid[2] > 10);
    const sample = async (count) => (await Promise.all(faces.map((f) => exec('inspect.isocurve', { faces: [f.point], count })))).flatMap((r) => r.curves.flat());
    const pts = await sample(30), held = await sample(17);
    const f = fitHeight(pts, { origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0] }, 1);
    let ho = 0;
    for (const p of held) if (p[0] >= f.bounds.x[0] && p[0] <= f.bounds.x[1] && p[1] >= f.bounds.y[0] && p[1] <= f.bounds.y[1]) ho = Math.max(ho, Math.abs(p[2] - 20 - f.height(p[0], p[1]).z));
    target = { kind: 'graph', origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0], height: f.height, bounds: { x: [f.bounds.x[0] + 0.5, f.bounds.x[1] - 0.5], y: [f.bounds.y[0] + 0.5, f.bounds.y[1] - 0.5] } };
    fit = { maxResidual: Math.max(f.maxResidual, ho) };
    console.log(`measured the wavy face: ${pts.length} points, fit within ${(fit.maxResidual * 1000).toFixed(2)} um`);
  }
  const pl = placement(surfaceArg, opt('at'), Number(opt('turn', '0')));
  let loop = shapeOf(shapeArg);
  if (pl.shift) loop = { ...loop, pieces: loop.pieces.map((p) => ({ points: p.points.map(([x, y]) => [x + pl.shift, y]) })) };
  const opName = opt('op', 'cut'), depth = Number(opt('depth', '1'));
  const op = opName === 'mark' ? { op: 'imprint' } : { op: opName, ...(opName === 'cut' ? { depth } : { height: depth }), floor: flag('square') ? 'normal' : 'view' };
  const id = `surface${Date.now() % 100000}`;
  const plan = planSurfaceSketch({ body: st.body, target, placement: { anchor: pl.anchor, xDir: pl.xDir }, loops: [loop], op, id, fit, maxStretch: Number(opt('stretch', '1')) / 100 });
  if (!plan.ok) { console.log(`REFUSED: ${plan.refusal}`); process.exit(2); }

  const vol = async () => (await tool('measure', { summary: true })).bodies.find((b) => b.name === st.body)?.volume_mm3;
  const edges = async () => (await exec('model.edges', { body: st.body })).edges;
  const before = { v: await vol(), e: op.op === 'imprint' ? await edges() : undefined };
  const checkpoint = (await exec('edit.checkpoint')).checkpoint;
  const r = await tool('batch', { commands: plan.commands, verbose: false });
  if (r.ok === false) {
    console.log(`REFUSED: ${surfaceRefusal(id, op.op, 'kernel')}\n  (the app said: ${String(r.failed?.error ?? '').split('\n')[0].slice(0, 200)})`);
    process.exit(2);
  }
  const after = { v: await vol(), e: op.op === 'imprint' ? await edges() : undefined };
  const v = verifySurfaceSketch({ prediction: plan.prediction, volumeBefore: before.v, volumeAfter: after.v, edgesBefore: before.e, edgesAfter: after.e });
  const extra = (await tool('measure', { summary: true })).bodies.filter((b) => b.name !== st.body && !bodies.some((x) => x.name === b.name));
  if (!v.ok || extra.length) {
    await exec('edit.restore_checkpoint', { checkpoint });
    console.log(`REFUSED: ${surfaceRefusal(id, op.op, 'mismatch')}\n  (${v.ok ? 'it left extra bodies' : v.reason}; the design is back as it was)`);
    process.exit(2);
  }
  // tidy: hide the flat shadow sketch the kernel was given
  const sk = plan.commands.filter((c) => c.command === 'sketch.create').map((c) => c.params.name);
  await exec('browser.visibility', { items: sk, visible: false }).catch(() => {});
  const m = v.measured;
  console.log(`BUILT ${id}: ${m.relError !== undefined ? `volume changed ${m.volumeDelta.toFixed(4)} mm3, predicted ${m.predicted.toFixed(4)} (off by ${m.relError.toExponential(1)})` : `${m.markedEdges} edges on the outline, ${m.markedLength.toFixed(3)} of ${m.predictedLength.toFixed(3)} mm`}`);
  if (plan.prediction.stretch > 0) console.log(`  stretch across the sketch: ${(plan.prediction.stretch * 100).toFixed(2)}%`);
  for (const n of plan.notes) console.log(`  ${n}`);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
} finally {
  mcp.stdin.end();
  setTimeout(() => process.exit(), 300);
}
