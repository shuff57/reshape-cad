// Pre-check 2: prototype of the y-frame mesher for a sphere with two bore holes (through bore, bore axis z, offset e along x).
const PI = Math.PI, TAU = 2 * PI;
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function I(R, r, e) {
  const N = 4000; let acc = 0;
  const g = (th) => { const y = r*Math.sin(th), w = r*Math.cos(th), c2 = R*R - y*y, c = Math.sqrt(c2);
    const F = (x) => 0.5*(x*Math.sqrt(Math.max(0, c2 - x*x)) + c2*Math.asin(Math.max(-1, Math.min(1, x/c)))); return (F(e+w)-F(e-w))*r*Math.cos(th); };
  const h = PI/N; for (let i = 0; i <= N; i++) acc += g(-PI/2 + i*h) * (i===0||i===N ? 1 : i%2 ? 4 : 2); return acc*h/3;
}
function mesh(R, r, e, n, Q, M) {
  const f = (phi) => Math.sqrt(R*R - e*e - r*r - 2*e*r*Math.cos(phi));
  const tris = []; // [a,b,c,kind]
  const loop = (sgn) => Array.from({ length: n }, (_, i) => { const phi = TAU*i/n; return [e + r*Math.cos(phi), r*Math.sin(phi), sgn*f(phi)]; });
  const top = loop(1), bot = loop(-1);
  // wall: straight rungs, normal toward the bore axis
  for (let i = 0; i < n; i++) { const j = (i+1)%n; const t0 = top[i], t1 = top[j], b0 = bot[i], b1 = bot[j];
    tris.push([t0, b0, b1, 'wall'], [t0, b1, t1, 'wall']); }
  // sphere: for each half (sgn of y), a pole fan over a rim made of equator columns + hole arcs
  const psiOf = (p) => { let a = Math.atan2(p[2], p[0]); return a; };
  const tip = (p) => psiOf(p);
  const windows = [[tip(top[0]), tip(top[n/2])], [tip(bot[n/2]), tip(bot[0])]]; // top (psi>0) and bottom (psi<0), increasing psi
  for (const ysgn of [1, -1]) {
    // rim in increasing psi: list of {p (exact 3D point), psi}
    const rim = [];
    const eq = (psi) => [R*Math.cos(psi), 0, R*Math.sin(psi)];
    const inW = (psi) => windows.some(([a, b]) => psi > a - 1e-12 && psi < b + 1e-12);
    // equator columns outside windows, in [-pi, pi)
    const cols = [];
    for (let q = 0; q < Q; q++) { const psi = -PI + TAU*(q+0.5)/Q; if (!inW(psi)) cols.push({ psi, p: eq(psi) }); }
    // hole arcs for this half: top hole: phi in [0, pi] if y>0 else [pi, 2pi]; ordered by increasing psi
    const arcs = [];
    const arcPts = (pts, upper) => { const idx = upper ? Array.from({ length: n/2+1 }, (_, i) => i) : Array.from({ length: n/2+1 }, (_, i) => n - i);
      return idx.map((i) => pts[i % n]); };
    // top hole (z>0): upper (y>0) arc goes phi 0..pi: psi increasing; lower (y<0) arc goes phi 2pi..pi (i=n..n/2): psi increasing
    arcs.push(arcPts(top, ysgn > 0).map((p) => ({ psi: psiOf(p), p })));
    // bottom hole (z<0): psi window (-b,-a): phi pi..0 maps psi increasing from -b to -a: upper arc i=n/2..0, lower arc i=n/2..n
    const bArc = ysgn > 0 ? Array.from({ length: n/2+1 }, (_, i) => bot[n/2 - i]) : Array.from({ length: n/2+1 }, (_, i) => bot[(n/2 + i) % n]);
    arcs.push(bArc.map((p) => ({ psi: psiOf(p), p })));
    const all = [...cols, ...arcs[0], ...arcs[1]].sort((u, v) => u.psi - v.psi);
    // drop duplicate tips (shared by the two arcs only at hole tips, which are distinct points); keep all
    const K = all.length;
    const vOf = (p) => Math.acos(Math.max(-1, Math.min(1, ysgn * p[1] / R)));
    const pt = (psi, v) => [R*Math.sin(v)*Math.cos(psi), ysgn*R*Math.cos(v), R*Math.sin(v)*Math.sin(psi)];
    const rows = [];
    for (let k = 1; k <= M; k++) rows.push(all.map((q) => k === M ? q.p : pt(q.psi, vOf(q.p)*k/M)));
    const poleP = [0, ysgn*R, 0];
    for (let j = 0; j < K; j++) { const j2 = (j+1)%K; tris.push([poleP, rows[0][j], rows[0][j2], 'sph']);
      for (let k = 0; k < M-1; k++) tris.push([rows[k][j], rows[k+1][j], rows[k+1][j2], 'sph'], [rows[k][j], rows[k+1][j2], rows[k][j2], 'sph']); }
  }
  return tris;
}
function check(R, r, e, n, Q, M) {
  const tris = mesh(R, r, e, n, Q, M);
  const key = (p) => p.map((x) => Math.round(x*1e6)).join(',');
  const dir = new Map(); let vol = 0, bad = 0, degenerate = 0;
  for (let [a, b, c, kind] of tris) {
    const nrm = cross(sub(b, a), sub(c, a)); const len = Math.hypot(...nrm); if (len < 1e-14) { degenerate++; continue; }
    const cen = [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3];
    const want = kind === 'sph' ? cen : [-(cen[0]-e), -cen[1], 0]; // sphere: outward; wall: toward the bore axis
    if (dot(nrm, want) < 0) [b, c] = [c, b];
    vol += dot(a, cross(b, c)) / 6;
    const ks = [a, b, c].map(key); if (new Set(ks).size < 3) { degenerate++; continue; }
    for (let k = 0; k < 3; k++) { const x = ks[k], y = ks[(k+1)%3]; dir.set(`${x}>${y}`, (dir.get(`${x}>${y}`) ?? 0) + 1); }
  }
  for (const [d, cnt] of dir) { const [x, y] = d.split('>'); if (cnt !== 1 || dir.get(`${y}>${x}`) !== 1) bad++; }
  const exact = (4/3)*PI*R**3 - 2*I(R, r, e);
  return { bad, degenerate, tris: tris.length, volErr: Math.abs(vol - exact) / exact };
}
const R = 20; let fails = 0;
for (const eOverR of [0.5, 0.99, 1.01, 2]) for (const frac of [0.5, 0.95]) {
  // (e+r)/R = frac, e/r = eOverR  ->  r = frac*R/(1+eOverR), e = eOverR*r
  const r = frac*R/(1+eOverR), e = eOverR*r;
  for (const [n, Q, M] of [[24, 24, 6], [64, 64, 12]]) {
    const res = check(R, r, e, n, Q, M);
    const ok = res.bad === 0 && res.volErr < 0.01; if (!ok) fails++;
    console.log(`e/r=${eOverR} (e+r)/R=${frac} n=${n} Q=${Q} M=${M}: open/mismatched directed edges ${res.bad}, degenerate ${res.degenerate}, vol err ${(res.volErr*100).toFixed(3)}% ${ok ? 'ok' : 'FAIL'}`);
  }
}
console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
