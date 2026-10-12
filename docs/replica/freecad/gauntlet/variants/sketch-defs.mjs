// Sketch-piece variants. A variant is a NEUTRAL spec (geometry + rules) translated twice, once into the FreeCAD
// Sketcher (python text) and once into brep-rs soup rows (geom + rules for SketchSession2D).  The translators are
// the only place the two vocabularies meet; the numbers (DoF, which rules conflict) come from running each solver.
//
// neutral geometry   {k:'line',a:[x,y],b:[x,y]} | {k:'circle',c:[x,y],r} | {k:'arc',c,r,s:deg,e:deg}  (arc runs CCW from s to e, FreeCAD's form)
// neutral ends       line: 'a' 'b'      circle: 'c'      arc: 's' (start) 'e' (end) 'c'
// neutral rules      join  tangentJoin  tangent(edge)  h  v  parallel  perpendicular  equal  radius  diameter  length  dx  dy  fixAt
//   join/tangentJoin {a,ae,b,be}; fixAt {a,ae,x,y}; length {a,value}; dx/dy {a,ae,b,be,value}  (a,b are 0-based geometry indices)
const rad = (d) => (d * Math.PI) / 180;
const num = (x) => String(+x.toFixed(9));

const FC_END = (g, e) => (g.k === 'arc' ? { s: 1, e: 2, c: 3 }[e] : g.k === 'line' ? { a: 1, b: 2 }[e] : 3);
const OURS_END = (g, e) => (g.k === 'arc' ? { s: 'b', e: 'a', c: 'c' }[e] : e);
const arcPt = (g, deg) => [g.c[0] + g.r * Math.cos(rad(deg)), g.c[1] + g.r * Math.sin(rad(deg))];

function oursGeom(geom) {
  return geom.map((g, i) => {
    const id = i + 1;
    if (g.k === 'line') return { k: 'line', id, a: g.a, b: g.b };
    if (g.k === 'circle') return { k: 'circle', id, c: g.c, r: g.r };
    return { k: 'arc', id, c: g.c, r: g.r, a: arcPt(g, g.e), b: arcPt(g, g.s), sense: 'cw' };
  });
}

/** neutral rule -> { ours: [rows], fc: [python constraint expressions] } */
function translate(geom, r) {
  const og = (i) => i + 1;
  const A = (k) => geom[r[k]];
  const fe = (gk, ek) => FC_END(geom[r[gk]], r[ek]);
  const oe = (gk, ek) => OURS_END(geom[r[gk]], r[ek]);
  const C = (...a) => `Sketcher.Constraint(${a.join(', ')})`;
  switch (r.k) {
    case 'join':
      return { ours: [{ k: 'coincident', a: og(r.a), aEnd: oe('a', 'ae'), b: og(r.b), bEnd: oe('b', 'be') }], fc: [C(`'Coincident'`, r.a, fe('a', 'ae'), r.b, fe('b', 'be'))] };
    case 'tangentJoin': {
      // brep-rs's tangent row used to want the LINE first and the ARC second (the other order solved to
      // "geometry N is a line and has no 'c' point"; fixed, either order solves now); the translator still puts them line-first unless r.asGiven is set.
      const swap = !r.asGiven && geom[r.a].k === 'arc' && geom[r.b].k === 'line';
      const [a, ae, b, be] = swap ? [r.b, r.be, r.a, r.ae] : [r.a, r.ae, r.b, r.be];
      const T = (i, e) => OURS_END(geom[i], e);
      return {
        ours: [{ k: 'coincident', a: og(r.a), aEnd: oe('a', 'ae'), b: og(r.b), bEnd: oe('b', 'be') }, { k: 'tangent', a: og(a), aEnd: T(a, ae), b: og(b), bEnd: T(b, be) }],
        fc: [C(`'Tangent'`, r.a, fe('a', 'ae'), r.b, fe('b', 'be'))],
      };
    }
    case 'tangent': return { ours: [{ k: 'tangent', a: og(r.a), b: og(r.b), ...(r.mode ? { mode: r.mode } : {}) }], fc: [C(`'Tangent'`, r.a, r.b)] };
    case 'h': return { ours: [{ k: 'horizontal', a: og(r.a) }], fc: [C(`'Horizontal'`, r.a)] };
    case 'v': return { ours: [{ k: 'vertical', a: og(r.a) }], fc: [C(`'Vertical'`, r.a)] };
    case 'parallel': return { ours: [{ k: 'parallel', a: og(r.a), b: og(r.b) }], fc: [C(`'Parallel'`, r.a, r.b)] };
    case 'perpendicular': return { ours: [{ k: 'perpendicular', a: og(r.a), b: og(r.b) }], fc: [C(`'Perpendicular'`, r.a, r.b)] };
    case 'equal': return { ours: [{ k: 'equal', a: og(r.a), b: og(r.b) }], fc: [C(`'Equal'`, r.a, r.b)] };
    case 'radius': return { ours: [{ k: 'radius', a: og(r.a), value: r.value }], fc: [C(`'Radius'`, r.a, num(r.value))] };
    case 'diameter': return { ours: [{ k: 'diameter', a: og(r.a), value: r.value }], fc: [C(`'Diameter'`, r.a, num(r.value))] };
    case 'length': return { ours: [{ k: 'distance', a: og(r.a), aEnd: 'a', b: og(r.a), bEnd: 'b', value: r.value }], fc: [C(`'Distance'`, r.a, num(r.value))] };
    case 'dx': case 'dy': {
      const nm = r.k === 'dx' ? 'distanceX' : 'distanceY';
      return { ours: [{ k: nm, a: og(r.a), aEnd: oe('a', 'ae'), b: og(r.b), bEnd: oe('b', 'be'), value: r.value }], fc: [C(`'${r.k === 'dx' ? 'DistanceX' : 'DistanceY'}'`, r.a, fe('a', 'ae'), r.b, fe('b', 'be'), num(r.value))] };
    }
    case 'fixAt': {
      const e = fe('a', 'ae');
      const fc = [];
      if (r.x === 0 && r.y === 0) fc.push(C(`'Coincident'`, r.a, e, -1, 1));
      else {
        fc.push(r.x === 0 ? C(`'PointOnObject'`, r.a, e, -2) : C(`'DistanceX'`, -1, 1, r.a, e, num(r.x)));
        fc.push(r.y === 0 ? C(`'PointOnObject'`, r.a, e, -1) : C(`'DistanceY'`, -1, 1, r.a, e, num(r.y)));
      }
      return { ours: [{ k: 'lock', a: og(r.a), aEnd: oe('a', 'ae') }], fc };
    }
    default: throw new Error('unknown neutral rule ' + r.k);
  }
}

function fcGeomPy(g) {
  if (g.k === 'line') return `sk.addGeometry(Part.LineSegment(V(${num(g.a[0])},${num(g.a[1])},0),V(${num(g.b[0])},${num(g.b[1])},0)),False)`;
  if (g.k === 'circle') return `sk.addGeometry(Part.Circle(V(${num(g.c[0])},${num(g.c[1])},0),V(0,0,1),${num(g.r)}),False)`;
  return `sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(${num(g.c[0])},${num(g.c[1])},0),V(0,0,1),${num(g.r)}),${num(rad(g.s))},${num(rad(g.e))}),False)`;
}

export function skV(piece, slug, desc, { geom, rules }) {
  const oursRows = [], oursMap = [], fcLines = [], fcMap = [];
  rules.forEach((r, i) => {
    const t = translate(geom, r);
    for (const row of t.ours) { oursRows.push(row); oursMap.push(i); }
    for (const c of t.fc) { fcLines.push(c); fcMap.push(i); }
  });
  const id = `${piece}__${slug}`;
  const fc = [
    'doc, body = setup()', "sk = sketch(body, 'top')",
    ...geom.map(fcGeomPy),
    ...fcLines.map((c) => `sk.addConstraint(${c})`),
    `sk_emit(${JSON.stringify(id)}, sk)`,
  ].join('\n');
  return { id, piece, desc, kind: 'sketch', spec: { geom, rules }, oursGeom: oursGeom(geom), oursRules: oursRows, oursMap, fcMap, fc };
}

// ---- shared building blocks ------------------------------------------------------------------------------------------------------------
const L = (a, b) => ({ k: 'line', a, b });
const rectGeom = (x0, y0, x1, y1) => [L([x0, y0], [x1, y0]), L([x1, y0], [x1, y1]), L([x1, y1], [x0, y1]), L([x0, y1], [x0, y0])];
const rectJoins = () => [0, 1, 2, 3].map((i) => ({ k: 'join', a: i, ae: 'b', b: (i + 1) % 4, be: 'a' }));
const rectShape = () => [...rectJoins(), { k: 'h', a: 0 }, { k: 'h', a: 2 }, { k: 'v', a: 1 }, { k: 'v', a: 3 }];
const W = (v) => ({ k: 'dx', a: 0, ae: 'a', b: 0, be: 'b', value: v });
const H = (v) => ({ k: 'dy', a: 1, ae: 'a', b: 1, be: 'b', value: v });
const pin = (x, y) => ({ k: 'fixAt', a: 0, ae: 'a', x, y });

const S = [];
const piece = 'sk-rect-dof';
S.push(skV(piece, 'corner-origin-25x60', 'a 25 x 60 rectangle, corner on the origin: fully constrained', { geom: rectGeom(0, 0, 25, 60), rules: [...rectShape(), pin(0, 0), W(25), H(60)] }));
S.push(skV(piece, 'offset-corner-30x18', 'a 30 x 18 rectangle with its corner pinned at (-10,5)', { geom: rectGeom(-10, 5, 20, 23), rules: [...rectShape(), pin(-10, 5), W(30), H(18)] }));
S.push(skV(piece, 'square-by-equal', 'a square: one side 22 and equal(side1, side2), corner at (7,-3)', { geom: rectGeom(7, -3, 29, 19), rules: [...rectShape(), pin(7, -3), W(22), { k: 'equal', a: 0, b: 1 }] }));
S.push(skV(piece, 'right-triangle', 'right triangle 30 x 20 from three joined lines, corner on the origin', {
  geom: [L([0, 0], [30, 0]), L([30, 0], [0, 20]), L([0, 20], [0, 0])],
  rules: [{ k: 'join', a: 0, ae: 'b', b: 1, be: 'a' }, { k: 'join', a: 1, ae: 'b', b: 2, be: 'a' }, { k: 'join', a: 2, ae: 'b', b: 0, be: 'a' }, { k: 'h', a: 0 }, { k: 'v', a: 2 }, pin(0, 0), { k: 'length', a: 0, value: 30 }, { k: 'length', a: 2, value: 20 }],
}));
S.push(skV(piece, 'parallelogram', 'parallelogram: two horizontal sides, the others parallel; base 30, slant 10 across and 15 up', {
  geom: [L([0, 0], [30, 0]), L([30, 0], [40, 15]), L([40, 15], [10, 15]), L([10, 15], [0, 0])],
  rules: [...rectJoins(), { k: 'h', a: 0 }, { k: 'h', a: 2 }, { k: 'parallel', a: 1, b: 3 }, pin(0, 0), { k: 'length', a: 0, value: 30 }, { k: 'dx', a: 1, ae: 'a', b: 1, be: 'b', value: 10 }, { k: 'dy', a: 1, ae: 'a', b: 1, be: 'b', value: 15 }],
}));
S.push(skV(piece, 'circle-pinned', 'a circle of radius 7 with its centre pinned at (4,-6)', { geom: [{ k: 'circle', c: [4, -6], r: 7 }], rules: [{ k: 'fixAt', a: 0, ae: 'c', x: 4, y: -6 }, { k: 'radius', a: 0, value: 7 }] }));

const pu = 'sk-rect-underconstrained';
S.push(skV(pu, 'hv-only-30x15', 'rectangle with joins, horizontals and verticals only: 4 free', { geom: rectGeom(0, 0, 30, 15), rules: rectShape() }));
S.push(skV(pu, 'width-only', 'plus the width: 3 free', { geom: rectGeom(0, 0, 30, 15), rules: [...rectShape(), W(30)] }));
S.push(skV(pu, 'width-and-height', 'plus width and height: only the position is free', { geom: rectGeom(0, 0, 30, 15), rules: [...rectShape(), W(30), H(15)] }));
S.push(skV(pu, 'pinned-corner-only', 'corner pinned, no dimensions: width and height free', { geom: rectGeom(2, 3, 32, 18), rules: [...rectShape(), pin(2, 3)] }));
S.push(skV(pu, 'free-line', 'one line, no rules: 4 free', { geom: [L([0, 0], [20, 5])], rules: [] }));
S.push(skV(pu, 'free-circle', 'one circle, no rules: 3 free', { geom: [{ k: 'circle', c: [5, 5], r: 4 }], rules: [] }));
S.push(skV(pu, 'triangle-joined', 'three joined lines and nothing else', {
  geom: [L([0, 0], [30, 0]), L([30, 0], [10, 20]), L([10, 20], [0, 0])],
  rules: [{ k: 'join', a: 0, ae: 'b', b: 1, be: 'a' }, { k: 'join', a: 1, ae: 'b', b: 2, be: 'a' }, { k: 'join', a: 2, ae: 'b', b: 0, be: 'a' }],
}));
S.push(skV(pu, 'circle-radius-only', 'a circle with its radius fixed: the centre is free', { geom: [{ k: 'circle', c: [5, 5], r: 4 }], rules: [{ k: 'radius', a: 0, value: 4 }] }));

const pc = 'sk-conflict';
const base20 = (w, h) => [...rectShape(), pin(0, 0), W(w), H(h)];
S.push(skV(pc, 'width-30-vs-35', 'a 30 x 20 rectangle then a second, contradicting width 35', { geom: rectGeom(0, 0, 30, 20), rules: [...base20(30, 20), W(35)] }));
S.push(skV(pc, 'redundant-width', 'a 30 x 20 rectangle then the same width 30 again', { geom: rectGeom(0, 0, 30, 20), rules: [...base20(30, 20), W(30)] }));
S.push(skV(pc, 'redundant-height', 'a 30 x 20 rectangle then the same height 20 again', { geom: rectGeom(0, 0, 30, 20), rules: [...base20(30, 20), H(20)] }));
S.push(skV(pc, 'redundant-perpendicular', 'a rectangle already horizontal/vertical, plus perpendicular(side1, side2)', { geom: rectGeom(0, 0, 30, 20), rules: [...base20(30, 20), { k: 'perpendicular', a: 0, b: 1 }] }));
S.push(skV(pc, 'radius-vs-diameter', 'a circle with radius 5 and diameter 12', { geom: [{ k: 'circle', c: [0, 0], r: 5 }], rules: [{ k: 'fixAt', a: 0, ae: 'c', x: 0, y: 0 }, { k: 'radius', a: 0, value: 5 }, { k: 'diameter', a: 0, value: 12 }] }));
S.push(skV(pc, 'equal-vs-two-radii', 'two circles held equal, radius 5 on one and radius 6 on the other', {
  geom: [{ k: 'circle', c: [0, 0], r: 5 }, { k: 'circle', c: [20, 0], r: 5 }],
  rules: [{ k: 'fixAt', a: 0, ae: 'c', x: 0, y: 0 }, { k: 'fixAt', a: 1, ae: 'c', x: 20, y: 0 }, { k: 'equal', a: 0, b: 1 }, { k: 'radius', a: 0, value: 5 }, { k: 'radius', a: 1, value: 6 }],
}));
S.push(skV(pc, 'horizontal-and-vertical', 'one line held both horizontal and vertical', { geom: [L([0, 0], [20, 5])], rules: [{ k: 'h', a: 0 }, { k: 'v', a: 0 }] }));
S.push(skV(pc, 'clean-30x20', 'control: the same 30 x 20 rectangle with no extra rule', { geom: rectGeom(0, 0, 30, 20), rules: base20(30, 20) }));

const pt = 'sk-circle-arc-tangent';
const slot = (Lx, R, extra = [], anchored = true, asGiven = false) => ({
  geom: [L([0, 0], [Lx, 0]), { k: 'arc', c: [Lx, R], r: R, s: -90, e: 90 }, L([Lx, 2 * R], [0, 2 * R]), { k: 'arc', c: [0, R], r: R, s: 90, e: 270 }],
  rules: [
    { k: 'tangentJoin', a: 0, ae: 'b', b: 1, be: 's', asGiven }, { k: 'tangentJoin', a: 1, ae: 'e', b: 2, be: 'a', asGiven },
    { k: 'tangentJoin', a: 2, ae: 'b', b: 3, be: 's', asGiven }, { k: 'tangentJoin', a: 3, ae: 'e', b: 0, be: 'a', asGiven },
    { k: 'h', a: 0 }, { k: 'radius', a: 1, value: R }, { k: 'equal', a: 1, b: 3 }, { k: 'length', a: 0, value: Lx },
    ...(anchored ? [pin(0, 0)] : []), ...extra,
  ],
});
S.push(skV(pt, 'slot-r6-L30-anchored', 'slot: two lines 30 long and two tangent half-circle caps r6, bottom-left corner pinned', slot(30, 6)));
S.push(skV(pt, 'slot-r6-L30-floating', 'the same slot without the pin: free to slide', slot(30, 6, [], false)));
S.push(skV(pt, 'slot-r12-L18-anchored', 'a fat short slot: r12, 18 between the cap centres lines', slot(18, 12)));
S.push(skV(pt, 'slot-arc-first-order', 'the same slot with the tangent rows written arc-then-line where the geometry order gives that', slot(30, 6, [], true, true)));
S.push(skV(pt, 'slot-extra-radius', 'the slot plus a second radius on the other cap (it equals the first)', slot(30, 6, [{ k: 'radius', a: 3, value: 6 }])));
S.push(skV(pt, 'line-circle-tangent', 'a 40 line along the x axis and a circle r5 tangent to it, centre 20 along', {
  geom: [L([0, 0], [40, 0]), { k: 'circle', c: [20, 5], r: 5 }],
  rules: [{ k: 'h', a: 0 }, pin(0, 0), { k: 'length', a: 0, value: 40 }, { k: 'radius', a: 1, value: 5 }, { k: 'tangent', a: 0, b: 1 }, { k: 'dx', a: 0, ae: 'a', b: 1, be: 'c', value: 20 }],
}));
S.push(skV(pt, 'circle-circle-external', 'circles r8 at the origin and r5 touching it from outside, centres level', {
  geom: [{ k: 'circle', c: [0, 0], r: 8 }, { k: 'circle', c: [13, 0], r: 5 }],
  rules: [{ k: 'fixAt', a: 0, ae: 'c', x: 0, y: 0 }, { k: 'radius', a: 0, value: 8 }, { k: 'radius', a: 1, value: 5 }, { k: 'tangent', a: 0, b: 1, mode: 'external' }, { k: 'dy', a: 0, ae: 'c', b: 1, be: 'c', value: 0 }],
}));
S.push(skV(pt, 'circle-circle-no-mode', 'the same two circles with the tangent row written without external/internal (FreeCAD infers it from where the circles are)', {
  geom: [{ k: 'circle', c: [0, 0], r: 8 }, { k: 'circle', c: [13, 0], r: 5 }],
  rules: [{ k: 'fixAt', a: 0, ae: 'c', x: 0, y: 0 }, { k: 'radius', a: 0, value: 8 }, { k: 'radius', a: 1, value: 5 }, { k: 'tangent', a: 0, b: 1 }, { k: 'dy', a: 0, ae: 'c', b: 1, be: 'c', value: 0 }],
}));
S.push(skV(pt, 'circle-circle-internal', 'circle r5 inside circle r8, touching: internal tangency, centres level', {
  geom: [{ k: 'circle', c: [0, 0], r: 8 }, { k: 'circle', c: [3, 0], r: 5 }],
  rules: [{ k: 'fixAt', a: 0, ae: 'c', x: 0, y: 0 }, { k: 'radius', a: 0, value: 8 }, { k: 'radius', a: 1, value: 5 }, { k: 'tangent', a: 0, b: 1, mode: 'internal' }, { k: 'dy', a: 0, ae: 'c', b: 1, be: 'c', value: 0 }],
}));
S.push(skV(pt, 'arc-centre-radius', 'a quarter arc r10 with centre pinned at the origin and radius fixed: its two end angles are free', {
  geom: [{ k: 'arc', c: [0, 0], r: 10, s: 0, e: 90 }],
  rules: [{ k: 'fixAt', a: 0, ae: 'c', x: 0, y: 0 }, { k: 'radius', a: 0, value: 10 }],
}));

export const SKETCH_VARIANTS = S;
