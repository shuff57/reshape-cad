// Fixtures for scripts/brep-parity-gate.mjs. LEAD-OWNED: the brep-rs builder
// must not edit this file (claimed via msg.mjs before handoff).
//
// Every fixture is compared against OpenCascade measured LIVE by the gate.
// None of these carry a hardcoded expected number: the reference is whatever
// OCCT builds, so a wrong constant in this file cannot become a wrong target.
//
// Sources:
//   shCode/scripts/test-occt-adapter.mjs DOCS -- 31 models, reused verbatim
//   scripts/occt-modeldoc-gate.mjs      -- prism, wedge, groove, pocket
//   NEW here                            -- coplanar/tangent booleans and named
//                                          face/edge resolution (SPEC §4.5, §4.6)
//
// tol: 'tight' = relative 1e-6; 'approx' = relative 1e-4 (fillet, blend,
// draft only -- SPEC §8 decision 2).

const box = (id, size, center = [0, 0, 0]) => ({ id, kind: 'box', size, center });
const cyl = (id, radius, height, center = [0, 0, 0]) => ({ id, kind: 'cylinder', radius, height, center });
const face = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });

function raw(id, kind, features, extra = {}) {
  return { id, kind, tol: 'tight', doc: () => ({ version: 1, features }), measure: features[features.length - 1].id, ...extra };
}

/** Built through model-types factories, exactly as scripts/occt-modeldoc-gate.mjs does. */
function made(id, kind, build) {
  return {
    id, kind, tol: 'tight',
    doc: (mt) => { const doc = { version: 1, features: [] }; const measure = build(mt, doc); return { ...doc, measure }; },
  };
}

export function fixtures() {
  return [
    // --- primitives -----------------------------------------------------------
    raw('box', 'box', [box('b1', [40, 30, 20])]),
    raw('cylinder', 'cylinder', [cyl('c1', 12, 30)]),
    raw('cone', 'cone', [{ id: 'c1', kind: 'cone', radius: 12, height: 30, center: [0, 0, 0] }]),
    raw('sphere', 'sphere', [{ id: 's1', kind: 'sphere', radius: 15, center: [0, 0, 0] }]),
    raw('torus', 'torus', [{ id: 't1', kind: 'torus', ringRadius: 14, tubeRadius: 4, center: [0, 0, 0] }]),
    made('prism-hex', 'prism', (mt, doc) => { const f = mt.newShape(doc, 'prism'); Object.assign(f, { sides: 6, radius: 10, height: 20, center: [0, 0, 0] }); doc.features.push(f); return f.id; }),
    made('prism-tri', 'prism', (mt, doc) => { const f = mt.newShape(doc, 'prism'); Object.assign(f, { sides: 3, radius: 10, height: 20, center: [0, 0, 0] }); doc.features.push(f); return f.id; }),
    made('wedge', 'wedge', (mt, doc) => { const f = mt.newShape(doc, 'wedge'); Object.assign(f, { width: 20, depth: 10, height: 6, center: [0, 0, 0] }); doc.features.push(f); return f.id; }),
    made('wedge-2', 'wedge', (mt, doc) => { const f = mt.newShape(doc, 'wedge'); Object.assign(f, { width: 30, depth: 12, height: 8, center: [0, 0, 0] }); doc.features.push(f); return f.id; }),

    // --- the primitive `round` property (NOT the fillet feature) --------------
    // Added 2026-09-15 after a visual pass: the studio's Round button sets
    // f.round/f.roundStyle straight on a box or cylinder (ModelEditor.tsx's own
    // "round/roundStyle fields a box or cylinder carries directly"), which
    // occt-build.ts builds with roundedEdges() on EVERY edge. That is a
    // different path from the `fillet` feature the fixtures above cover, and it
    // was refused by brep-rs while the gate stayed green -- the button a student
    // actually presses fell back to OCCT. `approx` because a rounded solid's
    // volume is rounded to 1e-4 by the reference measure, same as the fillet
    // fixtures.
    raw('box-round-fillet', 'round', [{ id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], round: 4, roundStyle: 'fillet' }], { tol: 'approx' }),
    raw('box-round-chamfer', 'round', [{ id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], round: 4, roundStyle: 'chamfer' }], { tol: 'approx' }),
    raw('cylinder-round-fillet', 'round', [{ id: 'c1', kind: 'cylinder', radius: 12, height: 30, center: [0, 0, 0], round: 3, roundStyle: 'fillet' }], { tol: 'approx' }),

    // --- sketch sweeps ----------------------------------------------------------
    raw('sketch-extrude', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ]),
    raw('sketch-on-xz', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xz', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ]),
    raw('sketch-on-yz-offset', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'yz', offset: 10, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ]),
    raw('circle-extrude', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, shape: 'circle', points: [[-15, 0], [15, 0]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 20 },
    ]),
    raw('rounded-corner', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]], rounds: { 1: 6 } },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ]),
    raw('chamfered-corner', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]], chamfers: { 1: 6 } },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ]),
    raw('bowed-edge', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]], bulges: { 0: 0.4 } },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ]),
    raw('revolve-on-xy', 'revolve', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[10, 0], [20, 0], [20, 30], [10, 30]] },
      { id: 'r1', kind: 'revolve', target: 'sk1', angle: 360 },
    ]),
    raw('revolve-on-xz', 'revolve', [
      { id: 'sk1', kind: 'sketch', plane: 'xz', offset: 0, points: [[10, 0], [20, 0], [20, 30], [10, 30]] },
      { id: 'r1', kind: 'revolve', target: 'sk1', angle: 360 },
    ]),
    raw('revolve-on-yz', 'revolve', [
      { id: 'sk1', kind: 'sketch', plane: 'yz', offset: 0, points: [[10, 0], [20, 0], [20, 30], [10, 30]] },
      { id: 'r1', kind: 'revolve', target: 'sk1', angle: 360 },
    ]),
    raw('blend', 'blend', [
      { id: 'sa', kind: 'sketch', plane: 'xy', offset: 0, points: [[-20, -20], [20, -20], [20, 20], [-20, 20]] },
      { id: 'sb', kind: 'sketch', plane: 'xy', offset: 30, points: [[-5, -5], [5, -5], [5, 5], [-5, 5]] },
      { id: 'bl1', kind: 'blend', targets: ['sa', 'sb'] },
    ], { tol: 'approx' }),

    // --- sketch cuts into a solid --------------------------------------------
    ...[[4, 8, 5, 12, 360, 'groove-full'], [4, 8, 5, 12, 180, 'groove-half'], [3, 6, -4, 4, 360, 'groove-straddle']].map(
      ([r0, r1, v0, v1, deg, id]) => made(id, 'groove', (mt, doc) => {
        const body = mt.newShape(doc, 'box'); body.size = [40, 40, 20]; doc.features.push(body);
        const prof = mt.newRectangleSketch(doc, 'xz', [r0, v0], [r1, v1]); doc.features.push(prof);
        const gr = mt.newGroove(doc, prof.id, body.id); gr.angle = deg; doc.features.push(gr);
        return gr.id;
      })),
    ...[
      ['pocket-xy', [40, 40, 20], [0, 0, 0], 'xy', 0, 5],
      ['pocket-xz', [40, 40, 20], [0, 0, 0], 'xz', 0, 5],
      ['pocket-G1-xy-slab', [40, 40, 8], [0, 0, 4], 'xy', 6, 5],
      ['pocket-G3-yz-slab', [8, 40, 40], [4, 0, 0], 'yz', 6, 5],
    ].map(([id, size, center, plane, offset, depth]) => made(id, 'pocket', (mt, doc) => {
      const body = mt.newShape(doc, 'box'); body.size = size; body.center = center; doc.features.push(body);
      const prof = mt.newRectangleSketch(doc, plane, [-5, -4], [5, 4]); prof.offset = offset; doc.features.push(prof);
      const pk = mt.newPocket(doc, prof.id, body.id); pk.depth = depth; doc.features.push(pk);
      return pk.id;
    })),
    made('pocket-G5-circle', 'pocket', (mt, doc) => {
      const body = mt.newShape(doc, 'box'); body.size = [60, 60, 8]; body.center = [0, 0, 4]; doc.features.push(body);
      const prof = mt.newCircleSketch(doc, 'xy', [12, -6]); prof.points = [[7, -6], [17, -6]]; prof.offset = 6; doc.features.push(prof);
      const pk = mt.newPocket(doc, prof.id, body.id); pk.depth = 5; doc.features.push(pk);
      return pk.id;
    }),

    // --- booleans, transforms, patterns --------------------------------------
    raw('boolean-cut', 'combine', [box('b1', [40, 40, 20]), cyl('c1', 8, 40), { id: 'op1', kind: 'combine', op: 'subtract', targets: ['b1', 'c1'] }]),
    raw('boolean-union', 'combine', [box('b1', [40, 40, 20]), cyl('c1', 8, 40), { id: 'op1', kind: 'combine', op: 'union', targets: ['b1', 'c1'] }]),
    raw('boolean-intersect', 'combine', [box('b1', [40, 40, 20]), cyl('c1', 15, 40), { id: 'op1', kind: 'combine', op: 'intersect', targets: ['b1', 'c1'] }]),
    raw('mirror', 'mirror', [box('b1', [20, 20, 20], [30, 0, 0]), { id: 'mir1', kind: 'mirror', target: 'b1', plane: 'yz' }]),
    raw('moved', 'move', [box('b1', [20, 20, 20]), { id: 'mv1', kind: 'move', target: 'b1', offset: [15, 5, 0] }]),
    raw('pattern-linear-3', 'pattern', [box('b1', [40, 40, 20]), { id: 'pat1', kind: 'pattern', target: 'b1', mode: 'linear', count: 3, step: [60, 0, 0] }]),
    raw('pattern-circular-6', 'pattern', [box('b1', [10, 10, 10], [30, 0, 0]), { id: 'pat1', kind: 'pattern', target: 'b1', mode: 'circular', count: 6, axis: 'z', totalAngle: 360 }]),
    raw('hole-through', 'hole', [box('b1', [40, 40, 20]), { id: 'hole1', kind: 'hole', target: 'b1', diameter: 6, depth: 22, center: [0, 0, 0], axis: 'z' }]),
    raw('hole-blind', 'hole', [box('b1', [40, 40, 20]), { id: 'hole1', kind: 'hole', target: 'b1', diameter: 6, depth: 10, center: [0, 0, 5], axis: 'z' }]), // blind FROM the top face (z=10): tool centre = 10 - 10/2
    raw('hole-corners', 'hole', [box('b1', [40, 40, 20]), { id: 'hole1', kind: 'hole', target: 'b1', diameter: 6, depth: 22, center: [0, 0, 0], axis: 'z', corners: { dx: 15, dy: 10 } }]),
    raw('hole-x-axis', 'hole', [box('b1', [40, 40, 20]), { id: 'hole1', kind: 'hole', target: 'b1', diameter: 6, depth: 42, center: [0, 0, 0], axis: 'x' }]),

    // --- shell, fillet, chamfer, draft ---------------------------------------
    raw('shell-2', 'shell', [box('b1', [40, 40, 20]), { id: 'shell1', kind: 'shell', target: 'b1', thickness: 2 }]),
    raw('shell-open-top', 'shell', [box('b1', [40, 40, 20]), { id: 'shell1', kind: 'shell', target: 'b1', thickness: 2, open: face('b1', '+z') }]),
    raw('round-one-edge', 'fillet', [box('b1', [40, 40, 20]), {
      id: 'r1', kind: 'fillet', target: 'b1', size: 4, style: 'fillet',
      edge: { cause: 'between', feature: 'b1', kind: 'edge', of: [face('b1', '+z'), face('b1', '+x')] },
    }], { tol: 'approx' }),
    raw('bevel-one-edge', 'fillet', [box('b1', [40, 40, 20]), {
      id: 'r1', kind: 'fillet', target: 'b1', size: 4, style: 'chamfer',
      edge: { cause: 'between', feature: 'b1', kind: 'edge', of: [face('b1', '+z'), face('b1', '+x')] },
    }], { tol: 'approx' }),
    raw('draft-one-face', 'draft', [box('b1', [40, 40, 20]), {
      id: 'd1', kind: 'draft', target: 'b1', angle: 8, pull: 'z', neutral: -10, face: face('b1', '+x'),
    }], { tol: 'approx' }),

    // --- NEW: coplanar and tangent booleans (SPEC §4.5, DEPARTURE 3) ----------
    // truck's own lib.rs: booleans work "only for shapes where faces intersect
    // transversally". Each of these puts two faces exactly on top of, or exactly
    // touching, each other.
    raw('coplanar-union-shared-face', 'combine', [box('a', [20, 20, 20]), box('b', [20, 20, 20], [20, 0, 0]), { id: 'op1', kind: 'combine', op: 'union', targets: ['a', 'b'] }]),
    raw('coplanar-subtract-flush-top', 'combine', [box('a', [40, 40, 20]), box('b', [10, 10, 10], [0, 0, 5]), { id: 'op1', kind: 'combine', op: 'subtract', targets: ['a', 'b'] }]),
    raw('coplanar-subtract-caps', 'combine', [box('a', [40, 40, 20]), cyl('c', 8, 20), { id: 'op1', kind: 'combine', op: 'subtract', targets: ['a', 'c'] }]),
    raw('coplanar-intersect-offset', 'combine', [box('a', [20, 20, 20]), box('b', [20, 20, 20], [0, 0, 10]), { id: 'op1', kind: 'combine', op: 'intersect', targets: ['a', 'b'] }]),
    raw('tangent-union-cylinder', 'combine', [box('a', [40, 40, 20]), cyl('c', 10, 20, [30, 0, 0]), { id: 'op1', kind: 'combine', op: 'union', targets: ['a', 'c'] }]),
    raw('tangent-subtract-touching', 'combine', [box('a', [40, 40, 20]), cyl('c', 10, 40, [30, 0, 0]), { id: 'op1', kind: 'combine', op: 'subtract', targets: ['a', 'c'] }]),

    // --- NEW 2026-09-15: booleans a Z-slab special case cannot pass ----------
    // Dispatch 6 passed every combine fixture above with a 2.5D "slice at every
    // Z, clip the cross-section polygons, stack the prisms" method: circles
    // sampled at 8192 points, convex clipping only, and anything not a Z-aligned
    // prism refused. It passed because every fixture above is a Z-aligned box or
    // cylinder. These three are not, and the gate's face-count bound catches the
    // faceting. See SPEC 4.5 and 4.7.
    raw('boolean-cut-x-axis-cylinder', 'combine', [box('a', [40, 40, 20]), { id: 'c', kind: 'cylinder', radius: 5, height: 60, center: [0, 0, 0], rotate: [0, 90, 0] }, { id: 'op1', kind: 'combine', op: 'subtract', targets: ['a', 'c'] }]),
    raw('boolean-sphere-minus-box', 'combine', [{ id: 's', kind: 'sphere', radius: 15, center: [0, 0, 0] }, box('b', [10, 10, 40]), { id: 'op1', kind: 'combine', op: 'subtract', targets: ['s', 'b'] }]),
    raw('boolean-nonconvex-l-minus-cylinder', 'combine', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 },
      cyl('c', 3, 30, [5, 20, 5]),
      { id: 'op1', kind: 'combine', op: 'subtract', targets: ['e1', 'c'] },
    ]),

    // --- Class 1 regressions (W8/W3) --------------------------------------------
    // W8: boolean subtract overlapping cylinders (parallel axes)
    raw('boolean-cylinder-minus-cylinder', 'combine', [
      cyl('c1', 12, 30, [0, 0, 0]),
      cyl('c2', 8, 30, [10, 0, 0]),
      { id: 'op1', kind: 'combine', op: 'subtract', targets: ['c1', 'c2'] },
    ]),
    // W8: boolean intersect overlapping cylinders
    raw('boolean-cylinder-intersect-cylinder', 'combine', [
      cyl('c1', 12, 30, [0, 0, 0]),
      cyl('c2', 8, 30, [10, 0, 0]),
      { id: 'op1', kind: 'combine', op: 'intersect', targets: ['c1', 'c2'] },
    ]),
    // W8: boolean union overlapping cylinders
    raw('boolean-cylinder-union-cylinder', 'combine', [
      cyl('c1', 12, 30, [0, 0, 0]),
      cyl('c2', 8, 30, [10, 0, 0]),
      { id: 'op1', kind: 'combine', op: 'union', targets: ['c1', 'c2'] },
    ]),
    // W3: general offset (shell) on a cylinder — OPEN at the top cap: the
    // outer caps become annuli, the void wall is exposed. Pinned volume is
    // OCCT-measured via the parity gate's live referee.
    raw('shell-cylinder-open-top', 'shell', [
      cyl('c1', 12, 30, [0, 0, 0]),
      { id: 'sh1', kind: 'shell', target: 'c1', thickness: 2, open: face('c1', '+z') },
    ]),
    // W3: closed cylinder hollow (enclosed void shell).
    raw('shell-cylinder-closed', 'shell', [
      cyl('c1', 12, 30, [0, 0, 0]),
      { id: 'sh1', kind: 'shell', target: 'c1', thickness: 2 },
    ]),
    // W2: the fillet feature on ONE rim of a cylinder (between the +z cap
    // and the curved side wall). OCCT's both-rims reference for r12 h30
    // rad3 is 13296.693532; each rim removes half the total removal, so
    // OCCT live-measures 13434.186898 here on 4 faces.
    raw('fillet-cylinder-edge', 'fillet', [
      cyl('c1', 12, 30, [0, 0, 0]),
      { id: 'r1', kind: 'fillet', target: 'c1', size: 3, style: 'fillet',
        edge: { cause: 'between', feature: 'c1', kind: 'edge',
                of: [face('c1', '+z'), face('c1', 'side')] } },
    ], { tol: 'approx' }),
    // W2: the same rim, chamfer style — OCCT live-measures 13260.662591.
    raw('chamfer-cylinder-edge', 'fillet', [
      cyl('c1', 12, 30, [0, 0, 0]),
      { id: 'r1', kind: 'fillet', target: 'c1', size: 3, style: 'chamfer',
        edge: { cause: 'between', feature: 'c1', kind: 'edge',
                of: [face('c1', '-z'), face('c1', 'side')] } },
    ], { tol: 'approx' }),

    // --- NEW: named resolution (SPEC §4.6) ------------------------------------
    raw('name-primitive-face', 'box', [box('b1', [40, 40, 20])], { resolve: face('b1', '+z') }),
    raw('name-between-edge', 'fillet', [box('b1', [40, 40, 20])], {
      resolve: { cause: 'between', feature: 'b1', kind: 'edge', of: [face('b1', '+z'), face('b1', '+x')] },
    }),
    raw('name-carried-after-cut', 'combine', [box('b1', [40, 40, 20]), cyl('c1', 8, 40), { id: 'op1', kind: 'combine', op: 'subtract', targets: ['b1', 'c1'] }], {
      resolve: { cause: 'carried', feature: 'op1', kind: 'face', of: face('b1', '+x') },
    }),
    // Added after the extrude dispatch reported it records no naming history:
    // without these, extrude passed on volume alone while a fillet, shell or
    // draft aimed at an extruded face could never resolve its target.
    raw('name-extrude-side', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ], { resolve: { cause: 'swept', feature: 'e1', kind: 'face', from: 'sk1', edge: 0 } }),
    raw('name-extrude-cap-top', 'extrude', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    ], { resolve: { cause: 'cap', feature: 'e1', kind: 'face', end: 'top' } }),

    // --- NEW 2026-09-29: the blind spots the gate is STRUCTURALLY unable to see ---
    // Added after an external-kernel review found the parity bar was measuring the
    // fixture list rather than the kernel. `hole-blind` drills exactly ONE floor;
    // `rounded-corner` builds an arc-bounded cap that nothing ever booleans; and the
    // W2a coplanar defect lives in a red #[test] where a green suite can walk past
    // it. Each fixture below may come back CORRECT or REFUSED. What they forbid is a
    // third answer: a wrong-but-closed solid that the manifold guard waves through.

    // (1) The class-2 regression pin, msgbox #329. Three blind floors at three depths,
    // which is the shape that lost every floor but the first before the void-wall
    // detection in ops.rs::region_inside. Spacing is generous on purpose: the spike's
    // own test separates its bores by 30/20mm and still lost them all, because the
    // region is built from EVERY face of the tool, void walls included.
    //
    // !! KNOWN DEFECT -- THIS FIXTURE IS A WITNESS, NOT COVERAGE. Measured 2026-09-29:
    // it PASSES at 1.5e-16 while measuring 47434.513322, which is 48000 less ONE d6
    // depth-20 bore -- h1 and h2 are silently discarded. Each hole ALONE is exact
    // (47773.805 / 47604.159 / 47434.513, all three matching the closed form), so the
    // loss is in doc dispatch, not in the boolean: a second cut on an already-cut target
    // does not compose. occt-build.ts shares the defect, which is exactly why the
    // differential gate cannot see it -- both sides make the same mistake, so they
    // agree. Expect 46812.5 once composition is fixed; until then a GREEN HERE MEANS
    // NOTHING. Catching this class needs a closed-form assertion, not a parity fixture.
    raw('bores-blind-stacked', 'hole', [
      box('b1', [40, 40, 30]),
      { id: 'h1', kind: 'hole', target: 'b1', diameter: 6, depth: 8, center: [-12, 0, 11], axis: 'z' },
      { id: 'h2', kind: 'hole', target: 'b1', diameter: 6, depth: 14, center: [0, 0, 8], axis: 'z' },
      { id: 'h3', kind: 'hole', target: 'b1', diameter: 6, depth: 20, center: [12, 0, 5], axis: 'z' },
    ]),
    // (2) A through bore FIRST, then a blind one beside it -- the W2a 2026-09-16 case,
    // kept apart from (1) because the ORDER is the bug: the blind tool's region is
    // clipped by the through bore's own wall, and its floor is dropped on the far side.
    // Same KNOWN DEFECT as (1): measures 47660.707993, which is 48000 less the depth-40
    // through bore less HALF the depth-12 blind bore -- the blind bore is what vanishes.
    raw('bore-through-then-blind', 'hole', [
      box('b1', [40, 40, 30]),
      { id: 'h1', kind: 'hole', target: 'b1', diameter: 6, depth: 40, center: [-12, 0, 0], axis: 'z' },
      { id: 'h2', kind: 'hole', target: 'b1', diameter: 6, depth: 12, center: [0, 0, 9], axis: 'z' },
    ]),
    // (3) A planar face bounded by a MIX of line and arc edges, inside a boolean. The
    // 6mm corner arc at index 1 is the whole point: the cut crosses it, so that cap must
    // be rebuilt with a true arc in its boundary. ops.rs::outer_uv pushes edge ENDPOINTS
    // only, so this is the fixture that would catch a rounded cap collapsing to a
    // CHORD polygon -- a wrong solid that still closes.
    raw('boolean-rounded-corner-cap', 'combine', [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]], rounds: { 1: 6 } },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
      box('t', [12, 12, 8], [40, 20, 12]),
      { id: 'op1', kind: 'combine', op: 'subtract', targets: ['e1', 't'] },
    ]),
    // (4) The exit criterion for W2a, promoted from red unit test to gate fixture.
    // ops.rs:4319 states it at the kernel level: a triangular corner prism whose two
    // coplanar sides sit ON the block's +x and +z faces, subtracted from a BOOLEAN
    // result, comes back 15546.67 against a closed form of 15840 -- each coplanar face's
    // whole 80mm overlap rectangle is deleted instead of being trimmed by the tool's
    // triangular section, so the shell stays closed and the guard waves it through.
    // The IDENTICAL prism off a plain box is exact, because the box fillet path
    // re-extrudes the cross-section -- hence the union underneath, which is what makes
    // this a boolean-only defect. As a red #[test] it is easy to leave red; as a parity
    // fixture it fails the GATE, alongside the other 68.
    raw('chamfer-on-boolean-result', 'combine', [
      box('plate', [40, 30, 10], [0, 0, -10]),
      box('blk', [20, 20, 10], [0, 0, 0]),
      { id: 'u1', kind: 'combine', op: 'union', targets: ['plate', 'blk'] },
      // The tool: a right triangle in the xz corner at (x=10, z=5), legs 4, swept along
      // y and overshot well past the 20mm block at both ends so its caps cannot clip
      // the cut. Two of its three sides are coplanar with the block's own +x and +z
      // faces, which is the entire mechanism. The offset is 65, not -50: an xz sketch
      // extrudes along NEGATIVE y from its offset, so 65 down to -45 is what covers
      // the block's y -10..+10. Measured, not guessed -- at offset -50 the tool parks
      // at y -160..-50, clear of the part, and this fixture then PASSES VACUOUSLY at
      // the untouched 16000. At offset 65 brep-rs returns 15546.666766666667 on 11
      // faces -- no bevel among them -- which is the wrong solid ops.rs:4312 records.
      { id: 'sk2', kind: 'sketch', plane: 'xz', offset: 65, points: [[10, 5], [6, 5], [10, 1]] },
      { id: 'e2', kind: 'extrude', target: 'sk2', height: 110 },
      { id: 'op2', kind: 'combine', op: 'subtract', targets: ['u1', 'e2'] },
    ]),
  ];
}
