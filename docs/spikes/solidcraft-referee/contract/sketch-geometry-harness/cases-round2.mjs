const H = 10;
const hex = Array.from({ length: 6 }, (_, i) => [10 * Math.cos(Math.PI * i / 3), 10 * Math.sin(Math.PI * i / 3)]);
const hexArea = 3 * Math.sqrt(3) / 2 * 100;
const cut = (r, th) => r * r * (1 / Math.tan(th / 2) - (Math.PI - th) / 2);
const ang = (p, a, b) => { const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]]; return Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))); };
const tri = [[0, 0], [20, 0], [0, 10]];
const triAngles = tri.map((p, i) => ang(p, tri[(i + 2) % 3], tri[(i + 1) % 3]));
const L = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]];
const rr = (r) => r * r * (1 - Math.PI / 4);
export const cases = [
  { id: 'round-hex-all6-r6', feature: '.round', what: 'hexagon s=10, six corners r6 (limit 8.66)', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(hex)}); ${hex.map((_, i) => `sk.round(${i + 1}, 6)`).join('; ')}; extrude(sk, 10)`, exact: { volume: (hexArea - 6 * cut(6, 2 * Math.PI / 3)) * H }, curved: true },
  { id: 'round-hex-all6-limit', feature: '.round', what: 'hexagon s=10, six corners r8.66 = the limit (adjacent arcs meet)', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(hex)}); ${hex.map((_, i) => `sk.round(${i + 1}, 8.66)`).join('; ')}; extrude(sk, 10)`, exact: { volume: (hexArea - 6 * cut(8.66, 2 * Math.PI / 3)) * H }, curved: true },
  { id: 'chamfer-hex-all6-d3', feature: '.chamfer', what: 'hexagon s=10, six corners chamfer 3', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(hex)}); ${hex.map((_, i) => `sk.chamfer(${i + 1}, 3)`).join('; ')}; extrude(sk, 10)`, exact: { volume: (hexArea - 6 * 9 * Math.sin(2 * Math.PI / 3) / 2) * H } },
  { id: 'round-tri-all3-r2', feature: '.round', what: 'triangle 20x10, all three corners r2 (angles 90 / 26.6 / 63.4)', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(tri)}); sk.round(1,2); sk.round(2,2); sk.round(3,2); extrude(sk, 10)`, exact: { volume: (100 - triAngles.reduce((a, t) => a + cut(2, t), 0)) * H }, curved: true },
  { id: 'round-L-all6-r2', feature: '.round', what: 'L shape, all six corners r2 (five convex, one reflex)', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(L)}); ${L.map((_, i) => `sk.round(${i + 1}, 2)`).join('; ')}; extrude(sk, 10)`, exact: { volume: (450 - 5 * rr(2) + rr(2)) * H }, curved: true },
  { id: 'chamfer-reflex', feature: '.chamfer', what: 'chamfer d4 at the reflex corner (10,10) of the L', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(L)}); sk.chamfer(4, 4); extrude(sk, 10)`, exact: { volume: (450 + 8) * H } },
  { id: 'round-concave-q', feature: '.round', what: 'round at an acute reflex-adjacent corner of a dart', script: `const sk = sketch('top'); sk.polygon([[0,0],[30,5],[10,10],[5,30]]); sk.round(3, 2); extrude(sk, 10)` },
];
cases.push(
  { id: 'round-cw-polygon', feature: '.round', what: 'CLOCKWISE polygon, corner 2 r5', script: "const sk = sketch('top'); sk.polygon([[0,0],[0,30],[40,30],[40,0]]); sk.round(2, 5); extrude(sk, 10)", exact: { volume: (1200 - rr(5)) * H }, curved: true },
  { id: 'chamfer-cw-polygon', feature: '.chamfer', what: 'CLOCKWISE polygon, corner 3 chamfer 6', script: "const sk = sketch('top'); sk.polygon([[0,0],[0,30],[40,30],[40,0]]); sk.chamfer(3, 6); extrude(sk, 10)", exact: { volume: (1200 - 18) * H } },
  { id: 'round-all-cw-L', feature: '.round', what: 'CW L shape, all six corners r2', script: `const sk = sketch('top'); sk.polygon(${JSON.stringify([...L].reverse())}); ${L.map((_, i) => `sk.round(${i + 1}, 2)`).join('; ')}; extrude(sk, 10)`, exact: { volume: (450 - 5 * rr(2) + rr(2)) * H }, curved: true },
);
