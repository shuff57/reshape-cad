// Pre-check 1: closed forms I (through V_rem=2I, blind V_rem=I-f0*pi*r^2) vs OpenCascade, 20 seeded cases.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = process.argv[2];
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import(pathToFileURL(path.join(REPO, 'packages/kernel/dist/occt-build.js')).href);
const arc = await import(pathToFileURL(path.join(REPO, 'packages/sketch/dist/sketch-arc.js')).href);
const { runScript } = await import(pathToFileURL(path.join(REPO, 'packages/script/dist/reshape-script.js')).href);
const PI = Math.PI;
// I = integral over D of sqrt(R^2-x^2-y^2): the 1-D form, Simpson over y.
function I(R, r, e) {
  // y = r sin(theta): dy = r cos(theta) dtheta removes the sqrt endpoint singularity of w.
  const N = 4000; let acc = 0;
  const g = (th) => {
    const y = r * Math.sin(th), w = r * Math.cos(th), c2 = R * R - y * y, c = Math.sqrt(c2);
    const F = (x) => 0.5 * (x * Math.sqrt(Math.max(0, c2 - x * x)) + c2 * Math.asin(Math.max(-1, Math.min(1, x / c))));
    return (F(e + w) - F(e - w)) * r * Math.cos(th);
  };
  const a = -PI / 2, h = PI / N;
  for (let i = 0; i <= N; i++) { const th = a + i * h; acc += g(th) * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2); }
  return (acc * h) / 3;
}
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
let worst = 0, n = 0;
for (let k = 0; k < 20; k++) {
  const R = 8 + Math.round(rnd() * 24 * 10) / 10;
  const ratio = 0.15 + rnd() * 0.8; // (e+r)/R
  const r = Math.round((ratio * R * (0.2 + rnd() * 0.5)) * 100) / 100;
  const e = Math.round((ratio * R - r) * 100) / 100;
  if (e <= 0 || e + r > 0.95 * R) { k--; continue; }
  const blind = k % 2 === 1;
  const s0 = Math.sqrt(R * R - (e + r) ** 2);
  const f0 = blind ? Math.round((rnd() * 1.6 - 0.8) * s0 * 100) / 100 : null;
  const deep = blind ? Math.round((R - f0) * 100) / 100 : null;
  const code = `const s = sphere(${2 * R}); hole(s, { across: ${2 * r}, at: [${e}, 0]${blind ? `, deep: ${deep}` : ''} })`;
  const res = runScript(code);
  if (res.errors.length) { console.log('script error', code, res.errors); continue; }
  const id = res.doc.features.at(-1).id;
  let ov;
  try {
    const built = buildDoc(oc, { version: 1, features: res.doc.features }, arc);
    const sh = built.shapes.get(id); const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(sh, g, 1e-7, false, false); ov = g.Mass();
  } catch (err) { console.log('OCCT threw', code, String(err).slice(0, 80)); continue; }
  const Vs = (4 / 3) * PI * R ** 3, Ii = I(R, r, e);
  const mine = Vs - (blind ? Ii - f0 * PI * r * r : 2 * Ii);
  const rel = Math.abs(mine - ov) / ov; worst = Math.max(worst, rel); n++;
  console.log(`${blind ? 'blind  ' : 'through'} R=${R} r=${r} e=${e} ${blind ? 'f0=' + f0 : ''}  formula ${mine.toFixed(5)}  OCCT ${ov.toFixed(5)}  rel ${rel.toExponential(2)}`);
}
console.log(`cases ${n}, worst rel ${worst.toExponential(2)} -> ${worst <= 1e-7 ? 'PASS' : 'FAIL'}`);
