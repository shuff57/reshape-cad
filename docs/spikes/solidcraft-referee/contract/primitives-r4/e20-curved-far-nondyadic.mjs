// E20 (round 4): curved shapes at an offset with sizes that are NOT exact in binary (E7 used 2, 3, 0.3, 20...). offset = k x smallest typed dimension, on (e, -e, e).
const out = []; const f = (v) => +v.toPrecision(10);
const shapes = {
  cyl: (s, a) => `cylinder(${s}, ${f(s * 1.5)}, { at: ${a} });`,
  sph: (s, a) => `sphere(${s}, { at: ${a} });`,
  cone: (s, a) => `cone(${s}, ${f(s * 1.5)}, { at: ${a} });`,
  ring: (s, a) => `ring(${f(s * 3)}, ${s}, { at: ${a} });`,
  boxr: (s, a) => `box(${s}, ${f(s * 1.3)}, ${f(s * 1.7)}, { corner: ${f(s * 0.17)}, at: ${a} });`,
};
for (const [name, mk] of Object.entries(shapes)) for (const s of [2.7, 27.3]) for (const k of [50, 100, 200, 400, 800, 1600]) {
  const e = f(s * k); if (name === 'ring' && s > 5) { if (k > 400) continue; }
  out.push({ id: `e20-${name}-s${s}-k${k}`, script: mk(s, `[${e}, ${-e}, ${e}]`), occt: true });
}
export default out;
