let s = Number(process.argv[2] ?? 1) >>> 0; const R = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
const U = (a, b) => a + (b - a) * R(); const pick = (a) => a[Math.floor(R() * a.length)];
const f = (v) => +v.toFixed(pick([1, 2, 3, 6]));
const P = (pts) => `.polygon(${JSON.stringify(pts.map((p) => [f(p[0]), f(p[1])]))})`;
const plane = () => pick(['top', 'top', 'front', 'side']);
const out = [];
for (let i = 0; i < Number(process.argv[3] ?? 400); i++) {
  const kind = pick(['scaled', 'scaled', 'rect', 'cc', 'rc', 'regc', 'rrc', 'random', 'nearpar']);
  const pl = plane(); const gap = f(U(-80, 80)) || 5; const sz = U(2, 80);
  let a, b;
  const n = pick([3, 4, 5, 6, 8]);
  const base = Array.from({ length: n }, (_, k) => { const t = 2 * Math.PI * k / n + U(-0.3, 0.3); const r = sz * U(0.6, 1); return [r * Math.cos(t), r * Math.sin(t)]; });
  const sc = U(0.2, 2.5); const dx = U(-sz, sz) * 0.5; const dy = U(-sz, sz) * 0.5;
  if (kind === 'scaled') { a = P(base); b = P(base.map((p) => [p[0] * sc + dx, p[1] * sc + dy])); }
  else if (kind === 'nearpar') { a = P(base); b = P(base.map((p) => [p[0] * sc + dx + U(-0.01, 0.01), p[1] * sc + dy + U(-0.01, 0.01)])); }
  else if (kind === 'random') { a = P(base); b = P(Array.from({ length: n }, (_, k) => { const t = 2 * Math.PI * k / n + U(-0.3, 0.3); const r = sz * U(0.3, 1); return [r * Math.cos(t), r * Math.sin(t)]; })); }
  else if (kind === 'rect') { a = `.rect(${f(U(2, 80))}, ${f(U(2, 80))})`; b = `.rect(${f(U(2, 80))}, ${f(U(2, 80))}, { at: [${f(dx)}, ${f(dy)}] })`; }
  else if (kind === 'cc') { a = `.circle(${f(U(1, 80))})`; b = `.circle(${f(U(1, 80))}, { at: [${f(dx)}, ${f(dy)}] })`; }
  else if (kind === 'rc') { a = `.rect(${f(U(5, 60))}, ${f(U(5, 60))})`; b = `.circle(${f(U(5, 80))}, { at: [${f(dx * 0.2)}, ${f(dy * 0.2)}] })`; }
  else if (kind === 'regc') { const m = pick([4, 5, 6, 8]); const r = U(5, 40); a = P(Array.from({ length: m }, (_, k) => [r * Math.cos(2 * Math.PI * k / m), r * Math.sin(2 * Math.PI * k / m)])); b = `.circle(${f(U(5, 80))})`; }
  else { const w = U(10, 50); const h = w * U(1, 1.2); const r = f(Math.min(w, h) * U(0.05, 0.4)); a = `.rect(${f(w)}, ${f(h)});\nVAR.round(1, ${r}); VAR.round(2, ${r}); VAR.round(3, ${r}); VAR.round(4, ${r})`; b = `.circle(${f(U(5, 60))})`; }
  const [first, second] = R() < 0.5 ? [a, b] : [b, a];
  out.push({ id: `${kind}-${i}`, code: `const a = sketch('${pl}');\na${first.replaceAll('VAR','a')};\nconst b = sketch('${pl}');\nb${second.replaceAll('VAR','b')};\nblend(a, b, ${gap});` });
}
process.stdout.write(JSON.stringify(out));
