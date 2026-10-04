// Closed-form / numeric oracles for the wrong-solid sweep. None of this reads either kernel.
//
// exactPair(a, b): exact volume of the intersection of two axis-aligned-about-z solids drawn from
// {box, cylinder, sphere, cone}. The cross-section of each at height z is a rectangle or a disk, so
// V(A n B) = integral over z of area(section_A(z) n section_B(z)) dz, done with adaptive Simpson
// (kinks cost depth, not accuracy). V(A u B) = V(A)+V(B)-V(A n B); V(A - B) = V(A)-V(A n B).
// numericVolume(node): midpoint-grid membership volume for any CSG tree of those primitives
// (about 0.1% accurate at the grid used; a coarse third opinion only).

export const PI = Math.PI;

// ---- plain volumes -------------------------------------------------------------------------
export function primVolume(p) {
  switch (p.kind) {
    case 'box': return p.s[0] * p.s[1] * p.s[2];
    case 'cylinder': return PI * p.r * p.r * p.h;
    case 'sphere': return (4 / 3) * PI * p.r ** 3;
    case 'cone': return (PI * p.r * p.r * p.h) / 3;
    case 'torus': return 2 * PI * PI * p.R * p.r * p.r;
    case 'prism': return 0.5 * p.n * p.R * p.R * Math.sin((2 * PI) / p.n) * p.h;
    case 'wedge': return (p.s[0] * p.s[1] * p.s[2]) / 2;
  }
  return NaN;
}

// ---- 2D areas ------------------------------------------------------------------------------
const S = (x, r) => 0.5 * (x * Math.sqrt(Math.max(0, r * r - x * x)) + r * r * Math.asin(Math.max(-1, Math.min(1, x / r))));
const integS = (p, q, r) => { // integral of sqrt(r^2-x^2) on [p,q] clipped to [-r,r]
  p = Math.max(p, -r); q = Math.min(q, r);
  return q > p ? S(q, r) - S(p, r) : 0;
};
// area of {x<a, y<b} within the disk of radius r about the origin
function G(a, b, r) {
  if (r <= 0 || b <= -r) return 0;
  const aa = Math.max(-r, Math.min(a, r));
  if (b >= r) return 2 * integS(-r, aa, r);
  const c = Math.sqrt(r * r - b * b);
  const lenOver = (p, q) => Math.max(0, Math.min(q, aa) - Math.max(p, -r)); // overlap length of [p,q] with (-r, aa]
  if (b >= 0) {
    // |x|>=c: 2s ; |x|<c: b+s
    return 2 * (integS(-r, Math.min(-c, aa), r)) + 2 * (aa > c ? integS(c, aa, r) : 0)
      + (aa > -c ? b * (Math.min(aa, c) + c) + integS(-c, Math.min(aa, c), r) : 0);
  }
  // -r < b < 0: only |x|<c, integrand b+s
  return aa > -c ? b * (Math.min(aa, c) + c) + integS(-c, Math.min(aa, c), r) : 0;
}
// disk (radius r, centre origin) n rectangle [x1,x2]x[y1,y2]
export function diskRect(r, x1, x2, y1, y2) {
  if (r <= 0) return 0;
  return G(x2, y2, r) - G(x1, y2, r) - G(x2, y1, r) + G(x1, y1, r);
}
// disk-disk lens
export function diskDisk(r1, r2, d) {
  if (r1 <= 0 || r2 <= 0) return 0;
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}
const rectRect = (a, b) => {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
};

// cross-section of a primitive at height z: {rect:{x1,x2,y1,y2}} | {disk:{cx,cy,r}} | null
function section(p, z) {
  switch (p.kind) {
    case 'box': {
      if (z < p.c[2] - p.s[2] / 2 || z > p.c[2] + p.s[2] / 2) return null;
      return { rect: { x1: p.c[0] - p.s[0] / 2, x2: p.c[0] + p.s[0] / 2, y1: p.c[1] - p.s[1] / 2, y2: p.c[1] + p.s[1] / 2 } };
    }
    case 'cylinder': {
      if (z < p.c[2] - p.h / 2 || z > p.c[2] + p.h / 2) return null;
      return { disk: { cx: p.c[0], cy: p.c[1], r: p.r } };
    }
    case 'sphere': {
      const dz = z - p.c[2];
      if (Math.abs(dz) >= p.r) return null;
      return { disk: { cx: p.c[0], cy: p.c[1], r: Math.sqrt(p.r * p.r - dz * dz) } };
    }
    case 'cone': {
      const t = (z - (p.c[2] - p.h / 2)) / p.h;
      if (t < 0 || t >= 1) return null;
      return { disk: { cx: p.c[0], cy: p.c[1], r: p.r * (1 - t) } };
    }
  }
  return null;
}
function zRange(p) {
  switch (p.kind) {
    case 'box': return [p.c[2] - p.s[2] / 2, p.c[2] + p.s[2] / 2];
    case 'cylinder': case 'cone': return [p.c[2] - p.h / 2, p.c[2] + p.h / 2];
    case 'sphere': return [p.c[2] - p.r, p.c[2] + p.r];
  }
  return [0, 0];
}
function secArea(sa, sb) {
  if (!sa || !sb) return 0;
  if (sa.rect && sb.rect) return rectRect(sa.rect, sb.rect);
  if (sa.disk && sb.disk) return diskDisk(sa.disk.r, sb.disk.r, Math.hypot(sa.disk.cx - sb.disk.cx, sa.disk.cy - sb.disk.cy));
  const dk = sa.disk ?? sb.disk, rc = sa.rect ?? sb.rect;
  return diskRect(dk.r, rc.x1 - dk.cx, rc.x2 - dk.cx, rc.y1 - dk.cy, rc.y2 - dk.cy);
}
function adaptive(f, a, b, eps) {
  const simpson = (fa, fm, fb, h) => (h / 6) * (fa + 4 * fm + fb);
  const rec = (a, b, fa, fm, fb, whole, eps, depth) => {
    const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
    const flm = f(lm), frm = f(rm);
    const left = simpson(fa, flm, fm, m - a), right = simpson(fm, frm, fb, b - m);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return rec(a, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b, fm, frm, fb, right, eps / 2, depth - 1);
  };
  // 16 panels first so a narrow feature is not skipped by the first Simpson sample
  const N = 16; let tot = 0;
  for (let i = 0; i < N; i++) {
    const lo = a + ((b - a) * i) / N, hi = a + ((b - a) * (i + 1)) / N;
    const fa = f(lo), fm = f((lo + hi) / 2), fb = f(hi);
    tot += rec(lo, hi, fa, fm, fb, simpson(fa, fm, fb, hi - lo), eps / N, 34);
  }
  return tot;
}
export function exactIntersection(a, b) {
  const lo = Math.max(zRange(a)[0], zRange(b)[0]), hi = Math.min(zRange(a)[1], zRange(b)[1]);
  if (!(hi > lo)) return 0;
  const scale = Math.max(1, primVolume(a), primVolume(b));
  // sample strictly inside (lo,hi) at the ends: a sphere's section is 0 at its poles
  return adaptive((z) => secArea(section(a, z), section(b, z)), lo, hi, 1e-12 * scale);
}
export function exactPair(op, a, b) {
  const va = primVolume(a), vb = primVolume(b), vi = exactIntersection(a, b);
  return op === 'union' ? va + vb - vi : op === 'subtract' ? va - vi : vi;
}

// ---- membership + midpoint-grid volume for a CSG tree ----------------------------------------
// node: {t:'prim', kind, c, ...} | {t:'tool', axis, c, r, lo, hi} | {t:'op', op, a, b}
export function inside(n, x, y, z) {
  switch (n.t) {
    case 'op': {
      const ia = inside(n.a, x, y, z);
      if (n.op === 'subtract') return ia && !inside(n.b, x, y, z);
      const ib = inside(n.b, x, y, z);
      return n.op === 'union' ? ia || ib : ia && ib;
    }
    case 'tool': {
      const p = [x, y, z], ax = n.axis;
      const u = [0, 1, 2].filter((k) => k !== ax);
      const du = p[u[0]] - n.c[u[0]], dv = p[u[1]] - n.c[u[1]];
      return du * du + dv * dv <= n.r * n.r && p[ax] >= n.lo && p[ax] <= n.hi;
    }
    case 'csink': {
      const p = [x, y, z], ax = n.axis;
      const u = [0, 1, 2].filter((k) => k !== ax);
      const depth = n.rm - n.rb, down = n.top - p[ax];
      if (down < 0 || down > depth) return false;
      return Math.hypot(p[u[0]] - n.c[u[0]], p[u[1]] - n.c[u[1]]) <= n.rb + (n.rm - n.rb) * (1 - down / depth);
    }
    case 'prim': {
      const dx = x - n.c[0], dy = y - n.c[1], dz = z - n.c[2];
      switch (n.kind) {
        case 'box': return Math.abs(dx) <= n.s[0] / 2 && Math.abs(dy) <= n.s[1] / 2 && Math.abs(dz) <= n.s[2] / 2;
        case 'cylinder': return dx * dx + dy * dy <= n.r * n.r && Math.abs(dz) <= n.h / 2;
        case 'sphere': return dx * dx + dy * dy + dz * dz <= n.r * n.r;
        case 'cone': { const t = (dz + n.h / 2) / n.h; return t >= 0 && t <= 1 && Math.hypot(dx, dy) <= n.r * (1 - t); }
        case 'torus': { const q = Math.hypot(dx, dy) - n.R; return q * q + dz * dz <= n.r * n.r; }
      }
    }
  }
  return false;
}
export function nodeBounds(n) {
  if (n.t === 'op') {
    const a = nodeBounds(n.a), b = nodeBounds(n.b);
    return [[0, 1, 2].map((k) => Math.min(a[0][k], b[0][k])), [0, 1, 2].map((k) => Math.max(a[1][k], b[1][k]))];
  }
  if (n.t === 'csink') return [[0, 0, 0], [0, 0, 0]];
  if (n.t === 'tool') {
    const lo = [0, 1, 2].map((k) => n.c[k] - n.r), hi = [0, 1, 2].map((k) => n.c[k] + n.r);
    lo[n.axis] = Math.max(n.lo, -1e4); hi[n.axis] = Math.min(n.hi, 1e4);
    return [lo, hi];
  }
  const { c } = n;
  switch (n.kind) {
    case 'box': return [[0, 1, 2].map((k) => c[k] - n.s[k] / 2), [0, 1, 2].map((k) => c[k] + n.s[k] / 2)];
    case 'cylinder': case 'cone': return [[c[0] - n.r, c[1] - n.r, c[2] - n.h / 2], [c[0] + n.r, c[1] + n.r, c[2] + n.h / 2]];
    case 'sphere': return [[0, 1, 2].map((k) => c[k] - n.r), [0, 1, 2].map((k) => c[k] + n.r)];
    case 'torus': return [[c[0] - n.R - n.r, c[1] - n.R - n.r, c[2] - n.r], [c[0] + n.R + n.r, c[1] + n.R + n.r, c[2] + n.r]];
  }
}
// the volume is taken over the bounds of the SOLID operands (a subtracted tool never widens it)
function solidBounds(n) {
  if (n.t === 'op') {
    if (n.op === 'subtract') return solidBounds(n.a);
    const a = solidBounds(n.a), b = solidBounds(n.b);
    if (n.op === 'intersect') return [[0, 1, 2].map((k) => Math.max(a[0][k], b[0][k])), [0, 1, 2].map((k) => Math.min(a[1][k], b[1][k]))];
    return [[0, 1, 2].map((k) => Math.min(a[0][k], b[0][k])), [0, 1, 2].map((k) => Math.max(a[1][k], b[1][k]))];
  }
  return nodeBounds(n);
}
export function numericVolume(node, N = 64) {
  const [lo, hi] = solidBounds(node);
  const d = [0, 1, 2].map((k) => (hi[k] - lo[k]) / N);
  if (d.some((v) => !(v > 0))) return 0;
  let cnt = 0;
  for (let i = 0; i < N; i++) {
    const x = lo[0] + (i + 0.5) * d[0];
    for (let j = 0; j < N; j++) {
      const y = lo[1] + (j + 0.5) * d[1];
      for (let k = 0; k < N; k++) if (inside(node, x, y, lo[2] + (k + 0.5) * d[2])) cnt++;
    }
  }
  return cnt * d[0] * d[1] * d[2];
}

// Exact volume of a CSG tree whose every plane lies on a multiple of 0.5 (integer boxes at integer or half-integer centres):
// count 0.5-cubes by their centres, which never sit on a boundary.
export function voxelVolume(node, step = 0.5) {
  const [lo, hi] = solidBounds(node);
  const n = [0, 1, 2].map((k) => Math.max(0, Math.round((hi[k] - lo[k]) / step)));
  let cnt = 0;
  for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++)
    if (inside(node, lo[0] + (i + 0.5) * step, lo[1] + (j + 0.5) * step, lo[2] + (k + 0.5) * step)) cnt++;
  return cnt * step ** 3;
}
