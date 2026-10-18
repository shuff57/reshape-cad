// Oracle self-check against hand closed forms (formulas derived independently of the voxel code).
// usage: node selfcheck.mjs [h]   -> prints rows, writes selfcheck.json
import { oracle, euclid } from './oracle.mjs';
import { writeFileSync } from 'node:fs';
const h = +process.argv[2] || 0.05; const EUCL = !process.argv.includes('--noeuclid');
const PI = Math.PI;
const plate = (W, D, H, t, extra = {}) => ({ t, mode: 'rect', boxes: [[-W / 2, W / 2, -D / 2, D / 2, 0, H], ...(extra.boxes || [])], cuts: extra.cuts || [],
  opens: extra.opens || [{ axis: 'z', dir: 1, coord: H, rect: [-W / 2, W / 2, -D / 2, D / 2], minus: extra.minus || [] }], holes: extra.holes || [], rbosses: extra.rbosses || [] });
const rows = [];
const chk = (family, name, closed, model, tol = 3e-4) => {
  const t0 = Date.now(); const r = oracle(model, { h }); const rel = Math.abs(r.P - closed) / closed;
  rows.push({ family, name, closed, oracleP: r.P, rel, ok: rel < tol, ms: Date.now() - t0 }); console.log(rel < tol ? 'ok  ' : 'FAIL', family.padEnd(12), name.padEnd(34), closed.toFixed(4), r.P.toFixed(4), rel.toExponential(1), (Date.now() - t0) + 'ms');
};
// 1 plain plate
for (const [W, D, H, t] of [[40, 30, 10, 1], [30, 24, 10, 0.5], [30, 24, 10, 2.5], [20, 16, 6, 1.5]]) chk('plain', `${W}x${D}x${H} t=${t}`, W * D * H - (W - 2 * t) * (D - 2 * t) * (H - t), plate(W, D, H, t));
// 2 rim (user closed form): 40x30x10 plate z[-5,5], rim 10x10x6 flush in corner, wall w: 2872-48(w-2)
for (const w of [2, 2.25, 2.5, 3, 3.5, 4]) {
  const inner = [10 + w, 20 - w, 5 + w, 15 - w, 5, 11];
  chk('rim', `w=${w}`, 2872 - 48 * (w - 2), { t: 1, mode: 'rect', boxes: [[-20, 20, -15, 15, -5, 5], [10, 20, 5, 15, 5, 11]], cuts: [inner], opens: [{ axis: 'z', dir: 1, coord: 5, rect: [-20, 20, -15, 15], minus: [[10, 20, 5, 15]] }], holes: [], rbosses: [] });
}
// 3 counterbore (user closed form 2424+65pi): 40x30x10 t=1, r=2 through, R=4 depth 2, top open
for (const c of [[5, 3], [-8, 2]]) chk('cbore', `r2 R4 d2 @${c}`, 2424 + 65 * PI, plate(40, 30, 10, 1, { holes: [{ type: 'cyl', c, r: 2, range: [-1, 11] }, { type: 'cyl', c, r: 4, range: [8, 11] }] }));
// derived closed form for stacked bore, generic: through r, bore R depth d (top), t, cavity wide enough
{ const W = 40, D = 30, H = 10, t = 1, r = 2, R = 4;
  for (const d of [1, 2, 3.5, 5, 6.5, 7.5]) { // cavity floor z=t; bore offset radius R+t for z>H-d-t ; r+t below
    const S = W * D * H - PI * r * r * H - PI * (R * R - r * r) * d;
    const zsplit = Math.max(t, H - d - t); const lost = PI * (r + t) ** 2 * (zsplit - t) + PI * (R + t) ** 2 * (H - zsplit);
    const C = (W - 2 * t) * (D - 2 * t) * (H - t) - lost;
    chk('cbore-gen', `d=${d}`, S - C, plate(W, D, H, t, { holes: [{ type: 'cyl', c: [4, 3], r, range: [-1, 11] }, { type: 'cyl', c: [4, 3], r: R, range: [H - d, 11] }] })); } }
// 4 through hole / hole-web (hole near +x edge, web = edge to hole wall)
{ const W = 40, D = 30, H = 10, t = 1;
  for (const [r, web] of [[2, 1.0], [2, 2.0], [2, 3], [1.5, 1.0], [3, 1.0], [2, 1.9], [2, 2.1]]) {
    const cx = W / 2 - web - r; const S = W * D * H - PI * r * r * H;
    // cavity cross-section: box (W-2t)x(D-2t) minus disc r+t clipped by the box (disc centre inside, may poke out the +x side when web<t... clip exact by numeric 1-D integral)
    const xa = -W / 2 + t, xb = W / 2 - t, ya = -D / 2 + t, yb = D / 2 - t, R = r + t; let A = 0; const n = 400000, dx = (xb - xa) / n;
    for (let i = 0; i < n; i++) { const x = xa + (i + 0.5) * dx; const dd = R * R - (x - cx) ** 2; if (dd > 0) { const s = Math.sqrt(dd); A += (Math.min(yb, s) - Math.max(ya, -s)) * dx; } }
    const C = ((W - 2 * t) * (D - 2 * t) - A) * (H - t);
    chk('hole-web', `r=${r} web=${web}`, S - C, plate(W, D, H, t, { holes: [{ type: 'cyl', c: [cx, 0], r, range: [-1, 11] }] }));
  } }
// 5 blind hole from top, floor f = H-d
{ const W = 30, D = 24, H = 10, r = 2;
  for (const t of [1, 0.5, 2.5]) for (const f of [0.5 * t, 0.75 * t, t, 1.5 * t, 1.9 * t, 2 * t, 2.1 * t, 3 * t].map((v) => Math.round(v * 20) / 20)) {
    const d = H - f; if (d < 0.3) continue; const S = W * D * H - PI * r * r * d;
    const len = Math.min(H - t, d + t); const C = (W - 2 * t) * (D - 2 * t) * (H - t) - PI * (r + t) ** 2 * len;
    chk('blind-top', `t=${t} floor=${f.toFixed(3)}`, S - C, plate(W, D, H, t, { holes: [{ type: 'cyl', c: [3, 2], r, range: [H - d, H + 1] }] })); } }
// 6 blind hole from the closed bottom: floor (ceiling) f above
{ const W = 30, D = 24, H = 10, r = 2;
  for (const t of [1, 0.5, 2.5]) for (const f of [0.75 * t, t, 1.5 * t, 2 * t, 2.5 * t, 3.5 * t].map((v) => Math.round(v * 20) / 20)) {
    const d = H - f; if (d < 0.3) continue; const S = W * D * H - PI * r * r * d;
    const zlo = t, zhi = Math.min(H, d + t); const len = Math.max(0, zhi - zlo); const C = (W - 2 * t) * (D - 2 * t) * (H - t) - PI * (r + t) ** 2 * len;
    chk('blind-bot', `t=${t} ceiling=${f.toFixed(3)}`, S - C, plate(W, D, H, t, { holes: [{ type: 'cyl', c: [3, 2], r, range: [-1, d] }] })); } }
// 7 rectangular pocket in the open face / in the closed face
{ const W = 30, D = 24, H = 10;
  for (const [t, pw, pd, d] of [[1, 6, 5, 3], [1, 6, 5, 8.5], [1, 6, 5, 7.2], [0.5, 4, 4, 9.2], [2.5, 6, 6, 5.5], [1, 1.5, 12, 4]]) {
    const S = W * D * H - pw * pd * d; const cav = (W - 2 * t) * (D - 2 * t) * (H - t);
    const lenT = Math.min(d + t, H - t); // pocket from open face: offset box (pw+2t)(pd+2t) down to H-d-t
    chk('pocket-top', `t=${t} ${pw}x${pd} d=${d}`, S - (cav - (pw + 2 * t) * (pd + 2 * t) * lenT), plate(W, D, H, t, { cuts: [[-pw / 2, pw / 2, -pd / 2, pd / 2, H - d, H]], minus: [[-pw / 2, pw / 2, -pd / 2, pd / 2]] }));
    const zhi = Math.min(H, d + t); const lenB = Math.max(0, zhi - t);
    chk('pocket-bot', `t=${t} ${pw}x${pd} d=${d}`, S - (cav - (pw + 2 * t) * (pd + 2 * t) * lenB), plate(W, D, H, t, { cuts: [[-pw / 2, pw / 2, -pd / 2, pd / 2, 0, d]] }));
  } }
// 8 vertical fillet / chamfer (plate 30x24x10)
{ const W = 30, D = 24, H = 10;
  for (const t of [1, 0.5, 2.5]) for (const R of [t * 0.5, t, 1.5 * t, 3, 5]) {
    const S = (W * D - (4 - PI) * R * R) * H; const Rc = Math.max(R - t, 0); const C = ((W - 2 * t) * (D - 2 * t) - (4 - PI) * Rc * Rc) * (H - t);
    chk('vfillet', `t=${t} R=${R}`, S - C, { t, mode: 'convex', convex: { W, D, H, kind: 'vfillet', s: R }, holes: [] }); }
  for (const t of [1, 0.5, 2.5]) for (const c of [1, 2, 3, 5]) {
    const S = (W * D - 2 * c * c) * H; let legs = c - t * (2 - Math.SQRT2); legs = Math.max(legs, 0);
    const C = ((W - 2 * t) * (D - 2 * t) - 2 * legs * legs) * (H - t);
    chk('vchamfer', `t=${t} c=${c}`, S - C, { t, mode: 'convex', convex: { W, D, H, kind: 'vchamfer', s: c }, holes: [] }); } }
// 9 bottom chamfer / fillet by 1-D integration of the exact cross-section
{ const W = 30, D = 24, H = 10, W2 = W / 2, D2 = D / 2, S2 = Math.SQRT2;
  const integ = (f, a, b, n = 200000) => { let s = 0; const dz = (b - a) / n; for (let i = 0; i < n; i++) s += f(a + (i + 0.5) * dz) * dz; return s; };
  for (const t of [1, 0.5, 2.5]) for (const c of [1, 1.5, 3, 4]) {
    const S = integ((z) => 4 * Math.min(W2, W2 - c + z) * Math.min(D2, D2 - c + z), 0, H);
    const C = integ((z) => { const a = Math.min(W2 - t, W2 - c - t * S2 + z), b = Math.min(D2 - t, D2 - c - t * S2 + z); return a > 0 && b > 0 ? 4 * a * b : 0; }, t, H);
    chk('bchamfer', `t=${t} c=${c}`, S - C, { t, mode: 'convex', convex: { W, D, H, kind: 'bchamfer', s: c }, holes: [] }); }
  for (const t of [1, 0.5, 2.5]) for (const R of [1, 3, 5]) {
    // body: Minkowski sum of core box [-W2+R,W2-R]x[-D2+R,D2-R]x[R,inf) with ball R, clipped z<H : half-widths at height z
    const f = (z, RR) => (z < R ? Math.sqrt(Math.max(0, RR * RR - (R - z) ** 2)) : RR);
    const S = integ((z) => 4 * (W2 - R + f(z, R)) * (D2 - R + f(z, R)), 0, H);
    const C = R > t ? integ((z) => (z < t ? 0 : 4 * (W2 - R + f(z, R - t)) * (D2 - R + f(z, R - t))), t, H) : (W - 2 * t) * (D - 2 * t) * (H - t);
    chk('bfillet', `t=${t} R=${R}`, S - C, { t, mode: 'convex', convex: { W, D, H, kind: 'bfillet', s: R }, holes: [] }); } }
// 10 countersink (top, 90deg) closed form via profile integral; plus Euclid ball cross-check
{ const W = 44, D = 36, H = 10, r = 2; // plate wide enough that the offset disc stays inside the cavity cross-section (closed form assumes it)
  for (const t of [1, 0.5, 2.5]) for (const Dm of [8, 12, 6]) {
    const R = Dm / 2, dep = R - r, zb = H - dep; const q = Math.SQRT2;
    const rho = (z, tt) => Math.max(r + tt, z >= zb - 2 * tt ? r + (z - zb) + tt * q : 0);
    const holeVol = PI * r * r * H + PI * (((R ** 3 - r ** 3) / 3) * 1) * 1 - 0; // cone frustum part above r: int pi((r+u)^2 - r^2) du, u in [0,dep]
    const cone = (() => { let s = 0; const n = 100000, du = dep / n; for (let i = 0; i < n; i++) { const u = (i + 0.5) * du; s += PI * ((r + u) ** 2 - r * r) * du; } return s; })();
    const S = W * D * H - PI * r * r * H - cone;
    let lost = 0; { const n = 200000, dz = (H - t) / n; for (let i = 0; i < n; i++) { const z = t + (i + 0.5) * dz; lost += PI * rho(z, t) ** 2 * dz; } }
    const C = (W - 2 * t) * (D - 2 * t) * (H - t) - lost;
    const model = plate(W, D, H, t, { holes: [{ type: 'cone', c: [3, 2], rb: r, zb, rt: R, zt: H, r, range: [-1, H + 1] }] });
    chk('csink-top', `t=${t} D=${Dm}`, S - C, model, 5e-4);
    if (!EUCL) continue;
    const e = euclid(model, { h }); const rel = Math.abs(e.P - (S - C)) / (S - C);
    rows.push({ family: 'csink-euclid', name: `t=${t} D=${Dm}`, closed: S - C, oracleP: e.P, rel, ok: rel < 1e-3 }); console.log(rel < 1e-3 ? 'ok  ' : 'diff', 'csink-eucl  ', `t=${t} D=${Dm}`, (S - C).toFixed(3), e.P.toFixed(3), rel.toExponential(1)); } }
writeFileSync(new URL('./selfcheck.json', import.meta.url), JSON.stringify({ h, rows }, null, 1));
console.log('selfcheck', rows.filter((r) => r.ok).length, '/', rows.length, 'ok');
