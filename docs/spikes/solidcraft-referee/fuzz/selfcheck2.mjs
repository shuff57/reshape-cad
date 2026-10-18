// Extra closed-form families: horizontal holes, L/T/U steps, extra open faces, boxes/round bosses on the open face.
import { oracle } from './oracle.mjs';
import { writeFileSync } from 'node:fs';
const h = +process.argv[2] || 0.05; const PI = Math.PI; const rows = [];
const chk = (family, name, closed, model, tol = 3e-4) => { const r = oracle(model, { h }); const rel = Math.abs(r.P - closed) / closed; rows.push({ family, name, closed, oracleP: r.P, rel, ok: rel < tol }); console.log(rel < tol ? 'ok  ' : 'FAIL', family.padEnd(12), name.padEnd(34), closed.toFixed(4), r.P.toFixed(4), rel.toExponential(1)); };
const box = (W, D, H) => [-W / 2, W / 2, -D / 2, D / 2, 0, H];
const top = (W, D, H, minus = []) => ({ axis: 'z', dir: 1, coord: H, rect: [-W / 2, W / 2, -D / 2, D / 2], minus });
// integral helper: area of rect [xa,xb]x[za,zb] minus disc(cx,cz,R)
const rectMinusDisc = (xa, xb, za, zb, cx, cz, R) => { const n = 200000; const dx = (xb - xa) / n; let A = 0; for (let i = 0; i < n; i++) { const x = xa + (i + 0.5) * dx; const d = R * R - (x - cx) ** 2; let cov = 0; if (d > 0) { const s = Math.sqrt(d); cov = Math.max(0, Math.min(zb, cz + s) - Math.max(za, cz - s)); } A += ((zb - za) - cov) * dx; } return A; };
// 1 horizontal (axis y) hole through the plate, near the top face (gap g) or bottom
for (const [t, r, g, fromTop] of [[1, 1.5, 2.1, 1], [1, 1.5, 1.9, 1], [1, 2, 0.6, 1], [0.5, 1, 1.1, 1], [0.5, 1, 0.9, 0], [2.5, 2, 5.1, 1], [2.5, 1.5, 4.9, 0], [1, 1.5, 3, 1]]) {
  const W = 30, D = 24, H = 12; const zc = fromTop ? H - g - r : g + r; const xc = 2;
  const S = W * D * H - PI * r * r * D; const A = rectMinusDisc(-W / 2 + t, W / 2 - t, t, H, xc, zc, r + t); const C = (D - 2 * t) * A;
  chk('hhole-y', `t=${t} r=${r} g=${g} ${fromTop ? 'top' : 'bot'}`, S - C, { t, mode: 'rect', boxes: [box(W, D, H)], cuts: [], opens: [top(W, D, H)], holes: [{ type: 'cyl', axis: 'y', c: [xc, zc], r, range: [-D / 2 - 1, D / 2 + 1] }], rbosses: [] });
}
// 2 L shapes (wall on +x): open = wall top ('high') or step face ('low')
for (const [t, ww, Hb, Hw, open] of [[1, 6, 4, 8, 'high'], [1, 2.1, 4, 8, 'high'], [1, 1.9, 4, 8, 'high'], [0.5, 1.1, 3, 6, 'high'], [1, 6, 4, 8, 'low'], [1, 2.1, 4, 8, 'low'], [1, 3.9, 4, 8, 'low'], [2.5, 8, 6, 8, 'low']]) {
  const W = 30, D = 16, W2 = W / 2, xw = W2 - ww; const S = D * (W * Hb + ww * Hw); let C;
  const bx = [-W2, W2, -D / 2, D / 2, 0, Hb], wl = [xw, W2, -D / 2, D / 2, Hb, Hb + Hw];
  let op;
  if (open === 'high') { C = (D - 2 * t) * ((Math.min(xw + t, W2 - t) + W2 - t) * Math.max(Hb - 2 * t, 0) + Math.max(ww - 2 * t, 0) * (Hb + Hw - t)); op = { axis: 'z', dir: 1, coord: Hb + Hw, rect: [xw, W2, -D / 2, D / 2], minus: [] }; }
  else { C = (D - 2 * t) * ((W - ww) * Math.max(Hb - t, 0) + Math.max(ww - 2 * t, 0) * (Hb + Hw - 2 * t)); op = { axis: 'z', dir: 1, coord: Hb, rect: [-W2, xw, -D / 2, D / 2], minus: [] }; }
  chk('L-' + open, `t=${t} ww=${ww} Hb=${Hb}`, S - C, { t, mode: 'rect', boxes: [bx, wl], cuts: [], opens: [op], holes: [], rbosses: [] });
}
// 3 extra open faces on a plain plate
for (const [t, open] of [[1, 'top+bot'], [1, 'top+xp'], [1, 'top+xp+xn'], [2.5, 'top+yp'], [0.5, 'bot'], [1, 'xp']]) {
  const W = 30, D = 24, H = 10, W2 = W / 2, D2 = D / 2; const S = W * D * H; const op = []; let x0 = -W2 + t, x1 = W2 - t, y0 = -D2 + t, y1 = D2 - t, z0 = t, z1 = H - t;
  if (open.includes('top')) { op.push(top(W, D, H)); z1 = H; } if (open.includes('bot')) { op.push({ axis: 'z', dir: -1, coord: 0, rect: [-W2, W2, -D2, D2], minus: [] }); z0 = 0; }
  if (open.includes('xp')) { op.push({ axis: 'x', dir: 1, coord: W2, rect: [-D2, D2, 0, H], minus: [] }); x1 = W2; } if (open.includes('xn')) { op.push({ axis: 'x', dir: -1, coord: -W2, rect: [-D2, D2, 0, H], minus: [] }); x0 = -W2; }
  if (open.includes('yp')) { op.push({ axis: 'y', dir: 1, coord: D2, rect: [-W2, W2, 0, H], minus: [] }); y1 = D2; }
  chk('open-faces', `t=${t} ${open}`, S - (x1 - x0) * (y1 - y0) * (z1 - z0), { t, mode: 'rect', boxes: [box(W, D, H)], cuts: [], opens: op, holes: [], rbosses: [] });
}
// 4 box boss / rim-less boss and round boss standing on the open face
for (const [t, bw, bd, bh] of [[1, 6, 5, 4], [1, 2.1, 5, 4], [1, 6, 5, 1.5], [0.5, 4, 4, 2], [2.5, 8, 8, 6]]) {
  const W = 30, D = 24, H = 10; const boss = [-bw / 2, bw / 2, -bd / 2, bd / 2, H, H + bh]; const S = W * D * H + bw * bd * bh;
  const C = (W - 2 * t) * (D - 2 * t) * (H - t) + Math.max(bw - 2 * t, 0) * Math.max(bd - 2 * t, 0) * Math.max(bh - t, 0);
  chk('bossBox', `t=${t} ${bw}x${bd}x${bh}`, S - C, { t, mode: 'rect', boxes: [box(W, D, H), boss], cuts: [], opens: [top(W, D, H, [[-bw / 2, bw / 2, -bd / 2, bd / 2]])], holes: [], rbosses: [] });
}
for (const [t, r, bh] of [[1, 3, 4], [1, 2.05, 3], [0.5, 2, 2], [2.5, 4, 6], [1, 3, 1.5]]) {
  const W = 30, D = 24, H = 10; const S = W * D * H + PI * r * r * bh;
  const C = (W - 2 * t) * (D - 2 * t) * (H - t) + (r > t && bh > t ? PI * (r - t) ** 2 * (bh - t) : 0);
  chk('rboss', `t=${t} r=${r} bh=${bh}`, S - C, { t, mode: 'rect', boxes: [box(W, D, H)], cuts: [], opens: [top(W, D, H)], holes: [], rbosses: [{ c: [3, 1], r, z0: H, z1: H + bh }] });
}
writeFileSync(new URL('./selfcheck2.json', import.meta.url), JSON.stringify({ h, rows }, null, 1));
console.log('selfcheck2', rows.filter((r) => r.ok).length, '/', rows.length, 'ok');
