// E18 (round 4): prism sides that are not 3..12 or not whole, from a script (interpreter + lint) and from a stored ModelDoc / slider (no interpreter).
const D = (sides) => ({ version: 1, features: [{ id: 'prism1', kind: 'prism', center: [0, 0, 0], sides, radius: 15, height: 12 }] });
const out = [];
for (const s of ['2.6', '2.5', '12.4', '5.4', '5.5', '3.49', '11.6', '12.5', '2.4', '2', '13']) out.push({ id: `e18-script-${s}`, script: `prism(${s}, 30, 12);`, occt: true, row: 'prism.script' });
for (const s of [2, 2.6, 3, 5.5, 6, 12, 12.4, 13, 30, 0, -1, 1e9, NaN]) out.push({ id: `e18-doc-${s}`, doc: D(s), occt: true, row: 'prism.doc' });
out.push({ id: 'e18-var', script: 'const n = 5.5; prism(n, 30, 12);', occt: true });
out.push({ id: 'e18-param', script: "prism(param('n', 7.5), 30, 12);", occt: true });
out.push({ id: 'e18-expr', script: 'prism(10 / 3, 30, 12);', occt: true });
out.push({ id: 'e18-expr-whole', script: 'prism(0.1 * 30, 30, 12);', occt: true });
export default out;
