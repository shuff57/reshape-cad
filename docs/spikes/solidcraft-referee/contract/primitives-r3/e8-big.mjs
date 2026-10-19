// E8: the curved size cap. Fast shapes first; ring and sphere at the cap are timed.
const f = (v) => +v.toPrecision(10);
const out = [];
for (const d of [5e4, 1e5, 2e5, 3e5]) out.push({ id: `e8-cone-${d}`, script: `cone(${d}, ${d});` });
for (const d of [5e4, 1e5, 1e6]) out.push({ id: `e8-cyl-wide-${d}`, script: `cylinder(${d}, ${f(d / 4)});` });
out.push({ id: 'e8-cyl-tall-5e4', script: 'cylinder(5000, 50000);' });
out.push({ id: 'e8-boxr-5e4', script: 'box(50000, 50000, 50000, { corner: 5000 });' });
out.push({ id: 'e8-boxr-1e5', script: 'box(100000, 100000, 100000, { corner: 10000 });' });
out.push({ id: 'e8-ring-5e4', script: 'ring(50000, 12500);' });
out.push({ id: 'e8-ring-6e4', script: 'ring(60000, 15000);' });
out.push({ id: 'e8-sph-5e4', script: 'sphere(50000);' });
export default out;
