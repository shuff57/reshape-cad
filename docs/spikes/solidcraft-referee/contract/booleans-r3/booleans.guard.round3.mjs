// SPIKE, referee only (contract / booleans group, round 3; the round-2 text is frozen in booleans-r2/booleans.guard.round2.mjs). The guard and the sentence layer the PAGE has to put
// around the combine step (join / cut / keep) for the statuses in booleans.json to hold. Pure functions: no kernel, no wasm. NOT in the page; the spike wires it into a generated copy of
// phase0/translate.mjs (make-bool-translate-r3.mjs -> bool-translate-r3.mjs) together with the piece-collecting executor booleans-r3/combine-exec.mjs.
//
// What it decides, in order, BEFORE any SolidCraft call for the combine (G1..G14), and AFTER a failed call (plainSentence, G9):
//   G1  same shape twice            -> refuse            (join(a, a), cut(a, a), keep(a, a))
//   G10 tube tool                   -> refuse            (cut with a spin() of a ring-shaped outline unless the tube lies wholly inside the part: through = wrong area, blind = kernel refusal)
//   G2  time budget, hang class     -> refuse            (two cylinders with non-parallel axes; a cylinder whose axis misses a sphere's centre; a cone meeting a round shape other than a coaxial cylinder / cone; a torus meeting anything but a plain box around it or a coaxial cylinder)
//   G13 round shapes tangent along a circle (torus and coaxial cylinder at the inner / outer equator) -> refuse
//   G14 hollow ball                 -> refuse            (a ball with a smaller ball taken out of its inside)
//   G3  sliver overlap              -> refuse            (cut / keep whose overlap is thinner than SLIVER[class] mm: SolidCraft silently ignores it or returns no body)
//   G4/G4b cut that removes nothing -> refuse  (POLICY: the engines agree on the result, the part unchanged)
//   G5  keep that leaves nothing    -> refuse
//   G6  pinch on join               -> refuse            (operands meet only along a line or at a point: not one solid)
//   G7  pinch on cut                -> refuse            (a round tool wholly inside the part touching its surface, or a cylinder through the part tangent to all FOUR sides)
//   G8  tool reused later           -> not a refusal: the translator passes keep_tools so the tool survives (see reusedTools)
//   G9  plainSentence(raw)          -> every raw SolidCraft / translator message becomes one student sentence (no ids, no engine words)
//   G12 a handle that is several pieces used by a feature that needs ONE piece -> refuse (the sentence belongs to this group because the pieces come from a combine)
// Rule for the PAGE, not a function: every sc.run for a combine runs in a Worker with BUDGET_S seconds; on timeout or wasm trap the Worker is terminated and replaced.
export const BUDGET_S = 45;
// Thin-overlap thresholds, by what the thin overlap is made of (measured: booleans-r2/sliver-sweep.json for planar tools, booleans-r3/sliver-sweep-round.json for round ones):
//   flat    both faces that meet are flat and square to the axes (box faces, the flat cap of an axis-aligned cylinder): cut and keep exact from 2e-3 mm, silent no-op / no body at <= 1.5e-3  -> 4e-3 (2x)
//   rotated planar tools turned off the axes, or an operand the guard cannot classify: cut exact from 5e-2 mm at 30 degrees, silent no-op at <= 2e-2   -> 0.1 (2x)
//   curved  a curved surface (ball, cylinder on its side, cone, torus) is the one that enters: cut is silently ignored at <= 0.1 (ball) / <= 0.05 (cylinder), exact from 0.15 / 0.1 -> 0.2;
//           keep gives no body, a refusal or a volume 6e-4 off down to 1 mm (ball) / 2 mm (cylinder on its side, 2.8e-4 at 2 mm)  -> 2
export const SLIVER = { flat: 4e-3, rotated: 0.1, curvedCut: 0.2, curvedKeep: 2 };
const EPS = 1e-6;
// measured bboxes of CURVED bodies come from tessellation (a cylinder of radius 10 reports x max 39.99985 instead of 40; a torus 17.99995 instead of 18),
// so 'touching' / 'apart' / 'inside' comparisons use a per-operand tolerance of 1e-3 mm + 2e-4 x the operand's largest extent for curved bodies
const tolOf = (d) => (hasCurved(d) ? 1e-3 + 2e-4 * Math.max(d.hi[0] - d.lo[0], d.hi[1] - d.lo[1], d.hi[2] - d.lo[2]) : EPS);
const tolPair = (a, b) => Math.max(tolOf(a), tolOf(b));

const FN = { union: 'join', subtract: 'cut', intersect: 'keep' };
const mm = (v) => String(+v.toPrecision(3));
export const SENTENCES = {
  sameShape: (op) => `${FN[op]}() was given the same shape twice; give it two different shapes.`,
  budget: (op) => `This ${FN[op]}() took longer than ${BUDGET_S} seconds to calculate, so it was stopped and nothing was changed; use simpler shapes or cut with a box-shaped tool.`,
  trap: (op) => `The solid calculation for this ${FN[op]}() failed part-way, so nothing was changed; if two faces of the shapes are almost, but not exactly, on top of each other, move one shape so they are clearly apart or exactly together.`,
  hangCross: (op) => `Round shapes that cross at an angle or off-centre (two cylinders at right angles, a cylinder that misses the centre of a ball) take minutes to calculate here, so this ${FN[op]}() is not built; line them up on one axis or use a box-shaped tool.`,
  hangCone: (op) => `A cone combined with a cylinder, cone or ball that is not on the cone's own axis either fails or takes minutes here, so this ${FN[op]}() is not built; put the other shape on the cone's axis, or use a box-shaped tool.`,
  hangTorus: (op) => `A ring (torus) that meets another shape in anything but a box around it or a cylinder through its hole takes minutes or fails here, so this ${FN[op]}() is not built; keep the ring clear of the other shape or enclose it in a box.`,
  sliver: (op, depth = SLIVER.rotated) => `The two shapes overlap by less than ${mm(depth)} mm, which is too thin to ${op === 'intersect' ? 'keep' : 'cut'} reliably here, so nothing was changed; make the overlap at least ${mm(depth)} mm deep or move the shapes clear of each other.`,
  cutNothingThin: () => 'The cut removed nothing because the cutting shape only grazes the part or misses it; move it so the two overlap clearly.',
  cutNothing: () => 'The cutting shape does not overlap the shape being cut, so nothing would be removed; move it (give it an at: position) so the two overlap.',
  keepNothing: () => 'The two shapes do not overlap, so keeping their overlap leaves nothing.',
  keepNothingKernel: () => 'Keeping the overlap of these shapes leaves nothing here: they do not overlap, or only by a sliver too thin to keep.',
  cutEverything: () => 'The cutting shapes would remove the whole shape, so nothing would be left.',
  pinchJoin: () => 'The two shapes only touch along a line or at a point, so they would not be one solid; overlap them a little.',
  pinchCut: () => "The cutting shape touches the part's surface along a line or at a point, which leaves a pinched solid that cannot be built correctly here, so nothing was changed; change its size or position a little so it clearly crosses that surface or stays clear of it.",
  tangentCircle: (op) => `The two round shapes only touch along a circle, which cannot be built as one clean solid here, so this ${FN[op]}() was not done; change one size a little so they clearly overlap or clearly miss each other.`,
  hollowBall: (op) => `A ball with a smaller ball taken out of its inside (a hollow ball) cannot be built here, so this ${FN[op]}() was not done.`,
  tubeTool: (op) => `A tube-shaped tool (a spin() of a ring-shaped outline) that is not wholly inside the part cannot be built correctly here, so this ${FN[op]}() was not done; cut with a solid shape instead, or keep the tube wholly inside the part.`,
  curvedKernel: (op) => `This ${FN[op]}() could not be calculated here, so nothing was changed; try other sizes or positions, or build the part in simpler steps.`,
  generic: (op) => `This ${FN[op]}() could not be built, so nothing was changed; move the shapes so they overlap more clearly.`,
  needTwo: () => 'A join, cut or keep needs two or more shapes.',
  consumed: () => 'This shape was already used up by an earlier join, cut or keep, so it cannot be used again; make a second copy of it.',
  skipped: (inner) => (inner ? `This step was skipped because a shape it uses could not be built: ${String(inner).replace(/[.\s]+$/, '')}.` : 'This step was skipped because a shape it uses could not be built.'),
  pieces: () => 'This step needs the part to be one connected piece, but an earlier cut left it in several pieces; join the pieces together first or cut so that one piece is left.',
};

// ---- operand descriptors ------------------------------------------------------------------------------------------------------
const rotAxis = (rotate) => {   // world direction of the primitive's own Z axis after the translator's x, y, z rotations (about the origin); 'x'|'y'|'z'|'oblique'
  let v = [0, 0, 1];
  const rx = (a, [x, y, z]) => { const c = Math.cos(a), s = Math.sin(a); return [x, y * c - z * s, y * s + z * c]; };
  const ry = (a, [x, y, z]) => { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c]; };
  const rz = (a, [x, y, z]) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c, z]; };
  const d = Math.PI / 180;
  if (rotate?.[0]) v = rx(rotate[0] * d, v);
  if (rotate?.[1]) v = ry(rotate[1] * d, v);
  if (rotate?.[2]) v = rz(rotate[2] * d, v);
  const a = v.map(Math.abs);
  for (const [i, n] of [[0, 'x'], [1, 'y'], [2, 'z']]) if (a[i] > 1 - 1e-9) return n;
  return 'oblique';
};
/** descriptor of one operand: bbox from the measured body, kind/axis from the ModelDoc feature when it is an untouched primitive. extra: {ring: {angle}|null, pieces: n} */
export function describe(measure, feat, extra = {}) {
  const lo = measure.bbox.slice(0, 3); const hi = measure.bbox.slice(3);
  const prim = feat && ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge'].includes(feat.kind) ? feat : null;
  const aligned = !!prim && (prim.rotate ?? [0, 0, 0]).every((v) => Math.abs(v / 90 - Math.round(v / 90)) < 1e-9);   // a primitive turned by multiples of 90 degrees fills its bounding box the way an unturned one does
  return { lo, hi, prim, aligned, kind: prim?.kind ?? null, axis: prim && ['cylinder', 'cone', 'torus'].includes(prim.kind) ? rotAxis(prim.rotate) : null, round: !!(prim && prim.round), faceTypes: measure.faceTypes ?? {}, curved: !!measure.curved, ring: extra.ring ?? null, pieces: extra.pieces ?? 1 };
}
const overlapOf = (a, b) => [0, 1, 2].map((i) => Math.min(a.hi[i], b.hi[i]) - Math.max(a.lo[i], b.lo[i]));
const hasCurved = (d) => d.curved || d.kind === 'cylinder' || d.kind === 'sphere' || d.kind === 'cone' || d.kind === 'torus' || d.round;
const AXI = { x: 0, y: 1, z: 2 };
const centre = (d) => [0, 1, 2].map((i) => (d.lo[i] + d.hi[i]) / 2);
/** is the operand's face on the +/-axis side of its bbox a plane (area contact possible)? null = cannot tell (not a plain primitive) */
const flatOnAxis = (d, ax) => {
  if (!d.prim || d.round) return null;
  if (d.kind === 'box') return d.aligned;   // a box turned by 45 degrees touches with an edge or a corner, not a face
  if (d.kind === 'cylinder') return d.axis === ax;
  if (d.kind === 'prism' || d.kind === 'wedge') return d.aligned ? null : false;
  return false;   // sphere, cone tip, torus: the bbox face is a curved surface
};
const isPlainBox = (d) => d.kind === 'box' && d.aligned && !d.round;

// ---- the checks ---------------------------------------------------------------------------------------------------------------
/** are two axes the same line? (both world axes of the same name, centres on that line) */
const coaxial = (a, b, tol) => {
  if (!a.axis || !b.axis || a.axis === 'oblique' || a.axis !== b.axis) return false;
  const k = AXI[a.axis]; const ca = centre(a); const cb = centre(b);
  return [0, 1, 2].every((i) => i === k || Math.abs(ca[i] - cb[i]) <= tol);
};
/** hang class: returns 'cross' | 'cone' | 'torus' | null for one pair of operands whose bboxes are not apart */
function hangOf(A, B) {
  const ov = overlapOf(A, B); const tol = tolPair(A, B);
  if (ov.some((v) => v < -tol)) return null;   // apart: no surface meets
  for (const [t, o] of [[A, B], [B, A]]) {
    if (!(t.kind === 'torus' || (!t.prim && t.faceTypes.torus))) continue;
    // W1: the torus sits strictly inside a plain box: the surfaces never meet (measured, x-box-minus-tor-void: 12 s)
    const inside = isPlainBox(o) && [0, 1, 2].every((i) => t.lo[i] > o.lo[i] + tol && t.hi[i] < o.hi[i] - tol);
    // W2: a cylinder coaxial with the torus: every meeting is a circle (measured, x-tor-union-cyl-axis / -touch: 16 s)
    const coax = o.kind === 'cylinder' && t.kind === 'torus' && coaxial(o, t, tol);
    if (!(inside || coax)) return 'torus';
  }
  if (A.kind === 'cylinder' && B.kind === 'cylinder') {
    if (A.axis === 'oblique' || B.axis === 'oblique' || A.axis !== B.axis) return 'cross';   // parallel axes: fast (x-cyl-minus-cyl-parallel 0.9 s)
  }
  // sphere x cylinder: circles only when the cylinder axis passes through the sphere centre (x-sph-cut-cyl 9 s); an axis that misses the centre makes a quartic curve (fuzz: no result in 60 s)
  const sc = A.kind === 'sphere' && B.kind === 'cylinder' ? [A, B] : A.kind === 'cylinder' && B.kind === 'sphere' ? [B, A] : null;
  if (sc) {
    const [s, c] = sc;
    if (c.axis === 'oblique') return 'cross';
    const k = AXI[c.axis];
    const off = [0, 1, 2].filter((i) => i !== k).map((i) => (s.lo[i] + s.hi[i]) / 2 - (c.lo[i] + c.hi[i]) / 2);
    if (Math.hypot(...off) > tol) return 'cross';
  }
  // a cone meeting another round shape: only the measured-safe combinations (CONE_OK) are built, everything else is refused rather than guessed
  const cn = A.kind === 'cone' ? [A, B] : B.kind === 'cone' ? [B, A] : null;
  if (cn && hasCurved(cn[1]) && !coneOk(cn[0], cn[1], tol)) return 'cone';
  return null;
}
/** the cone combinations that were MEASURED to build in a few seconds and to match OCCT (booleans-r3/cone-*; see the cone rows): a cylinder or cone on the cone's own axis, a ball centred on that axis */
export let CONE_OK = { cylinderCoaxial: true, coneCoaxial: true, ballCentred: true };
function coneOk(cone, other, tol) {
  if (cone.axis === 'oblique') return false;
  if (other.kind === 'cylinder' || other.kind === 'cone') return CONE_OK[other.kind === 'cylinder' ? 'cylinderCoaxial' : 'coneCoaxial'] && coaxial(cone, other, tol);
  if (other.kind === 'sphere') {
    const k = AXI[cone.axis]; const cc = centre(cone); const cs = centre(other);
    return CONE_OK.ballCentred && [0, 1, 2].every((i) => i === k || Math.abs(cc[i] - cs[i]) <= tol);
  }
  return false;
}

/** does a curved surface of this operand face the thin axis? (ball, cone, ring, cylinder on its side, rounded box, or a body the guard cannot read that has curved faces) */
const curvedOnAxis = (d, ax) => {
  if (d.round) return true;
  if (d.kind === 'sphere' || d.kind === 'cone' || d.kind === 'torus') return true;
  if (d.kind === 'cylinder') return d.axis !== ax;
  if (d.prim) return false;
  return !!d.curved;
};
/** the class of a thin overlap along axis `ax` between two operands: 'flat' | 'curved' | 'rotated' */
function sliverClass(a, b, ax) {
  const k = 'xyz'[ax];
  if (flatOnAxis(a, k) === true && flatOnAxis(b, k) === true) return 'flat';
  if (curvedOnAxis(a, k) || curvedOnAxis(b, k)) return 'curved';
  return 'rotated';
}
const sliverMm = (cls, op) => (cls === 'flat' ? SLIVER.flat : cls === 'rotated' ? SLIVER.rotated : op === 'intersect' ? SLIVER.curvedKeep : SLIVER.curvedCut);

// ---- oriented-box penetration depth (separating-axis test): the thickness of the overlap of two boxes turned by the SAME translator rotation (x, then y, then z about the origin), centres as given.
// The bounding box of a turned body is far looser than the body, so a sliver overlap between two turned boxes is invisible to the bbox test (round 2: 'sl-esc-rot-*').
const rotMat = (rot) => {   // columns = the box's local axes in the world; R = Rz * Ry * Rx
  const d = Math.PI / 180; const [ax, ay, az] = (rot ?? [0, 0, 0]).map((v) => v * d);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]; const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]; const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return mul(Rz, mul(Ry, Rx));
};
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
/** penetration depth of two oriented boxes (the smallest overlap over the 15 separating axes); <= 0 when they do not overlap. Returns null when either is not a plain box primitive. */
export function obbDepth(A, B) {
  if (!A.prim || !B.prim || A.kind !== 'box' || B.kind !== 'box' || A.round || B.round) return null;
  const mk = (p) => { const R = rotMat(p.rotate); return { c: p.center ?? [0, 0, 0], h: p.size.map((v) => v / 2), ax: [0, 1, 2].map((j) => [R[0][j], R[1][j], R[2][j]]) }; };
  const a = mk(A.prim); const b = mk(B.prim);
  const t = [0, 1, 2].map((i) => b.c[i] - a.c[i]);
  const axes = [...a.ax, ...b.ax];
  for (const u of a.ax) for (const v of b.ax) { const w = cross(u, v); const n = Math.hypot(...w); if (n > 1e-9) axes.push(w.map((x) => x / n)); }
  let best = Infinity;
  for (const L of axes) {
    const ra = a.h.reduce((s, h, i) => s + h * Math.abs(dot(a.ax[i], L)), 0); const rb = b.h.reduce((s, h, i) => s + h * Math.abs(dot(b.ax[i], L)), 0);
    best = Math.min(best, ra + rb - Math.abs(dot(t, L)));
  }
  return best;
}

/**
 * f: the combine feature {id, op, targets}. ops: array of {id, d: descriptor} in targets order (target first).
 * Returns null or {code, sentence}.
 */
export function guardCombine(f, ops) { const r = guardCombine0(f, ops); if (r) PLAIN.add(r.sentence); return r; }
function guardCombine0(f, ops) {
  const op = f.op;
  if (new Set(f.targets).size !== f.targets.length) return { code: 'G1', sentence: SENTENCES.sameShape(op) };
  const pairs = op === 'union' ? ops.flatMap((a, i) => ops.slice(i + 1).map((b) => [a, b])) : ops.slice(1).map((t) => [ops[0], t]);
  // G10 tube tool: a spin() of a ring-shaped outline used as the TOOL of a cut, unless it lies wholly inside the part (a void)
  if (op === 'subtract') {
    for (const [a, b] of pairs) {
      if (!b.d.ring) continue;
      const tol = tolPair(a.d, b.d);
      const inside = [0, 1, 2].every((i) => b.d.lo[i] > a.d.lo[i] + tol && b.d.hi[i] < a.d.hi[i] - tol);
      if (!inside) return { code: 'G10', sentence: SENTENCES.tubeTool(op) };
    }
  }
  // G2 hang class (any pair)
  for (const [a, b] of pairs) { const h = hangOf(a.d, b.d); if (h) return { code: 'G2', sentence: h === 'cross' ? SENTENCES.hangCross(op) : h === 'cone' ? SENTENCES.hangCone(op) : SENTENCES.hangTorus(op), detail: h }; }
  // G13 torus and a coaxial cylinder that meet only along a circle at the INNER equator (cylinder radius = ring radius - tube radius): join gives one body with two shells (OCCT two solids), cut removes nothing, keep leaves nothing. The OUTER equator (cylinder radius = ring radius + tube radius, the ring inside the cylinder) was measured fine for join and keep (r3-tor-cyl-outer-join/keep) and is refused for cut only
  for (const [a, b] of pairs) {
    for (const [t, c] of [[a.d, b.d], [b.d, a.d]]) {
      if (t.kind !== 'torus' || c.kind !== 'cylinder' || !coaxial(t, c, tolPair(t, c))) continue;
      const R = t.prim.ringRadius; const r = t.prim.tubeRadius; const tol = tolPair(t, c);
      const rc = c.prim.radius;
      if (Math.abs(rc - (R - r)) <= tol) return { code: 'G13', sentence: SENTENCES.tangentCircle(op) };
      if (op === 'subtract' && Math.abs(rc - (R + r)) <= tol) return { code: 'G13', sentence: SENTENCES.tangentCircle(op) };   // cylinder minus the ring it encloses: the kernel needs more than 150 s and then refuses it (r3-tor-cyl-outer-cut: refused in the first run, no result in 150 s in the second)
    }
  }
  // G14 hollow ball: a smaller ball wholly inside a ball, as the tool of a cut (concentric, off centre or touching from inside)
  if (op === 'subtract') {
    for (const [a, b] of pairs) {
      if (a.d.kind === 'sphere' && b.d.kind === 'sphere') {
        const tol = tolPair(a.d, b.d);
        if ([0, 1, 2].every((i) => b.d.lo[i] >= a.d.lo[i] - tol && b.d.hi[i] <= a.d.hi[i] + tol)) return { code: 'G14', sentence: SENTENCES.hollowBall(op) };
      }
    }
  }
  if (op === 'subtract' || op === 'intersect') {
    const ovs = pairs.map(([a, b]) => overlapOf(a.d, b.d));
    const tols = pairs.map(([a, b]) => tolPair(a.d, b.d));
    // G3 sliver: bbox overlap positive but thinner than the class threshold on some axis (the true overlap is no thicker than its bbox)
    for (const [k, ov] of ovs.entries()) {
      if (!ov.every((v) => v > tols[k])) continue;
      const ax = ov.indexOf(Math.min(...ov));
      const cls = sliverClass(pairs[k][0].d, pairs[k][1].d, ax);
      const depth = sliverMm(cls, op);
      // two turned boxes: the bounding boxes are loose, so the real thickness of the overlap comes from the oriented-box test
      const obb = cls === 'rotated' ? obbDepth(pairs[k][0].d, pairs[k][1].d) : null;
      const thin = obb !== null ? obb : Math.min(...ov);
      if (thin < depth && thin > -tols[k]) return { code: 'G3', sentence: SENTENCES.sliver(op, depth), detail: { depth, thin, class: cls, obb: obb !== null } };
    }
    const touching = ovs.map((ov, k) => ov.every((v) => v > tols[k]));
    if (op === 'subtract' && !touching.some(Boolean)) return { code: 'G4', sentence: SENTENCES.cutNothing() };
    if (op === 'intersect' && touching.some((t) => !t)) return { code: 'G5', sentence: SENTENCES.keepNothing() };
    if (op === 'subtract') {
      // G7: a round primitive tool that touches a plain box target's SIDE along a line or at a point. Wholly inside the box (inscribed ball / cylinder), or passing THROUGH it along
      // the one axis where it is flat (a vertical cylinder tangent to the four sides: truck returns ONE body of 13 faces, volume 6869.97, where OCCT has 4 solids and 20 faces)
      for (const [a, b] of pairs) {
        if (!isPlainBox(a.d) || !b.d.prim || b.d.kind === 'box' || b.d.round) continue;
        const tol = tolPair(a.d, b.d);
        const ax = ['x', 'y', 'z'];
        const curvedAxes = [0, 1, 2].filter((i) => flatOnAxis(b.d, ax[i]) !== true);
        if (curvedAxes.length === 3 && b.d.kind === 'cylinder') continue;   // an oblique cylinder: not a case this rule can read
        // tangent sides: (axis, side) pairs where the tool's bounding face lies on the part's face. A tool wholly inside the part (sealed void) that touches ONE side pinches the void into the shell;
        // a tool that passes through (or opens onto a face) separates a piece only when it is tangent to TWO sides or more (measured: tangent to one side builds, to two adjacent sides leaves a loose corner piece)
        const tangent = curvedAxes.reduce((n, i) => n + (Math.abs(b.d.lo[i] - a.d.lo[i]) <= tol ? 1 : 0) + (Math.abs(b.d.hi[i] - a.d.hi[i]) <= tol ? 1 : 0), 0);
        const within = [0, 1, 2].every((i) => b.d.lo[i] >= a.d.lo[i] - tol && b.d.hi[i] <= a.d.hi[i] + tol);
        const flatTouches = [0, 1, 2].filter((i) => flatOnAxis(b.d, ax[i]) === true).some((i) => Math.abs(b.d.lo[i] - a.d.lo[i]) <= tol || Math.abs(b.d.hi[i] - a.d.hi[i]) <= tol);   // a flat cap lying ON a face opens the void onto that face
        const sealed = within && !flatTouches;
        // MEASURED (r3-tan-cyl-through-*): a cylinder through the part tangent to ONE, TWO adjacent, TWO opposite or THREE sides builds and matches OCCT (the pieces it separates come back as one body with the same number of shells); tangent to all FOUR sides (inscribed in the square cross-section, four corner pieces) is wrong: volume 4.0e-4 against the 3e-4 bar and 13 faces against OCCT's 20. A ball through the part touching the four sides at points is one solid and matches (r3-tan-sph-big). Wholly inside the part, ANY tangent contact pinches the void into the shell (the kernel refuses it).
        const hasFlat = [0, 1, 2].some((i) => flatOnAxis(b.d, ax[i]) === true);
        const pinch = (hasFlat && tangent >= 4) || (tangent >= 1 && sealed);
        if (pinch) return { code: 'G7', sentence: SENTENCES.pinchCut() };
      }
    }
  }
  if (op === 'union') {
    for (const [a, b] of pairs) {
      const ov = overlapOf(a.d, b.d); const tol = tolPair(a.d, b.d);
      if (ov.some((v) => v < -tol)) continue;           // apart: two separate pieces, measured fine
      if (ov.every((v) => v > tol)) continue;           // real volume overlap
      const zero = ov.map((v, i) => (Math.abs(v) <= tol ? i : -1)).filter((i) => i >= 0);
      if (zero.length >= 2) return { code: 'G6', sentence: SENTENCES.pinchJoin() };   // bbox touch along an edge or at a vertex
      const ax = ['x', 'y', 'z'][zero[0]];
      const fa = flatOnAxis(a.d, ax); const fb = flatOnAxis(b.d, ax);
      if (fa === false || fb === false) return { code: 'G6', sentence: SENTENCES.pinchJoin() };   // a curved surface meets the other shape along a line or at a point
    }
  }
  return null;
}

/** G4b, after a successful run: a cut that left the target's volume exactly as it was removed nothing (a sliver SolidCraft ignored, or a near miss the bounding boxes could not rule out) */
export function afterCombine(f, m, before) { const r = afterCombine0(f, m, before); if (r) PLAIN.add(r.sentence); return r; }
function afterCombine0(f, m, before) {
  if (f.op !== 'subtract' || !before || !m) return null;
  if (Math.abs(m.volume - before.volume) <= 1e-12 * Math.max(before.volume, 1)) return { code: 'G4b', sentence: SENTENCES.cutNothingThin() };
  return null;
}

/** operands that a LATER feature still uses: the translator keeps those tools alive (keep_tools) instead of consuming them */
export function reusedTools(f, feats) {
  const later = feats.slice(feats.findIndex((x) => x.id === f.id) + 1);
  const uses = (id) => later.some((g) => (g.targets ?? []).includes(id) || g.target === id || g.into === id);
  return f.targets.slice(1).filter(uses);
}

// ---- G9: one student sentence for every raw message -------------------------------------------------------------------------------
const BAD_WORDS = /solidcraft|truck|kernel|occt|brep|wasm|tessell|op\d+|\bb_[a-z]|\bcommand\b|fallback|body named|ModelDoc|translator|panic|unreachable/i;
export const lintSentence = (s) => {
  const problems = [];
  if (typeof s !== 'string' || !s.trim()) return ['empty'];
  if (BAD_WORDS.test(s)) problems.push(`engine/internal word: ${s.match(BAD_WORDS)[0]}`);
  const body = s.trim().replace(/[.]$/, '');
  if (/[.!?]\s+[A-Z]/.test(body)) problems.push('more than one sentence');
  if (!/[.]$/.test(s.trim())) problems.push('no final period');
  if (s.length > 330) problems.push('longer than 330 characters');
  return problems;
};

/** the primitive's OWN refusal sentence for a feature id (the page wires the primitives group's guardFeature here); used to quote the reason a dependent step was skipped */
let innerSentenceOf = null;
export const setInnerSentence = (fn) => { innerSentenceOf = fn; };

/** raw: the text SolidCraft or the translator produced; f: the combine feature (or null); returns {code, sentence} */
const PLAIN = new Set();
const mark = (r) => { PLAIN.add(r.sentence); return r; };
export function plainSentence(raw, f) { return mark(plainSentence0(raw, f)); }
export const isPlain = (t) => PLAIN.has(t);
function plainSentence0(raw, f) {
  const op = f?.op ?? 'union';
  const t = String(raw ?? '');
  if (PLAIN.has(t)) return { code: 'PLAIN', sentence: t };
  if (/no body named/.test(t)) return op === 'intersect' ? { code: 'K1', sentence: SENTENCES.keepNothingKernel() } : op === 'subtract' ? { code: 'K2', sentence: SENTENCES.cutEverything() } : { code: 'K3', sentence: SENTENCES.generic(op) };
  if (/cannot be combined with itself/.test(t)) return { code: 'K4', sentence: SENTENCES.sameShape(op) };
  if (/needs two or more targets/.test(t)) return { code: 'K5', sentence: SENTENCES.needTwo() };
  if (/already changed in place/.test(t)) return { code: 'K6', sentence: SENTENCES.consumed() };
  if (/was refused \((.*)\)$/.test(t)) {
    const inner = t.match(/was refused \((.*)\)$/)[1];
    const idm = t.match(/its (?:target|tool) (\S+) was refused/);
    const own = idm && innerSentenceOf ? innerSentenceOf(idm[1]) : null;   // the primitive's own sentence, when the primitives group has one
    return { code: 'K7', sentence: SENTENCES.skipped(own ?? (PLAIN.has(inner) ? inner : plainInner(inner, f))) };
  }
  if (/unreachable|WASM TRAP|RuntimeError|trap/i.test(t)) return { code: 'K8', sentence: SENTENCES.trap(op) };
  if (/implausible result volume|exact fallback|planar faces only|curved faces|not a manifold|tolerance|tangent|degenerate|failed to (intersect|boolean|combine)|coincident faces|could not|cannot/i.test(t)) return { code: 'K9', sentence: SENTENCES.curvedKernel(op) };
  return { code: 'K0', sentence: SENTENCES.generic(op) };
}
// an inner refusal that is already a student sentence is quoted; developer text from another feature kind is not quoted
function plainInner(inner, f) { const r = plainSentence0(inner, f); return ['K6', 'K1', 'K2', 'K4'].includes(r.code) ? r.sentence : null; }

/** G12: a feature that is not a combine, refused because its target is several pieces ("needs a single ... body") */
export function plainPieces(raw) { return /single (measured target )?body|not a single body/.test(String(raw ?? '')) ? { code: 'G12', sentence: mark({ sentence: SENTENCES.pieces() }).sentence } : null; }

// ---- interpreter-level sentence: join / cut / keep given the wrong KIND of argument ---------------------------------------------------------------
// runScript says "cut() needs two or more shapes: cut(a, b)." for cut(a) AND for cut(a, 5), the second case with two arguments given. This reads the failing call from the script text and says which
// argument is the problem. Returns a sentence or null (null = keep the interpreter's own message, which is right for fewer than two arguments).
const SHAPE_CALLS = /^(box|cylinder|sphere|cone|ring|prism|wedge|pull|spin|hole|join|cut|keep|turn|move|copy|mirror|repeat|repeatAround|round|bevel|hollow|draft|groove|pocket|loft|blend)\s*\(/;
function splitArgs(text, open) {
  const args = []; let depth = 0; let cur = ''; let quote = null;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) { cur += ch; if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) { if (depth === 0) { args.push(cur.trim()); return args; } depth--; }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return null;
}
export function explainCombineArgs(message, source, line) {
  const m = /^(join|cut|keep)\(\) needs two or more shapes/.exec(String(message ?? ''));
  if (!m) return null;
  const fn = m[1];
  const lines = String(source ?? '').split('\n');
  const text = lines[(line ?? 1) - 1] ?? '';
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
  let hit; let args = null;
  while ((hit = re.exec(text))) { args = splitArgs(text, hit.index + hit[0].length - 1); if (args && args.length >= 2) break; }
  if (!args || args.length < 2) return null;
  const declared = (name) => { const d = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([^;]*)`).exec(String(source)); return d ? d[1].trim() : null; };
  const kindOf = (a) => {
    if (/^-?\d+(\.\d+)?$/.test(a)) return 'a number';
    if (/^(['"`]).*\1$/.test(a)) return 'text';
    if (/^\[.*\]$/.test(a)) return 'a list';
    if (/^[A-Za-z_]\w*$/.test(a)) {
      const d = declared(a);
      if (d === null) return 'a name that has not been defined';
      if (/^sketch\s*\(/.test(d)) return 'a sketch, which has no volume';
      if (SHAPE_CALLS.test(d)) return null;
      if (/^-?\d/.test(d)) return 'a number';
      return null;
    }
    if (SHAPE_CALLS.test(a)) return null;
    return null;
  };
  for (let i = 0; i < args.length; i++) {
    const k = kindOf(args[i]);
    if (k) return `${fn}() works on shapes, but argument ${i + 1} is ${k}; give it a solid such as a box(), a cylinder() or the result of pull().`;
  }
  return null;
}
