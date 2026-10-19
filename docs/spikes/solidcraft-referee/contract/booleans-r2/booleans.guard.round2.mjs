// SPIKE, referee only (contract / booleans group, round 2). The guard and the sentence layer the PAGE has to put around the combine step
// (join / cut / keep) for the statuses in booleans.json to hold. Pure functions: no kernel, no wasm. NOT in the page; the spike wires it into a
// generated copy of phase0/translate.mjs (make-bool-translate.mjs -> bool-translate.mjs).
//
// What it decides, in order, BEFORE any SolidCraft call for the combine (G1..G8), and AFTER a failed call (plainSentence, G9):
//   G1 same shape twice            -> refuse            (join(a, a), cut(a, a), keep(a, a))
//   G2 time budget, hang class     -> refuse            (two cylinders with non-parallel axes; a cylinder whose axis misses a sphere's centre; any cone meeting a round shape; a torus meeting anything but a plain box around it or a coaxial cylinder)
//   G3 sliver overlap              -> refuse            (cut / keep whose overlap is thinner than SLIVER_MM: SolidCraft silently returns the part unchanged)
//   G4 cut that touches nothing    -> refuse            (nothing would be removed, e.g. a shape written without at: lands beside the part)
//   G4b after the call: a cut that left the target's volume unchanged -> refuse (a sliver SolidCraft ignored where the bounding boxes could not show it)
//   G5 keep that touches nothing   -> refuse            (nothing would be left)
//   G6 pinch on join               -> refuse            (operands meet only along a line or at a point: not one solid)
//   G7 pinch on cut                -> refuse            (a round tool inside the part touching its surface at a point or along a line: void pinched into the shell)
//   G8 tool reused later           -> not a refusal: the translator passes keep_tools so the tool survives (see reusedTools)
//   G9 plainSentence(raw)          -> every raw SolidCraft / translator message becomes one student sentence (no ids, no engine words)
// And one rule for the PAGE, not a function: every sc.run for a combine runs in a Worker with BUDGET_S seconds; on timeout or wasm trap the Worker is
// terminated and replaced, and the student sees SENTENCES.budget / SENTENCES.trap (measured in bool-watchdog.mjs).
export const BUDGET_S = 45;
export const SLIVER_MM = 0.1;   // measured (booleans-r2/sliver-sweep.json): cut is a silent no-op at <= 1.5e-3 mm (axis-aligned part) and <= 2e-2 mm (part rotated 30 degrees), exact at >= 2e-3 / >= 5e-2; 0.1 keeps a 2x margin over the worst
const EPS = 1e-6;
// measured bboxes of CURVED bodies come from tessellation (a cylinder of radius 10 reports x max 39.99985 instead of 40; a torus 17.99995 instead of 18),
// so 'touching' / 'apart' / 'inside' comparisons use a per-operand tolerance of 1e-3 mm + 2e-4 x the operand's largest extent for curved bodies
const tolOf = (d) => (hasCurved(d) ? 1e-3 + 2e-4 * Math.max(d.hi[0] - d.lo[0], d.hi[1] - d.lo[1], d.hi[2] - d.lo[2]) : EPS);
const tolPair = (a, b) => Math.max(tolOf(a), tolOf(b));

const FN = { union: 'join', subtract: 'cut', intersect: 'keep' };
export const SENTENCES = {
  sameShape: (op) => `${FN[op]}() was given the same shape twice; give it two different shapes.`,
  budget: (op) => `This ${FN[op]}() took longer than ${BUDGET_S} seconds to calculate, so it was stopped and nothing was changed; use simpler shapes or cut with a box-shaped tool.`,
  trap: (op) => `The solid calculation for this ${FN[op]}() failed part-way, so nothing was changed; move the shapes a little so they clearly overlap or clearly miss each other.`,
  hangCross: (op) => `Round shapes that cross at an angle or off-centre (two cylinders at right angles, a cylinder that misses the centre of a sphere) take minutes to calculate here, so this ${FN[op]}() is not built; line them up on one axis or use a box-shaped tool.`,
  hangTorus: (op) => `A ring (torus) that meets another shape in anything but a box around it or a cylinder through its hole takes minutes or fails here, so this ${FN[op]}() is not built; keep the ring clear of the other shape or enclose it in a box.`,
  sliver: (op) => `The two shapes overlap by less than ${SLIVER_MM} mm, which is too thin to ${op === 'intersect' ? 'keep' : 'cut'} reliably, so nothing was changed; make the overlap at least ${SLIVER_MM} mm deep or move the shapes clear of each other.`,
  cutNothingThin: () => 'The cut removed nothing because the cutting shape only grazes the part or misses it; move it so the two overlap clearly.',
  cutNothing: () => 'The cutting shape does not overlap the shape being cut, so nothing would be removed; move it (give it an at: position) so the two overlap.',
  keepNothing: () => 'The two shapes do not overlap, so keeping their overlap leaves nothing.',
  cutEverything: () => 'The cutting shapes would remove the whole shape, so nothing would be left.',
  pinchJoin: () => 'The two shapes only touch along a line or at a point, so they would not be one solid; overlap them a little.',
  pinchCut: () => "The cut touches the part's surface along a line or at a point, which leaves a solid that cannot be held as one body; move it a little or make it go all the way through.",
  curvedKernel: (op) => `This ${FN[op]}() of curved shapes could not be calculated reliably (their round surfaces are tangent or too close), so nothing was changed; change a size or position a little so the shapes clearly overlap or clearly miss each other.`,
  generic: (op) => `This ${FN[op]}() could not be built, so nothing was changed; move the shapes so they overlap more clearly.`,
  needTwo: () => 'A join, cut or keep needs two or more shapes.',
  consumed: () => 'This shape was already used up by an earlier join, cut or keep, so it cannot be used again; make a second copy of it.',
  skipped: (inner) => (inner ? `This step was skipped because a shape it uses could not be built: ${String(inner).replace(/[.\s]+$/, '')}.` : 'This step was skipped because a shape it uses could not be built.'),
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
/** descriptor of one operand: bbox from the measured body, kind/axis from the ModelDoc feature when it is an untouched primitive */
export function describe(measure, feat) {
  const lo = measure.bbox.slice(0, 3); const hi = measure.bbox.slice(3);
  const prim = feat && ['box', 'cylinder', 'sphere', 'cone', 'torus'].includes(feat.kind) ? feat : null;
  const aligned = !!prim && (prim.rotate ?? [0, 0, 0]).every((v) => Math.abs(v / 90 - Math.round(v / 90)) < 1e-9);   // a primitive turned by multiples of 90 degrees fills its bounding box the way an unturned one does
  return { lo, hi, prim, aligned, kind: prim?.kind ?? null, axis: prim && ['cylinder', 'cone', 'torus'].includes(prim.kind) ? rotAxis(prim.rotate) : null, round: !!(prim && prim.round), faceTypes: measure.faceTypes ?? {}, curved: !!measure.curved };
}
const overlapOf = (a, b) => [0, 1, 2].map((i) => Math.min(a.hi[i], b.hi[i]) - Math.max(a.lo[i], b.lo[i]));
const hasCurved = (d) => d.curved || d.kind === 'cylinder' || d.kind === 'sphere' || d.kind === 'cone' || d.kind === 'torus';
const AXI = { x: 0, y: 1, z: 2 };
/** is the operand's face on the +/-axis side of its bbox a plane (area contact possible)? null = cannot tell (not a plain primitive) */
const flatOnAxis = (d, ax) => {
  if (!d.prim || d.round) return null;
  if (d.kind === 'box') return d.aligned;   // a box turned by 45 degrees touches with an edge or a corner, not a face
  if (d.kind === 'cylinder') return d.axis === ax;
  return false;   // sphere, cone tip, torus: the bbox face is a curved surface
};

// ---- the checks ---------------------------------------------------------------------------------------------------------------
/** hang class: returns 'cross' | 'torus' | null for one pair of operands whose bboxes are not apart */
function hangOf(A, B) {
  const ov = overlapOf(A, B); const tol = tolPair(A, B);
  if (ov.some((v) => v < -tol)) return null;   // apart: no surface meets
  for (const [t, o] of [[A, B], [B, A]]) {
    if (!(t.kind === 'torus' || (!t.prim && t.faceTypes.torus))) continue;
    // W1: the torus sits strictly inside a plain box: the surfaces never meet (measured, x-box-minus-tor-void: 12 s)
    const inside = o.kind === 'box' && o.aligned && !o.round && [0, 1, 2].every((i) => t.lo[i] > o.lo[i] + tol && t.hi[i] < o.hi[i] - tol);
    // W2: a cylinder coaxial with the torus: every meeting is a circle (measured, x-tor-union-cyl-axis / -touch: 16 s)
    const coax = o.kind === 'cylinder' && t.kind === 'torus' && o.axis === t.axis && o.axis !== 'oblique' && [0, 1, 2].every((i) => i === AXI[t.axis] || Math.abs((o.lo[i] + o.hi[i]) / 2 - (t.lo[i] + t.hi[i]) / 2) <= tol);
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
  // a cone primitive meeting any other round shape was never measured: refused rather than guessed
  if ((A.kind === 'cone' && hasCurved(B)) || (B.kind === 'cone' && hasCurved(A))) return 'cross';
  return null;
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
  // G2 hang class (any pair)
  for (const [a, b] of pairs) { const h = hangOf(a.d, b.d); if (h) return { code: 'G2', sentence: h === 'cross' ? SENTENCES.hangCross(op) : SENTENCES.hangTorus(op), detail: h }; }
  if (op === 'subtract' || op === 'intersect') {
    const ovs = pairs.map(([a, b]) => overlapOf(a.d, b.d));
    const tols = pairs.map(([a, b]) => tolPair(a.d, b.d));
    // G3 sliver: bbox overlap positive but thinner than SLIVER_MM on some axis (the true overlap is no thicker than its bbox)
    for (const [k, ov] of ovs.entries()) if (ov.every((v) => v > tols[k]) && Math.min(...ov) < SLIVER_MM) return { code: 'G3', sentence: SENTENCES.sliver(op) };
    const touching = ovs.map((ov, k) => ov.every((v) => v > tols[k]));
    if (op === 'subtract' && !touching.some(Boolean)) return { code: 'G4', sentence: SENTENCES.cutNothing() };
    if (op === 'intersect' && touching.some((t) => !t)) return { code: 'G5', sentence: SENTENCES.keepNothing() };
    if (op === 'subtract') {
      // G7: a round primitive tool wholly inside a plain box target, touching its surface at a point or along a line
      for (const [a, b] of pairs) {
        if (a.d.kind !== 'box' || !a.d.aligned || a.d.round || !b.d.prim || b.d.kind === 'box' || b.d.round) continue;
        const tol = tolPair(a.d, b.d);
        const ins = [0, 1, 2].every((i) => b.d.lo[i] >= a.d.lo[i] - tol && b.d.hi[i] <= a.d.hi[i] + tol);
        if (!ins) continue;
        const ax = ['x', 'y', 'z'];
        const pinch = [0, 1, 2].some((i) => (Math.abs(b.d.lo[i] - a.d.lo[i]) <= tol || Math.abs(b.d.hi[i] - a.d.hi[i]) <= tol) && flatOnAxis(b.d, ax[i]) === false);
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
  if (s.length > 260) problems.push('longer than 260 characters');
  return problems;
};

/** raw: the text SolidCraft or the translator produced; f: the combine feature (or null); returns {code, sentence} */
const PLAIN = new Set();
const mark = (r) => { PLAIN.add(r.sentence); return r; };
export function plainSentence(raw, f) { return mark(plainSentence0(raw, f)); }
export const isPlain = (t) => PLAIN.has(t);
function plainSentence0(raw, f) {
  const op = f?.op ?? 'union';
  const t = String(raw ?? '');
  if (PLAIN.has(t)) return { code: 'PLAIN', sentence: t };
  if (/no body named/.test(t)) return op === 'intersect' ? { code: 'K1', sentence: SENTENCES.keepNothing() } : op === 'subtract' ? { code: 'K2', sentence: SENTENCES.cutEverything() } : { code: 'K3', sentence: SENTENCES.generic(op) };
  if (/cannot be combined with itself/.test(t)) return { code: 'K4', sentence: SENTENCES.sameShape(op) };
  if (/needs two or more targets/.test(t)) return { code: 'K5', sentence: SENTENCES.needTwo() };
  if (/already changed in place/.test(t)) return { code: 'K6', sentence: SENTENCES.consumed() };
  if (/was refused \((.*)\)$/.test(t)) { const inner = t.match(/was refused \((.*)\)$/)[1]; return { code: 'K7', sentence: SENTENCES.skipped(PLAIN.has(inner) ? inner : plainInner(inner, f)) }; }
  if (/unreachable|WASM TRAP|RuntimeError|trap/i.test(t)) return { code: 'K8', sentence: SENTENCES.trap(op) };
  if (/implausible result volume|exact fallback|planar faces only|curved faces|not a manifold|tolerance|tangent|degenerate|failed to (intersect|boolean|combine)|could not|cannot/i.test(t)) return { code: 'K9', sentence: SENTENCES.curvedKernel(op) };
  return { code: 'K0', sentence: SENTENCES.generic(op) };
}

// an inner refusal that is already a student sentence is quoted; developer text from another feature kind is not quoted
function plainInner(inner, f) { const r = plainSentence0(inner, f); return ['K6', 'K1', 'K2', 'K4'].includes(r.code) ? r.sentence : null; }
