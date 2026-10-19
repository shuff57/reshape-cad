(() => {
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
    const wrap2 = (i) => (i % n + n) % n;
    for (const p of pinned)
      fixed.add(wrap2(p));
    for (const c of constraints)
      if (c.kind === "lock")
        fixed.add(wrap2(c.corner));
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
    const hasZeroLengthEdge = Array.from({ length: n }, (_, i) => edgeLength(pts, i)).some((len) => len < 1e-9);
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
  function fewestMoversSeed(pts, edge, other, kind, count) {
    const seed = pts.map((p) => [p[0], p[1]]);
    const angleA = edgeAngle(pts, edge, count);
    if (angleA === null)
      return seed;
    const [a1, a2] = edgeCorners(edge, count);
    const [b1, b2] = edgeCorners(other, count);
    const shared = [b1, b2].find((c) => c === a1 || c === a2);
    const pivot = shared !== void 0 ? pts[shared] : [(pts[b1][0] + pts[b2][0]) / 2, (pts[b1][1] + pts[b2][1]) / 2];
    if (kind === "equal") {
      const lenA = edgeLength(pts, edge);
      const lenB = edgeLength(pts, other);
      if (lenB < 1e-9)
        return seed;
      const scale = lenA / lenB;
      for (const c of [b1, b2]) {
        if (c === shared)
          continue;
        seed[c] = [
          pivot[0] + (pts[c][0] - pivot[0]) * scale,
          pivot[1] + (pts[c][1] - pivot[1]) * scale
        ];
      }
      return seed;
    }
    const angleB = edgeAngle(pts, other, count);
    if (angleB === null)
      return seed;
    const target = kind === "perpendicular" ? angleA + Math.PI / 2 : angleA;
    let rotate = (target - angleB) % Math.PI;
    if (rotate > Math.PI / 2)
      rotate -= Math.PI;
    if (rotate <= -Math.PI / 2)
      rotate += Math.PI;
    const cos = Math.cos(rotate);
    const sin = Math.sin(rotate);
    for (const c of [b1, b2]) {
      if (c === shared)
        continue;
      const dx = pts[c][0] - pivot[0];
      const dy = pts[c][1] - pivot[1];
      seed[c] = [pivot[0] + dx * cos - dy * sin, pivot[1] + dx * sin + dy * cos];
    }
    return seed;
  }
  function seedForNewRule(points, constraints) {
    const added = constraints[constraints.length - 1];
    if (!added)
      return points;
    if (added.kind !== "parallel" && added.kind !== "perpendicular" && added.kind !== "equal") {
      return points;
    }
    return fewestMoversSeed(points, added.edge, added.other, added.kind, points.length);
  }
  function describe(c) {
    if (c.kind === "horizontal")
      return `edge ${c.edge + 1} across`;
    if (c.kind === "vertical")
      return `edge ${c.edge + 1} up`;
    if (c.kind === "length")
      return `edge ${c.edge + 1} = ${c.value}`;
    if (c.kind === "equal")
      return `edge ${c.edge + 1} = edge ${c.other + 1}`;
    if (c.kind === "parallel")
      return `edge ${c.edge + 1} \u2225 edge ${c.other + 1}`;
    if (c.kind === "perpendicular")
      return `edge ${c.edge + 1} \u22A5 edge ${c.other + 1}`;
    if (c.kind === "distanceX")
      return `corner ${c.a + 1}\u2192${c.b + 1} across = ${c.value}`;
    if (c.kind === "distanceY")
      return `corner ${c.a + 1}\u2192${c.b + 1} up = ${c.value}`;
    if (c.kind === "symmetric")
      return `corner ${c.center + 1} centred between ${c.a + 1} and ${c.b + 1}`;
    if (c.kind === "angle")
      return `edge ${c.edge + 1} \u2220 edge ${c.other + 1} = ${c.degrees}\xB0`;
    return `corner ${c.corner + 1} pinned`;
  }
  function addConstraintSettling(points, next) {
    if (next.length === 0)
      return { constraints: next, removed: null, removedAlso: null };
    const added = next[next.length - 1];
    const seed = seedForNewRule(points, next);
    const isBad = (cs) => {
      const solved = solveSketch(seed, cs);
      return solved.overConstrained || collapsedByRatio(points, solved.points);
    };
    if (!isBad(next))
      return { constraints: next, removed: null, removedAlso: null };
    let bestIdx = -1;
    let bestArea = -Infinity;
    let bestIsLock = true;
    for (let i = 0; i < next.length; i++) {
      if (next[i] === added)
        continue;
      const candidate = next.filter((_, idx) => idx !== i);
      const solved = solveSketch(seed, candidate);
      if (solved.overConstrained || collapsedByRatio(points, solved.points))
        continue;
      const isLock = next[i].kind === "lock";
      const area = polygonArea(solved.points);
      const better = bestIdx === -1 || bestIsLock && !isLock || bestIsLock === isLock && area > bestArea;
      if (better) {
        bestArea = area;
        bestIdx = i;
        bestIsLock = isLock;
      }
    }
    if (bestIdx !== -1) {
      return {
        constraints: next.filter((_, idx) => idx !== bestIdx),
        removed: next[bestIdx],
        removedAlso: null
      };
    }
    let bestI = -1;
    let bestJ = -1;
    let bestPairArea = -Infinity;
    let bestPairLocks = 3;
    for (let i = 0; i < next.length; i++) {
      if (next[i] === added)
        continue;
      for (let j = i + 1; j < next.length; j++) {
        if (next[j] === added)
          continue;
        const candidate = next.filter((_, idx) => idx !== i && idx !== j);
        const solved = solveSketch(seed, candidate);
        if (solved.overConstrained || collapsedByRatio(points, solved.points))
          continue;
        const locks = (next[i].kind === "lock" ? 1 : 0) + (next[j].kind === "lock" ? 1 : 0);
        const area = polygonArea(solved.points);
        const better = bestI === -1 || locks < bestPairLocks || locks === bestPairLocks && area > bestPairArea;
        if (better) {
          bestI = i;
          bestJ = j;
          bestPairArea = area;
          bestPairLocks = locks;
        }
      }
    }
    if (bestI === -1)
      return { constraints: next, removed: null, removedAlso: null };
    return {
      constraints: next.filter((_, idx) => idx !== bestI && idx !== bestJ),
      removed: next[bestI],
      removedAlso: next[bestJ]
    };
  }
  function buildSlotRows(cA, cB, r, baseId) {
    if (!(r > 1e-9))
      return null;
    const dx = cB[0] - cA[0];
    const dy = cB[1] - cA[1];
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-9))
      return null;
    const px = -dy / len;
    const py = dx / len;
    const arc1a = [cA[0] + px * r, cA[1] + py * r];
    const arc1b = [cA[0] - px * r, cA[1] - py * r];
    const arc2a = [cB[0] - px * r, cB[1] - py * r];
    const arc2b = [cB[0] + px * r, cB[1] + py * r];
    const arc1 = baseId;
    const arc2 = baseId + 1;
    const top = baseId + 2;
    const bottom = baseId + 3;
    const geoms = [
      { k: "arc", id: arc1, c: [cA[0], cA[1]], r, a: arc1b, b: arc1a, sense: "cw" },
      { k: "arc", id: arc2, c: [cB[0], cB[1]], r, a: arc2b, b: arc2a, sense: "cw" },
      { k: "line", id: top, a: arc1a, b: arc2b },
      { k: "line", id: bottom, a: arc2a, b: arc1b }
    ];
    const rules = [
      { k: "coincident", a: top, aEnd: "a", b: arc1, bEnd: "b" },
      { k: "tangent", a: top, aEnd: "a", b: arc1, bEnd: "b" },
      { k: "coincident", a: top, aEnd: "b", b: arc2, bEnd: "a" },
      { k: "tangent", a: top, aEnd: "b", b: arc2, bEnd: "a" },
      { k: "coincident", a: bottom, aEnd: "a", b: arc2, bEnd: "b" },
      { k: "tangent", a: bottom, aEnd: "a", b: arc2, bEnd: "b" },
      { k: "coincident", a: bottom, aEnd: "b", b: arc1, bEnd: "a" },
      { k: "tangent", a: bottom, aEnd: "b", b: arc1, bEnd: "a" }
    ];
    return { geoms, rules, ids: { arc1, arc2, top, bottom } };
  }

  // ../../../../../packages/sketch/dist/sketch-arc.js
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
      const len = Math.hypot(design[j][0] - design[k][0], design[j][1] - design[k][1]);
      const sum = a.trim + b.trim;
      if (sum > len * (1 + 1e-12)) {
        const share = len / sum;
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

  // ../../../../../packages/script/dist/topo-name.js
  function rootFeature(n) {
    if (n.cause === "carried" || n.cause === "split")
      return rootFeature(n.of);
    if (n.cause === "between")
      return rootFeature(n.of[0]);
    return n.feature;
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
  function newDatum(doc) {
    return { id: nextId(doc, "pl"), kind: "datum", type: "plane" };
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
  function newRotate(doc, target, angles) {
    return { id: nextId(doc, "turn"), kind: "rotate", target, angles };
  }
  function newMove(doc, target, copy = false) {
    return { id: nextId(doc, "move"), kind: "move", target, offset: [20, 0, 0], copy };
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

  // ../../../../../packages/script/dist/model-codegen.js
  var AXIS = ["width", "depth", "height"];
  function pname(id, slot) {
    return `${id}_${slot}`;
  }
  function sizeBounds(value) {
    return { min: 1, max: Math.max(100, Math.ceil(value * 4)), step: 1 };
  }
  function generatedParams(doc) {
    const out = [];
    const names = nameMap(doc);
    doc.features.forEach((f) => {
      const label = names[f.id];
      const push = (slot, caption, value, b = sizeBounds(value)) => out.push({ name: pname(f.id, slot), caption: `${label} ${caption}`, value, ...b });
      if (f.kind === "box") {
        AXIS.forEach((a, ax) => push(a, a, f.size[ax]));
        pushCentre(out, f.id, label, f.center);
        if (f.round !== void 0)
          push("round", "corner", f.round, { min: 0, max: 40, step: 0.5 });
        pushTurn(out, f.id, label, f.rotate);
      } else if (f.kind === "cylinder") {
        push("radius", "across", f.radius * 2);
        push("height", "height", f.height);
        pushCentre(out, f.id, label, f.center);
        if (f.round !== void 0)
          push("round", "corner", f.round, { min: 0, max: 40, step: 0.5 });
        pushTurn(out, f.id, label, f.rotate);
      } else if (f.kind === "cone") {
        push("radius", "across", f.radius * 2);
        push("height", "height", f.height);
        pushCentre(out, f.id, label, f.center);
        pushTurn(out, f.id, label, f.rotate);
      } else if (f.kind === "torus") {
        push("ring", "across", 2 * (f.ringRadius + f.tubeRadius));
        push("tube", "tube across", 2 * f.tubeRadius);
        pushCentre(out, f.id, label, f.center);
      } else if (f.kind === "sphere") {
        push("radius", "across", f.radius * 2);
        pushCentre(out, f.id, label, f.center);
      } else if (f.kind === "prism") {
        push("radius", "across", f.radius * 2);
        push("height", "height", f.height);
        pushCentre(out, f.id, label, f.center);
        pushTurn(out, f.id, label, f.rotate);
      } else if (f.kind === "wedge") {
        push("width", "width", f.width);
        push("depth", "depth", f.depth);
        push("height", "height", f.height);
        pushCentre(out, f.id, label, f.center);
        pushTurn(out, f.id, label, f.rotate);
      } else if (f.kind === "datum") {
        if (!f.frame)
          push("offset", "offset", f.offset ?? 0, { min: -500, max: 500, step: 1 });
      } else if (f.kind === "groove") {
        push("angle", "angle", f.angle);
      } else if (f.kind === "pocket") {
        push("depth", "deep", f.depth);
      } else if (f.kind === "sketch") {
        if (f.geoms) {
          (f.rules ?? []).forEach((raw, i) => {
            const r = raw;
            if (r.value === void 0)
              return;
            const numeric = typeof r.value === "number" ? r.value : NaN;
            out.push({
              name: pname(f.id, `rule${i}-value`),
              caption: `${label} ${r.k ?? "rule"}`,
              value: numeric,
              min: 0,
              max: Math.max(Number.isFinite(numeric) ? Math.abs(numeric) * 4 : 100, 100),
              step: 1
            });
          });
          for (const g of f.geoms) {
            if (g.k !== "circle" && g.k !== "arc")
              continue;
            out.push({
              name: pname(f.id, `g${g.id}r`),
              caption: `${label} ${g.k} ${g.id} radius`,
              value: g.r,
              min: 0,
              max: Math.max(Math.abs(g.r) * 4, 100),
              step: 1
            });
          }
          if (!f.onDatum)
            push("offset", "offset", f.offset, { min: -500, max: 500, step: 1 });
          return out;
        }
        if (f.shape === "circle" && f.points.length === 2) {
          const [p0, p1] = f.points;
          const across = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          const cx = (p0[0] + p1[0]) / 2;
          const cy = (p0[1] + p1[1]) / 2;
          push("across", "across", across);
          out.push({ name: pname(f.id, "x"), caption: `${label} centre x`, value: cx, min: -500, max: 500, step: 1 });
          out.push({ name: pname(f.id, "y"), caption: `${label} centre y`, value: cy, min: -500, max: 500, step: 1 });
        } else {
          f.points.forEach(([u, v], n) => {
            out.push({ name: pname(f.id, `p${n}u`), caption: `${label} corner ${n + 1} across`, value: u, min: -500, max: 500, step: 1 });
            out.push({ name: pname(f.id, `p${n}v`), caption: `${label} corner ${n + 1} up`, value: v, min: -500, max: 500, step: 1 });
          });
          for (const [key, want] of Object.entries(f.rounds ?? {})) {
            const k = Number(key);
            if (!Number.isInteger(k) || k < 0 || k >= f.points.length || !(want > 0))
              continue;
            const ceiling = maxFilletRadius(f.points, k, f.bulges);
            out.push({
              name: pname(f.id, `r${k}`),
              caption: `${label} corner ${k + 1} round`,
              value: want,
              min: 0,
              // The ceiling can sit BELOW what is currently stored (another round
              // on the shared edge, or a corner the solver has since sharpened).
              // Clamping the slider's max below its own value would snap the
              // radius down the first time the panel rendered, silently -- which
              // is the shape of bug this whole round exists to stop.
              max: Math.max(ceiling, want),
              step: 0.5
            });
          }
        }
        if (!f.onDatum)
          push("offset", "offset", f.offset, { min: -500, max: 500, step: 1 });
      } else if (f.kind === "extrude") {
        push("height", "height", f.height);
      } else if (f.kind === "revolve") {
        push("angle", "angle", f.angle, { min: 1, max: 360, step: 1 });
      } else if (f.kind === "pattern") {
        push("count", "count", f.count, { min: 1, max: 24, step: 1 });
        if (f.mode === "circular") {
          push("totalangle", "angle", f.totalAngle ?? 360, { min: 1, max: 360, step: 1 });
        } else {
          const step = f.step ?? [0, 0, 0];
          push("stepx", "step x", step[0], { min: -500, max: 500, step: 1 });
          push("stepy", "step y", step[1], { min: -500, max: 500, step: 1 });
          push("stepz", "step z", step[2], { min: -500, max: 500, step: 1 });
        }
      } else if (f.kind === "hole") {
        push("diameter", "diameter", f.diameter);
        push("depth", "depth", f.depth);
        pushCentre(out, f.id, label, f.center, f.axis === "x" ? 0 : f.axis === "y" ? 1 : 2);
        if (f.corners) {
          const fullX = extentAlong(doc, f.target, "x");
          const fullY = extentAlong(doc, f.target, "y");
          const insetX = fullX != null ? fullX / 2 - f.corners.dx : f.corners.dx;
          const insetY = fullY != null ? fullY / 2 - f.corners.dy : f.corners.dy;
          const margin = f.diameter / 2 + 0.5;
          push("dx", "in from each side (across)", insetX, { min: margin, max: 250, step: 0.5 });
          push("dy", "in from each side (up)", insetY, { min: margin, max: 250, step: 0.5 });
        }
        if (f.counterbore) {
          push("counterboreAcross", "counterbore across", f.counterbore.diameter, { min: 0.5, max: 250, step: 0.5 });
          push("counterboreDeep", "counterbore deep", f.counterbore.depth, { min: 0.5, max: 250, step: 0.5 });
        }
        if (f.countersink) {
          push("countersinkAcross", "countersink across", f.countersink.diameter, { min: 0.5, max: 250, step: 0.5 });
          push("countersinkAngle", "countersink angle", f.countersink.angleDeg, { min: 1, max: 179, step: 1 });
        }
      } else if (f.kind === "shell") {
        push("thickness", "wall", f.thickness, { min: 0.5, max: 40, step: 0.5 });
      } else if (f.kind === "move") {
        pushCentre(out, f.id, label, f.offset);
      } else if (f.kind === "rotate") {
        pushTurn(out, f.id, label, f.angles);
      } else if (f.kind === "fillet") {
        const root = doc.features.find((x) => x.id === rootFeature(f.edge));
        const ceiling = root && isRoundable(root) ? maxRound(root) : f.size;
        push("size", f.style === "chamfer" ? "cut" : "radius", f.size, {
          // 0.5-step from 0.5, so every whole and half number is a stop the
          // slider can land on; from 0.1 the stops were 0.1, 0.6, 1.1 ... and
          // typing 3 snapped to 3.1 with no warning.
          min: 0.5,
          // On the step grid, or a typed 15 clamps the text box to 9.99 while
          // the slider beside it sits on 9.5 (measured 2026-09-03).
          max: Math.max(Math.floor(ceiling / 0.5) * 0.5, f.size),
          step: 0.5
        });
      }
      if (f.kind === "draft") {
        push("angle", "taper angle", f.angle, { min: -89.5, max: 89.5, step: 0.5 });
      }
    });
    return out;
  }
  function pushTurn(out, id, label, r) {
    if (!r)
      return;
    ["rx", "ry", "rz"].forEach((a, i) => {
      out.push({
        name: pname(id, a),
        caption: `${label} turn ${a[1]}`,
        value: r[i],
        min: -180,
        max: 180,
        step: 5
      });
    });
  }
  function pushCentre(out, id, label, c, skip = -1) {
    ["x", "y", "z"].forEach((a, i) => {
      if (i === skip)
        return;
      out.push({
        name: pname(id, a),
        caption: `${label} ${a}`,
        value: c[i],
        min: -500,
        max: 500,
        step: 1
      });
    });
  }
  function applyParam(doc, name, value) {
    const cut = name.lastIndexOf("_");
    if (cut < 0)
      return doc;
    const id = name.slice(0, cut);
    const slot = name.slice(cut + 1);
    let changed = false;
    const features = doc.features.map((f) => {
      if (f.id !== id)
        return f;
      const turn = slot === "rx" ? 0 : slot === "ry" ? 1 : slot === "rz" ? 2 : null;
      if (turn !== null && f.kind === "rotate") {
        const angles = [f.angles[0], f.angles[1], f.angles[2]];
        angles[turn] = value;
        changed = true;
        return { ...f, angles };
      }
      if (turn !== null && canRotate(f) && f.rotate) {
        const rotate = [f.rotate[0], f.rotate[1], f.rotate[2]];
        rotate[turn] = value;
        changed = true;
        return { ...f, rotate };
      }
      const axis = slot === "x" ? 0 : slot === "y" ? 1 : slot === "z" ? 2 : null;
      if (axis !== null && isShape(f)) {
        const center = [...f.center];
        center[axis] = value;
        changed = true;
        return { ...f, center };
      }
      if (f.kind === "box") {
        const ax = AXIS.indexOf(slot);
        if (ax === 0 || ax === 1 || ax === 2) {
          const size = [...f.size];
          size[ax] = value;
          changed = true;
          return { ...f, size };
        }
        if (slot === "round") {
          changed = true;
          return { ...f, round: value };
        }
      }
      if (f.kind === "cylinder") {
        if (slot === "radius") {
          changed = true;
          return { ...f, radius: value / 2 };
        }
        if (slot === "height") {
          changed = true;
          return { ...f, height: value };
        }
        if (slot === "round") {
          changed = true;
          return { ...f, round: value };
        }
      }
      if (f.kind === "cone") {
        if (slot === "radius") {
          changed = true;
          return { ...f, radius: value / 2 };
        }
        if (slot === "height") {
          changed = true;
          return { ...f, height: value };
        }
      }
      if (f.kind === "torus") {
        if (slot === "ring") {
          changed = true;
          return { ...f, ringRadius: value / 2 - f.tubeRadius };
        }
        if (slot === "tube") {
          changed = true;
          const tubeRadius = value / 2;
          const ringRadius = f.ringRadius + f.tubeRadius - tubeRadius;
          return { ...f, ringRadius, tubeRadius };
        }
      }
      if (f.kind === "prism") {
        if (slot === "radius") {
          changed = true;
          return { ...f, radius: value / 2 };
        }
        if (slot === "height") {
          changed = true;
          return { ...f, height: value };
        }
      }
      if (f.kind === "wedge") {
        if (slot === "width") {
          changed = true;
          return { ...f, width: value };
        }
        if (slot === "depth") {
          changed = true;
          return { ...f, depth: value };
        }
        if (slot === "height") {
          changed = true;
          return { ...f, height: value };
        }
      }
      if (f.kind === "datum") {
        if (slot === "offset" && !f.frame) {
          changed = true;
          return { ...f, offset: value };
        }
      }
      if (f.kind === "groove") {
        if (slot === "angle") {
          changed = true;
          return { ...f, angle: value };
        }
      }
      if (f.kind === "pocket") {
        if (slot === "depth") {
          changed = true;
          return { ...f, depth: value };
        }
      }
      if (f.kind === "sketch") {
        if (f.shape === "circle" && f.points.length === 2 && (slot === "across" || slot === "x" || slot === "y")) {
          const [p0, p1] = f.points;
          const cx = (p0[0] + p1[0]) / 2;
          const cy = (p0[1] + p1[1]) / 2;
          const hx = (p1[0] - p0[0]) / 2;
          const hy = (p1[1] - p0[1]) / 2;
          if (slot === "across") {
            const halfLen = Math.hypot(hx, hy);
            const newHalf = Math.max(0, value) / 2;
            const dirx = halfLen > 1e-9 ? hx / halfLen : 1;
            const diry = halfLen > 1e-9 ? hy / halfLen : 0;
            const points2 = [
              [cx - dirx * newHalf, cy - diry * newHalf],
              [cx + dirx * newHalf, cy + diry * newHalf]
            ];
            changed = true;
            return { ...f, points: points2 };
          }
          const newCx = slot === "x" ? value : cx;
          const newCy = slot === "y" ? value : cy;
          const points = [
            [newCx - hx, newCy - hy],
            [newCx + hx, newCy + hy]
          ];
          changed = true;
          return { ...f, points };
        }
        const m = /^p(\d+)([uv])$/.exec(slot);
        if (m) {
          const n = Number(m[1]);
          if (n >= 0 && n < f.points.length) {
            const points = f.points.map((pt, i) => i === n ? m[2] === "u" ? [value, pt[1]] : [pt[0], value] : pt);
            changed = true;
            return { ...f, points };
          }
        }
        const r = /^r(\d+)$/.exec(slot);
        if (r) {
          const k = Number(r[1]);
          if (k >= 0 && k < f.points.length) {
            const rounds = { ...f.rounds ?? {} };
            if (value > 0)
              rounds[k] = value;
            else
              delete rounds[k];
            changed = true;
            return { ...f, rounds };
          }
        }
        if (slot === "offset") {
          changed = true;
          return { ...f, offset: value };
        }
        const gm = /^g(\d+)r$/.exec(slot);
        if (gm && f.geoms) {
          const gid = Number(gm[1]);
          const hit = f.geoms.some((g) => g.id === gid && (g.k === "circle" || g.k === "arc"));
          if (hit) {
            const geoms = f.geoms.map((g) => g.id === gid && (g.k === "circle" || g.k === "arc") ? { ...g, r: value } : g);
            changed = true;
            return { ...f, geoms, geom: geoms };
          }
        }
        const rm = /^rule(\d+)-value$/.exec(slot);
        if (rm && f.rules) {
          const i = Number(rm[1]);
          const r2 = f.rules[i];
          if (r2 && typeof r2.value === "number") {
            const rules = f.rules.map((x, j) => j === i ? { ...x, value } : x);
            changed = true;
            return { ...f, rules };
          }
        }
      }
      if (f.kind === "extrude" && slot === "height") {
        changed = true;
        return { ...f, height: value };
      }
      if (f.kind === "sphere" && slot === "radius") {
        changed = true;
        return { ...f, radius: value / 2 };
      }
      if (f.kind === "revolve" && slot === "angle") {
        changed = true;
        return { ...f, angle: value };
      }
      if (f.kind === "pattern") {
        if (slot === "count") {
          changed = true;
          return { ...f, count: Math.max(1, Math.round(value)) };
        }
        if (slot === "totalangle") {
          changed = true;
          return { ...f, totalAngle: value };
        }
        const stepAx = slot === "stepx" ? 0 : slot === "stepy" ? 1 : slot === "stepz" ? 2 : null;
        if (stepAx !== null) {
          const step = f.step ? [...f.step] : [0, 0, 0];
          step[stepAx] = value;
          changed = true;
          return { ...f, step };
        }
      }
      if (f.kind === "hole") {
        if (slot === "diameter") {
          changed = true;
          return { ...f, diameter: value };
        }
        if (slot === "depth") {
          changed = true;
          return withHoleDepth(doc, f, value);
        }
        const holeAx = slot === "x" ? 0 : slot === "y" ? 1 : slot === "z" ? 2 : null;
        const drillAx = f.axis === "x" ? 0 : f.axis === "y" ? 1 : 2;
        if (holeAx !== null && holeAx !== drillAx) {
          const center = [...f.center];
          center[holeAx] = value;
          changed = true;
          return { ...f, center };
        }
        if (f.counterbore && (slot === "counterboreAcross" || slot === "counterboreDeep")) {
          const key = slot === "counterboreAcross" ? "diameter" : "depth";
          changed = true;
          return { ...f, counterbore: { ...f.counterbore, [key]: value } };
        }
        if (f.countersink && (slot === "countersinkAcross" || slot === "countersinkAngle")) {
          const key = slot === "countersinkAcross" ? "diameter" : "angleDeg";
          changed = true;
          return { ...f, countersink: { ...f.countersink, [key]: value } };
        }
        if (f.corners && (slot === "dx" || slot === "dy")) {
          const axis2 = slot === "dx" ? "x" : "y";
          const full = extentAlong(doc, f.target, axis2);
          const stored = full != null ? full / 2 - value : value;
          changed = true;
          return { ...f, corners: { ...f.corners, [slot]: stored } };
        }
      }
      if (f.kind === "shell" && slot === "thickness") {
        changed = true;
        return { ...f, thickness: value };
      }
      if (f.kind === "move") {
        const moveAx = slot === "x" ? 0 : slot === "y" ? 1 : slot === "z" ? 2 : null;
        if (moveAx !== null) {
          const offset = [...f.offset];
          offset[moveAx] = value;
          changed = true;
          return { ...f, offset };
        }
      }
      if (f.kind === "fillet" && slot === "size") {
        changed = true;
        return { ...f, size: value };
      }
      if (f.kind === "draft" && slot === "angle") {
        changed = true;
        return { ...f, angle: value };
      }
      return f;
    });
    if (!changed)
      return doc;
    const moved = features.find((f) => f.id === id);
    if (moved && moved.kind === "datum" && slot === "offset") {
      return {
        ...doc,
        features: features.map((f) => f.kind === "sketch" && f.onDatum === id && !f.frame ? { ...f, offset: moved.offset ?? 0 } : f)
      };
    }
    return { ...doc, features };
  }
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

  // ../../../../../packages/script/dist/reshape-script.js
  var VOCABULARY = [
    // student words (course-facing, documented in the lesson pages)
    "box",
    "cylinder",
    "sphere",
    "cone",
    "ring",
    "prism",
    "wedge",
    "groove",
    "pocket",
    "hole",
    "holes",
    "hollow",
    "round",
    "bevel",
    "repeat",
    "repeatAround",
    "mirror",
    "move",
    "turn",
    "join",
    "cut",
    "keep",
    "draft",
    "sketch",
    "plane",
    "pull",
    "spin",
    "blend",
    "param",
    // official geometry names (API-facing; same fns as their student alias)
    "cuboid",
    "torus",
    "fillet",
    "chamfer",
    "shell",
    "subtract",
    "union",
    "intersect",
    "linearPattern",
    "polarPattern",
    "extrude",
    "revolve",
    "loft"
  ];
  var SOURCE_NAME = "reshape-user-script.js";
  var SCOPE_NAME = "__RESHAPE_SCOPE__";
  var LINE_OFFSET = 3;
  function lineOf(err) {
    const stack = err instanceof Error ? err.stack : void 0;
    if (!stack)
      return null;
    const rx = new RegExp(SOURCE_NAME.replace(/\./g, "\\.") + ":(\\d+):(\\d+)");
    const m = rx.exec(stack);
    if (!m)
      return null;
    const line = parseInt(m[1], 10) - LINE_OFFSET;
    return line > 0 ? line : null;
  }
  function messageOf(err) {
    if (err instanceof Error)
      return err.message;
    return String(err);
  }
  function levenshtein(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const d = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0; i < rows; i++)
      d[i][0] = i;
    for (let j = 0; j < cols; j++)
      d[0][j] = j;
    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1]);
      }
    }
    return d[a.length][b.length];
  }
  function friendlyMessage(err) {
    if (err instanceof ReferenceError) {
      const m = /^([A-Za-z_$][\w$]*) is not defined$/.exec(err.message);
      if (m) {
        const name = m[1];
        let nearest2 = VOCABULARY[0];
        let best = Infinity;
        for (const word of VOCABULARY) {
          const d = levenshtein(name, word);
          if (d < best) {
            best = d;
            nearest2 = word;
          }
        }
        const closeEnough = best <= Math.max(2, Math.ceil(name.length / 2));
        return closeEnough ? `${name} is not a tool here. Did you mean ${nearest2}()?` : `${name} is not a tool here.`;
      }
      const tdz = /^Cannot access '([A-Za-z_$][\w$]*)' before initialization\.?$/.exec(err.message);
      if (tdz && VOCABULARY.includes(tdz[1])) {
        const name = tdz[1];
        return `You can't build ${name}() into a variable named "${name}" on the same line -- JS reserves that name for the whole line before ${name}(...) even runs. Give the result its own name instead, e.g. const my${name[0].toUpperCase()}${name.slice(1)} = ${name}(...).`;
      }
    }
    return messageOf(err);
  }
  var ParamNumber = class extends Number {
    paramName;
    constructor(v, paramName) {
      super(v);
      this.paramName = paramName;
    }
  };
  function paramNameOf(v) {
    return v instanceof ParamNumber ? v.paramName : null;
  }
  function unwrap(v) {
    return v instanceof ParamNumber ? v.valueOf() : v;
  }
  function isFiniteNumber(v) {
    if (v instanceof ParamNumber)
      return Number.isFinite(v.valueOf());
    return typeof v === "number" && Number.isFinite(v);
  }
  function describe2(v) {
    if (v === null)
      return "null";
    if (v === void 0)
      return "nothing";
    if (typeof v === "string")
      return `the text "${v}"`;
    if (typeof v === "boolean")
      return String(v);
    if (Array.isArray(v))
      return `a list of ${v.length}`;
    if (isTopoRef(v))
      return v.name.cause === "between" ? "an edge" : "a face";
    if (isHandle(v))
      return `a ${v.kind} from earlier in the script`;
    if (typeof v === "object")
      return "a { } object";
    if (typeof v === "function")
      return "a function";
    return String(v);
  }
  function requiredNumber(fn, label, v) {
    if (v === void 0) {
      throw new Error(`${fn} needs a number for ${label}.`);
    }
    if (!isFiniteNumber(v)) {
      throw new Error(`${fn}'s ${label} has to be a number, and you gave it ${describe2(v)}.`);
    }
    return v;
  }
  function optionalNumber(fn, label, v) {
    if (v === void 0)
      return void 0;
    if (!isFiniteNumber(v)) {
      throw new Error(`${fn}'s ${label} has to be a number, and you gave it ${describe2(v)}.`);
    }
    return v;
  }
  function sweepAngle(fn, v) {
    const val = unwrap(v);
    if (!(val > 0 && val <= 360)) {
      throw new Error(`${fn}(): the angle is how far the sketch turns, more than 0 and at most 360 degrees -- got ${val}. A negative angle or one past a full turn is not a turn this kernel builds.`);
    }
  }
  var MAX_SPIN_DEGREES = 720;
  function spinAngle(v) {
    const val = unwrap(v);
    if (val === 0) {
      throw new Error(`spin(): the angle is how far the sketch turns, and 0 degrees turns it nowhere -- got ${val}. Use a turn from 1 to 360 degrees (a negative one turns the other way).`);
    }
    if (!(Math.abs(val) <= MAX_SPIN_DEGREES)) {
      throw new Error(`spin(): the angle is how far the sketch turns, and ${val} degrees is more than ${MAX_SPIN_DEGREES} -- got ${val}. Use a turn of at most 360 degrees (a negative one turns the other way).`);
    }
  }
  function cutDepth(fn, v) {
    const val = unwrap(v);
    if (!(val > 0)) {
      throw new Error(`${fn}(): the depth is how far the cut goes into the material, so it has to be a positive number -- got ${val}.`);
    }
  }
  function positiveNumber(fn, label, v) {
    const n = requiredNumber(fn, label, v);
    const val = unwrap(n);
    if (!(val > 0)) {
      throw new Error(`${fn}(): a size has to be a positive number -- got ${val} for ${label}.`);
    }
    return n;
  }
  function wholeNumberAtLeastOne(fn, label, v) {
    const n = requiredNumber(fn, label, v);
    const val = unwrap(n);
    if (!(val >= 1) || !Number.isInteger(val)) {
      throw new Error(`${fn}(): ${label} has to be a whole number of at least 1 -- got ${val}.`);
    }
    return n;
  }
  function wholeIndex(fn, label, v, count) {
    const n = requiredNumber(fn, label, v);
    const val = unwrap(n);
    if (!Number.isInteger(val) || val < 1 || val > count) {
      throw new Error(`${fn}'s ${label} has to be a whole number from 1 to ${count} -- you gave it ${val}.`);
    }
    return val - 1;
  }
  function cornerIndex(fn, v, count) {
    const val = unwrap(requiredNumber(fn, "corner", v));
    if (!Number.isInteger(val) || val < 1 || count > 0 && val > count) {
      throw new Error(`${fn}'s corner has to be a whole number from 1${count > 0 ? ` to ${count}` : ""} (corner 1 is the first corner) -- you gave it ${val}.`);
    }
    return val - 1;
  }
  var PlaneValue = class {
    datumId;
    plane;
    offset;
    frame;
    constructor(datumId, plane, offset, frame) {
      this.datumId = datumId;
      this.plane = plane;
      this.offset = offset;
      this.frame = frame;
    }
  };
  function isPlainOptions(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Number) && !isTopoRef(v) && !isHandle(v);
  }
  function readOptions(fn, allowed, given) {
    if (given === void 0)
      return {};
    if (!isPlainOptions(given)) {
      throw new Error(`${fn}'s extras go in a { } object at the end, like ${fn}(..., { ${allowed[0]}: ... }). You gave it ${describe2(given)}.`);
    }
    const out = {};
    for (const key of Object.keys(given)) {
      if (!allowed.includes(key)) {
        throw new Error(`${fn} has no option called "${key}". It takes ${allowed.join(", ")}.`);
      }
      out[key] = given[key];
    }
    return out;
  }
  function readVec3(fn, label, v) {
    if (!Array.isArray(v) || v.length !== 3) {
      throw new Error(`${fn}'s ${label} needs three numbers, like [x, y, z]. You gave it ${describe2(v)}.`);
    }
    return [
      requiredNumber(fn, `${label} x`, v[0]),
      requiredNumber(fn, `${label} y`, v[1]),
      requiredNumber(fn, `${label} z`, v[2])
    ];
  }
  var FACE_PARTS = {
    top: "+z",
    bottom: "-z",
    front: "-y",
    back: "+y",
    left: "-x",
    right: "+x"
  };
  var FACE_AXIS = {
    top: "z",
    bottom: "z",
    front: "y",
    back: "y",
    left: "x",
    right: "x"
  };
  function facePart(fn, word, allowSide) {
    if (typeof word !== "string") {
      throw new Error(`${fn} needs a face word (top, bottom, front, back, left, right${allowSide ? ", or side" : ""}), and you gave it ${describe2(word)}.`);
    }
    if (word === "side") {
      if (!allowSide)
        throw new Error(`${fn}: "side" is the curved wall of a cylinder, not a flat face here.`);
      return "side";
    }
    const part = FACE_PARTS[word];
    if (!part) {
      throw new Error(`${fn} does not know the face "${word}". Faces are named top, bottom, front, back, left, right` + (allowSide ? ", or side (a cylinder's curved wall)" : "") + ".");
    }
    return part;
  }
  function isHandle(v) {
    return !!v && typeof v === "object" && v.__reshapeHandle === true;
  }
  function isTopoRef(v) {
    return !!v && typeof v === "object" && v.__reshapeTopoRef === true;
  }
  function isSketchHandle(v) {
    return !!v && typeof v === "object" && v.__reshapeSketch === true;
  }
  function rootKindOf(kind) {
    return kind === "box" ? "box" : kind === "cylinder" ? "cylinder" : "other";
  }
  function runScript(source, opts = {}) {
    let features = [];
    const namedParams = /* @__PURE__ */ new Map();
    const slotOverrides = /* @__PURE__ */ new Map();
    const usedParamNames = /* @__PURE__ */ new Set();
    const ruleWarnings = [];
    const docNow = () => ({ version: 1, features });
    function num2(v, id, slot) {
      const name = paramNameOf(v);
      if (name)
        slotOverrides.set(pname(id, slot), name);
      return unwrap(v);
    }
    function pushFeature(f) {
      features = [...features, f];
      return f;
    }
    function replaceFeature(id, next) {
      features = features.map((f) => f.id === id ? next : f);
    }
    function findFeature(id) {
      const f = features.find((x) => x.id === id);
      if (!f)
        throw new Error(`internal: feature "${id}" is missing from the document.`);
      return f;
    }
    function cutOfTool(toolId) {
      const c = features.find((x) => x.kind === "combine" && x.op === "subtract" && x.targets.length === 2 && x.targets[1] === toolId);
      if (!c)
        throw new Error(".edge() with a wall needs a wall of a pocket.");
      return c;
    }
    function pocketCutOf(skId) {
      const p = features.find((x) => x.kind === "pocket" && x.target === skId);
      if (p) {
        if (slotOverrides.has(pname(p.id, "depth"))) {
          throw new Error("A pocket whose depth is a param() cannot have its walls named yet -- give pocket() a plain number for the depth, or cut it as subtract(shape, pull(sketch, -depth)).");
        }
        if (p.midplane || p.length2 !== void 0 || p.reversed || p.through || p.taper || p.direction) {
          throw new Error("A pocket with a direction option (through, reversed, midplane, length2, taper, direction) cannot have its walls named yet -- name the walls of a plain one-sided pocket.");
        }
        const tool2 = { ...newExtrude(docNow(), skId), height: -p.depth };
        const cutF = { id: p.id, kind: "combine", op: "subtract", targets: [p.into, tool2.id] };
        if (p.name !== void 0)
          cutF.name = p.name;
        features = features.flatMap((x) => x.id === p.id ? [tool2, cutF] : [x]);
        return { toolId: tool2.id, cutId: cutF.id };
      }
      const tool = features.find((x) => x.kind === "extrude" && x.target === skId && x.height < 0);
      const c = tool && features.find((x) => x.kind === "combine" && x.op === "subtract" && x.targets.length === 2 && x.targets[1] === tool.id);
      return tool && c ? { toolId: tool.id, cutId: c.id } : null;
    }
    function makeSolidHandle(f, rootId = f.id) {
      const handle = {
        __reshapeHandle: true,
        id: f.id,
        rootId,
        rootKind: rootKindOf(findFeature(rootId).kind),
        kind: f.kind,
        face(word) {
          const allowSide = handle.rootKind === "cylinder";
          const part = facePart(".face()", word, allowSide);
          return {
            __reshapeTopoRef: true,
            owner: handle,
            name: { cause: "primitive", feature: handle.rootId, kind: "face", part }
          };
        },
        edge(a, b) {
          const allowSide = handle.rootKind === "cylinder";
          const wallA = isTopoRef(a) && a.name.cause === "swept";
          const wallB = isTopoRef(b) && b.name.cause === "swept";
          if (isTopoRef(a) && !wallA || isTopoRef(b) && !wallB) {
            throw new Error(".edge() takes a face word (top, front, ...) or a pocket wall from .wall(sketch, n).");
          }
          if (wallA && wallB) {
            const [na, nb] = [a, b].map((r) => r.name);
            if (na.feature === nb.feature && na.from === nb.from && na.edge === nb.edge) {
              throw new Error(".edge() needs two DIFFERENT faces to name the edge between them.");
            }
            return { __reshapeTopoRef: true, owner: handle, name: { cause: "between", feature: cutOfTool(na.feature).id, kind: "edge", of: [na, nb] } };
          }
          if (wallA || wallB) {
            const w = wallA ? a : b;
            const word = wallA ? b : a;
            const wn = w.name;
            const cutF = cutOfTool(wn.feature);
            const part = facePart(".edge()", word, false);
            const plateFace = {
              cause: "carried",
              feature: cutF.id,
              kind: "face",
              of: { cause: "primitive", feature: cutF.targets[0], kind: "face", part }
            };
            return { __reshapeTopoRef: true, owner: handle, name: { cause: "between", feature: cutF.id, kind: "edge", of: [plateFace, wn] } };
          }
          const pa = facePart(".edge()", a, allowSide);
          const pb = facePart(".edge()", b, allowSide);
          if (pa === pb)
            throw new Error(".edge() needs two DIFFERENT faces to name the edge between them.");
          return {
            __reshapeTopoRef: true,
            owner: handle,
            name: {
              cause: "between",
              feature: handle.rootId,
              kind: "edge",
              of: [
                { cause: "primitive", feature: handle.rootId, kind: "face", part: pa },
                { cause: "primitive", feature: handle.rootId, kind: "face", part: pb }
              ]
            }
          };
        },
        wall(sk, n) {
          if (!isSketchHandle(sk))
            throw new Error(".wall() needs the sketch the pocket was cut from: part.wall(sketch2, 1).");
          const skF = features.find((x) => x.id === sk.id);
          const cutIds = skF && skF.kind === "sketch" ? pocketCutOf(sk.id) : null;
          if (!cutIds || !skF || skF.kind !== "sketch") {
            throw new Error(".wall() names a face a pocket cut, and no pocket(...) was cut from that sketch.");
          }
          const sides = skF.shape === "circle" ? 1 : skF.points.length;
          const k = unwrap(n);
          if (!Number.isInteger(k) || k < 1 || k > sides) {
            throw new Error(`.wall() needs a side number from 1 to ${sides} (the sketch has ${sides}), and you gave it ${describe2(n)}.`);
          }
          return {
            __reshapeTopoRef: true,
            owner: handle,
            name: { cause: "swept", feature: cutIds.toolId, kind: "face", from: sk.id, edge: k - 1 }
          };
        },
        rim(sk) {
          if (!isSketchHandle(sk))
            throw new Error(".rim() needs the sketch the pocket was cut from: part.rim(sketch2).");
          const skF = features.find((x) => x.id === sk.id);
          if (!skF || skF.kind !== "sketch")
            throw new Error(".rim() needs the sketch the pocket was cut from.");
          if (skF.plane !== "xy" || skF.frame) {
            throw new Error(".rim() finds the opening of a pocket cut down from a top-plane sketch; for another pocket name its edges one at a time with .edge(face, part.wall(sketch, n)).");
          }
          const sides = skF.shape === "circle" ? 1 : skF.points.length;
          const out = [];
          for (let i = 1; i <= sides; i++)
            out.push(handle.edge("top", handle.wall(sk, i)));
          return out;
        }
      };
      return handle;
    }
    function mutateHandle(handle, next) {
      handle.id = next.id;
      handle.kind = next.kind;
    }
    function placePrimitive(fn, kind, argNames, args, opts2, setDims) {
      for (let i = 0; i < argNames.length; i++)
        positiveNumber(fn, argNames[i], args[i]);
      const allowCorner = kind === "box" || kind === "cylinder";
      const extra = readOptions(fn, allowCorner ? ["at", "corner"] : ["at"], opts2);
      const base = newShape(docNow(), kind);
      const id = base.id;
      setDims(base, id);
      if (extra.at !== void 0) {
        const at = readVec3(fn, "at", extra.at);
        base.center = [
          num2(at[0], id, "x"),
          num2(at[1], id, "y"),
          num2(at[2], id, "z")
        ];
      }
      if (allowCorner && extra.corner !== void 0) {
        const c = positiveNumber(fn, "corner", extra.corner);
        base.round = num2(c, id, "round");
      }
      pushFeature(base);
      return makeSolidHandle(base);
    }
    function box(w, d, h, opts2) {
      return placePrimitive("box", "box", ["width", "depth", "height"], [w, d, h], opts2, (f, id) => {
        f.size = [num2(w, id, "width"), num2(d, id, "depth"), num2(h, id, "height")];
      });
    }
    function cylinder(across, tall, opts2) {
      return placePrimitive("cylinder", "cylinder", ["across", "tall"], [across, tall], opts2, (f, id) => {
        const cf = f;
        cf.radius = num2(across, id, "radius") / 2;
        cf.height = num2(tall, id, "height");
      });
    }
    function sphere(across, opts2) {
      return placePrimitive("sphere", "sphere", ["across"], [across], opts2, (f, id) => {
        f.radius = num2(across, id, "radius") / 2;
      });
    }
    function cone(across, tall, opts2) {
      return placePrimitive("cone", "cone", ["across", "tall"], [across, tall], opts2, (f, id) => {
        const cf = f;
        cf.radius = num2(across, id, "radius") / 2;
        cf.height = num2(tall, id, "height");
      });
    }
    function ring(across, tubeAcross, opts2) {
      return placePrimitive("ring", "torus", ["across", "tubeAcross"], [across, tubeAcross], opts2, (f, id) => {
        const tf = f;
        const a = unwrap(across);
        const t = unwrap(tubeAcross);
        tf.tubeRadius = t / 2;
        tf.ringRadius = (a - t) / 2;
      });
    }
    function prism(sides, across, tall, opts2) {
      return placePrimitive("prism", "prism", ["sides", "across", "tall"], [sides, across, tall], opts2, (f, id) => {
        const pf = f;
        const n = Math.round(unwrap(sides));
        if (!(n >= 3 && n <= 12))
          throw new Error("prism() needs 3 to 12 sides.");
        pf.sides = n;
        pf.radius = num2(across, id, "radius") / 2;
        pf.height = num2(tall, id, "height");
      });
    }
    function wedge(width, depth, tall, opts2) {
      return placePrimitive("wedge", "wedge", ["width", "depth", "height"], [width, depth, tall], opts2, (f, id) => {
        const wf = f;
        wf.width = num2(width, id, "width");
        wf.depth = num2(depth, id, "depth");
        wf.height = num2(tall, id, "height");
      });
    }
    function noExtraArgs(word, takes, max, extra, hint = "") {
      if (extra.length === 0)
        return;
      const ord = ["first", "second", "third", "fourth", "fifth", "sixth"];
      const n = max + 1;
      const which = ord[n - 1] ?? `${n}th`;
      throw new Error(`${word}() takes ${takes}; the ${which} argument (${describe2(extra[0])}) was ignored.${hint ? " " + hint : ""}`);
    }
    function groove(sk, target, angle, ...extra) {
      noExtraArgs("groove", "a sketch, a shape and an angle", 3, extra);
      if (!isSketchHandle(sk))
        throw new Error("groove() needs a sketch: groove(sketch1, shape, angle).");
      if (!isHandle(target))
        throw new Error("groove() needs a shape to cut: groove(sketch1, shape, angle).");
      requiredNumber("groove", "angle", angle);
      sweepAngle("groove", angle);
      const f = newGroove(docNow(), sk.id, target.id);
      f.angle = num2(angle, f.id, "angle");
      pushFeature(f);
      return makeSolidHandle(f);
    }
    function pocket(sk, target, depth, opts2, ...extra) {
      const known = opts2 !== void 0 && isPlainOptions(opts2) && Object.keys(opts2).every((k) => ["through", "reversed", "midplane", "length2", "taper", "direction", "alongNormal"].includes(k));
      if (known)
        noExtraArgs("pocket", "a sketch, a shape and a depth", 4, extra);
      else
        noExtraArgs("pocket", "a sketch, a shape and a depth", 3, opts2 === void 0 ? extra : [opts2, ...extra]);
      if (!isSketchHandle(sk))
        throw new Error("pocket() needs a sketch: pocket(sketch1, shape, depth).");
      if (!isHandle(target))
        throw new Error("pocket() needs a shape to cut: pocket(sketch1, shape, depth).");
      requiredNumber("pocket", "depth", depth);
      cutDepth("pocket", depth);
      const dir = readDirection("pocket", opts2, true);
      const f = newPocket(docNow(), sk.id, target.id);
      f.depth = num2(depth, f.id, "depth");
      Object.assign(f, dir);
      pushFeature(f);
      return makeSolidHandle(f);
    }
    const PLANE_WORD = { top: "xy", front: "xz", side: "yz" };
    const FRAME_TOL = 1e-6;
    function readFrame(given, fn = "sketch") {
      const o = readOptions(fn, ["origin", "u", "v"], given);
      for (const k of ["origin", "u", "v"]) {
        if (o[k] === void 0) {
          throw new Error(`${fn}({ ... }) needs origin, u and v: ${fn}({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }). It is missing ${k}.`);
        }
      }
      const vec = (label) => {
        const raw = readVec3(fn, label, o[label]).map((n) => unwrap(n));
        if (!raw.every((n) => Number.isFinite(n))) {
          throw new Error(`${fn}()'s ${label} needs three finite numbers, like [x, y, z].`);
        }
        return raw;
      };
      const origin = vec("origin");
      const u = vec("u");
      const v = vec("v");
      const len = (a) => Math.hypot(a[0], a[1], a[2]);
      for (const [label, a] of [["u", u], ["v", v]]) {
        if (Math.abs(len(a) - 1) > FRAME_TOL) {
          throw new Error(`${fn}()'s ${label} has to be a unit-length direction (its length is ${len(a)}, not 1). Divide it by its length -- sketches are never silently rescaled.`);
        }
      }
      const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      if (Math.abs(dot) > FRAME_TOL) {
        throw new Error(`${fn}()'s u and v have to be at right angles to each other (their dot product is ${dot}, not 0).`);
      }
      return { origin, u, v };
    }
    function plane(spec, offset) {
      if (isPlainOptions(spec) && !(spec instanceof PlaneValue)) {
        if (offset !== void 0) {
          throw new Error("plane({ origin, u, v }) takes no offset: the origin already says where the plane sits.");
        }
        const frame = readFrame(spec, "plane");
        const d2 = newDatum(docNow());
        d2.frame = frame;
        pushFeature(d2);
        return new PlaneValue(d2.id, null, 0, frame);
      }
      if (typeof spec !== "string" || !(spec in PLANE_WORD)) {
        throw new Error(`plane() needs a plane word: 'top', 'front' or 'side' (or a frame { origin, u, v }). You gave it ${describe2(spec)}.`);
      }
      const d = newDatum(docNow());
      d.plane = PLANE_WORD[spec];
      d.offset = offset === void 0 ? 0 : num2(requiredNumber("plane", "offset", offset), d.id, "offset");
      pushFeature(d);
      return new PlaneValue(d.id, d.plane, d.offset, null);
    }
    function sketch(planeWord, offset, ...extra) {
      noExtraArgs("sketch", "a plane and an optional offset", 2, extra);
      if (planeWord instanceof PlaneValue) {
        if (offset !== void 0) {
          throw new Error("sketch(plane(...)) takes no offset: give the offset to plane(), like plane('top', 10).");
        }
        const f2 = planeWord.frame ? newSketchOnFace(docNow(), { origin: [...planeWord.frame.origin], u: [...planeWord.frame.u], v: [...planeWord.frame.v] }) : newSketch(docNow(), planeWord.plane);
        if (!planeWord.frame)
          f2.offset = planeWord.offset ?? 0;
        f2.onDatum = planeWord.datumId;
        pushFeature(f2);
        return makeSketchHandle(f2.id);
      }
      if (isPlainOptions(planeWord)) {
        if (offset !== void 0) {
          throw new Error("sketch({ origin, u, v }) takes no offset: the origin already says where the plane sits.");
        }
        const f2 = newSketchOnFace(docNow(), readFrame(planeWord));
        pushFeature(f2);
        return makeSketchHandle(f2.id);
      }
      if (typeof planeWord !== "string" || !(planeWord in PLANE_WORD)) {
        throw new Error(`sketch() needs a plane word: 'top', 'front' or 'side' (or a frame { origin, u, v }). You gave it ${describe2(planeWord)}.`);
      }
      const plane2 = PLANE_WORD[planeWord];
      const f = newSketch(docNow(), plane2);
      if (offset !== void 0)
        f.offset = num2(requiredNumber("sketch", "offset", offset), f.id, "offset");
      pushFeature(f);
      return makeSketchHandle(f.id);
    }
    function sameConstraint(a, b) {
      if (a.kind !== b.kind)
        return false;
      if (a.kind === "lock" && b.kind === "lock")
        return a.corner === b.corner;
      if (a.kind === "length" && b.kind === "length")
        return a.edge === b.edge && a.value === b.value;
      if ((a.kind === "horizontal" || a.kind === "vertical") && "edge" in b)
        return a.edge === b.edge;
      if (a.kind === "distanceX" && b.kind === "distanceX") {
        return a.a === b.a && a.b === b.b && a.value === b.value;
      }
      if (a.kind === "distanceY" && b.kind === "distanceY") {
        return a.a === b.a && a.b === b.b && a.value === b.value;
      }
      if (a.kind === "symmetric" && b.kind === "symmetric") {
        return a.a === b.a && a.b === b.b && a.center === b.center;
      }
      if (a.kind === "angle" && b.kind === "angle") {
        return a.edge === b.edge && a.other === b.other && a.degrees === b.degrees;
      }
      if ("other" in a && "other" in b)
        return a.edge === b.edge && a.other === b.other;
      return false;
    }
    function isPairOn(c, edge, other) {
      return (c.kind === "equal" || c.kind === "parallel" || c.kind === "perpendicular") && c.edge === edge && c.other === other;
    }
    function applyConstraint(sketchId, added) {
      const cur = findFeature(sketchId);
      const existing = cur.constraints ?? [];
      if (existing.some((c) => sameConstraint(c, added)))
        return;
      let base = existing;
      if (added.kind === "horizontal" || added.kind === "vertical") {
        const opposite = added.kind === "horizontal" ? "vertical" : "horizontal";
        base = base.filter((c) => !(c.kind === opposite && "edge" in c && c.edge === added.edge));
      } else if (added.kind === "equal" || added.kind === "parallel" || added.kind === "perpendicular") {
        base = base.filter((c) => !isPairOn(c, added.edge, added.other));
      }
      const next = [...base, added];
      const points = cur.points.map((p) => [p[0], p[1]]);
      const result = addConstraintSettling(points, next);
      replaceFeature(sketchId, { ...cur, constraints: result.constraints });
      if (result.removed === null) {
        const seed = seedForNewRule(points, result.constraints);
        const solved = solveSketch(seed, result.constraints);
        if (solved.overConstrained || collapsedByRatio(points, solved.points)) {
          ruleWarnings.push(`${describe(added)} cannot hold along with the rules already on this sketch -- the shape is as close as it can get to all of them. Remove one to settle it.`);
        }
      }
    }
    const GEOM_SHAPES = {
      point: ["id", "p"],
      line: ["id", "a", "b"],
      circle: ["id", "c", "r"],
      arc: ["id", "c", "r", "a", "b", "sense"]
    };
    const GEOM_KEYS = /* @__PURE__ */ new Set(["k", ...Object.values(GEOM_SHAPES).flat(), "construction"]);
    function readVec2(where, what, v) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && Number.isFinite(v[0]) && typeof v[1] === "number" && Number.isFinite(v[1])) {
        return [v[0], v[1]];
      }
      throw new Error(`${where} needs ${what} as [u, v], got ${describe2(v)}.`);
    }
    function readSoupGeom(where, v) {
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        throw new Error(`${where} needs geometry row objects like { k: 'line', id: 1, a: [0, 0], b: [40, 0] }, got ${describe2(v)}.`);
      }
      const o = v;
      const k = o.k;
      const shape = typeof k === "string" ? GEOM_SHAPES[k] : void 0;
      if (!shape) {
        throw new Error(`${where} row k must be one of point, line, circle, arc; got ${describe2(k)}.`);
      }
      if (typeof o.id !== "number" || !Number.isInteger(o.id) || o.id <= 0) {
        throw new Error(`${where} row id must be a positive whole number, got ${describe2(o.id)}.`);
      }
      for (const field of shape) {
        if (o[field] === void 0) {
          throw new Error(`${where} row ${k} needs a ${field}.`);
        }
      }
      if (k === "point") {
        return { k, id: o.id, p: readVec2(where, "p", o.p), ...o.construction === true ? { construction: true } : {} };
      }
      if (k === "line") {
        return {
          k,
          id: o.id,
          a: readVec2(where, "a", o.a),
          b: readVec2(where, "b", o.b),
          ...o.construction === true ? { construction: true } : {}
        };
      }
      const r = o.r;
      if (r instanceof ParamNumber) {
      } else if (typeof r !== "number" || !(r > 0)) {
        throw new Error(`${where} row ${k} needs a positive radius r, got ${describe2(r)}.`);
      }
      if (k === "circle") {
        return { k, id: o.id, c: readVec2(where, "c", o.c), r, ...o.construction === true ? { construction: true } : {} };
      }
      const sense = o.sense;
      if (sense !== "ccw" && sense !== "cw") {
        throw new Error(`${where} row arc needs sense 'ccw' or 'cw', got ${describe2(sense)}.`);
      }
      return {
        k: "arc",
        id: o.id,
        c: readVec2(where, "c", o.c),
        r,
        a: readVec2(where, "a", o.a),
        b: readVec2(where, "b", o.b),
        sense,
        ...o.construction === true ? { construction: true } : {}
      };
    }
    const RULE_SHAPES = {
      coincident: ["a", "b"],
      pointOnObject: ["a", "b"],
      horizontal: ["a"],
      vertical: ["a"],
      parallel: ["a", "b"],
      perpendicular: ["a", "b"],
      tangent: ["a", "b"],
      equal: ["a", "b"],
      symmetric: ["a", "b", "c"],
      distance: ["a", "b", "value"],
      distanceX: ["a", "b", "value"],
      distanceY: ["a", "b", "value"],
      radius: ["a", "value"],
      diameter: ["a", "value"],
      angle: ["a", "b", "value"],
      lock: ["a"]
    };
    function readSoupRule(where, v) {
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        throw new Error(`${where} needs constraint row objects like { k: 'tangent', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, got ${describe2(v)}.`);
      }
      const o = v;
      const k = o.k;
      const fields = typeof k === "string" ? RULE_SHAPES[k] : void 0;
      if (!fields) {
        throw new Error(`${where} row k must be one of the 16 constraint kinds, got ${describe2(k)}.`);
      }
      for (const field of fields) {
        if (o[field] === void 0) {
          throw new Error(`${where} row ${k} needs a ${field}.`);
        }
      }
      for (const gref of ["a", "b", "c"]) {
        if (o[gref] !== void 0) {
          if (typeof o[gref] !== "number" || !Number.isInteger(o[gref])) {
            throw new Error(`${where} row ${k} names geometry by whole id, got ${describe2(o[gref])}.`);
          }
        }
      }
      if (o.value !== void 0) {
        if (typeof o.value !== "number" && !(o.value instanceof ParamNumber)) {
          throw new Error(`${where} row ${k} needs a number (or a param()) as value, got ${describe2(o.value)}.`);
        }
      }
      return o;
    }
    function makeSketchHandle(id) {
      let outline = null;
      const starter = findFeature(id).points.map((p) => [p[0], p[1]]);
      const hasRows = () => {
        const c = findFeature(id);
        return Array.isArray(c.geoms) && c.geoms.length > 0;
      };
      const boundSlot = () => {
        for (const k of slotOverrides.keys())
          if (k.startsWith(`${id}_`))
            return true;
        return false;
      };
      const RULED = "a sketch of several shapes keeps its sizes as plain numbers, so a param() cannot drive one of them. Give the number itself, or draw this shape on its own sketch().";
      const noParam = (call, ...vals) => {
        if (vals.some((v) => v instanceof ParamNumber)) {
          throw new Error(`${call} is not the only shape on this sketch, and ${RULED}`);
        }
      };
      const rectRows = (base, x0, y0, x1, y1) => {
        const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        const geoms = p.map((a, i) => ({ k: "line", id: base + i, a, b: p[(i + 1) % 4] }));
        const rules = [0, 1, 2, 3].map((i) => ({ k: "coincident", a: base + i, aEnd: "b", b: base + (i + 1) % 4, bEnd: "a" }));
        rules.push({ k: "horizontal", a: base }, { k: "vertical", a: base + 1 }, { k: "horizontal", a: base + 2 }, { k: "vertical", a: base + 3 });
        return { geoms, rules };
      };
      const polyRows = (base, p) => {
        const n = p.length;
        const geoms = p.map((a, i) => ({ k: "line", id: base + i, a, b: p[(i + 1) % n] }));
        const rules = p.map((_, i) => ({ k: "coincident", a: base + i, aEnd: "b", b: base + (i + 1) % n, bEnd: "a" }));
        return { geoms, rules };
      };
      const priorRows = (call) => {
        const cur = findFeature(id);
        if (hasRows()) {
          outline = outline ?? "rows";
          return { geoms: cur.geoms.slice(), rules: (cur.rules ?? []).slice() };
        }
        if (outline === null)
          return null;
        if (boundSlot()) {
          throw new Error(`${call} would be the second shape on this sketch, and the first one is driven by a param(), which ${RULED}`);
        }
        if (cur.rounds && Object.keys(cur.rounds).length || cur.chamfers && Object.keys(cur.chamfers).length || cur.bulges && Object.keys(cur.bulges).length) {
          throw new Error(`${call} would be the second shape on this sketch, and the first has rounded or chamfered corners, which a sketch of several shapes cannot carry. Draw each shape on its own sketch(), or write the rounded shape as sk.geom([...]) rows.`);
        }
        const hand = (cur.constraints ?? []).length > 0 && JSON.stringify(cur.constraints) !== JSON.stringify(RECTANGLE_CONSTRAINTS);
        if (hand) {
          throw new Error(`${call} would be the second shape on this sketch, and the first carries rules of its own (across, up, length and the like), which a sketch of several shapes cannot keep. Draw each shape on its own sketch(), or write the rules as sk.rules([...]) rows.`);
        }
        if (cur.shape === "circle" && cur.points.length === 2) {
          const [a, b] = cur.points;
          return {
            geoms: [{ k: "circle", id: 1, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 }],
            rules: []
          };
        }
        const pts = cur.points.map((p) => [p[0], p[1]]);
        const isRect = JSON.stringify(cur.constraints ?? []) === JSON.stringify(RECTANGLE_CONSTRAINTS) && pts.length === 4;
        if (isRect)
          return rectRows(1, pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
        return polyRows(1, pts);
      };
      const putRows = (prior, added, call) => {
        const cur = findFeature(id);
        const geoms = [...prior.geoms, ...added.geoms];
        replaceFeature(id, {
          ...cur,
          points: starter.map((p) => [p[0], p[1]]),
          // what sketch() hands sk.geom() as well, so the document is the one sk.geom([...]) would have written
          shape: void 0,
          rounds: void 0,
          chamfers: void 0,
          bulges: void 0,
          constraints: RECTANGLE_CONSTRAINTS.slice(),
          geoms,
          geom: geoms,
          rules: [...prior.rules, ...added.rules]
        });
        outline = call.replace(/\(\)$/, "").replace(/^\./, "");
      };
      const needOutline = (call) => {
        if (hasRows()) {
          throw new Error(`${call} names a corner or an edge by number, and this sketch is drawn as rows (sk.geom, a slot, or several shapes). Say it with sk.rules([...]) rows instead.`);
        }
      };
      const handle = {
        __reshapeSketch: true,
        id,
        rect(w, h, opts2) {
          requiredNumber(".rect()", "width", w);
          requiredNumber(".rect()", "height", h);
          const extra = readOptions(".rect()", ["at"], opts2);
          const [ax, ay] = extra.at !== void 0 ? readVec2(".rect()", "at", extra.at) : [0, 0];
          const prior = priorRows(".rect()");
          if (prior) {
            noParam(".rect()", w, h);
            const ww2 = unwrap(w), hh2 = unwrap(h);
            if (!(ww2 > 0) || !(hh2 > 0))
              throw new Error(`.rect() needs a width and a height above 0. You gave ${ww2} by ${hh2}.`);
            const base = prior.geoms.length + 1;
            putRows(prior, rectRows(base, ax - ww2 / 2, ay - hh2 / 2, ax + ww2 / 2, ay + hh2 / 2), ".rect()");
            return handle;
          }
          outline = "rect";
          const ww = num2(w, id, "width");
          const hh = num2(h, id, "height");
          const points = [
            [ax - ww / 2, ay - hh / 2],
            [ax + ww / 2, ay - hh / 2],
            [ax + ww / 2, ay + hh / 2],
            [ax - ww / 2, ay + hh / 2]
          ];
          const cur = findFeature(id);
          replaceFeature(id, {
            ...cur,
            points,
            shape: void 0,
            rounds: void 0,
            chamfers: void 0,
            bulges: void 0,
            constraints: RECTANGLE_CONSTRAINTS.slice()
          });
          return handle;
        },
        circle(d, opts2) {
          requiredNumber(".circle()", "across", d);
          const extra = readOptions(".circle()", ["at"], opts2);
          const [ax, ay] = extra.at !== void 0 ? readVec2(".circle()", "at", extra.at) : [0, 0];
          const prior = priorRows(".circle()");
          if (prior) {
            noParam(".circle()", d);
            const across = unwrap(d);
            if (!(across > 0))
              throw new Error(`.circle() needs an across above 0. You gave ${across}.`);
            const base = prior.geoms.length + 1;
            putRows(prior, { geoms: [{ k: "circle", id: base, c: [ax, ay], r: across / 2 }], rules: [] }, ".circle()");
            return handle;
          }
          outline = "circle";
          const r = num2(d, id, "across") / 2;
          const cur = findFeature(id);
          replaceFeature(id, {
            ...cur,
            points: [[ax - r, ay], [ax + r, ay]],
            shape: "circle",
            rounds: void 0,
            chamfers: void 0,
            bulges: void 0,
            // newCircleSketch() never carries a rule -- the Rules panel shows
            // only the plane row for a circle (no edges to rule). Explicit,
            // not inherited: `cur` may still be holding the rectangle set from
            // an earlier sketch('top') or .rect() on this same handle, and a
            // circle has no edge 0-3 for those to mean anything about.
            constraints: void 0
          });
          return handle;
        },
        polygon(pointsArg) {
          if (!Array.isArray(pointsArg) || pointsArg.length < 3) {
            throw new Error(`.polygon() needs a list of at least three [x, y] points. You gave it ${describe2(pointsArg)}.`);
          }
          const points = pointsArg.map((p, i) => {
            if (!Array.isArray(p) || p.length !== 2) {
              throw new Error(`.polygon()'s point ${i + 1} needs two numbers [x, y]. You gave it ${describe2(p)}.`);
            }
            return [requiredNumber(".polygon()", `point ${i + 1} x`, p[0]), requiredNumber(".polygon()", `point ${i + 1} y`, p[1])];
          });
          const prior = priorRows(".polygon()");
          if (prior) {
            noParam(".polygon()", ...pointsArg.flat());
            const plain = points.map((p) => [unwrap(p[0]), unwrap(p[1])]);
            putRows(prior, polyRows(prior.geoms.length + 1, plain), ".polygon()");
            return handle;
          }
          outline = "polygon";
          const cur = findFeature(id);
          replaceFeature(id, {
            ...cur,
            points,
            shape: void 0,
            rounds: void 0,
            chamfers: void 0,
            bulges: void 0,
            constraints: void 0
          });
          return handle;
        },
        round(corner, radius) {
          needOutline(".round()");
          const cur = findFeature(id);
          const k = cornerIndex(".round()", corner, cur.points?.length ?? 0);
          const r = requiredNumber(".round()", "radius", radius);
          const rounds = { ...cur.rounds ?? {}, [k]: num2(r, id, `r${k}`) };
          replaceFeature(id, { ...cur, rounds });
          return handle;
        },
        chamfer(corner, distance) {
          needOutline(".chamfer()");
          const cur = findFeature(id);
          const k = cornerIndex(".chamfer()", corner, cur.points?.length ?? 0);
          const dist = requiredNumber(".chamfer()", "distance", distance);
          const chamfers = { ...cur.chamfers ?? {}, [k]: dist };
          replaceFeature(id, { ...cur, chamfers });
          return handle;
        },
        across(edge) {
          needOutline(".across()");
          const cur = findFeature(id);
          const e = wholeIndex(".across()", "edge", edge, cur.points.length);
          applyConstraint(id, { kind: "horizontal", edge: e });
          return handle;
        },
        up(edge) {
          needOutline(".up()");
          const cur = findFeature(id);
          const e = wholeIndex(".up()", "edge", edge, cur.points.length);
          applyConstraint(id, { kind: "vertical", edge: e });
          return handle;
        },
        length(edge, value) {
          needOutline(".length()");
          const cur = findFeature(id);
          const e = wholeIndex(".length()", "edge", edge, cur.points.length);
          const v = positiveNumber(".length()", "value", value);
          applyConstraint(id, { kind: "length", edge: e, value: num2(v, id, `len${e}`) });
          return handle;
        },
        equal(edge, other) {
          needOutline(".equal()");
          const cur = findFeature(id);
          const count = cur.points.length;
          const a = wholeIndex(".equal()", "edge", edge, count);
          const b = wholeIndex(".equal()", "other", other, count);
          if (a === b)
            throw new Error(".equal() needs two DIFFERENT edges.");
          applyConstraint(id, { kind: "equal", edge: Math.min(a, b), other: Math.max(a, b) });
          return handle;
        },
        parallel(edge, other) {
          needOutline(".parallel()");
          const cur = findFeature(id);
          const count = cur.points.length;
          const a = wholeIndex(".parallel()", "edge", edge, count);
          const b = wholeIndex(".parallel()", "other", other, count);
          if (a === b)
            throw new Error(".parallel() needs two DIFFERENT edges.");
          applyConstraint(id, { kind: "parallel", edge: Math.min(a, b), other: Math.max(a, b) });
          return handle;
        },
        perpendicular(edge, other) {
          needOutline(".perpendicular()");
          const cur = findFeature(id);
          const count = cur.points.length;
          const a = wholeIndex(".perpendicular()", "edge", edge, count);
          const b = wholeIndex(".perpendicular()", "other", other, count);
          if (a === b)
            throw new Error(".perpendicular() needs two DIFFERENT edges.");
          applyConstraint(id, { kind: "perpendicular", edge: Math.min(a, b), other: Math.max(a, b) });
          return handle;
        },
        pin(corner) {
          needOutline(".pin()");
          const cur = findFeature(id);
          const c = wholeIndex(".pin()", "corner", corner, cur.points.length);
          applyConstraint(id, { kind: "lock", corner: c });
          return handle;
        },
        distX(a, b, value) {
          needOutline(".distX()");
          const cur = findFeature(id);
          const count = cur.points.length;
          const i = wholeIndex(".distX()", "corner", a, count);
          const j = wholeIndex(".distX()", "other", b, count);
          if (i === j)
            throw new Error(".distX() needs two DIFFERENT corners.");
          const v = requiredNumber(".distX()", "value", value);
          applyConstraint(id, {
            kind: "distanceX",
            a: Math.min(i, j),
            b: Math.max(i, j),
            value: num2(v, id, `dx${Math.min(i, j)}_${Math.max(i, j)}`)
          });
          return handle;
        },
        distY(a, b, value) {
          needOutline(".distY()");
          const cur = findFeature(id);
          const count = cur.points.length;
          const i = wholeIndex(".distY()", "corner", a, count);
          const j = wholeIndex(".distY()", "other", b, count);
          if (i === j)
            throw new Error(".distY() needs two DIFFERENT corners.");
          const v = requiredNumber(".distY()", "value", value);
          applyConstraint(id, {
            kind: "distanceY",
            a: Math.min(i, j),
            b: Math.max(i, j),
            value: num2(v, id, `dy${Math.min(i, j)}_${Math.max(i, j)}`)
          });
          return handle;
        },
        symmetric(a, b, center) {
          needOutline(".symmetric()");
          const cur = findFeature(id);
          const count = cur.points.length;
          const i = wholeIndex(".symmetric()", "corner", a, count);
          const j = wholeIndex(".symmetric()", "other", b, count);
          const k = wholeIndex(".symmetric()", "about corner", center, count);
          if (i === j)
            throw new Error(".symmetric() needs two DIFFERENT corners.");
          if (k === i || k === j) {
            throw new Error(".symmetric() needs the about corner to be a THIRD corner.");
          }
          applyConstraint(id, {
            kind: "symmetric",
            a: Math.min(i, j),
            b: Math.max(i, j),
            center: k
          });
          return handle;
        },
        angle(edge, other, degrees) {
          needOutline(".angle()");
          const cur = findFeature(id);
          const count = cur.points.length;
          const i = wholeIndex(".angle()", "edge", edge, count);
          const j = wholeIndex(".angle()", "other", other, count);
          if (i === j)
            throw new Error(".angle() needs two DIFFERENT edges.");
          const v = requiredNumber(".angle()", "degrees", degrees);
          applyConstraint(id, {
            kind: "angle",
            edge: Math.min(i, j),
            other: Math.max(i, j),
            degrees: num2(v, id, `ang${Math.min(i, j)}_${Math.max(i, j)}`)
          });
          return handle;
        },
        geom(rows) {
          if (!Array.isArray(rows))
            throw new Error(".geom() needs an array of geometry rows.");
          if (outline !== null && !hasRows()) {
            throw new Error(`.geom() would replace the ${outline} already drawn on this sketch. Put every shape in the .geom([...]) rows, or draw a second shape with .rect() / .circle() / .polygon(), which adds it beside the first.`);
          }
          const cur = findFeature(id);
          const out = [];
          rows.forEach((row, i) => {
            const g = readSoupGeom(".geom()", row);
            if (g.k === "circle") {
              num2(g.r, id, `g${g.id}r`);
              g.r = unwrap(g.r);
            }
            if (g.k === "arc") {
              num2(g.r, id, `g${g.id}r`);
              g.r = unwrap(g.r);
            }
            if (g.id !== i + 1) {
              throw new Error(`.geom() row ${i + 1} says id ${g.id} but sits at position ${i + 1}. Soup ids are sketch-local and dense: row ` + (i + 1) + " carries id " + (i + 1) + ".");
            }
            out.push(g);
          });
          replaceFeature(id, { ...cur, geoms: out, geom: out });
          return handle;
        },
        rules(rows) {
          if (!Array.isArray(rows))
            throw new Error(".rules() needs an array of constraint rows.");
          const cur = findFeature(id);
          const geoms = cur.geoms ?? cur.geom ?? [];
          const kindOf = /* @__PURE__ */ new Map();
          for (const g of geoms)
            kindOf.set(g.id, g.k);
          const builtinKind = (gid) => {
            if (gid === -1)
              return "point";
            if (gid === -2 || gid === -3)
              return "line";
            return null;
          };
          const out = [];
          rows.forEach((row, i) => {
            const r = readSoupRule(".rules()", row);
            const check = (gref, end) => {
              if (end === void 0 || end === null)
                return;
              const kind = builtinKind(gref) ?? kindOf.get(gref);
              if (!kind) {
                throw new Error(`.rules() row ${i + 1} names geometry ${gref}, which this sketch does not have.`);
              }
              const valid = kind === "point" && end === "a" || kind === "line" && (end === "a" || end === "b") || kind === "circle" && end === "c" || kind === "arc";
              if (!valid) {
                throw new Error(`.rules() row ${i + 1} names point '${end}' on geometry ${gref}, but a ${kind} has no '${end}'.`);
              }
            };
            const rr = r;
            if (rr.a !== void 0)
              check(rr.a, rr.aEnd);
            if (rr.b !== void 0)
              check(rr.b, rr.bEnd);
            if (rr.c !== void 0)
              check(rr.c, rr.cEnd);
            if (r.k === "equal") {
              const ka = builtinKind(r.a) ?? kindOf.get(r.a);
              const kb = builtinKind(r.b) ?? kindOf.get(r.b);
              const isLen = (t) => t === "line";
              const isRad = (t) => t === "circle" || t === "arc";
              if (ka && kb && (isLen(ka) && isRad(kb) || isRad(ka) && isLen(kb))) {
                throw new Error(".rules() equal between a line and a circle is not defined; constrain lengths to lengths or radii to radii.");
              }
            }
            const value = r.value;
            if (value !== void 0) {
              const v0 = num2(value, id, `rule${i}-value`);
              r.value = v0;
            }
            out.push(r);
          });
          replaceFeature(id, { ...cur, rules: out });
          return handle;
        },
        slot(a, b, r) {
          const cA = readVec2(".slot()", "a (one end cap centre)", a);
          const cB = readVec2(".slot()", "b (the other end cap centre)", b);
          const rp = positiveNumber(".slot()", "radius", r);
          const rv = unwrap(rp);
          if (cA[0] === cB[0] && cA[1] === cB[1]) {
            throw new Error(`.slot() needs two different end centres -- a and b are both [${cA[0]}, ${cA[1]}], which holds no slot.`);
          }
          const cur = findFeature(id);
          const had = priorRows(".slot()");
          const geoms = had ? had.geoms : cur.geoms ?? cur.geom ?? [];
          const base = geoms.reduce((m, g) => Math.max(m, g.id), 0) + 1;
          const built = buildSlotRows(cA, cB, rv, base);
          if (!built) {
            throw new Error(`.slot() could not build a slot from centres [${cA}] and [${cB}] with radius ${rv}.`);
          }
          for (const g of built.geoms) {
            if (g.k === "arc") {
              num2(rp, id, `g${g.id}r`);
              g.r = rv;
            }
          }
          const rules = had ? had.rules : cur.rules ?? [];
          const outGeoms = [...geoms, ...built.geoms];
          replaceFeature(id, {
            ...cur,
            geoms: outGeoms,
            geom: outGeoms,
            ...had && !hasRows() ? { points: starter.map((p) => [p[0], p[1]]), shape: void 0, rounds: void 0, chamfers: void 0, bulges: void 0, constraints: RECTANGLE_CONSTRAINTS.slice() } : {},
            rules: [...rules, ...built.rules]
          });
          return handle;
        }
      };
      return handle;
    }
    function readDirection(fn, opts2, allowThrough) {
      const allowed = allowThrough ? ["reversed", "midplane", "length2", "through", "taper", "direction", "alongNormal"] : ["reversed", "midplane", "length2", "taper", "direction", "alongNormal"];
      const o = readOptions(fn, allowed, opts2);
      const out = {};
      for (const k of ["reversed", "midplane", "through"]) {
        if (o[k] === void 0)
          continue;
        if (typeof o[k] !== "boolean")
          throw new Error(`${fn}'s ${k} is true or false, like ${fn}(..., { ${k}: true }). You gave it ${describe2(o[k])}.`);
        if (o[k])
          out[k] = true;
      }
      if (o.length2 !== void 0) {
        const n = unwrap(o.length2);
        if (typeof n !== "number" || !(n > 0) || !Number.isFinite(n))
          throw new Error(`${fn}'s length2 is the second length, a positive number. You gave it ${describe2(o.length2)}.`);
        out.length2 = n;
      }
      if (o.taper !== void 0) {
        const n = unwrap(o.taper);
        if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) >= 90)
          throw new Error(`${fn}'s taper is an angle in degrees between -90 and 90, like ${fn}(..., { taper: 5 }). You gave it ${describe2(o.taper)}.`);
        if (n !== 0)
          out.taper = n;
      }
      if (o.direction !== void 0) {
        const d = Array.isArray(o.direction) ? o.direction.map((c) => unwrap(c)) : o.direction;
        if (!Array.isArray(d) || d.length !== 3 || d.some((c) => typeof c !== "number" || !Number.isFinite(c))) {
          throw new Error(`${fn}'s direction is three numbers [x, y, z], like ${fn}(..., { direction: [1, 0, 1] }). You gave it ${describe2(d)}.`);
        }
        if (d.every((c) => c === 0))
          throw new Error(`${fn}'s direction [0, 0, 0] points nowhere. Give it at least one non-zero number.`);
        out.direction = [d[0], d[1], d[2]];
      }
      if (o.alongNormal !== void 0) {
        if (typeof o.alongNormal !== "boolean")
          throw new Error(`${fn}'s alongNormal is true or false. You gave it ${describe2(o.alongNormal)}.`);
        if (o.alongNormal === false)
          out.alongNormal = false;
      }
      if (out.alongNormal === false && !out.direction) {
        throw new Error(`${fn}'s alongNormal only matters with a direction: add direction: [x, y, z], or drop alongNormal.`);
      }
      if (out.midplane && out.length2 !== void 0) {
        throw new Error(`${fn}() takes midplane (the same length either side) or length2 (a second length the other way), not both.`);
      }
      return out;
    }
    function pull(sk, height, opts2, ...extra) {
      const known = opts2 !== void 0 && isPlainOptions(opts2) && Object.keys(opts2).every((k) => ["reversed", "midplane", "length2", "taper", "direction", "alongNormal"].includes(k));
      if (known)
        noExtraArgs("pull", "a sketch and a height", 3, extra, "To move the result, use move(...).");
      else
        noExtraArgs("pull", "a sketch and a height", 2, opts2 === void 0 ? extra : [opts2, ...extra], "To move the result, use move(...).");
      if (!isSketchHandle(sk))
        throw new Error(`pull() needs a sketch: pull(sketch('top'), height).`);
      requiredNumber("pull", "height", height);
      const dir = readDirection("pull", opts2, false);
      const f = newExtrude(docNow(), sk.id);
      f.height = num2(height, f.id, "height");
      Object.assign(f, dir);
      pushFeature(f);
      return makeSolidHandle(f);
    }
    function spin(sk, angle, ...extra) {
      noExtraArgs("spin", "a sketch and an angle", 2, extra, "To move the result, use move(...).");
      if (!isSketchHandle(sk))
        throw new Error(`spin() needs a sketch: spin(sketch('top'), angle).`);
      requiredNumber("spin", "angle", angle);
      spinAngle(angle);
      const f = newRevolve(docNow(), sk.id);
      f.angle = num2(angle, f.id, "angle");
      pushFeature(f);
      return makeSolidHandle(f);
    }
    function blend(a, b, gap, ...extra) {
      noExtraArgs("blend", "two sketches and a gap", 3, extra);
      if (!isSketchHandle(a) || !isSketchHandle(b)) {
        throw new Error("blend() needs two sketches: blend(sketch1, sketch2, gap).");
      }
      requiredNumber("blend", "gap", gap);
      const sa = findFeature(a.id);
      let sb = findFeature(b.id);
      const nextOffset = num2(gap, b.id, "offset") + sa.offset;
      if (sb.offset !== nextOffset) {
        sb = { ...sb, offset: nextOffset };
        replaceFeature(b.id, sb);
      }
      const f = newBlend(docNow(), sa, sb);
      pushFeature(f);
      return makeSolidHandle(f);
    }
    function holeAxisAndCenter(fn, holeId, opts2) {
      let axis = "z";
      if (opts2.along !== void 0) {
        if (opts2.along !== "x" && opts2.along !== "y" && opts2.along !== "z") {
          throw new Error(`${fn}'s "along" has to be 'x', 'y' or 'z'. You gave it ${describe2(opts2.along)}.`);
        }
        axis = opts2.along;
      }
      let center = [0, 0, 0];
      if (opts2.at !== void 0) {
        const [a, b] = readVec2(fn, "at", opts2.at);
        if (axis === "z")
          center = [num2(a, holeId, "x"), num2(b, holeId, "y"), 0];
        else if (axis === "y")
          center = [num2(a, holeId, "x"), 0, num2(b, holeId, "z")];
        else
          center = [0, num2(a, holeId, "y"), num2(b, holeId, "z")];
      }
      return { axis, center };
    }
    function applyRecess(fn, base, extra) {
      const cb = extra.counterbore;
      const cs = extra.countersink;
      if (cb !== void 0 && cs !== void 0) {
        throw new Error(`${fn}(): a hole takes a counterbore OR a countersink, not both -- one mouth, one shape.`);
      }
      if (cb !== void 0) {
        const o = readOptions("counterbore", ["across", "deep"], cb);
        if (o.across === void 0) {
          throw new Error(`${fn}(): counterbore needs { across: <number> } for the recess's diameter.`);
        }
        if (o.deep === void 0) {
          throw new Error(`${fn}(): counterbore needs { deep: <number> } for how far the recess is cut.`);
        }
        base.counterbore = {
          diameter: num2(positiveNumber(fn, "counterbore across", o.across), base.id, "diameter"),
          depth: num2(positiveNumber(fn, "counterbore deep", o.deep), base.id, "depth")
        };
      }
      if (cs !== void 0) {
        const o = readOptions("countersink", ["across", "angle"], cs);
        if (o.across === void 0) {
          throw new Error(`${fn}(): countersink needs { across: <number> } for its width at the mouth.`);
        }
        if (o.angle === void 0) {
          throw new Error(`${fn}(): countersink needs { angle: <number> } for the included cone angle (90 is the usual choice).`);
        }
        const angleDeg = num2(positiveNumber(fn, "countersink angle", o.angle), base.id, "angleDeg");
        if (angleDeg >= 180) {
          throw new Error(`${fn}(): a countersink's angle is its INCLUDED cone angle, so it has to be under 180 (90 and 120 are the usual choices) -- got ${angleDeg}.`);
        }
        base.countersink = {
          diameter: num2(positiveNumber(fn, "countersink across", o.across), base.id, "diameter"),
          angleDeg
        };
      }
    }
    function throughDepth(fn, target, axis) {
      const extent = throughExtentAlong(docNow(), target.id, axis);
      if (extent == null) {
        throw new Error(`${fn}() cannot find how thick this ${findFeature(target.rootId).kind} is along ${axis} yet, so it cannot drill all the way through. Give it a depth: ${fn}(shape, { across: 4, deep: 20 }).`);
      }
      return extent + 2;
    }
    function blindOffset(fn, target, axis, deep, center) {
      const off = holeAxialOffset(docNow(), target.id, axis, deep);
      if (off != null) {
        center[axis === "x" ? 0 : axis === "y" ? 1 : 2] = off;
        return;
      }
      const known = extentBoundAlong(docNow(), target.id, axis);
      if (known && !known.exact) {
        throw new Error(`${fn}() cannot find where the top of this ${findFeature(target.rootId).kind} is along ${axis} exactly, so a hole that stops short of the other side cannot start at the top. Make it go all the way through (leave out deep:, or give a deep: at least ${known.extent}), or drill the shape before it is cut.`);
      }
    }
    const HOLE_SIZES = {
      M3: 3.4,
      M4: 4.5,
      M5: 5.5,
      M6: 6.6,
      M8: 9,
      M10: 11,
      M12: 13.5
    };
    function resolveHoleSize(fn, extra) {
      if (extra.size === void 0)
        return;
      if (extra.across !== void 0) {
        throw new Error(`${fn}() takes { size: 'M6' } OR { across: 6.6 }, not both -- size is a name for an across.`);
      }
      const key = typeof extra.size === "string" ? extra.size.trim().toUpperCase() : "";
      if (!Object.prototype.hasOwnProperty.call(HOLE_SIZES, key)) {
        throw new Error(`${fn}() does not know the size ${describe2(extra.size)}. Sizes are ${Object.keys(HOLE_SIZES).join(", ")} (clearance holes), or give { across: <number> }.`);
      }
      extra.across = HOLE_SIZES[key];
      delete extra.size;
    }
    function hole(target, opts2) {
      if (!isHandle(target))
        throw new Error("hole() needs a shape to drill into: hole(shape, { across: 6 }).");
      const extra = readOptions("hole", ["across", "size", "deep", "at", "along", "counterbore", "countersink"], opts2);
      resolveHoleSize("hole", extra);
      if (extra.across === void 0)
        throw new Error("hole() needs { across: <number> } for the bit's diameter.");
      const across = positiveNumber("hole", "across", extra.across);
      const base = newHole(docNow(), target.id);
      const { axis, center } = holeAxisAndCenter("hole", base.id, extra);
      base.axis = axis;
      base.diameter = num2(across, base.id, "diameter");
      if (extra.deep !== void 0) {
        base.depth = num2(positiveNumber("hole", "deep", extra.deep), base.id, "depth");
        blindOffset("hole", target, axis, base.depth, center);
      } else {
        base.depth = throughDepth("hole", target, axis);
      }
      base.center = center;
      applyRecess("hole", base, extra);
      pushFeature(base);
      mutateHandle(target, base);
      return target;
    }
    function holes(target, opts2) {
      if (!isHandle(target))
        throw new Error("holes() needs a shape to drill into: holes(shape, { across: 6, apart: [15, 10] }).");
      const extra = readOptions("holes", ["across", "size", "apart", "at", "along", "deep", "counterbore", "countersink"], opts2);
      resolveHoleSize("holes", extra);
      if (extra.across === void 0)
        throw new Error("holes() needs { across: <number> } for the bit's diameter.");
      if (extra.apart === void 0)
        throw new Error("holes() needs { apart: [across, up] } for the corner-to-corner spacing.");
      const across = positiveNumber("holes", "across", extra.across);
      const [spanX, spanY] = readVec2("holes", "apart", extra.apart);
      const base = newHoleCorners(docNow(), target.id);
      const { axis, center } = holeAxisAndCenter("holes", base.id, extra);
      base.axis = axis;
      base.diameter = num2(across, base.id, "diameter");
      if (extra.deep !== void 0) {
        base.depth = num2(positiveNumber("holes", "deep", extra.deep), base.id, "depth");
        blindOffset("holes", target, axis, base.depth, center);
      } else {
        base.depth = throughDepth("holes", target, axis);
      }
      base.center = center;
      base.corners = {
        dx: num2(spanX, base.id, "dx") / 2,
        dy: num2(spanY, base.id, "dy") / 2
      };
      applyRecess("holes", base, extra);
      pushFeature(base);
      mutateHandle(target, base);
      return target;
    }
    function hollow(target, opts2) {
      if (!isHandle(target))
        throw new Error("hollow() needs a shape: hollow(shape, { wall: 2 }).");
      const extra = readOptions("hollow", ["wall", "open"], opts2);
      if (extra.wall === void 0)
        throw new Error("hollow() needs { wall: <number> } for the wall thickness.");
      const wall = positiveNumber("hollow", "wall", extra.wall);
      let open;
      if (extra.open !== void 0) {
        const part = facePart("hollow", extra.open, false);
        open = { cause: "primitive", feature: target.rootId, kind: "face", part };
      }
      const base = newShell(docNow(), target.id, open);
      base.thickness = num2(wall, base.id, "thickness");
      pushFeature(base);
      mutateHandle(target, base);
      return target;
    }
    function round(arg, size, ...extra) {
      noExtraArgs("round", "a shape or edge and a size", 2, extra, "To pick the edge, use shape.edge(faceA, faceB).");
      const s = requiredNumber("round", "size", size);
      if (Array.isArray(arg))
        return eachEdge("round", arg, (e) => round(e, size));
      if (isTopoRef(arg)) {
        if (arg.name.cause !== "between") {
          throw new Error("round() on a single reference needs an edge -- try round(shape.edge(faceA, faceB), size).");
        }
        const owner = arg.owner;
        const id = nextId(docNow(), "round");
        const f2 = { id, kind: "fillet", target: owner.id, edge: arg.name, size: num2(s, id, "size"), style: "fillet" };
        pushFeature(f2);
        mutateHandle(owner, f2);
        return owner;
      }
      if (!isHandle(arg))
        throw new Error("round() needs a shape or an edge (shape.edge(a, b)) to round.");
      const f = findFeature(arg.id);
      if (!isRoundable(f)) {
        throw new Error(whyCannotRound(f) ?? "Rounding does not work on this shape.");
      }
      const next = { ...f, round: num2(s, arg.id, "round"), roundStyle: "fillet" };
      replaceFeature(arg.id, next);
      arg.kind = next.kind;
      return arg;
    }
    function eachEdge(fn, edges, one) {
      if (edges.length === 0 || !edges.every((e) => isTopoRef(e) && e.name.cause === "between")) {
        throw new Error(`${fn}() on a list needs a list of edges, like ${fn}(part.rim(sketch2), 1).`);
      }
      let last;
      for (const e of edges)
        last = one(e);
      return last;
    }
    function bevel(arg, size) {
      if (Array.isArray(arg)) {
        requiredNumber("bevel", "size", size);
        return eachEdge("bevel", arg, (e) => bevel(e, size));
      }
      if (isHandle(arg)) {
        throw new Error("bevel() needs one edge: a whole shape is not supported yet -- chamfer one edge with bevel(shape.edge(faceA, faceB), size), or round the whole box or cylinder with fillet(shape, size).");
      }
      if (!isTopoRef(arg) || arg.name.cause !== "between") {
        throw new Error("bevel() needs one edge -- try bevel(shape.edge(faceA, faceB), size).");
      }
      const s = requiredNumber("bevel", "size", size);
      const owner = arg.owner;
      const id = nextId(docNow(), "bevel");
      const f = { id, kind: "fillet", target: owner.id, edge: arg.name, size: num2(s, id, "size"), style: "chamfer" };
      pushFeature(f);
      mutateHandle(owner, f);
      return owner;
    }
    const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const isPadFeature = (f) => f.kind === "combine" && f.op === "union" && f.targets.length === 2 && findFeature(f.targets[1]).kind === "extrude";
    const isPocketTarget = (t) => {
      const f = findFeature(t.id);
      return f.kind === "pocket" || isPadFeature(f);
    };
    const isHoleTarget = (t) => {
      const f = findFeature(t.id);
      return f.kind === "hole";
    };
    const bodyInputOf = (f) => {
      switch (f.kind) {
        case "pocket":
        case "groove":
          return f.into;
        case "combine":
          return f.targets[0] ?? null;
        case "hole":
        case "shell":
        case "fillet":
        case "draft":
        case "rotate":
        case "mirror":
        case "pattern":
          return f.target;
        case "move":
          return f.copy ? null : f.target;
        default:
          return null;
      }
    };
    function tipOf(from, allowed, refuse) {
      let cur = from;
      for (let guard = 0; guard < 256; guard++) {
        const next = docNow().features.filter((f) => f.id !== cur.id && bodyInputOf(f) === cur.id);
        if (next.length === 0)
          return cur;
        if (next.length > 1)
          return refuse("more than one later feature was built on this shape, so there is no single part to add to");
        if (!allowed(next[0]))
          return refuse(`a later ${next[0].kind} was built on this shape, and a copy added after it could not stay in step with it`);
        cur = next[0];
      }
      return cur;
    }
    const tipAny = (from) => tipOf(from, () => true, (why) => {
      throw new Error(`This shape cannot be copied yet: ${why}. Copy it before building on it.`);
    });
    function rotateAbout(axis, deg) {
      const c = Math.cos(deg * Math.PI / 180);
      const s = Math.sin(deg * Math.PI / 180);
      return (p) => {
        const [x, y, z] = p;
        if (axis === "x")
          return [x, c * y - s * z, s * y + c * z];
        if (axis === "y")
          return [c * x + s * z, y, -s * x + c * z];
        return [c * x - s * y, s * x + c * y, z];
      };
    }
    const solvedSketch = (sk) => {
      if (!sk.constraints || sk.constraints.length === 0)
        return sk;
      return solveDoc({ version: 1, features: [sk] }).features[0];
    };
    const flatOf = (sk, map) => {
      const circ = circleOf(sk);
      if (circ)
        return { c: map(circ.center[0], circ.center[1]), r: circ.radius };
      return { poly: tessellate(sk).map(([a, b]) => map(a, b)) };
    };
    const polyOfFlat = (f) => {
      if ("poly" in f)
        return f.poly;
      const N = 96, R = f.r / Math.cos(Math.PI / N);
      return Array.from({ length: N }, (_, i) => [f.c[0] + R * Math.cos(2 * Math.PI * i / N), f.c[1] + R * Math.sin(2 * Math.PI * i / N)]);
    };
    const inPoly = (pt, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > pt[1] !== yj > pt[1] && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)
          inside = !inside;
      }
      return inside;
    };
    const segsCross = (a, b, c, d) => {
      const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const [o1, o2, o3, o4] = [o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)];
      if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
        const ax = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
        return Math.max(Math.min(a[ax], b[ax]), Math.min(c[ax], d[ax])) <= Math.min(Math.max(a[ax], b[ax]), Math.max(c[ax], d[ax]));
      }
      return o1 * o2 <= 0 && o3 * o4 <= 0;
    };
    const polysTouch = (A, B) => {
      for (let i = 0; i < A.length; i++)
        for (let j = 0; j < B.length; j++) {
          if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]))
            return true;
        }
      return inPoly(A[0], B) || inPoly(B[0], A);
    };
    const rectOfFlat = (f) => {
      if (!("poly" in f))
        return null;
      const pts = f.poly.filter((q, i, all) => i === 0 || Math.hypot(q[0] - all[i - 1][0], q[1] - all[i - 1][1]) > 1e-12);
      if (pts.length === 5 && Math.hypot(pts[0][0] - pts[4][0], pts[0][1] - pts[4][1]) < 1e-12)
        pts.pop();
      if (pts.length !== 4)
        return null;
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      if (!(x1 - x0 > 1e-9 && y1 - y0 > 1e-9))
        return null;
      const onSide = (q) => (Math.abs(q[0] - x0) < 1e-9 || Math.abs(q[0] - x1) < 1e-9) && (Math.abs(q[1] - y0) < 1e-9 || Math.abs(q[1] - y1) < 1e-9);
      return pts.every(onSide) && new Set(pts.map((q) => q.join(","))).size === 4 ? [x0, y0, x1, y1] : null;
    };
    const flatsTouch = (a, b) => {
      if ("c" in a && "c" in b)
        return Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) <= a.r + b.r + 1e-6;
      return polysTouch(polyOfFlat(a), polyOfFlat(b));
    };
    const flatInside = (cut2, host) => {
      if ("c" in cut2 && "c" in host)
        return Math.hypot(cut2.c[0] - host.c[0], cut2.c[1] - host.c[1]) + cut2.r < host.r - 1e-6;
      const hp = polyOfFlat(host);
      const cp = polyOfFlat(cut2);
      return cp.every((q) => inPoly(q, hp)) && !hp.some((q, i) => cp.some((_, j) => segsCross(q, hp[(i + 1) % hp.length], cp[j], cp[(j + 1) % cp.length])));
    };
    function patternOfCut(fn, target, count, place, planeKept, improper = false, slides = false, turns = false, flipAxis = null) {
      const tf = findFeature(target.id);
      const isPad = isPadFeature(tf);
      const pk = isPad ? findFeature(tf.targets[1]) : tf;
      const sk = findFeature(pk.target);
      const refuse = (why) => {
        throw new Error(isPad ? `${fn}() of a pad adds a copy of the pad at each place, and ${why}. Add the extra pads yourself, one sketch and join(shape, pull(...)) each.` : `${fn}() of a pocket cuts a copy of the pocket at each place, and ${why}. Cut the extra pockets yourself, one sketch and pocket(...) each.`);
      };
      if (sk.kind !== "sketch")
        refuse("this pocket does not come from a flat sketch");
      if (sk.geoms && sk.geoms.length || sk.geom && sk.geom.length)
        refuse("its sketch is built from free-standing geometry and rules, which cannot be moved as a whole");
      const fr = sketchFrameOf(sk);
      const at = (a, b) => [
        fr.origin[0] + a * fr.u[0] + b * fr.v[0],
        fr.origin[1] + a * fr.u[1] + b * fr.v[1],
        fr.origin[2] + a * fr.u[2] + b * fr.v[2]
      ];
      const worldOf = (k) => {
        const mv = k === 0 ? (p) => p : place(k);
        return (a, b) => {
          const w = mv(at(a, b));
          return [dot3(sub3(w, fr.origin), fr.u), dot3(sub3(w, fr.origin), fr.v)];
        };
      };
      const skS = solvedSketch(sk);
      const flats = [];
      for (let k = 0; k < count; k++)
        flats.push(flatOf(skS, worldOf(k)));
      const circlesOverlapCleanly = (slides || turns) && !isPad && flats.every((fl) => "c" in fl);
      const rectsMirrored = improper && !isPad && flats.length === 2;
      const rA = rectsMirrored ? rectOfFlat(flats[0]) : null, rB = rectsMirrored ? rectOfFlat(flats[1]) : null;
      const sameSpan = (lo0, hi0, lo1, hi1) => Math.abs(lo0 - lo1) < 1e-9 && Math.abs(hi0 - hi1) < 1e-9;
      const mirrorRects = rA && rB && (sameSpan(rA[0], rA[2], rB[0], rB[2]) || sameSpan(rA[1], rA[3], rB[1], rB[3]));
      const dropped = /* @__PURE__ */ new Set();
      const sameFlat = (a, b) => {
        const E = 1e-9;
        if ("c" in a && "c" in b)
          return Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) < E && Math.abs(a.r - b.r) < E;
        if ("poly" in a && "poly" in b) {
          const key = (q) => `${Math.round(q[0] / 1e-7)},${Math.round(q[1] / 1e-7)}`;
          const A = new Set(a.poly.map(key));
          const B = new Set(b.poly.map(key));
          return A.size === B.size && [...A].every((k) => B.has(k));
        }
        return false;
      };
      if (improper && !isPad) {
        for (let k = 1; k < count; k++) {
          const mv = place(k);
          const o2 = mv(fr.origin), n2 = sub3(mv([fr.origin[0] + fr.n[0], fr.origin[1] + fr.n[1], fr.origin[2] + fr.n[2]]), o2);
          const inPlane = Math.abs(dot3(sub3(o2, fr.origin), fr.n)) < 1e-9;
          const sameWay = Math.abs(dot3(n2, fr.n) - 1) < 1e-9;
          if (inPlane && sameWay && sameFlat(flats[0], flats[k]))
            dropped.add(k);
        }
      }
      for (let i = 0; i < flats.length; i++)
        for (let j = i + 1; j < flats.length; j++) {
          if (flipAxis !== null)
            continue;
          if (mirrorRects)
            continue;
          if (dropped.has(i) || dropped.has(j))
            continue;
          const a = flats[i], b = flats[j];
          const pinched = "c" in a && "c" in b && Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) >= (a.r + b.r) * (1 - 1e-3);
          if (flatsTouch(a, b) && (!circlesOverlapCleanly || pinched)) {
            refuse(`copy ${i + 1} and copy ${j + 1} of the cut overlap each other, so brep-rs cannot yet join overlapping cuts into the same single part FreeCAD gives`);
          }
        }
      const toPlane = (w) => [dot3(sub3(w, fr.origin), fr.u), dot3(sub3(w, fr.origin), fr.v)];
      const worldAxis = (v) => {
        const i = [0, 1, 2].find((a) => Math.abs(Math.abs(v[a]) - 1) < 1e-9);
        return i === void 0 ? null : i;
      };
      const boxOf = (id) => {
        const iu = worldAxis(fr.u), iv = worldAxis(fr.v);
        if (iu === null || iv === null)
          return null;
        const AX = ["x", "y", "z"];
        const ru = featureRangeAlong(docNow(), id, AX[iu]), rv = featureRangeAlong(docNow(), id, AX[iv]);
        if (!ru || !rv)
          return null;
        const w = (x, y) => {
          const p = [fr.origin[0], fr.origin[1], fr.origin[2]];
          p[iu] = x;
          p[iv] = y;
          return toPlane(p);
        };
        return { poly: [w(ru.lo, rv.lo), w(ru.hi, rv.lo), w(ru.hi, rv.hi), w(ru.lo, rv.hi)] };
      };
      const memberOf = (h) => {
        const box2 = boxOf(h.id);
        if (h.kind === "box" && !(h.rotate && h.rotate.some((d) => d)) && !h.round) {
          const m = worldAxis(fr.n);
          if (m !== null) {
            const [i, j] = [0, 1, 2].filter((a) => a !== m);
            const corner = (si, sj) => {
              const w = [0, 0, 0];
              w[m] = fr.origin[m];
              w[i] = h.center[i] + si * h.size[i] / 2;
              w[j] = h.center[j] + sj * h.size[j] / 2;
              return toPlane(w);
            };
            return { kind: h.kind, flat: { poly: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] }, box: box2 };
          }
        }
        if (h.kind === "cylinder" && !(h.rotate && h.rotate.some((d) => d)) && !h.round && worldAxis(fr.n) === 2) {
          return { kind: h.kind, flat: { c: toPlane([h.center[0], h.center[1], fr.origin[2]]), r: h.radius }, box: box2 };
        }
        if (h.kind === "extrude" && !h.taper && !h.direction) {
          const hs = findFeature(h.target);
          if (hs.kind === "sketch" && !(hs.geoms && hs.geoms.length) && !(hs.geom && hs.geom.length)) {
            const hf = sketchFrameOf(hs);
            if (Math.abs(Math.abs(dot3(hf.n, fr.n)) - 1) < 1e-9) {
              const flat = flatOf(solvedSketch(hs), (a, b) => toPlane([
                hf.origin[0] + a * hf.u[0] + b * hf.v[0],
                hf.origin[1] + a * hf.u[1] + b * hf.v[1],
                hf.origin[2] + a * hf.u[2] + b * hf.v[2]
              ]));
              return { kind: h.kind, flat, box: box2 };
            }
          }
        }
        return { kind: h.kind, flat: null, box: box2 };
      };
      const members = [];
      const memberIds = [];
      const visit = (id, depth) => {
        let h = findFeature(id);
        for (let guard = 0; guard < 64; guard++) {
          if (h.kind === "pocket") {
            h = findFeature(h.into);
            continue;
          }
          if (h.kind === "hole") {
            h = findFeature(h.target);
            continue;
          }
          break;
        }
        if (h.kind === "combine" && h.op === "union" && h.targets.length > 0 && depth < 16) {
          for (const t of h.targets)
            visit(t, depth + 1);
          return;
        }
        members.push(memberOf(h));
        memberIds.push(h.id);
      };
      visit(isPad ? tf.targets[0] : pk.into, 0);
      if (flipAxis !== null) {
        const AXN = ["x", "y", "z"];
        let lo = Infinity, hi = -Infinity, exactAll = true;
        for (const id of memberIds) {
          const r = featureRangeAlong(docNow(), id, AXN[flipAxis]);
          if (!r || !r.exact) {
            exactAll = false;
            break;
          }
          lo = Math.min(lo, r.lo);
          hi = Math.max(hi, r.hi);
        }
        if (!exactAll || !(hi > lo)) {
          refuse("brep-rs cannot yet tell exactly where the part ends along the mirror direction, so it cannot tell where the copy would land");
        }
        const src = pk;
        if (src.direction || src.taper || src.midplane || src.length2 !== void 0) {
          refuse("the cut is slanted, tapered, symmetric or two-sided, and a reflection through a parallel plane has not been matched against FreeCAD for those yet");
        }
        const sweep = sk.frame ? 1 : SWEEP_DIR[sk.plane ?? "xy"] ?? 1;
        const cutDir = -fr.n[flipAxis] * sweep * (src.reversed ? -1 : 1);
        const reachOf = (o, dir) => {
          if (src.midplane)
            return [o - src.depth / 2, o + src.depth / 2];
          const ahead = src.through ? (dir > 0 ? hi - o : o - lo) + 0 : src.depth;
          const a = o + dir * Math.max(ahead, 0), b = o - dir * (src.length2 ?? 0);
          return [Math.min(a, b), Math.max(a, b)];
        };
        const o0 = fr.origin[flipAxis];
        const [a0, b0] = reachOf(o0, cutDir);
        const [a1, b1] = reachOf(place(1)(fr.origin)[flipAxis], -cutDir);
        const E = 1e-9;
        if (b1 <= lo + E || a1 >= hi - E) {
          refuse(`the copy lies wholly off the part (it would cut from ${+a1.toFixed(6)} to ${+b1.toFixed(6)}, and the part runs from ${+lo.toFixed(6)} to ${+hi.toFixed(6)}), so it would cut nothing`);
        }
        if (a1 <= b0 + E && a0 <= b1 + E) {
          const covers = a0 <= lo + E && b0 >= hi - E;
          if (src.through && covers)
            dropped.add(1);
          else
            refuse("the copy meets the original cut along the part, so brep-rs cannot yet join them into the one cut FreeCAD gives");
        }
      }
      const known = members.filter((m) => m.flat !== null);
      const unknown = members.filter((m) => m.flat === null);
      const straight = !(pk.taper || pk.direction);
      const mayDrop = slides && !improper && !isPad && straight && known.length > 0 && unknown.length === 0 && members.every((m) => m.kind === "extrude");
      const what = isPad ? "pad" : "cut";
      const reach = (n) => members.length > 1 ? `copy ${n} of the ${what} runs across where two shapes of the part are joined, or reaches the part's edge, so brep-rs cannot yet match the faces FreeCAD gives there` : isPad ? `copy ${n} of the pad reaches the edge of the part, so brep-rs cannot yet join it over an edge and match the face count FreeCAD gives` : `copy ${n} of the cut reaches the edge of the part, so brep-rs cannot yet cut through an edge and match the face count FreeCAD gives`;
      const off = (n) => isPad ? `copy ${n} of the pad lies wholly off the part, so it would stand apart from it` : `copy ${n} of the cut lies wholly off the part, so it would cut nothing`;
      const single = members.length === 1 ? known[0] : void 0;
      flats.forEach((fl, i2) => {
        const n = i2 + 1;
        if (known.some((m) => flatInside(fl, m.flat)))
          return;
        const hr = single && mirrorRects ? rectOfFlat(single.flat) : null, cr = rectOfFlat(fl);
        if (hr && cr && rA && rB) {
          const e = 1e-9;
          const out = [cr[0] < hr[0] - e, cr[1] < hr[1] - e, cr[2] > hr[2] + e, cr[3] > hr[3] + e];
          const ok = [cr[0] > hr[0] + e, cr[1] > hr[1] + e, cr[2] < hr[2] - e, cr[3] < hr[3] - e];
          const sides = out.filter(Boolean).length;
          if (sides === 1 && out.every((o, k) => o || ok[k]) && cr[0] < hr[2] - e && cr[2] > hr[0] + e && cr[1] < hr[3] - e && cr[3] > hr[1] + e)
            return;
        }
        if (known.some((m) => flatsTouch(fl, m.flat)))
          refuse(reach(n));
        if (unknown.length === 0) {
          if (mayDrop && i2 > 0) {
            dropped.add(i2);
            return;
          }
          refuse(off(n));
        }
        if (straight && unknown.every((m) => m.box && !flatsTouch(fl, m.box)))
          refuse(off(n));
      });
      let last = tipOf(tf, (f) => f.kind === "pocket" || f.kind === "hole" || isPadFeature(f), refuse);
      for (let k = 1; k < count; k++) {
        if (dropped.has(k))
          continue;
        const mv = place(k);
        const copy = JSON.parse(JSON.stringify(skS));
        copy.id = nextId(docNow(), "sk");
        delete copy.name;
        delete copy.constraints;
        delete copy.onDatum;
        if (sk.frame) {
          const o2 = mv(fr.origin);
          const u2 = sub3(mv(at(1, 0)), o2), v2 = sub3(mv(at(0, 1)), o2);
          if (improper) {
            copy.frame = { origin: o2, u: v2, v: u2 };
            copy.points = copy.points.map(([a, b]) => [b, a]);
            if (copy.bulges) {
              copy.bulges = Object.fromEntries(Object.entries(copy.bulges).map(([k2, b]) => [k2, -b]));
            }
          } else {
            copy.frame = { origin: o2, u: u2, v: v2 };
          }
        } else {
          if (!planeKept(fr.n))
            refuse("the move would tilt or lift the sketch off its plane");
          copy.points = skS.points.map(([a, b]) => {
            const d = sub3(mv(at(a, b)), fr.origin);
            return [dot3(d, fr.u), dot3(d, fr.v)];
          });
          copy.offset = (sk.offset ?? 0) + dot3(sub3(mv(fr.origin), fr.origin), fr.n);
        }
        const flipPush = flipAxis !== null && !sk.frame;
        pushFeature(copy);
        const turned = (d) => {
          const o = mv(fr.origin);
          return sub3(mv([fr.origin[0] + d[0], fr.origin[1] + d[1], fr.origin[2] + d[2]]), o);
        };
        if (isPad) {
          const ex = newExtrude(docNow(), copy.id);
          const src = pk;
          ex.height = src.height;
          if (src.reversed)
            ex.reversed = true;
          if (src.midplane)
            ex.midplane = true;
          if (src.length2 !== void 0)
            ex.length2 = src.length2;
          if (src.taper)
            ex.taper = src.taper;
          if (src.direction)
            ex.direction = turned(src.direction);
          if (src.alongNormal === false)
            ex.alongNormal = false;
          pushFeature(ex);
          const join2 = { id: nextId(docNow(), "op"), kind: "combine", op: "union", targets: [last.id, ex.id] };
          pushFeature(join2);
          last = join2;
        } else {
          const cut2 = newPocket(docNow(), copy.id, last.id);
          const src = pk;
          cut2.depth = src.depth;
          if (!!src.reversed !== flipPush)
            cut2.reversed = true;
          if (src.midplane)
            cut2.midplane = true;
          if (src.length2 !== void 0)
            cut2.length2 = src.length2;
          if (src.through)
            cut2.through = true;
          if (src.taper)
            cut2.taper = src.taper;
          if (src.direction)
            cut2.direction = turned(src.direction);
          if (src.alongNormal === false)
            cut2.alongNormal = false;
          pushFeature(cut2);
          last = cut2;
        }
      }
      mutateHandle(target, last);
      return target;
    }
    function patternOfHole(fn, target, count, shift, needsAxis, fallback = "none") {
      const hf = findFeature(target.id);
      const refuse = (why) => {
        throw new Error(`${fn}() of a hole drills a copy of the hole at each place, and ${why}. Drill the extra holes yourself, one hole(...) each.`);
      };
      if (hf.corners)
        refuse("a hole made by holes() already drills four at once, which cannot be repeated as a unit");
      const ax = hf.axis;
      if (needsAxis && needsAxis !== ax)
        refuse(`the hole is drilled along ${ax} but the spin is about ${needsAxis}, which would tilt the drill`);
      const ix = ax === "z" ? [0, 1] : ax === "y" ? [0, 2] : [1, 2];
      const axv = ax === "x" ? [1, 0, 0] : ax === "y" ? [0, 1, 0] : [0, 0, 1];
      const to2 = (p) => [p[ix[0]], p[ix[1]]];
      let hostSk = null;
      let hostBox = null;
      let hostCyl = null;
      let cur = findFeature(hf.target);
      for (let guard = 0; guard < 64; guard++) {
        if (cur.kind === "hole") {
          if (cur.corners)
            break;
          cur = findFeature(cur.target);
          continue;
        }
        if (cur.kind === "pocket") {
          cur = findFeature(cur.into);
          continue;
        }
        if (cur.kind === "box") {
          if (!(cur.rotate && cur.rotate.some((d) => d)) && !cur.round)
            hostBox = cur;
          break;
        }
        if (cur.kind === "cylinder") {
          if (!(cur.rotate && cur.rotate.some((d) => d)) && !cur.round && ax === "z")
            hostCyl = cur;
          break;
        }
        if (cur.kind === "extrude") {
          if (cur.taper || cur.direction) {
            refuse(`the part it drills was pulled ${cur.taper && cur.direction ? "with a taper and along a slant" : cur.taper ? "with a taper" : "along a slant"}, so brep-rs cannot yet tell where the middle of the part is, and a hole is placed from the middle`);
          }
          const hs = findFeature(cur.target);
          if (hs.kind === "sketch" && !(hs.geoms && hs.geoms.length) && !(hs.geom && hs.geom.length)) {
            const hfr = sketchFrameOf(hs);
            if (Math.abs(Math.abs(dot3(hfr.n, axv)) - 1) < 1e-9)
              hostSk = solvedSketch(hs);
          }
        }
        break;
      }
      if (!hostSk && !hostBox && !hostCyl)
        return refuse("brep-rs cannot yet find where the middle of the part is, and a hole is placed from the middle");
      let hostFlat;
      if (hostCyl) {
        hostFlat = { c: [hostCyl.center[ix[0]], hostCyl.center[ix[1]]], r: hostCyl.radius };
      } else if (hostBox) {
        const hx = hostBox.size[ix[0]] / 2, hy = hostBox.size[ix[1]] / 2, bx = hostBox.center[ix[0]], by = hostBox.center[ix[1]];
        hostFlat = { poly: [[bx - hx, by - hy], [bx + hx, by - hy], [bx + hx, by + hy], [bx - hx, by + hy]] };
      } else {
        const hfr = sketchFrameOf(hostSk);
        const hostW = (a, b) => to2([
          hfr.origin[0] + a * hfr.u[0] + b * hfr.v[0],
          hfr.origin[1] + a * hfr.u[1] + b * hfr.v[1],
          hfr.origin[2] + a * hfr.u[2] + b * hfr.v[2]
        ]);
        hostFlat = flatOf(hostSk, hostW);
      }
      let c2;
      if ("c" in hostFlat)
        c2 = hostFlat.c;
      else {
        const xs = hostFlat.poly.map((q) => q[0]), ys = hostFlat.poly.map((q) => q[1]);
        c2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      }
      const o0 = [hf.center[ix[0]], hf.center[ix[1]]];
      const r = Math.max(hf.diameter, hf.counterbore?.diameter ?? 0, hf.countersink?.diameter ?? 0) / 2;
      const places = [];
      for (let k = 0; k < count; k++)
        places.push(k === 0 ? o0 : shift(ax, c2, o0, k));
      const flats = places.map((o) => ({ c: [c2[0] + o[0], c2[1] + o[1]], r }));
      for (let i = 0; i < flats.length; i++)
        for (let j = i + 1; j < flats.length; j++) {
          if (flatsTouch(flats[i], flats[j]))
            refuse(`copy ${i + 1} and copy ${j + 1} of the hole overlap each other, so brep-rs cannot yet join overlapping holes into the same single part FreeCAD gives`);
        }
      flats.forEach((fl, i) => {
        if (!flatInside(fl, hostFlat))
          refuse(`copy ${i + 1} of the hole reaches the edge of the part, so brep-rs cannot yet cut through an edge and match the face count FreeCAD gives`);
      });
      let last = tipOf(hf, (f) => f.kind === "pocket" || f.kind === "hole", refuse);
      for (let k = 1; k < count; k++) {
        const copy = JSON.parse(JSON.stringify(hf));
        copy.id = nextId(docNow(), "hole");
        delete copy.name;
        copy.target = last.id;
        copy.center[ix[0]] = places[k][0];
        copy.center[ix[1]] = places[k][1];
        pushFeature(copy);
        last = copy;
      }
      mutateHandle(target, last);
      return target;
    }
    function repeat(target, opts2) {
      if (!isHandle(target))
        throw new Error("repeat() needs a shape: repeat(shape, { count: 3, step: 60 }).");
      const extra = readOptions("repeat", ["count", "step"], opts2);
      if (extra.count === void 0)
        throw new Error("repeat() needs { count: <number> }.");
      const count = wholeNumberAtLeastOne("repeat", "count", extra.count);
      if (isPocketTarget(target)) {
        let st = [0, 0, 0];
        if (extra.step !== void 0) {
          st = typeof extra.step === "number" || extra.step instanceof Number ? [unwrap(extra.step), 0, 0] : readVec3("repeat", "step", extra.step).map((n) => unwrap(n));
        }
        return patternOfCut("repeat", target, count, (k) => (p) => [p[0] + st[0] * k, p[1] + st[1] * k, p[2] + st[2] * k], () => true, false, true);
      }
      if (isHoleTarget(target)) {
        let st = [0, 0, 0];
        if (extra.step !== void 0) {
          st = typeof extra.step === "number" || extra.step instanceof Number ? [unwrap(extra.step), 0, 0] : readVec3("repeat", "step", extra.step).map((n) => unwrap(n));
        }
        const hax = findFeature(target.id).axis;
        if (Math.abs(st[hax === "x" ? 0 : hax === "y" ? 1 : 2]) > 1e-9) {
          throw new Error(`repeat() of a hole drills a copy of the hole at each place, and the step moves the hole along its own drill direction (${hax}), which would lift it off the face. Step across the face instead.`);
        }
        const si = hax === "z" ? [0, 1] : hax === "y" ? [0, 2] : [1, 2];
        const lowered = patternOfHole("repeat", target, count, (_a, _c, o, k) => [o[0] + st[si[0]] * k, o[1] + st[si[1]] * k], void 0, "linear");
        if (lowered)
          return lowered;
      }
      const tip = tipAny(findFeature(target.id));
      const base = newPattern(docNow(), tip.id, "linear");
      base.count = num2(count, base.id, "count");
      if (extra.step !== void 0) {
        if (typeof extra.step === "number" || extra.step instanceof Number) {
          base.step = [num2(extra.step, base.id, "stepx"), 0, 0];
        } else {
          base.step = readVec3("repeat", "step", extra.step);
        }
      }
      pushFeature(base);
      mutateHandle(target, base);
      return target;
    }
    function repeatAround(target, opts2) {
      if (!isHandle(target))
        throw new Error('repeatAround() needs a shape: repeatAround(shape, { count: 6, axis: "z" }).');
      const extra = readOptions("repeatAround", ["count", "axis", "angle"], opts2);
      if (extra.count === void 0)
        throw new Error("repeatAround() needs { count: <number> }.");
      const count = wholeNumberAtLeastOne("repeatAround", "count", extra.count);
      if (isPocketTarget(target)) {
        const ax = extra.axis === void 0 ? "z" : extra.axis;
        if (ax !== "x" && ax !== "y" && ax !== "z") {
          throw new Error(`repeatAround()'s "axis" has to be 'x', 'y' or 'z'. You gave it ${describe2(extra.axis)}.`);
        }
        const total = extra.angle === void 0 ? 360 : unwrap(requiredNumber("repeatAround", "angle", extra.angle));
        const axv = ax === "x" ? [1, 0, 0] : ax === "y" ? [0, 1, 0] : [0, 0, 1];
        return patternOfCut(
          "repeatAround",
          target,
          count,
          // a full turn spaces copies by angle / count (the last would land on the first); anything less spaces them by
          // angle / (count - 1) so the last copy sits AT the end angle -- the way FreeCAD's PolarPattern does it
          (k) => rotateAbout(ax, (Math.abs(total) >= 360 - 1e-9 ? total / count : total / (count - 1)) * k),
          (n) => Math.abs(Math.abs(dot3(n, axv)) - 1) < 1e-9,
          false,
          false,
          true
        );
      }
      if (isHoleTarget(target)) {
        const ax = extra.axis === void 0 ? "z" : extra.axis;
        if (ax !== "x" && ax !== "y" && ax !== "z") {
          throw new Error(`repeatAround()'s "axis" has to be 'x', 'y' or 'z'. You gave it ${describe2(extra.axis)}.`);
        }
        const total = extra.angle === void 0 ? 360 : unwrap(requiredNumber("repeatAround", "angle", extra.angle));
        const step = Math.abs(total) >= 360 - 1e-9 ? total / count : total / (count - 1);
        const lowered = patternOfHole("repeatAround", target, count, (hax, c2, o, k) => {
          const ixx = hax === "z" ? [0, 1] : hax === "y" ? [0, 2] : [1, 2];
          const p = [0, 0, 0];
          p[ixx[0]] = c2[0] + o[0];
          p[ixx[1]] = c2[1] + o[1];
          const q = rotateAbout(ax, step * k)(p);
          return [q[ixx[0]] - c2[0], q[ixx[1]] - c2[1]];
        }, ax, "any");
        if (lowered)
          return lowered;
      }
      const tip = tipAny(findFeature(target.id));
      const base = newPattern(docNow(), tip.id, "circular");
      base.count = num2(count, base.id, "count");
      if (extra.axis !== void 0) {
        if (extra.axis !== "x" && extra.axis !== "y" && extra.axis !== "z") {
          throw new Error(`repeatAround()'s "axis" has to be 'x', 'y' or 'z'. You gave it ${describe2(extra.axis)}.`);
        }
        base.axis = extra.axis;
      }
      if (extra.angle !== void 0) {
        base.totalAngle = num2(requiredNumber("repeatAround", "angle", extra.angle), base.id, "totalangle");
      }
      const f = tip;
      const why = whyCannotOrbit(f, base.axis ?? "z");
      if (why)
        throw new Error(why);
      pushFeature(base);
      mutateHandle(target, base);
      return target;
    }
    const MIRROR_WORD = {
      "left-right": "yz",
      "front-back": "xz",
      "top-bottom": "xy"
    };
    function mirror(target, word, opts2, ...extra) {
      if (opts2 !== void 0 && !isPlainOptions(opts2)) {
        noExtraArgs("mirror", "a shape and a direction word", 2, [opts2, ...extra]);
      }
      noExtraArgs("mirror", "a shape and a direction word", 2, extra);
      if (!isHandle(target))
        throw new Error('mirror() needs a shape: mirror(shape, "left-right").');
      if (typeof word !== "string" || !(word in MIRROR_WORD)) {
        throw new Error(`mirror() needs 'left-right', 'front-back' or 'top-bottom'. You gave it ${describe2(word)}.`);
      }
      const given = readOptions("mirror", ["at"], opts2);
      if (given.at !== void 0)
        return mirrorCut(target, word, given.at);
      const f = newMirror(docNow(), tipAny(findFeature(target.id)).id, MIRROR_WORD[word]);
      pushFeature(f);
      return makeSolidHandle(f, target.rootId);
    }
    function mirrorCut(target, word, atRaw) {
      const at = unwrap(requiredNumber("mirror", "at", atRaw));
      if (!Number.isFinite(at))
        throw new Error(`mirror()'s "at" has to be a finite number. You gave it ${describe2(atRaw)}.`);
      if (!isPocketTarget(target) && !isHoleTarget(target)) {
        throw new Error("mirror() with { at } reflects a pocket, a hole or a pad across a plane at that distance, and this shape is none of those. Leave out { at } to mirror the whole shape across the plane through the origin.");
      }
      const m = MIRROR_WORD[word] === "yz" ? 0 : MIRROR_WORD[word] === "xz" ? 1 : 2;
      const what = isHoleTarget(target) ? "hole" : findFeature(target.id).kind === "pocket" ? "pocket" : "pad";
      const parallel = () => {
        throw new Error(`mirror() of a ${what} across '${word}' reflects it through a plane parallel to the face it sits on, which would turn it to the other side of the part instead of copying it across. Mirror it across a plane that stands square to that face.`);
      };
      if (isHoleTarget(target)) {
        const hf = findFeature(target.id);
        if (hf.axis === ["x", "y", "z"][m])
          parallel();
        return patternOfHole("mirror", target, 2, (hax, c2, o) => {
          const ixx = hax === "z" ? [0, 1] : hax === "y" ? [0, 2] : [1, 2];
          const j = ixx.indexOf(m);
          const out = [o[0], o[1]];
          out[j] = 2 * at - 2 * c2[j] - o[j];
          return out;
        });
      }
      const tf = findFeature(target.id);
      const pk = isPadFeature(tf) ? findFeature(tf.targets[1]) : tf;
      const sk = findFeature(pk.target);
      let flipAxis = null;
      if (sk.kind === "sketch") {
        const fr = sketchFrameOf(sk);
        if (Math.abs(fr.n[m]) > 1e-9) {
          if (what !== "pocket" || Math.abs(Math.abs(fr.n[m]) - 1) > 1e-9)
            parallel();
          flipAxis = m;
        }
      }
      return patternOfCut("mirror", target, 2, () => (p) => {
        const q = [p[0], p[1], p[2]];
        q[m] = 2 * at - q[m];
        return q;
      }, () => true, true, false, false, flipAxis);
    }
    function move(target, offset, opts2) {
      if (!isHandle(target))
        throw new Error("move() needs a shape: move(shape, [x, y, z]).");
      const extra = readOptions("move", ["copy"], opts2);
      const copy = extra.copy === true;
      const off = readVec3("move", "offset", offset);
      const base = newMove(docNow(), target.id, copy);
      base.offset = [num2(off[0], base.id, "x"), num2(off[1], base.id, "y"), num2(off[2], base.id, "z")];
      pushFeature(base);
      if (copy)
        return makeSolidHandle(base, target.rootId);
      mutateHandle(target, base);
      return target;
    }
    function turn(target, angles, ...extra) {
      noExtraArgs("turn", "a shape and a list of angles", 2, extra);
      if (!isHandle(target))
        throw new Error("turn() needs a shape: turn(shape, [rx, ry, rz]).");
      const f = findFeature(target.id);
      if (f.kind === "sphere") {
        readVec3("turn", "angles", angles);
        return target;
      }
      const [rx, ry, rz] = readVec3("turn", "angles", angles);
      if (f.kind === "sketch" || f.kind === "datum") {
        throw new Error(`turn() needs a solid shape, and a ${f.kind} is flat. Pull or spin it into a shape first, then turn that.`);
      }
      if (!canRotate(f)) {
        const step = newRotate(docNow(), target.id, [0, 0, 0]);
        step.angles = [num2(rx, step.id, "rx"), num2(ry, step.id, "ry"), num2(rz, step.id, "rz")];
        pushFeature(step);
        mutateHandle(target, step);
        return target;
      }
      const next = { ...f, rotate: [num2(rx, target.id, "rx"), num2(ry, target.id, "ry"), num2(rz, target.id, "rz")] };
      replaceFeature(target.id, next);
      return target;
    }
    function combine(fn, op, args) {
      if (args.length < 2 || !args.every(isHandle)) {
        throw new Error(`${fn}() needs two or more shapes: ${fn}(a, b).`);
      }
      const handles = args;
      const id = nextId(docNow(), "op");
      const f = { id, kind: "combine", op, targets: handles.map((h) => h.id) };
      pushFeature(f);
      return makeSolidHandle(f);
    }
    const join = (...args) => combine("join", "union", args);
    const cut = (...args) => combine("cut", "subtract", args);
    const keep = (...args) => combine("keep", "intersect", args);
    function primitiveExtreme(id, axis, dir) {
      const f = findFeature(id);
      const half = extentAlong(docNow(), id, axis);
      const center = f.kind === "box" || f.kind === "cylinder" || f.kind === "sphere" || f.kind === "cone" || f.kind === "torus" ? f.center[axis === "x" ? 0 : axis === "y" ? 1 : 2] : 0;
      if (half == null)
        return 0;
      return dir === "lo" ? center - half / 2 : center + half / 2;
    }
    function draft(arg, angle, opts2) {
      const a = requiredNumber("draft", "angle", angle);
      const extra = readOptions("draft", ["from", "neutral", "whole"], opts2);
      let owner;
      let face;
      let whole = false;
      if (isTopoRef(arg)) {
        if (arg.name.cause !== "primitive")
          throw new Error('draft() needs a flat face -- try draft(shape.face("right"), angle).');
        owner = arg.owner;
        face = arg.name;
      } else if (isHandle(arg)) {
        owner = arg;
        whole = true;
      } else {
        throw new Error('draft() needs a face (shape.face("right")) or a whole shape to draft: draft(shape, angle, { whole: true }).');
      }
      if (extra.whole === true)
        whole = true;
      let pull2 = "z";
      let neutral = 0;
      if (extra.from !== void 0) {
        if (typeof extra.from !== "string" || !(extra.from in FACE_AXIS)) {
          throw new Error(`draft()'s "from" needs a face word (top, bottom, front, back, left, right). You gave it ${describe2(extra.from)}.`);
        }
        pull2 = FACE_AXIS[extra.from];
        const dir = extra.from === "bottom" || extra.from === "front" || extra.from === "left" ? "lo" : "hi";
        neutral = primitiveExtreme(owner.rootId, pull2, dir);
      }
      if (extra.neutral !== void 0)
        neutral = requiredNumber("draft", "neutral", extra.neutral);
      const id = nextId(docNow(), "draft");
      const f = { id, kind: "draft", target: owner.id, angle: num2(a, id, "angle"), pull: pull2, neutral, whole: whole || void 0 };
      if (!whole && face)
        f.face = face;
      pushFeature(f);
      mutateHandle(owner, f);
      return owner;
    }
    function param(name, value, opts2) {
      if (typeof name !== "string" || !name) {
        throw new Error(`param() needs a name first: param("wall", 2). You gave it ${describe2(name)}.`);
      }
      if (usedParamNames.has(name)) {
        throw new Error(`param() already used the name "${name}" earlier in this script. Give each one its own name.`);
      }
      const v = requiredNumber("param", "value", value);
      const extra = readOptions("param", ["min", "max", "step", "caption"], opts2);
      usedParamNames.add(name);
      const min = optionalNumber("param", "min", extra.min) ?? 0;
      const max = optionalNumber("param", "max", extra.max) ?? Math.max(100, Math.ceil(Math.abs(v) * 4) || 100);
      const step = optionalNumber("param", "step", extra.step) ?? 1;
      const caption = typeof extra.caption === "string" ? extra.caption : name;
      namedParams.set(name, { name, caption, value: v, min, max, step });
      return new ParamNumber(v, name);
    }
    const fns = {
      box,
      cylinder,
      sphere,
      cone,
      ring,
      prism,
      wedge,
      groove,
      pocket,
      hole,
      holes,
      hollow,
      round,
      bevel,
      repeat,
      repeatAround,
      mirror,
      move,
      turn,
      join,
      cut,
      keep,
      draft,
      sketch,
      plane,
      pull,
      spin,
      blend,
      param,
      // Official names: SAME reference as their student alias (SPEC-S2) — an
      // alias that wrapped instead would drift the moment the student word's
      // implementation changed. tsc enforces every VOCABULARY entry has a key
      // here, both directions.
      cuboid: box,
      torus: ring,
      fillet: round,
      chamfer: bevel,
      shell: hollow,
      subtract: cut,
      union: join,
      intersect: keep,
      linearPattern: repeat,
      polarPattern: repeatAround,
      extrude: pull,
      revolve: spin,
      loft: blend
    };
    const globals = fns;
    const scope = new Proxy(globals, {
      set(_target, prop) {
        const name = String(prop);
        throw new Error(`"${name}" is already a reSHape tool here (you call it like ${name}(...)) -- you can't assign to it directly with "${name} = ...". If you want your own value with that name, declare it first: "const ${name} = ...".`);
      }
    });
    const wrapped = `with(${SCOPE_NAME}){
${source}
}
//# sourceURL=${SOURCE_NAME}`;
    const errors = [];
    try {
      const fn = new Function(SCOPE_NAME, wrapped);
      fn(scope);
    } catch (err) {
      errors.push({ message: friendlyMessage(err), line: lineOf(err) });
    }
    const doc = docNow();
    let finalDoc = doc;
    if (opts.values) {
      for (const [key, value] of Object.entries(opts.values)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          finalDoc = applyParam(finalDoc, key, value);
        }
      }
    }
    const auto = generatedParams(finalDoc);
    const consumedNames = /* @__PURE__ */ new Set();
    const params = auto.map((p) => {
      const overrideName = slotOverrides.get(p.name);
      const named = overrideName ? namedParams.get(overrideName) : void 0;
      if (named) {
        consumedNames.add(named.name);
        const value = Number.isFinite(p.value) ? p.value : named.value;
        return { name: p.name, caption: named.caption, value, min: named.min, max: named.max, step: named.step };
      }
      return { name: p.name, caption: p.caption, value: p.value, min: p.min, max: p.max, step: p.step };
    });
    for (const def of namedParams.values()) {
      if (!consumedNames.has(def.name))
        params.push(def);
    }
    const slotsByParamName = /* @__PURE__ */ new Map();
    for (const [slotKey, paramName] of slotOverrides) {
      const list = slotsByParamName.get(paramName);
      if (list)
        list.push(slotKey);
      else
        slotsByParamName.set(paramName, [slotKey]);
    }
    const namedParamsOut = [...namedParams.values()].map((def) => ({
      ...def,
      slots: slotsByParamName.get(def.name) ?? []
    }));
    for (const f of finalDoc.features) {
      if (f.kind !== "sketch" || !f.rounds && !f.chamfers)
        continue;
      try {
        for (const n of outlineOf(f).notes) {
          const word = f.rounds && f.rounds[n.corner] !== void 0 ? "round" : "chamfer";
          const fmt = (v) => String(Math.round(v * 100) / 100);
          ruleWarnings.push(n.got > 0 ? `.${word}(${n.corner + 1}, ${fmt(n.want)}) is more than corner ${n.corner + 1} has room for, so it was made ${fmt(n.got)} instead.` : `.${word}(${n.corner + 1}, ${fmt(n.want)}) was left out: corner ${n.corner + 1} cannot take a ${word} (its edges are curved, in a straight line, or have no length).`);
        }
      } catch {
      }
    }
    return {
      doc: finalDoc,
      params,
      namedParams: namedParamsOut,
      errors,
      ...ruleWarnings.length > 0 ? { warnings: ruleWarnings } : {}
    };
  }

  // ../friendly-sketch.mjs
  var DRIFT = "this runner build does not match the interpreter version (it cannot find the interpreter's sketch tool); friendly sketch syntax is unavailable. Rebuild the runner bundle (phase5/host/build.sh).";
  var PREAMBLE = "(function (s) { if (!s || typeof s.sketch !== 'function') throw new Error(" + JSON.stringify(DRIFT) + "); Object.defineProperty(s, 'sketch', { value: globalThis.__FRIENDLY__.wrap(s.sketch), writable: true, configurable: true, enumerable: true }); })(typeof __RESHAPE_SCOPE__ === 'undefined' ? undefined : __RESHAPE_SCOPE__);";
  var withPreamble = (src) => `${PREAMBLE} ${src}`;
  function install(g = globalThis) {
    g.__FRIENDLY__ = { wrap, PREAMBLE };
    return g.__FRIENDLY__;
  }
  var INFO = /* @__PURE__ */ new WeakMap();
  var isNum = (v) => (typeof v === "number" || v instanceof Number) && Number.isFinite(Number(v));
  var num = (v) => Number(v);
  var isVec = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x));
  var KIND_WORD = { line: "a line", circle: "a circle", arc: "an arc", point: "a point" };
  var SKETCH_SEQ = 0;
  function describe3(v) {
    if (v === void 0) return "nothing (undefined)";
    if (v === null) return "null";
    if (typeof v === "number" || v instanceof Number) return Number.isNaN(Number(v)) ? "NaN" : String(Number(v));
    if (typeof v === "string") return `the text "${v}"`;
    if (typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return `a list of ${v.length}`;
    const i = INFO.get(v);
    if (i) {
      if (i.t === "point") return i.origin ? "the origin" : i.rec.kind === "point" ? "a point" : `the ${i.end === "c" ? "centre" : i.end === "a" ? "start" : "end"} point of ${KIND_WORD[i.rec.kind]}`;
      if (i.t === "axis") return `the ${i.name} axis`;
      return KIND_WORD[i.rec.kind] ?? "a shape";
    }
    if (typeof v === "function") return "a function";
    if (typeof v === "object") return "a { } object";
    return String(v);
  }
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function nearest(word, words, max) {
    let best = null, bd = Infinity;
    for (const w of words) {
      const d = lev(word.toLowerCase(), w.toLowerCase());
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return bd <= (max ?? Math.max(2, Math.ceil(word.length / 3))) ? best : null;
  }
  var REAL_MUTATORS = ["rect", "circle", "polygon", "round", "chamfer", "across", "up", "length", "equal", "parallel", "perpendicular", "pin", "distX", "distY", "symmetric", "angle", "geom", "rules", "slot"];
  var FRIENDLY_METHODS = [
    "line",
    "circle",
    "arc",
    "point",
    "lines",
    "rectangle",
    "join",
    "tangent",
    "horizontal",
    "vertical",
    "parallel",
    "perpendicular",
    "equal",
    "pointOn",
    "symmetric",
    "length",
    "distance",
    "dx",
    "dy",
    "radius",
    "diameter",
    "angle",
    "fix",
    "at",
    "remove",
    "soup"
  ];
  var ALL_NAMES = [.../* @__PURE__ */ new Set([...FRIENDLY_METHODS, ...REAL_MUTATORS, "origin", "xAxis", "yAxis", "id"])];
  function wrap(realSketch) {
    if (typeof realSketch !== "function") throw new Error("the friendly sketch layer could not find the interpreter's sketch() (internal scope name changed?).");
    SKETCH_SEQ = 0;
    return function sketch(...args) {
      const real = realSketch(...args);
      return makeFriendly(real);
    };
  }
  function makeFriendly(real) {
    const seq = ++SKETCH_SEQ;
    const tok = { seq };
    const shapes = [];
    const rules = [];
    const joined = [];
    let friendlyUsed = false, realUsed = false, rulesWritten = false;
    const where = `sketch #${seq}`;
    const fail = (msg) => {
      throw new Error(msg);
    };
    const arity = (fn, args, min, max, usage) => {
      if (args.length < min || args.length > max) {
        fail(`${fn}() takes ${min === max ? min === 1 ? "one argument" : `${min} arguments` : `${min} to ${max} arguments`}: ${usage}. You gave it ${args.length}.`);
      }
    };
    const own = (fn, v) => {
      const i = INFO.get(v);
      if (i && i.sk !== tok && i.t !== "axis") {
        fail(`${fn}() was given ${describe3(v)} that belongs to a different sketch() than this one (this is ${where}). A constraint can only tie together things drawn on the same sketch.`);
      }
      return i;
    };
    const alive = (fn, v, i) => {
      if (i.rec && i.rec.removed) fail(`${fn}() was given ${describe3(v)} that was removed with sk.remove(). Draw it again, or leave out the constraint that uses it.`);
    };
    const point = (fn, label, v) => {
      if (isVec(v)) return { xy: [v[0], v[1]] };
      const i = own(fn, v);
      if (i && i.t === "point") {
        alive(fn, v, i);
        return { xy: i.xy(), ref: i };
      }
      if (i) fail(`${fn}() needs ${label} as [x, y] or a point like line.a, line.b, arc.c or sk.origin, but got ${describe3(v)}.${i.t === "shape" && i.rec.kind === "circle" ? " A circle's centre is circle.c." : ""}`);
      if (Array.isArray(v) && v.length === 2) fail(`${fn}() needs ${label} as two plain numbers [x, y], got [${v.map((x) => typeof x === "number" ? String(x) : describe3(x)).join(", ")}].`);
      fail(`${fn}() needs ${label} as [x, y] or a point like line.a, line.b, arc.c or sk.origin, but got ${describe3(v)}.`);
    };
    const shape = (fn, label, v, kinds, opts = {}) => {
      const i = own(fn, v);
      const want = kinds.map((k) => KIND_WORD[k]).join(" or ");
      if (i && i.t === "axis" && opts.axes) return { axis: i, id: i.id, kind: "line" };
      if (i && i.t === "point" && !i.origin && i.rec.kind === "point") {
        alive(fn, v, i);
        if (!kinds.includes("point")) fail(`${fn}() needs ${label} to be ${want}, but got ${describe3(v)}.${opts.hint ? " " + opts.hint("point") : ""}`);
        return { rec: i.rec, kind: "point" };
      }
      if (i && i.t === "shape") {
        alive(fn, v, i);
        if (!kinds.includes(i.rec.kind)) fail(`${fn}() needs ${label} to be ${want}, but got ${describe3(v)}.${opts.hint ? " " + opts.hint(i.rec.kind) : ""}`);
        return { rec: i.rec, kind: i.rec.kind };
      }
      if (i) fail(`${fn}() needs ${label} to be ${want}, but got ${describe3(v)}.`);
      fail(`${fn}() needs ${label} to be ${want} drawn on this sketch (for example the result of sk.line(...)), but got ${describe3(v)}.`);
    };
    const value = (fn, label, v, { positive = false } = {}) => {
      if (!isNum(v)) fail(`${fn}() needs ${label} as a finite number, but got ${describe3(v)}.`);
      if (positive && !(num(v) > 0)) fail(`${fn}() needs ${label} above 0, but got ${num(v)}.`);
      return v;
    };
    const options = (fn, v, allowed) => {
      if (v === void 0) return {};
      if (!v || typeof v !== "object" || Array.isArray(v) || INFO.has(v)) fail(`${fn}() takes its options as an object like { ${allowed[0]}: true }, got ${describe3(v)}.`);
      for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`${fn}() does not know the option "${k}". Its options are: ${allowed.join(", ")}.`);
      if (v.construction !== void 0 && typeof v.construction !== "boolean") fail(`${fn}() option construction must be true or false, got ${describe3(v.construction)}.`);
      return v;
    };
    const noReal = (fn) => {
      if (realUsed) fail(`${fn}() cannot be used on ${where}: it already has geometry from sk.rect / sk.circle(diameter) / sk.polygon / sk.geom / sk.slot. Draw friendly shapes on their own sketch(), or write the whole sketch one way.`);
    };
    const originRef = { t: "point", sk: tok, origin: true, end: "a", xy: () => [0, 0] };
    const mkPoint = (rec, end) => {
      const o = Object.freeze({ kind: "point" });
      INFO.set(o, { t: "point", sk: tok, rec, end, xy: () => rec.xy(end) });
      return o;
    };
    const originHandle = Object.freeze({ kind: "point" });
    INFO.set(originHandle, originRef);
    const axisHandle = (name, id) => {
      const o = Object.freeze({ kind: "axis", name });
      INFO.set(o, { t: "axis", sk: tok, name, id });
      return o;
    };
    const xAxis = axisHandle("X", -2), yAxis = axisHandle("Y", -3);
    const STR_PROPS = /* @__PURE__ */ new Set(["then", "toJSON", "toString", "valueOf", "constructor", "inspect", "asymmetricMatch", "nodeType", "tagName"]);
    const PARTS = { line: ["kind", "a", "b"], circle: ["kind", "c"], arc: ["kind", "a", "b", "c"], point: ["kind"] };
    const PART_HELP = { line: "a line has .a (start point) and .b (end point)", circle: "a circle has .c (centre point)", arc: "an arc has .a (start), .b (end) and .c (centre)", point: "a point has no parts; use it directly" };
    function publish(rec) {
      const base = { kind: rec.kind };
      for (const e of ["a", "b", "c"]) if (rec.ends.includes(e)) base[e] = mkPoint(rec, e);
      if (rec.kind === "point") {
        const pt = mkPoint(rec, "a");
        rec.handle = pt;
        return pt;
      }
      const target = base;
      const h = new Proxy(target, {
        get(t, p, r) {
          if (typeof p === "symbol" || STR_PROPS.has(p) || p in t) return Reflect.get(t, p, r);
          const hint = nearest(p, PARTS[rec.kind].filter((x) => x !== "kind"), 1);
          fail(`${KIND_WORD[rec.kind][0].toUpperCase()}${KIND_WORD[rec.kind].slice(1)} has no .${p}${hint ? ` (did you mean .${hint}?)` : ""}: ${PART_HELP[rec.kind]}.`);
        },
        set() {
          fail("Sketch handles are read-only: change a shape by constraining it (sk.length, sk.at, sk.fix ...), not by assigning to it.");
        }
      });
      INFO.set(h, { t: "shape", sk: tok, rec });
      rec.handle = h;
      return h;
    }
    const newShape2 = (kind, data, construction, ends) => {
      friendlyUsed = true;
      const rec = {
        kind,
        data,
        construction: !!construction,
        removed: false,
        id: 0,
        ends,
        xy(end) {
          if (kind === "line") return end === "b" ? data.b : data.a;
          if (kind === "circle") return data.c;
          if (kind === "arc") return end === "b" ? data.b : end === "c" ? data.c : data.a;
          return data.p;
        }
      };
      shapes.push(rec);
      return rec;
    };
    const addRule = (uses, build) => {
      rules.push({ uses, build });
    };
    const ref = (pi) => pi.origin ? { id: -1, end: "a" } : { id: pi.rec.id, end: pi.end };
    const sameEnd = (x, y) => x.origin && y.origin || !x.origin && !y.origin && x.rec === y.rec && x.end === y.end;
    const isJoined = (x, y) => sameEnd(x, y) || joined.some(([p, q]) => sameEnd(p, x) && sameEnd(q, y) || sameEnd(p, y) && sameEnd(q, x));
    const usesOf = (...pis) => pis.filter((p) => p && !p.origin).map((p) => p.rec);
    const endpoint = (rec, end, pt) => {
      if (pt.ref) {
        const ni = { t: "point", sk: tok, rec, end };
        joined.push([pt.ref, ni]);
        addRule([rec, ...usesOf(pt.ref)], () => {
          const e = ref(pt.ref);
          return { k: "coincident", a: e.id, aEnd: e.end, b: rec.id, bEnd: end };
        });
      }
      return pt.xy;
    };
    function lower() {
      const live = shapes.filter((s) => !s.removed);
      live.forEach((s, i) => {
        s.id = i + 1;
      });
      const geoms = live.map((s) => {
        const c = s.construction ? { construction: true } : {};
        const d = s.data;
        if (s.kind === "line") return { k: "line", id: s.id, a: [...d.a], b: [...d.b], ...c };
        if (s.kind === "circle") return { k: "circle", id: s.id, c: [...d.c], r: d.r, ...c };
        if (s.kind === "arc") return { k: "arc", id: s.id, c: [...d.c], r: d.r, a: [...d.a], b: [...d.b], sense: d.sense, ...c };
        return { k: "point", id: s.id, p: [...d.p], ...c };
      });
      const rows = rules.filter((r) => !r.uses.some((u) => u.removed)).map((r) => r.build());
      return { geoms, rows };
    }
    function flush(call) {
      const { geoms, rows } = lower();
      if (shapes.length > 0 && geoms.length === 0) {
        fail(`${call}() would leave this sketch with no shapes, and an empty sketch is drawn as a default 40 x 25 rectangle. Draw the shape you want instead, or do not remove the last one.`);
      }
      try {
        if (geoms.length || shapes.length) real.geom(geoms);
        if (rows.length || rulesWritten) {
          real.rules(rows);
          rulesWritten = true;
        }
      } catch (e) {
        throw new Error(`${call}() was accepted here but the interpreter refused the sketch it makes: ${e.message}`);
      }
    }
    const op = (call, f) => (...args) => {
      noReal(call);
      const nShapes = shapes.length, nRules = rules.length, nJoined = joined.length;
      try {
        const out = f(...args);
        flush(call);
        return out;
      } catch (e) {
        shapes.length = nShapes;
        rules.length = nRules;
        joined.length = nJoined;
        throw e;
      }
    };
    const line = op("sk.line", (...a) => {
      arity("sk.line", a, 2, 3, "sk.line(start, end), each a [x, y] or a point like other.b");
      const opts = options("sk.line", a[2], ["construction"]);
      const p = point("sk.line", "the start", a[0]), q = point("sk.line", "the end", a[1]);
      if (Math.hypot(q.xy[0] - p.xy[0], q.xy[1] - p.xy[1]) < 1e-9) fail("sk.line() was given the same point for its start and its end, so the line would have no length.");
      const near = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 1e-9;
      const twin = shapes.find((x) => !x.removed && x.kind === "line" && (near(x.data.a, p.xy) && near(x.data.b, q.xy) || near(x.data.a, q.xy) && near(x.data.b, p.xy)));
      if (twin) fail("sk.line() would draw a second line exactly on top of an existing line (same two ends). Use the line you already have, or move one end.");
      const rec = newShape2("line", { a: p.xy, b: q.xy }, opts.construction, ["a", "b"]);
      endpoint(rec, "a", p);
      endpoint(rec, "b", q);
      return publish(rec);
    });
    const circle = op("sk.circle", (...a) => {
      arity("sk.circle", a, 2, 2, "sk.circle([x, y], { r: 5 }) or sk.circle([x, y], { across: 10 })");
      const o = options("sk.circle", a[1], ["r", "across", "construction"]);
      if (o.r === void 0 === (o.across === void 0)) fail("sk.circle() needs exactly one of { r: radius } or { across: diameter } as its size.");
      const r = o.r !== void 0 ? value("sk.circle", "r (the radius)", o.r, { positive: true }) : isNum(o.across) && num(o.across) > 0 ? num(o.across) / 2 : value("sk.circle", "across (the diameter)", o.across, { positive: true });
      const c = point("sk.circle", "the centre", a[0]);
      const rec = newShape2("circle", { c: c.xy, r }, o.construction, ["c"]);
      endpoint(rec, "c", c);
      return publish(rec);
    });
    const arc = op("sk.arc", (...a) => {
      arity("sk.arc", a, 4, 5, "sk.arc(centre, from, to, 'cw' or 'ccw')");
      const sense = a[3];
      if (sense !== "cw" && sense !== "ccw") fail(`sk.arc() needs the direction as the text 'cw' or 'ccw' (the way it runs from "from" to "to"), but got ${describe3(sense)}.`);
      const opts = options("sk.arc", a[4], ["construction"]);
      const c = point("sk.arc", "the centre", a[0]), f = point("sk.arc", "the start (from)", a[1]), t = point("sk.arc", "the end (to)", a[2]);
      const r = Math.hypot(f.xy[0] - c.xy[0], f.xy[1] - c.xy[1]), r2 = Math.hypot(t.xy[0] - c.xy[0], t.xy[1] - c.xy[1]);
      if (!(r > 1e-9)) fail("sk.arc() has its start on its centre, so it has no radius.");
      if (Math.abs(r - r2) > 1e-3 * Math.max(1, r)) fail(`sk.arc() has its start ${+r.toFixed(6)} from the centre but its end ${+r2.toFixed(6)} from it: both ends of an arc must sit on the same circle. Move one end, then dimension the radius with sk.radius().`);
      if (Math.hypot(t.xy[0] - f.xy[0], t.xy[1] - f.xy[1]) < 1e-9 * Math.max(1, r)) fail("sk.arc() has the same point for its start and end; draw a full circle with sk.circle().");
      const rec = newShape2("arc", { c: c.xy, r, a: f.xy, b: t.xy, sense }, opts.construction, ["a", "b", "c"]);
      endpoint(rec, "c", c);
      endpoint(rec, "a", f);
      endpoint(rec, "b", t);
      return publish(rec);
    });
    const pointShape = op("sk.point", (...a) => {
      arity("sk.point", a, 1, 2, "sk.point([x, y])");
      const opts = options("sk.point", a[1], ["construction"]);
      const p = point("sk.point", "the position", a[0]);
      const rec = newShape2("point", { p: p.xy }, opts.construction, ["a"]);
      endpoint(rec, "a", p);
      return publish(rec);
    });
    const lines = (...a) => {
      arity("sk.lines", a, 1, 2, "sk.lines([[x, y], [x, y], ...], { closed: true })");
      const pts = a[0];
      const o = a[1] === void 0 ? {} : a[1];
      if (a[1] !== void 0) {
        if (!a[1] || typeof a[1] !== "object" || Array.isArray(a[1])) fail(`sk.lines() takes its options as an object like { closed: true }, got ${describe3(a[1])}.`);
        for (const k of Object.keys(o)) if (!["closed", "construction"].includes(k)) fail(`sk.lines() does not know the option "${k}". Its options are: closed, construction.`);
      }
      if (!Array.isArray(pts) || pts.length < 2) fail(`sk.lines() needs a list of at least 2 points like [[0, 0], [40, 0], [40, 20]], but got ${describe3(pts)}.`);
      pts.forEach((p, i) => {
        if (!isVec(p)) fail(`sk.lines() point ${i + 1} must be [x, y] with plain numbers, but got ${describe3(p)}.`);
      });
      const n = o.closed ? pts.length : pts.length - 1;
      if (o.closed && pts.length < 3) fail("sk.lines() with { closed: true } needs at least 3 points.");
      const out = [];
      for (let i = 0; i < n; i++) out.push(line(pts[i], pts[(i + 1) % pts.length], o.construction ? { construction: true } : void 0));
      const m = out.length;
      const jn = o.closed ? m : m - 1;
      for (let i = 0; i < jn; i++) join(out[i].b, out[(i + 1) % m].a);
      return out;
    };
    const rectangle = (...a) => {
      arity("sk.rectangle", a, 2, 2, "sk.rectangle([x0, y0], [x1, y1]) (two opposite corners)");
      const p0 = a[0], p1 = a[1];
      if (!isVec(p0) || !isVec(p1)) fail(`sk.rectangle() needs two corners as [x, y] with plain numbers, but got ${describe3(p0)} and ${describe3(p1)}.`);
      if (Math.abs(p1[0] - p0[0]) < 1e-9 || Math.abs(p1[1] - p0[1]) < 1e-9) fail("sk.rectangle() has two corners on one horizontal or vertical line, so it would have no area.");
      const [x0, y0] = p0, [x1, y1] = p1;
      const ls = [line([x0, y0], [x1, y0]), line([x1, y0], [x1, y1]), line([x1, y1], [x0, y1]), line([x0, y1], [x0, y0])];
      for (let i = 0; i < 4; i++) join(ls[i].b, ls[(i + 1) % 4].a);
      horizontal(ls[0]);
      vertical(ls[1]);
      horizontal(ls[2]);
      vertical(ls[3]);
      return { bottom: ls[0], right: ls[1], top: ls[2], left: ls[3], lines: ls };
    };
    const join = op("sk.join", (...a) => {
      arity("sk.join", a, 2, 2, "sk.join(pointA, pointB), for example sk.join(top.b, left.a)");
      const p = point("sk.join", "the first point", a[0]), q = point("sk.join", "the second point", a[1]);
      if (!p.ref || !q.ref) fail("sk.join() needs two point handles (like top.b and left.a), not [x, y] coordinates: say which drawn points meet.");
      if (sameEnd(p.ref, q.ref)) fail("sk.join() was given the same point twice.");
      if (isJoined(p.ref, q.ref)) return;
      joined.push([p.ref, q.ref]);
      addRule(usesOf(p.ref, q.ref), () => {
        const x = ref(p.ref), y = ref(q.ref);
        return { k: "coincident", a: x.id, aEnd: x.end, b: y.id, bEnd: y.end };
      });
    });
    const lineRule = (name, kind) => op(`sk.${name}`, (...a) => {
      arity(`sk.${name}`, a, 1, 1, `sk.${name}(line)`);
      const s = shape(`sk.${name}`, "its argument", a[0], ["line"]);
      addRule([s.rec], () => ({ k: kind, a: s.rec.id }));
    });
    const horizontal = lineRule("horizontal", "horizontal"), vertical = lineRule("vertical", "vertical");
    const pairRule = (name, kind) => op(`sk.${name}`, (...a) => {
      arity(`sk.${name}`, a, 2, 2, `sk.${name}(lineA, lineB)`);
      const s = shape(`sk.${name}`, "the first line", a[0], ["line"], { axes: true }), t = shape(`sk.${name}`, "the second line", a[1], ["line"], { axes: true });
      if (s.rec && s.rec === t.rec) fail(`sk.${name}() was given the same line twice.`);
      addRule([s.rec, t.rec].filter(Boolean), () => ({ k: kind, a: s.axis ? s.id : s.rec.id, b: t.axis ? t.id : t.rec.id }));
    });
    const parallel = pairRule("parallel", "parallel"), perpendicular = pairRule("perpendicular", "perpendicular");
    const equal = op("sk.equal", (...a) => {
      arity("sk.equal", a, 2, 2, "sk.equal(lineA, lineB) or sk.equal(roundA, roundB)");
      const s = shape("sk.equal", "the first shape", a[0], ["line", "circle", "arc"]), t = shape("sk.equal", "the second shape", a[1], ["line", "circle", "arc"]);
      const rd = (k) => k !== "line";
      if (rd(s.kind) !== rd(t.kind)) fail(`sk.equal() was given ${describe3(a[0])} and ${describe3(a[1])}: equal ties two lines (same length) or two circles/arcs (same radius), not a length to a radius.`);
      if (s.rec === t.rec) fail("sk.equal() was given the same shape twice.");
      addRule([s.rec, t.rec], () => ({ k: "equal", a: s.rec.id, b: t.rec.id }));
    });
    const pointOn = op("sk.pointOn", (...a) => {
      arity("sk.pointOn", a, 2, 2, "sk.pointOn(point, shape), for example sk.pointOn(corner.a, ring)");
      const p = point("sk.pointOn", "the point", a[0]);
      if (!p.ref) fail("sk.pointOn() needs a point handle (like line.a), not [x, y] coordinates.");
      const s = shape("sk.pointOn", "the shape", a[1], ["line", "circle", "arc"], { axes: true });
      if (s.rec && !p.ref.origin && p.ref.rec === s.rec) fail("sk.pointOn() was given a point of the shape itself; a shape's own point is already on it.");
      addRule([...usesOf(p.ref), s.rec].filter(Boolean), () => {
        const e = ref(p.ref);
        return { k: "pointOnObject", a: e.id, aEnd: e.end, b: s.axis ? s.id : s.rec.id };
      });
    });
    const tangent = op("sk.tangent", (...a) => {
      arity("sk.tangent", a, 2, 2, "sk.tangent(endA, endB) at a joint, or sk.tangent(curveA, curveB)");
      const ia = INFO.get(a[0]), ib = INFO.get(a[1]);
      const isEnd = (i) => i && i.t === "point" && !i.origin;
      if (isEnd(ia) || isEnd(ib)) {
        const p = point("sk.tangent", "the first end", a[0]), q = point("sk.tangent", "the second end", a[1]);
        if (!p.ref || !q.ref) fail("sk.tangent() joint form needs two point handles (like top.a and left.b), not [x, y] coordinates.");
        const okEnd = (r) => !r.origin && (r.rec.kind === "line" || r.rec.kind === "arc") && r.end !== "c";
        for (const [r, v, w] of [[p.ref, a[0], "first"], [q.ref, a[1], "second"]]) {
          if (!okEnd(r)) fail(`sk.tangent() joint form needs the START or END of a line or arc as the ${w} point (like top.a or left.b), but got ${describe3(v)}.`);
        }
        if (p.ref.rec === q.ref.rec) fail("sk.tangent() was given two ends of the same shape.");
        if (p.ref.rec.kind === "line" && q.ref.rec.kind === "line") fail("sk.tangent() was given two straight lines: two lines are never tangent (they are parallel or they cross). Use sk.parallel(), or join them with sk.join().");
        const had = isJoined(p.ref, q.ref);
        if (!had) joined.push([p.ref, q.ref]);
        if (!had) addRule([p.ref.rec, q.ref.rec], () => ({ k: "coincident", a: p.ref.rec.id, aEnd: p.ref.end, b: q.ref.rec.id, bEnd: q.ref.end }));
        addRule([p.ref.rec, q.ref.rec], () => ({ k: "tangent", a: p.ref.rec.id, aEnd: p.ref.end, b: q.ref.rec.id, bEnd: q.ref.end }));
        return;
      }
      const hint = (k) => k === "point" ? "Tangent is between lines, circles and arcs." : "";
      const s = shape("sk.tangent", "the first curve", a[0], ["line", "circle", "arc"], { axes: true, hint }), t = shape("sk.tangent", "the second curve", a[1], ["line", "circle", "arc"], { axes: true, hint });
      if (s.rec && s.rec === t.rec) fail("sk.tangent() was given the same shape twice.");
      if (s.kind === "line" && t.kind === "line") fail("sk.tangent() was given two straight lines: two lines are never tangent (they are parallel or they cross). Use sk.parallel(), or join them with sk.join().");
      const endsOf = (x) => x.rec ? x.rec.ends.filter((e) => e !== "c") : [];
      const hits = [];
      if (s.rec && t.rec) for (const ea2 of endsOf(s)) for (const eb2 of endsOf(t)) {
        if (isJoined({ rec: s.rec, end: ea2 }, { rec: t.rec, end: eb2 })) hits.push([ea2, eb2]);
      }
      if (hits.length > 1) fail(`sk.tangent() was given two shapes that are joined at ${hits.length} ends; say which joint with sk.tangent(endA, endB).`);
      const [ea, eb] = hits[0] ?? [];
      addRule([s.rec, t.rec].filter(Boolean), () => {
        const row = { k: "tangent", a: s.axis ? s.id : s.rec.id };
        if (ea) row.aEnd = ea;
        row.b = t.axis ? t.id : t.rec.id;
        if (eb) row.bEnd = eb;
        return row;
      });
    });
    const length = op("sk.length", (...a) => {
      arity("sk.length", a, 2, 2, "sk.length(line, 40)");
      const s = shape("sk.length", "the first argument", a[0], ["line"], { hint: (k) => k === "circle" || k === "arc" ? "A length is measured along a straight line; use sk.radius() or sk.diameter() for a round shape." : "" });
      const v = value("sk.length", "the length", a[1], { positive: true });
      addRule([s.rec], () => ({ k: "distance", a: s.rec.id, aEnd: "a", b: s.rec.id, bEnd: "b", value: v }));
    });
    const distLike = (name, kind, positive) => op(`sk.${name}`, (...a) => {
      arity(`sk.${name}`, a, 3, 3, `sk.${name}(pointA, pointB, value)`);
      const p = point(`sk.${name}`, "the first point", a[0]), q = point(`sk.${name}`, "the second point", a[1]);
      if (!p.ref || !q.ref) fail(`sk.${name}() needs two point handles (like base.a and hole.c), not [x, y] coordinates.`);
      if (sameEnd(p.ref, q.ref)) fail(`sk.${name}() was given the same point twice.`);
      const v = value(`sk.${name}`, "the value", a[2], { positive });
      addRule(usesOf(p.ref, q.ref), () => {
        const x = ref(p.ref), y = ref(q.ref);
        return { k: kind, a: x.id, aEnd: x.end, b: y.id, bEnd: y.end, value: v };
      });
    });
    const distance = distLike("distance", "distance", true), dx = distLike("dx", "distanceX", false), dy = distLike("dy", "distanceY", false);
    const roundDim = (name) => op(`sk.${name}`, (...a) => {
      arity(`sk.${name}`, a, 2, 2, `sk.${name}(circleOrArc, ${name === "radius" ? 10 : 20})`);
      const s = shape(`sk.${name}`, "the first argument", a[0], ["circle", "arc"], { hint: (k) => k === "line" ? "A line has a length: sk.length(line, value)." : "" });
      const v = value(`sk.${name}`, `the ${name}`, a[1], { positive: true });
      addRule([s.rec], () => ({ k: name, a: s.rec.id, value: v }));
    });
    const radius = roundDim("radius"), diameter = roundDim("diameter");
    const angle = op("sk.angle", (...a) => {
      arity("sk.angle", a, 3, 3, "sk.angle(lineA, lineB, degrees)");
      const s = shape("sk.angle", "the first line", a[0], ["line"]), t = shape("sk.angle", "the second line", a[1], ["line"]);
      if (s.rec === t.rec) fail("sk.angle() needs two different lines.");
      const v = value("sk.angle", "the angle in degrees", a[2]);
      addRule([s.rec, t.rec], () => ({ k: "angle", a: s.rec.id, b: t.rec.id, value: v }));
    });
    const symmetric = op("sk.symmetric", (...a) => {
      arity("sk.symmetric", a, 3, 3, "sk.symmetric(pointA, pointB, about), about being a line, an axis (sk.yAxis) or a centre point");
      const p = point("sk.symmetric", "the first point", a[0]), q = point("sk.symmetric", "the second point", a[1]);
      if (!p.ref || !q.ref) fail("sk.symmetric() needs point handles (like base.a), not [x, y] coordinates.");
      if (sameEnd(p.ref, q.ref)) fail("sk.symmetric() was given the same point twice.");
      const ic = INFO.get(a[2]);
      own("sk.symmetric", a[2]);
      if (ic && ic.t === "point") {
        alive("sk.symmetric", a[2], ic);
        addRule(usesOf(p.ref, q.ref, ic), () => {
          const x = ref(p.ref), y = ref(q.ref), c = ref(ic);
          return { k: "symmetric", a: x.id, aEnd: x.end, b: y.id, bEnd: y.end, c: c.id, cEnd: c.end };
        });
        return;
      }
      const s = shape("sk.symmetric", "the line to mirror about", a[2], ["line"], { axes: true });
      addRule([...usesOf(p.ref, q.ref), s.rec].filter(Boolean), () => {
        const x = ref(p.ref), y = ref(q.ref);
        return { k: "symmetric", a: x.id, aEnd: x.end, b: y.id, bEnd: y.end, c: s.axis ? s.id : s.rec.id };
      });
    });
    const fix = op("sk.fix", (...a) => {
      arity("sk.fix", a, 1, 1, "sk.fix(point), for example sk.fix(base.a)");
      const p = point("sk.fix", "the point", a[0]);
      if (!p.ref) fail("sk.fix() needs a point handle (like base.a), not [x, y] coordinates. To place a point at a position, use sk.at(point, [x, y]).");
      if (p.ref.origin) fail("sk.fix() was given the origin, which is already fixed.");
      addRule(usesOf(p.ref), () => {
        const e = ref(p.ref);
        return { k: "lock", a: e.id, aEnd: e.end };
      });
    });
    const at = op("sk.at", (...a) => {
      arity("sk.at", a, 2, 2, "sk.at(point, [x, y]), measured from the origin");
      const p = point("sk.at", "the point", a[0]);
      if (!p.ref) fail("sk.at() needs a point handle (like base.a) as its first argument.");
      if (p.ref.origin) fail("sk.at() was given the origin, which cannot be moved.");
      if (!isVec(a[1])) fail(`sk.at() needs the position as [x, y] with plain numbers, but got ${Array.isArray(a[1]) ? `[${a[1].map((x2) => typeof x2 === "number" ? String(x2) : describe3(x2)).join(", ")}]` : describe3(a[1])}.`);
      const [x, y] = a[1];
      if (x === 0 && y === 0) {
        joined.push([p.ref, originRef]);
        addRule(usesOf(p.ref), () => {
          const e = ref(p.ref);
          return { k: "coincident", a: e.id, aEnd: e.end, b: -1, bEnd: "a" };
        });
        return;
      }
      addRule(usesOf(p.ref), () => {
        const e = ref(p.ref);
        return { k: "distanceX", a: -1, aEnd: "a", b: e.id, bEnd: e.end, value: x };
      });
      addRule(usesOf(p.ref), () => {
        const e = ref(p.ref);
        return { k: "distanceY", a: -1, aEnd: "a", b: e.id, bEnd: e.end, value: y };
      });
    });
    const remove = (...a) => {
      noReal("sk.remove");
      arity("sk.remove", a, 1, 1, "sk.remove(shape)");
      const s = shape("sk.remove", "its argument", a[0], ["line", "circle", "arc", "point"]);
      s.rec.removed = true;
      try {
        flush("sk.remove");
      } catch (e) {
        s.rec.removed = false;
        throw e;
      }
    };
    const friendly = {
      line,
      circle,
      arc,
      point: pointShape,
      lines,
      rectangle,
      join,
      tangent,
      horizontal,
      vertical,
      parallel,
      perpendicular,
      equal,
      pointOn,
      symmetric,
      length,
      distance,
      dx,
      dy,
      radius,
      diameter,
      angle,
      fix,
      at,
      remove,
      soup: () => {
        const { geoms, rows } = lower();
        return JSON.parse(JSON.stringify({ geom: geoms, rules: rows }));
      }
    };
    const realCall = (name, args, self) => {
      if (friendlyUsed) {
        fail(`sk.${name}() cannot be used on ${where}: it already has shapes drawn with sk.line / sk.circle([x, y], ...) / sk.arc. Do not mix the two ways on one sketch: draw the other shape on its own sketch(), or draw everything with the friendly calls.`);
      }
      realUsed = true;
      const out = real[name](...args);
      return out === real ? self : out;
    };
    const wrapper = new Proxy({}, {
      has: (_t, p) => p === "__reshapeSketch" || p === "id" || ALL_NAMES.includes(p),
      get(_t, p, self) {
        if (p === "__reshapeSketch") return true;
        if (p === "id") return real.id;
        if (typeof p === "symbol" || STR_PROPS.has(p)) return void 0;
        if (p === "origin") return originHandle;
        if (p === "xAxis") return xAxis;
        if (p === "yAxis") return yAxis;
        const isF = Object.prototype.hasOwnProperty.call(friendly, p);
        const isR = REAL_MUTATORS.includes(p);
        if (isF && isR) {
          return (...args) => typeof args[0] === "number" ? realCall(p, args, self) : friendly[p](...args);
        }
        if (isF) return friendly[p];
        if (isR) return (...args) => realCall(p, args, self);
        const hint = nearest(String(p), ALL_NAMES.filter((n) => n !== "id"));
        return () => fail(`sk.${String(p)} is not a sketch tool.${hint ? ` Did you mean sk.${hint}?` : ""} Sketch tools: ${FRIENDLY_METHODS.filter((n) => n !== "soup").join(", ")}; points sk.origin; axes sk.xAxis, sk.yAxis.`);
      },
      set() {
        fail("A sketch is changed with its tools (sk.line, sk.length ...), not by assigning to it.");
      }
    });
    return wrapper;
  }

  // src/runner-entry.mjs
  install(globalThis);
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const d = e.data;
    if (!d || d.source !== "reshape-run" || typeof d.code !== "string" || typeof d.runId !== "number") return;
    const r = runScript(withPreamble(d.code));
    window.parent.postMessage({
      source: "reshape-result",
      runId: d.runId,
      errors: r.errors.map((x) => ({ message: String(x.message), line: x.line })),
      doc: r.errors.length ? null : r.doc
    }, "*");
  });
  window.parent.postMessage({ source: "reshape-runner-ready" }, "*");
})();
