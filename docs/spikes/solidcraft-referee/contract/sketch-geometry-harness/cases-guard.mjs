// Round 4 cases: the items the critic listed as missing, the floors the guard layer needs (calibrated here, not guessed), the contact
// kinds between shapes, the working form of sk.remove(rectangle), a pocket that splits a part, and a seeded fuzz of rounded/chamfered polygons.
// Run unguarded (repro.sh guard) for the "before" numbers and guarded (repro-guarded.sh guard) for the "after".
import { runScript, truckBuild, buildOCCT, buildBrep, measureCase } from './sg-core.mjs';
const P = Math.PI;
const H = 10;
const J = JSON.stringify;
const line = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
const coin = (a, aEnd, b, bEnd) => ({ k: 'coincident', a, aEnd, b, bEnd });
const geomScript = (geoms, rules, plane = "'top'") => `const sk = sketch(${plane}); sk.geom(${J(geoms)});${rules ? ` sk.rules(${J(rules)});` : ''} extrude(sk, ${H})`;
const g = (id, what, geoms, rules, extra = {}) => ({ id, feature: '.geom', what, script: geomScript(geoms, rules), ...extra });
const sc = (id, feature, body, what, extra = {}) => ({ id, feature, what, script: `const sk = sketch('top'); ${body}; extrude(sk, ${H})`, ...extra });
const join2 = [coin(1, 'b', 2, 'a'), coin(2, 'b', 1, 'a')];

// D shape (line + arc cw), arc row radius `r` while both ends are 10 from the centre
const dShape = (id, r, what, extra = {}) => g(id, what, [line(1, [0, -10], [0, 10]), { k: 'arc', id: 2, c: [0, 0], r, a: [0, 10], b: [0, -10], sense: 'cw' }], join2, extra);

// ---- seeded fuzz: simple (star-shaped) polygons with random rounds and chamfers ---------------------------------------------------
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fuzzCase(i) {
  const R = rng(1000 + i);
  const n = 3 + Math.floor(R() * 5);
  const angs = Array.from({ length: n }, () => R() * 2 * P).sort((a, b) => a - b);
  // keep consecutive angles apart so the polygon is clearly simple and has no sliver corner
  for (let k = 1; k < n; k++) if (angs[k] - angs[k - 1] < 0.35) angs[k] = angs[k - 1] + 0.35;
  if (angs[n - 1] - angs[0] > 2 * P - 0.35) return null;
  const pts = angs.map((a) => { const r = 10 + R() * 22; return [Math.round(r * Math.cos(a) * 1000) / 1000, Math.round(r * Math.sin(a) * 1000) / 1000]; });
  const edge = (c) => Math.min(Math.hypot(pts[c][0] - pts[(c + n - 1) % n][0], pts[c][1] - pts[(c + n - 1) % n][1]), Math.hypot(pts[c][0] - pts[(c + 1) % n][0], pts[c][1] - pts[(c + 1) % n][1]));
  const ops = [];
  for (let c = 0; c < n; c++) if (R() < 0.6) { const kind = R() < 0.5 ? 'round' : 'chamfer'; const v = Math.round((0.2 + R() * 1.1) * edge(c) * 1000) / 1000; ops.push(`sk.${kind}(${c + 1}, ${v})`); }
  return { id: `fuzz-${String(i).padStart(3, '0')}`, feature: 'fuzz rounds/chamfers', what: `seeded random ${n}-gon with ${ops.length} treatments`, script: `const sk = sketch('top'); sk.polygon(${J(pts)}); ${ops.join('; ')}; extrude(sk, ${H})`, fuzz: true };
}
const fuzz = Array.from({ length: 160 }, (_, i) => fuzzCase(i)).filter(Boolean).slice(0, 150);

// ---- downstream of a pocket that splits the part into two pieces ----------------------------------------------------------------
const splitCase = (id, what, tail, expectTotal) => ({
  id, feature: 'multi-piece downstream', what,
  custom: async () => {
    const script = "const sk = sketch('top'); sk.rect(40, 10); const p = extrude(sk, 10); const s2 = sketch('top', 10); s2.rect(6, 10); pocket(s2, p, 10);" + tail;
    const r = runScript(script);
    if (r.errors.length) return { id, what, outcome: 'SCRIPT-REFUSED', scriptErrors: r.errors.map((e) => e.message), summary: { scriptErrors: r.errors.map((e) => e.message) } };
    const last = r.doc.features[r.doc.features.length - 1].id;
    const t = await truckBuild(r.doc, last);
    const b = buildBrep(r.doc, last);
    const total = (t.lastBodies ?? []).reduce((a, x) => a + x.volume, 0);
    const statuses = (t.all ?? []).filter((x) => x.status !== 'noop').map((x) => `${x.id}:${x.status}${x.refusal ? ` (${x.refusal})` : ''}`);
    const summary = { what, expectTotal, features: statuses, truckTotalAllBodies: t.lastBodies ? total : null, truckBodies: (t.lastBodies ?? []).map((x) => `${x.name}=${x.volume.toFixed(3)}`), brep: b.m ? b.m.volume : `refused: ${b.refused}`, lastFeature: t.refused ? `refused: ${t.refused}` : `built ${t.m?.volume}` };
    const outcome = t.refused ? 'TRUCK-REFUSED' : (Math.abs((t.m?.volume ?? 0) - expectTotal) / expectTotal <= 3e-4 ? 'PASS' : 'WRONG-SILENT');
    return { id, what, custom: true, outcome, summary, truck: { volume: t.m?.volume, refused: t.refused ?? null }, brep: summary.brep, guard: t.guard ?? null };
  },
});

export const cases = [
  // ---------- identical / repeated shapes on one sketch (critic: "identical shapes are not tested") ----------
  sc('dup-circle', 'several shapes', 'sk.circle(20); sk.circle(20)', 'the same circle drawn twice: even-odd leaves nothing solid'),
  sc('dup-circle-x3', 'several shapes', 'sk.circle(20); sk.circle(20); sk.circle(20)', 'the same circle drawn three times'),
  sc('dup-rect', 'several shapes', 'sk.rect(20, 20); sk.rect(20, 20)', 'the same rect drawn twice'),
  sc('dup-slot', 'several shapes', 'sk.slot([0,0],[20,0],4); sk.slot([0,0],[20,0],4)', 'the same slot drawn twice'),
  sc('dup-rect-polygon', 'several shapes', 'sk.polygon([[0,0],[20,0],[20,20],[0,20]]); sk.rect(20, 20, { at: [10, 10] })', 'a polygon and a rect over the same area (a "hole" the size of the outer)'),
  sc('dup-hole-same-as-outer-circle', 'several shapes', 'sk.circle(30); sk.circle(30, { at: [0, 0] })', 'a hole exactly the size of its outer circle'),
  // ---------- .geom arc with coincident ends and arcs whose radius is a little off ----------
  g('geom-arc-full-circle', 'one arc row whose two ends coincide (a full circle written as an arc)', [{ k: 'arc', id: 1, c: [0, 0], r: 10, a: [10, 0], b: [10, 0], sense: 'ccw' }], [coin(1, 'b', 1, 'a')], { curved: true }),
  g('geom-arc-full-circle-norule', 'the same, no rule', [{ k: 'arc', id: 1, c: [0, 0], r: 10, a: [10, 0], b: [10, 0], sense: 'ccw' }], null, { curved: true }),
  dShape('dshape-r10-control', 10, 'CONTROL: D shape, arc radius 10 = distance of both ends from the centre', { exact: { volume: 0.5 * P * 100 * H }, curved: true }),
  dShape('dshape-r9.9', 9.9, 'D shape, arc row radius 9.9 while both ends are 10 from the centre'),
  dShape('dshape-r10.5', 10.5, 'D shape, arc row radius 10.5 while both ends are 10 from the centre'),
  dShape('dshape-r10.0001', 10.0001, 'D shape, arc row radius 10.0001 (1e-4 off)'),
  // ---------- the one-call slot with its radius slider ----------
  { id: 'slot-radius-slider-4', feature: '.slot', what: 'CONTROL: slot (0,0)-(20,0) r4', script: "const r = param('r', 4); const sk = sketch('top'); sk.slot([0,0],[20,0],r); extrude(sk, 10)", exact: { volume: (2 * 4 * 20 + P * 16) * H }, curved: true },
  { id: 'slot-radius-slider-6', feature: '.slot', what: 'slot r=4 with its arc-1 radius slider (sk1_g1r) moved to 6 and nothing else', script: "const sk = sketch('top'); sk.slot([0,0],[20,0],4); extrude(sk, 10)", values: { sk1_g1r: 6 }, exact: { volume: (2 * 6 * 20 + P * 36) * H }, curved: true },
  { id: 'slot-radius-both-6', feature: '.slot', what: 'slot r=4 with BOTH cap radius sliders (sk1_g1r, sk1_g2r) moved to 6', script: "const r = param('r', 4); const sk = sketch('top'); sk.slot([0,0],[20,0],r); extrude(sk, 10)", values: { sk1_g1r: 6, sk1_g2r: 6 }, exact: { volume: (2 * 6 * 20 + P * 36) * H }, curved: true },
  // ---------- floors: where the build stops being exact (calibrates LIMITS in sketch-geometry.guard.mjs) ----------
  ...[0.0005, 0.001, 0.002, 0.01].map((w) => ({ id: `floor-rect-${w}`, feature: 'size floor', what: `rect ${w} x 5 pulled 10`, script: `const sk = sketch('top'); sk.rect(${w}, 5); extrude(sk, 10)`, exact: { volume: w * 5 * 10 } })),
  ...[1e-4, 3e-4, 1e-3, 3e-3, 1e-2].map((d) => ({ id: `floor-chamfer-${d}`, feature: 'size floor', what: `chamfer corner 1 by ${d} on a 40 x 30 rect`, script: `const sk = sketch('top'); sk.rect(40, 30); sk.chamfer(1, ${d}); extrude(sk, 10)`, exact: { volume: (1200 - d * d / 2) * 10 } })),
  ...[1e-3, 1e-2, 0.1].map((r) => ({ id: `floor-round-${r}`, feature: 'size floor', what: `round corner 1 by ${r} on a 40 x 30 rect`, script: `const sk = sketch('top'); sk.rect(40, 30); sk.round(1, ${r}); extrude(sk, 10)`, exact: { volume: (1200 - r * r * (1 - P / 4)) * 10 }, curved: true })),
  ...[0, 1e-5, 1e-4, 1e-3, 1e-2, 0.1].map((flat) => { const r = (40 - flat) / 2; return { id: `floor-round-pair-flat-${flat}`, feature: 'size floor', what: `corners 1 and 2 of a 40 x 60 rect rounded r=${r} so ${flat} mm of the shared 40 mm edge is left`, script: `const sk = sketch('top'); sk.rect(40, 60); sk.round(1, ${r}); sk.round(2, ${r}); extrude(sk, 10)`, exact: { volume: (2400 - 2 * r * r * (1 - P / 4)) * 10 }, curved: true }; }),
  ...[1e-4, 1e-5, 1e-6].map((w) => ({ id: `floor-rect-${w}`, feature: 'size floor', what: `rect ${w} x 5 pulled 10`, script: `const sk = sketch('top'); sk.rect(${w}, 5); extrude(sk, 10)`, exact: { volume: w * 5 * 10 } })),
  ...[0.002, 0.001, 0.0005].map((r) => ({ id: `floor-slot-long-r${r}`, feature: 'size floor', what: `slot (0,0)-(1000,0) r=${r} pulled 10: a big part with tiny caps`, script: `const sk = sketch('top'); sk.slot([0,0],[1000,0],${r}); extrude(sk, 10)`, exact: { volume: (2 * r * 1000 + P * r * r) * 10 }, curved: true })),
  ...[0.05, 0.2].map((r) => ({ id: `floor-circle-in-big-r${r}`, feature: 'size floor', what: `rect 100 x 100 with a hole of r=${r}`, script: `const sk = sketch('top'); sk.rect(100, 100); sk.circle(${2 * r}, { at: [20, 20] }); extrude(sk, 10)`, exact: { volume: (10000 - P * r * r) * 10 }, curved: true })),
  ...[[0.4, 100], [0.3, 30], [0.2, 200], [0.1, 1000], [0.05, 2000], [0.2, 60], [0.5, 5], [1, 1]].map(([d, h]) => ({ id: `floor-circle-${d}-h${h}`, feature: 'size floor', what: `circle across ${d} pulled ${h} (volume ${(P * d * d / 4 * h).toFixed(3)} mm3)`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, ${h})`, exact: { volume: P * d * d / 4 * h }, curved: true })),
  ...[0.1, 0.25, 0.4, 0.5, 0.6, 1].map((d) => ({ id: `floor-circle-${d}`, feature: 'size floor', what: `circle across ${d} pulled 10`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, 10)`, exact: { volume: P * d * d / 4 * 10 }, curved: true })),
  ...[0.1, 0.25, 0.5, 1].map((r) => ({ id: `floor-slot-r${r}`, feature: 'size floor', what: `slot (0,0)-(10,0) r=${r} pulled 10`, script: `const sk = sketch('top'); sk.slot([0,0],[10,0],${r}); extrude(sk, 10)`, exact: { volume: (2 * r * 10 + P * r * r) * 10 }, curved: true })),
  ...[5, 0.4].map((w) => ({ id: `floor-long-slot-w${w}`, feature: 'size floor', what: `slot (0,0)-(100,0) r=${w / 2} (a ${w} mm wide slot, 100 long)`, script: `const sk = sketch('top'); sk.slot([0,0],[100,0],${w / 2}); extrude(sk, 10)`, exact: { volume: (w * 100 + P * (w / 2) ** 2) * 10 }, curved: true })),
  // ---------- contact kinds between shapes ----------
  sc('contact-corner-corner', 'several shapes', 'sk.rect(10, 10, { at: [-5, 5] }); sk.rect(10, 10, { at: [5, 15] })', 'two rects touching only at a corner'),
  sc('contact-corner-on-edge', 'several shapes', 'sk.rect(10, 10, { at: [-5, 5] }); sk.polygon([[0, 5], [5, 10], [10, 5], [5, 0]])', 'a diamond whose corner (0, 5) lands in the middle of the right edge of a rect'),
  sc('contact-circle-on-edge', 'several shapes', 'sk.rect(20, 10); sk.circle(6, { at: [0, 2] })', 'a circle hole tangent to the rect edge from inside (touches the top edge)'),
  sc('contact-ring-tangent-in', 'several shapes', 'sk.circle(30); sk.circle(10, { at: [10, 0] })', 'a hole internally tangent to its outer circle (FreeCAD ref class)', { exact: { volume: (P * 225 - P * 25) * H }, curved: true }),
  sc('contact-two-tangent-out', 'several shapes', 'sk.circle(10, { at: [-5, 0] }); sk.circle(10, { at: [5, 0] })', 'two circles touching from outside (FreeCAD ref class)', { exact: { volume: 2 * P * 25 * H }, curved: true }),
  sc('contact-nested-ok', 'several shapes', 'sk.rect(40, 30); sk.circle(10, { at: [5, 3] })', 'CONTROL: a hole well inside', { exact: { volume: (1200 - P * 25) * H }, curved: true }),
  sc('contact-side-by-side-ok', 'several shapes', 'sk.rect(10, 10, { at: [-10, 0] }); sk.rect(10, 10, { at: [10, 0] })', 'CONTROL: two separate pieces', { exact: { volume: 2000 } }),
  sc('contact-circle-crosses-rect', 'several shapes', 'sk.rect(20, 10); sk.circle(8, { at: [10, 0] })', 'a circle crossing the edge of the rect'),
  g('geom-vertex-on-edge', 'a closed loop of 6 lines (all ends joined) whose line 4 ends at (10, 0), the MIDDLE of line 1: a vertex on a non-neighbouring edge', [line(1, [0, 0], [20, 0]), line(2, [20, 0], [20, 10]), line(3, [20, 10], [10, 10]), line(4, [10, 10], [10, 0]), line(5, [10, 0], [0, 10]), line(6, [0, 10], [0, 0])], [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 4, 'a'), coin(4, 'b', 5, 'a'), coin(5, 'b', 6, 'a'), coin(6, 'b', 1, 'a')]),
  g('geom-chord-pointonobject', 'a square (4 lines, 4 joins) plus a chord line 5 whose ends are declared ON lines 1 and 3 by pointOnObject rows (a T junction made with rules, not a corner)', [line(1, [0, 0], [20, 0]), line(2, [20, 0], [20, 10]), line(3, [20, 10], [0, 10]), line(4, [0, 10], [0, 0]), line(5, [10, 0], [10, 10])], [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 4, 'a'), coin(4, 'b', 1, 'a'), { k: 'pointOnObject', a: 5, aEnd: 'a', b: 1 }, { k: 'pointOnObject', a: 5, aEnd: 'b', b: 3 }]),
  sc('contact-shared-edge-rects', 'several shapes', 'sk.rect(10, 10, { at: [-5, 0] }); sk.rect(10, 10, { at: [5, 0] })', 'two rects sharing the edge x=0'),
  sc('contact-partial-shared-edge', 'several shapes', 'sk.rect(10, 10, { at: [-5, 0] }); sk.rect(10, 10, { at: [5, 3] })', 'two rects sharing PART of an edge'),
  { id: 'poly-spike-fold', feature: '.polygon', what: 'polygon whose second edge doubles back along the first ((0,0),(10,0),(5,0),(5,8),(0,8))', script: "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[5,0],[5,8],[0,8]]); extrude(sk, 10)" },
  { id: 'rect-neg-height', feature: '.rect', what: 'rect(3, -5) as the only shape: same rectangle as rect(3, 5)', script: "const sk = sketch('top'); sk.rect(3, -5); extrude(sk, 10)", exact: { volume: 150, bbox: [-1.5, -2.5, 0, 1.5, 2.5, 10] } },
  { id: 'rect-neg-second', feature: '.rect', what: 'rect(-3, 5) as the SECOND shape: the interpreter refuses it', script: "const sk = sketch('top'); sk.rect(30, 20); sk.rect(-3, 5); extrude(sk, 10)" },
  // ---------- the critic's examples of valid inputs the old path refused with 'zero-length line' ----------
  { id: 'crit-round-pair-10x10', feature: 'round / chamfer eating a whole edge', what: 'round(1,5).round(2,5) on a 10 x 10 square: the two rounds use the whole bottom edge', script: "const sk = sketch('top'); sk.rect(10, 10); sk.round(1, 5); sk.round(2, 5); extrude(sk, 10)", exact: { volume: (100 - 2 * 25 * (1 - P / 4)) * H }, curved: true },
  { id: 'crit-round4-r10-40x20', feature: 'round / chamfer eating a whole edge', what: 'four r=10 rounds on a 40 x 20 rectangle: a stadium', script: "const sk = sketch('top'); sk.rect(40, 20); sk.round(1, 10); sk.round(2, 10); sk.round(3, 10); sk.round(4, 10); extrude(sk, 10)", exact: { volume: (800 - 400 * (1 - P / 4)) * H }, curved: true },
  { id: 'crit-chamfer-25-40x20', feature: 'round / chamfer eating a whole edge', what: 'chamfer(1,25) on a 40 x 20 rectangle (clamped to 20, the whole left edge)', script: "const sk = sketch('top'); sk.rect(40, 20); sk.chamfer(1, 25); extrude(sk, 10)", exact: { volume: 600 * H } },
  // ---------- friendly sk.remove of a rectangle: the form the sentence tells the student to use ----------
  { id: 'fr-remove-rectangle-sides', feature: 'sk.remove', what: 'friendly: remove the four sides of a rectangle one by one (what the new sentence says), a circle stays', preamble: true, script: "const sk = sketch('top')\nconst r = sk.rectangle([0,0],[20,10])\nsk.circle([50,50],{r:5})\nsk.remove(r.bottom)\nsk.remove(r.right)\nsk.remove(r.top)\nsk.remove(r.left)\nconst part = extrude(sk, 10)", exact: { volume: P * 25 * H }, curved: true },
  // ---------- pocket that splits the part ----------
  splitCase('ds-split-pocket-alone', 'bar 40x10x10 with a 6-wide through pocket: two pieces, total 3400', '', 3400),
  splitCase('ds-split-then-hole', 'the same, then a hole D4 deep 20 at the centre of the left piece', " hole(p, { across: 4, deep: 20, at: [-15, 0] });", 3400 - P * 4 * 10),
  ...fuzz,
];
