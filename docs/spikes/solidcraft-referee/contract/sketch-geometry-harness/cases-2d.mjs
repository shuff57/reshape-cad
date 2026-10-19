// 2D-only checks: solver DoF (independent hand count + numeric Jacobian rank), outline contact/tangency, tessellation accuracy.
import { runScript, arc, brep, SketchSession2D, solveDoc, measureCase } from './sg-core.mjs';
const { checkRules } = await import('file:///home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/phase2/rule-check.mjs');
const sketchPkg = await import('file:///home/shuff57/Documents/GitHub/reshape-cad/packages/sketch/dist/sketch-solve.js');

const rank = (M, tol = 1e-7) => { // Gaussian elimination with full pivoting on a copy
  const A = M.map((r) => r.slice()); let rk = 0; const rows = A.length, cols = rows ? A[0].length : 0;
  const usedR = new Set(), usedC = new Set();
  for (let step = 0; step < Math.min(rows, cols); step++) {
    let best = 0, bi = -1, bj = -1;
    for (let i = 0; i < rows; i++) if (!usedR.has(i)) for (let j = 0; j < cols; j++) if (!usedC.has(j) && Math.abs(A[i][j]) > best) { best = Math.abs(A[i][j]); bi = i; bj = j; }
    if (best < tol) break;
    usedR.add(bi); usedC.add(bj); rk++;
    for (let i = 0; i < rows; i++) if (i !== bi) { const f = A[i][bj] / A[bi][bj]; for (let j = 0; j < cols; j++) A[i][j] -= f * A[bi][j]; }
  }
  return rk;
};
/** DoF of a points+constraints outline sketch = 2n - rank(d residual / d point), residual from the package's own residualsOf, Jacobian by central differences. */
function outlineDof(f) {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  // residuals are |.| so the Jacobian is 0 AT a solution; differentiate at a generic nearby point (same rank where the constraints are independent)
  const pts = f.points.map((p) => [p[0] + 0.05 * rnd(), p[1] + 0.05 * rnd()]); const cons = f.constraints ?? [];
  const J = [];
  const base = sketchPkg.residualsOf(pts, cons, 1);
  const h = 1e-6;
  const cols = [];
  for (let i = 0; i < pts.length; i++) for (let k = 0; k < 2; k++) {
    const p1 = pts.map((p) => [...p]), p2 = pts.map((p) => [...p]); p1[i][k] += h; p2[i][k] -= h;
    const r1 = sketchPkg.residualsOf(p1, cons, 1), r2 = sketchPkg.residualsOf(p2, cons, 1);
    cols.push(r1.map((v, j) => (v - r2[j]) / (2 * h)));
  }
  for (let j = 0; j < base.length; j++) J.push(cols.map((c) => c[j]));
  return { n: pts.length, equations: base.length, rank: J.length ? rank(J) : 0, dof: 2 * pts.length - (J.length ? rank(J) : 0), residual: Math.max(0, ...base.map(Math.abs)) };
}
function soupDiag(sk) {
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  const err = s.open(JSON.parse(JSON.stringify(sk.geoms)), JSON.parse(JSON.stringify(sk.rules ?? [])));
  let out = { openError: err ?? null };
  if (!err) {
    out.solved = s.solve(); out.diag = s.diagnose(); try { out.profile = s.profile(); } catch { /* none */ }
    try {
      const sg = s.solvedGeoms();
      const rs = checkRules(sg, sk.rules ?? [], sk.geoms).filter((r) => r.residual !== null && r.residual !== undefined);
      out.worstRuleResidual = rs.reduce((m, r) => Math.max(m, r.residual), 0); out.rulesChecked = rs.length;
      // contact: every coincident row's two ends must meet (independent of both solvers)
      out.worstContact = rs.filter((r) => r.kind === 'coincident').reduce((m, r) => Math.max(m, r.residual), 0);
    } catch (e) { out.residualError = String(e.message ?? e); }
  }
  s.close(); return out;
}
const dofCase = (id, feature, script, what, hand, kind = 'soup') => ({
  id, feature, what, custom: async () => {
    const run = runScript(script); const sk = run.doc.features.find((f) => f.kind === 'sketch');
    let rec;
    if (kind === 'outline') { const d = outlineDof(sk); rec = { measured: d, handCount: hand, agree: d.dof === hand }; }
    else {
      const d = soupDiag(sk);
      rec = { brepDof: d.diag?.dof, bucket: d.diag?.bucket, handCount: hand, agree: d.diag?.dof === hand, worstRuleResidual: d.worstRuleResidual, rulesChecked: d.rulesChecked, worstCoincidentGap: d.worstContact, residualError: d.residualError, profile: d.profile ? JSON.stringify(d.profile).slice(0, 200) : null, openError: d.openError };
    }
    return { id, feature, custom: true, outcome: rec.agree ? 'DOF-AGREES' : 'DOF-DIFFERS', summary: rec };
  },
});

const sagitta = (r, n) => r * (1 - Math.cos(Math.PI / n));
const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; };
export const cases = [
  dofCase('dof-rect-outline', '.rect', "const sk = sketch('top'); sk.rect(30, 20, { at: [5, 5] }); extrude(sk, 10)", 'rect = 4 corners, RECTANGLE_CONSTRAINTS (H V H V): x0,y0,w,h free', 4, 'outline'),
  dofCase('dof-polygon-free', '.polygon', "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,10],[0,10]]); extrude(sk, 10)", 'polygon with no rules: 8', 8, 'outline'),
  dofCase('dof-slot-rows', '.slot', "const sk = sketch('top'); sk.slot([0,0],[20,0],5); extrude(sk, 10)", '2 arcs x5 + 2 lines x4 - 4 coincident x2 - 4 tangent x1 = 6', 6),
  dofCase('dof-rect-rows', '.geom', "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[20,0]},{k:'line',id:2,a:[20,0],b:[20,10]},{k:'line',id:3,a:[20,10],b:[0,10]},{k:'line',id:4,a:[0,10],b:[0,0]}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'},{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'},{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'},{k:'horizontal',a:1},{k:'vertical',a:2},{k:'horizontal',a:3},{k:'vertical',a:4}]); extrude(sk, 10)", '4 lines x4 - 4 joins x2 - 4 H/V = 4', 4),
  dofCase('dof-circle-row', '.geom', "const sk = sketch('top'); sk.geom([{k:'circle',id:1,c:[3,4],r:7}]); extrude(sk, 10)", 'circle row: cx, cy, r', 3),
  dofCase('dof-D-shape', '.geom', "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,-10],b:[0,10]},{k:'arc',id:2,c:[0,0],r:10,a:[0,10],b:[0,-10],sense:'cw'}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)", 'line 4 + arc 5 - 2 joins x2 = 5', 5),
  dofCase('dof-plate-hole-rows', 'several shapes', "const sk = sketch('top'); sk.rect(30, 20); sk.circle(6); extrude(sk, 10)", 'rect rows (4) + circle (3) = 7', 7),
  dofCase('dof-concentric3', 'several shapes', "const sk = sketch('top'); sk.circle(24); sk.circle(16); sk.circle(8); extrude(sk, 10)", 'three free circles = 9', 9),
  // outline contact + tangency of rounded/chamfered outlines (independent geometry: angles between edge and arc tangents)
  {
    id: 'outline-round-contact', feature: '.round', what: 'rounded 40x30: every arc end lies on its two neighbours; tangent at the joint; arc radius equals the request', custom: async () => {
      const f = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 30], [0, 30]], rounds: { 0: 5, 1: 5, 2: 5, 3: 5 } };
      const o = arc.outlineOf(f); const pts = o.points, bl = o.bulges ?? {}, n = pts.length;
      let maxTan = 0, maxRad = 0, closed = true; const info = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if (bl[i]) {
          const { center, radius } = arc.arcFromBulge(a, b, bl[i]);
          maxRad = Math.max(maxRad, Math.abs(radius - 5));
          // tangent of the arc at a: perpendicular to (a-center); edge before it runs prev->a
          const prev = pts[(i - 1 + n) % n]; const ex = a[0] - prev[0], ey = a[1] - prev[1]; const el = Math.hypot(ex, ey);
          const rx = a[0] - center[0], ry = a[1] - center[1];
          maxTan = Math.max(maxTan, Math.abs((ex * rx + ey * ry) / (el * Math.hypot(rx, ry)))); // 0 when the edge is perpendicular to the radius (tangent)
          info.push({ i, radius });
        }
      }
      return { id: 'outline-round-contact', custom: true, feature: '.round', outcome: maxTan < 1e-12 && maxRad < 1e-12 ? 'TANGENT-EXACT' : 'TANGENT-OFF', summary: { points: n, arcs: info.length, maxEdgeDotRadius: maxTan, maxRadiusError: maxRad, notes: o.notes } };
    },
  },
  // tessellation accuracy
  {
    id: 'tess-circle', feature: 'tessellate/outlineOf', what: 'tessellate(circle across 10): 48 samples vs the true circle', custom: async () => {
      const f = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, shape: 'circle', points: [[-5, 0], [5, 0]] };
      const t = arc.tessellate(f); const A = polyArea(t); const exact = Math.PI * 25;
      const rr = t.map((p) => Math.hypot(p[0], p[1]));
      return { id: 'tess-circle', custom: true, feature: 'tessellate/outlineOf', outcome: 'MEASURED', summary: { samples: t.length, areaRel: Math.abs(A - exact) / exact, maxRadialError: Math.max(...rr.map((r) => Math.abs(r - 5))), chordSag: sagitta(5, t.length), expectedAreaRelFor48gon: 1 - Math.sin((2 * Math.PI) / 48) / ((2 * Math.PI) / 48) } };
    },
  },
  {
    id: 'tess-rounded-rect', feature: 'tessellate/outlineOf', what: 'tessellate(40x30, r5 corners)', custom: async () => {
      const f = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 30], [0, 30]], rounds: { 0: 5, 1: 5, 2: 5, 3: 5 } };
      const exact = 1200 - 4 * 25 * (1 - Math.PI / 4);
      const raw = arc.tessellate(f); // rounds are NOT applied by tessellate(): it reads points + bulges only
      const o = arc.outlineOf(f); const t = arc.tessellate({ ...f, points: o.points, bulges: o.bulges });
      const A = polyArea(t);
      return { id: 'tess-rounded-rect', custom: true, feature: 'tessellate/outlineOf', outcome: 'MEASURED', summary: { rawTessellateOfRoundedSketch: { samples: raw.length, area: polyArea(raw), note: 'ignores rounds (sharp 40x30)' }, viaOutlineOf: { samples: t.length, areaRel: Math.abs(A - exact) / exact, areaPolyline: A, areaExact: exact }, samplesPerCornerArc: (t.length - 8) / 4 } };
    },
  },
  {
    id: 'tess-bulge-semi', feature: 'tessellate/outlineOf', what: 'tessellate(square 20, edge 3 semicircle bulge 1)', custom: async () => {
      const f = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [20, 0], [20, 20], [0, 20]], bulges: { 2: 1 } };
      const t = arc.tessellate(f); const A = polyArea(t); const exact = 400 + Math.PI * 100 / 2;
      const r = t.filter((p) => p[1] > 20 + 1e-9).map((p) => Math.hypot(p[0] - 10, p[1] - 20));
      return { id: 'tess-bulge-semi', custom: true, feature: 'tessellate/outlineOf', outcome: 'MEASURED', summary: { samples: t.length, areaRel: Math.abs(A - exact) / exact, areaPolyline: A, areaExact: exact, arcPointRadiusDev: r.length ? Math.max(...r.map((x) => Math.abs(x - 10))) : null } };
    },
  },

  {
    id: 'bow-bulge-sagitta', feature: 'bulges', what: 'bowEdge/bulgeFromBow: the stored bulge reproduces the requested sagitta (independent: sagitta from arcFromBulge geometry), signs, ceiling, whyCannotBowEdge', custom: async () => {
      const rows = [];
      const pts = [[0, 0], [20, 0], [20, 20], [0, 20]];
      let worst = 0;
      for (const [e, bow] of [[0, 3], [1, -4], [2, 10], [3, 0.5], [0, -10]]) {
        const f = arc.bowEdge({ points: pts }, e, bow);
        const g = f.bulges?.[e];
        const a = pts[e], b = pts[(e + 1) % 4];
        const { center, radius } = arc.arcFromBulge(a, b, g);
        const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const sag = radius - Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2)); // minor-arc sagitta
        // side: the arc bulges to the RIGHT of a->b for g>0 (ccw polygon: outward)
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = b[0] - a[0], dy = b[1] - a[1];
        const rightNormal = [dy / chord, -dx / chord];
        const side = Math.sign((center[0] - mid[0]) * rightNormal[0] + (center[1] - mid[1]) * rightNormal[1]);
        const want = Math.max(-chord / 2, Math.min(chord / 2, bow));
        worst = Math.max(worst, Math.abs(sag - Math.abs(want)));
        rows.push({ e, bow, bulge: g, sagitta: sag, wanted: want, centreSideVsRightNormal: side, why: arc.whyCannotBowEdge(pts, e, bow) });
      }
      return { id: 'bow-bulge-sagitta', custom: true, feature: 'bulges', outcome: worst < 1e-12 ? 'BOW-EXACT' : 'BOW-OFF', summary: { worstSagittaError: worst, maxBow: arc.maxBow(pts, 0), rows } };
    },
  },
  {
    id: 'limits-and-whys', feature: '.round', what: 'maxFilletRadius / maxChamferDistance vs hand formulas; whyCannotRoundCorner / whyCannotChamferCorner sentences', custom: async () => {
      const hand = (pts, k, kind) => { const n = pts.length, c = pts[k], p = pts[(k + n - 1) % n], q = pts[(k + 1) % n]; const li = Math.hypot(p[0] - c[0], p[1] - c[1]), lo = Math.hypot(q[0] - c[0], q[1] - c[1]); const th = Math.acos(((p[0] - c[0]) * (q[0] - c[0]) + (p[1] - c[1]) * (q[1] - c[1])) / (li * lo)); return kind === 'round' ? (Math.min(li, lo) / 2) * Math.tan(th / 2) : Math.min(li, lo); };
      const shapes = { rect40x30: [[0, 0], [40, 0], [40, 30], [0, 30]], tri: [[0, 0], [20, 0], [0, 10]], hex: Array.from({ length: 6 }, (_, i) => [10 * Math.cos(Math.PI * i / 3), 10 * Math.sin(Math.PI * i / 3)]) };
      let worst = 0; const table = [];
      for (const [name, pts] of Object.entries(shapes)) for (let k = 0; k < pts.length; k++) {
        const r = arc.maxFilletRadius(pts, k), c = arc.maxChamferDistance(pts, k);
        worst = Math.max(worst, Math.abs(r - hand(pts, k, 'round')), Math.abs(c - hand(pts, k, 'chamfer')));
        if (k < 3) table.push({ name, corner: k + 1, maxFillet: r, maxChamfer: c });
      }
      const sq = [[0, 0], [20, 0], [20, 20], [0, 20]];
      return { id: 'limits-and-whys', custom: true, feature: '.round', outcome: worst < 1e-12 ? 'LIMITS-EXACT' : 'LIMITS-OFF', summary: { worstLimitError: worst, table, whys: {
        curvedNeighbour: arc.whyCannotRoundCorner(sq, 1, { 0: 0.5 }), zeroLengthEdge: arc.whyCannotRoundCorner([[0, 0], [0, 0], [20, 0], [20, 20]], 1), straight: arc.whyCannotRoundCorner([[0, 0], [10, 0], [20, 0], [20, 20]], 1), sharp: arc.whyCannotRoundCorner([[0, 0], [20, 0], [0, 0.001]], 1),
        chamferCurved: arc.whyCannotChamferCorner(sq, 1, { 0: 0.5 }), bowTooBig: arc.whyCannotBowEdge(sq, 0, 15) } } };
    },
  },
];
