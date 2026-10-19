// Seeded, reproducible generator of shell fuzz cases.
//   genCase(seed, i) -> { id, family, t, cmds (build, no shell), shell ({command:'solid.shell',...}), model (for oracle.mjs), meta, oracleKind }
// Every dimension is a multiple of 0.05 and is biased toward gaps near t, 2t and 2t +- eps.
export function rng32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const q = (x) => Math.round(x * 20) / 20;
const q1 = (x) => Math.round(x * 10) / 10; // widths that get halved must be multiples of 0.1 so every box face lies on the oracle's 0.05 grid
const T_LIST = [0.5, 1, 1.5, 2, 2.5];

function mk(rng) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const wpick = (pairs) => { let s = 0; for (const [, w] of pairs) s += w; let r = rng() * s; for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][0]; };
  const U = (a, b) => q(a + rng() * (b - a));
  return { pick, wpick, U };
}

// gap picker: "interesting" distances for threshold t
export function gap(R, t, lo = 0.05) {
  const e = R.pick([0.05, 0.1, 0.25, 0.5]);
  const v = R.wpick([[t, 1], [2 * t, 2], [2 * t + e, 3], [2 * t - e, 3], [t + e, 1.5], [t - e, 1.5], [1.5 * t, 0.5], [3 * t, 1], [3 * t + e, 0.5], [R.U(0.3, 4 * t + 0.3), 2]]);
  return Math.max(lo, q(v));
}

export const cylCmd = (name, axis, c, r, range) => { // c = two perpendicular coords
  const base = axis === 'z' ? [c[0], c[1], range[0]] : axis === 'x' ? [range[0], c[0], c[1]] : [c[0], range[0], c[1]];
  const ax = axis === 'z' ? [0, 0, 1] : axis === 'x' ? [1, 0, 0] : [0, 1, 0];
  return { command: 'solid.cylinder', params: { radius: r, height: range[1] - range[0], base, axis: ax, body_name: name } };
};
export const boxCmd = (name, b) => ({ command: 'solid.box', params: { length: q(b[1] - b[0]), width: q(b[3] - b[2]), height: q(b[5] - b[4]), center: [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2], body_name: name } });
export const comb = (target, tool, op) => ({ command: 'solid.combine', params: { target, tools: [tool], operation: op } });
export const cutCyl = (n, axis, c, r, range) => [cylCmd(n, axis, c, r, range), comb('b1', n, 'cut')];
export const cutBox = (n, b) => [boxCmd(n, b), comb('b1', n, 'cut')];
export const addBox = (n, b) => [boxCmd(n, b), comb('b1', n, 'join')];

// ------------------------------------------------------------------ plate with features
const FEATS = [['vthru', 3], ['cbore', 3], ['csink', 3], ['blind', 3], ['pocket', 2.5], ['slot', 2], ['bossBox', 1.5], ['rim', 2], ['rboss', 1.5], ['hhole', 2]];

function plateCase(R, t, seed, i) {
  const open = R.wpick([['top', 55], ['top+bot', 10], ['top+xp', 9], ['bot', 6], ['xp', 6], ['top+yp', 6], ['top+xp+xn', 4]]);
  const openTop = open.includes('top'), openBot = open.includes('bot');
  const Hs = [5, 6, 8, 10, 12].filter((h) => h >= 3 * t + 1);
  const H = R.pick(Hs);
  let nf = R.wpick([[0, 1], [1, 5], [2, 4], [3, 2]]);
  const feats = []; let prev = null;
  for (let k = 0; k < nf; k++) {
    let kind = prev && R.pick([0, 1, 2, 3]) === 0 ? prev : R.wpick(FEATS);
    if (kind === 'rboss' && !openTop) kind = 'vthru';
    feats.push(makeFeat(R, kind, t, H, openTop, openBot)); prev = kind;
  }
  // layout along x
  const gl = gap(R, t); let gr = gap(R, t); let W = gl + gr; const gaps = [];
  for (let k = 0; k < feats.length; k++) { W += feats[k].wx; if (k) { const g = gap(R, t); gaps.push(g); W += g; } }
  W = q(W); if (Math.round(W * 20) % 2) { gr = q(gr + 0.05); W = q(W + 0.05); } if (W < 10) return null; if (W > 52) return null;
  const hyMax = feats.reduce((m, f) => Math.max(m, f.hy), 0);
  const gy1 = gap(R, t); let gy2 = R.pick([0, 1]) ? gap(R, t) : gy1;
  let D = q(Math.max(8, 2 * hyMax + gy1 + gy2)); if (Math.round(D * 20) % 2) { D = q(D + 0.05); gy2 = q(gy2 + 0.05); } if (D > 30) return null;
  const W2 = W / 2, D2 = D / 2;
  const parts = []; const meta = [];
  let x = -W2 + gl;
  feats.forEach((f, k) => {
    if (k) x += gaps[k - 1];
    const xc = q(x + f.wx / 2);
    let yc;
    if (f.hy === hyMax && !f.yfixed) yc = q(-D2 + gy1 + hyMax); else { const lo = -D2 + gap(R, t) + f.hy, hi = D2 - gap(R, t) - f.hy; yc = hi > lo ? q(lo + R.pick([0, 0.25, 0.5, 0.75, 1]) * (hi - lo)) : 0; }
    if (f.hy >= D2) yc = 0;
    const out = f.place(xc, yc, `f${k + 1}`, W, D);
    parts.push({ kind: f.kind, ...out }); meta.push({ kind: f.kind, ...f.meta, xc, yc }); x += f.wx;
  });
  const base = { W, D, H, t, open };
  const asm = assemblePlate(base, parts); if (!asm) return null;
  const desc = `plate ${W}x${D}x${H} open=${open} [${meta.map((f) => f.kind).join(',')}]`;
  return { family: 'plate', t, cmds: asm.cmds, shell: asm.shell, model: asm.model, base, parts, meta: { W, D, H, open, feats: meta, gaps: { gl, gr, between: gaps, gy1, gy2 } }, desc };
}

// rebuild commands/model/pick points of a plate case from its base + feature parts (used by the generator and the minimiser)
export function assemblePlate(base, parts) {
  const { W, D, H, t, open } = base; const W2 = W / 2, D2 = D / 2;
  const openTop = open.includes('top'), openBot = open.includes('bot');
  const m = { t, mode: 'rect', boxes: [[-W2, W2, -D2, D2, 0, H]], cuts: [], opens: [], holes: [], rbosses: [] };
  const cmds = [boxCmd('b1', [-W2, W2, -D2, D2, 0, H])];
  const minusTop = [], minusBot = [], avoid = { top: [], bot: [], xp: [], xn: [], yp: [] };
  for (const out of parts) {
    cmds.push(...out.cmds); m.boxes.push(...(out.boxes || [])); m.cuts.push(...(out.cuts || [])); m.holes.push(...(out.holes || [])); m.rbosses.push(...(out.rbosses || []));
    minusTop.push(...(out.minusTop || [])); minusBot.push(...(out.minusBot || []));
    for (const a of out.avoid || []) avoid[a.face].push(a);
  }
  const faces = []; const picks = [];
  const add = (name, axis, dir, coord, rect, minus) => { m.opens.push({ axis, dir, coord, rect, minus: minus || [] }); faces.push(name); };
  if (openTop) add('top', 'z', 1, H, [-W2, W2, -D2, D2], minusTop);
  if (openBot) add('bot', 'z', -1, 0, [-W2, W2, -D2, D2], minusBot);
  if (open.includes('xp')) add('xp', 'x', 1, W2, [-D2, D2, 0, H], []);
  if (open.includes('xn')) add('xn', 'x', -1, -W2, [-D2, D2, 0, H], []);
  if (open.includes('yp')) add('yp', 'y', 1, D2, [-W2, W2, 0, H], []);
  for (let j = 0; j < faces.length; j++) { const p = pickPoint(m.opens[j], avoid[faces[j]] || [], faces[j]); if (!p) return null; picks.push(p); }
  return { cmds, shell: shellCmd(picks, t), model: m };
}

function shellCmd(picks, t) { return { command: 'solid.shell', params: { faces: picks, thickness: t, body: 'b1' } }; }

// choose a point in the face rect maximising clearance to edges, rect cutouts and circles
export function pickPoint(o, avoid, name) {
  const [a0, a1, b0, b1] = o.rect; let best = null, bc = 0.2;
  const rects = [...(o.minus || [])], circs = [];
  for (const a of avoid) { if (a.rect) rects.push(a.rect); if (a.circ) circs.push(a.circ); }
  const na = Math.max(8, Math.round((a1 - a0) / 0.5)), nb = Math.max(8, Math.round((b1 - b0) / 0.5));
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
    const u = a0 + (i + 0.5) * (a1 - a0) / (na + 1), v = b0 + (j + 0.5) * (b1 - b0) / (nb + 1);
    let c = Math.min(u - a0, a1 - u, v - b0, b1 - v);
    for (const r of rects) { const du = Math.max(r[0] - u, 0, u - r[1]), dv = Math.max(r[2] - v, 0, v - r[3]); const inside = u > r[0] && u < r[1] && v > r[2] && v < r[3]; c = Math.min(c, inside ? -1 : Math.hypot(du, dv)); }
    for (const ci of circs) c = Math.min(c, Math.hypot(u - ci[0], v - ci[1]) - ci[2]);
    if (c > bc) { bc = c; best = [u, v]; }
  }
  if (!best) return null;
  const [u, v] = best.map((z) => Math.round(z * 1000) / 1000);
  if (o.axis === 'z') return [u, v, o.coord];
  if (o.axis === 'x') return [o.coord, u, v];
  return [u, o.coord, v];
}

function makeFeat(R, kind, t, H, openTop, openBot) {
  const face = R.pick([0, 1]) ? 'top' : 'bot';
  const zmouth = face === 'top' ? H : 0; const sgn = face === 'top' ? 1 : -1;
  const floorGap = () => gap(R, t, 0.1);
  const depthFrom = (f) => Math.max(0.3, Math.min(H - 0.1, q(H - f)));
  const range = (d) => (face === 'top' ? [q(H - d), H + 1] : [-1, q(d)]);
  const circAvoid = (xc, yc, r) => face === 'top' ? [{ face: 'top', circ: [xc, yc, r + 0.3] }, { face: 'bot', circ: [xc, yc, r + 0.3] }] : [{ face: 'bot', circ: [xc, yc, r + 0.3] }];
  const avoidBoth = (xc, yc, r) => [{ face: 'top', circ: [xc, yc, r + 0.3] }, { face: 'bot', circ: [xc, yc, r + 0.3] }];
  if (kind === 'vthru') {
    const r = R.pick([1, 1.5, 2, 2.5, 3]);
    return { kind, wx: 2 * r, hy: r, meta: { r }, place: (xc, yc, n) => ({ cmds: cutCyl(n, 'z', [xc, yc], r, [-1, H + 1]), holes: [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [-1, H + 1] }], avoid: avoidBoth(xc, yc, r) }) };
  }
  if (kind === 'cbore') {
    const r = R.pick([1, 1.5, 2]), Rb = q(r + R.pick([1, 1.5, 2, 3])); const dc = Math.min(depthFrom(floorGap()) , H - 0.3);
    const dcc = R.pick([0, 1]) ? q(Math.min(H - 0.3, gap(R, t, 0.1))) : q(dc);
    const d = Math.max(0.3, dcc);
    return { kind, wx: 2 * Rb, hy: Rb, meta: { r, R: Rb, d, face, ring: q(H - d) }, place: (xc, yc, n, W, D) => ({ cmds: [...cutCyl(n + 'a', 'z', [xc, yc], r, [-1, H + 1]), ...cutCyl(n + 'b', 'z', [xc, yc], Rb, range(d))],
      holes: [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [-1, H + 1] }, { type: 'cyl', axis: 'z', c: [xc, yc], r: Rb, range: range(d) }], avoid: avoidBoth(xc, yc, Rb) }) };
  }
  if (kind === 'csink') {
    const r = R.pick([1, 1.5, 2]);
    const dep = R.pick([0, 1]) ? q(Math.min(H - 0.5, gap(R, t, 0.3))) : q(Math.max(0.3, Math.min(H - 0.5, H - floorGap())));
    const Rb = q(r + dep), D = 2 * Rb;
    return { kind, wx: D, hy: Rb, meta: { r, R: Rb, dep, face, straight: q(H - dep) }, place: (xc, yc, n) => ({
      cmds: [{ command: 'solid.hole', params: { position: [xc, yc, zmouth], diameter: 2 * r, type: 'countersink', cs_diameter: D } }],
      holes: [face === 'top' ? { type: 'cone', c: [xc, yc], rb: r, zb: q(H - dep), rt: Rb, zt: H, r, range: [-1, H + 1] } : { type: 'cone', c: [xc, yc], rb: Rb, zb: 0, rt: r, zt: dep, r, range: [-1, H + 1] }], avoid: avoidBoth(xc, yc, Rb) }) };
  }
  if (kind === 'blind') {
    const r = R.pick([1, 1.5, 2, 2.5, 3]); const f = floorGap(); const d = depthFrom(f);
    return { kind, wx: 2 * r, hy: r, meta: { r, d, face, floor: q(H - d) }, place: (xc, yc, n) => ({ cmds: cutCyl(n, 'z', [xc, yc], r, range(d)), holes: [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: range(d) }], avoid: face === 'top' ? avoidBoth(xc, yc, r) : avoidBoth(xc, yc, r) }) };
  }
  if (kind === 'pocket' || kind === 'slot') {
    const slot = kind === 'slot';
    const pw = slot ? Math.max(0.4, q1(gap(R, t, 0.4))) : q1(R.U(3, 10)), pd = slot ? q1(R.U(6, 14)) : q1(R.U(3, 10));
    const d = depthFrom(floorGap());
    return { kind, wx: pw, hy: pd / 2, meta: { pw, pd, d, face, floor: q(H - d) }, place: (xc, yc, n) => {
      const b = face === 'top' ? [xc - pw / 2, xc + pw / 2, yc - pd / 2, yc + pd / 2, q(H - d), H + 1] : [xc - pw / 2, xc + pw / 2, yc - pd / 2, yc + pd / 2, -1, d];
      const bm = face === 'top' ? [b[0], b[1], b[2], b[3], q(H - d), H] : [b[0], b[1], b[2], b[3], 0, d]; const foot = [b[0], b[1], b[2], b[3]];
      return { cmds: cutBox(n, b), cuts: [bm], [face === 'top' ? 'minusTop' : 'minusBot']: [foot], avoid: [] };
    } };
  }
  if (kind === 'bossBox') {
    const bw = q1(R.U(2, 8)), bd = q1(R.U(2, 8)), bh = R.pick([1, 2, 3, 4, 6]);
    return { kind, wx: bw, hy: bd / 2, meta: { bw, bd, bh, face }, place: (xc, yc, n) => {
      const b = face === 'top' ? [xc - bw / 2, xc + bw / 2, yc - bd / 2, yc + bd / 2, H, H + bh] : [xc - bw / 2, xc + bw / 2, yc - bd / 2, yc + bd / 2, -bh, 0];
      return { cmds: addBox(n, b), boxes: [b], [face === 'top' ? 'minusTop' : 'minusBot']: [[b[0], b[1], b[2], b[3]]] };
    } };
  }
  if (kind === 'rim') {
    const bw = q1(R.U(6, 12)), bd = q1(R.U(6, 12)), bh = R.pick([2, 3, 4, 6]); const w = Math.min(gap(R, t, 0.3), q(Math.min(bw, bd) / 2 - 0.5));
    return { kind, wx: bw, hy: bd / 2, meta: { bw, bd, bh, wall: w, face }, place: (xc, yc, n) => {
      const z0 = face === 'top' ? H : -bh, z1 = face === 'top' ? H + bh : 0; const o = [xc - bw / 2, xc + bw / 2, yc - bd / 2, yc + bd / 2, z0, z1]; const inn = [o[0] + w, o[1] - w, o[2] + w, o[3] - w, z0, z1];
      // cut the rim box BEFORE joining it (as the c8 rim cases do): the tool never touches the plate
      const tool = [o[0] + w, o[1] - w, o[2] + w, o[3] - w, z0 - 1, z1 + 1];
      return { cmds: [boxCmd(n, o), boxCmd(n + 't', tool), comb(n, n + 't', 'cut'), comb('b1', n, 'join')], boxes: [o], cuts: [inn], [face === 'top' ? 'minusTop' : 'minusBot']: [[o[0], o[1], o[2], o[3]]], avoid: [] };
    } };
  }
  if (kind === 'rboss') {
    const r = R.pick([2, 2.5, 3, 4]); const bh = q(R.pick([0, 1]) ? Math.max(1, gap(R, t, 0.5) + 1) : R.pick([2, 3, 4, 6]));
    return { kind, wx: 2 * r, hy: r, meta: { r, bh }, place: (xc, yc, n) => ({ cmds: [cylCmd(n, 'z', [xc, yc], r, [H, H + bh]), comb('b1', n, 'join')], rbosses: [{ c: [xc, yc], r, z0: H, z1: q(H + bh) }], avoid: [{ face: 'top', circ: [xc, yc, r + 0.3] }] }) };
  }
  if (kind === 'hhole') {
    const r = R.pick([0.75, 1, 1.5, 2]); const g = floorGap(); const fromTop = R.pick([0, 1]);
    if (H < 2 * r + g + 0.2) return makeFeat(R, 'vthru', t, H, openTop, openBot);
    const zc = fromTop ? q(H - g - r) : q(g + r);
    return { kind, wx: 2 * r, hy: 0.01, yfixed: true, meta: { r, g, fromTop: !!fromTop, zc }, place: (xc, yc, n, W, D) => ({ cmds: cutCyl(n, 'y', [xc, zc], r, [-D / 2 - 1, D / 2 + 1]), holes: [{ type: 'cyl', axis: 'y', c: [xc, zc], r, range: [-D / 2 - 1, D / 2 + 1] }], avoid: [] }) };
  }
  throw new Error(kind);
}

// ------------------------------------------------------------------ convex plates with an edge treatment
function convexCase(R, t, seed, i) {
  const kind = R.pick(['vfillet', 'vchamfer', 'bfillet', 'bchamfer']);
  const H = R.pick([6, 8, 10, 12].filter((h) => h >= 3 * t + 1)); const W = R.pick([20, 24, 30, 36]), D = R.pick([16, 20, 24]);
  let s = R.wpick([[t, 2], [t + 0.25, 1], [t - 0.25, 1], [2 * t, 1], [R.pick([1, 1.5, 2, 3, 4, 5]), 3]]);
  s = Math.max(0.5, q(s)); if (kind.startsWith('b')) s = Math.min(s, H - 1, D / 2 - 1); else s = Math.min(s, D / 2 - 1);
  const W2 = W / 2, D2 = D / 2; const cmds = [boxCmd('b1', [-W2, W2, -D2, D2, 0, H])];
  const bot = [[0, D2, 0], [0, -D2, 0], [W2, 0, 0], [-W2, 0, 0]], vert = [[W2, D2, H / 2], [-W2, D2, H / 2], [W2, -D2, H / 2], [-W2, -D2, H / 2]];
  const edges = kind[0] === 'v' ? vert : bot;
  cmds.push(kind.endsWith('fillet') ? { command: 'solid.fillet', params: { edges, radius: s, body: 'b1' } } : { command: 'solid.chamfer', params: { edges, distance: s, body: 'b1' } });
  const holes = []; const avoid = []; const meta = [];
  if (R.pick([0, 1, 1])) {
    const hk = R.pick(['vthru', 'cbore', 'csink', 'blind']); const f = makeFeat(R, hk, t, H, true, false);
    const gx = gap(R, t), gy = gap(R, t); const corner = R.pick([0, 1]);
    const xc = corner ? q(W2 - gx - f.wx / 2) : R.U(-W2 + f.wx / 2 + 1, W2 - f.wx / 2 - 1), yc = corner ? q(D2 - gy - f.hy) : R.U(-D2 + f.hy + 1, D2 - f.hy - 1);
    const out = f.place(xc, yc, 'f1', W, D); cmds.push(...out.cmds); holes.push(...out.holes); avoid.push(...(out.avoid || []).filter((a) => a.face === 'top')); meta.push({ kind: f.kind, ...f.meta, xc, yc, corner });
  }
  const m = { t, mode: 'convex', convex: { W, D, H, kind, s }, holes };
  const o = { rect: [-W2, W2, -D2, D2], minus: [], axis: 'z', coord: H };
  const p = pickPoint(o, avoid, 'top'); if (!p) return null;
  return { family: 'convex', t, cmds, shell: shellCmd([p], t), model: m, meta: { W, D, H, kind, s, feats: meta }, desc: `convex ${kind} s=${s} ${W}x${D}x${H}${meta.length ? ' +' + meta[0].kind : ''}` };
}

// ------------------------------------------------------------------ stepped bodies: L / T / U
function steppedCase(R, t, seed, i) {
  const shape = R.pick(['L', 'T', 'U']);
  const D = R.pick([12, 16, 20]), D2 = D / 2; let cmds, m, desc, picks, meta = { shape };
  const g1 = gap(R, t, 0.3);
  const holes = [], mcuts = [];
  const vh = (xc, yc, r, hi) => { cmds.push(...cutCyl('h' + holes.length, 'z', [xc, yc], r, [-1, hi + 1])); holes.push({ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [-1, hi + 1] }); };
  const hh = (xc, zc, r) => { cmds.push(...cutCyl('h' + holes.length, 'y', [xc, zc], r, [-D2 - 1, D2 + 1])); holes.push({ type: 'cyl', axis: 'y', c: [xc, zc], r, range: [-D2 - 1, D2 + 1] }); };
  const doHole = R.pick([0, 1, 1, 2]); const r = R.pick([1, 1.5, 2]);
  if (shape === 'L') {
    const W = R.pick([24, 30, 36]), W2 = W / 2, Hb = R.pick([4, 5, 6]), Hw = R.pick([6, 8, 10]); const ww = R.pick([0, 1]) ? q(Math.max(3 * t, gap(R, t, 0.5) + 2 * t)) : R.pick([5, 8, 10]); const xw = q(W2 - ww);
    const base = [-W2, W2, -D2, D2, 0, Hb], wall = [xw, W2, -D2, D2, Hb, Hb + Hw];
    cmds = [boxCmd('b1', base), ...addBox('w', wall)]; const open = R.pick(['low', 'high']);
    meta = { shape, W, Hb, Hw, ww, open };
    if (doHole === 1) { const where = R.pick(['edge', 'inner']); const web = Math.max(t + 0.05, gap(R, t)); const xc = where === 'edge' ? q(-W2 + web + r) : q(xw - web - r); meta.hole = { where, web, r }; if (xc - r > -W2 && xc + r < xw) vh(xc, 0, r, Hb + Hw); }
    if (doHole === 2) { const g = gap(R, t); const zc = q(Hb + Hw - g - r); meta.hole = { h: true, g, r }; if (zc - r > Hb + 0.1) hh(q(xw + ww / 2), zc, r); }
    m = { t, mode: 'rect', boxes: [base, wall], cuts: [], opens: open === 'low' ? [{ axis: 'z', dir: 1, coord: Hb, rect: [-W2, xw, -D2, D2], minus: [] }] : [{ axis: 'z', dir: 1, coord: Hb + Hw, rect: [xw, W2, -D2, D2], minus: [] }], holes, rbosses: [] };
    picks = open === 'low' ? [[q((-W2 + xw) / 2 + 0.3), 0.7, Hb]] : [[q(xw + ww / 2 + 0.3), 0.7, Hb + Hw]];
    const o = m.opens[0]; const av = holes.filter((h) => h.axis === 'z').map((h) => ({ circ: [h.c[0], h.c[1], h.r + 0.3] })); const p = pickPoint(o, av, 'top'); if (!p) return null; picks = [p];
    desc = `L ${W}x${D} base${Hb} wall${ww}x${Hw} open=${open}`;
  } else if (shape === 'T') {
    const W = R.pick([24, 30]), W2 = W / 2, zc0 = R.pick([6, 8]), th = R.pick([3, 4, 5]); const sw = R.pick([0, 1]) ? Math.max(0.5, gap(R, t, 0.4)) : R.pick([4, 6, 8]); const s = q(sw / 2);
    const cap = [-W2, W2, -D2, D2, zc0, zc0 + th], stem = [-s, s, -D2, D2, 0, zc0];
    cmds = [boxCmd('b1', cap), ...addBox('s', stem)]; const open = R.pick(['top', 'stem', 'under']); meta = { shape, W, zc0, th, stemW: q(sw), open };
    if (doHole === 1) { const web = Math.max(t + 0.05, gap(R, t)); const xc = q(-s - web - r); meta.hole = { web, r }; if (xc - r > -W2) vh(xc, 0, r, zc0 + th); }
    if (doHole === 2) { const g = gap(R, t); const zc = q(zc0 + th - g - r); if (zc - r > zc0 + 0.1) { hh(q(-(W2 + s) / 2), zc, r); meta.hole = { h: true, g, r }; } }
    const op = { top: { axis: 'z', dir: 1, coord: zc0 + th, rect: [-W2, W2, -D2, D2], minus: [] }, stem: { axis: 'z', dir: -1, coord: 0, rect: [-s, s, -D2, D2], minus: [] }, under: { axis: 'z', dir: -1, coord: zc0, rect: [-W2, -s, -D2, D2], minus: [] } }[open];
    m = { t, mode: 'rect', boxes: [cap, stem], cuts: [], opens: [op], holes, rbosses: [] };
    const av = holes.filter((h) => h.axis === 'z').map((h) => ({ circ: [h.c[0], h.c[1], h.r + 0.3] })); const p = pickPoint(op, av, 'top'); if (!p) return null; picks = [p];
    desc = `T ${W}x${D} stem${q(sw)} open=${open}`;
  } else {
    const W = R.pick([24, 30]), W2 = W / 2, Hb = R.pick([3, 4, 5]), Hw = R.pick([6, 8]); const ww = R.pick([0, 1]) ? q(Math.max(0.5, gap(R, t, 0.4)) + 1) : R.pick([3, 4, 6]);
    const base = [-W2, W2, -D2, D2, 0, Hb], w1 = [-W2, -W2 + ww, -D2, D2, Hb, Hb + Hw], w2 = [W2 - ww, W2, -D2, D2, Hb, Hb + Hw];
    cmds = [boxCmd('b1', base), ...addBox('a', w1), ...addBox('b', w2)]; const open = R.pick(['wallTop', 'floor']); meta = { shape, W, Hb, Hw, ww, open };
    if (doHole === 1) { const where = R.pick(['floor', 'wall']); if (where === 'floor') { const xc = q(R.U(-W2 + ww + 3, W2 - ww - 3)); vh(xc, 0, r, Hb + Hw); meta.hole = { where, r }; } else if (ww > 2 * r + 0.2) { vh(q(-W2 + ww / 2), 0, r, Hb + Hw); meta.hole = { where, r }; } }
    if (doHole === 2) { const g = gap(R, t); const zc = q(Hb + Hw - g - r); if (zc - r > Hb + 0.1) { hh(q(-W2 + ww / 2), zc, r); meta.hole = { h: true, g, r }; } }
    const op = { wallTop: { axis: 'z', dir: 1, coord: Hb + Hw, rect: [-W2, -W2 + ww, -D2, D2], minus: [] }, floor: { axis: 'z', dir: 1, coord: Hb, rect: [-W2 + ww, W2 - ww, -D2, D2], minus: [] } }[open];
    m = { t, mode: 'rect', boxes: [base, w1, w2], cuts: [], opens: [op], holes, rbosses: [] };
    const av = holes.filter((h) => h.axis === 'z').map((h) => ({ circ: [h.c[0], h.c[1], h.r + 0.3] })); const p = pickPoint(op, av, 'top'); if (!p) return null; picks = [p];
    desc = `U ${W}x${D} wall${ww} open=${open}`;
  }
  return { family: 'stepped', t, cmds, shell: shellCmd(picks, t), model: m, meta, desc };
}

export function genCase(seed, i) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const R = mk(rng32(seed * 1000003 + i * 7919 + attempt * 104729));
    const t = R.pick(T_LIST);
    const fam = R.wpick([['plate', 70], ['convex', 15], ['stepped', 15]]);
    let c = null;
    try { c = fam === 'plate' ? plateCase(R, t, seed, i) : fam === 'convex' ? convexCase(R, t, seed, i) : steppedCase(R, t, seed, i); } catch (e) { c = null; if (process.env.GEN_DEBUG) console.error(e); }
    if (c) { c.id = `s${seed}-${String(i).padStart(5, '0')}`; c.seed = seed; c.index = i; return c; }
  }
  return null;
}
