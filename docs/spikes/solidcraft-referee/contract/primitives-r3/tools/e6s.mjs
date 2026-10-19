const files = process.argv.slice(2);
const dimsOf = (f) => (f.kind === 'box' ? f.size : f.kind === 'wedge' ? [f.width, f.depth, f.height] : [2 * f.radius, f.height]);
const rows = [];
for (const fl of files) for (const x of JSON.parse(require('fs').readFileSync(fl))) {
  if (x.status !== 'built') continue;
  const feat = x.doc.features.at(-1);
  if (['box', 'wedge'].includes(feat.kind) && !(feat.rotate && feat.rotate.some((v) => v)) && !/turn/.test(x.script ?? '')) continue; // exact class
  const c = feat.center ?? [0, 0, 0]; const d = dimsOf(feat);
  const t = x.truck;
  const ok = (t.dVolOcct ?? t.dVolAn) <= 1e-9 && (t.dComOcct ?? 0) <= 1e-6 && (t.dBboxOcct ?? 0) <= 1e-6 && t.faces === t.facesOcct;
  rows.push({ id: x.id, qmax: Math.max(...c.map(Math.abs)) / Math.max(...d), qmin: Math.max(...c.map(Math.abs)) / Math.min(...d), ok, dv: t.dVolOcct, dc: t.dComOcct });
}
for (const key of ['qmax', 'qmin']) {
  const bad = rows.filter((r) => !r.ok).sort((a, b) => a[key] - b[key]);
  console.log(key, 'cases', rows.length, 'bad', bad.length, 'first bad:', bad.slice(0, 3).map((r) => `${r.id} ${r[key].toFixed(0)} dv=${r.dv?.toExponential(1)}`).join(' | '));
  for (const lim of [10, 20, 30, 50, 75, 100, 150, 200, 300]) { const inside = rows.filter((r) => r[key] <= lim); console.log('  <=', lim, 'n', inside.length, 'bad', inside.filter((r) => !r.ok).length, 'max dv', Math.max(0, ...inside.map((r) => r.dv ?? 0)).toExponential(1), 'max dc', Math.max(0, ...inside.map((r) => r.dc ?? 0)).toExponential(1)); }
}
