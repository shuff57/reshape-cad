// Independent oracle for solid.shell: "plane-offset" model P.
//   P = vol(S) - vol(C)
//   S = the body.  C = the cavity = cube (L-inf) erosion by t of S' = S0 u ext, then minus the plane-offset of every
//   round hole (cylinder r+t with caps +-t; cone: miter offset), plus (as add-ons) round bosses standing on an open face.
//   ext = every open face region extruded outward by t (so the opening is not walled up).
// Cube erosion == plane offset for axis-aligned rectilinear bodies (sharp inside corners). Round features cannot go
// through a cube erosion, so they are applied analytically on top (the c8 recipe, rewritten from scratch here).
// 'convex' models (edge fillet/chamfer on a plain plate) use analytic membership predicates (offset of each face).
// euclid() is an independent cross-check by true Euclidean-ball erosion (EDT), valid only when the body's
// complement has no convex corners (through-hole / countersink plates).
//
// model = { t, mode:'rect'|'convex',
//   rect:   boxes:[[x0,x1,y0,y1,z0,z1]], cuts:[box], opens:[{axis,dir,coord,rect:[a0,a1,b0,b1],minus:[rect],minusC:[[ca,cb,r]]}],
//           holes:[{type:'cyl',axis,c:[a,b],r,range:[lo,hi]} | {type:'cone',c,rb,zb,rt,zt,r,range}], rbosses:[{c,r,z0,z1}]
//   convex: convex:{W,D,H,kind:'vfillet'|'vchamfer'|'bfillet'|'bchamfer',s}, holes }
export const DEF_H = 0.05;
const AX = { x: [1, 2, 0], y: [0, 2, 1], z: [0, 1, 2] }; // [first in-plane dim, second in-plane dim, normal dim]

export function holeShapes(hl, t) {
  if (hl.type === 'cyl') {
    const ax = hl.axis || 'z';
    const [a0, a1, al] = AX[ax];
    const mk = (r, e) => {
      const lo = [-1e9, -1e9, -1e9], hi = [1e9, 1e9, 1e9];
      lo[a0] = hl.c[0] - r; hi[a0] = hl.c[0] + r; lo[a1] = hl.c[1] - r; hi[a1] = hl.c[1] + r; lo[al] = hl.range[0] - e; hi[al] = hl.range[1] + e;
      return { lo, hi, a0, a1, al, cc: hl.c, r, alo: hl.range[0] - e, ahi: hl.range[1] + e, cyl: true, inside: (p) => (p[a0] - hl.c[0]) ** 2 + (p[a1] - hl.c[1]) ** 2 < r * r };
    };
    return { solid: [mk(hl.r, 0)], offset: [mk(hl.r + t, t)] };
  }
  if (hl.type === 'cone') { // z axis frustum, radius rb at zb, rt at zt; plus the through cylinder
    const s = (hl.rt - hl.rb) / (hl.zt - hl.zb), q = Math.sqrt(1 + s * s);
    const mk = (e, tt) => {
      const rmax = Math.max(hl.rt, hl.rb) + 2 * tt * q + Math.abs(s) * tt + 0.1;
      const zlo = hl.zb - (e ? 2 * e : 0), zhi = hl.zt + e;
      return { lo: [hl.c[0] - rmax, hl.c[1] - rmax, zlo], hi: [hl.c[0] + rmax, hl.c[1] + rmax, zhi],
        inside: (p) => Math.hypot(p[0] - hl.c[0], p[1] - hl.c[1]) < hl.rb + s * (p[2] - hl.zb) + tt * q };
    };
    const cyl = holeShapes({ type: 'cyl', c: hl.c, r: hl.r, range: hl.range }, t);
    return { solid: [mk(0, 0), ...cyl.solid], offset: [mk(t, t), ...cyl.offset] };
  }
  throw new Error('hole type ' + hl.type);
}

function carve(arr, shapes, lo, dims, h, val = 0) { // binary, centre sampled (used by euclid only)
  const [nx, ny, nz] = dims; const p = [0, 0, 0];
  for (const sh of shapes) {
    const r = [0, 1, 2].map((a) => [Math.max(0, Math.floor((sh.lo[a] - lo[a]) / h)), Math.min(dims[a], Math.ceil((sh.hi[a] - lo[a]) / h))]);
    for (let i = r[0][0]; i < r[0][1]; i++) { p[0] = lo[0] + (i + 0.5) * h; for (let j = r[1][0]; j < r[1][1]; j++) { p[1] = lo[1] + (j + 0.5) * h; const o = (i * ny + j) * nz; for (let k = r[2][0]; k < r[2][1]; k++) { p[2] = lo[2] + (k + 0.5) * h; if (sh.inside(p)) arr[o + k] = val; } } }
  }
}
const FULL = 64;
// coverage-weighted carve/add: arr holds 0..64 (sixteenths of nothing: 64 = full cell). mode 'min' removes (arr=min(arr,64-cov)), 'max' adds.
function carveW(arr, shapes, lo, dims, h, mode = 'min') {
  const stride = [dims[1] * dims[2], dims[2], 1];
  const apply = (idx, cov) => { if (mode === 'min') { const v = FULL - cov; if (arr[idx] > v) arr[idx] = v; } else if (arr[idx] < cov) arr[idx] = cov; };
  for (const sh of shapes) {
    if (sh.cyl) {
      const { a0, a1, al, cc, r } = sh;
      const ia0 = Math.max(0, Math.floor((cc[0] - r - lo[a0]) / h)), ia1 = Math.min(dims[a0], Math.ceil((cc[0] + r - lo[a0]) / h));
      const ib0 = Math.max(0, Math.floor((cc[1] - r - lo[a1]) / h)), ib1 = Math.min(dims[a1], Math.ceil((cc[1] + r - lo[a1]) / h));
      const k0 = Math.max(0, Math.round((sh.alo - lo[al]) / h)), k1 = Math.min(dims[al], Math.round((sh.ahi - lo[al]) / h));
      for (let ia = ia0; ia < ia1; ia++) for (let ib = ib0; ib < ib1; ib++) {
        const u0 = lo[a0] + ia * h, v0 = lo[a1] + ib * h; const cov = cov2d(u0, v0, h, cc[0], cc[1], r);
        if (!cov) continue; const base = ia * stride[a0] + ib * stride[a1];
        for (let k = k0; k < k1; k++) apply(base + k * stride[al], cov);
      }
    } else {
      const r = [0, 1, 2].map((a) => [Math.max(0, Math.floor((sh.lo[a] - lo[a]) / h)), Math.min(dims[a], Math.ceil((sh.hi[a] - lo[a]) / h))]);
      const p = [0, 0, 0]; const ns = 4;
      for (let i = r[0][0]; i < r[0][1]; i++) for (let j = r[1][0]; j < r[1][1]; j++) for (let k = r[2][0]; k < r[2][1]; k++) {
        const x0 = lo[0] + i * h, y0 = lo[1] + j * h, z0 = lo[2] + k * h; let nin = 0;
        for (let c = 0; c < 8; c++) { p[0] = x0 + (c & 1) * h; p[1] = y0 + ((c >> 1) & 1) * h; p[2] = z0 + ((c >> 2) & 1) * h; if (sh.inside(p)) nin++; }
        let cov;
        if (nin === 8) cov = FULL; else if (nin === 0) continue;
        else { cov = 0; for (let a = 0; a < ns; a++) for (let b = 0; b < ns; b++) for (let c = 0; c < ns; c++) { p[0] = x0 + (a + 0.5) * h / ns; p[1] = y0 + (b + 0.5) * h / ns; p[2] = z0 + (c + 0.5) * h / ns; if (sh.inside(p)) cov++; } }
        if (cov) apply((i * dims[1] + j) * dims[2] + k, cov);
      }
    }
  }
}
function cov2d(u0, v0, h, cx, cy, r) { // number of 64 sub-samples (8x8) of the cell [u0,u0+h]x[v0,v0+h] inside the disc
  const r2 = r * r; let nin = 0;
  for (let c = 0; c < 4; c++) { const u = u0 + (c & 1) * h - cx, v = v0 + (c >> 1) * h - cy; if (u * u + v * v < r2) nin++; }
  if (nin === 4) return FULL;
  const du = Math.max(u0 - cx, 0, cx - (u0 + h)), dv = Math.max(v0 - cy, 0, cy - (v0 + h)); if (du * du + dv * dv >= r2) return 0;
  let n = 0; for (let a = 0; a < 8; a++) { const u = u0 + (a + 0.5) * h / 8 - cx; for (let b = 0; b < 8; b++) { const v = v0 + (b + 0.5) * h / 8 - cy; if (u * u + v * v < r2) n++; } }
  return n;
}

const DIM = { x: 0, y: 1, z: 2 };
function openSlab(o, t, model) { // box [x0,x1,y0,y1,z0,z1] of the extension of an open face region
  const [d0, d1, dn] = AX[o.axis]; const b = [0, 0, 0, 0, 0, 0]; const rect = o.rect.slice();
  // adjacent open faces: the extension also spans the corner block next to them (the cavity is bounded only by the faces that stay)
  for (const other of (model && model.opens) || []) {
    if (other === o || other.axis === o.axis) continue; const di = DIM[other.axis];
    if (di === d0) { if (other.dir < 0 && Math.abs(rect[0] - other.coord) < 1e-9) rect[0] -= t; if (other.dir > 0 && Math.abs(rect[1] - other.coord) < 1e-9) rect[1] += t; }
    if (di === d1) { if (other.dir < 0 && Math.abs(rect[2] - other.coord) < 1e-9) rect[2] -= t; if (other.dir > 0 && Math.abs(rect[3] - other.coord) < 1e-9) rect[3] += t; }
  }
  b[2 * d0] = rect[0]; b[2 * d0 + 1] = rect[1]; b[2 * d1] = rect[2]; b[2 * d1 + 1] = rect[3];
  b[2 * dn] = Math.min(o.coord, o.coord + o.dir * t); b[2 * dn + 1] = Math.max(o.coord, o.coord + o.dir * t);
  return b;
}

function grid(model, h, pad) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  const add = (b) => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b[2 * a]); hi[a] = Math.max(hi[a], b[2 * a + 1]); } };
  for (const b of model.boxes) add(b);
  for (const o of model.opens) add(openSlab(o, model.t, model));
  for (const r of model.rbosses || []) add([r.c[0] - r.r, r.c[0] + r.r, r.c[1] - r.r, r.c[1] + r.r, r.z0, r.z1]);
  lo = lo.map((v) => Math.floor((v - pad) / h + 1e-9) * h); hi = hi.map((v) => Math.ceil((v + pad) / h - 1e-9) * h);
  const dims = [0, 1, 2].map((a) => Math.round((hi[a] - lo[a]) / h));
  return { lo, dims };
}
function fillBox(arr, b, v, lo, dims, h) {
  const [, ny, nz] = dims;
  const r = [0, 1, 2].map((a) => [Math.max(0, Math.round((b[2 * a] - lo[a]) / h)), Math.min(dims[a], Math.round((b[2 * a + 1] - lo[a]) / h))]);
  for (let i = r[0][0]; i < r[0][1]; i++) for (let j = r[1][0]; j < r[1][1]; j++) { const o = (i * ny + j) * nz; if (r[2][1] > r[2][0]) arr.fill(v, o + r[2][0], o + r[2][1]); }
}
function buildS(model, h, pad) {
  const { lo, dims } = grid(model, h, pad); const N = dims[0] * dims[1] * dims[2];
  const S0 = new Uint8Array(N);
  for (const b of model.boxes) fillBox(S0, b, FULL, lo, dims, h);
  for (const b of model.cuts || []) fillBox(S0, b, 0, lo, dims, h);
  return { lo, dims, S0 };
}

// separable cube erosion, half side k voxels (outside the array counts as empty)
function erode(a, nx, ny, nz, k) {
  const line = (len, stride, starts) => {
    const src = new Uint8Array(len), L = new Int32Array(len);
    for (const s0 of starts) {
      let any = false;
      for (let i = 0; i < len; i++) { const v = a[s0 + i * stride]; src[i] = v; if (v) any = true; }
      if (!any) continue;
      let run = 0; for (let i = 0; i < len; i++) { run = src[i] ? run + 1 : 0; L[i] = run; }
      run = 0; for (let i = len - 1; i >= 0; i--) { run = src[i] ? run + 1 : 0; a[s0 + i * stride] = (L[i] >= k + 1 && run >= k + 1) ? FULL : 0; }
    }
  };
  const st = (n1, n2, f) => { const o = []; for (let u = 0; u < n1; u++) for (let v = 0; v < n2; v++) o.push(f(u, v)); return o; };
  line(nz, 1, st(nx, ny, (i, j) => (i * ny + j) * nz));
  line(ny, nz, st(nx, nz, (i, kk) => i * ny * nz + kk));
  line(nx, ny * nz, st(ny, nz, (j, kk) => j * nz + kk));
}

export function oracle(model, { h = DEF_H, sliver = 0 } = {}) {
  return model.mode === 'convex' ? convexP(model, h) : rectP(model, h, sliver);
}

function rectP(model, h, sliver = 0) {
  const t = model.t; const pad = t + 3 * h;
  const { lo, dims, S0 } = buildS(model, h, pad); const [nx, ny, nz] = dims; const N = S0.length;
  const Sp = Uint8Array.from(S0);
  for (const o of model.opens) {
    const slab = openSlab(o, t, model);
    const [d0, d1] = AX[o.axis];
    const r = [0, 1, 2].map((a) => [Math.max(0, Math.round((slab[2 * a] - lo[a]) / h)), Math.min(dims[a], Math.round((slab[2 * a + 1] - lo[a]) / h))]);
    const idx3 = [0, 0, 0];
    for (let i = r[0][0]; i < r[0][1]; i++) for (let j = r[1][0]; j < r[1][1]; j++) for (let k = r[2][0]; k < r[2][1]; k++) {
      idx3[0] = i; idx3[1] = j; idx3[2] = k;
      const u = lo[d0] + (idx3[d0] + 0.5) * h, v = lo[d1] + (idx3[d1] + 0.5) * h;
      let skip = false;
      for (const m of o.minus || []) if (u > m[0] && u < m[1] && v > m[2] && v < m[3]) { skip = true; break; }
      if (!skip) Sp[(i * ny + j) * nz + k] = FULL;
    }
  }
  erode(Sp, nx, ny, nz, Math.round(t / h));
  // round bosses: part of S; cavity add-on (r-t) from z0 to z1-t
  for (const rb of model.rbosses || []) {
    const mkc = (rr, z0, z1) => ({ cyl: true, a0: 0, a1: 1, al: 2, cc: rb.c, r: rr, alo: z0, ahi: z1 });
    carveW(S0, [mkc(rb.r, rb.z0, rb.z1)], lo, dims, h, 'max');
    if (rb.r > t && rb.z1 - rb.z0 > t) carveW(Sp, [mkc(rb.r - t, rb.z0, rb.z1 - t)], lo, dims, h, 'max');
  }
  for (const hl of model.holes || []) {
    const sh = holeShapes(hl, t);
    carveW(S0, sh.solid, lo, dims, h); carveW(Sp, sh.offset, lo, dims, h);
  }
  if (sliver > 0) { // explanatory variant: drop every part of the cavity thinner than `sliver` (morphological opening by a cube)
    const kk = Math.max(1, Math.round(sliver / h / 2));
    for (let i = 0; i < N; i++) Sp[i] = Math.min(Sp[i], S0[i]) >= FULL / 2 ? FULL : 0;
    erode(Sp, nx, ny, nz, kk - 1 < 0 ? 0 : kk - 1); dilate(Sp, nx, ny, nz, kk - 1 < 0 ? 0 : kk - 1);
  }
  let cs = 0, cc = 0;
  for (let i = 0; i < N; i++) { const a = S0[i]; if (a) { cs += a; const b = Sp[i]; cc += b < a ? b : a; } }
  const hv = h ** 3 / FULL;
  return { S: cs * hv, C: cc * hv, P: (cs - cc) * hv };
}
function dilate(a, nx, ny, nz, k) {
  const line = (len, stride, starts) => {
    const src = new Uint8Array(len);
    for (const s0 of starts) {
      let any = false; for (let i = 0; i < len; i++) { src[i] = a[s0 + i * stride] ? 1 : 0; if (src[i]) any = true; }
      if (!any) continue;
      const pre = new Int32Array(len + 1); for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src[i];
      for (let i = 0; i < len; i++) { const lo = Math.max(0, i - k), hi = Math.min(len, i + k + 1); a[s0 + i * stride] = pre[hi] - pre[lo] > 0 ? FULL : 0; }
    }
  };
  const st = (n1, n2, f) => { const o = []; for (let u = 0; u < n1; u++) for (let v = 0; v < n2; v++) o.push(f(u, v)); return o; };
  line(nz, 1, st(nx, ny, (i, j) => (i * ny + j) * nz));
  line(ny, nz, st(nx, nz, (i, kk) => i * ny * nz + kk));
  line(nx, ny * nz, st(ny, nz, (j, kk) => j * nz + kk));
}

// ---------- convex plates with an edge treatment: exact per-column z intervals, xy supersampled ----------
function convexP(model, h) {
  const t = model.t, { W, D, H, kind, s } = model.convex; const W2 = W / 2, D2 = D / 2; const S2 = Math.SQRT2;
  const rr = (x, y, R, off) => { const a0 = -W2 + off, a1 = W2 - off, b0 = -D2 + off, b1 = D2 - off; if (x < a0 || x > a1 || y < b0 || y > b1) return false; if (R <= 0) return true; const cx = x < a0 + R ? a0 + R : x > a1 - R ? a1 - R : x; const cy = y < b0 + R ? b0 + R : y > b1 - R ? b1 - R : y; return (x - cx) ** 2 + (y - cy) ** 2 <= R * R; };
  const NONE = null;
  // z-interval [lo,hi] of the body (isC=false) or the plane-offset cavity (isC=true) in column (x,y)
  const col = (x, y, isC) => {
    const ax = Math.abs(x), ay = Math.abs(y); const o = isC ? t : 0; const z0 = isC ? t : 0;
    if (ax >= W2 - o || ay >= D2 - o) return NONE;
    if (kind === 'vfillet') return rr(x, y, isC ? Math.max(s - t, 0) : s, o) ? [z0, H] : NONE;
    if (kind === 'vchamfer') return ax + ay <= W2 + D2 - s - (isC ? t * S2 : 0) ? [z0, H] : NONE;
    if (kind === 'bchamfer') { const k = isC ? t * S2 : 0; const zb = Math.max(z0, ax - (W2 - s - k), ay - (D2 - s - k)); return zb < H ? [zb, H] : NONE; }
    if (kind === 'bfillet') {
      if (isC && s <= t) return [z0, H];
      const RR = isC ? s - t : s; const ux = Math.max(0, ax - (W2 - s)), uy = Math.max(0, ay - (D2 - s));
      if (ux > RR || uy > RR) return NONE;
      const zb = Math.max(z0, s - Math.sqrt(RR * RR - ux * ux), s - Math.sqrt(RR * RR - uy * uy)); return zb < H ? [zb, H] : NONE;
    }
    throw new Error('convex kind ' + kind);
  };
  const holeInts = (x, y, isC) => {
    const out = [];
    for (const hl of model.holes || []) {
      const cx = hl.c[0], cy = hl.c[1]; const rho = Math.hypot(x - cx, y - cy); const e = isC ? t : 0;
      if (hl.type === 'cone') {
        const sl = (hl.rt - hl.rb) / (hl.zt - hl.zb), q = Math.sqrt(1 + sl * sl); const zlo = hl.zb - (isC ? 2 * t : 0), zhi = hl.zt + e; const c = isC ? t * q : 0;
        const zz = hl.zb + (rho - c - hl.rb) / sl;
        if (sl > 0) out.push([Math.max(zlo, zz), zhi]); else out.push([zlo, Math.min(zhi, zz)]);
      }
      if (rho < hl.r + e) out.push([hl.range[0] - e, hl.range[1] + e]);
    }
    return out;
  };
  const lenMinus = (iv, cuts) => {
    if (!iv) return 0; let [a, b] = iv; let len = b - a; if (len <= 0) return 0;
    const cs = cuts.map(([c0, c1]) => [Math.max(a, c0), Math.min(b, c1)]).filter(([c0, c1]) => c1 > c0).sort((p, q) => p[0] - q[0]);
    let cur = a, cov = 0; for (const [c0, c1] of cs) { const lo2 = Math.max(c0, cur); if (c1 > lo2) { cov += c1 - lo2; cur = c1; } }
    return len - cov;
  };
  const ns = 4, hs = h / ns; let vs = 0, vc = 0; let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; // stratified jitter: diagonal boundaries on the sample lattice would bias a fixed pattern
  const nx = Math.round(W / h), ny = Math.round(D / h);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let a = 0; a < ns; a++) for (let b = 0; b < ns; b++) {
    const x = -W2 + i * h + (a + rnd()) * hs, y = -D2 + j * h + (b + rnd()) * hs;
    const iv = col(x, y, false); if (!iv) continue;
    vs += lenMinus(iv, holeInts(x, y, false));
    const ic = col(x, y, true); if (ic) vc += lenMinus(ic, holeInts(x, y, true));
  }
  const ar = hs * hs;
  return { S: vs * ar, C: vc * ar, P: (vs - vc) * ar };
}

function mouths(model, o) { // circles where round z-axis holes break an open z-face (euclid cross-check only)
  const out = [];
  if (o.axis !== 'z') return out;
  for (const hl of model.holes || []) {
    if (hl.type === 'cyl' && (hl.axis || 'z') === 'z' && hl.range[0] < o.coord && hl.range[1] > o.coord) out.push([hl.c[0], hl.c[1], hl.r]);
    if (hl.type === 'cone') { const s = (hl.rt - hl.rb) / (hl.zt - hl.zb); if (o.coord >= hl.zb - 1e-9 && o.coord <= hl.zt + 1e-9) out.push([hl.c[0], hl.c[1], hl.rb + s * (o.coord - hl.zb)]); }
  }
  return out;
}
// ---------- Euclidean-ball erosion cross-check (rect models whose complement is convex-cornered only) ----------
export function euclid(model, { h = DEF_H } = {}) {
  const t = model.t; const pad = t + 3 * h;
  const { lo, dims, S0 } = buildS(model, h, pad); const [nx, ny, nz] = dims; const N = S0.length;
  const Sp = Uint8Array.from(S0);
  for (const o of model.opens) {
    const slab = openSlab(o, t, model); const [d0, d1] = AX[o.axis];
    const r = [0, 1, 2].map((a) => [Math.max(0, Math.round((slab[2 * a] - lo[a]) / h)), Math.min(dims[a], Math.round((slab[2 * a + 1] - lo[a]) / h))]);
    const q = [0, 0, 0];
    for (let i = r[0][0]; i < r[0][1]; i++) for (let j = r[1][0]; j < r[1][1]; j++) for (let k = r[2][0]; k < r[2][1]; k++) {
      q[0] = i; q[1] = j; q[2] = k; const u = lo[d0] + (q[d0] + 0.5) * h, v = lo[d1] + (q[d1] + 0.5) * h;
      let skip = false;
      for (const m of o.minus || []) if (u > m[0] && u < m[1] && v > m[2] && v < m[3]) skip = true;
      if (!skip) Sp[(i * ny + j) * nz + k] = 1;
    }
  }
  const S0only = Uint8Array.from(S0);
  // the walls of the opening continue through the extension (cone keeps its slope), so no artificial lid edge appears
  for (const hl0 of model.holes || []) {
    let hl = hl0;
    if (hl0.type === 'cone') { const sl = (hl0.rt - hl0.rb) / (hl0.zt - hl0.zb), ex = t + 3 * h; hl = { ...hl0, zb: hl0.zb - ex, rb: hl0.rb - sl * ex, zt: hl0.zt + ex, rt: hl0.rt + sl * ex }; }
    const sh = holeShapes(hl, t); carve(S0only, sh.solid, lo, dims, h); carve(Sp, sh.solid, lo, dims, h);
  }
  // squared EDT (to nearest 0 voxel), Felzenszwalb, in voxel units
  const INF = 1e10; const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = Sp[i] ? INF : 0;
  const edt1 = (len, stride, starts) => {
    const d = new Float64Array(len), v = new Int32Array(len), z = new Float64Array(len + 1), g = new Float64Array(len);
    for (const s0 of starts) {
      for (let i = 0; i < len; i++) g[i] = f[s0 + i * stride];
      let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let q = 1; q < len; q++) {
        let sx = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (sx <= z[k]) { k--; sx = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = sx; z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + g[v[k]]; }
      for (let i = 0; i < len; i++) f[s0 + i * stride] = d[i];
    }
  };
  const st = (n1, n2, fn) => { const o = []; for (let u = 0; u < n1; u++) for (let w = 0; w < n2; w++) o.push(fn(u, w)); return o; };
  edt1(nz, 1, st(nx, ny, (i, j) => (i * ny + j) * nz));
  edt1(ny, nz, st(nx, nz, (i, k) => i * ny * nz + k));
  edt1(nx, ny * nz, st(ny, nz, (j, k) => j * nz + k));
  // voxel c is in cavity iff distance(center, nearest empty center) - h/2 >= t  (exact for axis-aligned faces)
  const thr = ((t + h / 2) / h) ** 2 - 1e-9;
  let cs = 0, cc = 0;
  for (let i = 0; i < N; i++) { if (S0only[i]) { cs++; if (Sp[i] && f[i] >= thr) cc++; } }
  const hv = h ** 3;
  return { S: cs * hv, C: cc * hv, P: (cs - cc) * hv };
}
