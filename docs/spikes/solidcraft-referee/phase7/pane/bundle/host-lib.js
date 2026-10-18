var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../../../../packages/sketch/dist/least-squares.js
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[best][col]))
        best = row;
    }
    if (Math.abs(M[best][col]) < 1e-12)
      return null;
    if (best !== col) {
      const t = M[best];
      M[best] = M[col];
      M[col] = t;
    }
    const pivot = M[col][col];
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / pivot;
      if (f === 0)
        continue;
      for (let k = col; k <= n; k++)
        M[row][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++)
      s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}
var sumSquares = (r) => r.reduce((a, v) => a + v * v, 0);
var worstOf = (r) => r.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
function leastSquares(start, residuals, options = {}) {
  const tolerance = options.tolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 100;
  const epsilon = options.epsilon ?? 1e-6;
  const primary = options.primaryCount;
  const judged = (r2) => primary === void 0 ? r2 : r2.slice(0, primary);
  const n = start.length;
  let x = [...start];
  let r = residuals(x);
  const m = r.length;
  if (n === 0 || m === 0) {
    return { x, worst: worstOf(judged(r)), iterations: 0, unsatisfied: worstOf(judged(r)) > tolerance };
  }
  let lambda = 1e-3;
  let cost = sumSquares(r);
  let iterations = 0;
  for (let step = 0; step < maxIterations; step++) {
    if (worstOf(judged(r)) <= tolerance)
      break;
    const J = [];
    for (let i = 0; i < m; i++)
      J.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const bump = epsilon * Math.max(1, Math.abs(x[j]));
      const up = [...x];
      const down = [...x];
      up[j] += bump;
      down[j] -= bump;
      const ru = residuals(up);
      const rd = residuals(down);
      for (let i = 0; i < m; i++)
        J[i][j] = (ru[i] - rd[i]) / (2 * bump);
    }
    const JtJ = [];
    for (let a = 0; a < n; a++) {
      JtJ.push(new Array(n).fill(0));
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let i = 0; i < m; i++)
          s += J[i][a] * J[i][b];
        JtJ[a][b] = s;
      }
    }
    const Jtr = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      let s = 0;
      for (let i = 0; i < m; i++)
        s += J[i][a] * r[i];
      Jtr[a] = s;
    }
    const maxDiag = JtJ.reduce((worst2, row, i) => Math.max(worst2, row[i]), 0);
    const floor = Math.max(1e-12, maxDiag * 1e-6);
    let accepted = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (
        // Damping scaled by the diagonal, not added flat: a sketch measured in
        // millimetres and one measured in metres should behave the same, and a
        // flat lambda makes them behave differently.
        a === b ? v + lambda * Math.max(v, floor) : v
      )));
      const delta = solveLinear(A, Jtr.map((v) => -v));
      if (delta) {
        const candidate = x.map((v, i) => v + delta[i]);
        if (candidate.every(Number.isFinite)) {
          const rc = residuals(candidate);
          const costC = sumSquares(rc);
          if (costC < cost) {
            x = candidate;
            r = rc;
            cost = costC;
            lambda = Math.max(lambda * 0.3, 1e-12);
            accepted = true;
            iterations++;
            break;
          }
        }
      }
      lambda *= 10;
      if (lambda > 1e12)
        break;
    }
    if (!accepted)
      break;
  }
  const worst = worstOf(judged(r));
  return { x, worst, iterations, unsatisfied: worst > tolerance };
}

// ../../../../../packages/sketch/dist/sketch-solve.js
function indexesCorners(c) {
  return c.kind === "lock" || c.kind === "distanceX" || c.kind === "distanceY" || c.kind === "symmetric";
}
function cornersOf(c) {
  if (c.kind === "lock")
    return [c.corner];
  if (c.kind === "symmetric")
    return [c.a, c.b, c.center];
  return [c.a, c.b];
}
function edgeCorners(n, count) {
  return [(n % count + count) % count, ((n + 1) % count + count) % count];
}
function edgeLength(pts, n) {
  const [a, b] = edgeCorners(n, pts.length);
  return Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]);
}
function edgeAngle(pts, n, count) {
  const [a, b] = edgeCorners(n, count);
  const dx = pts[b][0] - pts[a][0];
  const dy = pts[b][1] - pts[a][1];
  if (Math.hypot(dx, dy) < 1e-9)
    return null;
  return Math.atan2(dy, dx);
}
function solveSketch(input, constraints, pinned = []) {
  const pts = input.map((p) => [p[0], p[1]]);
  const n = pts.length;
  if (n < 2 || constraints.length === 0) {
    return { points: pts, residual: 0, iterations: 0, overConstrained: false };
  }
  const fixed = /* @__PURE__ */ new Set();
  const wrap = (i) => (i % n + n) % n;
  for (const p of pinned)
    fixed.add(wrap(p));
  for (const c of constraints)
    if (c.kind === "lock")
      fixed.add(wrap(c.corner));
  const flat = [];
  for (const p of pts)
    flat.push(p[0], p[1]);
  const free = [];
  for (let i = 0; i < n; i++) {
    if (fixed.has(i))
      continue;
    free.push(2 * i, 2 * i + 1);
  }
  const expand = (x) => {
    const all = flat.slice();
    for (let j = 0; j < free.length; j++)
      all[free[j]] = x[j];
    const out = [];
    for (let i = 0; i < n; i++)
      out.push([all[2 * i], all[2 * i + 1]]);
    return out;
  };
  const startScale = sketchScale(pts);
  const HOME_PULL = 1e-3;
  const home = free.map((k) => flat[k]);
  const rules = (x) => residualsOf(expand(x), constraints, startScale);
  const runPass = (start) => {
    const guided = leastSquares(start, (x) => {
      const r = rules(x);
      for (let j = 0; j < x.length; j++)
        r.push(HOME_PULL * (x[j] - start[j]));
      return r;
    }, { tolerance: 1e-6, maxIterations: 200, primaryCount: constraints.length });
    return leastSquares(guided.x, rules, { tolerance: 1e-9, maxIterations: 300 });
  };
  const hasZeroLengthEdge = Array.from({ length: n }, (_, i) => edgeLength(pts, i)).some((len4) => len4 < 1e-9);
  let fit = runPass(home);
  let best = residualOf(expand(fit.x), constraints);
  if (best > 1e-3 && !hasZeroLengthEdge) {
    const scale = startScale;
    let seed = 99491872;
    const rand = () => {
      seed = seed + 1831565813 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    for (let trial = 0; trial < 6 && best > 1e-3; trial++) {
      const jittered = home.map((v) => v + (rand() - 0.5) * scale * 0.3);
      const candidate = runPass(jittered);
      const residualHere = residualOf(expand(candidate.x), constraints);
      if (residualHere < best) {
        fit = candidate;
        best = residualHere;
      }
    }
  }
  const points = expand(fit.x);
  const residual = residualOf(points, constraints);
  return { points, residual, iterations: fit.iterations, overConstrained: residual > 1e-3 };
}
function residualsOf(pts, constraints, scaleOverride) {
  const n = pts.length;
  const scale = scaleOverride ?? sketchScale(pts);
  return constraints.map((c) => {
    if (c.kind === "lock")
      return 0;
    if (c.kind === "horizontal" || c.kind === "vertical") {
      const axis = c.kind === "horizontal" ? 1 : 0;
      const [a, b] = edgeCorners(c.edge, n);
      return Math.abs(pts[b][axis] - pts[a][axis]);
    }
    if (c.kind === "length")
      return Math.abs(edgeLength(pts, c.edge) - c.value);
    if (c.kind === "distanceX")
      return Math.abs(pts[c.b][0] - pts[c.a][0] - c.value);
    if (c.kind === "distanceY")
      return Math.abs(pts[c.b][1] - pts[c.a][1] - c.value);
    if (c.kind === "symmetric") {
      const mx = (pts[c.a][0] + pts[c.b][0]) / 2 - pts[c.center][0];
      const my = (pts[c.a][1] + pts[c.b][1]) / 2 - pts[c.center][1];
      return Math.max(Math.abs(mx), Math.abs(my));
    }
    if (c.kind === "angle") {
      const [a0, a1] = edgeCorners(c.edge, n);
      const [b0, b1] = edgeCorners(c.other, n);
      const ax = pts[a1][0] - pts[a0][0], ay = pts[a1][1] - pts[a0][1];
      const bx = pts[b1][0] - pts[b0][0], by = pts[b1][1] - pts[b0][1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1e-9 || lb < 1e-9)
        return scale;
      const dot4 = (ax * bx + ay * by) / (la * lb);
      const cross3 = (ax * by - ay * bx) / (la * lb);
      const turn = Math.atan2(cross3, dot4);
      let want = c.degrees * Math.PI / 180 % (2 * Math.PI);
      if (want > Math.PI)
        want -= 2 * Math.PI;
      if (want <= -Math.PI)
        want += 2 * Math.PI;
      const diff = Math.abs(turn - want);
      const wrapped = Math.min(diff, Math.abs(diff - 2 * Math.PI));
      return wrapped / (2 * Math.PI) * scale;
    }
    return residualOfPair(pts, c, n, scale);
  });
}
function sketchScale(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX)
      minX = p[0];
    if (p[0] > maxX)
      maxX = p[0];
    if (p[1] < minY)
      minY = p[1];
    if (p[1] > maxY)
      maxY = p[1];
  }
  const d = Math.hypot(maxX - minX, maxY - minY);
  return Number.isFinite(d) && d > 1e-9 ? d : 1;
}
function residualOfPair(pts, c, n, scale) {
  if (c.kind === "equal") {
    return Math.abs(edgeLength(pts, c.edge) - edgeLength(pts, c.other));
  }
  const angleA = edgeAngle(pts, c.edge, n);
  const angleB = edgeAngle(pts, c.other, n);
  if (angleA === null || angleB === null)
    return 0;
  const target = c.kind === "perpendicular" ? Math.PI / 2 : 0;
  let diff = (angleB - angleA - target) % Math.PI;
  if (diff > Math.PI / 2)
    diff -= Math.PI;
  if (diff <= -Math.PI / 2)
    diff += Math.PI;
  return Math.abs(diff) * scale;
}
function residualOf(pts, constraints) {
  let worst = 0;
  for (const r of residualsOf(pts, constraints))
    worst = Math.max(worst, r);
  return worst;
}
function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
var COLLAPSE_RATIO = 0.25;
function collapsedByRatio(before, after) {
  const n = before.length;
  if (n !== after.length || n < 3)
    return false;
  for (let i = 0; i < n; i++) {
    const b = edgeLength(before, i);
    if (b < 1e-9)
      continue;
    if (edgeLength(after, i) < b * COLLAPSE_RATIO)
      return true;
  }
  const areaBefore = polygonArea(before);
  if (areaBefore < 1e-9)
    return false;
  return polygonArea(after) < areaBefore * COLLAPSE_RATIO;
}

// ../../../../../packages/sketch/dist/sketch-arc.js
var sketch_arc_exports = {};
__export(sketch_arc_exports, {
  arcFromBulge: () => arcFromBulge,
  bowEdge: () => bowEdge,
  bowOf: () => bowOf,
  bulgeFromBow: () => bulgeFromBow,
  chamferCorner: () => chamferCorner,
  circleOf: () => circleOf,
  filletCorner: () => filletCorner,
  maxBow: () => maxBow,
  maxChamferDistance: () => maxChamferDistance,
  maxFilletRadius: () => maxFilletRadius,
  outlineOf: () => outlineOf,
  reindex: () => reindex,
  removeCorner: () => removeCorner,
  segmentRoles: () => segmentRoles,
  splitEdge: () => splitEdge,
  tessellate: () => tessellate,
  whyCannotBowEdge: () => whyCannotBowEdge,
  whyCannotChamferCorner: () => whyCannotChamferCorner,
  whyCannotRemoveCorner: () => whyCannotRemoveCorner,
  whyCannotRoundCorner: () => whyCannotRoundCorner,
  whyRemovingCornerCosts: () => whyRemovingCornerCosts
});
function arcFromBulge(a, b, bulge) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  const radius = d * (1 + bulge * bulge) / (4 * Math.abs(bulge));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const ux = dx / d;
  const uy = dy / d;
  const px = -uy;
  const py = ux;
  const half = d / 2;
  const toCentre = Math.sqrt(Math.max(0, radius * radius - half * half));
  const sign = (bulge >= 0 ? 1 : -1) * (Math.abs(bulge) > 1 ? -1 : 1);
  const center = [mx + px * toCentre * sign, my + py * toCentre * sign];
  const startAngle = Math.atan2(a[1] - center[1], a[0] - center[0]);
  const endAngle = Math.atan2(b[1] - center[1], b[0] - center[0]);
  return { center, radius, startAngle, endAngle };
}
function signedSweep(startAngle, endAngle, bulge) {
  let sweep = endAngle - startAngle;
  if (bulge > 0 && sweep < 0)
    sweep += Math.PI * 2;
  if (bulge < 0 && sweep > 0)
    sweep -= Math.PI * 2;
  return sweep;
}
function circleOf(f) {
  if (f.shape !== "circle")
    return null;
  const [a, b] = f.points;
  if (!a || !b)
    return null;
  return {
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    radius: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2
  };
}
var STRAIGHT_TOL = 1e-6;
function maxFilletRadius(points, corner, bulges) {
  const n = points.length;
  if (bulges && (bulges[(corner - 1 + n) % n] || bulges[corner]))
    return 0;
  const prev = points[(corner - 1 + n) % n];
  const c = points[corner];
  const next = points[(corner + 1) % n];
  const lenIn = Math.hypot(c[0] - prev[0], c[1] - prev[1]);
  const lenOut = Math.hypot(next[0] - c[0], next[1] - c[1]);
  if (lenIn === 0 || lenOut === 0)
    return 0;
  const vIn = [prev[0] - c[0], prev[1] - c[1]];
  const vOut = [next[0] - c[0], next[1] - c[1]];
  const cosInterior = (vIn[0] * vOut[0] + vIn[1] * vOut[1]) / (lenIn * lenOut);
  const interior = Math.acos(Math.max(-1, Math.min(1, cosInterior)));
  if (Math.PI - interior < STRAIGHT_TOL)
    return 0;
  return Math.min(lenIn, lenOut) / 2 * Math.tan(interior / 2);
}
function whyCannotRoundCorner(points, corner, bulges) {
  if (maxFilletRadius(points, corner, bulges) > 0)
    return null;
  const n = points.length;
  if (bulges && (bulges[(corner - 1 + n) % n] || bulges[corner])) {
    return "One of the two edges at this corner is already a curve, and shCode can only round a corner where both of its edges are straight.";
  }
  const prev = points[(corner - 1 + n) % n];
  const c = points[corner];
  const next = points[(corner + 1) % n];
  const lenIn = Math.hypot(c[0] - prev[0], c[1] - prev[1]);
  const lenOut = Math.hypot(next[0] - c[0], next[1] - c[1]);
  if (lenIn === 0 || lenOut === 0) {
    return "Two corners of this sketch are sitting on top of each other, so one of the edges here has no length at all. Drag them apart first.";
  }
  if (lenIn > 0 && lenOut > 0) {
    const cosInterior = ((prev[0] - c[0]) * (next[0] - c[0]) + (prev[1] - c[1]) * (next[1] - c[1])) / (lenIn * lenOut);
    const interior = Math.acos(Math.max(-1, Math.min(1, cosInterior)));
    if (Math.PI - interior < STRAIGHT_TOL) {
      return "This corner is straight -- both of its edges run in one line, so there is no corner sticking out to round off. Drag the corner away from that line first.";
    }
  }
  return "This corner is too sharp to round -- its two edges nearly double back on each other. Drag it into a wider angle first.";
}
function maxChamferDistance(points, corner, bulges) {
  const n = points.length;
  if (bulges && (bulges[(corner - 1 + n) % n] || bulges[corner]))
    return 0;
  const prev = points[(corner - 1 + n) % n];
  const c = points[corner];
  const next = points[(corner + 1) % n];
  const lenIn = Math.hypot(c[0] - prev[0], c[1] - prev[1]);
  const lenOut = Math.hypot(next[0] - c[0], next[1] - c[1]);
  if (lenIn === 0 || lenOut === 0)
    return 0;
  const vIn = [prev[0] - c[0], prev[1] - c[1]];
  const vOut = [next[0] - c[0], next[1] - c[1]];
  const cosInterior = (vIn[0] * vOut[0] + vIn[1] * vOut[1]) / (lenIn * lenOut);
  const interior = Math.acos(Math.max(-1, Math.min(1, cosInterior)));
  if (Math.PI - interior < STRAIGHT_TOL)
    return 0;
  return Math.min(lenIn, lenOut);
}
function whyCannotChamferCorner(points, corner, bulges) {
  if (maxChamferDistance(points, corner, bulges) > 0)
    return null;
  const n = points.length;
  if (bulges && (bulges[(corner - 1 + n) % n] || bulges[corner])) {
    return "One of the two edges at this corner is already a curve, and shCode can only chamfer a corner where both of its edges are straight.";
  }
  const prev = points[(corner - 1 + n) % n];
  const c = points[corner];
  const next = points[(corner + 1) % n];
  const lenIn = Math.hypot(c[0] - prev[0], c[1] - prev[1]);
  const lenOut = Math.hypot(next[0] - c[0], next[1] - c[1]);
  if (lenIn === 0 || lenOut === 0) {
    return "Two corners of this sketch are sitting on top of each other, so one of the edges here has no length at all. Drag them apart first.";
  }
  if (lenIn > 0 && lenOut > 0) {
    const cosInterior = ((prev[0] - c[0]) * (next[0] - c[0]) + (prev[1] - c[1]) * (next[1] - c[1])) / (lenIn * lenOut);
    const interior = Math.acos(Math.max(-1, Math.min(1, cosInterior)));
    if (Math.PI - interior < STRAIGHT_TOL) {
      return "This corner is straight -- both of its edges run in one line, so there is no corner sticking out to chamfer off. Drag the corner away from that line first.";
    }
  }
  return "This corner is too sharp to chamfer -- its two edges nearly double back on each other. Drag it into a wider angle first.";
}
function reindex(f, insertedAt) {
  const shiftCorner = (c) => c > insertedAt ? c + 1 : c;
  const shiftEdge = (e) => e > insertedAt ? e + 1 : e;
  const constraints = f.constraints?.map((c) => {
    if (indexesCorners(c)) {
      if (c.kind === "lock")
        return { ...c, corner: shiftCorner(c.corner) };
      if (c.kind === "symmetric") {
        return { ...c, a: shiftCorner(c.a), b: shiftCorner(c.b), center: shiftCorner(c.center) };
      }
      return { ...c, a: shiftCorner(c.a), b: shiftCorner(c.b) };
    }
    if (c.kind === "equal")
      return { ...c, edge: shiftEdge(c.edge), other: shiftEdge(c.other) };
    return { ...c, edge: shiftEdge(c.edge) };
  });
  const bulges = f.bulges ? Object.fromEntries(Object.entries(f.bulges).map(([k, v]) => [shiftEdge(Number(k)), v])) : f.bulges;
  const rounds = f.rounds ? Object.fromEntries(Object.entries(f.rounds).map(([k, v]) => [shiftCorner(Number(k)), v])) : f.rounds;
  const chamfers = f.chamfers ? Object.fromEntries(Object.entries(f.chamfers).map(([k, v]) => [shiftCorner(Number(k)), v])) : f.chamfers;
  return {
    ...f,
    ...constraints ? { constraints } : {},
    ...bulges ? { bulges } : {},
    ...rounds ? { rounds } : {},
    ...chamfers ? { chamfers } : {}
  };
}
function splitEdge(f, index) {
  if (f.shape === "circle")
    return f;
  const n = f.points.length;
  const a = f.points[index];
  const b = f.points[(index + 1) % n];
  if (!a || !b)
    return f;
  const bulge = f.bulges?.[index] ?? 0;
  if (!bulge) {
    const mid2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const points2 = [...f.points];
    points2.splice(index + 1, 0, mid2);
    return { ...reindex(f, index), points: points2 };
  }
  const { center, radius, startAngle, endAngle } = arcFromBulge(a, b, bulge);
  const sweep = signedSweep(startAngle, endAngle, bulge);
  const half = startAngle + sweep / 2;
  const mid = [center[0] + radius * Math.cos(half), center[1] + radius * Math.sin(half)];
  const halfBulge = (Math.sqrt(1 + bulge * bulge) - 1) / bulge;
  const points = [...f.points];
  points.splice(index + 1, 0, mid);
  const shifted = reindex(f, index);
  const bulges = { ...shifted.bulges ?? {}, [index]: halfBulge, [index + 1]: halfBulge };
  return { ...shifted, points, bulges };
}
function trimCorner(f, corner, trim) {
  const n = f.points.length;
  const prevI = (corner - 1 + n) % n;
  const nextI = (corner + 1) % n;
  const C = f.points[corner];
  const P = f.points[prevI];
  const N = f.points[nextI];
  const vIn = [P[0] - C[0], P[1] - C[1]];
  const vOut = [N[0] - C[0], N[1] - C[1]];
  const lenIn = Math.hypot(vIn[0], vIn[1]);
  const lenOut = Math.hypot(vOut[0], vOut[1]);
  if (lenIn === 0 || lenOut === 0)
    return null;
  if (!(trim > 1e-9 * Math.min(lenIn, lenOut)))
    return null;
  const pointIn = [C[0] + vIn[0] / lenIn * trim, C[1] + vIn[1] / lenIn * trim];
  const pointOut = [C[0] + vOut[0] / lenOut * trim, C[1] + vOut[1] / lenOut * trim];
  const points = [...f.points];
  points.splice(corner, 1, pointIn, pointOut);
  const insertedAt = corner - 1;
  const constraintsMinusTrimmedPin = f.constraints?.filter((c) => !(c.kind === "lock" && c.corner === corner));
  const reindexed = reindex({ ...f, constraints: constraintsMinusTrimmedPin }, insertedAt);
  return { points, reindexed, pointIn, pointOut };
}
function filletCorner(f, corner, radius, ceilingOverride) {
  const n = f.points.length;
  const prevI = (corner - 1 + n) % n;
  const nextI = (corner + 1) % n;
  const C = f.points[corner];
  const P = f.points[prevI];
  const N = f.points[nextI];
  const vIn = [P[0] - C[0], P[1] - C[1]];
  const vOut = [N[0] - C[0], N[1] - C[1]];
  const lenIn = Math.hypot(vIn[0], vIn[1]);
  const lenOut = Math.hypot(vOut[0], vOut[1]);
  if (lenIn === 0 || lenOut === 0)
    return f;
  const cosInterior = (vIn[0] * vOut[0] + vIn[1] * vOut[1]) / (lenIn * lenOut);
  const interior = Math.acos(Math.max(-1, Math.min(1, cosInterior)));
  const safeRadius = ceilingOverride ?? maxFilletRadius(f.points, corner, f.bulges);
  const clampedRadius = Math.min(Math.max(0, radius), safeRadius);
  if (clampedRadius <= 0)
    return f;
  const trim = clampedRadius / Math.tan(interior / 2);
  const trimmed = trimCorner(f, corner, trim);
  if (!trimmed)
    return f;
  const inEdge = [C[0] - P[0], C[1] - P[1]];
  const outEdge = [N[0] - C[0], N[1] - C[1]];
  const cross3 = inEdge[0] * outEdge[1] - inEdge[1] * outEdge[0];
  const sweep = Math.PI - interior;
  const bulge = (cross3 >= 0 ? 1 : -1) * Math.tan(sweep / 4);
  const bulges = { ...trimmed.reindexed.bulges ?? {} };
  bulges[corner] = bulge;
  return { ...trimmed.reindexed, points: trimmed.points, bulges };
}
function chamferCorner(f, corner, distance, ceilingOverride) {
  const safeDistance = ceilingOverride ?? maxChamferDistance(f.points, corner, f.bulges);
  const clampedDistance = Math.min(Math.max(0, distance), safeDistance);
  if (clampedDistance <= 0)
    return f;
  const trimmed = trimCorner(f, corner, clampedDistance);
  if (!trimmed)
    return f;
  return { ...trimmed.reindexed, points: trimmed.points };
}
function tessellate(f) {
  const circle = circleOf(f);
  if (circle) {
    const samples = 48;
    const out2 = [];
    for (let i = 0; i < samples; i++) {
      const t = i / samples * Math.PI * 2;
      out2.push([circle.center[0] + circle.radius * Math.cos(t), circle.center[1] + circle.radius * Math.sin(t)]);
    }
    return out2;
  }
  const pts = f.points;
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(pts[i]);
    const bulge = f.bulges?.[i];
    if (!bulge)
      continue;
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const { center, radius, startAngle, endAngle } = arcFromBulge(a, b, bulge);
    const sweep = signedSweep(startAngle, endAngle, bulge);
    const samples = Math.max(8, Math.ceil(Math.abs(sweep) / (7.5 * Math.PI / 180)));
    for (let s = 1; s < samples; s++) {
      const t = startAngle + sweep * (s / samples);
      out.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]);
    }
  }
  return out;
}
function segmentRoles(basis) {
  const n = basis.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = basis[i];
    const b = basis[(i + 1) % n];
    out.push(a === b ? { role: "corner", index: a } : { role: "edge", index: a });
  }
  return out;
}
function collapsedEdge(points) {
  const n = points.length;
  if (n < 3)
    return null;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [u, v] of points) {
    if (u < minU)
      minU = u;
    if (u > maxU)
      maxU = u;
    if (v < minV)
      minV = v;
    if (v > maxV)
      maxV = v;
  }
  const tol = 1e-6 * Math.max(maxU - minU, maxV - minV);
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < tol) {
      return "That would pull two corners of this sketch on top of each other, leaving an edge with no length at all -- the outline would stop being a shape. It has been left as it was.";
    }
  }
  return null;
}
function outlineOf(f) {
  const identity = f.points.map((_, i) => i);
  if (f.shape === "circle") {
    return { ok: true, points: f.points, bulges: f.bulges, basis: identity, notes: [] };
  }
  const collapsed = collapsedEdge(f.points);
  const validCorner = (k) => Number.isInteger(k) && k >= 0 && k < f.points.length;
  const roundAsks = Object.entries(f.rounds ?? {}).map(([k, v]) => ({ corner: Number(k), kind: "round", want: v })).filter((a) => validCorner(a.corner) && a.want > 0);
  const roundCorners = new Set(roundAsks.map((a) => a.corner));
  const chamferAsks = Object.entries(f.chamfers ?? {}).map(([k, v]) => ({ corner: Number(k), kind: "chamfer", want: v })).filter((a) => validCorner(a.corner) && a.want > 0 && !roundCorners.has(a.corner));
  const asks = [...roundAsks, ...chamferAsks].sort((a, b) => b.corner - a.corner);
  if (asks.length === 0) {
    return collapsed ? { ok: false, points: f.points, bulges: f.bulges, basis: identity, notes: [], why: collapsed } : { ok: true, points: f.points, bulges: f.bulges, basis: identity, notes: [] };
  }
  let points = f.points.map((p) => [p[0], p[1]]);
  let bulges = { ...f.bulges ?? {} };
  let basis = identity.slice();
  const notes = [];
  const n = f.points.length;
  const design = f.points.map((p) => [p[0], p[1]]);
  const decided = /* @__PURE__ */ new Map();
  for (const ask of asks) {
    const ceiling = ask.kind === "round" ? maxFilletRadius(design, ask.corner, f.bulges) : maxChamferDistance(design, ask.corner, f.bulges);
    const got = Math.min(ask.want, Math.max(0, ceiling));
    if (!(got > 0)) {
      notes.push({ corner: ask.corner, want: ask.want, got: 0 });
      continue;
    }
    const k = ask.corner;
    const c = design[k], p = design[(k - 1 + n) % n], q = design[(k + 1) % n];
    const lin = Math.hypot(p[0] - c[0], p[1] - c[1]), lout = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const cosI = ((p[0] - c[0]) * (q[0] - c[0]) + (p[1] - c[1]) * (q[1] - c[1])) / (lin * lout);
    const interior = Math.acos(Math.max(-1, Math.min(1, cosI)));
    decided.set(k, { got, trim: ask.kind === "round" ? got / Math.tan(interior / 2) : got });
  }
  const give = /* @__PURE__ */ new Map();
  for (const k of decided.keys())
    give.set(k, 1);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const a = decided.get(k), b = decided.get(j);
    if (!a || !b || k === j)
      continue;
    const len4 = Math.hypot(design[j][0] - design[k][0], design[j][1] - design[k][1]);
    const sum = a.trim + b.trim;
    if (sum > len4 * (1 + 1e-12)) {
      const share = len4 / sum;
      give.set(k, Math.min(give.get(k), share));
      give.set(j, Math.min(give.get(j), share));
    }
  }
  for (const ask of asks) {
    const d = decided.get(ask.corner);
    if (!d)
      continue;
    const got = d.got * give.get(ask.corner);
    if (got < ask.want - 1e-9)
      notes.push({ corner: ask.corner, want: ask.want, got });
  }
  for (const ask of asks) {
    const k = ask.corner;
    const d = decided.get(k);
    if (!d)
      continue;
    const got = d.got * give.get(k);
    if (!(got > 0))
      continue;
    const before = points.length;
    const next = ask.kind === "round" ? filletCorner({ points, bulges }, k, got, Infinity) : chamferCorner({ points, bulges }, k, got, Infinity);
    if (next.points.length === before)
      continue;
    points = next.points;
    bulges = next.bulges ?? {};
    basis = [...basis.slice(0, k), basis[k], basis[k], ...basis.slice(k + 1)];
  }
  return collapsed ? { ok: false, points, bulges, basis, notes, why: collapsed } : { ok: true, points, bulges, basis, notes };
}
function chordOf(pts, e) {
  const n = pts.length;
  if (n < 2)
    return 0;
  const a = pts[(e % n + n) % n];
  const b = pts[((e + 1) % n + n) % n];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
function maxBow(pts, e) {
  return chordOf(pts, e) / 2;
}
function bowOf(pts, e, bulges) {
  const g = bulges?.[e];
  if (!g)
    return 0;
  return chordOf(pts, e) / 2 * g;
}
function bulgeFromBow(pts, e, want) {
  const chord = chordOf(pts, e);
  if (!(chord > 0) || !Number.isFinite(want) || want === 0)
    return 0;
  const ceiling = chord / 2;
  const bow = Math.max(-ceiling, Math.min(ceiling, want));
  return 2 * bow / chord;
}
function whyCannotBowEdge(pts, e, want) {
  if (!Number.isFinite(want))
    return "That is not a number.";
  const chord = chordOf(pts, e);
  if (!(chord > 0)) {
    return `Edge ${e + 1} has no length, so there is nothing to bow. Move one of its corners first.`;
  }
  const ceiling = chord / 2;
  if (Math.abs(want) > ceiling) {
    return `Edge ${e + 1} can bow at most ${ceiling.toFixed(1)} either way -- that is a half circle, and past it the arc turns back on itself.`;
  }
  return null;
}
function bowEdge(f, e, bow) {
  if (f.shape === "circle")
    return f;
  if (!Number.isInteger(e) || e < 0 || e >= f.points.length)
    return f;
  const bulges = { ...f.bulges ?? {} };
  const g = bulgeFromBow(f.points, e, bow);
  if (g)
    bulges[e] = g;
  else
    delete bulges[e];
  return Object.keys(bulges).length ? { ...f, bulges } : { ...f, bulges: void 0 };
}
function whyCannotRemoveCorner(f, k) {
  if (f.shape === "circle") {
    return "A circle has no corners to remove -- its two points are the ends of a diameter.";
  }
  if (!Number.isInteger(k) || k < 0 || k >= f.points.length)
    return "There is no such corner.";
  if (f.points.length <= 3) {
    return "A shape needs at least three corners. Removing this one would leave a line, not an outline.";
  }
  return null;
}
function whyRemovingCornerCosts(f, k) {
  const n = f.points.length;
  if (!Number.isInteger(k) || k < 0 || k >= n)
    return null;
  const merging = [(k - 1 + n) % n, k];
  const lost = [];
  const rules = (f.constraints ?? []).filter((c) => {
    if (indexesCorners(c))
      return cornersOf(c).includes(k);
    if ("other" in c)
      return merging.includes(c.edge) || merging.includes(c.other);
    return merging.includes(c.edge);
  }).length;
  if (rules > 0)
    lost.push(rules === 1 ? "1 rule" : `${rules} rules`);
  const curves = merging.filter((e) => f.bulges?.[e]).length;
  if (curves > 0)
    lost.push(curves === 1 ? "a curve" : "two curves");
  if (f.rounds?.[k])
    lost.push("its round");
  if (f.chamfers?.[k])
    lost.push("its chamfer");
  if (lost.length === 0)
    return null;
  const list = lost.length === 1 ? lost[0] : lost.slice(0, -1).join(", ") + " and " + lost[lost.length - 1];
  return `Removing corner ${k + 1} joins the two edges beside it into one, so ${list} go with it.`;
}
function removeCorner(f, k) {
  if (whyCannotRemoveCorner(f, k))
    return f;
  const n = f.points.length;
  const prev = (k - 1 + n) % n;
  const merging = /* @__PURE__ */ new Set([prev, k]);
  const shift = (i) => i > k ? i - 1 : i;
  const points = f.points.filter((_, i) => i !== k);
  const remap = (src, drop) => {
    if (!src)
      return void 0;
    const out = {};
    for (const [key, v] of Object.entries(src)) {
      const i = Number(key);
      if (!Number.isInteger(i) || drop(i))
        continue;
      out[shift(i)] = v;
    }
    return Object.keys(out).length ? out : void 0;
  };
  const bulges = remap(f.bulges, (e) => merging.has(e));
  const rounds = remap(f.rounds, (c) => c === k);
  const chamfers = remap(f.chamfers, (c) => c === k);
  const constraints = f.constraints?.filter((c) => {
    if (indexesCorners(c))
      return !cornersOf(c).includes(k);
    if ("other" in c)
      return !merging.has(c.edge) && !merging.has(c.other);
    return !merging.has(c.edge);
  }).map((c) => {
    if (indexesCorners(c)) {
      if (c.kind === "lock")
        return { ...c, corner: shift(c.corner) };
      if (c.kind === "symmetric")
        return { ...c, a: shift(c.a), b: shift(c.b), center: shift(c.center) };
      return { ...c, a: shift(c.a), b: shift(c.b) };
    }
    if ("other" in c)
      return { ...c, edge: shift(c.edge), other: shift(c.other) };
    return { ...c, edge: shift(c.edge) };
  });
  return {
    ...f,
    points,
    bulges,
    rounds,
    chamfers,
    ...constraints ? { constraints } : {}
  };
}

// ../../../../../packages/script/dist/model-types.js
var model_types_exports = {};
__export(model_types_exports, {
  EMPTY_DOC: () => EMPTY_DOC,
  RECTANGLE_CONSTRAINTS: () => RECTANGLE_CONSTRAINTS,
  SWEEP_DIR: () => SWEEP_DIR,
  addCorner: () => addCorner,
  canRotate: () => canRotate,
  datumRefs: () => datumRefs,
  defaultName: () => defaultName,
  dependsOn: () => dependsOn,
  exactExtentAlong: () => exactExtentAlong,
  extentAlong: () => extentAlong,
  extentBoundAlong: () => extentBoundAlong,
  featureRangeAlong: () => featureRangeAlong,
  holeAxialOffset: () => holeAxialOffset,
  isDerived: () => isDerived,
  isRoundable: () => isRoundable,
  isShape: () => isShape,
  isSketchOnly: () => isSketchOnly,
  maxRound: () => maxRound,
  nameMap: () => nameMap,
  newBlend: () => newBlend,
  newCircleSketch: () => newCircleSketch,
  newDatum: () => newDatum,
  newExtrude: () => newExtrude,
  newGroove: () => newGroove,
  newHole: () => newHole,
  newHoleCorners: () => newHoleCorners,
  newMirror: () => newMirror,
  newMove: () => newMove,
  newPattern: () => newPattern,
  newPocket: () => newPocket,
  newPolygonSketch: () => newPolygonSketch,
  newRectangleSketch: () => newRectangleSketch,
  newRevolve: () => newRevolve,
  newRotate: () => newRotate,
  newShape: () => newShape,
  newShell: () => newShell,
  newSketch: () => newSketch,
  newSketchOnFace: () => newSketchOnFace,
  nextId: () => nextId,
  placementLabel: () => placementLabel,
  shellInsertion: () => shellInsertion,
  sketchBBoxCentre: () => sketchBBoxCentre,
  sketchFrameOf: () => sketchFrameOf,
  throughExtentAlong: () => throughExtentAlong,
  topLevel: () => topLevel,
  topoRefs: () => topoRefs,
  whyCannotBlend: () => whyCannotBlend,
  whyCannotOrbit: () => whyCannotOrbit,
  whyCannotRound: () => whyCannotRound,
  withHoleDepth: () => withHoleDepth
});

// ../../../../../packages/script/dist/topo-name.js
function featureChain(n) {
  const out = [n.feature];
  if (n.cause === "carried" || n.cause === "split")
    out.push(...featureChain(n.of));
  if (n.cause === "between")
    out.push(...featureChain(n.of[0]), ...featureChain(n.of[1]));
  return [...new Set(out)];
}

// ../../../../../packages/script/dist/model-types.js
var NAMED_PLANE_FRAMES = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }
};
function sketchFrameOf(f) {
  if (f.frame) {
    const { origin, u, v } = f.frame;
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ];
    return { origin, u, v, n };
  }
  const a = NAMED_PLANE_FRAMES[f.plane ?? "xy"] ?? NAMED_PLANE_FRAMES.xy;
  const offset = f.offset ?? 0;
  return {
    origin: [a.n[0] * offset, a.n[1] * offset, a.n[2] * offset],
    u: a.u,
    v: a.v,
    n: a.n
  };
}
function dependsOn(f) {
  const named = topoRefs(f);
  const into = "into" in f && typeof f.into === "string" ? [f.into] : [];
  const datum = datumRefs(f);
  if ("targets" in f)
    return [.../* @__PURE__ */ new Set([...f.targets, ...into, ...named, ...datum])];
  if ("target" in f)
    return [.../* @__PURE__ */ new Set([f.target, ...into, ...named, ...datum])];
  return [.../* @__PURE__ */ new Set([...into, ...named, ...datum])];
}
function datumRefs(f) {
  return f.kind === "sketch" && f.onDatum ? [f.onDatum] : [];
}
function topoRefs(f) {
  const names = [];
  if (f.kind === "fillet")
    names.push(f.edge);
  if (f.kind === "draft" && f.face)
    names.push(f.face);
  if (f.kind === "shell" && f.open)
    names.push(f.open);
  return [...new Set(names.flatMap(featureChain))];
}
function isDerived(f) {
  return f.kind === "combine" || f.kind === "extrude" || f.kind === "revolve" || f.kind === "mirror" || f.kind === "pattern" || f.kind === "hole" || f.kind === "shell" || f.kind === "move" || f.kind === "rotate";
}
function isSketchOnly(doc) {
  return doc.features.length === 0 || doc.features.every((f) => f.kind === "sketch" || f.kind === "datum");
}
var EMPTY_DOC = { version: 1, features: [] };
function isShape(f) {
  return f.kind === "box" || f.kind === "cylinder" || f.kind === "sphere" || f.kind === "cone" || f.kind === "torus";
}
function isRoundable(f) {
  return f.kind === "box" || f.kind === "cylinder";
}
function whyCannotRound(f) {
  if (f.kind === "combine") {
    if (f.op === "subtract") {
      return "Rounding works on a shape, not a combination. Round the shape before you cut it.";
    }
    const verb = f.op === "union" ? "join" : "overlap";
    return `Rounding works on a shape, not a combination. Round the shapes before you ${verb} them.`;
  }
  if (f.kind === "sketch") {
    if (f.shape === "circle") {
      return "A circle has no corners to round \u2014 it is already round the whole way. Rounding is for shapes with edges, like a box.";
    }
    return "Rounding works on a solid shape, not a flat sketch. To round a corner here, use Round a corner in the Rules panel.";
  }
  if (f.kind === "extrude" || f.kind === "revolve") {
    const past = f.kind === "extrude" ? "pulled" : "spun";
    const bare = f.kind === "extrude" ? "pull" : "spin";
    return `Rounding works on a shape you build with a tool like Box or Cylinder, not one ${past} from a sketch. If its sketch has corners, use Round a corner in the Rules panel before you ${bare} it.`;
  }
  if (f.kind === "sphere" || f.kind === "torus") {
    return "That shape has no edges to round \u2014 it is curved all the way round.";
  }
  if (f.kind === "cone") {
    return "Rounding a cone is not supported yet.";
  }
  if (f.kind === "hole") {
    return "Rounding works on the shape, not the hole cut into it. Round the shape before you drill it.";
  }
  if (f.kind === "shell") {
    return "Rounding works on a shape, not a hollowed-out one. A hollow shape rounds its edges one at a time: pick an edge and round that.";
  }
  if (f.kind === "mirror") {
    return "Rounding works on the original shape, not a mirrored copy. Round it before you mirror it.";
  }
  if (f.kind === "pattern") {
    return "Rounding works on the original shape, not a repeated copy. Round it before you repeat it.";
  }
  if (f.kind === "move") {
    return f.copy ? "Rounding the whole shape works on the original, not a copy made by Move \u2014 round the original before you copy it, or click one edge of this copy in the viewport to round just that edge." : "Rounding the whole shape works on the original, not a moved copy \u2014 round it before you move it, or click one edge of this shape in the viewport to round just that edge.";
  }
  return null;
}
function whyCannotOrbit(f, axis) {
  if (!isShape(f))
    return null;
  const [x, y, z] = f.center;
  const offAxis = axis === "x" ? Math.hypot(y, z) : axis === "y" ? Math.hypot(x, z) : Math.hypot(x, y);
  if (offAxis > 0.01)
    return null;
  return "Repeat Around spins copies about the middle of the world, so a shape sitting in the middle has nothing to spin around \u2014 every copy would land on top of the first. Move it away from the middle first (in a script, move(shape, [30, 0, 0])).";
}
function canRotate(f) {
  return f.kind === "box" || f.kind === "cylinder" || f.kind === "cone" || f.kind === "torus";
}
function maxRound(f) {
  const smallest = f.kind === "box" ? Math.min(f.size[0], f.size[1], f.size[2]) : Math.min(f.radius * 2, f.height);
  return Math.max(0, smallest / 2 - 0.01);
}
function nextId(doc, prefix) {
  const taken = new Set(doc.features.map((f) => f.id));
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id))
      return id;
  }
}
var RECTANGLE_CONSTRAINTS = [
  { kind: "horizontal", edge: 0 },
  { kind: "vertical", edge: 1 },
  { kind: "horizontal", edge: 2 },
  { kind: "vertical", edge: 3 }
];
function newSketch(doc, plane = "xy") {
  return {
    id: nextId(doc, "sk"),
    kind: "sketch",
    plane,
    offset: 0,
    points: [[0, 0], [40, 0], [40, 25], [0, 25]],
    constraints: RECTANGLE_CONSTRAINTS.slice()
  };
}
function newSketchOnFace(doc, frame, points = [[0, 0], [40, 0], [40, 25], [0, 25]]) {
  return {
    id: nextId(doc, "sk"),
    kind: "sketch",
    plane: "xy",
    offset: 0,
    frame,
    points: points.map((p) => [p[0], p[1]]),
    constraints: RECTANGLE_CONSTRAINTS.slice()
  };
}
function placementLabel(f) {
  return f.frame ? "custom plane" : f.plane ?? "xy";
}
function newDatum(doc) {
  return { id: nextId(doc, "pl"), kind: "datum", type: "plane" };
}
function newCircleSketch(doc, plane = "xy", centre = [0, 0]) {
  return {
    id: nextId(doc, "sk"),
    kind: "sketch",
    plane,
    offset: 0,
    points: [[centre[0] - 10, centre[1]], [centre[0] + 10, centre[1]]],
    shape: "circle"
  };
}
function sketchBBoxCentre(points) {
  if (points.length === 0)
    return [0, 0];
  let loU = points[0][0], hiU = points[0][0];
  let loV = points[0][1], hiV = points[0][1];
  for (const [u, v] of points) {
    if (u < loU)
      loU = u;
    else if (u > hiU)
      hiU = u;
    if (v < loV)
      loV = v;
    else if (v > hiV)
      hiV = v;
  }
  return [(loU + hiU) / 2, (loV + hiV) / 2];
}
function newRectangleSketch(doc, plane, p1, p2) {
  const w = Math.abs(p2[0] - p1[0]);
  const h = Math.abs(p2[1] - p1[1]);
  if (w < 1 || h < 1)
    return null;
  const loU = Math.min(p1[0], p2[0]), hiU = Math.max(p1[0], p2[0]);
  const loV = Math.min(p1[1], p2[1]), hiV = Math.max(p1[1], p2[1]);
  return {
    id: nextId(doc, "sk"),
    kind: "sketch",
    plane,
    offset: 0,
    points: [[loU, loV], [hiU, loV], [hiU, hiV], [loU, hiV]],
    constraints: RECTANGLE_CONSTRAINTS.slice()
  };
}
function newPolygonSketch(doc, plane, center, vertex, sides = 6) {
  const dx = vertex[0] - center[0];
  const dy = vertex[1] - center[1];
  const radius = Math.hypot(dx, dy);
  if (radius < 1)
    return null;
  const startAngle = Math.atan2(dy, dx);
  const points = [];
  for (let i = 0; i < sides; i++) {
    const a = startAngle + i / sides * Math.PI * 2;
    points.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return { id: nextId(doc, "sk"), kind: "sketch", plane, offset: 0, points };
}
function newExtrude(doc, target) {
  return { id: nextId(doc, "pull"), kind: "extrude", target, height: 12 };
}
function newRevolve(doc, target) {
  return { id: nextId(doc, "rev"), kind: "revolve", target, angle: 360 };
}
function newGroove(doc, target, into) {
  return { id: nextId(doc, "groove"), kind: "groove", target, into, angle: 360 };
}
function newPocket(doc, target, into) {
  return { id: nextId(doc, "pocket"), kind: "pocket", target, into, depth: 5 };
}
function whyCannotBlend(a, b) {
  if (a.kind !== "sketch" || b.kind !== "sketch") {
    return "Blend joins two flat outlines. Pick two sketches -- a solid has no outline to skin from.";
  }
  if (a.plane !== b.plane) {
    return "Those two sketches sit on different planes, so there is no single direction to blend along. Put both on the same one first.";
  }
  if (a.offset === b.offset) {
    return "Both sketches sit at the same offset, so there is no gap to fill. Slide one of them along its plane first.";
  }
  if (a.shape !== "circle" && a.points.length < 3 || b.shape !== "circle" && b.points.length < 3) {
    return "A blend needs two real outlines, and one of these has fewer than three corners.";
  }
  return null;
}
function newBlend(doc, a, b) {
  const [lo, hi] = a.offset <= b.offset ? [a, b] : [b, a];
  return { id: nextId(doc, "bl"), kind: "blend", targets: [lo.id, hi.id] };
}
function newMirror(doc, target, plane) {
  return { id: nextId(doc, "mir"), kind: "mirror", target, plane };
}
function extentAlong(doc, featureId, axis) {
  let id = featureId;
  for (let hop = 0; hop < 16 && id; hop++) {
    const f = doc.features.find((feat) => feat.id === id);
    if (!f)
      return null;
    if (f.kind === "box") {
      if (f.rotate && f.rotate.some((v) => v !== 0))
        return null;
      return axis === "x" ? f.size[0] : axis === "y" ? f.size[1] : f.size[2];
    }
    if (f.kind === "cylinder") {
      if (f.rotate && f.rotate.some((v) => v !== 0))
        return null;
      return axis === "z" ? f.height : f.radius * 2;
    }
    id = "target" in f ? f.target : void 0;
  }
  return null;
}
var SWEEP_DIR = { xy: 1, xz: -1, yz: 1 };
var AXIS_INDEX = { x: 0, y: 1, z: 2 };
function sketchBounds2D(f) {
  if (f.geoms && f.geoms.length || f.geom && f.geom.length || f.rules && f.rules.length)
    return null;
  const circle = circleOf(f);
  if (circle) {
    const [cx, cy] = circle.center;
    return [cx - circle.radius, cx + circle.radius, cy - circle.radius, cy + circle.radius];
  }
  if (f.shape === "circle" || f.points.length < 3)
    return null;
  const o = outlineOf(f);
  if (!o.ok || o.points.length < 3)
    return null;
  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity;
  const take = (u, v) => {
    if (u < uLo)
      uLo = u;
    if (u > uHi)
      uHi = u;
    if (v < vLo)
      vLo = v;
    if (v > vHi)
      vHi = v;
  };
  const n = o.points.length;
  for (let i = 0; i < n; i++) {
    const a = o.points[i], b = o.points[(i + 1) % n];
    take(a[0], a[1]);
    const bulge = o.bulges?.[i];
    if (!bulge)
      continue;
    const { center, radius, startAngle, endAngle } = arcFromBulge(a, b, bulge);
    let sweep = endAngle - startAngle;
    if (bulge > 0 && sweep < 0)
      sweep += Math.PI * 2;
    if (bulge < 0 && sweep > 0)
      sweep -= Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const theta = k * Math.PI / 2;
      let d = sweep >= 0 ? theta - startAngle : startAngle - theta;
      d = (d % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (d <= Math.abs(sweep))
        take(center[0] + radius * Math.cos(theta), center[1] + radius * Math.sin(theta));
    }
  }
  if (![uLo, uHi, vLo, vHi].every(Number.isFinite))
    return null;
  return [uLo, uHi, vLo, vHi];
}
var unitAxisOf = (v) => {
  for (const i of [0, 1, 2]) {
    if (Math.abs(Math.abs(v[i]) - 1) < 1e-9 && v.every((c, j) => j === i || Math.abs(c) < 1e-9)) {
      return { i, sign: v[i] > 0 ? 1 : -1 };
    }
  }
  return null;
};
function extrudeRange(sk, height, axis, opt = {}) {
  const bounds = sketchBounds2D(sk);
  if (!bounds || !(height > 0))
    return null;
  const fr = sketchFrameOf(sk);
  const ui = unitAxisOf(fr.u), vi = unitAxisOf(fr.v), ni = unitAxisOf(fr.n);
  if (!ui || !vi || !ni)
    return null;
  const i = AXIS_INDEX[axis];
  const o = fr.origin[i];
  if (ni.i === i) {
    const dir = sk.frame ? 1 : SWEEP_DIR[sk.plane ?? "xy"] ?? 1;
    const s = ni.sign * dir * (opt.reversed ? -1 : 1);
    const back = opt.midplane ? height / 2 : opt.length2 ?? 0;
    const fwd = opt.midplane ? height / 2 : height;
    const a2 = o - s * back, b2 = o + s * fwd;
    return { lo: Math.min(a2, b2), hi: Math.max(a2, b2), exact: true };
  }
  const [lo, hi, w] = ui.i === i ? [bounds[0], bounds[1], ui.sign] : [bounds[2], bounds[3], vi.sign];
  const a = o + w * lo, b = o + w * hi;
  return { lo: Math.min(a, b), hi: Math.max(a, b), exact: true };
}
function revolveRange(sk, angle, axis) {
  if (angle !== 360 || sk.frame || sk.offset !== 0 || sk.plane !== "xz" && sk.plane !== "yz")
    return null;
  const bounds = sketchBounds2D(sk);
  if (!bounds || bounds[0] < 0)
    return null;
  const normal = sk.plane === "xz" ? "y" : "x";
  if (axis === normal)
    return { lo: bounds[2], hi: bounds[3], exact: true };
  return { lo: -bounds[1], hi: bounds[1], exact: true };
}
function rotationMatrix(rot) {
  const [a, b, c] = rot.map((d) => d * Math.PI / 180);
  const [sa, ca, sb, cb, sc, cc] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(c), Math.cos(c)];
  return [
    [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
    [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
    [-sb, cb * sa, cb * ca]
  ];
}
var snap = (v) => Math.round(v * 1e9) / 1e9;
var matMul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
function axisRotation(axis, deg) {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return axis === "x" ? [[1, 0, 0], [0, c, -s], [0, s, c]] : axis === "y" ? [[c, 0, s], [0, 1, 0], [-s, 0, c]] : [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
function ownSupport(t, d) {
  const side = Math.hypot(d[0], d[1]);
  switch (t.kind) {
    case "torus":
      return t.ringRadius * side + t.tubeRadius;
    case "cone":
      return Math.max(-d[2] * t.height / 2 + t.radius * side, d[2] * t.height / 2);
    case "prism": {
      let best = -Infinity;
      for (let k = 0; k < t.sides; k++) {
        const a = 2 * Math.PI * k / t.sides;
        best = Math.max(best, Math.cos(a) * d[0] + Math.sin(a) * d[1]);
      }
      return Math.abs(d[2]) * t.height / 2 + t.radius * best;
    }
    default:
      return null;
  }
}
function hullRange(t, M, c, i) {
  const d = M[i];
  const up = ownSupport(t, d), down = ownSupport(t, d.map((v) => -v));
  if (up === null || down === null)
    return null;
  return { lo: snap(c - down), hi: snap(c + up), exact: true };
}
function polarRange(doc, f, axis, rec) {
  if (!(f.count >= 1) || !Number.isFinite(f.count))
    return null;
  const spin = f.axis ?? "z";
  const total = f.totalAngle ?? 360;
  if (!Number.isFinite(total))
    return null;
  if (spin === axis || f.count === 1)
    return rec(f.target);
  const t = doc.features.find((feat) => feat.id === f.target);
  if (!t || t.kind !== "box" && t.kind !== "cylinder" && t.kind !== "sphere" && t.kind !== "cone" && t.kind !== "torus" && t.kind !== "prism")
    return null;
  const i = AXIS_INDEX[axis];
  const own = rotationMatrix(t.rotate ?? [0, 0, 0]);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < f.count; k++) {
    const R = axisRotation(spin, total / f.count * k);
    const c = R[i].reduce((a, r, j) => a + r * t.center[j], 0);
    if (t.kind === "torus" || t.kind === "prism" || t.kind === "cone") {
      const h = hullRange(t, matMul(R, own), c, i);
      if (!h)
        return null;
      lo = Math.min(lo, h.lo);
      hi = Math.max(hi, h.hi);
      continue;
    }
    let half;
    if (t.kind === "sphere")
      half = t.radius;
    else {
      const M = matMul(R, own);
      half = t.kind === "box" ? M[i].reduce((a, m, j) => a + Math.abs(m) * t.size[j] / 2, 0) : t.height / 2 * Math.abs(M[i][2]) + t.radius * Math.sqrt(Math.max(0, 1 - M[i][2] * M[i][2]));
    }
    lo = Math.min(lo, c - half);
    hi = Math.max(hi, c + half);
  }
  return { lo: snap(lo), hi: snap(hi), exact: true };
}
function rangeOf(doc, featureId, axis, budget = { n: 64 }) {
  const f = doc.features.find((feat) => feat.id === featureId);
  if (!f || budget.n-- <= 0)
    return null;
  const i = AXIS_INDEX[axis];
  const spun = "rotate" in f && f.rotate && f.rotate.some((v) => v !== 0);
  const around = (c, half, exact = true) => ({ lo: c - half, hi: c + half, exact });
  const rec = (id) => rangeOf(doc, id, axis, budget);
  switch (f.kind) {
    case "box": {
      if (!spun)
        return around(f.center[i], f.size[i] / 2);
      const R = rotationMatrix(f.rotate);
      return around(f.center[i], snap(R[i].reduce((t, r, j) => t + Math.abs(r) * f.size[j] / 2, 0)));
    }
    case "cone":
      if (!spun)
        return around(f.center[i], (axis === "z" ? f.height : f.radius * 2) / 2);
      return hullRange(f, rotationMatrix(f.rotate), f.center[i], i);
    case "cylinder":
      if (!spun)
        return around(f.center[i], (axis === "z" ? f.height : f.radius * 2) / 2);
      {
        const d = rotationMatrix(f.rotate)[i][2];
        return around(f.center[i], snap(f.height / 2 * Math.abs(d) + f.radius * Math.sqrt(Math.max(0, 1 - d * d))));
      }
    case "prism":
      return hullRange(f, rotationMatrix(f.rotate ?? [0, 0, 0]), f.center[i], i);
    case "sphere":
      return around(f.center[i], f.radius);
    case "torus":
      return hullRange(f, rotationMatrix(f.rotate ?? [0, 0, 0]), f.center[i], i);
    case "wedge":
      return spun ? null : around(f.center[i], (axis === "x" ? f.width : axis === "y" ? f.depth : f.height) / 2);
    case "hole":
    case "shell":
    case "fillet":
    case "draft":
      return rec(f.target);
    case "move": {
      const r = rec(f.target);
      if (!r)
        return null;
      const d = f.offset[i];
      return { ...r, lo: r.lo + d, hi: r.hi + d };
    }
    case "extrude": {
      const sk = doc.features.find((feat) => feat.id === f.target);
      const r = sk && sk.kind === "sketch" ? extrudeRange(sk, f.height, axis, { midplane: f.midplane, length2: f.length2, reversed: f.reversed }) : null;
      if (!r || !(f.taper || f.direction))
        return r;
      const sk2 = sk;
      const ni = unitAxisOf(sketchFrameOf(sk2).n);
      return ni && ni.i === AXIS_INDEX[axis] ? { ...r, exact: false } : null;
    }
    case "revolve": {
      const sk = doc.features.find((feat) => feat.id === f.target);
      return sk && sk.kind === "sketch" ? revolveRange(sk, f.angle, axis) : null;
    }
    case "groove":
    case "pocket": {
      const r = rec(f.into);
      return r ? { ...r, exact: false } : null;
    }
    case "combine": {
      if (f.targets.length === 0)
        return null;
      if (f.op === "intersect")
        return null;
      if (f.op === "subtract") {
        const r = rec(f.targets[0]);
        return r ? { ...r, exact: false } : null;
      }
      let lo = Infinity, hi = -Infinity, exact = true;
      for (const t of f.targets) {
        const r = rec(t);
        if (!r)
          return null;
        lo = Math.min(lo, r.lo);
        hi = Math.max(hi, r.hi);
        exact = exact && r.exact;
      }
      return { lo, hi, exact };
    }
    case "pattern": {
      if (f.mode === "circular")
        return polarRange(doc, f, axis, rec);
      if (f.mode !== "linear" || !f.step || !(f.count >= 1))
        return null;
      const r = rec(f.target);
      if (!r)
        return null;
      const d = f.step[i] * (f.count - 1);
      return { lo: Math.min(r.lo, r.lo + d), hi: Math.max(r.hi, r.hi + d), exact: r.exact };
    }
    case "mirror": {
      const r = rec(f.target);
      if (!r)
        return null;
      const across = f.plane === "xy" ? "z" : f.plane === "xz" ? "y" : "x";
      return across === axis ? null : r;
    }
    default:
      return null;
  }
}
function featureRangeAlong(doc, featureId, axis) {
  return rangeOf(doc, featureId, axis);
}
function extentBoundAlong(doc, featureId, axis) {
  const r = rangeOf(doc, featureId, axis);
  return r ? { extent: r.hi - r.lo, exact: r.exact } : null;
}
function throughExtentAlong(doc, featureId, axis) {
  return extentBoundAlong(doc, featureId, axis)?.extent ?? null;
}
function exactExtentAlong(doc, featureId, axis) {
  const e = extentBoundAlong(doc, featureId, axis);
  return e && e.exact ? e.extent : null;
}
function holeAxialOffset(doc, target, axis, depth) {
  const e = extentBoundAlong(doc, target, axis);
  if (!e)
    return null;
  if (depth >= e.extent)
    return 0;
  return e.exact ? (e.extent - depth) / 2 : null;
}
function withHoleDepth(doc, f, depth) {
  const off = holeAxialOffset(doc, f.target, f.axis, depth);
  if (off == null)
    return { ...f, depth };
  const center = [...f.center];
  center[f.axis === "x" ? 0 : f.axis === "y" ? 1 : 2] = off;
  return { ...f, depth, center };
}
function newPattern(doc, target, mode = "linear") {
  const id = nextId(doc, "pat");
  if (mode === "linear") {
    const extent = extentAlong(doc, target, "x");
    const step = extent != null ? [Math.ceil(extent * 1.5), 0, 0] : [30, 0, 0];
    return { id, kind: "pattern", target, mode, count: 3, step };
  }
  return { id, kind: "pattern", target, mode, count: 6, axis: "z", totalAngle: 360 };
}
function newHole(doc, target) {
  const extent = extentAlong(doc, target, "z");
  const depth = extent != null ? extent + 2 : 10;
  return {
    id: nextId(doc, "hole"),
    kind: "hole",
    target,
    diameter: 6,
    depth,
    center: [0, 0, 0],
    axis: "z"
  };
}
function newHoleCorners(doc, target) {
  const extent = extentAlong(doc, target, "z");
  const depth = extent != null ? extent + 2 : 10;
  return {
    id: nextId(doc, "hole"),
    kind: "hole",
    target,
    diameter: 6,
    depth,
    center: [0, 0, 0],
    axis: "z",
    corners: { dx: 15, dy: 10 }
  };
}
function newShell(doc, target, open) {
  const f = { id: nextId(doc, "shell"), kind: "shell", target, thickness: 2 };
  if (open)
    f.open = open;
  return f;
}
function shellInsertion(doc, pickedId) {
  const chain = [];
  let cur = doc.features.find((f) => f.id === pickedId);
  while (cur) {
    chain.unshift(cur);
    const t = "target" in cur ? cur.target : void 0;
    cur = t ? doc.features.find((f) => f.id === t) : void 0;
  }
  const blockerIndex = chain.findIndex((f) => f.kind === "hole" || f.kind === "fillet");
  if (blockerIndex > 0) {
    const root = chain[blockerIndex - 1];
    const blocker = chain[blockerIndex];
    const insertAt = doc.features.findIndex((f) => f.id === root.id) + 1;
    return { target: root.id, insertAt, rewireId: blocker.id };
  }
  const direct = doc.features.find((f) => "target" in f && f.target === pickedId);
  if (direct && (direct.kind === "hole" || direct.kind === "fillet")) {
    const insertAt = doc.features.findIndex((f) => f.id === pickedId) + 1;
    return { target: pickedId, insertAt, rewireId: direct.id };
  }
  return { target: pickedId, insertAt: doc.features.length, rewireId: null };
}
function newRotate(doc, target, angles) {
  return { id: nextId(doc, "turn"), kind: "rotate", target, angles };
}
function newMove(doc, target, copy = false) {
  return { id: nextId(doc, "move"), kind: "move", target, offset: [20, 0, 0], copy };
}
function addCorner(f, index) {
  if (f.shape === "circle")
    return f;
  return splitEdge(f, index);
}
function newHalfWidthX(kind) {
  if (kind === "box")
    return 20;
  if (kind === "cylinder")
    return 10;
  if (kind === "cone")
    return 12;
  if (kind === "torus")
    return 18;
  if (kind === "prism")
    return 10;
  if (kind === "wedge")
    return 15;
  return 15;
}
function shapeRightEdgeX(f) {
  if (f.kind === "box")
    return f.center[0] + f.size[0] / 2;
  if (f.kind === "cylinder" || f.kind === "cone")
    return f.center[0] + f.radius;
  if (f.kind === "sphere")
    return f.center[0] + f.radius;
  if (f.kind === "torus")
    return f.center[0] + f.ringRadius + f.tubeRadius;
  if (f.kind === "prism")
    return f.center[0] + f.radius;
  if (f.kind === "wedge")
    return f.center[0] + f.width / 2;
  return null;
}
function newShape(doc, kind) {
  const edges = doc.features.map(shapeRightEdgeX).filter((x) => x !== null);
  const cx = edges.length === 0 ? 0 : Math.max(...edges) + newHalfWidthX(kind) + 10;
  if (kind === "box") {
    return { id: nextId(doc, "box"), kind, size: [40, 40, 20], center: [cx, 0, 0] };
  }
  if (kind === "cylinder") {
    return { id: nextId(doc, "cyl"), kind, radius: 10, height: 40, center: [cx, 0, 0] };
  }
  if (kind === "cone") {
    return { id: nextId(doc, "cone"), kind, radius: 12, height: 30, center: [cx, 0, 0] };
  }
  if (kind === "torus") {
    return { id: nextId(doc, "ring"), kind, ringRadius: 14, tubeRadius: 4, center: [cx, 0, 0] };
  }
  if (kind === "prism") {
    return { id: nextId(doc, "prism"), kind, sides: 6, radius: 10, height: 30, center: [cx, 0, 0] };
  }
  if (kind === "wedge") {
    return { id: nextId(doc, "wedge"), kind, width: 30, depth: 20, height: 25, center: [cx, 0, 0] };
  }
  return { id: nextId(doc, "ball"), kind, radius: 15, center: [cx, 0, 0] };
}
function labelOf(f) {
  if (f.kind === "combine") {
    return f.op === "union" ? "Join" : f.op === "subtract" ? "Cut" : "Overlap";
  }
  return f.kind === "sketch" ? "Sketch" : f.kind === "datum" ? f.frame ? "Custom plane" : "Plane" : f.kind === "extrude" ? "Pull" : f.kind === "revolve" ? "Spin" : f.kind === "mirror" ? "Mirror" : f.kind === "pattern" ? f.mode === "circular" ? "Repeat Around" : "Repeat" : f.kind === "hole" ? "Hole" : f.kind === "shell" ? "Hollow" : f.kind === "move" ? f.copy ? "Copy" : "Move" : f.kind === "rotate" ? "Turn" : f.kind === "box" ? "Box" : f.kind === "cylinder" ? "Cylinder" : f.kind === "cone" ? "Cone" : f.kind === "torus" ? "Ring" : f.kind === "prism" ? "Prism" : f.kind === "wedge" ? "Wedge" : f.kind === "groove" ? "Groove" : f.kind === "pocket" ? "Pocket" : f.kind === "blend" ? "Blend" : f.kind === "sphere" ? "Sphere" : f.kind === "fillet" ? f.style === "chamfer" ? "Bevel" : "Round" : f.kind === "draft" ? f.whole ? "Body draft" : "Draft" : nameless(f);
}
function nameless(f) {
  return f.kind;
}
function creationOrder(id) {
  const digits = /\d+$/.exec(id);
  return digits ? parseInt(digits[0], 10) : 0;
}
function nameMap(doc) {
  const byLabel = /* @__PURE__ */ new Map();
  for (const f of doc.features) {
    const label = labelOf(f);
    const group = byLabel.get(label);
    if (group)
      group.push(f);
    else
      byLabel.set(label, [f]);
  }
  const out = {};
  for (const [label, group] of byLabel) {
    const ordered = [...group].sort((a, b) => creationOrder(a.id) - creationOrder(b.id));
    ordered.forEach((f, i) => {
      out[f.id] = f.name ?? `${label} ${i + 1}`;
    });
  }
  return out;
}
function defaultName(f, doc) {
  return nameMap(doc)[f.id] ?? labelOf(f);
}
function topLevel(doc) {
  const consumed = /* @__PURE__ */ new Set();
  const heads = /* @__PURE__ */ new Map();
  const supersede = (body, id) => {
    const from = heads.get(body) ?? body;
    consumed.add(from);
    for (const [k, v] of heads)
      if (v === from)
        heads.set(k, id);
    heads.set(body, id);
  };
  for (const f of doc.features) {
    if (f.kind === "hole")
      supersede(f.target, f.id);
    if (f.kind === "pocket" || f.kind === "groove")
      supersede(f.into, f.id);
    if (f.kind === "combine")
      f.targets.forEach((t) => consumed.add(t));
    if (f.kind === "extrude")
      consumed.add(f.target);
    if (f.kind === "revolve")
      consumed.add(f.target);
    if (f.kind === "pattern")
      consumed.add(f.target);
    if (f.kind === "hole")
      consumed.add(f.target);
    if (f.kind === "shell")
      consumed.add(f.target);
    if (f.kind === "move" && !f.copy)
      consumed.add(f.target);
    if (f.kind === "rotate")
      consumed.add(f.target);
    if (f.kind === "fillet")
      consumed.add(f.target);
    if (f.kind === "draft")
      consumed.add(f.target);
    if (f.kind === "pocket")
      consumed.add(f.into);
  }
  return doc.features.filter((f) => !consumed.has(f.id) && f.kind !== "sketch" && f.kind !== "datum");
}

// ../../../../../packages/script/dist/model-codegen.js
function solveDoc(doc) {
  let changed = false;
  const features = doc.features.map((f) => {
    if (f.kind !== "sketch" || !f.constraints || f.constraints.length === 0)
      return f;
    const solved = solveSketch(f.points.map((p) => [p[0], p[1]]), f.constraints);
    if (solved.residual === 0 && solved.iterations === 0)
      return f;
    const points = solved.points.map((p) => [p[0], p[1]]);
    if (points.every((p, i) => p[0] === f.points[i][0] && p[1] === f.points[i][1]))
      return f;
    if (!outlineOf({ ...f, points }).ok)
      return f;
    if (collapsedByRatio(f.points.map((p) => [p[0], p[1]]), points))
      return f;
    changed = true;
    return { ...f, points };
  });
  return changed ? { ...doc, features } : doc;
}

// lib/sketch-map.mjs
var NAMED = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }
};
function frameOf(sk) {
  if (sk.frame) {
    const { origin, u, v } = sk.frame;
    return { origin, u, v, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
  }
  const a = NAMED[sk.plane ?? "xy"] ?? NAMED.xy;
  const o = sk.offset ?? 0;
  return { origin: a.n.map((c) => c * o), ...a };
}
var gname = (id) => `g${id}`;
var sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
var cross = (a, b) => a[0] * b[1] - a[1] * b[0];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1];
var len = (a) => Math.hypot(a[0], a[1]);
var dist = (a, b) => len(sub(a, b));
function arcThrough(g) {
  const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
  const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
  const TAU = Math.PI * 2;
  let sweep = ((a1 - a0) % TAU + TAU) % TAU;
  if (g.sense === "cw") sweep = sweep === 0 ? -TAU : sweep - TAU;
  const m = a0 + sweep / 2;
  const r = g.r ?? dist(g.a, g.c);
  return [g.c[0] + r * Math.cos(m), g.c[1] + r * Math.sin(m)];
}
function mapSketch(sk, opts = {}) {
  const geoms = sk.geoms ?? sk.geom ?? [];
  const rules = sk.rules ?? [];
  const name = opts.name ?? `sk_${sk.id ?? "x"}`;
  const fr = opts.frame ?? frameOf(sk);
  const refusals = [];
  const notes = [];
  const refuse2 = (i, sentence) => refusals.push({ rule: i, kind: rules[i]?.k ?? "geom", sentence });
  const byId = /* @__PURE__ */ new Map();
  geoms.forEach((g, i) => {
    if (g.id !== i + 1) refusals.push({ rule: -1, kind: "geom", sentence: `geometry row ${i + 1} carries id ${g.id}; the soup's ids are dense and 1-based` });
    byId.set(g.id, g);
  });
  const commands = [];
  const names = [];
  commands.push({ command: "sketch.create", params: { name, plane: { origin: fr.origin, x_dir: fr.u, y_dir: fr.v } } });
  for (const g of geoms) {
    const id = gname(g.id);
    const base = { id, connect: false, ...g.construction ? { construction: true } : {} };
    if (g.k === "point") {
      commands.push({ command: "sketch.point", params: { point: g.p, id, connect: false } });
      names.push({ geom: g.id, kind: "point", curve: null, points: { a: id } });
    } else if (g.k === "line") {
      commands.push({ command: "sketch.line", params: { points: [g.a, g.b], ids: [id], connect: false, ...g.construction ? { construction: true } : {} } });
      names.push({ geom: g.id, kind: "line", curve: id, points: { a: `${id}.start`, b: `${id}.end` } });
    } else if (g.k === "circle") {
      commands.push({ command: "sketch.circle.center", params: { center: g.c, radius: g.r, ...base } });
      names.push({ geom: g.id, kind: "circle", curve: id, points: { c: `${id}.center` } });
    } else if (g.k === "arc") {
      commands.push({ command: "sketch.arc.three_point", params: { start: g.a, end: g.b, through: arcThrough(g), ...base } });
      const cw = g.sense === "cw";
      names.push({ geom: g.id, kind: "arc", curve: id, sense: g.sense, points: { a: cw ? `${id}.end` : `${id}.start`, b: cw ? `${id}.start` : `${id}.end`, c: `${id}.center` } });
    } else {
      refusals.push({ rule: -1, kind: "geom", sentence: `geometry ${g.id} is a ${g.k}, which this mapper does not draw (point, line, circle and arc only)` });
    }
  }
  const geomOf = (id) => byId.get(id);
  const nameOf = (id) => names.find((n) => n.geom === id);
  const pt = (i, id, end, { need = false, lock = false } = {}) => {
    if (id === -1) return "origin";
    if (id === -2 || id === -3) {
      refuse2(i, `the ${id === -2 ? "X" : "Y"} axis has no point to name`);
      return null;
    }
    const g = geomOf(id);
    if (!g) {
      refuse2(i, `names geometry ${id}, which is not in the sketch`);
      return null;
    }
    const n = nameOf(id);
    let e = end;
    if (!e) {
      if (need) {
        refuse2(i, `needs a point of geometry ${id} and the row names none (brep-rs refuses the same row)`);
        return null;
      }
      e = lock && (g.k === "circle" || g.k === "arc") ? "c" : g.k === "circle" ? "c" : "a";
    }
    if (g.k === "point") {
      if (e !== "a") {
        refuse2(i, `geometry ${id} is a point and has no end '${e}'`);
        return null;
      }
      return n.points.a;
    }
    const ref = n.points[e];
    if (!ref) {
      refuse2(i, `geometry ${id} is a ${g.k} and has no point '${e}'`);
      return null;
    }
    return ref;
  };
  const curve = (i, id, { axes = false, only = null } = {}) => {
    if (id === -2 || id === -3) {
      if (!axes) {
        refuse2(i, `the sketch axis cannot be used here`);
        return null;
      }
      return id === -2 ? "x" : "y";
    }
    const g = geomOf(id);
    if (!g) {
      refuse2(i, `names geometry ${id}, which is not in the sketch`);
      return null;
    }
    if (g.k === "point") {
      refuse2(i, `geometry ${id} is a point, not a curve`);
      return null;
    }
    if (only && !only.includes(g.k)) {
      refuse2(i, `geometry ${id} is a ${g.k}; this rule needs ${only.join(" or ")}`);
      return null;
    }
    return nameOf(id).curve;
  };
  const startPos = (id, end) => {
    if (id === -1) return [0, 0];
    const g = geomOf(id);
    if (!g) return null;
    if (g.k === "point") return g.p;
    if (g.k === "line") return end === "b" ? g.b : g.a;
    if (g.k === "circle") return g.c;
    if (g.k === "arc") return end === "b" ? g.b : end === "c" ? g.c : g.a;
    return null;
  };
  const ruleMap = [];
  const emit = (i, cmd, params) => {
    commands.push({ command: cmd, params });
    (ruleMap[i] ??= []).push(commands.length - 1);
  };
  const ruleIsDriven = (r) => r.driving === false;
  const dimBase = (r) => ruleIsDriven(r) ? { driven: true } : {};
  const value = (i, r) => {
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) {
      refuse2(i, `carries no numeric value`);
      return null;
    }
    return r.value;
  };
  const joined = (a, ae, b, be) => rules.some((x) => x.k === "coincident" && (x.a === a && (x.aEnd ?? "a") === (ae ?? "a") && x.b === b && (x.bEnd ?? "a") === (be ?? "a") || x.a === b && (x.aEnd ?? "a") === (be ?? "a") && x.b === a && (x.bEnd ?? "a") === (ae ?? "a")));
  const order = [...rules.keys()].sort((x, y) => (rules[x].k === "lock" ? 0 : 1) - (rules[y].k === "lock" ? 0 : 1) || x - y);
  order.forEach((i) => {
    const r = rules[i];
    if (r.active === false) {
      notes.push(`rule ${i} (${r.k}) is inactive: skipped, as brep-rs drops it from the solve, the diagnosis and the profile`);
      ruleMap[i] = [];
      return;
    }
    switch (r.k) {
      case "coincident": {
        const a = pt(i, r.a, r.aEnd), b = pt(i, r.b, r.bEnd);
        if (a && b) emit(i, "sketch.constraint.coincident", { a, b });
        return;
      }
      case "pointOnObject": {
        const a = pt(i, r.a, r.aEnd);
        const b = curve(i, r.b, { axes: true, only: ["line", "circle", "arc"] });
        if (a && b) emit(i, "sketch.constraint.coincident", { a, b });
        return;
      }
      case "horizontal":
      case "vertical": {
        const l = curve(i, r.a, { only: ["line"] });
        if (l) emit(i, "sketch.constraint.horizontal_vertical", { line: l, mode: r.k });
        return;
      }
      case "parallel":
      case "perpendicular": {
        const a = curve(i, r.a, { axes: true, only: ["line"] }), b = curve(i, r.b, { axes: true, only: ["line"] });
        if (a && b) emit(i, `sketch.constraint.${r.k}`, { a, b });
        return;
      }
      case "equal": {
        const ga = geomOf(r.a), gb = geomOf(r.b);
        const a = curve(i, r.a, { only: ["line", "circle", "arc"] }), b = curve(i, r.b, { only: ["line", "circle", "arc"] });
        if (a && b && ga && gb) {
          const round = (g) => g.k === "circle" || g.k === "arc";
          if (round(ga) !== round(gb)) {
            refuse2(i, `equal across a line and a circle/arc is refused by brep-rs too (a radius is not a length)`);
            return;
          }
          emit(i, "sketch.constraint.equal", { a, b });
        }
        return;
      }
      case "tangent": {
        const ga = geomOf(r.a), gb = geomOf(r.b);
        const a = curve(i, r.a, { axes: true, only: ["line", "circle", "arc"] }), b = curve(i, r.b, { axes: true, only: ["line", "circle", "arc"] });
        if (!a || !b || !ga || !gb) return;
        const endForm = r.aEnd !== void 0 || r.bEnd !== void 0;
        if (endForm && !joined(r.a, r.aEnd, r.b, r.bEnd)) {
          refuse2(i, `is the endpoint tangent form with no coincident row joining those two ends before it; solidcraft's tangent is between curves, and it only treats it as tangent-at-the-joint when the ends are tied`);
          return;
        }
        const isRound = (g) => g.k === "circle" || g.k === "arc";
        if (isRound(ga) && isRound(gb) && r.mode) {
          const d = dist(ga.c, gb.c);
          const ext = Math.abs(d - (ga.r + gb.r));
          const int = Math.abs(d - Math.abs(ga.r - gb.r));
          const startMode = ext <= int ? "external" : "internal";
          if (startMode !== r.mode) {
            refuse2(i, `asks for ${r.mode} tangency but the circles start ${startMode}ly placed; solidcraft's tangent has no mode parameter (it keeps the branch of the starting geometry), so it cannot be requested`);
            return;
          }
          notes.push(`rule ${i} (tangent mode ${r.mode}): branch carried by the starting geometry, not requested of solidcraft`);
        }
        if (r.side !== void 0 && (ga.k === "line" && isRound(gb) || gb.k === "line" && isRound(ga))) {
          const L = ga.k === "line" ? ga : gb, C = ga.k === "line" ? gb : ga;
          const sigma = Math.sign(cross(sub(L.b, L.a), sub(C.c, L.a)));
          if (sigma !== 0 && sigma !== Math.sign(r.side)) {
            refuse2(i, `records side ${r.side} for the line/circle tangency but the circle starts on the other side of the line; solidcraft's tangent has no side parameter, so it cannot be requested`);
            return;
          }
          notes.push(`rule ${i} (tangent side ${r.side}): branch carried by the starting geometry, not requested of solidcraft`);
        }
        emit(i, "sketch.constraint.tangent", { a, b });
        return;
      }
      case "symmetric": {
        const a = pt(i, r.a, r.aEnd), b = pt(i, r.b, r.bEnd);
        if (!a || !b) return;
        if (r.cEnd !== void 0) {
          const c = pt(i, r.c, r.cEnd);
          if (!c) return;
          const m = `m${i}`;
          commands.push({ command: "sketch.line", params: { points: [a, b], ids: [m], construction: true, connect: false } });
          (ruleMap[i] ??= []).push(commands.length - 1);
          names.push({ geom: null, kind: "helper-line", curve: m, points: {}, forRule: i });
          emit(i, "sketch.constraint.midpoint", { point: c, line: m });
        } else {
          const l = curve(i, r.c, { axes: true, only: ["line"] });
          if (l) emit(i, "sketch.constraint.symmetry", { a, b, line: l });
        }
        return;
      }
      case "distance": {
        const v = value(i, r);
        if (v === null) return;
        if (!(v > 0)) {
          refuse2(i, `has value ${v}; solidcraft's distance dimension is a length and a zero or negative one is refused`);
          return;
        }
        const a = pt(i, r.a, r.aEnd, { need: true }), b = pt(i, r.b, r.bEnd, { need: true });
        if (!a || !b) return;
        const ga = geomOf(r.a);
        const ends = [r.aEnd, r.bEnd].sort().join("");
        if (r.a === r.b && ga?.k === "line" && ends === "ab") emit(i, "sketch.dimension", { entities: [nameOf(r.a).curve], type: "length", value: v, ...dimBase(r) });
        else emit(i, "sketch.dimension", { entities: [a, b], type: "distance", value: v, ...dimBase(r) });
        return;
      }
      case "distanceX":
      case "distanceY": {
        const v = value(i, r);
        if (v === null) return;
        const a = pt(i, r.a, r.aEnd, { need: true }), b = pt(i, r.b, r.bEnd, { need: true });
        if (!a || !b) return;
        const ax = r.k === "distanceX" ? 0 : 1;
        if (v === 0) {
          if (r.driving === false) {
            refuse2(i, `is a reference ${r.k} of 0; solidcraft has no reference form of a point-pair level constraint`);
            return;
          }
          emit(i, "sketch.constraint.horizontal_vertical", { points: [a, b], mode: r.k === "distanceX" ? "vertical" : "horizontal" });
          notes.push(`rule ${i} (${r.k} 0): emitted as a ${r.k === "distanceX" ? "vertical" : "horizontal"}-points constraint (no parameter), not a dimension`);
          return;
        }
        const pa = startPos(r.a, r.aEnd), pb = startPos(r.b, r.bEnd);
        const s = pa && pb ? pb[ax] - pa[ax] : 0;
        if (Math.abs(s) < 1e-9) {
          refuse2(i, `the two points start level in ${r.k === "distanceX" ? "x" : "y"}, so the side (sign) of the signed ${r.k} ${v} is not carried by the starting geometry`);
          return;
        }
        if (Math.sign(s) !== Math.sign(v)) {
          refuse2(i, `is the SIGNED ${r.k} ${v} (brep-rs) but the points start ${s > 0 ? "positive" : "negative"}; solidcraft's ${r.k === "distanceX" ? "horizontal" : "vertical"} dimension is |d| and keeps the starting side, so the sign cannot be requested`);
          return;
        }
        emit(i, "sketch.dimension", { entities: [a, b], type: r.k === "distanceX" ? "horizontal" : "vertical", value: Math.abs(v), ...dimBase(r) });
        return;
      }
      case "radius":
      case "diameter": {
        const v = value(i, r);
        if (v === null) return;
        if (!(v > 0)) {
          refuse2(i, `has value ${v}; a radius or diameter must be positive`);
          return;
        }
        const c = curve(i, r.a, { only: ["circle", "arc"] });
        if (c) emit(i, "sketch.dimension", { entities: [c], type: r.k, value: v, ...dimBase(r) });
        return;
      }
      case "angle": {
        const v = value(i, r);
        if (v === null) return;
        const ga = geomOf(r.a), gb = geomOf(r.b);
        const a = curve(i, r.a, { only: ["line"] }), b = curve(i, r.b, { only: ["line"] });
        if (!a || !b || !ga || !gb) return;
        const da = sub(ga.b, ga.a), db = sub(gb.b, gb.a);
        if (len(da) < 1e-12 || len(db) < 1e-12) {
          refuse2(i, `has a zero-length line at the start; the angle between it and another is undefined`);
          return;
        }
        const toDeg = (x) => x * 180 / Math.PI;
        let ang = Math.atan2(cross(da, db), dot(da, db));
        let swapped = false;
        if (ang < 0) {
          ang = -ang;
          swapped = true;
        }
        const direct = { value: ang, swapped, flip: false };
        const supp = { value: Math.PI - ang, swapped: !swapped, flip: true };
        let [cur, alt] = ang <= Math.PI / 2 ? [direct, supp] : [supp, direct];
        const want = v * Math.PI / 180;
        if (Math.abs(want - alt.value) < Math.abs(want - cur.value)) cur = alt;
        const eff = cur.swapped ? -want : want;
        const effDeg = (toDeg(eff) % 180 + 180) % 180;
        const wantDeg = (v % 180 + 180) % 180;
        const dd = Math.min(Math.abs(effDeg - wantDeg), 180 - Math.abs(effDeg - wantDeg));
        if (dd > 1e-6) {
          refuse2(i, `is the directed angle ${v} deg from line ${r.a} to line ${r.b}; from this starting geometry solidcraft would apply the value to the opposite orientation (it would hold ${effDeg.toFixed(6)} deg from ${r.a} to ${r.b}); its angle dimension is undirected and takes its orientation from the start state`);
          return;
        }
        if (r.quadrant) notes.push(`rule ${i} (angle quadrant ${r.quadrant}): brep-rs's quadrant never enters its residual either; orientation carried by the starting geometry`);
        emit(i, "sketch.dimension", { entities: [a, b], type: "angle", value: `${v} deg`, ...dimBase(r) });
        return;
      }
      case "lock": {
        if (r.driving === false) {
          refuse2(i, `a lock cannot be a reference measurement`);
          return;
        }
        const p = pt(i, r.a, r.aEnd, { lock: true });
        if (p) emit(i, "sketch.constraint.fix", { entity: p, fixed: true });
        return;
      }
      default:
        refuse2(i, `kind '${r.k}' is not in the soup vocabulary this mapper knows`);
    }
  });
  if (refusals.length) return { ok: false, refusals, names, notes };
  return { ok: true, commands, names, ruleMap, notes, sketchName: name, frame: fr };
}
function docProfileIndices(profileList, geoms) {
  const segs = [];
  const live = geoms.filter((g) => !g.construction && g.k !== "point");
  const parent = live.map((_, i) => i);
  const find = (i) => parent[i] === i ? i : parent[i] = find(parent[i]);
  const ends = (g) => g.k === "line" || g.k === "arc" ? [g.a, g.b] : [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    if (ends(live[i]).some((p) => ends(live[j]).some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6))) parent[find(i)] = find(j);
  }
  const arcPts = (g, n = 96) => {
    const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
    const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
    const TAU = Math.PI * 2;
    let sw = ((a1 - a0) % TAU + TAU) % TAU;
    if (g.sense === "cw") sw = sw === 0 ? -TAU : sw - TAU;
    const r = Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]);
    return Array.from({ length: n + 1 }, (_, k) => [g.c[0] + r * Math.cos(a0 + sw * k / n), g.c[1] + r * Math.sin(a0 + sw * k / n)]);
  };
  live.forEach((g, i) => {
    const key = find(i);
    let pts;
    if (g.k === "line") pts = [g.a, g.b];
    else if (g.k === "arc") pts = arcPts(g);
    else pts = Array.from({ length: 97 }, (_, k) => [g.c[0] + g.r * Math.cos(2 * Math.PI * k / 96), g.c[1] + g.r * Math.sin(2 * Math.PI * k / 96)]);
    for (let k = 0; k + 1 < pts.length; k++) segs.push([key, pts[k], pts[k + 1]]);
  });
  const inside = (pt, key) => {
    let c = false;
    for (const [k, p, q] of segs) {
      if (k !== key) continue;
      if (p[1] > pt[1] !== q[1] > pt[1] && pt[0] < (q[0] - p[0]) * (pt[1] - p[1]) / (q[1] - p[1]) + p[0]) c = !c;
    }
    return c;
  };
  const keys = [...new Set(segs.map((s) => s[0]))];
  return profileList.map((p, i) => ({ i, d: keys.filter((k) => inside(p.interior, k)).length })).filter((x) => x.d % 2 === 1).map((x) => x.i);
}

// lib/resolve-names.mjs
var dot2 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var sub2 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var nrm = (a) => Math.hypot(a[0], a[1], a[2]);
var AXV = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };
var ANGLE_TOL = 1e-6;
function nameText(n) {
  if (!n || typeof n !== "object") return String(n);
  switch (n.cause) {
    case "primitive":
      return `${n.feature}.${n.kind}[${n.part}]`;
    case "swept":
      return `${n.feature}.${n.kind}[${n.from}.edge${n.edge}]`;
    case "rounded":
      return `${n.feature}.${n.kind}[${n.from}.corner${n.corner}]`;
    case "cap":
      return `${n.feature}.cap[${n.end}]`;
    case "carried":
      return `${n.feature}.same[${nameText(n.of)}]`;
    case "between":
      return `${n.feature}.edge[${nameText(n.of?.[0])} ^ ${nameText(n.of?.[1])}]`;
    default:
      return `${n.feature ?? "?"}.${n.cause ?? "?"}`;
  }
}
var fail = (sentence) => ({ ok: false, sentence });
var scaleOf = (shape) => {
  let s = 1;
  for (const f of shape.faces) for (const v of f.centroid) s = Math.max(s, Math.abs(v));
  for (const e of shape.edges) for (const p of [e.start, e.mid, e.end]) for (const v of p) s = Math.max(s, Math.abs(v));
  return s;
};
var planarOf = (f) => f.plane_normal && nrm(f.plane_normal) > 0.5 ? { n: f.plane_normal, d: dot2(f.plane_normal, f.centroid) } : null;
var parallel = (a, b) => dot2(a, b) >= 1 - ANGLE_TOL;
function pickPoint(f, tol) {
  const ok = (h2) => h2 && h2.index === f.index && h2.dist <= tol;
  if (ok(f.centroid_hit)) return { ok: true, point: f.centroid, source: "centroid" };
  if (f.inner_point && ok(f.inner_hit)) return { ok: true, point: f.inner_point, source: "interior point (largest display triangle); the centroid is off the face" };
  const h = f.centroid_hit;
  return { ok: false, why: h ? `solidcraft's nearest-face rule sends a pick at its centroid to face ${h.index} (${h.dist.toExponential(2)} mm away), not to face ${f.index}, and no interior point on it survives the same test` : "the topology snapshot has no pick-hit for it" };
}
async function resolveName(name, env, want) {
  const r = name?.cause === "between" ? await resolveEdge(name, env) : await resolveFaceName(name, env);
  if (!r.ok) return r;
  if (want && r.kind !== want) return fail(`${nameText(name)} names ${r.kind === "edge" ? "an edge" : r.kind === "faceset" ? `a set of ${r.faces.length} faces` : "a face"}, but this feature needs ${want === "edge" ? "an edge" : "a face"}`);
  if (r.kind === "face") {
    const tol = 1e-6 * Math.max(1, scaleOf(r.shape)) * 10;
    const p = pickPoint(r.faces[0], Math.max(tol, 1e-4));
    r.point = p.ok ? p.point : null;
    r.evidence.pickPoint = p.ok ? `own shape: ${p.source}` : `own shape: none (${p.why})`;
  }
  return r;
}
async function resolveFaceName(name, env) {
  const t = nameText(name);
  if (!name || name.kind !== "face") return fail(`${t} is not a face name`);
  const f = env.features.find((x) => x.id === name.feature);
  if (!f) return fail(`${t}: there is no feature ${name.feature} before this one`);
  switch (name.cause) {
    case "primitive":
      return primitiveFace(name, f, env, t);
    case "cap":
      return capFace(name, f, env, t);
    case "swept":
      return sweptFace(name, f, env, t);
    case "carried":
      return carriedFace(name, f, env, t);
    case "rounded":
      return fail(`${t}: a name made by a ROUNDED sketch corner is not resolved in the browser demo (only primitive, cap, swept-by-a-straight-edge, carried-plane and between names are)`);
    case "split":
    case "made":
      return fail(`${t}: a '${name.cause}' name (a piece of a face, or a face an operation made) is not resolved in the browser demo; it needs a discriminator point and solidcraft has no history record to read it from`);
    default:
      return fail(`${t}: the name cause '${name.cause}' is not one this demo knows`);
  }
}
function finishFace(t, shape, cands, extra) {
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  if (cands.length === 0) return fail(`${t} matches no face on ${shape.bodyName} (${extra.rule}); not guessing`);
  if (cands.length > 1) return fail(`${t} matches ${cands.length} faces on ${shape.bodyName} (${cands.map((c) => c.name).join(", ")}; ${extra.rule}); a name must pick exactly one, so nothing is picked`);
  const face = cands[0];
  return {
    ok: true,
    kind: "face",
    area: face.area,
    shape,
    faces: [face],
    plane: planarOf(face),
    evidence: { name: t, candidates: 1, engineFace: face.name, rule: extra.rule, checks: extra.checks ?? [] }
  };
}
async function shapeFor(env, featureId, t) {
  const s = await env.shapeOf(featureId);
  if (!s.ok) return fail(`${t}: ${s.sentence}`);
  return s;
}
var rotated = (f) => Array.isArray(f.rotate) && f.rotate.some((v) => v);
async function primitiveFace(name, f, env, t) {
  const part = name.part;
  const isPrim = ["box", "cylinder", "prism"].includes(f.kind);
  if (isPrim && rotated(f)) return fail(`${t}: ${f.id} is rotated; this demo resolves primitive faces only on unrotated primitives (the part names the face by direction, and a rotated body turns solidcraft's own face labels too)`);
  if (isPrim && f.round) return fail(`${t}: ${f.id} carries a whole-shape round, which changes its faces and edges; not resolved`);
  if (part === "side" && f.kind !== "cylinder") return fail(`${t}: only a cylinder primitive has a 'side' face in this demo`);
  if (part !== "side" && !AXV[part]) return fail(`${t}: '${part}' is not a face part this demo knows`);
  if ((f.kind === "cylinder" || f.kind === "prism") && part !== "side" && part !== "+z" && part !== "-z") return fail(`${t}: a ${f.kind} has no ${part} face`);
  if (["sphere", "cone", "torus", "wedge"].includes(f.kind)) return fail(`${t}: faces of a ${f.kind} are not resolved in the browser demo`);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const c = f.center ?? [0, 0, 0];
  if (part === "side") {
    const curved = shape.faces.filter((x) => !x.plane_normal);
    if (curved.length === 0) return fail(`${t} matches no curved face on ${shape.bodyName}; not guessing`);
    return { ok: true, kind: "faceset", faces: curved, shape, evidence: { name: t, candidates: curved.length, engineFaces: curved.map((x) => x.name), rule: "every non-planar face of the cylinder primitive" } };
  }
  const dir = AXV[part];
  const planar = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, dir));
  const best = planar.length ? Math.max(...planar.map((x) => dot2(x.centroid, dir))) : null;
  const cands = planar.filter((x) => best !== null && Math.abs(dot2(x.centroid, dir) - best) <= tol * 10);
  const checks = [];
  if (cands.length === 1 && isPrim) {
    const axis = dir.findIndex((v) => v !== 0);
    const half = f.kind === "box" ? f.size[axis] / 2 : f.height / 2;
    const docOffset = (c[axis] + Math.sign(dir[axis]) * half) * Math.sign(dir[axis]);
    const got = dot2(cands[0].centroid, dir);
    const okDoc = Math.abs(got - docOffset) <= 1e-6 * Math.max(1, Math.abs(docOffset));
    checks.push({ check: "doc plane", expected: docOffset, got, agree: okDoc });
    if (!okDoc) return fail(`${t}: solidcraft's face ${cands[0].name} is at ${got} along ${part} but ${f.id}'s own parameters put that face at ${docOffset}; the two disagree, so nothing is picked`);
    const want = shape.featureNumber != null ? persistentPrimitive(f.kind, shape.featureNumber, part) : null;
    if (want) {
      const ok = cands[0].name === want || cands[0].name.startsWith(want + "#");
      checks.push({ check: "engine persistent name", expected: want, got: cands[0].name, agree: ok });
      if (!ok) return fail(`${t}: solidcraft names that face ${cands[0].name}, not ${want} as a ${f.kind}'s ${part} should be; the two disagree, so nothing is picked`);
    } else checks.push({ check: "engine persistent name", agree: null, note: "feature number or kind not mapped; skipped" });
  } else if (cands.length === 1) {
    checks.push({ check: "doc plane", agree: null, note: `${f.id} is a ${f.kind}: no doc-derived plane for a built shape; the rule is geometry on solidcraft's own shape only` });
  }
  return finishFace(t, shape, cands, { rule: `planar face with outward normal ${part} at the extreme along it on ${f.id}'s own shape`, checks });
}
function persistentPrimitive(kind, n, part) {
  if (kind === "box") return `F${n}:${part}`;
  if (kind === "cylinder") return part === "+z" ? `F${n}:top` : part === "-z" ? `F${n}:bottom` : null;
  return null;
}
function extrudeOf(env, f, t) {
  if (f.kind !== "extrude") return { err: fail(`${t}: ${f.id} is a ${f.kind}, not a plain extrude; sweep names of other features are not resolved in the browser demo`) };
  for (const k of ["midplane", "length2", "reversed", "taper", "direction", "alongNormal"]) {
    if (f[k]) return { err: fail(`${t}: ${f.id} uses the ${k} option, which the translator does not map; not resolved`) };
  }
  const sk = env.features.find((x) => x.id === f.target && x.kind === "sketch");
  if (!sk) return { err: fail(`${t}: ${f.id}'s sketch ${f.target} is not in the document before this feature`) };
  const f0 = env.sketchFrame(sk);
  const [u, v] = [f0.u, f0.v];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return { sk, fr: { ...f0, n } };
}
async function capFace(name, f, env, t) {
  const { fr, err } = extrudeOf(env, f, t);
  if (err) return err;
  if (name.end !== "top" && name.end !== "bottom") return fail(`${t}: cap end '${name.end}' is not top or bottom`);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const outward = name.end === "top" ? fr.n : fr.n.map((v) => -v);
  const d = dot2(fr.origin, fr.n) + (name.end === "top" ? f.height : 0);
  const want = d * (name.end === "top" ? 1 : -1);
  const cands = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, outward) && Math.abs(dot2(x.centroid, outward) - want) <= tol * 10);
  return finishFace(t, shape, cands, { rule: `planar face, outward normal along the sketch normal ${name.end === "top" ? "" : "reversed "}at the sketch plane${name.end === "top" ? " + height" : ""}`, checks: [{ check: "doc plane", expected: want, agree: cands.length === 1 }] });
}
async function sweptFace(name, f, env, t) {
  const { sk, fr, err } = extrudeOf(env, f, t);
  if (err) return err;
  if (name.from !== sk.id) return fail(`${t}: the name was written against sketch ${name.from} but ${f.id} sweeps ${sk.id}; not resolved`);
  if (sk.shape === "circle" || Array.isArray(sk.geoms) && sk.geoms.length) return fail(`${t}: ${sk.id} is a circle or a rows-and-rules sketch; a swept name over it is not resolved in the browser demo`);
  const o = env.outline(sk);
  if (!o.ok) return fail(`${t}: ${sk.id} has no usable outline`);
  const pts = o.points;
  const designN = Array.isArray(sk.points) ? sk.points.length : null;
  if (designN === null || pts.length !== designN) return fail(`${t}: ${sk.id} has rounded or chamfered corners (its outline has ${pts.length} segments for ${designN ?? "?"} design edges), so the sketch edge index does not map to one straight wall; not resolved`);
  const i = name.edge;
  if (!Number.isInteger(i) || i < 0 || i >= pts.length) return fail(`${t}: ${sk.id} has no edge ${String(i)}`);
  if ((o.bulges ?? {})[i]) return fail(`${t}: sketch edge ${i} of ${sk.id} is an arc; a swept name over an arc is not resolved in the browser demo (only straight edges are)`);
  const a2 = pts[i];
  const b2 = pts[(i + 1) % pts.length];
  const w = (p) => [0, 1, 2].map((k) => fr.origin[k] + fr.u[k] * p[0] + fr.v[k] * p[1]);
  const A = w(a2);
  const B = w(b2);
  const dir = sub2(B, A);
  const L = nrm(dir);
  if (L < 1e-9) return fail(`${t}: sketch edge ${i} has zero length`);
  const e = dir.map((v) => v / L);
  const cr = [fr.n[1] * e[2] - fr.n[2] * e[1], fr.n[2] * e[0] - fr.n[0] * e[2], fr.n[0] * e[1] - fr.n[1] * e[0]];
  const cn = nrm(cr);
  const nOut = cr.map((v) => v / cn);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const mid = [0, 1, 2].map((k) => (A[k] + B[k]) / 2 + fr.n[k] * f.height / 2);
  const cands = shape.faces.filter((x) => x.plane_normal && Math.abs(Math.abs(dot2(x.plane_normal, nOut)) - 1) <= ANGLE_TOL && nrm(sub2(x.centroid, mid)) <= tol * 10 && Math.abs(x.area - L * Math.abs(f.height)) <= 1e-6 * Math.max(1, L * Math.abs(f.height)));
  return finishFace(t, shape, cands, { rule: `planar wall through sketch edge ${i} lifted by the height (centroid and area match)`, checks: [{ check: "doc wall centroid", expected: mid, agree: cands.length === 1 }] });
}
async function carriedFace(name, f, env, t) {
  if (["move", "rotate", "mirror", "pattern"].includes(f.kind)) return fail(`${t}: ${f.id} is a ${f.kind}, which moves or copies faces; a carried name through it is not resolved`);
  if (!name.of || name.of.kind !== "face") return fail(`${t}: a carried name must wrap a face name`);
  const parent = await resolveFaceName(name.of, env);
  if (!parent.ok) return fail(`${t}: its parent ${parent.sentence}`);
  return liftTo(parent, f.id, env, t);
}
async function liftTo(r, T, env, t) {
  if (r.shape.featureId === T) return r;
  if (r.kind === "faceset") return fail(`${t}: its face is a set of ${r.faces.length} faces (a cylinder wall split at the seam); lifting a set through ${T} is not resolved`);
  if (!r.plane) return fail(`${t}: the face ${r.faces[0].name} is curved; a CURVED face carried through ${T} is not resolved in the browser demo (it would have to be matched by surface, and only planes are)`);
  const Tf = env.features.find((x) => x.id === T);
  if (!Tf) return fail(`${t}: there is no feature ${T} before this one`);
  if (["move", "rotate", "mirror", "pattern"].includes(Tf.kind)) return fail(`${t}: ${T} is a ${Tf.kind}, which moves or copies faces; a name through it is not resolved`);
  const consumed = [...Tf.targets ?? [], Tf.target, Tf.into].filter(Boolean);
  if (!consumed.includes(r.shape.featureId)) return fail(`${t}: ${T} does not take ${r.shape.featureId} as an input (it takes ${consumed.join(", ") || "nothing"}), so the face cannot have been carried through it`);
  const flip = Tf.kind === "combine" && Tf.op === "subtract" && Tf.targets.indexOf(r.shape.featureId) >= 1;
  const shape = await shapeFor(env, T, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const n = flip ? r.plane.n.map((v) => -v) : r.plane.n;
  const d = flip ? -r.plane.d : r.plane.d;
  const cands = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, n) && Math.abs(dot2(x.centroid, n) - d) <= tol * 10);
  const checks = [...r.evidence.checks ?? [], { check: "lift", from: r.shape.featureId, to: T, flipped: flip, plane: { n, d } }];
  if (cands.length === 1) {
    const ratio = cands[0].area / r.faces[0].area;
    checks.push({ check: "area vs original", ratio });
    if (ratio > 1 + 1e-6) return fail(`${t}: the face on that plane of ${T} is LARGER than the original (${cands[0].area} vs ${r.faces[0].area}); it was merged with another face, so it is not the carried one; nothing is picked`);
    const nm = cands[0].name;
    const was = r.faces[0].name;
    const same = nm === was || nm.startsWith(was + "#") || was.startsWith(nm + "#");
    checks.push({ check: "engine persistent name kept", expected: was, got: nm, agree: same });
    if (!same) return fail(`${t}: the face on that plane of ${T} is named ${nm} by solidcraft, not ${was}; the geometry and the persistent names disagree, so nothing is picked`);
  }
  const out = finishFace(t, shape, cands, { rule: `the planar face on ${r.faces[0].name}'s plane${flip ? " (flipped: it was a subtracted tool)" : ""} on ${T}'s own shape`, checks });
  if (out.ok) out.evidence.liftedFrom = r.evidence;
  return out;
}
var parseEdgeName = (n) => {
  if (typeof n !== "string") return null;
  const parts = n.replace(/~\d+$/, "").split("|");
  return parts.length === 2 ? parts : null;
};
var near = (p, q, tol) => nrm(sub2(p, q)) <= tol;
async function resolveEdge(name, env) {
  const t = nameText(name);
  if (name.kind !== "edge" || !Array.isArray(name.of) || name.of.length !== 2) return fail(`${t} is not a well-formed between name`);
  const f = env.features.find((x) => x.id === name.feature);
  if (!f) return fail(`${t}: there is no feature ${name.feature} before this one`);
  let A = await resolveFaceNameOrSet(name.of[0], env);
  if (!A.ok) return fail(`${t} cannot be resolved: ${A.sentence}`);
  let B = await resolveFaceNameOrSet(name.of[1], env);
  if (!B.ok) return fail(`${t} cannot be resolved: ${B.sentence}`);
  A = await liftTo(A, name.feature, env, t);
  if (!A.ok) return A;
  B = await liftTo(B, name.feature, env, t);
  if (!B.ok) return B;
  if (A.shape.bodyName !== B.shape.bodyName || A.shape.featureId !== B.shape.featureId) return fail(`${t}: its two faces live on different shapes (${A.shape.featureId} and ${B.shape.featureId}); an edge between faces of two different features is not resolved`);
  const shape = A.shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const aNames = new Set(A.faces.map((x) => x.name));
  const bNames = new Set(B.faces.map((x) => x.name));
  const planeA = A.faces.length === 1 ? planarOf(A.faces[0]) : null;
  const planeB = B.faces.length === 1 ? planarOf(B.faces[0]) : null;
  const onPlane = (e, pl) => [e.start, e.mid, e.end].every((p) => Math.abs(dot2(pl.n, p) - pl.d) <= tol * 10);
  const byName = shape.edges.filter((e) => {
    const pr = parseEdgeName(e.name);
    return pr && (aNames.has(pr[0]) && bNames.has(pr[1]) || aNames.has(pr[1]) && bNames.has(pr[0]));
  });
  let cands;
  let geoAll = null;
  if (planeA && planeB) {
    geoAll = shape.edges.filter((e) => onPlane(e, planeA) && onPlane(e, planeB));
    const sameSet = geoAll.length === byName.length && geoAll.every((e) => byName.some((x) => x.index === e.index));
    if (!sameSet) return fail(`${t}: geometry finds ${geoAll.length} edge(s) on both planes but solidcraft's persistent edge names find ${byName.length}; the two disagree, so nothing is picked`);
    cands = geoAll;
  } else {
    const pl = planeA ?? planeB;
    cands = pl ? byName.filter((e) => onPlane(e, pl)) : byName;
    if (byName.length !== cands.length) return fail(`${t}: ${byName.length - cands.length} of the edges solidcraft names for it do not lie on the planar face's plane; the two disagree, so nothing is picked`);
  }
  if (cands.length === 0) return fail(`${t} matches no edge on ${shape.bodyName} (the two faces do not meet there any more, or never did); not guessing`);
  if (cands.length > 1) {
    const ends = cands.flatMap((e) => [e.start, e.end]);
    const closed = ends.every((p, i) => ends.filter((q, j) => j !== i && near(p, q, tol * 10)).length === 1);
    if (!closed) return fail(`${t} matches ${cands.length} separate edges on ${shape.bodyName} (${cands.map((e) => e.name).join(", ")}) that do not form one closed loop; a name must pick exactly one edge, so nothing is picked`);
  }
  const e0 = cands[0];
  return {
    ok: true,
    kind: "edge",
    point: e0.mid,
    length: cands.reduce((s, e) => s + e.length, 0),
    shape,
    edges: cands,
    evidence: {
      name: t,
      candidates: cands.length,
      loop: cands.length > 1,
      engineEdges: cands.map((e) => e.name),
      pointOn: e0.name,
      facesA: [...aNames],
      facesB: [...bNames],
      checks: [planeA && planeB ? { check: "geometry vs persistent names", agree: true, geometric: geoAll.length, named: byName.length } : { check: "persistent names + plane of the planar face", agree: true, named: byName.length }]
    }
  };
}
async function resolveFaceNameOrSet(name, env) {
  const r = await resolveFaceName(name, env);
  if (!r.ok) return r;
  return { ...r, faces: r.faces };
}

// lib/translate-p4.mjs
var FEATURE_KINDS = [
  "box",
  "cylinder",
  "sphere",
  "cone",
  "torus",
  "prism",
  "wedge",
  "sketch",
  "datum",
  "extrude",
  "combine",
  "blend",
  "revolve",
  "groove",
  "pocket",
  "mirror",
  "pattern",
  "hole",
  "shell",
  "move",
  "rotate",
  "fillet",
  "draft"
];
var AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
var AXN = { x: "X", y: "Y", z: "Z" };
var len2 = (a) => Math.hypot(...a);
var isZero3 = (v) => !v || v[0] === 0 && v[1] === 0 && v[2] === 0;
var bname = (id) => `b_${id}`;
var NAMED2 = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }
};
function frameOf2(s, mt) {
  if (mt && mt.sketchFrameOf) return mt.sketchFrameOf(s);
  if (s.frame) {
    const { origin, u, v } = s.frame;
    return { origin, u, v, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
  }
  const a = NAMED2[s.plane ?? "xy"] ?? NAMED2.xy;
  const o = s.offset ?? 0;
  return { origin: a.n.map((c) => c * o), ...a };
}
var refuse = (sentence) => ({ refusal: sentence });
var isSoup = (sk) => sk.shape !== "circle" && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function profileCmds(sk, ctx) {
  if (isSoup(sk)) return refuse(`sketch ${sk.id} is drawn as rows and rules (a soup); it is mapped by inSketch, not here`);
  const o = ctx.arc.outlineOf(sk);
  if (!o.ok) return refuse(`sketch ${sk.id} has no usable outline (${(o.notes ?? []).join("; ") || "outlineOf refused it"})`);
  if (sk.shape === "circle") {
    const [a, b] = o.points;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { cmds: [{ command: "sketch.circle.center", params: { center: c, diameter: Math.hypot(b[0] - a[0], b[1] - a[1]) } }] };
  }
  const pts = o.points;
  const bulges = o.bulges ?? {};
  if (!Object.values(bulges).some((g) => g)) {
    return { cmds: [{ command: "sketch.line", params: { points: pts.map((p) => [p[0], p[1]]), closed: true } }] };
  }
  const cmds = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const g = bulges[i];
    if (!g) {
      cmds.push({ command: "sketch.line", params: { points: [a, b] } });
      continue;
    }
    const { center, radius, startAngle, endAngle } = ctx.arc.arcFromBulge(a, b, g);
    let sweep = endAngle - startAngle;
    if (g > 0 && sweep < 0) sweep += Math.PI * 2;
    if (g < 0 && sweep > 0) sweep -= Math.PI * 2;
    const mid = startAngle + sweep / 2;
    cmds.push({ command: "sketch.arc.three_point", params: { start: a, end: b, through: [center[0] + radius * Math.cos(mid), center[1] + radius * Math.sin(mid)] } });
  }
  return { cmds };
}
function inSketch(sk, ctx, st, { revolve = false, allowSoup = true } = {}) {
  if (isSoup(sk)) {
    if (revolve || !allowSoup) return refuse(`sketch ${sk.id} is a constrained sketch (rows and rules); this demo maps those for extrude and pocket only, not for revolve, groove or blend`);
    const name2 = `sk_${sk.id}_${st.counter++}`;
    const m = mapSketch(sk, { name: name2 });
    if (!m.ok) return refuse(`sketch ${sk.id} cannot be handed to solidcraft's solver: ${m.refusals.map((r) => `rule ${r.rule + 1}${r.kind ? ` (${r.kind})` : ""}: ${r.sentence}`).join("; ")}`);
    if (ctx.soups) ctx.soups[name2] = { sketchId: sk.id, geoms: sk.geoms, rules: sk.rules ?? [], names: m.names, notes: m.notes ?? [], ruleMap: m.ruleMap };
    return { name: name2, soup: true, cmds: [...m.commands, { command: "sketch.finish", params: {} }] };
  }
  const fr = frameOf2(sk, ctx.mt);
  const prof = profileCmds(sk, ctx);
  if (prof.refusal) return prof;
  const name = `sk_${sk.id}_${st.counter++}`;
  return {
    name,
    cmds: [
      { command: "sketch.create", params: { name, plane: { origin: fr.origin, x_dir: fr.u, y_dir: revolve ? fr.n : fr.v } } },
      ...prof.cmds,
      { command: "sketch.finish", params: {} }
    ]
  };
}
var rotCmds = (name, rotate) => {
  const out = [];
  if (isZero3(rotate)) return out;
  ["x", "y", "z"].forEach((a, i) => {
    if (rotate[i]) out.push({ command: "solid.move", params: { bodies: [name], axis: AX[a], angle: rotate[i] } });
  });
  return out;
};
var moveCmd = (name, t) => ({ command: "solid.move", params: { bodies: [name], translate: t } });
function roundPoints(f, base) {
  if (f.kind === "box") {
    const [w, d, h] = f.size.map((v) => v / 2);
    const c = base;
    const p = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0], c[1] + sy * d, c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0] + sx * w, c[1], c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.push([c[0] + sx * w, c[1] + sy * d, c[2]]);
    return p;
  }
  return [[base[0] + f.radius, base[1], base[2] + f.height / 2], [base[0] + f.radius, base[1], base[2] - f.height / 2]];
}
function planFeature(f, st, ctx) {
  const name = bname(f.id);
  const needBody = (id) => {
    const bs = st.bodies[headOf(id)];
    return bs && bs.length ? bs : null;
  };
  const headOf = (id) => {
    let h = id;
    const seen = /* @__PURE__ */ new Set();
    while (st.head[h] && !seen.has(h)) {
      seen.add(h);
      h = st.head[h];
    }
    return h;
  };
  const dep = (id, role = "target") => {
    id = headOf(id);
    if (st.refused[id]) return `${f.id} (${f.kind}): its ${role} ${id} was refused (${st.refused[id]})`;
    if (st.stale[id]) return `${f.id} (${f.kind}): its ${role} ${id} was already changed in place by ${st.stale[id]}, and a solidcraft command list has no second copy of it`;
    return null;
  };
  switch (f.kind) {
    case "box":
    case "cylinder":
    case "sphere":
    case "torus":
    case "cone":
    case "prism":
    case "wedge": {
      const rot = !isZero3(f.rotate);
      const c = f.center ?? [0, 0, 0];
      const at = rot ? [0, 0, 0] : c;
      let cmds = [];
      if (f.kind === "box") {
        cmds.push({ command: "solid.box", params: { length: f.size[0], width: f.size[1], height: f.size[2], center: at, body_name: name } });
      } else if (f.kind === "cylinder") {
        cmds.push({ command: "solid.cylinder", params: { radius: f.radius, height: f.height, base: [at[0], at[1], at[2] - f.height / 2], axis: "Z", body_name: name } });
      } else if (f.kind === "sphere") {
        cmds.push({ command: "solid.sphere", params: { radius: f.radius, center: at, body_name: name } });
      } else if (f.kind === "torus") {
        cmds.push({ command: "solid.torus", params: { major: f.ringRadius, minor: f.tubeRadius, center: at, body_name: name } });
      } else if (f.kind === "cone") {
        const nm = `sk_${f.id}_${st.counter++}`;
        cmds.push(
          { command: "sketch.create", params: { name: nm, plane: { origin: [at[0], at[1], at[2] - f.height / 2], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
          { command: "sketch.line", params: { points: [[0, 0], [f.radius, 0], [0, f.height]], closed: true } },
          { command: "sketch.finish", params: {} },
          { command: "solid.revolve", params: { axis: "y", sketch: nm, operation: "new", body_name: name } }
        );
      } else {
        const poly = f.kind === "prism" ? (() => {
          const n = Math.max(3, Math.min(12, Math.round(f.sides)));
          return Array.from({ length: n }, (_, i) => [f.radius * Math.cos(2 * Math.PI * i / n), f.radius * Math.sin(2 * Math.PI * i / n)]);
        })() : [[-f.width / 2, -f.depth / 2], [f.width / 2, -f.depth / 2], [-f.width / 2, f.depth / 2]];
        const nm = `sk_${f.id}_${st.counter++}`;
        cmds.push(
          { command: "sketch.create", params: { name: nm, plane: { origin: [at[0], at[1], at[2] - f.height / 2], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } },
          { command: "sketch.line", params: { points: poly, closed: true } },
          { command: "sketch.finish", params: {} },
          { command: "solid.extrude", params: { distance: f.height, sketch: nm, operation: "new", body_name: name } }
        );
      }
      if (f.round) {
        if (f.kind !== "box" && f.kind !== "cylinder") return refuse(`${f.id} (${f.kind}): a whole-shape round is only mapped for box and cylinder`);
        const pts = roundPoints(f, at);
        cmds.push(f.roundStyle === "chamfer" ? { command: "solid.chamfer", params: { edges: pts, distance: f.round, body: name } } : { command: "solid.fillet", params: { edges: pts, radius: f.round, body: name } });
      }
      if (rot) {
        cmds.push(...rotCmds(name, f.rotate));
        if (!isZero3(c)) cmds.push(moveCmd(name, c));
      }
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case "datum":
      return { noop: true };
    case "sketch":
      return { noop: true, stage: true };
    case "extrude": {
      const d = dep(f.target, "sketch");
      if (d) return refuse(d);
      for (const k of ["midplane", "length2", "reversed", "taper", "direction", "alongNormal"]) {
        if (f[k]) return refuse(`${f.id} (extrude): the ${k} option is not mapped in phase 0 (only a plain one-sided extrude along the sketch normal is)`);
      }
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (extrude): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id} (extrude): ${s.refusal}`);
      return { variants: [[...s.cmds, { command: "solid.extrude", params: { distance: f.height, sketch: s.name, operation: "new", body_name: name } }]], produces: [name], consumes: [] };
    }
    case "revolve":
    case "groove": {
      const d = dep(f.target, "sketch") || (f.kind === "groove" ? dep(f.into, "solid") : null);
      if (d) return refuse(d);
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (${f.kind}): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st, { revolve: true });
      if (s.refusal) return refuse(`${f.id} (${f.kind}): ${s.refusal}`);
      const params = { axis: "y", sketch: s.name };
      if (f.angle !== 360) params.angle = -f.angle;
      if (f.kind === "revolve") return { variants: [[...s.cmds, { command: "solid.revolve", params: { ...params, operation: "new", body_name: name } }]], produces: [name], consumes: [] };
      const bs = needBody(f.into);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (groove): ${f.into} is not a single body`);
      return { variants: [[...s.cmds, { command: "solid.revolve", params: { ...params, operation: "cut", targets: bs } }]], produces: bs, consumes: [f.into] };
    }
    case "pocket": {
      const d = dep(f.target, "sketch") || dep(f.into, "solid");
      if (d) return refuse(d);
      const sk = st.sketches[f.target];
      const bs = needBody(f.into);
      if (!sk || !bs || bs.length !== 1) return refuse(`${f.id} (pocket): needs a sketch and a single body`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id} (pocket): ${s.refusal}`);
      return { variants: [[...s.cmds, { command: "solid.extrude", params: { distance: f.depth, direction: "negative", sketch: s.name, operation: "cut", targets: bs } }]], produces: bs, consumes: [f.into] };
    }
    case "blend": {
      const ds = f.targets.map((t) => dep(t, "sketch")).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (blend): needs two or more sketches`);
      const cmds = [];
      const names = [];
      for (const t of f.targets) {
        const sk = st.sketches[t];
        if (!sk) return refuse(`${f.id} (blend): ${t} is not a sketch`);
        const s = inSketch(sk, ctx, st, { allowSoup: false });
        if (s.refusal) return refuse(`${f.id} (blend): ${s.refusal}`);
        cmds.push(...s.cmds);
        names.push(s.name);
      }
      cmds.push({ command: "solid.loft", params: { sections: names.map((n) => ({ sketch: n })), operation: "new", body_name: name } });
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case "combine": {
      const ds = f.targets.map((t) => dep(t)).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (combine): needs two or more targets`);
      const all = f.targets.map((t) => needBody(t));
      if (all.some((b) => !b || b.length !== 1)) return refuse(`${f.id} (combine): every target must be a single body`);
      const op = f.op === "union" ? "join" : f.op === "subtract" ? "cut" : "intersect";
      const names = all.map((b) => b[0]);
      return {
        variants: [[{ command: "solid.combine", params: { target: names[0], tools: names.slice(1), operation: op } }]],
        produces: [names[0]],
        consumes: f.targets
      };
    }
    case "move": {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.copy) return refuse(`${f.id} (move): a copying move is not mapped (solidcraft names the copy itself, and phase 0 does not track it)`);
      const bs = needBody(f.target);
      return { variants: [[{ command: "solid.move", params: { bodies: bs, translate: f.offset } }]], produces: bs, consumes: [f.target] };
    }
    case "rotate": {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!m) return refuse(`${f.id} (rotate): no measured bounding box for ${f.target}`);
      const c = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cmds = [];
      if (!isZero3(c)) cmds.push({ command: "solid.move", params: { bodies: bs, translate: c.map((v) => -v) } });
      ["x", "y", "z"].forEach((a, i) => {
        if (f.angles[i]) cmds.push({ command: "solid.move", params: { bodies: bs, axis: AX[a], angle: f.angles[i] } });
      });
      if (!isZero3(c)) cmds.push({ command: "solid.move", params: { bodies: bs, translate: c } });
      return { variants: [cmds], produces: bs, consumes: [f.target] };
    }
    case "mirror": {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!m) return refuse(`${f.id} (mirror): no measured bounding box for ${f.target}`);
      const axis = f.plane === "yz" ? 0 : f.plane === "xz" ? 1 : 2;
      const lo = m.bbox[axis];
      const hi = m.bbox[axis + 3];
      const at = Math.abs(lo) <= Math.abs(hi) ? lo : hi;
      const origin = [0, 0, 0];
      origin[axis] = at;
      const normal = [0, 0, 0];
      normal[axis] = 1;
      return { variants: [[{ command: "solid.mirror", params: { bodies: bs, plane: { origin, normal }, combine: true } }]], produces: bs, consumes: [f.target] };
    }
    case "pattern": {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (pattern): needs a single target body`);
      if (f.count < 2) return refuse(`${f.id} (pattern): a count under 2 is the original alone; not mapped`);
      const copies = [bs[0], ...Array.from({ length: f.count - 1 }, (_, i) => `${bs[0]} (${i + 2})`)];
      let pat;
      if (f.mode === "circular") {
        if ((f.totalAngle ?? 360) !== 360) return refuse(`${f.id} (pattern): a circular pattern over less than 360 degrees is not mapped (solidcraft's angle semantics were not verified)`);
        pat = { command: "solid.pattern.circular", params: { bodies: bs, axis: AXN[f.axis ?? "z"], count: f.count } };
      } else {
        const s = f.step ?? [0, 0, 0];
        if (isZero3(s)) return refuse(`${f.id} (pattern): a zero step puts every copy on the original`);
        const L = len2(s);
        pat = { command: "solid.pattern.rectangular", params: { bodies: bs, dir1: s.map((v) => v / L), count1: f.count, spacing1: L } };
      }
      const join = { command: "solid.combine", params: { target: copies[0], tools: copies.slice(1), operation: "join" } };
      return { variants: [[pat, join], [pat]], produces: copies, consumes: [f.target] };
    }
    case "hole": {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.counterbore || f.countersink) return refuse(`${f.id} (hole): counterbore and countersink are not mapped in phase 0`);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!bs || bs.length !== 1 || !m) return refuse(`${f.id} (hole): needs a single measured target body`);
      const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cx = bc[0] + f.center[0];
      const cy = bc[1] + f.center[1];
      const cz = bc[2] + f.center[2];
      const centers = f.corners ? [[cx - f.corners.dx, cy - f.corners.dy, cz], [cx + f.corners.dx, cy - f.corners.dy, cz], [cx - f.corners.dx, cy + f.corners.dy, cz], [cx + f.corners.dx, cy + f.corners.dy, cz]] : [[cx, cy, cz]];
      const dir = AX[f.axis ?? "z"];
      const cmds = centers.map((c) => ({
        command: "solid.cylinder",
        params: { radius: f.diameter / 2, height: f.depth, base: c.map((v, i) => v - dir[i] * f.depth / 2), axis: AXN[f.axis ?? "z"], operation: "cut", targets: bs }
      }));
      return { variants: [cmds], produces: bs, consumes: [f.target] };
    }
    case "shell": {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (shell): needs a single target body`);
      if (!f.open) return refuse(`${f.id} (shell): this spike's shell needs a face to remove; a closed hollow box is not mapped`);
      const r = ctx.resolve(f.open);
      if (r && r.ok === false) return refuse(`${f.id} (shell): ${r.sentence}`);
      if (!r || r.kind !== "face") return refuse(`${f.id} (shell): the opened face could not be resolved to a single face (${r ? `it names ${r.kind}` : "no resolution"})`);
      return { variants: [[{ command: "solid.shell", params: { faces: [r.point], thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target], pickedFrom: "solidcraft topology (browser)", evidence: r.evidence };
    }
    case "fillet": {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (fillet): needs a single target body`);
      const r = ctx.resolve(f.edge);
      if (r && r.ok === false) return refuse(`${f.id} (${f.kind}): ${r.sentence}`);
      if (!r || r.kind !== "edge") return refuse(`${f.id} (fillet): the edge could not be resolved to a single edge (${r ? `it names ${r.kind}` : "no resolution"})`);
      const cands = [r.point];
      const mk = (p) => f.style === "chamfer" ? { command: "solid.chamfer", params: { edges: [p], distance: f.size, body: bs[0] } } : { command: "solid.fillet", params: { edges: [p], radius: f.size, body: bs[0] } };
      return { variants: cands.map((p) => [mk(p)]), produces: bs, consumes: [f.target], pickedFrom: "solidcraft topology (browser)", evidence: r.evidence };
    }
    case "draft": {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.whole || !f.face) return refuse(`${f.id} (draft): a whole-body draft is not mapped (needs a face pick per face)`);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (draft): needs a single target body`);
      const r = ctx.resolve(f.face);
      if (r && r.ok === false) return refuse(`${f.id} (draft): ${r.sentence}`);
      if (!r || r.kind !== "face") return refuse(`${f.id} (draft): the face could not be resolved to a single face (${r ? `it names ${r.kind}` : "no resolution"})`);
      const ax = AX[f.pull ?? "z"];
      return {
        variants: [[{ command: "solid.draft", params: { faces: [r.point], angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }]],
        produces: bs,
        consumes: [f.target],
        pickedFrom: "solidcraft topology (browser)",
        evidence: r.evidence
      };
    }
    default:
      return refuse(`${f.id}: feature kind '${f.kind}' is not in the ModelDoc vocabulary this translator knows`);
  }
}
function aggregate(res, names) {
  const bs = res.measure.bodies.filter((b) => names.includes(b.name));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], b.bbox.min[i]);
    hi[i] = Math.max(hi[i], b.bbox.max[i]);
  }
  return {
    volume: bs.reduce((s, b) => s + b.volume_mm3, 0),
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== "plane")),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => {
      for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v;
      return a;
    }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / bs.reduce((a, b) => a + b.volume_mm3, 0)),
    bodies: bs.map((b) => b.name)
  };
}
async function confirmOnTarget(rr, { st, accepted, ctx, targetId }) {
  if (!rr.ok || rr.kind === "faceset") return rr;
  const headId = (id) => {
    let h = id;
    const seen = /* @__PURE__ */ new Set();
    while (st.head[h] && !seen.has(h)) {
      seen.add(h);
      h = st.head[h];
    }
    return h;
  };
  const tb = st.bodies[headId(targetId)];
  const nm = rr.evidence.name;
  if (!tb || tb.length !== 1) return { ok: false, sentence: `${nm} resolved on ${rr.shape.featureId}, but the target ${targetId} is ${tb ? tb.length : 0} bodies; a pick is made on a single body, so nothing is picked` };
  let cur;
  try {
    cur = await ctx.topologyOf(accepted);
  } catch (e) {
    cur = { ok: false, error: e.message };
  }
  const body = cur.ok && cur.topology ? cur.topology.bodies.find((b) => b.name === tb[0]) : null;
  if (!body || body.error) return { ok: false, sentence: `${nm} resolved, but solidcraft returned no topology for the target ${tb[0]}; nothing is picked` };
  let sc = 1;
  for (const e of body.edges) for (const q of [e.start, e.mid, e.end]) for (const v of q) sc = Math.max(sc, Math.abs(v));
  for (const x of body.faces) for (const v of x.centroid) sc = Math.max(sc, Math.abs(v));
  const tol = 1e-6 * sc * 10;
  const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (rr.kind === "edge") {
    const per = rr.edges.map((e) => body.edges.filter((q) => dist2(q.mid, e.mid) <= tol && Math.abs(q.length - e.length) <= tol));
    const miss = per.filter((m) => m.length === 0).length;
    if (miss) return { ok: false, sentence: `${nm} resolves to ${rr.evidence.engineEdges.join(", ")} on ${rr.shape.featureId}, but ${miss === rr.edges.length ? "that edge is" : "part of that edge is"} no longer present whole on ${tb[0]} (an operation after ${rr.shape.featureId} changed or removed it); nothing is picked` };
    if (per.some((m) => m.length > 1)) return { ok: false, sentence: `${nm} matches more than one edge on ${tb[0]} (${per.flat().map((q) => q.name).join(", ")}); nothing is picked` };
    rr.evidence.target = { body: tb[0], candidates: rr.edges.length, edges: per.flat().map((q) => q.name), point: rr.point };
    return rr;
  }
  if (!rr.plane) return { ok: false, sentence: `${nm} resolves to a curved face; a pick of a curved face on the target is not resolved in the browser demo` };
  const { n, d } = rr.plane;
  const allowFlip = rr.shape.featureId !== targetId && rr.shape.featureId !== headId(targetId);
  const on = body.faces.filter((x) => x.plane_normal && Math.abs(dot4(x.centroid, n) - d) <= tol && (dot4(x.plane_normal, n) >= 1 - 1e-6 || allowFlip && dot4(x.plane_normal, n) <= -1 + 1e-6));
  if (on.length === 0) return { ok: false, sentence: `${nm} resolves on ${rr.shape.featureId}, but no face of ${tb[0]} lies on that plane any more; nothing is picked` };
  if (on.length > 1) return { ok: false, sentence: `${nm} matches ${on.length} faces on ${tb[0]} (${on.map((x) => x.name).join(", ")}; all on the named plane); a name must pick exactly one, so nothing is picked` };
  const p = pickPoint(on[0], Math.max(tol, 1e-4));
  if (!p.ok) return { ok: false, sentence: `${nm} resolves to ${on[0].name} on ${tb[0]} but there is no safe pick point: ${p.why}` };
  rr.point = p.point;
  rr.evidence.pickPoint = `target ${tb[0]}: ${p.source}`;
  rr.evidence.target = { body: tb[0], candidates: 1, face: on[0].name, faceIndex: on[0].index, point: p.point, pickSource: p.source, centroidHit: on[0].centroid_hit ?? null, innerHit: on[0].inner_hit ?? null };
  return rr;
}
function makeEnv(st, accepted, prefix, ctx, shapeCache) {
  return {
    features: prefix,
    sketchFrame: (sk) => frameOf2(sk, ctx.mt),
    outline: (sk) => ctx.arc.outlineOf(sk),
    shapeOf: async (fid) => {
      if (st.accLen[fid] === void 0) return { ok: false, sentence: `feature ${fid} was not built (it is a sketch, was refused, or comes later), so there is no shape of it to read the name from` };
      const bodies = st.bodies[fid];
      if (!bodies || bodies.length !== 1) return { ok: false, sentence: `feature ${fid} produced ${bodies ? bodies.length : 0} bodies; a name is resolved on a single body` };
      if (!shapeCache.has(fid)) {
        const cmds2 = accepted.slice(0, st.accLen[fid]);
        let r2;
        try {
          r2 = await ctx.topologyOf(cmds2);
        } catch (e) {
          r2 = { ok: false, error: e.message };
        }
        shapeCache.set(fid, { cmds: cmds2, r: r2 });
      }
      const { cmds, r } = shapeCache.get(fid);
      if (!r.ok || !r.topology) return { ok: false, sentence: `solidcraft could not report the topology of ${fid} (${r.error ?? r.rejected ?? (r.failed && r.failed.error) ?? "no topology in the reply"})` };
      if (r.topology.truncated) return { ok: false, sentence: `the topology of ${fid} is larger than the bridge's snapshot limit; not resolved` };
      const body = r.topology.bodies.find((b) => b.name === bodies[0]);
      if (!body || body.error) return { ok: false, sentence: `solidcraft returned no topology for body ${bodies[0]}${body?.error ? " (" + body.error + ")" : ""}` };
      let k = -1;
      cmds.forEach((c, i) => {
        if (c.params?.body_name === bodies[0] && /^solid\.(box|cylinder|extrude|revolve|loft|sphere|torus)$/.test(c.command)) k = i;
      });
      const featureNumber = k >= 0 ? r.results?.[k]?.feature ?? null : null;
      return { ok: true, bodyName: bodies[0], featureId: fid, featureNumber, faces: body.faces, edges: body.edges };
    }
  };
}
async function translateDoc(doc, ctx) {
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {} };
  const shapeCache = /* @__PURE__ */ new Map();
  const accepted = [];
  const out = [];
  for (let idx = 0; idx < doc.features.length; idx++) {
    const f = doc.features[idx];
    const prefix = doc.features.slice(0, idx);
    const resolved = /* @__PURE__ */ new Map();
    const fctx = { ...ctx, resolve: (name) => resolved.get(name) ?? null };
    const nameField = f.kind === "shell" ? "open" : f.kind === "fillet" ? "edge" : f.kind === "draft" ? "face" : null;
    if (nameField && f[nameField] && typeof f[nameField] === "object" && ctx.topologyOf) {
      const env = makeEnv(st, accepted, prefix, ctx, shapeCache);
      let rr = await resolveName(f[nameField], env, nameField === "edge" ? "edge" : "face");
      rr = await confirmOnTarget(rr, { st, accepted, ctx, targetId: f.target });
      if (rr.ok && rr.kind === "faceset") resolved.set(f[nameField], { ok: false, sentence: `${rr.evidence.name} is ${rr.faces.length} faces in solidcraft (${rr.evidence.engineFaces.join(", ")}; a cylinder's wall is split at its seam); a face pick of it would choose one half silently, so nothing is picked` });
      else resolved.set(f[nameField], rr);
    }
    const note = (o) => out.push({ id: f.id, kind: f.kind, ...o });
    if (f.kind === "sketch") st.sketches[f.id] = f;
    let plan;
    try {
      plan = planFeature(f, st, fctx);
    } catch (e) {
      plan = refuse(`${f.id} (${f.kind}): translator error: ${e.message}`);
    }
    if (plan.refusal) {
      st.refused[f.id] = plan.refusal;
      note({ status: "refused", refusal: plan.refusal, commands: [] });
      continue;
    }
    if (plan.noop) {
      note({ status: "noop", commands: [] });
      continue;
    }
    let lastErr = null;
    let lastFail = null;
    let built = false;
    for (const variant of plan.variants) {
      let res;
      try {
        res = await ctx.runSC([...accepted, ...variant]);
      } catch (e) {
        res = { ok: false, failed: { error: `bridge error: ${e.message}` } };
      }
      if (!res.ok) {
        lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.rejected ?? res.error ?? "unknown");
        lastFail = res;
        continue;
      }
      const m = aggregate(res, plan.produces);
      if (!m) {
        lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(", ")} came back`;
        continue;
      }
      accepted.push(...variant);
      st.accLen[f.id] = accepted.length;
      st.bodies[f.id] = m.bodies;
      st.measure[f.id] = m;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === "hole" || f.kind === "pocket" || f.kind === "groove") {
          if (c === (f.kind === "hole" ? f.target : f.into)) st.head[c] = f.id;
        } else st.stale[c] = f.id;
      }
      note({ status: "built", commands: variant, measure: m, pickedFrom: plan.pickedFrom, evidence: plan.evidence ?? null, pick: variant.find((c) => c.params.edges || c.params.faces)?.params ?? null, variantsTried: plan.variants.indexOf(variant) + 1 });
      built = true;
      break;
    }
    if (built) continue;
    const sentence = `${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`;
    st.refused[f.id] = sentence;
    note({ status: "refused", refusal: sentence, commands: plan.variants[0], failed: lastFail?.failed ?? null, sketchAtFailure: lastFail?.sketch_at_failure ?? null });
  }
  return { features: out, commands: accepted, _state: { st, accepted, shapeCache } };
}
async function resolveAfter(tr, doc, name, ctx, want, targetId = null, beforeId = null) {
  const { st, accepted: all, shapeCache } = tr._state;
  let accepted = all;
  if (beforeId) {
    const i = doc.features.findIndex((x) => x.id === beforeId);
    let len4 = 0;
    for (let k = 0; k < i; k++) if (st.accLen[doc.features[k].id] !== void 0) len4 = Math.max(len4, st.accLen[doc.features[k].id]);
    accepted = all.slice(0, len4);
  }
  const rr = await resolveName(name, makeEnv(st, accepted, doc.features, ctx, shapeCache), want);
  return targetId ? confirmOnTarget(rr, { st, accepted, ctx, targetId }) : rr;
}

// lib/rule-check.mjs
var sub3 = (a, b) => [a[0] - b[0], a[1] - b[1]];
var cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
var dot3 = (a, b) => a[0] * b[0] + a[1] * b[1];
var len3 = (a) => Math.hypot(a[0], a[1]);
function pointOf(g, end, lock = false) {
  if (!g) return null;
  if (g.k === "point") return g.p;
  if (g.k === "line") return end === "b" ? g.b : g.a;
  if (g.k === "circle") return g.c;
  if (g.k === "arc") return end === "c" ? g.c : end === "b" ? g.b : lock ? g.c : g.a;
  return null;
}
function checkRules(geoms, rules, start = null) {
  const byId = new Map(geoms.map((g) => [g.id, g]));
  const sById = new Map((start ?? []).map((g) => [g.id, g]));
  const P = (id, end, lock) => id === -1 ? [0, 0] : pointOf(byId.get(id), end, lock);
  const out = [];
  rules.forEach((r, i) => {
    if (r.active === false) return;
    let res = null, unit = "mm";
    const ga = byId.get(r.a), gb = byId.get(r.b);
    switch (r.k) {
      case "coincident": {
        const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd);
        res = len3(sub3(a, b));
        break;
      }
      case "pointOnObject": {
        const p = P(r.a, r.aEnd);
        if (r.b === -2) res = Math.abs(p[1]);
        else if (r.b === -3) res = Math.abs(p[0]);
        else if (gb.k === "line") res = Math.abs(cross2(sub3(gb.b, gb.a), sub3(p, gb.a))) / len3(sub3(gb.b, gb.a));
        else res = Math.abs(len3(sub3(p, gb.c)) - gb.r);
        break;
      }
      case "horizontal":
        res = Math.abs(ga.a[1] - ga.b[1]);
        break;
      case "vertical":
        res = Math.abs(ga.a[0] - ga.b[0]);
        break;
      case "parallel":
      case "perpendicular": {
        const da = r.a < 0 ? r.a === -2 ? [1, 0] : [0, 1] : sub3(ga.b, ga.a);
        const db = r.b < 0 ? r.b === -2 ? [1, 0] : [0, 1] : sub3(gb.b, gb.a);
        const s = len3(da) * len3(db);
        res = (r.k === "parallel" ? Math.abs(cross2(da, db)) : Math.abs(dot3(da, db))) / s;
        unit = "1 (sin/cos of the angle)";
        break;
      }
      case "equal":
        res = Math.abs((ga.k === "line" ? len3(sub3(ga.b, ga.a)) : ga.r) - (gb.k === "line" ? len3(sub3(gb.b, gb.a)) : gb.r));
        break;
      case "tangent": {
        const round = (g) => g.k === "circle" || g.k === "arc";
        if (r.aEnd !== void 0 && r.bEnd !== void 0 && ga.k !== "circle" && gb.k !== "circle") {
          const P2 = pointOf(ga, r.aEnd);
          if (ga.k === "line" || gb.k === "line") {
            const L = ga.k === "line" ? ga : gb, C = ga.k === "line" ? gb : ga;
            const d = sub3(L.b, L.a);
            res = Math.abs(dot3(sub3(P2, C.c), d)) / len3(d);
          } else {
            const u = sub3(P2, ga.c), v = sub3(P2, gb.c);
            res = Math.abs(cross2(u, v)) / Math.max(len3(u) + len3(v), 1e-12);
          }
          break;
        }
        if (round(ga) && round(gb)) {
          const d = len3(sub3(ga.c, gb.c));
          res = Math.min(Math.abs(d - (ga.r + gb.r)), Math.abs(d - Math.abs(ga.r - gb.r)));
        } else {
          const L = ga.k === "line" ? ga : gb, C = ga.k === "line" ? gb : ga;
          res = Math.abs(Math.abs(cross2(sub3(L.b, L.a), sub3(C.c, L.a))) / len3(sub3(L.b, L.a)) - C.r);
        }
        break;
      }
      case "symmetric": {
        const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd);
        if (r.cEnd !== void 0) {
          const c = P(r.c, r.cEnd);
          res = len3([(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]]);
        } else {
          const L = r.c === -2 ? { a: [0, 0], b: [1, 0] } : r.c === -3 ? { a: [0, 0], b: [0, 1] } : byId.get(r.c);
          const d = sub3(L.b, L.a), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const off = Math.abs(cross2(d, sub3(m, L.a))) / len3(d);
          const perp = Math.abs(dot3(d, sub3(b, a))) / len3(d);
          res = Math.max(off, perp);
        }
        break;
      }
      case "distance":
        res = Math.abs(len3(sub3(P(r.a, r.aEnd), P(r.b, r.bEnd))) - r.value);
        break;
      case "distanceX":
        res = Math.abs(P(r.b, r.bEnd)[0] - P(r.a, r.aEnd)[0] - r.value);
        break;
      case "distanceY":
        res = Math.abs(P(r.b, r.bEnd)[1] - P(r.a, r.aEnd)[1] - r.value);
        break;
      case "radius":
        res = Math.abs(ga.r - r.value);
        break;
      case "diameter":
        res = Math.abs(2 * ga.r - r.value);
        break;
      case "angle": {
        const da = sub3(ga.b, ga.a), db = sub3(gb.b, gb.a);
        const d = (Math.atan2(cross2(da, db), dot3(da, db)) * 180 / Math.PI - r.value) % 180;
        const dd = (d % 180 + 180) % 180;
        res = Math.min(dd, 180 - dd);
        unit = "deg (mod 180)";
        break;
      }
      case "lock": {
        const s = sById.get(r.a);
        if (!s) {
          res = null;
          break;
        }
        const a = pointOf(byId.get(r.a), r.aEnd, true), b = pointOf(s, r.aEnd, true);
        res = len3(sub3(a, b));
        break;
      }
      default:
        res = null;
    }
    out.push({ rule: i, kind: r.k, residual: res, unit, driving: r.driving !== false });
  });
  return out;
}
export {
  FEATURE_KINDS,
  sketch_arc_exports as arc,
  checkRules,
  docProfileIndices,
  model_types_exports as mt,
  resolveAfter,
  solveDoc,
  translateDoc
};
