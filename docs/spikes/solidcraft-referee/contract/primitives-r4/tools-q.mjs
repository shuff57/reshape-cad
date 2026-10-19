// relates the far-planar error to Q = prod_a (|c_a| + ext_a) / V   (cancellation model)  usage: bun tools-q.mjs results/x.json
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const Q = (r) => {
  const f = r.doc.features.find((x) => x.kind !== 'rotate' && x.kind !== 'move') ; if (!f) return null;
  const c = f.center ?? [0, 0, 0];
  let ext; let V = r.an;
  const turned = (r.script ?? '').startsWith('turn(');
  if (f.kind === 'box') ext = f.size.map((v) => v / 2);
  else if (f.kind === 'wedge') ext = [f.width, f.depth, f.height];
  else if (f.kind === 'prism') ext = [f.radius, f.radius, f.height / 2];
  else return null;
  if (turned) { const R = Math.hypot(...ext); ext = [R, R, R]; }
  return c.reduce((p, v, i) => p * (Math.abs(v) + ext[i]), 1) / V;
};
const out = rows.filter((r) => r.truck && r.truck.dVolAn !== undefined).map((r) => ({ id: r.id, q: Q(r), dv: r.truck.dVolAn, dcom: r.truck.dComOcct, good: r.good, why: r.why })).filter((x) => x.q);
out.sort((a, b) => a.q - b.q);
const bins = {};
for (const o of out) { const b = Math.floor(Math.log10(o.q)); const e = (bins[b] ??= { n: 0, bad: 0, maxdv: 0, maxcom: 0 }); e.n++; if (!o.good) e.bad++; e.maxdv = Math.max(e.maxdv, o.dv); e.maxcom = Math.max(e.maxcom, o.dcom ?? 0); }
for (const [b, e] of Object.entries(bins)) console.log(`Q 1e${b}..1e${+b + 1}`.padEnd(14), `n=${e.n} bad=${e.bad} maxdVol=${e.maxdv.toExponential(1)} maxdCOM=${e.maxcom.toExponential(1)}`);
