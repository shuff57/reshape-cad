// E5b: sphere size sweep (slow shape: ~5 s each).
export default [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 2, 100, 3000, 20000, 30000, 50000, 60000, 70000].map((d) => ({ id: `e5b-sph-${d}`, script: `sphere(${d});` }));
