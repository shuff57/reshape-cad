// Surface sketch panel: pick a curved face (or the edge of a corner) in a running SolidCraft app, then cut, raise or
// mark a sketch wrapped onto it from a small page beside the app. A dev tool on our side of the seam: SolidCraft is
// driven only through its control port (solidcraft-cli mcp --connect), never patched.
//
//   node packages/layer/tools/surface-panel/server.mjs [--port <app control port> | headless] [--cli <solidcraft-cli>] [--http 5178]
//   then open http://127.0.0.1:5178
//   node .../server.mjs --port <p> --once '<json>'   one feature, for SolidCraft's Wrap Sketch dialog (local patch)
//
// Every feature is checked the layer's way: planned by planSurfaceSketch, applied inside an app checkpoint, measured
// in the app and kept only when it matches the prediction; otherwise the design goes back and the refusal is shown.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { planSurfaceSketch, verifySurfaceSketch, shapes, fitHeight, surfaceRefusal, surfaceMap, mapLoops, cornerFrame } from '../../dist/surface-sketch.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const CLI = opt('cli', process.env.SOLIDCRAFT_CLI);
if (!CLI) { console.error('give --cli <solidcraft-cli> (the same version as the app) or set SOLIDCRAFT_CLI'); process.exit(1); }
const ctlDir = path.join(process.env.HOME, '.local/share/solidcraft/control');
const APP_PORT = opt('port', fs.existsSync(path.join(ctlDir, 'current.port')) ? fs.readFileSync(path.join(ctlDir, 'current.port'), 'utf8').trim() : '27878');
const HTTP_PORT = Number(opt('http', '5178'));
const PREVIEW = 'surface_preview';

// ------------------------------------------------------------------ vectors
const V = {
  add: (a, b) => a.map((v, i) => v + b[i]), sub: (a, b) => a.map((v, i) => v - b[i]), mul: (a, k) => a.map((v) => v * k),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
};
V.unit = (a) => V.mul(a, 1 / V.len(a));
V.perp = (a, n) => V.sub(a, V.mul(n, V.dot(a, n)));
const rotAbout = (v, k, ang) => V.add(V.add(V.mul(v, Math.cos(ang)), V.mul(V.cross(k, v), Math.sin(ang))), V.mul(k, V.dot(k, v) * (1 - Math.cos(ang))));
const rad = (d) => (d * Math.PI) / 180;

// ------------------------------------------------------------------ the app, through solidcraft-cli mcp (one call at a time)
let mcp, buf = '', nextId = 1, ready = null;
const waiting = new Map();
function start() {
  mcp = spawn(CLI, APP_PORT === 'headless' ? ['mcp', '--headless'] : ['mcp', '--connect', `127.0.0.1:${APP_PORT}`], { stdio: ['pipe', 'pipe', 'inherit'] });
  buf = '';
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
  mcp.on('exit', () => { ready = null; for (const r of waiting.values()) r({ error: { message: 'solidcraft-cli exited' } }); waiting.clear(); });
  const rpc0 = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  ready = rpc0('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reshape-surface-panel', version: '0' } })
    .then(() => mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'));
  return ready;
}
const rpc = async (method, params) => { if (!ready) start(); await ready; return new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); };
async function tool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) throw new Error(r.error.message);
  const text = r.result.content.find((c) => c.type === 'text')?.text ?? '';
  let val; try { val = JSON.parse(text); } catch { val = text; }
  if (r.result.isError) throw new Error(typeof val === 'string' ? val : JSON.stringify(val));
  return val;
}
const exec = (command, params = {}) => tool('execute', { command, params, verbose: false });
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

// ------------------------------------------------------------------ reading the picked surface
const samplesOf = async (point, count) => (await exec('inspect.isocurve', { faces: [point], count })).curves.flat();
const clearIso = (point) => exec('inspect.isocurve', { faces: [point], clear: true }).catch(() => {});

/** Is `q` inside `body`? A 0.05 mm probe ball with the body cut away, inside a checkpoint: what is left of it says.
 *  (A cut, not an intersection: an outside probe, the usual case, then leaves the app nothing to complain about.) */
async function inside(body, q) {
  const cp = (await exec('edit.checkpoint')).checkpoint;
  try {
    const r = await tool('batch', { verbose: false, commands: [
      { command: 'solid.sphere', params: { radius: 0.05, center: q, operation: 'new', body_name: '__probe' } },
      { command: 'solid.combine', params: { target: '__probe', tools: [body], operation: 'cut', keep_tools: true } },
    ] }).catch(() => ({ ok: false }));
    // the cut refused: nothing of the probe was left, so it was wholly inside
    if (r.ok === false) return true;
    const b = (await tool('measure', { summary: true })).bodies.find((x) => x.name === '__probe');
    const full = (4 / 3) * Math.PI * 0.05 ** 3;
    return !b || (b.volume_mm3 ?? 0) < 0.5 * full;
  } finally { await exec('edit.restore_checkpoint', { checkpoint: cp }); }
}

function sphereFit(pts) {
  // |p|^2 = 2 c.p + k, least squares in (c, k)
  const A = Array.from({ length: 4 }, () => new Array(5).fill(0));
  for (const p of pts) {
    const row = [2 * p[0], 2 * p[1], 2 * p[2], 1], y = V.dot(p, p);
    for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; A[i][4] += row[i] * y; }
  }
  for (let i = 0; i < 4; i++) {
    let piv = i; for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    for (let r = 0; r < 4; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 5; c++) A[r][c] -= f * A[i][c]; }
  }
  const c = [A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2]];
  const r = Math.sqrt(A[3][4] / A[3][3] + V.dot(c, c));
  return { center: c, radius: r, residual: Math.max(...pts.map((p) => Math.abs(V.len(V.sub(p, c)) - r))) };
}

function pcaNormal(pts) {
  const c = V.mul(pts.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / pts.length);
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = V.sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j]; }
  // smallest eigenvector: inverse iteration on M + tiny shift
  let v = [0.3, 0.5, 0.8];
  const solve = (B, b) => { const a = B.map((r, i) => [...r, b[i]]); for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r; [a[i], a[p]] = [a[p], a[i]]; for (let r = 0; r < 3; r++) if (r !== i) { const f = a[r][i] / a[i][i]; for (let k = i; k < 4; k++) a[r][k] -= f * a[i][k]; } } return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]]; };
  const tr = M[0][0] + M[1][1] + M[2][2], B = M.map((r, i) => r.map((x, j) => x + (i === j ? 1e-9 * tr + 1e-12 : 0)));
  for (let k = 0; k < 30; k++) v = V.unit(solve(B, v));
  return v;
}

/** Turn the app's selection into a surface target the layer can plan on, or a sentence saying why not. */
async function recognise(sel, sideB, recipe) {
  if (!sel || sel.length !== 1) return { refusal: 'Select one curved face, or one edge where two flat faces meet, then press Use selection.' };
  const s = sel[0], body = s.body;
  // a surface sketch's recipe: the surface as it was read when the sketch started (no probing again)
  if (recipe?.target) return { body, label: recipe.label, target: recipe.target, anchor: s.point, normal: recipe.normal, xDir: recipe.xDir };
  if (recipe?.kind === 'graph') return freeform(body, s.point, recipe.normal, true);
  if (s.type === 'face') {
    const f = (await exec('model.faces', { body })).faces.find((x) => x.index === s.index);
    if (!f) return { refusal: 'The selected face was not found on its body.' };
    const p = s.point ?? f.point;
    if (f.plane_normal) return { refusal: 'That face is flat: an ordinary sketch works there. For a corner, select the edge between the two flat faces.' };
    if (f.cylinder) {
      const { origin, radius } = f.cylinder, axis = V.unit(f.cylinder.axis);
      const pts = await samplesOf(f.point, 6); await clearIso(f.point);
      const ts = pts.map((q) => V.dot(V.sub(q, origin), axis));
      const extent = [Math.min(...ts), Math.max(...ts)];
      const rhat = V.unit(V.perp(V.sub(p, origin), axis));
      if (await inside(body, V.add(p, V.mul(rhat, 0.3)))) return { refusal: 'That is the inside of a hole; surface sketches go on the outside of a cylinder for now.' };
      return { body, label: `cylinder, radius ${radius.toFixed(2)} mm, on ${body}`, target: { kind: 'cylinder', origin, axis, radius, extent }, anchor: p, normal: rhat, xDir: V.cross(axis, rhat) };
    }
    const m = (await tool('measure', { items: [{ type: 'face', body, point: f.point }] })).items?.[0] ?? {};
    if (m.surface === 'sphere') {
      const pts = await samplesOf(f.point, 8); await clearIso(f.point);
      const sf = sphereFit(pts);
      if (sf.residual > 2e-3 || Math.abs(sf.radius - m.radius) > 2e-3) return { refusal: `The sphere could not be located to 2 um (off by ${(sf.residual * 1000).toFixed(1)} um).` };
      const n = V.unit(V.sub(p, sf.center));
      if (await inside(body, V.add(p, V.mul(n, 0.3)))) return { refusal: 'That is the inside of a spherical pocket; surface sketches go on the outside of a sphere for now.' };
      let east = V.cross([0, 0, 1], n); east = V.len(east) < 1e-6 ? [1, 0, 0] : V.unit(east);
      return { body, label: `sphere, radius ${m.radius.toFixed(2)} mm, on ${body}`, target: { kind: 'sphere', center: sf.center, radius: m.radius }, anchor: p, normal: n, xDir: east };
    }
    const own = await samplesOf(f.point, 30);
    const nearOwn = own.filter((q) => V.len(V.sub(q, p)) < 4);
    if (nearOwn.length < 6) { await clearIso(f.point); return { refusal: 'Too few points of that face near the pick to read its shape; pick nearer the middle of the face.' }; }
    return freeform(body, p, pcaNormal(nearOwn), false, f, own);
  }
  return recogniseEdge(s, body, sideB);
}

/** A freeform face: a height field over the plane touching it at `p`, measured from the app's own face points. A
 *  freeform surface is often several faces joined smoothly (a loft between sections): every curved face of the body
 *  that faces the way `n0` does is measured; the crop keeps what is near `p`, and the fit check refuses a surface
 *  that is not smooth. `known`: `n0` is the outward normal already (a surface sketch's recipe), no probing. */
async function freeform(body, p, n0, known, f, own) {
  {
    const cand = (await exec('model.faces', { body })).faces.filter((x) => !x.plane_normal && !x.cylinder);
    // keep the faces that face the same way as the picked one (a side wall of the part does not)
    const curved = [], sets = new Map();
    for (const x of cand) {
      const pts = f && x.index === f.index ? own : await samplesOf(x.point, 30);
      if ((f && x.index === f.index) || (pts.length >= 6 && Math.abs(V.dot(pcaNormal(pts), n0)) > 0.7)) { curved.push(x); sets.set(x.index, pts); }
    }
    if (!curved.length) return { refusal: 'The curved face of that surface sketch is gone.' };
    const sampleAll = async (k) => (k === 30 ? [...sets.values()] : await Promise.all(curved.map((x) => samplesOf(x.point, k)))).flat();
    const clearAll = () => clearIso(curved[0].point);
    const all = await sampleAll(30);
    const near = all.filter((q) => V.len(V.sub(q, p)) < 4);
    if (near.length < 6) { await clearAll(); return { refusal: 'Too few points of that face near the pick to read its shape; pick nearer the middle of the face.' }; }
    let N = pcaNormal(near);
    if (known ? V.dot(N, n0) < 0 : await inside(body, V.add(p, V.mul(N, 0.3)))) N = V.mul(N, -1);
    let X = V.perp([1, 0, 0], N); if (V.len(X) < 0.3) X = V.perp([0, 1, 0], N); X = V.unit(X);
    const Y = V.cross(N, X), H = 16;
    const crop = (pts) => pts.filter((q) => { const r = V.sub(q, p); return Math.abs(V.dot(r, X)) <= H && Math.abs(V.dot(r, Y)) <= H && Math.abs(V.dot(r, N)) <= 10; });
    const pts = crop(all), held = crop(await sampleAll(17)); await clearAll();
    let fh;
    try { fh = fitHeight(pts, { origin: p, x: X, y: Y }, 1); } catch (e) { return { refusal: `That face could not be measured near the pick (${e.message}).` }; }
    let ho = 0;
    for (const q of held) { const r = V.sub(q, p), x = V.dot(r, X), y = V.dot(r, Y); if (x >= fh.bounds.x[0] && x <= fh.bounds.x[1] && y >= fh.bounds.y[0] && y <= fh.bounds.y[1]) ho = Math.max(ho, Math.abs(V.dot(r, N) - fh.height(x, y).z)); }
    const target = { kind: 'graph', origin: p, x: X, y: Y, height: fh.height, bounds: { x: [fh.bounds.x[0] + 0.5, fh.bounds.x[1] - 0.5], y: [fh.bounds.y[0] + 0.5, fh.bounds.y[1] - 0.5] } };
    return { body, label: `freeform surface on ${body} (${curved.length} face${curved.length > 1 ? 's' : ''}), measured from ${pts.length} points, held to ${(Math.max(fh.maxResidual, ho) * 1000).toFixed(2)} um`, target, fit: { maxResidual: Math.max(fh.maxResidual, ho) }, anchor: p, normal: N, xDir: X };
  }
}

async function recogniseEdge(s, body, sideB) {
  if (s.type === 'edge') {
    const e = (await exec('model.edges', { body })).edges.find((x) => x.index === s.index);
    if (!e) return { refusal: 'The selected edge was not found on its body.' };
    const names = String(e.name ?? '').split('|');
    const faces = (await exec('model.faces', { body })).faces;
    const fs2 = names.map((n) => faces.find((f) => f.name === n));
    if (fs2.length !== 2 || fs2.some((f) => !f)) return { refusal: 'The faces either side of that edge could not be found.' };
    if (fs2.some((f) => !f.plane_normal)) return { refusal: 'A corner needs two flat faces meeting on a straight edge; one side of that edge is curved.' };
    const [A, B] = sideB ? [fs2[1], fs2[0]] : fs2;
    const dir = V.unit(V.sub(e.end, e.start)), P = e.start;
    // is the edge straight? its midpoint lies on the chord
    if (V.len(V.perp(V.sub(e.mid, P), dir)) > 1e-4) return { refusal: 'That edge is not straight.' };
    const awayOf = async (f) => {
      const pts = await samplesOf(f.point, 6); await clearIso(f.point);
      const nA = V.unit(V.perp(f.plane_normal, dir)); let m = V.cross(dir, nA);
      if (V.dot(V.sub(f.point, P), m) < 0) m = V.mul(m, -1);
      return { m, away: Math.max(...pts.map((q) => V.dot(V.sub(q, P), m))) };
    };
    const a = await awayOf(A), b = await awayOf(B);
    const along = [0, e.length];
    const pick = s.point ?? e.mid;
    const onEdge = V.add(P, V.mul(dir, Math.min(e.length, Math.max(0, V.dot(V.sub(pick, P), dir)))));
    const target = { kind: 'corner', edgePoint: P, edgeDir: dir, normalA: A.plane_normal, normalB: B.plane_normal, pointB: V.add(onEdge, V.mul(b.m, Math.min(5, b.away / 2))), extentA: { along, away: a.away }, extentB: { along, away: b.away } };
    const fr = cornerFrame(target, V.add(onEdge, V.mul(a.m, 1)));
    // the anchor sits just inside face A; the sketch is shifted back so its centre is on the edge
    return { body, label: `${fr.convex ? 'outside' : 'inside'} corner, ${fr.angleDeg.toFixed(1)} deg, on ${body} (sketch starts on ${A.name})`, target, anchor: V.add(onEdge, V.mul(a.m, 0.5)), shift: 0.5, normal: fr.nA, xDir: V.mul(a.m, -1), corner: true };
  }
  return { refusal: 'Select a curved face, or the edge between two flat faces.' };
}

// ------------------------------------------------------------------ the sketch: outline, placement, preview
function loopOf(q) {
  const A = Number(q.a), B = Number(q.b);
  if (!(A > 0)) throw new Error('give the shape a size');
  let l;
  if (q.shape === 'circle') l = shapes.circle([0, 0], A);
  else if (q.shape === 'rect') { if (!(B > 0)) throw new Error('give the rectangle a height'); l = shapes.rect(-A / 2, -B / 2, A / 2, B / 2); }
  else if (q.shape === 'slot') { if (!(B > 0)) throw new Error('give the slot a radius'); l = shapes.slot([0, 0], A, B); }
  else if (q.shape === 'ellipse') { if (!(B > 0)) throw new Error('give the ellipse its second radius'); l = shapes.ellipse([0, 0], A, B); }
  else throw new Error(`unknown shape ${q.shape}`);
  return l;
}
const shiftLoop = (l, dx, dy) => (dx || dy ? { ...l, pieces: l.pieces.map((p) => ({ ...p, points: p.points.map(([x, y]) => [x + dx, y + dy]) })) } : l);

function setup(ctx, q) {
  const opName0 = q.op ?? 'cut', depth0 = Number(q.depth) || 1;
  const op0 = opName0 === 'mark' ? { op: 'imprint' } : { op: opName0, ...(opName0 === 'cut' ? { depth: depth0 } : { height: depth0 }), floor: q.square && /cylinder|sphere/.test(ctx.target.kind) ? 'normal' : 'view' };
  // a surface sketch: its own curves, where it lies
  if (ctx.loops) return { placement: { anchor: ctx.anchor, xDir: ctx.xDir }, loops: ctx.loops, op: op0 };
  const turn = rad(Number(q.turn) || 0);
  const xDir = rotAbout(ctx.xDir, V.unit(ctx.normal), turn);
  // offsets move the sketch along the surface, in its unturned directions
  const du = Number(q.du) || 0, dv = Number(q.dv) || 0, c = Math.cos(turn), s = Math.sin(turn);
  const loop = shiftLoop(loopOf(q), du * c + dv * s + (ctx.shift ?? 0) * c, -du * s + dv * c - (ctx.shift ?? 0) * s);
  const opName = q.op ?? 'cut', depth = Number(q.depth) || 1;
  const op = opName === 'mark' ? { op: 'imprint' } : { op: opName, ...(opName === 'cut' ? { depth } : { height: depth }), floor: q.square && /cylinder|sphere/.test(ctx.target.kind) ? 'normal' : 'view' };
  return { placement: { anchor: ctx.anchor, xDir }, loops: [loop], op };
}

/** Outline and the sketch's own grid, flat on the plane touching the surface (t = 0) to bent onto it (t = 1). */
function wrapCurves(target, pl, loops) {
  const m = surfaceMap(target, pl);
  const mls = mapLoops(m, loops, 0.25);
  const ml = { pieces: mls.flatMap((l) => l.pieces) };
  const pieces = ml.pieces.map((pc) => {
    const step = Math.max(1, Math.floor(pc.sketch.length / 60));
    return pc.sketch.map((_, i) => i).filter((i) => i % step === 0 || i === pc.sketch.length - 1).map((i) => ({ q: pc.sketch[i], s: pc.surface[i] }));
  });
  const nOutline = pieces.length;
  const all = ml.pieces.flatMap((pc) => pc.sketch);
  const lo = [0, 1].map((k) => Math.min(...all.map((q) => q[k])) - 2.5), hi = [0, 1].map((k) => Math.max(...all.map((q) => q[k])) + 2.5);
  for (const k of [0, 1]) {
    const span = hi[k] - lo[k], nl = Math.max(3, Math.round(span / 2.5));
    for (let i = 0; i <= nl; i++) {
      const c0 = lo[k] + (span * i) / nl, o = 1 - k;
      const line = [];
      for (let j = 0; j <= 24; j++) {
        const qq = [0, 0]; qq[k] = c0; qq[o] = lo[o] + ((hi[o] - lo[o]) * j) / 24;
        try { const s = m.at(qq); if (s.p.every(Number.isFinite)) line.push({ q: qq, s }); } catch { /* off the surface */ }
      }
      if (line.length >= 2) pieces.push(line);
    }
  }
  let fold = null;
  if (target.kind === 'corner') {
    const fr = cornerFrame(target, m.anchor);
    let ang = Math.acos(Math.max(-1, Math.min(1, V.dot(V.mul(fr.mA, -1), fr.mB))));
    if (V.dot(rotAbout(V.mul(fr.mA, -1), fr.e, ang), fr.mB) < 0.999) ang = -ang;
    fold = { e: fr.e, mA: fr.mA, ang, P: target.edgePoint };
  }
  const lift = 0.06;
  let hover = 0;
  for (const pc of pieces) for (const { q, s } of pc) { const flat = V.add(m.anchor, V.add(V.mul(m.e1, q[0]), V.mul(m.e2, q[1]))); hover = Math.max(hover, V.dot(V.sub(s.p, flat), m.normal)); }
  hover = hover > 0 ? hover + 0.6 : 0;
  return {
    m, nOutline,
    at: (t) => pieces.map((pc) => pc.map(({ q, s }) => {
      const up = V.mul(m.normal, hover * (1 - t));
      const flat = V.add(m.anchor, V.add(V.mul(m.e1, q[0]), V.mul(m.e2, q[1])));
      if (fold) {
        const r = V.sub(flat, fold.P), al = V.dot(r, fold.e), be = V.dot(r, fold.mA);
        const pt = be >= 0 ? flat : V.add(V.add(fold.P, V.mul(fold.e, al)), V.mul(rotAbout(V.mul(fold.mA, -1), fold.e, fold.ang * t), -be));
        return V.add(V.add(pt, up), V.mul(be >= 0 ? m.normal : s.n, lift));
      }
      return V.add(V.add(V.add(V.mul(flat, 1 - t), V.mul(s.p, t)), up), V.mul(V.add(V.mul(m.normal, 1 - t), V.mul(s.n, t)), lift));
    })),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let previewShown = false;
async function removePreview() {
  if (!previewShown) return;
  previewShown = false;
  await exec('timeline.delete', { feature: PREVIEW }).catch(() => {});
}
async function drawCurves(name, curves, m, animate) {
  await exec('sketch.create', { name, plane: { origin: m.anchor, x_dir: m.e1, y_dir: m.e2 } });
  await exec('sketch.options', { sketch_3d: true });
  const wires = [];
  for (const pc of animate ? animate(0) : curves) wires.push((await exec('sketch.spline3d', { points: pc })).curves[0]);
  if (animate) {
    await sleep(600);
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, e = t * t * (3 - 2 * t), cmds = [];
      animate(e).forEach((pc, w) => pc.forEach((p, k) => cmds.push({ command: 'sketch.move3d', params: { wire: wires[w], index: k, to: p } })));
      await tool('batch', { commands: cmds, verbose: false });
      await sleep(60);
    }
  }
  await exec('sketch.finish');
}

// ------------------------------------------------------------------ surface sketches (New Sketch on a curved face)
// A surface sketch is an ordinary flat SolidCraft sketch on the plane touching the face where it was clicked: its
// coordinates are the layer's surface coordinates (lengths along the surface), so every sketch tool works on it. The
// document's metadata keeps how to read the surface again (META + sketch id); the watcher draws it wrapped.
// document metadata: { 'org.reshape.surface_sketches': { <sketch id>: recipe } }
const META = 'org.reshape.surface_sketches';
const recipeIn = (d, id) => d.metadata?.[META]?.[String(id)];

/** A sketch curve as points in sketch coordinates, start to end, or null when the kind is not handled. */
function curvePoints(cv) {
  const dense = (len) => Math.max(16, Math.ceil(len / 0.05));
  if (cv.type === 'line') return shapes.line(cv.start_at, cv.end_at, dense(Math.hypot(cv.end_at[0] - cv.start_at[0], cv.end_at[1] - cv.start_at[1]))).points;
  if (cv.type === 'circle') return shapes.arc(cv.center_at, cv.radius, 0, 2 * Math.PI).points;
  if (cv.type === 'arc') {
    const c = cv.center_at, a0 = Math.atan2(cv.start_at[1] - c[1], cv.start_at[0] - c[0]);
    let a1 = Math.atan2(cv.end_at[1] - c[1], cv.end_at[0] - c[0]);
    while (a1 <= a0) a1 += 2 * Math.PI;
    return shapes.arc(c, cv.radius, a0, a1).points;
  }
  if (cv.type === 'spline' && cv.points_at?.length >= 2) {
    // a fit-point spline: centripetal Catmull-Rom through its points (a control-point one: its B-spline)
    let P = cv.points_at.map((q) => [...q]);
    const closed = !!cv.periodic;
    if (closed && P.length > 2 && Math.hypot(P[0][0] - P.at(-1)[0], P[0][1] - P.at(-1)[1]) < 1e-9) P = P.slice(0, -1);
    const n = P.length, out = [];
    const at = (i) => (closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
    if (cv.control) {
      // uniform cubic B-spline, clamped by repeating the end points
      const Q = closed ? P : [P[0], P[0], ...P, P.at(-1), P.at(-1)];
      const m = closed ? n : Q.length - 3;
      for (let i = 0; i < m; i++) {
        const [a, b, c, d] = [0, 1, 2, 3].map((k) => Q[(i + k) % Q.length]);
        for (let j = 0; j < 40; j++) {
          const t = j / 40, t2 = t * t, t3 = t2 * t;
          const w = [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
          out.push([0, 1].map((k) => w[0] * a[k] + w[1] * b[k] + w[2] * c[k] + w[3] * d[k]));
        }
      }
      out.push(closed ? out[0] : P.at(-1));
      return out;
    }
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const d = (a, b) => Math.max(1e-9, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
      const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
      const k = dense(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 1.2);
      for (let j = 0; j < k; j++) {
        const t = t1 + ((t2 - t1) * j) / k;
        const L = (a, b, ta, tb) => [0, 1].map((c) => ((tb - t) / (tb - ta)) * a[c] + ((t - ta) / (tb - ta)) * b[c]);
        const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
        const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
        out.push(L(B1, B2, t1, t2));
      }
    }
    out.push(closed ? [...P[0]] : [...P.at(-1)]);
    return out;
  }
  return null;
}

/** The closed loops of a sketch's profiles (one profile, or all of them), as the layer's sketch loops. */
function sketchLoops(sk, index) {
  const byId = new Map(sk.curves.map((c) => [c.id, c]));
  const profiles = index == null ? sk.profiles ?? [] : (sk.profiles ?? []).filter((p) => p.index === index);
  if (!profiles.length) return { refusal: `${sk.name} has no closed outline to wrap.` };
  const seen = new Set(), loops = [];
  const loopOfIds = (ids) => {
    const key = [...ids].sort().join(',');
    if (seen.has(key)) return null;
    seen.add(key);
    const pieces = [];
    for (const id of ids) {
      const cv = byId.get(id);
      const pts = cv && curvePoints(cv);
      if (!pts) throw new Error(`${sk.name} has a ${cv?.type ?? 'curve'} that surface sketches do not handle yet`);
      let pc = pts;
      if (pieces.length) {
        const end = pieces.at(-1).points.at(-1), d0 = Math.hypot(pc[0][0] - end[0], pc[0][1] - end[1]), d1 = Math.hypot(pc.at(-1)[0] - end[0], pc.at(-1)[1] - end[1]);
        if (d1 < d0) pc = [...pc].reverse();
      } else if (ids.length > 1) {
        // orient the first piece towards the second
        const nx = curvePoints(byId.get(ids[1])) ?? [];
        const touches = (q) => nx.length && Math.min(Math.hypot(q[0] - nx[0][0], q[1] - nx[0][1]), Math.hypot(q[0] - nx.at(-1)[0], q[1] - nx.at(-1)[1]));
        if (touches(pc[0]) < touches(pc.at(-1))) pc = [...pc].reverse();
      }
      pieces.push({ points: pc });
    }
    return { pieces, closed: true };
  };
  try {
    for (const p of profiles) {
      for (const ids of [p.curves, ...(p.holes ?? [])]) { const l = loopOfIds(Array.isArray(ids) ? ids : ids.curves ?? []); if (l) loops.push(l); }
    }
  } catch (e) { return { refusal: `${e.message}.` }; }
  // outlines that cross each other make no single region: say so plainly (the layer's own check would call it a fold)
  const segs = loops.map((l) => { const pts = l.pieces.flatMap((pc) => pc.points); const bb = [0, 1].map((k) => [Math.min(...pts.map((q) => q[k])), Math.max(...pts.map((q) => q[k]))]); return { pts, bb }; });
  const cross = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j];
    if (A.bb[0][1] < B.bb[0][0] || B.bb[0][1] < A.bb[0][0] || A.bb[1][1] < B.bb[1][0] || B.bb[1][1] < A.bb[1][0]) continue;
    const sa = Math.max(1, Math.floor(A.pts.length / 400)), sb = Math.max(1, Math.floor(B.pts.length / 400));
    for (let a = 0; a + sa < A.pts.length; a += sa) for (let b = 0; b + sb < B.pts.length; b += sb) {
      if (cross(A.pts[a], A.pts[a + sa], B.pts[b], B.pts[b + sb])) return { refusal: `Outlines in ${sk.name} cross each other. Draw them apart, or pick just one profile to wrap.` };
    }
  }
  return { loops };
}

const recipeOf = (r, sel) => ({ sel, label: r.label.replace(/,? on [^,]*$/, ''), kind: r.target.kind, normal: r.normal, xDir: r.xDir, target: r.target.kind === 'graph' ? null : r.target });

async function surfaceSketchCtx(sel) {
  const d = await tool('inspect_design', { measure: false, sketches: true, joints: false });
  const id = sel.type === 'profile' ? sel.sketch : sel.id;
  const sk = (d.sketches ?? []).find((x) => x.id === id);
  if (!sk) return { refusal: 'Pick a curved face, a corner edge, or a surface sketch.' };
  const raw = recipeIn(d, sk.id);
  if (!raw) return { refusal: `${sk.name} is a flat sketch. Start a surface sketch with New Sketch on a curved face.` };
  const recipe = raw;
  const r = await recognise([recipe.sel], false, recipe);
  if (r.refusal) return r;
  const l = sketchLoops(sk, sel.type === 'profile' ? sel.index : null);
  if (l.refusal) return l;
  return { ...r, label: `${sk.name} on the ${recipe.label}`, anchor: sk.plane.origin, xDir: sk.plane.x_dir, shift: 0, loops: l.loops, corner: false };
}

/** New Sketch on a curved face: the sketch on the plane touching it at the click, facing the camera. */
async function startSurfaceSketch(sel) {
  const r = await recognise([sel], false);
  if (r.refusal) return { ok: false, refusal: r.refusal };
  const m = surfaceMap(r.target, { anchor: r.anchor, xDir: r.xDir });
  const d = await tool('inspect_design', { measure: false, sketches: true, joints: false });
  const names = new Set((d.sketches ?? []).map((x) => x.name));
  let k = 1; while (names.has(`Surface Sketch${k}`)) k++;
  const name = `Surface Sketch${k}`;
  await exec('sketch.create', { name, plane: { origin: m.anchor, x_dir: m.e1, y_dir: m.e2 } });
  const sk = (await tool('inspect_design', { measure: false, sketches: true, joints: false })).sketches.find((x) => x.name === name);
  const all = { ...(d.metadata?.[META] ?? {}), [String(sk.id)]: recipeOf(r, { ...sel, point: m.anchor }) };
  await exec('document.metadata.set', { values: { [META]: all } });
  const n = m.normal;
  await exec('view.apply', { camera: { target: m.anchor, yaw: Math.atan2(n[0], n[1]), pitch: Math.max(-1.3, Math.min(1.3, Math.asin(Math.max(-1, Math.min(1, n[2]))))), distance: 80 } }).catch(() => {});
  return { ok: true, name, label: recipeOf(r, sel).label };
}

/**
 * Keep every surface sketch drawn on its face, until the app exits. The patched app draws a sketch
 * through its warp (`reshape.surface_warp`): a grid of where the sketch's points lie on the face.
 * Without the patch's warp command it falls back to drawing the curves wrapped (`reshape.overlay`).
 */
async function watch(appPid) {
  const cache = new Map();
  let sent = '', warp = true;
  const alive = () => { if (!appPid) return true; try { process.kill(appPid, 0); return true; } catch { return false; } };
  while (alive()) {
    try {
      if (warp) {
        const warps = await surfaceWarps(cache);
        const json = JSON.stringify(warps.map((w) => w.key));
        if (json !== sent) {
          try { await exec('reshape.surface_warp', { warps: warps.map((w) => w.warp) }); await exec('reshape.overlay', { lines: [] }); sent = json; }
          catch (e) { if (/unknown|not a command|no such/i.test(e.message)) { warp = false; sent = ''; } else throw e; }
        }
      } else {
        const lines = await wrappedLines(cache);
        const json = JSON.stringify(lines);
        if (json !== sent) { await exec('reshape.overlay', { lines }); sent = json; }
      }
    } catch (e) {
      if (/not running, or it quit|exited/.test(e.message)) break;
    }
    await sleep(250);
  }
  process.exit(0);
}

/** How far each way from its origin a surface sketch's warp reaches on the face (mm). */
function warpReach(t) {
  if (t.kind === 'cylinder') return [Math.min(60, 0.95 * Math.PI * t.radius), 60];
  if (t.kind === 'sphere') return [Math.min(60, 0.45 * Math.PI * t.radius), Math.min(60, 0.45 * Math.PI * t.radius)];
  if (t.kind === 'graph') return [15, 15];
  return [40, 40];
}

/** Every surface sketch's warp: its plane and a grid of where its points lie on the face. */
async function surfaceWarps(cache) {
  const d = await tool('inspect_design', { measure: false, sketches: true, joints: false });
  const out = [];
  for (const sk of d.sketches ?? []) {
    const raw = recipeIn(d, sk.id);
    if (!raw) continue;
    const key = `w${sk.id}:${JSON.stringify(sk.plane)}:${JSON.stringify(raw)}`;
    let c = cache.get(key);
    if (!c) {
      const r = await recognise([raw.sel], false, raw);
      c = { bad: true };
      if (!r.refusal) {
        const m = surfaceMap(r.target, { anchor: sk.plane.origin, xDir: sk.plane.x_dir });
        const [lu, lv] = warpReach(r.target);
        const step = Math.max(lu, lv) / 48;
        const nu = 2 * Math.ceil(lu / step) + 1, nv = 2 * Math.ceil(lv / step) + 1;
        const u0 = -((nu - 1) / 2) * step, v0 = -((nv - 1) / 2) * step;
        const points = [];
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
          let q = null;
          try { const s = m.at([u0 + i * step, v0 + j * step]); const p = V.add(s.p, V.mul(s.n, 0.02)); if (p.every(Number.isFinite)) q = p.map((v) => +v.toFixed(5)); } catch { /* off the face */ }
          points.push(q);
        }
        c = { key, warp: { plane: sk.plane, u0, v0, du: step, dv: step, nu, nv, points } };
      }
      cache.set(key, c);
    }
    if (!c.bad) out.push(c);
  }
  return out;
}

/** Every visible surface sketch's curves, wrapped on its face, as world polylines. */
async function wrappedLines(cache) {
  {
    {
      const d = await tool('inspect_design', { measure: false, sketches: true, joints: false });
      const lines = [];
      for (const sk of d.sketches ?? []) {
        const raw = recipeIn(d, sk.id);
        if (!raw || sk.visible === false) continue;
        const key = `${sk.id}:${JSON.stringify(sk.plane)}`;
        let c = cache.get(key);
        if (!c) {
          const recipe = raw;
          const r = await recognise([recipe.sel], false, recipe);
          c = r.refusal ? { bad: true } : { m: surfaceMap(r.target, { anchor: sk.plane.origin, xDir: sk.plane.x_dir }) };
          cache.set(key, c);
        }
        if (c.bad) continue;
        for (const cv of sk.curves ?? []) {
          if (cv.construction) continue;
          const pts = curvePoints(cv);
          if (!pts) continue;
          const step = Math.max(1, Math.floor(pts.length / 200));
          const line = [];
          for (let i = 0; i < pts.length; i += step) { try { const s = c.m.at(pts[i]); line.push(V.add(s.p, V.mul(s.n, 0.05)).map((v) => +v.toFixed(4))); } catch { /* off the surface */ } }
          try { const s = c.m.at(pts.at(-1)); line.push(V.add(s.p, V.mul(s.n, 0.05)).map((v) => +v.toFixed(4))); } catch { /* off */ }
          if (line.length >= 2) lines.push(line);
        }
      }
      return lines;
    }
  }
}

// ------------------------------------------------------------------ actions
let ctx = null, lastSel = '';
async function pick(sideB, given) {
  await removePreview();
  const sel = given ? [given] : ((await tool('inspect_design', { measure: false, sketches: false, joints: false })).selection ?? []);
  lastSel = JSON.stringify(sel);
  if (sel.length === 1 && /^(profile|feature)$/.test(sel[0].type)) {
    const r = await surfaceSketchCtx(sel[0]);
    ctx = r.refusal ? null : r;
    return r.refusal ? { ok: false, refusal: r.refusal } : { ok: true, label: r.label };
  }
  const r = await recognise(sel, !!sideB);
  ctx = r.refusal ? null : r;
  return r.refusal ? { ok: false, refusal: r.refusal } : { ok: true, label: r.label, corner: !!r.corner };
}
function plan(q, id, only) {
  const st = setup(ctx, q), placement = st.placement, op = st.op, loops = only ?? st.loops;
  const p = planSurfaceSketch({ body: ctx.body, target: ctx.target, placement, loops, op, id, fit: ctx.fit, maxStretch: (Number(q.stretch) || 1) / 100 });
  return { p, placement, loops, op };
}
async function preview(q) {
  if (!ctx) return { ok: false, refusal: 'Select a face or a corner edge in SolidCraft, then press Use selection.' };
  let r;
  try { r = plan(q, 'preview'); } catch (e) { return { ok: false, refusal: e.message }; }
  await removePreview();
  try {
    const w = wrapCurves(ctx.target, r.placement, r.loops);
    previewShown = true;
    await drawCurves(PREVIEW, w.at(1), w.m, q.animate ? w.at : null);
  } catch (e) { return { ok: false, refusal: `The preview could not be drawn (${e.message}).` }; }
  if (!r.p.ok) return { ok: false, refusal: r.p.refusal, previewed: true };
  return { ok: true, stretch: r.p.prediction.stretch, volume: r.p.prediction.volumeDelta, notes: r.p.notes };
}
let count = 0;
const debugCache = new Map();

/** Group loops into separate regions: each outline with the outlines directly inside it (its holes). */
function regions(loops) {
  const poly = loops.map((l) => l.pieces.flatMap((pc) => pc.points));
  const inPoly = (q, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > q[1]) !== (P[j][1] > q[1]) && q[0] < ((P[j][0] - P[i][0]) * (q[1] - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  const parents = poly.map((P, i) => poly.map((Q, j) => (j !== i && inPoly(P[0], Q) ? j : -1)).filter((j) => j >= 0));
  const depth = parents.map((ps) => ps.length);
  const out = [];
  poly.forEach((_, i) => {
    if (depth[i] % 2) return;
    const holes = poly.map((_, j) => j).filter((j) => depth[j] === depth[i] + 1 && parents[j].includes(i));
    out.push([loops[i], ...holes.map((j) => loops[j])]);
  });
  return out;
}

async function apply(q) {
  if (!ctx) return { ok: false, refusal: 'Select a face or a corner edge in SolidCraft, then press Use selection.' };
  await removePreview();
  // separate outlines are separate features: one extrude of several makes several bodies
  const groups = ctx.loops ? regions(ctx.loops) : [null];
  if (groups.length > 1) {
    const done = [];
    for (const g of groups) {
      const r = await applyOne(q, g);
      if (!r.ok) return { ...r, detail: [r.detail, done.length ? `${done.length} of ${groups.length} outlines were built before it` : ''].filter(Boolean).join('; ') };
      done.push(r);
    }
    return { ok: true, id: done.map((r) => r.id).join(', '), result: done.map((r) => r.result).join('; ') };
  }
  return applyOne(q, groups[0]);
}

async function applyOne(q, only) {
  const id = `wrap${++count}_${Date.now().toString(36).slice(-5)}`;
  let r;
  try { r = plan(q, id, only ?? undefined); } catch (e) { return { ok: false, refusal: e.message }; }
  if (!r.p.ok) return { ok: false, refusal: r.p.refusal };
  const body = ctx.body, imprint = r.op.op === 'imprint';
  const bodiesBefore = (await tool('measure', { summary: true })).bodies ?? [];
  const vol = async () => (await tool('measure', { summary: true })).bodies.find((b) => b.name === body)?.volume_mm3;
  const edges = async () => (await exec('model.edges', { body })).edges;
  const before = { v: await vol(), e: imprint ? await edges() : undefined };
  const cp = (await exec('edit.checkpoint')).checkpoint;
  // a batch the kernel fails comes back as an error; it has rolled back, and the checkpoint makes sure
  const res = await tool('batch', { commands: r.p.commands, verbose: false }).catch((e) => { let v; try { v = JSON.parse(e.message); } catch { v = { failed: { error: e.message } }; } return { ...v, ok: false }; });
  if (res.ok === false) {
    await exec('edit.restore_checkpoint', { checkpoint: cp }).catch(() => {});
    return { ok: false, refusal: surfaceRefusal(id, r.op.op, 'kernel'), detail: String(res.failed?.error ?? '').split('\n')[0].slice(0, 200) };
  }
  const after = { v: await vol(), e: imprint ? await edges() : undefined };
  const v = verifySurfaceSketch({ prediction: r.p.prediction, volumeBefore: before.v, volumeAfter: after.v, edgesBefore: before.e, edgesAfter: after.e });
  const extra = (await tool('measure', { summary: true })).bodies.filter((b) => b.name !== body && !bodiesBefore.some((x) => x.name === b.name));
  if (!v.ok || extra.length) {
    await exec('edit.restore_checkpoint', { checkpoint: cp });
    return { ok: false, refusal: surfaceRefusal(id, r.op.op, 'mismatch'), detail: `${v.ok ? 'it left extra bodies' : v.reason}; the design is back as it was` };
  }
  const sk = r.p.commands.filter((c) => c.command === 'sketch.create').map((c) => c.params.name);
  await exec('browser.visibility', { items: sk, visible: false }).catch(() => {});
  // the outline stays on the surface as a 3D sketch, to look at or reuse
  // (a surface sketch already shows itself wrapped; a dialog shape gets its outline kept as a 3D sketch)
  if (!ctx.loops) try { const w = wrapCurves(ctx.target, r.placement, r.loops); await drawCurves(`${id}_on_surface`, w.at(1).slice(0, w.nOutline), w.m, null); } catch { /* the feature stands without it */ }
  const m = v.measured;
  return { ok: true, id, result: m.relError !== undefined ? `volume changed ${Math.abs(m.volumeDelta).toFixed(3)} mm3, predicted ${Math.abs(m.predicted).toFixed(3)} (off by ${m.relError.toExponential(1)})` : `${m.markedEdges} edges on the outline, ${m.markedLength.toFixed(2)} of ${m.predictedLength.toFixed(2)} mm` };
}
async function selection() {
  const d = await tool('inspect_design', { measure: false, sketches: false, joints: false });
  const sel = d.selection ?? [];
  const k = JSON.stringify(sel);
  return { changed: sel.length > 0 && k !== lastSel, count: sel.length, kinds: sel.map((x) => x.type) };
}

// ------------------------------------------------------------------ one shot, for the app's Wrap Sketch dialog
// --once '<json>': {sel: {type, body, index, point}, shape, a, b, turn, du, dv, op, depth, square, animate}
// prints one JSON line: {ok, id, result} or {ok: false, refusal, detail?}
if (argv.includes('--sketch')) {
  let out;
  try { out = await serial(() => startSurfaceSketch(JSON.parse(opt('sketch')))); } catch (e) { out = { ok: false, refusal: `SolidCraft did not answer: ${String(e.message).split('\n')[0].slice(0, 240)}` }; }
  console.log(JSON.stringify(out));
  mcp?.stdin.end();
  setTimeout(() => process.exit(out.ok ? 0 : 2), 200);
} else if (argv.includes('--watch')) {
  watch(Number(opt('app-pid', '0')) || 0);
} else if (argv.includes('--once')) {
  const q = JSON.parse(opt('once'));
  let out;
  try {
    const p = await serial(() => pick(false, q.sel));
    if (!p.ok) out = p;
    else {
      if (q.animate) { const pv = await serial(() => preview({ ...q, animate: true })); if (pv.ok) await sleep(700); }
      out = await serial(() => apply(q));
    }
  } catch (e) { out = { ok: false, refusal: `SolidCraft did not answer: ${String(e.message).split('\n')[0].slice(0, 240)}` }; }
  await serial(() => removePreview()).catch(() => {});
  console.log(JSON.stringify(out));
  mcp?.stdin.end();
  setTimeout(() => process.exit(out.ok ? 0 : 2), 200);
} else {
const page = fs.readFileSync(new URL('./panel.html', import.meta.url));
http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); return; }
  let body = '';
  for await (const c of req) body += c;
  let q = {}; try { q = body ? JSON.parse(body) : {}; } catch { return send(400, { ok: false, refusal: 'bad request' }); }
  const routes = { '/api/pick': () => pick(q.sideB, q.sel), '/api/preview': () => preview(q), '/api/apply': () => apply(q), '/api/clear': () => removePreview().then(() => ({ ok: true })), '/api/selection': () => selection() };
  // tests only: pass a tool call straight to the session (never on unless --debug is given)
  if (argv.includes('--debug')) {
    routes['/api/debug'] = () => tool(q.tool, q.args);
    routes['/api/debug-sketch'] = () => startSurfaceSketch(q.sel);
    routes['/api/debug-lines'] = () => wrappedLines(debugCache);
  }
  const fn = routes[req.url];
  if (!fn) return send(404, { ok: false });
  try { send(200, await serial(fn)); } catch (e) { send(200, { ok: false, refusal: `SolidCraft did not answer: ${e.message.split('\n')[0].slice(0, 240)}` }); }
}).listen(HTTP_PORT, '127.0.0.1', () => console.log(`surface sketch panel: http://127.0.0.1:${HTTP_PORT}  (SolidCraft control port ${APP_PORT})`));
}
