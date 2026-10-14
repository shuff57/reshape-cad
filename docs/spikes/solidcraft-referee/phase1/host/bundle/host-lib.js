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
  const hasZeroLengthEdge = Array.from({ length: n }, (_, i) => edgeLength(pts, i)).some((len2) => len2 < 1e-9);
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
      const dot = (ax * bx + ay * by) / (la * lb);
      const cross = (ax * by - ay * bx) / (la * lb);
      const turn = Math.atan2(cross, dot);
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
  const cross = inEdge[0] * outEdge[1] - inEdge[1] * outEdge[0];
  const sweep = Math.PI - interior;
  const bulge = (cross >= 0 ? 1 : -1) * Math.tan(sweep / 4);
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
    const len2 = Math.hypot(design[j][0] - design[k][0], design[j][1] - design[k][1]);
    const sum = a.trim + b.trim;
    if (sum > len2 * (1 + 1e-12)) {
      const share = len2 / sum;
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

// translate-browser.mjs
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
var add = (a, b) => a.map((v, i) => v + b[i]);
var len = (a) => Math.hypot(...a);
var isZero3 = (v) => !v || v[0] === 0 && v[1] === 0 && v[2] === 0;
var bname = (id) => `b_${id}`;
var NAMED = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }
};
function frameOf(s, mt) {
  if (mt && mt.sketchFrameOf) return mt.sketchFrameOf(s);
  if (s.frame) {
    const { origin, u, v } = s.frame;
    return { origin, u, v, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
  }
  const a = NAMED[s.plane ?? "xy"] ?? NAMED.xy;
  const o = s.offset ?? 0;
  return { origin: a.n.map((c) => c * o), ...a };
}
var refuse = (sentence) => ({ refusal: sentence });
function profileCmds(sk, ctx) {
  if (sk.shape !== "circle" && Array.isArray(sk.geoms) && sk.geoms.length > 0) {
    return refuse(`sketch ${sk.id} is drawn as rows and rules (a soup), which this translator does not map yet`);
  }
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
function inSketch(sk, ctx, st, { revolve = false } = {}) {
  const fr = frameOf(sk, ctx.mt);
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
        const s = inSketch(sk, ctx, st);
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
        const L = len(s);
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
      if (!f.open) return { variants: [[{ command: "solid.shell", params: { thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target] };
      const r = ctx.resolve(f.open);
      if (!r || r.kind !== "face") return refuse(`${f.id} (shell): the opened face could not be resolved to a point (this browser demo has no brep-rs name lookup, so it can only place features that need no named face or edge)`);
      return { variants: [[{ command: "solid.shell", params: { faces: [r.centroid], thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target], pickedFrom: "brep-rs resolve" };
    }
    case "fillet": {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (fillet): needs a single target body`);
      const r = ctx.resolve(f.edge);
      if (!r || r.kind !== "edge") return refuse(`${f.id} (fillet): the edge could not be resolved to a point (this browser demo has no brep-rs name lookup, so it can only place features that need no named face or edge)`);
      const c = r.centroid;
      const cands = [c];
      if (r.length > 0) {
        const rad = r.length / (2 * Math.PI);
        for (const a of ["x", "y", "z"]) cands.push(add(c, AX[a].map((v) => v * rad)));
      }
      const mk = (p) => f.style === "chamfer" ? { command: "solid.chamfer", params: { edges: [p], distance: f.size, body: bs[0] } } : { command: "solid.fillet", params: { edges: [p], radius: f.size, body: bs[0] } };
      return { variants: cands.map((p) => [mk(p)]), produces: bs, consumes: [f.target], pickedFrom: "brep-rs resolve" };
    }
    case "draft": {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.whole || !f.face) return refuse(`${f.id} (draft): a whole-body draft is not mapped (needs a face pick per face)`);
      const bs = needBody(f.target);
      if (!bs || bs.length !== 1) return refuse(`${f.id} (draft): needs a single target body`);
      const r = ctx.resolve(f.face);
      if (!r || r.kind !== "face") return refuse(`${f.id} (draft): the face could not be resolved to a point (this browser demo has no brep-rs name lookup)`);
      const ax = AX[f.pull ?? "z"];
      return {
        variants: [[{ command: "solid.draft", params: { faces: [r.centroid], angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }]],
        produces: bs,
        consumes: [f.target],
        pickedFrom: "brep-rs resolve"
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
async function translateDoc(doc, ctx) {
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0 };
  const accepted = [];
  const out = [];
  for (let idx = 0; idx < doc.features.length; idx++) {
    const f = doc.features[idx];
    const prefix = doc.features.slice(0, idx);
    const fctx = { ...ctx, resolve: (name) => ctx.resolveAt(prefix, name) };
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
        continue;
      }
      const m = aggregate(res, plan.produces);
      if (!m) {
        lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(", ")} came back`;
        continue;
      }
      accepted.push(...variant);
      st.bodies[f.id] = m.bodies;
      st.measure[f.id] = m;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === "hole" || f.kind === "pocket" || f.kind === "groove") {
          if (c === (f.kind === "hole" ? f.target : f.into)) st.head[c] = f.id;
        } else st.stale[c] = f.id;
      }
      note({ status: "built", commands: variant, measure: m, pickedFrom: plan.pickedFrom, variantsTried: plan.variants.indexOf(variant) + 1 });
      built = true;
      break;
    }
    if (built) continue;
    const sentence = `${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`;
    st.refused[f.id] = sentence;
    note({ status: "refused", refusal: sentence, commands: plan.variants[0] });
  }
  return { features: out, commands: accepted };
}
export {
  FEATURE_KINDS,
  sketch_arc_exports as arc,
  model_types_exports as mt,
  solveDoc,
  translateDoc
};
