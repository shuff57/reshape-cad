// E25 (round 4): big curved shapes far from the origin. Fits P = max|at| x (largest typed size): sphere good up to 2.9e9, wrong from 5e9 (E21). Other shapes here.
const f = (v) => +v.toPrecision(10);
const out = [];
const shapes = {
  cyl: (s, a) => `cylinder(${s}, ${f(s * 1.2)}, { at: ${a} });`,
  cone: (s, a) => `cone(${s}, ${f(s * 1.2)}, { at: ${a} });`,
  boxr: (s, a) => `box(${s}, ${f(s * 1.3)}, ${f(s * 1.7)}, { corner: ${f(s * 0.07)}, at: ${a} });`,
  sph: (s, a) => `sphere(${s}, { at: ${a} });`,
};
for (const [name, mk] of Object.entries(shapes)) for (const s of [1000, 4000, 10000, 30000, 50000]) for (const e of [1e3, 1e4, 3e4, 1e5, 3e5, 1e6]) {
  const P = e * s * 1.7; if (P < 1e8 || P > 8e10) continue;
  if (name === 'boxr' && s > 10000) continue;
  out.push({ id: `e25-${name}-s${s}-e${e}`, script: mk(s, `[${e}, ${-e / 2}, ${e / 4}]`), occt: true });
}
for (const s of [1000, 4000, 10000]) for (const e of [1e4, 1e5, 4e5]) { if (e * s > 5e9) continue; out.push({ id: `e25-ring-s${s}-e${e}`, script: `ring(${s}, ${f(s / 5)}, { at: [${e}, 0, 0] });`, occt: true }); }
export default out;
