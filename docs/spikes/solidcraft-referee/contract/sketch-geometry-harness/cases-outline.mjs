// Features: rect, circle, polygon, round, chamfer, bulges, slot. h = 10 everywhere unless said.
const H = 10;
const sh = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; };
const cutRound = (r, theta) => r * r * (1 / Math.tan(theta / 2) - (Math.PI - theta) / 2); // area a rounded corner of interior angle theta removes
const seg = (g, c) => { const th = 4 * Math.atan(Math.abs(g)); const r = (c * (1 + g * g)) / (4 * Math.abs(g)); return (r * r / 2) * (th - Math.sin(th)); };
const sq40 = '[[0,0],[40,0],[40,30],[0,30]]';
const poly = (id, feature, pts, what, extra = {}) => ({ id, feature, what, script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(pts)}); extrude(sk, ${H})`, exact: { volume: sh(pts) * H }, ...extra });
const withRC = (id, feature, calls, area, what, extra = {}) => ({ id, feature, what, script: `const sk = sketch('top'); sk.polygon(${sq40}); ${calls}; extrude(sk, ${H})`, exact: { volume: area * H }, curved: /round/.test(calls) ? true : undefined, ...extra });
const doc = (id, feature, bulges, pts, what, extra = {}) => ({ id, feature, what, doc: { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: pts, bulges }, { id: 'pull1', kind: 'extrude', target: 'sk1', height: H }] }, curved: true, ...extra });
const sqp = [[0, 0], [20, 0], [20, 20], [0, 20]];
const rr = (r) => r * r * (1 - Math.PI / 4);

export const cases = [
  // ---- rect
  { id: 'rect-origin', feature: '.rect', what: 'rect(30,20) default at [0,0]', script: "const sk = sketch('top'); sk.rect(30, 20); extrude(sk, 10)", exact: { volume: 6000, bbox: [-15, -10, 0, 15, 10, 10] } },
  { id: 'rect-at-neg', feature: '.rect', what: 'rect with decimals and negative centre', script: "const sk = sketch('top'); sk.rect(12.3, 4.4, { at: [-3.7, 2.2] }); extrude(sk, 10)", exact: { volume: 12.3 * 4.4 * 10, bbox: [-3.7 - 6.15, 2.2 - 2.2, 0, -3.7 + 6.15, 2.2 + 2.2, 10] } },
  { id: 'rect-tiny', feature: '.rect', what: 'rect 0.5 x 0.25', script: "const sk = sketch('top'); sk.rect(0.5, 0.25); extrude(sk, 10)", exact: { volume: 0.5 * 0.25 * 10 } },
  { id: 'rect-large', feature: '.rect', what: 'rect 1000 x 800', script: "const sk = sketch('top'); sk.rect(1000, 800); extrude(sk, 10)", exact: { volume: 1000 * 800 * 10 } },
  { id: 'rect-zero', feature: '.rect', what: 'width 0 refused', script: "const sk = sketch('top'); sk.rect(0, 5); extrude(sk, 10)" },
  { id: 'rect-neg', feature: '.rect', what: 'negative width refused', script: "const sk = sketch('top'); sk.rect(-3, 5); extrude(sk, 10)" },
  { id: 'rect-one-arg', feature: '.rect', what: 'missing height', script: "const sk = sketch('top'); sk.rect(5); extrude(sk, 10)" },
  { id: 'rect-bad-opt', feature: '.rect', what: 'unknown option', script: "const sk = sketch('top'); sk.rect(5, 5, { foo: 1 }); extrude(sk, 10)" },
  { id: 'rect-bad-at', feature: '.rect', what: 'at with one number', script: "const sk = sketch('top'); sk.rect(5, 5, { at: [1] }); extrude(sk, 10)" },
  { id: 'rect-text', feature: '.rect', what: 'text width', script: "const sk = sketch('top'); sk.rect('a', 5); extrude(sk, 10)" },
  // ---- circle
  { id: 'circle-10', feature: '.circle', what: 'circle across 10 at origin', script: "const sk = sketch('top'); sk.circle(10); extrude(sk, 10)", exact: { volume: Math.PI * 25 * 10, bbox: [-5, -5, 0, 5, 5, 10] }, curved: true },
  { id: 'circle-at', feature: '.circle', what: 'circle across 18 at (10,-20)', script: "const sk = sketch('top'); sk.circle(18, { at: [10, -20] }); extrude(sk, 25)", exact: { volume: Math.PI * 81 * 25, bbox: [1, -29, 0, 19, -11, 25] }, curved: true },
  { id: 'circle-tiny', feature: '.circle', what: 'circle across 0.2', script: "const sk = sketch('top'); sk.circle(0.2); extrude(sk, 10)", exact: { volume: Math.PI * 0.01 * 10 }, curved: true },
  { id: 'circle-big', feature: '.circle', what: 'circle across 200', script: "const sk = sketch('top'); sk.circle(200); extrude(sk, 10)", exact: { volume: Math.PI * 10000 * 10 }, curved: true },
  { id: 'circle-front', feature: '.circle', what: 'circle on the front plane (offset 0; round 7: a front offset is refused, see fc-front-offset)', script: "const sk = sketch('front'); sk.circle(10, { at: [3, 6] }); extrude(sk, 10)", exact: { volume: Math.PI * 250, bbox: [-2, -10, 1, 8, 0, 11] }, curved: true },
  { id: 'circle-zero', feature: '.circle', what: 'across 0 refused', script: "const sk = sketch('top'); sk.circle(0); extrude(sk, 10)" },
  { id: 'circle-neg', feature: '.circle', what: 'negative across refused', script: "const sk = sketch('top'); sk.circle(-4); extrude(sk, 10)" },
  // ---- polygon
  poly('poly-triangle', '.polygon', [[0, 0], [10, 0], [0, 10]], 'right triangle ccw'),
  poly('poly-square-ccw', '.polygon', [[0, 0], [10, 0], [10, 10], [0, 10]], 'square ccw'),
  poly('poly-square-cw', '.polygon', [[0, 0], [0, 10], [10, 10], [10, 0]], 'square cw (reverse order)'),
  poly('poly-L', '.polygon', [[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]], 'concave L, 6 vertices'),
  poly('poly-hex', '.polygon', Array.from({ length: 6 }, (_, i) => [10 * Math.cos(Math.PI * i / 3), 10 * Math.sin(Math.PI * i / 3)]), 'regular hexagon r=10'),
  poly('poly-pent-offcentre', '.polygon', Array.from({ length: 5 }, (_, i) => [7 + 12 * Math.cos(2 * Math.PI * i / 5 + 0.3), -4 + 12 * Math.sin(2 * Math.PI * i / 5 + 0.3)]), 'irregular-angle pentagon off centre'),
  poly('poly-collinear-mid', '.polygon', [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]], 'a vertex in the middle of an edge (straight corner)'),
  poly('poly-sliver', '.polygon', [[0, 0], [100, 0], [100, 0.01]], 'sliver triangle 100 x 0.01'),
  poly('poly-bowtie', '.polygon', [[0, 0], [10, 10], [10, 0], [0, 10]], 'self-intersecting bowtie (should be refused, not built)'),
  poly('poly-all-collinear', '.polygon', [[0, 0], [5, 0], [10, 0]], 'three collinear points: zero area'),
  poly('poly-dup-vertex', '.polygon', [[0, 0], [10, 0], [10, 0], [10, 10], [0, 10]], 'repeated vertex (zero-length edge)'),
  { id: 'poly-two-points', feature: '.polygon', what: 'two points refused', script: "const sk = sketch('top'); sk.polygon([[0,0],[5,5]]); extrude(sk, 10)" },
  { id: 'poly-bad-point', feature: '.polygon', what: 'a point with one number', script: "const sk = sketch('top'); sk.polygon([[0,0],[5],[5,5]]); extrude(sk, 10)" },
  { id: 'poly-not-array', feature: '.polygon', what: 'not a list', script: "const sk = sketch('top'); sk.polygon(5); extrude(sk, 10)" },
  // ---- round / chamfer on a 40 x 30 polygon (corners: 1=(0,0) 2=(40,0) 3=(40,30) 4=(0,30))
  withRC('round-1', '.round', 'sk.round(1, 5)', 1200 - rr(5), 'one corner r5'),
  withRC('round-all4', '.round', 'sk.round(1,5); sk.round(2,5); sk.round(3,5); sk.round(4,5)', 1200 - 4 * rr(5), 'four corners r5'),
  withRC('round-max15', '.round', 'sk.round(1,15); sk.round(2,15); sk.round(3,15); sk.round(4,15)', 1200 - 4 * rr(15), 'r15 = half of the 30 edge: the limit exactly (stadium)'),
  withRC('round-over', '.round', 'sk.round(1,20)', 1200 - rr(15), 'r20 beyond the limit 15: clamped (script warns)'),
  withRC('round-tiny', '.round', 'sk.round(3, 0.01)', 1200 - rr(0.01), 'r 0.01'),
  withRC('round-neg', '.round', 'sk.round(1, -2)', 1200, 'negative radius'),
  withRC('round-zero', '.round', 'sk.round(1, 0)', 1200, 'zero radius'),
  withRC('chamfer-2', '.chamfer', 'sk.chamfer(2, 6)', 1200 - 18, 'one corner d6'),
  withRC('chamfer-all4', '.chamfer', 'sk.chamfer(1,10); sk.chamfer(2,10); sk.chamfer(3,10); sk.chamfer(4,10)', 1200 - 4 * 50, 'four corners d10'),
  withRC('chamfer-over', '.chamfer', 'sk.chamfer(1, 50)', 1200 - 450, 'd50 beyond the 30 limit: clamped to 30 (script warns)'),
  withRC('chamfer-all4-over', '.chamfer', 'sk.chamfer(1,40); sk.chamfer(2,40); sk.chamfer(3,40); sk.chamfer(4,40)', 1200 - 4 * (15 * 15 / 2), 'all four d40: share each shared edge, d ends 15 each'),
  withRC('round-and-chamfer', '.round', 'sk.round(1,4); sk.chamfer(3,6)', 1200 - rr(4) - 18, 'round on corner 1, chamfer on corner 3', { curved: true }),
  withRC('round-wins-same-corner', '.round', 'sk.round(2,6); sk.chamfer(2,6)', 1200 - rr(6), 'round AND chamfer on corner 2: doc comment says round wins'),
  withRC('round-adjacent-sum', '.round', 'sk.round(1,12); sk.round(2,12)', null, 'two adjacent r12 on the 40 edge: 24 of 40, fits (exact)', {}),
  { id: 'round-triangle-acute', feature: '.round', what: 'acute corner (26.57 deg), r2 below its limit 2.36', script: "const sk = sketch('top'); sk.polygon([[0,0],[20,0],[0,10]]); sk.round(2, 2); extrude(sk, 10)", exact: { volume: (100 - cutRound(2, Math.atan2(10, 20))) * 10 }, curved: true },
  { id: 'round-triangle-over', feature: '.round', what: 'acute corner r5 beyond limit 2.36: clamped (script warns)', script: "const sk = sketch('top'); sk.polygon([[0,0],[20,0],[0,10]]); sk.round(2, 5); extrude(sk, 10)", exact: { volume: (100 - cutRound(2.3607, Math.atan2(10, 20))) * 10 }, curved: true, looseExact: true },
  { id: 'round-reflex', feature: '.round', what: 'round at the REFLEX corner (10,10) of an L (270 deg inside)', script: "const sk = sketch('top'); sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]); sk.round(4, 4); extrude(sk, 10)", exact: { volume: (450 + rr(4)) * 10 }, curved: true },
  { id: 'round-straight-corner', feature: '.round', what: 'round at a straight (180 deg) corner: left out with a warning', script: "const sk = sketch('top'); sk.polygon([[0,0],[5,0],[10,0],[10,10],[0,10]]); sk.round(2, 2); extrude(sk, 10)", exact: { volume: 1000 } },
  { id: 'round-param', feature: '.round', what: 'round radius from param()', script: `const r = param('r', 4); const sk = sketch('top'); sk.polygon(${sq40}); sk.round(1, r); extrude(sk, 10)`, exact: { volume: (1200 - rr(4)) * 10 }, curved: true },
  { id: 'round-corner-0', feature: '.round', what: 'corner 0 refused (1-based)', script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.round(0, 3); extrude(sk, 10)` },
  { id: 'round-corner-5', feature: '.round', what: 'corner 5 of 4 refused', script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.round(5, 3); extrude(sk, 10)` },
  { id: 'round-corner-frac', feature: '.round', what: 'corner 1.5 refused', script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.round(1.5, 3); extrude(sk, 10)` },
  { id: 'round-on-circle', feature: '.round', what: 'round on a circle sketch', script: "const sk = sketch('top'); sk.circle(10); sk.round(1, 2); extrude(sk, 10)" },
  { id: 'chamfer-corner-0', feature: '.chamfer', what: 'chamfer corner 0 refused', script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.chamfer(0, 3); extrude(sk, 10)` },
  { id: 'round-corner1-is-first-point', feature: '.round', what: 'corner 1 is polygon point 1: bbox of a rounded asymmetric triangle', script: "const sk = sketch('top'); sk.polygon([[0,0],[40,0],[0,10]]); sk.round(1, 3); extrude(sk, 10)", exact: { volume: (200 - rr(3)) * 10 }, curved: true },
  // ---- bulges (doc level; no script call exists)
  doc('bulge-0-pos', 'bulges', { 0: 0.5 }, sqp, 'edge 1 bulge +0.5 on a ccw square', { exact: { volume: (400 + seg(0.5, 20)) * H } }),
  doc('bulge-1-neg', 'bulges', { 1: -0.5 }, sqp, 'edge 2 bulge -0.5 (dents in)', { exact: { volume: (400 - seg(0.5, 20)) * H } }),
  doc('bulge-semi', 'bulges', { 2: 1 }, sqp, 'edge 3 bulge 1 = semicircle', { exact: { volume: (400 + seg(1, 20)) * H } }),
  doc('bulge-major', 'bulges', { 0: 2 }, sqp, 'edge 1 bulge 2 = 253 deg arc (legacy > 1)', { exact: { volume: (400 + seg(2, 20)) * H } }),
  doc('bulge-all4', 'bulges', { 0: 0.4, 1: 0.4, 2: 0.4, 3: 0.4 }, sqp, 'four outward arcs', { exact: { volume: (400 + 4 * seg(0.4, 20)) * H } }),
  doc('bulge-triangle', 'bulges', { 1: 0.3 }, [[0, 0], [20, 0], [0, 15]], 'triangle with one bowed edge', { exact: { volume: (150 + seg(0.3, 25)) * H } }),
  doc('bulge-cw-poly', 'bulges', { 0: 0.5 }, [[0, 0], [0, 20], [20, 20], [20, 0]], 'bulge +0.5 on a CLOCKWISE square edge: arc bows inward', { exact: { volume: (400 - seg(0.5, 20)) * H } }),
  { id: 'bulge-with-round', feature: 'bulges', what: 'round next to a bulged edge: left out (curved neighbour)', doc: { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: sqp, bulges: { 0: 0.5 }, rounds: { 0: 3 } }, { id: 'pull1', kind: 'extrude', target: 'sk1', height: H }] }, exact: { volume: (400 + seg(0.5, 20)) * H }, curved: true },
  { id: 'bulge-zero', feature: 'bulges', what: 'bulge 0 = straight', doc: { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: sqp, bulges: { 0: 0 } }, { id: 'pull1', kind: 'extrude', target: 'sk1', height: H }] }, exact: { volume: 4000 } },
  // ---- slot
  { id: 'slot-h', feature: '.slot', what: 'horizontal slot (0,0)-(20,0) r5', script: "const sk = sketch('top'); sk.slot([0,0],[20,0],5); extrude(sk, 10)", exact: { volume: (2 * 5 * 20 + Math.PI * 25) * 10, bbox: [-5, -5, 0, 25, 5, 10] }, curved: true },
  { id: 'slot-v', feature: '.slot', what: 'vertical slot (0,0)-(0,30) r4', script: "const sk = sketch('top'); sk.slot([0,0],[0,30],4); extrude(sk, 10)", exact: { volume: (2 * 4 * 30 + Math.PI * 16) * 10, bbox: [-4, -4, 0, 4, 34, 10] }, curved: true },
  { id: 'slot-diag', feature: '.slot', what: 'diagonal slot (0,0)-(12,16) r3', script: "const sk = sketch('top'); sk.slot([0,0],[12,16],3); extrude(sk, 10)", exact: { volume: (2 * 3 * 20 + Math.PI * 9) * 10 }, curved: true },
  { id: 'slot-fat', feature: '.slot', what: 'r larger than the centre distance: (0,0)-(4,0) r10', script: "const sk = sketch('top'); sk.slot([0,0],[4,0],10); extrude(sk, 10)", exact: { volume: (2 * 10 * 4 + Math.PI * 100) * 10, bbox: [-10, -10, 0, 14, 10, 10] }, curved: true },
  { id: 'slot-front', feature: '.slot', what: 'slot on the front plane (offset 0; round 7: a front offset is refused)', script: "const sk = sketch('front'); sk.slot([1,2],[15,2],4); extrude(sk, 8)", exact: { volume: (2 * 4 * 14 + Math.PI * 16) * 8 }, curved: true },
  { id: 'slot-same', feature: '.slot', what: 'a == b refused', script: "const sk = sketch('top'); sk.slot([3,3],[3,3],5); extrude(sk, 10)" },
  { id: 'slot-r0', feature: '.slot', what: 'r = 0 refused', script: "const sk = sketch('top'); sk.slot([0,0],[10,0],0); extrude(sk, 10)" },
  { id: 'slot-rneg', feature: '.slot', what: 'r < 0 refused', script: "const sk = sketch('top'); sk.slot([0,0],[10,0],-2); extrude(sk, 10)" },
];
// the adjacent-round exact: two r12 on a 40 edge (corner trim = r each at 90 deg)
const ar = cases.find((c) => c.id === 'round-adjacent-sum'); ar.exact = { volume: (1200 - 2 * rr(12)) * H };
