// Features: .geom rows, construction geometry, several shapes on one sketch, param() on rows/shapes.
const H = 10;
const P = Math.PI;
const J = JSON.stringify;
const line = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
const coin = (a, aEnd, b, bEnd) => ({ k: 'coincident', a, aEnd, b, bEnd });
const geomScript = (geoms, rules, plane = "'top'") => `const sk = sketch(${plane}); sk.geom(${J(geoms)});${rules ? ` sk.rules(${J(rules)});` : ''} extrude(sk, ${H})`;
const rectRows = [line(1, [0, 0], [20, 0]), line(2, [20, 0], [20, 10]), line(3, [20, 10], [0, 10]), line(4, [0, 10], [0, 0])];
const rectJoin = [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 4, 'a'), coin(4, 'b', 1, 'a')];
const g = (id, feature, geoms, rules, what, extra = {}) => ({ id, feature, what, script: geomScript(geoms, rules, extra.plane), ...extra });
const sc = (id, feature, body, what, extra = {}) => ({ id, feature, what, script: `const sk = sketch('top'); ${body}; extrude(sk, ${H})`, ...extra });

export const cases = [
  // ---- .geom rows
  g('geom-triangle-norules', '.geom', [line(1, [0, 0], [20, 0]), line(2, [20, 0], [0, 15]), line(3, [0, 15], [0, 0])], null, 'closed triangle by coordinates only, NO coincident rows', { exact: { volume: 150 * H } }),
  g('geom-triangle-joined', '.geom', [line(1, [0, 0], [20, 0]), line(2, [20, 0], [0, 15]), line(3, [0, 15], [0, 0])], [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 1, 'a')], 'closed triangle with coincident rows', { exact: { volume: 150 * H, bbox: [0, 0, 0, 20, 15, 10] } }),
  g('geom-rect-hv', '.geom', rectRows, [...rectJoin, { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }], 'rectangle rows + H/V rules', { exact: { volume: 200 * H, bbox: [0, 0, 0, 20, 10, 10] } }),
  g('geom-D-cw', '.geom', [line(1, [0, -10], [0, 10]), { k: 'arc', id: 2, c: [0, 0], r: 10, a: [0, 10], b: [0, -10], sense: 'cw' }], [coin(1, 'b', 2, 'a'), coin(2, 'b', 1, 'a')], 'D shape: half-disc on the +x side (arc cw from top to bottom)', { exact: { volume: 0.5 * P * 100 * H, bbox: [0, -10, 0, 10, 10, 10] }, curved: true }),
  g('geom-D-ccw', '.geom', [line(1, [0, -10], [0, 10]), { k: 'arc', id: 2, c: [0, 0], r: 10, a: [0, 10], b: [0, -10], sense: 'ccw' }], [coin(1, 'b', 2, 'a'), coin(2, 'b', 1, 'a')], 'D shape: half-disc on the -x side (arc ccw from top to bottom)', { exact: { volume: 0.5 * P * 100 * H, bbox: [-10, -10, 0, 0, 10, 10] }, curved: true }),
  g('geom-pie-ccw90', '.geom', [line(1, [0, 0], [10, 0]), { k: 'arc', id: 2, c: [0, 0], r: 10, a: [10, 0], b: [0, 10], sense: 'ccw' }, line(3, [0, 10], [0, 0])], [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 1, 'a')], 'quarter pie, arc ccw 90 deg', { exact: { volume: 0.25 * P * 100 * H, bbox: [0, 0, 0, 10, 10, 10] }, curved: true }),
  g('geom-pie-cw270', '.geom', [line(1, [0, 0], [10, 0]), { k: 'arc', id: 2, c: [0, 0], r: 10, a: [10, 0], b: [0, 10], sense: 'cw' }, line(3, [0, 10], [0, 0])], [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 1, 'a')], '3/4 pie, arc cw 270 deg (the other arc between the same ends)', { exact: { volume: 0.75 * P * 100 * H, bbox: [-10, -10, 0, 10, 10, 10] }, curved: true }),
  g('geom-circle-only', '.geom', [{ k: 'circle', id: 1, c: [3, 4], r: 7 }], null, 'one circle row', { exact: { volume: P * 49 * H, bbox: [-4, -3, 0, 10, 11, 10] }, curved: true }),
  g('geom-circle-hole', '.geom', [{ k: 'circle', id: 1, c: [0, 0], r: 10 }, { k: 'circle', id: 2, c: [0, 0], r: 4 }], null, 'circle in circle: ring by even-odd', { exact: { volume: P * 84 * H }, curved: true }),
  g('geom-construction-line', '.geom', [...rectRows, line(5, [0, 0], [20, 10], { construction: true }), { k: 'point', id: 6, p: [5, 5] }], rectJoin, 'rectangle + a construction diagonal + a point row: neither is profile', { exact: { volume: 200 * H, bbox: [0, 0, 0, 20, 10, 10] } }),
  g('geom-construction-circle-inside', '.geom', [...rectRows, { k: 'circle', id: 5, c: [10, 5], r: 3, construction: true }], rectJoin, 'construction circle inside a rectangle must NOT cut a hole', { exact: { volume: 200 * H } }),
  g('geom-construction-only', '.geom', [{ k: 'circle', id: 1, c: [0, 0], r: 5, construction: true }], null, 'only construction geometry: nothing to extrude'),
  g('geom-points-only', '.geom', [{ k: 'point', id: 1, p: [1, 1] }, { k: 'point', id: 2, p: [4, 5] }], null, 'only points: nothing to extrude'),
  g('geom-open-3-lines', '.geom', rectRows.slice(0, 3), rectJoin.slice(0, 2), 'U shape: open profile'),
  g('geom-front-plane', '.geom', [line(1, [0, 0], [20, 0]), line(2, [20, 0], [0, 15]), line(3, [0, 15], [0, 0])], null, 'rows on the front plane (offset 0; round 7: a front offset is refused)', { plane: "'front'", exact: { volume: 150 * H, bbox: [0, -10, 0, 20, 0, 15] } }),
  // round 8: geom-front-plane above carries no coincident rows and is refused by the loose-end guard, so it no longer exercises a soup on the front plane; this one does
  g('geom-front-plane-joined', '.geom', [line(1, [0, 0], [20, 0]), line(2, [20, 0], [0, 15]), line(3, [0, 15], [0, 0])], [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 1, 'a')], 'rows WITH coincident rows on the front plane (offset 0): triangle 20 x 15, pull 10 toward -y', { plane: "'front'", exact: { volume: 150 * H, bbox: [0, -10, 0, 20, 0, 15] } }),
  g('geom-front-plane-circle-hole', '.geom', [{ k: 'circle', id: 1, c: [0, 0], r: 10 }, { k: 'circle', id: 2, c: [0, 0], r: 4 }], null, 'two circle rows on the front plane (offset 0): ring by even-odd, pull 10 toward -y', { plane: "'front'", exact: { volume: P * 84 * H, bbox: [-10, -10, -10, 10, 0, 10] }, curved: true }),
  g('geom-side-circle', '.geom', [{ k: 'circle', id: 1, c: [5, 6], r: 3 }], null, 'circle row on the side plane', { plane: "'side'", exact: { volume: P * 9 * H, bbox: [0, 2, 3, 10, 8, 9] }, curved: true }),
  // refusals at the script layer
  g('geom-id-gap', '.geom', [line(1, [0, 0], [5, 0]), line(3, [5, 0], [5, 5])], null, 'ids 1,3: not dense'),
  g('geom-id-dup', '.geom', [line(1, [0, 0], [5, 0]), line(1, [5, 0], [5, 5])], null, 'duplicate id'),
  g('geom-id-zero', '.geom', [line(0, [0, 0], [5, 0])], null, 'id 0'),
  g('geom-id-frac', '.geom', [line(1.5, [0, 0], [5, 0])], null, 'fractional id'),
  g('geom-bad-kind', '.geom', [{ k: 'ellipse', id: 1, c: [0, 0], r: 5 }], null, 'unknown kind'),
  g('geom-circle-r0', '.geom', [{ k: 'circle', id: 1, c: [0, 0], r: 0 }], null, 'circle radius 0'),
  g('geom-circle-rneg', '.geom', [{ k: 'circle', id: 1, c: [0, 0], r: -3 }], null, 'circle radius negative'),
  g('geom-arc-bad-sense', '.geom', [{ k: 'arc', id: 1, c: [0, 0], r: 5, a: [5, 0], b: [0, 5], sense: 'up' }], null, 'arc sense up'),
  g('geom-arc-off-circle', '.geom', [{ k: 'arc', id: 1, c: [0, 0], r: 10, a: [10, 0], b: [0, 12], sense: 'ccw' }, line(2, [0, 12], [10, 0])], null, 'arc whose end b is at radius 12 not 10'),
  g('geom-line-zero', '.geom', [line(1, [3, 3], [3, 3])], null, 'zero length line'),
  g('geom-construction-nonbool', '.geom', [{ k: 'line', id: 1, a: [0, 0], b: [5, 0], construction: 'yes' }], null, 'construction: "yes"'),
  { id: 'geom-after-rect', feature: '.geom', what: '.geom after .rect replaces the rect: refused', script: "const sk = sketch('top'); sk.rect(10,10); sk.geom([{k:'circle',id:1,c:[0,0],r:3}]); extrude(sk, 10)" },
  { id: 'rules-bad-ref', feature: '.rules', what: 'rule names geometry 9 that does not exist', script: "const sk = sketch('top'); sk.geom([{k:'circle',id:1,c:[0,0],r:3}]); sk.rules([{k:'radius', a: 9, value: 3}]); extrude(sk, 10)" },
  // ---- several closed shapes on one sketch (nesting by even-odd)
  sc('multi-plate-hole', 'several shapes', 'sk.rect(30, 20); sk.circle(6)', 'plate with a round hole', { exact: { volume: (600 - P * 9) * H }, curved: true }),
  sc('multi-island', 'several shapes', 'sk.rect(40, 30); sk.circle(20); sk.circle(8)', 'rect, hole circle, island circle inside the hole', { exact: { volume: (1200 - P * 100 + P * 16) * H }, curved: true }),
  sc('multi-concentric3', 'several shapes', 'sk.circle(24); sk.circle(16); sk.circle(8)', 'three concentric circles: ring + core', { exact: { volume: (P * (144 - 64 + 16)) * H }, curved: true }),
  sc('multi-concentric4', 'several shapes', 'sk.circle(40); sk.circle(30); sk.circle(20); sk.circle(10)', 'four concentric circles', { exact: { volume: (P / 4) * (1600 - 900 + 400 - 100) * H }, curved: true }),
  sc('multi-apart-rects', 'several shapes', 'sk.rect(10, 10, { at: [-10, 0] }); sk.rect(10, 10, { at: [10, 0] })', 'two disjoint rects (two solids)', { exact: { volume: 200 * H } }),
  sc('multi-apart-circles', 'several shapes', 'sk.circle(8, { at: [-12, 0] }); sk.circle(8, { at: [12, 0] })', 'two disjoint circles', { exact: { volume: 2 * P * 16 * H }, curved: true }),
  sc('multi-rect-circle-apart', 'several shapes', 'sk.rect(20, 10, { at: [-20, 0] }); sk.circle(10, { at: [15, 0] })', 'rect and circle side by side', { exact: { volume: (200 + P * 25) * H }, curved: true }),
  sc('multi-ring-and-far-rect', 'several shapes', 'sk.circle(24, { at: [0, 0] }); sk.circle(16, { at: [0, 0] }); sk.rect(8, 8, { at: [30, 0] })', 'ring + a far rect', { exact: { volume: (P * 80 + 64) * H }, curved: true }),
  sc('multi-rect-in-rect', 'several shapes', 'sk.rect(30, 30); sk.rect(10, 10)', 'rect hole in a rect', { exact: { volume: (900 - 100) * H } }),
  sc('multi-rect-off-hole', 'several shapes', 'sk.rect(40, 30); sk.rect(10, 6, { at: [8, -4] })', 'off-centre rect hole', { exact: { volume: (1200 - 60) * H } }),
  sc('multi-poly-with-rect-hole', 'several shapes', 'sk.polygon([[0,0],[40,0],[40,30],[0,30]]); sk.rect(10, 10, { at: [20, 15] })', 'polygon outline + rect hole', { exact: { volume: (1200 - 100) * H } }),
  sc('multi-slot-hole', 'several shapes', 'sk.rect(40, 20); sk.slot([-10, 0], [10, 0], 4)', 'slot cut as a hole in a plate', { exact: { volume: (800 - (2 * 4 * 20 + P * 16)) * H }, curved: true }),
  sc('multi-two-slots', 'several shapes', 'sk.slot([0, 0], [20, 0], 4); sk.slot([0, 20], [20, 20], 4)', 'two separate slots', { exact: { volume: 2 * (2 * 4 * 20 + P * 16) * H }, curved: true }),
  sc('multi-slot-then-circle', 'several shapes', 'sk.slot([0, 0], [20, 0], 6); sk.circle(6, { at: [10, 0] })', 'circle hole in a slot', { exact: { volume: ((2 * 6 * 20 + P * 36) - P * 9) * H }, curved: true }),
  sc('multi-touch-share-edge', 'several shapes', 'sk.rect(10, 10, { at: [-5, 0] }); sk.rect(10, 10, { at: [5, 0] })', 'two rects sharing an edge', {}),
  sc('multi-overlap-rects', 'several shapes', 'sk.rect(20, 10, { at: [0, 0] }); sk.rect(10, 20, { at: [0, 0] })', 'two overlapping rects forming a cross (edges cross)', {}),
  sc('multi-overlap-circles', 'several shapes', 'sk.circle(20, { at: [-6, 0] }); sk.circle(20, { at: [6, 0] })', 'two overlapping circles', {}),
  sc('multi-tangent-ext-circles', 'several shapes', 'sk.circle(10, { at: [-5, 0] }); sk.circle(10, { at: [5, 0] })', 'externally tangent circles', {}),
  sc('multi-tangent-int-circles', 'several shapes', 'sk.circle(20, { at: [0, 0] }); sk.circle(10, { at: [5, 0] })', 'internally tangent hole', {}),
  sc('multi-shape-on-front', 'several shapes', 'sk.rect(30, 20); sk.circle(8)', 'plate-with-hole on the front plane (offset 0; round 7: a front offset is refused)', { script: `const sk = sketch('front'); sk.rect(30, 20); sk.circle(8); extrude(sk, ${H})`, exact: { volume: (600 - P * 16) * H, bbox: [-15, -10, -10, 15, 0, 10] }, curved: true }),
  sc('multi-circle-then-rect', 'several shapes', 'sk.circle(10); sk.rect(30, 20)', 'circle first, then rect around it (order reversed)', { exact: { volume: (600 - P * 25) * H }, curved: true }),
  sc('multi-polygon-then-circle', 'several shapes', 'sk.polygon([[-15,-10],[15,-10],[15,10],[-15,10]]); sk.circle(10)', 'polygon first then circle', { exact: { volume: (600 - P * 25) * H }, curved: true }),
  // sentences for combinations the language refuses
  sc('multi-param-first', 'several shapes', "sk.circle(param('d', 20)); sk.circle(8)", 'param() drives the first of two shapes: refused'),
  sc('multi-param-second', 'several shapes', "sk.circle(20); sk.circle(param('d', 8))", 'param() on the second shape: refused'),
  sc('multi-round-then-shape', 'several shapes', 'sk.polygon([[0,0],[40,0],[40,30],[0,30]]); sk.round(1, 4); sk.circle(6, { at: [20, 15] })', 'rounded outline then a second shape: refused'),
  sc('multi-rect-rules-then-shape', 'several shapes', 'sk.rect(30, 20); sk.across(1); sk.circle(6)', 'rect with an across() rule then a second shape: refused'),
  sc('multi-shape-then-round', 'several shapes', 'sk.rect(30, 20); sk.circle(6); sk.round(1, 2)', 'round on a sketch of several shapes: refused'),
  // ---- param()
  { id: 'param-circle-across', feature: 'param circle/arc radius', what: 'circle across from param()', script: "const d = param('d', 12); const sk = sketch('top'); sk.circle(d); extrude(sk, 10)", exact: { volume: P * 36 * H }, curved: true },
  { id: 'param-geom-circle-r', feature: 'param circle/arc radius', what: 'circle row radius from param()', script: "const r = param('r', 6); const sk = sketch('top'); sk.geom([{k:'circle',id:1,c:[0,0],r:r}]); extrude(sk, 10)", exact: { volume: P * 36 * H }, curved: true },
  { id: 'param-geom-arc-r', feature: 'param circle/arc radius', what: 'arc row radius from param()', script: "const r = param('r', 10); const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,-10],b:[0,10]},{k:'arc',id:2,c:[0,0],r:r,a:[0,10],b:[0,-10],sense:'cw'}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)", exact: { volume: 0.5 * P * 100 * H }, curved: true },
];
