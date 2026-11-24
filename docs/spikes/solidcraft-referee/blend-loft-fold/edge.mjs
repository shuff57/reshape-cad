// cases on and just inside the guard's windows (the places a calibration made on another kernel build could be off on 0.30.1)
let s = Number(process.argv[2] ?? 3) >>> 0; const R = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
const U = (a, b) => a + (b - a) * R(); const pick = (a) => a[Math.floor(R() * a.length)];
const f = (v) => +v.toFixed(6);
const out = []; const add = (id, a, b, gap, pl = 'top') => out.push({ id, code: `const a = sketch('${pl}');\na${a};\nconst b = sketch('${pl}');\nb${b};\nblend(a, b, ${f(gap)});` });
const P = (pts) => `.polygon(${JSON.stringify(pts.map((p) => [f(p[0]), f(p[1])]))})`;
for (let i = 0; i < 300; i++) {
  const k = pick(['ccTilt', 'ccCoarse', 'rcAspect', 'rcThin', 'rcSize', 'regPhase', 'regThin', 'rrAspect', 'needle', 'sliver', 'warp']);
  const pl = pick(['top', 'front', 'side']);
  if (k === 'ccTilt') { const g = U(5, 60); const t = U(3, 5); const r = U(5, 40); add(`${k}-${i}`, `.circle(${f(2 * r)})`, `.circle(${f(2 * r * U(0.3, 1.5))}, { at: [${f(t * g)}, 0] })`, g, pl); }
  else if (k === 'ccCoarse') { const r = U(0.5, 3); const g = r * U(20, 39); add(`${k}-${i}`, `.circle(${f(2 * r)})`, `.circle(${f(2 * r * U(0.5, 1))})`, g, pl); }
  else if (k === 'rcAspect') { const w = U(10, 50); const h = w * U(1.6, 2); const g = Math.max(w, h) * U(1, 2); add(`${k}-${i}`, `.rect(${f(w)}, ${f(h)})`, `.circle(${f(Math.max(w, h) * U(0.5, 1.5))})`, g, pl); }
  else if (k === 'rcThin') { const w = U(10, 50); const h = w * U(1, 2); const L = Math.max(w, h); add(`${k}-${i}`, `.rect(${f(w)}, ${f(h)})`, `.circle(${f(L * U(0.3, 2))})`, L * U(1, 1.2), pl); }
  else if (k === 'rcSize') { const w = U(10, 50); const L = w; add(`${k}-${i}`, `.rect(${f(w)}, ${f(w)})`, `.circle(${f(L * pick([U(0.25, 0.35), U(1.7, 2)]))})`, L * U(1, 3), pl); }
  else if (k === 'regPhase') { const n = pick([4, 5, 6, 8]); const r = U(5, 40); const ph = U(-0.019, 0.019); add(`${k}-${i}`, P(Array.from({ length: n }, (_, j) => [r * Math.cos(ph + 2 * Math.PI * j / n), r * Math.sin(ph + 2 * Math.PI * j / n)])), `.circle(${f(2 * r * U(0.5, 1.5))})`, 2 * r * U(0.3, 2), pl); }
  else if (k === 'regThin') { const n = pick([4, 5, 6, 8]); const r = U(5, 40); add(`${k}-${i}`, P(Array.from({ length: n }, (_, j) => [r * Math.cos(2 * Math.PI * j / n), r * Math.sin(2 * Math.PI * j / n)])), `.circle(${f(2 * r * U(0.5, 1.5))})`, 2 * r * U(0.3, 0.4), pl); }
  else if (k === 'rrAspect') { const w = U(10, 50); const h = w * U(1, 1.1); const r = f(Math.min(w, h) * U(0.05, 0.45)); add(`${k}-${i}`, `.rect(${f(w)}, ${f(h)});\na.round(1, ${r}); a.round(2, ${r}); a.round(3, ${r}); a.round(4, ${r})`, `.circle(${f(w * U(0.6, 1.4))})`, w * U(0.3, 2), pl); }
  else if (k === 'needle') { const w = U(0.5, 20); add(`${k}-${i}`, `.rect(${f(w)}, ${f(w * U(0.5, 1))})`, `.rect(${f(w * 0.5)}, ${f(w * 0.4)})`, w * U(100, 999), pl); }
  else if (k === 'sliver') { const w = U(20, 400); add(`${k}-${i}`, `.rect(${f(w)}, ${f(w)})`, `.rect(${f(w * 0.6)}, ${f(w * 0.6)})`, w * 1.5 * U(1e-4, 3e-4), pl); }
  else { const w = U(10, 60); const e = w * U(5e-4, 1.9e-3); add(`${k}-${i}`, `.rect(${f(w)}, ${f(w)})`, P([[-w / 4, -w / 4], [w / 4, -w / 4 + e], [w / 4, w / 4], [-w / 4, w / 4]]), w * U(0.3, 3), pl); }
}
process.stdout.write(JSON.stringify(out));
