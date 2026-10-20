// E28 checker (round 5): truck's bbox and centre of mass of every e28 case against a closed form that uses NO kernel and NO occt-build code.
//   bun primitives-r4/e28-closed-form.mjs primitives-r4/results/e28-orientation.json [--out=primitives-r4/results/e28-closed-form.json]
// Bar fixed BEFORE the run: |bbox corner| and |COM| within 1e-9 x bbox diagonal (the planar bar of primitives-lib TOL.planar is 1e-9 for volume; the same figure is used here), volume within 1e-9 relative.
// Rotation convention under test: right-handed rotation about the single axis, about the shape centre, applied before the move to `center`.
import { readFileSync, writeFileSync } from 'node:fs';
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const BAR = 1e-9;
const rot = (p, [rx, ry, rz]) => { // single-axis only; degrees, right-handed
  let [x, y, z] = p; const r = (d) => [Math.cos(d * Math.PI / 180), Math.sin(d * Math.PI / 180)];
  if (rx) { const [c, s] = r(rx); [y, z] = [c * y - s * z, s * y + c * z]; }
  if (ry) { const [c, s] = r(ry); [x, z] = [c * x + s * z, -s * x + c * z]; }
  if (rz) { const [c, s] = r(rz); [x, y] = [c * x - s * y, s * x + c * y]; }
  return [x, y, z];
};
function expected(f) {
  let verts; let vol; let com0;
  if (f.kind === 'wedge') {
    const { width: w, depth: d, height: h } = f;
    const tri = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2]];
    verts = tri.flatMap(([x, y]) => [[x, y, -h / 2], [x, y, h / 2]]);
    vol = w * d * h / 2; com0 = [-w / 6, -d / 6, 0];
  } else {
    const n = f.sides; const R = f.radius; const h = f.height;
    verts = []; for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; for (const z of [-h / 2, h / 2]) verts.push([R * Math.cos(a), R * Math.sin(a), z]); }
    vol = 0.5 * n * R * R * Math.sin(2 * Math.PI / n) * h; com0 = [0, 0, 0];
  }
  const rv = f.rotate ? verts.map((v) => rot(v, f.rotate)) : verts;
  const com = (f.rotate ? rot(com0, f.rotate) : com0).map((v, i) => v + f.center[i]);
  const lo = [0, 1, 2].map((i) => Math.min(...rv.map((v) => v[i])) + f.center[i]);
  const hi = [0, 1, 2].map((i) => Math.max(...rv.map((v) => v[i])) + f.center[i]);
  return { vol, com, bbox: [...lo, ...hi] };
}
const res = [];
for (const r of rows) {
  const f = r.doc.features[0];
  if (r.status !== 'built') { res.push({ id: r.id, status: r.status, note: r.refusal ?? r.guard?.sentence }); continue; }
  const e = expected(f); const t = r.truck;
  const diag = Math.hypot(e.bbox[3] - e.bbox[0], e.bbox[4] - e.bbox[1], e.bbox[5] - e.bbox[2]);
  const dB = Math.max(...e.bbox.map((v, i) => Math.abs(v - t.bbox[i]))) / diag;
  const dC = Math.max(...e.com.map((v, i) => Math.abs(v - t.com[i]))) / diag;
  const dV = Math.abs(e.vol - t.volume) / e.vol;
  const ok = dB <= BAR && dC <= BAR && dV <= BAR;
  res.push({ id: r.id, kind: f.kind, status: 'built', ok, dBboxClosed: dB, dComClosed: dC, dVolClosed: dV, truckBbox: t.bbox, closedBbox: e.bbox, truckCom: t.com, closedCom: e.com });
  console.log(r.id.padEnd(26), ok ? 'OK  ' : 'FAIL', 'dBbox', dB.toExponential(1), 'dCom', dC.toExponential(1), 'dVol', dV.toExponential(1));
}
const o = arg('out'); if (o) writeFileSync(o, JSON.stringify(res, null, 1));
console.log(`${res.filter((x) => x.ok).length} ok of ${res.length}`);
process.exit(res.every((x) => x.ok) ? 0 : 1);
