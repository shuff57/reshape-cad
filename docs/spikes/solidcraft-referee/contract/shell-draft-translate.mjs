// SPIKE, referee only. The shell-draft contract translator: phase0/translate.mjs (unchanged, imported) with the guards that
// hollow() and draft() need before a SolidCraft (truck) result may be shown to a student.
//
// Why a wrapper and not an edit: phase0/translate.mjs is read-only for this group. Every feature except shell and draft goes through
// phase0's planFeature() untouched; shell and draft are planned here, and every refusal that leaves this file is a plain sentence.
//
// What the guards are for (each is measured in shell-draft-runner.mjs, with the unguarded truck number beside it):
//   G-CONVEX   truck mitres the offset at every inside (reflex) edge; OCCT rounds it. Any hollow of a join/cut/pocket/boss/L part
//              comes back thicker than asked, with ok:true and no sentence (notch box: truck 8932, OCCT and the closed form 8901.0973).
//   G-PICK     truck picks a face by a 3D point. The point comes from brep-rs resolve on the primitive's OWN frame, so after a move it
//              is stale (hollow open:'top' of a part moved up by its height opens the BOTTOM). The point is shifted by the moves in
//              the chain and then checked against the part's current bounding box; a rotate in the chain is refused.
//   G-TIE      an even-sided prism (and any polygon with a symmetric pair of faces) has two faces equally "left"; OCCT and brep-rs
//              break the tie differently. Refused, not guessed.
//   G-THICK    a wall at or beyond the open depth returns the unhollowed block (ok:true). Pre-check for boxes, and a post-check for
//              every shape: a hollow must lose volume and gain faces.
//   G-VANISH   a draft steep enough that the tilted face crosses the opposite face returns a clipped wedge with fewer faces.
//              A draft must keep its face count.
//   G-SWEEP    a draft whose tilted face runs into another face of the part (an inside wall, an arm, a notch) comes back WRONG with ok:true,
//              the same face count and no sentence (L extrude 'left' 60 degrees: 15267.9 returned, 'front' 60 degrees returns the undrafted
//              16500, the draft silently dropped; multi-face drafts go NEGATIVE). While the face meets nothing the volume is an exact quadratic
//              in tan(angle), so the same draft is re-run at three tiny angles, V(t) is fitted, and the result is refused unless it lies on the
//              curve (planar 1e-9, curved 2e-5). Measured on the L extrude: good drafts 4e-12, wrong ones 1.5e-2 and up.
//   G-REACH    the volume check above cannot see a tilted face that runs past the END of an inside wall: on the L made of two joined boxes
//              the back face at 70 degrees sweeps 27.5 inward, past the arm (20 long) into the base block, and the volume stays exactly on
//              the line (9252.52) while OCCT says "would not fit". For every part that is not a plain convex solid the inward sweep
//              (tan(angle) x the part's height above/below the neutral plane) must stay shorter than the distance to the nearest other
//              plane coordinate of the part along the face's axis (every box wall, sketch vertex, hole tangent plane, cutter wall in the
//              history), and two opposite drafted faces must not meet. Outward tilts are exempt (the picked face is the extreme one).
//   G-BLIND    hollow of a part with a blind hole: refused with its own sentence. Beside the thickened floor it also protects against a HANG
//              (hole floor within about one wall of the outer bottom: no result in 110 s, no refusal, see shell-draft-hang.txt).
//   G-FROM     draft {from:'bottom'} reads the ROOT primitive's own extreme (primitiveExtreme in reshape-script.ts), so after a
//              move / join / turn it silently yields 0 or a stale number. Checked against the part's current bounding box.
import { planFeature } from '../phase0/translate.mjs';

const AXI = { x: 0, y: 1, z: 2 };
const DIRV = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const WORD_OF = { '+z': 'top', '-z': 'bottom', '-y': 'front', '+y': 'back', '-x': 'left', '+x': 'right', side: 'side' };
const AXN = { x: 'X', y: 'Y', z: 'Z' };
const AXWORDS = { x: ['left', 'right'], y: ['front', 'back'], z: ['top', 'bottom'] };
const bname = (id) => `b_${id}`;
/** the direction an extrude sweeps along: u x v. NOT the frame's n: the named xz plane keeps n = +Y but sweeps along -Y (model-types.ts sketchFrameOf). */
const sweepOf = (fr) => [fr.u[1] * fr.v[2] - fr.u[2] * fr.v[1], fr.u[2] * fr.v[0] - fr.u[0] * fr.v[2], fr.u[0] * fr.v[1] - fr.u[1] * fr.v[0]];
const isZero3 = (v) => !v || (v[0] === 0 && v[1] === 0 && v[2] === 0);
const refuse = (sentence, status = 'refused') => ({ refusal: sentence, status });
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));

// ---- plain sentences -----------------------------------------------------------------------------------------------
// Every refusal is ONE sentence: what was asked, why it cannot be built, that the feature is shown without it, and (after a dash) what to try.
// shell-draft-runner.mjs checks that no sentence contains a second sentence.
export const SENTENCE = {
  closed: (f, what) => `${f.id} (hollow): a hollow with no open side is only built for a plain box, cylinder, sphere or prism, and ${what}, so ${f.id} is shown without it -- add open:'top' (or 'bottom', 'front', 'back', 'left', 'right') to leave one side open.`,
  shellTwice: (f) => `${f.id} (hollow): ${f.target} is already hollow and a second hollow is not supported yet, so ${f.id} is shown without it -- give the first hollow the wall you want instead.`,
  afterClosedHollow: (f, what) => `${f.id} (${f.kind === 'shell' ? 'hollow' : f.kind}): ${what} has no open side, and nothing but a move or a turn can be added to a hollow like that yet, so ${f.id} is shown without it -- apply ${f.id} before the hollow, or open one side of the hollow.`,
  closedFail: (f) => `${f.id} (hollow): a hollow with no open side could not be built for ${f.target} with a wall of ${fmt(f.thickness)}, so ${f.id} is shown without it -- use a different wall, or add open:'top' to leave one side open.`,
  noFaceDrafted: (f, word, dr) => `${f.id} (hollow): the ${word} face was tilted by ${dr.id}, so it can no longer be picked by name and ${f.id} is shown without it -- open a different face, or hollow before drafting.`,
  swallowed: (f, word, name) => `${f.id} (hollow): the ${word} face of ${name} is inside the part after the mirror or join, so ${f.id} is shown without it -- open a face that is still on the outside.`,
  hollowCone: (f) => `${f.id} (hollow): ${f.target} has a drafted curved wall (a cone) and a hollow of that is not supported yet, so ${f.id} is shown without it -- leave out either the draft or the hollow.`,
  chamferBox: (f) => `Bevelling every edge of a box at once is not supported, so ${f.id} is shown without it -- bevel the edges one at a time.`,
  chamferCyl: (f) => `${f.id} (hollow): ${f.target} has its edges bevelled and a hollow of a bevelled cylinder is not supported yet, so ${f.id} is shown without it -- hollow the plain cylinder, or leave the hollow out.`,
  concave: (f, why) => `Hollowing ${f.target} is not supported yet because the part has inside corners (${why}) where the new wall would come out thicker than ${fmt(f.thickness)}, so ${f.id} is shown without it -- hollow the plain shape first, or leave the hollow out.`,
  blindHole: (f) => `Hollowing ${f.target} is not supported yet because the part has a blind hole, whose floor is an inside corner, so ${f.id} is shown without it -- hollow the plain shape first, then drill the hole.`,
  noFlat: (f, word, kind) => `${f.id} (hollow): ${kind === 'sphere' ? 'a sphere has no flat face to open' : kind === 'cone' && (word === 'top') ? 'the top of a cone is a point, not a flat face to open' : `a ${kind} only has flat top and bottom faces, not a ${word} one to open`}, so ${f.id} is shown without it -- use ${kind === 'sphere' ? 'a box, cylinder or other flat-faced shape' : kind === 'cone' ? "open:'bottom'" : "open:'top' or open:'bottom'"}.`,
  noFace: (f, word, why) => `${f.id}${f.kind === 'shell' ? ' (hollow)' : f.kind === 'draft' ? ' (draft)' : ''}: the ${word} face of ${f.target} ${why ?? 'could not be found on the part as it is now'}, so ${f.id} is shown without it${f.kind === 'shell' ? " -- open a different face, or hollow before drafting." : '.'}`,
  thickBox: (f, limit) => `Hollowing ${f.target} to ${fmt(f.thickness)} thick would collapse it, so ${f.id} is shown without it -- the wall has to be under ${fmt(limit)}.`,
  thickGeneric: (f) => `Hollowing ${f.target} to ${fmt(f.thickness)} thick would collapse it, so ${f.id} is shown without it -- use a wall thinner than the depth of the part and than half its narrowest width.`,
  tie: (f, word, kind, n) => `${f.id}: the ${word} face is ambiguous on this ${n ? n + '-sided ' : ''}${kind} because two faces are equally far ${word}, so ${f.id} is shown without it -- pick a face that has only one candidate (for example top or bottom), or ${kind === 'box' ? 'turn the box a little less' : 'use a different number of sides'}.`,
  stale: (f, what) => `${f.id}: the ${what} cannot be found reliably after the part was turned or copied, so ${f.id} is shown without it -- apply it before turning the part.`,
  holeNear: (f, why) => `${f.id} (hollow): not supported yet because a hole would be too close to a wall or to another hole (${why}), so ${f.id} is shown without it -- move the holes apart, or drill after hollowing.`,
  rim: (f, rr, t, style) => `${f.id} (hollow): the open edge of ${f.target} is ${style === 'chamfer' ? 'bevelled by' : 'rounded with a radius of'} ${fmt(rr)}, which is as large as the wall (${fmt(t)}), so the rim would have no thickness and ${f.id} is shown without it -- make the ${style === 'chamfer' ? 'bevel' : 'round'} smaller than the wall.`,
  openAxisEngine: (f) => `${f.id} (hollow): ${f.target} could not be hollowed with this wall and open side, so ${f.id} is shown without it -- try another wall or another open side.`,
  hollowSide: (f) => `${f.id} (hollow): "side" is the curved wall of a cylinder, not a flat face, so ${f.id} is shown without it -- open top or bottom instead.`,
  cap: (f, word, why = {}) => {
    const fa = ['right', 'left'].includes(word) ? 'x' : ['front', 'back'].includes(word) ? 'y' : 'z';
    const others = Object.entries(AXWORDS).filter(([a]) => a !== fa).flatMap(([, w]) => w);
    const pull = why.pull ?? 'z';
    const list = `${others.slice(0, -1).join(', ')} or ${others.at(-1)}`;
    const advice = why.fromWord
      ? `set from: to ${list}${fa !== 'z' ? ' (or leave from: out)' : ''} so the pull no longer points along the ${word} face`
      : `draft a side face, or set from: to ${list} so the pull no longer points along the ${word} face`;
    return `${f.id} (draft): the ${word} face is square to the pull direction (${pull}${why.fromWord ? `, set by from:'${why.fromWord}'` : ''}), so it cannot be tilted, and ${f.id} is shown without it -- ${advice}.`;
  },
  angleRange: (f, max) => `${f.id} (draft): a draft angle of ${fmt(f.angle)} degrees is too steep, so ${f.id} is shown without it -- keep it between -${max} and ${max} degrees.`,
  vanish: (f) => `Tilting ${f.id} at ${fmt(f.angle)} degrees would not fit because the tilted face would run into another face of the part, so ${f.id} is shown without it -- use a smaller angle.`,
  twice: (f) => `${f.id} (draft): that face was already drafted, so ${f.id} is shown without it -- draft it once with the angle you want.`,
  fromStale: (f, word, got, want) => `${f.id} (draft): from:'${word}' would put the neutral plane at ${fmt(got)}, but the ${word} of this part is at ${fmt(want)} now (the part was moved, joined or turned), so ${f.id} is shown without it -- give the plane yourself, for example neutral: ${fmt(want)}.`,
  wholeChanged: (f, what) => `${f.id} (draft): drafting a whole shape is only built for a plain box, prism, wedge, cylinder or extruded outline (optionally moved), and ${f.target} has been changed by ${what}, so ${f.id} is shown without it -- draft the shape before ${what === 'a hollow' ? 'hollowing it' : 'that step'}, or draft one face at a time.`,
  wholeHollow: (f) => `${f.id} (draft): drafting a whole shape that is hollow is not supported yet, so ${f.id} is shown without it -- draft the shape first and hollow it afterwards.`,
  wholeDrafted: (f) => `${f.id} (draft): ${f.target} already has a drafted face, so drafting the whole shape as well is not supported yet and ${f.id} is shown without it -- draft the whole shape first, or draft the faces one at a time.`,
  wholeCone: (f) => `${f.id} (draft): the sloping side of a cone is not parallel to the pull direction, so it cannot be drafted and ${f.id} is shown without it -- draft a box, prism or cylinder instead.`,
  wholeSphere: (f) => `${f.id} (draft): a sphere has no side faces to draft, so ${f.id} is shown without it -- draft a box, prism, cylinder or other shape with straight sides.`,
  wholeAxis: (f, kind, axis) => `${f.id} (draft): the sides of this ${kind} are not parallel to the ${axis} pull direction, so ${f.id} is shown without it -- pull along the ${kind === 'cylinder' ? 'cylinder\'s own axis' : 'axis the sides run along'} (usually z), for example with from:'top' or from:'bottom'.`,
  outlineCrosses: (f) => `${f.id} (draft): the outline of ${f.target} touches or crosses itself, so its sides cannot be drafted and ${f.id} is shown without it -- fix the outline first.`,
  wholeShape: (f, kind) => `${f.id} (draft): drafting a whole shape is not built for ${kind} yet, so ${f.id} is shown without it -- draft a plain box, prism, wedge, cylinder or extruded outline, or draft one face at a time.`,
  sphereFace: (f) => `${f.id} (draft): a sphere has no flat face to draft, so ${f.id} is shown without it -- draft a box, prism or other shape with flat sides.`,
  curvedFace: (f, word) => `${f.id} (draft): the curved side of a cylinder cannot be picked for a draft yet, so ${f.id} is shown without it -- draft a flat face instead.`,
  squareNeighbours: (f) => `${f.id} (draft): the faces next to the one you are drafting must be square to the pull direction and the wall of a hole or a round cut into that face is not, so ${f.id} is shown without it -- draft the plain face first, then add the hole or round.`,
  tiltedNeighbour: (f) => `${f.id} (draft): the face next to the one you are drafting was already tilted by an earlier draft and this part cannot take a second tilted neighbour, so ${f.id} is shown without it -- draft one face of it, or draft the faces of a plain box one after another.`,
  engineDraft: (f) => `${f.id} (draft): this face of ${f.target} could not be drafted at ${fmt(f.angle)} degrees, so ${f.id} is shown without it -- try a smaller angle or a different face.`,
  noOpposite: (f) => `${f.id} (draft): the face could not be found on the part as it is now, so ${f.id} is shown without it.`,
  unverified: (f) => `Tilting ${f.id} at ${fmt(f.angle)} degrees could not be checked against a smaller tilt of the same face, so ${f.id} is shown without it -- use a smaller angle.`,
};

/** engine text -> sentence. Anything that is not recognised still becomes a sentence; raw engine text never reaches the student. */
export function plainEngineText(raw, f, ctx = {}) {
  const r = String(raw);
  if (f.kind === 'shell') {
    const rim = /round of radius ([\d.]+) mm.*shell is ([\d.]+) mm/i.exec(r);
    if (rim) return SENTENCE.rim(f, +rim[1], +rim[2]);
    if (/collapse|implausible result volume|enclose a solid|corner whose faces|no thickness|not oriented and closed/i.test(r)) return SENTENCE.thickGeneric(f);
    if (/select at least one face|faces. must be a list of points|no face at/i.test(r)) return ctx.drafted ? SENTENCE.noFaceDrafted(f, WORD_OF[f.open?.part] ?? 'open', ctx.drafted) : SENTENCE.noFace(f, WORD_OF[f.open?.part] ?? 'open');
    return SENTENCE.openAxisEngine(f);
  }
  if (f.kind === 'draft') {
    if (/angle must be between/i.test(r)) return SENTENCE.angleRange(f, 89);
    if (/parallel to the pull/i.test(r)) return SENTENCE.cap(f, WORD_OF[f.face?.part] ?? 'flat', { pull: f.pull });
    if (/square to the pull/i.test(r)) return SENTENCE.squareNeighbours(f);
    if (/no faces? to draft|no face at/i.test(r)) return SENTENCE.noOpposite(f);
    return SENTENCE.engineDraft(f);
  }
  return null;
}
/** Used on every refusal the wrapper emits, including those phase0 wrote for other feature kinds: strip the engine tail. */
const FRAG = /solidcraft refused it -- (.*)$/s;
function sanitize(s, fById) {
  const m = FRAG.exec(s);
  if (!m) return s;
  const id = /^([A-Za-z]+\d+) \(/.exec(s)?.[1];
  const f = fById[id];
  // shell and draft have their own mapping; any other feature kind that the engine refused gets one generic plain sentence (never the engine text)
  return f ? (plainEngineText(m[1], f) ?? `${id} (${f.kind}): this step could not be built on the parts before it, so ${id} is shown without it.`) : `This step could not be built, so it is shown without it.`;
}

// ---- document analysis -----------------------------------------------------------------------------------------------
function polyConvex(pts, bulges) {
  if (!pts || pts.length < 3) return false;
  if (bulges && Object.values(bulges).some((g) => g)) return false; // arcs: not proven here
  let sign = 0; const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}

/**
 * Is the solid `id` free of inside (reflex) edges? Returns {convex:true} or {convex:false, why}.
 * Walks the ModelDoc history. Through-holes are the one cut allowed: their edges are all 90-degree outside edges and the offset of a
 * cylindrical wall is another cylinder (measured: hollow after a through hole off-centre, truck 9520.16 vs OCCT 9520.23, 7e-6).
 */
export function convexity(id, byId, arc, holeExt = {}) {
  const seen = new Set();
  const go = (cur) => {
    if (seen.has(cur)) return { convex: false, why: 'a loop in the history' };
    seen.add(cur);
    const f = byId[cur];
    if (!f) return { convex: false, why: `an unknown feature ${cur}` };
    switch (f.kind) {
      case 'box': case 'cylinder': case 'sphere': case 'cone': case 'prism': case 'wedge': return { convex: true };
      case 'torus': return { convex: false, why: 'a ring has a hole through its middle' };
      case 'move': return f.copy ? { convex: false, why: 'a copy' } : go(f.target);
      case 'rotate': case 'draft': return go(f.target);
      case 'fillet': return go(f.target);
      case 'extrude': {
        const sk = byId[f.target];
        if (!sk) return { convex: false, why: 'a sketch that is missing' };
        if (sk.shape === 'circle') return { convex: true };
        let o; try { o = arc.outlineOf(sk); } catch { o = { ok: false }; }
        if (!o.ok) return { convex: false, why: 'a sketch outline that could not be read' };
        return polyConvex(o.points, o.bulges) ? { convex: true } : { convex: false, why: 'an extruded outline with an inside corner or an arc' };
      }
      case 'hole': {
        const t = go(f.target);
        if (!t.convex) return t;
        // through-hole only: depth reaches across the whole part along the hole axis
        const ax = AXI[f.axis ?? 'z'];
        const ext = holeExt[f.id]?.[ax];
        const along = Math.abs((f.center ?? [0, 0, 0])[ax]); // the hole is centred on the bbox centre + center, so an offset along its own axis shortens one side
        return ext !== undefined && f.depth / 2 - along >= ext / 2 - 1e-9 ? { convex: true, holes: true } : { convex: false, why: 'a blind hole (its floor is an inside corner)' };
      }
      case 'shell': return { convex: false, why: 'it is already hollow' };
      case 'combine': return { convex: false, why: f.op === 'union' ? 'a join' : f.op === 'subtract' ? 'a cut' : 'a keep-overlap' };
      case 'pocket': case 'groove': return { convex: false, why: 'a pocket or groove' };
      case 'mirror': return { convex: false, why: 'a mirror' };
      case 'pattern': return { convex: false, why: 'repeated copies' };
      case 'revolve': case 'blend': return { convex: false, why: 'a revolved or lofted body' };
      default: return { convex: false, why: `a ${f.kind}` };
    }
  };
  return go(id);
}
/** the history from `fromId` (exclusive) to `toId` (inclusive), following target links; null when fromId is not on the way. */
function hops(fromId, toId, byId) {
  const out = []; let cur = toId; const seen = new Set();
  while (cur && cur !== fromId && !seen.has(cur)) {
    seen.add(cur);
    const f = byId[cur];
    if (!f) return null;
    out.push(f);
    cur = f.kind === 'combine' ? f.targets?.[0] : f.target;
  }
  return cur === fromId ? out.reverse() : null;
}
const rootOf = (id, byId) => {
  let cur = id; const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = byId[cur]; if (!f) return null;
    if (['box', 'cylinder', 'sphere', 'cone', 'prism', 'wedge', 'torus', 'extrude', 'revolve', 'blend'].includes(f.kind)) return f;
    cur = f.kind === 'combine' ? f.targets?.[0] : f.target;
  }
  return null;
};

// rotation as the translator applies it: about X, then Y, then Z (rotCmds), degrees
function rotPt(p, r) {
  let [x, y, z] = p;
  const R = (a) => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)];
  if (r?.[0]) { const [c, s] = R(r[0]); [y, z] = [c * y - s * z, s * y + c * z]; }
  if (r?.[1]) { const [c, s] = R(r[1]); [x, z] = [c * x + s * z, -s * x + c * z]; }
  if (r?.[2]) { const [c, s] = R(r[2]); [x, y] = [c * x - s * y, s * x + c * y]; }
  return [x, y, z];
}
const polyCentroid = (pts) => {
  let a = 0, cx = 0, cy = 0; const n = pts.length;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; const k = p[0] * q[1] - q[0] * p[1]; a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; }
  return Math.abs(a) < 1e-12 ? [pts[0][0], pts[0][1]] : [cx / (3 * a), cy / (3 * a)];
};
/**
 * G-TIE. For a prism / wedge / plain-polygon extrude: the faces' centres, scored the way the OCCT resolver scores them (centre . word
 * direction). A tie for the best score between two faces means the word names no single face. Returns null when there is no tie or the
 * shape is not one this checks (box, cylinder, cone, sphere: a word names exactly one face).
 */
export function wordTie(root, part, byId, arc, mt) {
  const dir = DIRV[part];
  if (!dir || !root) return null;
  let poly = null, n = null, kind = root.kind;
  if (root.kind === 'prism') {
    n = Math.max(3, Math.min(12, Math.round(root.sides)));
    poly = Array.from({ length: n }, (_, i) => [root.radius * Math.cos(2 * Math.PI * i / n), root.radius * Math.sin(2 * Math.PI * i / n)]);
  } else if (root.kind === 'box') {
    // a box has a tie only when it has been turned: two faces become equally far along a world word (e.g. a square plan turned 45 degrees)
    if (isZero3(root.rotate)) return null;
    const [w, d, h] = root.size.map((v) => v / 2);
    const c = root.center ?? [0, 0, 0];
    const centres = [[w, 0, 0], [-w, 0, 0], [0, d, 0], [0, -d, 0], [0, 0, h], [0, 0, -h]].map((p) => { const q = rotPt(p, root.rotate); return [q[0] + c[0], q[1] + c[1], q[2] + c[2]]; });
    return tieOf(centres, dir, 'box', null);
  } else if (root.kind === 'wedge') {
    poly = [[-root.width / 2, -root.depth / 2], [root.width / 2, -root.depth / 2], [-root.width / 2, root.depth / 2]];
  } else if (root.kind === 'extrude') {
    const sk = byId[root.target];
    if (!sk || sk.shape === 'circle') return null;
    let o; try { o = arc.outlineOf(sk); } catch { return null; }
    if (!o.ok || (o.bulges && Object.values(o.bulges).some(Boolean))) return null;
    const fr = mt.sketchFrameOf(sk);
    const to3 = (p) => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1]);
    const h = root.height; const sw = sweepOf(fr);
    const centres = [];
    const P = o.points;
    for (let i = 0; i < P.length; i++) {
      const a = to3(P[i]), b = to3(P[(i + 1) % P.length]);
      centres.push([0, 1, 2].map((k) => (a[k] + b[k]) / 2 + sw[k] * h / 2));
    }
    const c0 = polyCentroid(P);
    centres.push(to3(c0), to3(c0).map((v, k) => v + sw[k] * h));
    return tieOf(centres, dir, kind, null);
  } else return null;
  const c = root.center ?? [0, 0, 0];
  const centres = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    centres.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]);
  }
  const cc = polyCentroid(poly);
  centres.push([cc[0], cc[1], root.height / 2], [cc[0], cc[1], -root.height / 2]);
  const moved = centres.map((p) => { const q = rotPt(p, root.rotate); return [q[0] + c[0], q[1] + c[1], q[2] + c[2]]; });
  return tieOf(moved, dir, kind, n);
}
function tieOf(centres, dir, kind, n) {
  const sc = centres.map((p) => p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]);
  const best = Math.max(...sc);
  const top = sc.filter((v) => Math.abs(v - best) <= 1e-7);
  return top.length > 1 ? { kind, n, ties: top.length } : null;
}

/** getting the draft-from neutral usage out of the script text: which draft calls used `from:` and no `neutral:` */
export function draftFromUsage(script) {
  const out = []; // one entry per draft( call, in order
  const re = /\bdraft\s*\(/g; let m;
  while ((m = re.exec(script))) {
    let depth = 1, i = re.lastIndex;
    while (i < script.length && depth > 0) { const ch = script[i++]; if (ch === '(') depth++; else if (ch === ')') depth--; }
    const body = script.slice(re.lastIndex, i - 1);
    out.push({ from: /\bfrom\s*:\s*['"]([a-z]+)['"]/.exec(body)?.[1] ?? null, neutral: /\bneutral\s*:/.test(body) });
  }
  return out;
}

// ---- the translator ----------------------------------------------------------------------------------------------------
/** Does feature f read a solid that is hollow with no open side (a closed hollow)? Returns a phrase naming it, else null. */
function voidedDep(f, st) {
  const ids = new Set(Object.keys(st.voided));
  if (!ids.size) return null;
  let hit = null;
  const walk = (v, key) => {
    if (hit) return;
    if (typeof v === 'string') { if (key !== 'id' && ids.has(v)) hit = v; }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(f, '');
  return hit ? `the hollow ${hit}` : null;
}
/**
 * ctx: { arc, mt, runSC, resolveAt }  as phase0's translateDoc, plus opts.fromUsage (draftFromUsage(script)) when known.
 * Returns the same shape as phase0's translateDoc, plus features[i].guard (which guard fired) and .raw (engine text, for the log only).
 */
export function translateDocGuarded(doc, ctx, opts = {}) {
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, voided: {} };
  const byId = Object.fromEntries(doc.features.map((f) => [f.id, f]));
  const holeExt = {}; const holeBox = {};
  const accepted = []; const out = [];
  const draftIds = doc.features.filter((f) => f.kind === 'draft').map((f) => f.id);
  const headOf = (id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };

  doc.features.forEach((f, idx) => {
    const prefix = doc.features.slice(0, idx);
    const fctx = { ...ctx, resolve: (name) => ctx.resolveAt(prefix, name) };
    const note = (o) => out.push({ id: f.id, kind: f.kind, ...o });
    if (f.kind === 'sketch') st.sketches[f.id] = f;
    // holes need the target's extent to tell through from blind: annotate from what was measured so far
    if (f.kind === 'hole') { const m = st.measure[f.target]; if (m) { holeExt[f.id] = [0, 1, 2].map((i) => m.bbox[i + 3] - m.bbox[i]); holeBox[f.id] = m.bbox; } }
    let plan;
    try {
      const vd = voidedDep(f, st);
      if (f.kind === 'box' && f.round && f.roundStyle === 'chamfer') plan = { ...refuse(SENTENCE.chamferBox(f)), guard: 'G-CHAMFER' };
      else if (vd && !['shell', 'move', 'rotate'].includes(f.kind)) plan = { ...refuse(SENTENCE.afterClosedHollow(f, vd)), guard: 'G-VOID' };
      else plan = f.kind === 'shell' ? planShell(f, st, fctx, { byId, headOf, opts, holeExt, holeBox })
        : f.kind === 'draft' ? planDraft(f, st, fctx, { byId, headOf, opts, draftIds, holeExt, holeBox })
        : planFeature(f, st, fctx);
      if (vd && ['move', 'rotate'].includes(f.kind) && !plan.refusal && !plan.noop) {
        if (f.kind === 'move' && f.copy) plan = { ...refuse(SENTENCE.afterClosedHollow(f, vd)), guard: 'G-VOID' };
        else { plan.voided = true; plan.post = (after, before) => (before && (Math.abs(after.volume - before.volume) > 3e-4 * Math.max(1, before.volume) || after.faces !== before.faces) ? { guard: 'G-VOID', refusal: SENTENCE.afterClosedHollow(f, vd) } : null); }
      }
    } catch (e) { plan = refuse(`${f.id} (${f.kind}): this step could not be built (${String(e.message).replace(/[\[\]`]/g, '')}), so it is shown without it.`); }
    if (plan.refusal) { const s = sanitize(plan.refusal, byId); st.refused[f.id] = s; return note({ status: plan.status ?? 'refused', refusal: s, guard: plan.guard, commands: [] }); }
    if (plan.noop) return note({ status: 'noop', commands: [] });
    let lastErr = null;
    for (const variant of plan.variants) {
      let res;
      try { res = ctx.runSC([...accepted, ...variant]); } catch (e) { res = { ok: false, failed: { error: `WASM TRAP: ${e.message}` } }; }
      if (!res.ok) { lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown'); continue; }
      const m = aggregateOf(res, plan.produces);
      if (!m) { lastErr = `no body named ${plan.produces.join(', ')} came back`; continue; }
      const bad = plan.post?.(m, st.measure[headOf(f.target)] ?? st.measure[f.target], { accepted: [...accepted], variant, runSC: ctx.runSC });
      if (bad) {
        const s = sanitize(bad.refusal, byId);
        st.refused[f.id] = s;
        return note({ status: 'refused', refusal: s, guard: bad.guard, unguarded: { volume: m.volume, faces: m.faces, bbox: m.bbox, com: m.com }, commands: variant });
      }
      accepted.push(...variant);
      st.bodies[f.id] = m.bodies; st.measure[f.id] = m;
      if (plan.voided) st.voided[f.id] = true;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? f.target : f.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
      }
      return note({ status: 'built', commands: variant, measure: m, pickedFrom: plan.pickedFrom, variantsTried: plan.variants.indexOf(variant) + 1, pick: (variant.find((c) => c.params.edges || c.params.faces)?.params) ?? null });
    }
    const raw = lastErr;
    const sentence = plan.plain ? plan.plain(raw) : sanitize(`${f.id} (${f.kind}): solidcraft refused it -- ${raw}`, byId);
    st.refused[f.id] = sentence;
    note({ status: 'refused', refusal: sentence, raw, guard: 'engine', commands: plan.variants[0] });
  });
  return { features: out, commands: accepted };
}

function aggregateOf(res, names) {
  const bs = res.measure.bodies.filter((b) => names.includes(b.name));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  return {
    volume: bs.reduce((s, b) => s + b.volume_mm3, 0),
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / bs.reduce((a, b) => a + b.volume_mm3, 0)),
    bodies: bs.map((b) => b.name),
  };
}

// ---- pick: where is the face NOW --------------------------------------------------------------------------------------
/**
 * G-PICK. Candidate 3D points for a named primitive face, in the part's current position.
 *  - base point: brep-rs resolve (in the primitive's own frame) + every `move` between the primitive and the target
 *  - a rotate / copy / join / mirror in between: refused (the point cannot be carried)
 *  - for an axis word on a part with no tilt: the point must sit on the part's current bounding-box extreme for that axis; else refused
 *  - extra candidates (grid points on the same plane) so a face with a hole through its middle can still be picked
 */
function pickPoints(f, name, st, ctx, G, { gridOnHole, boxResult: opts_boxResult = false }) {
  const root = byId0(G, name.feature);
  const r = ctx.resolve(name);
  const chain = hops(name.feature, f.target, G.byId);
  if (!r || r.kind !== 'face') {
    const word = WORD_OF[name.part] ?? name.part;
    const dr = (chain ?? []).find((h) => h.kind === 'draft' && ((h.face?.feature === name.feature && h.face?.part === name.part) || (h.whole && DIRV[name.part] && DIRV[name.part][AXI[h.pull ?? 'z']] === 0)));
    if (dr) return { err: f.kind === 'shell' ? SENTENCE.noFaceDrafted(f, word, dr) : SENTENCE.noFace(f, word, `was tilted by ${dr.id}`) };
    if (root?.kind === 'sphere') return { err: SENTENCE.noFace(f, word, 'does not exist (a sphere has no flat faces)') };
    return { err: SENTENCE.noFace(f, word) };
  }
  if (!chain) return { err: SENTENCE.stale(f, `${WORD_OF[name.part] ?? 'chosen'} face`) };
  let shift = [0, 0, 0];
  for (const h of chain) {
    if (h.kind === 'move') { if (h.copy) return { err: SENTENCE.stale(f, `${WORD_OF[name.part]} face`) }; shift = shift.map((v, i) => v + h.offset[i]); }
    else if (['shell', 'draft', 'hole', 'fillet'].includes(h.kind)) continue;
    else if (opts_boxResult && (h.kind === 'mirror' || (h.kind === 'combine' && h.op === 'union'))) continue; // the root stays where it is; the extreme-face check below guards the pick
    else return { err: SENTENCE.stale(f, `${WORD_OF[name.part]} face`) };
  }
  const base = r.centroid.map((v, i) => v + shift[i]);
  const pts = [base];
  const m = st.measure[G.headOf(f.target)] ?? st.measure[f.target];
  const dir = DIRV[name.part];
  const tilt = root && !isZero3(root.rotate) && root.rotate.some((a) => a % 90 !== 0);
  if (dir && m && !tilt) {
    const ax = dir.findIndex((v) => v !== 0);
    const ext = dir[ax] > 0 ? m.bbox[ax + 3] : m.bbox[ax];
    const scale = Math.max(1, Math.abs(ext));
    const rootBox = root && ['box'].includes(root.kind);
    // a face of a plain box (or of a box with holes): its plane must be the bbox extreme
    if (rootBox || (root && ['extrude'].includes(root.kind))) {
      if (Math.abs(base[ax] - ext) > 1e-6 * scale && !chain.some((h) => h.kind === 'draft')) return { err: opts_boxResult ? SENTENCE.swallowed(f, WORD_OF[name.part], name.feature) : SENTENCE.stale(f, `${WORD_OF[name.part]} face`) };
    }
    if (gridOnHole && rootBox) {
      const o = [0, 1, 2].filter((i) => i !== ax);
      for (const [a, b] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.1, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9]]) {
        const p = [0, 0, 0]; p[ax] = ext;
        p[o[0]] = m.bbox[o[0]] + a * (m.bbox[o[0] + 3] - m.bbox[o[0]]);
        p[o[1]] = m.bbox[o[1]] + b * (m.bbox[o[1] + 3] - m.bbox[o[1]]);
        pts.push(p);
      }
    }
  }
  return { pts, shift, root };
}
const byId0 = (G, id) => rootOf(id, G.byId);


// ---- closed hollow (no open face): outer solid minus an inner copy of the same primitive, smaller by the wall --------------------------------
/** result measured as a plain axis-aligned box: 6 plane faces and volume equal to the bounding-box volume */
function isPlainBox(m) {
  if (!m || m.faces !== 6 || (m.faceTypes?.plane ?? 0) !== 6) return false;
  const bv = (m.bbox[3] - m.bbox[0]) * (m.bbox[4] - m.bbox[1]) * (m.bbox[5] - m.bbox[2]);
  return Math.abs(m.volume - bv) <= 1e-9 * Math.max(bv, 1);
}
/** the history of `id` is a box, mirrors, unions and (non-copy) moves only */
function onlyBoxJoins(id, byId) {
  const seen = new Set();
  for (let cur = id; cur && !seen.has(cur); ) {
    seen.add(cur);
    const h = byId[cur]; if (!h) return false;
    if (h.kind === 'box') return !h.round;
    if (h.kind === 'mirror' || (h.kind === 'move' && !h.copy)) cur = h.target;
    else if (h.kind === 'combine' && h.op === 'union') cur = h.targets?.[0];
    else return false;
  }
  return false;
}
const KIND_NAME = { cone: 'cone', wedge: 'wedge', torus: 'ring', extrude: 'extruded outline', revolve: 'revolved shape', blend: 'lofted shape', box: 'box', cylinder: 'cylinder', sphere: 'sphere', prism: 'prism' };
const HOP_NAME = { combine: 'a join or cut', fillet: 'a round or bevel', hole: 'a hole', draft: 'a draft', mirror: 'a mirror', pattern: 'repeated copies', pocket: 'a pocket', groove: 'a groove', rotate: 'a turn', shell: 'a hollow', move: 'a copy' };
function planClosedShell(f, st, ctx, G, bs) {
  const head = G.headOf(f.target);
  if (st.voided[head] || G.byId[head]?.kind === 'shell') return { ...refuse(SENTENCE.shellTwice(f)), guard: 'G-TWICE' };
  const why = (w) => ({ ...refuse(SENTENCE.closed(f, w)), guard: 'G-CLOSED' });
  const root = rootOf(f.target, G.byId);
  if (!root) return why(`${f.target} has a history this cannot follow`);
  if (!['box', 'cylinder', 'sphere', 'prism'].includes(root.kind)) return why(`${f.target} is made from ${/^[aeiou]/.test(KIND_NAME[root.kind] ?? root.kind) ? 'an' : 'a'} ${KIND_NAME[root.kind] ?? root.kind}`);
  const chain = hops(root.id, f.target, G.byId);
  if (!chain) return why(`${f.target} has a history this cannot follow`);
  const bad = chain.find((h) => !(h.kind === 'move' && !h.copy));
  if (bad) return why(`${f.target} has been changed by ${HOP_NAME[bad.kind] ?? `a ${bad.kind}`}`);
  if (root.round) return { ...refuse(root.kind === 'cylinder' && root.roundStyle === 'chamfer' ? SENTENCE.chamferCyl(f) : SENTENCE.closed(f, `${f.target} has rounded or bevelled edges`)), guard: 'G-CLOSED' };
  const t = f.thickness;
  const clone = (o) => ({ ...root, id: `${f.id}_in`, ...o });
  let inner, vInner, limit, curved = false;
  if (root.kind === 'box') {
    limit = Math.min(...root.size) / 2;
    const sz = root.size.map((v) => v - 2 * t);
    if (t >= limit - 1e-9) return { ...refuse(SENTENCE.thickBox(f, limit)), guard: 'G-THICK' };
    inner = clone({ size: sz }); vInner = sz[0] * sz[1] * sz[2];
  } else if (root.kind === 'cylinder') {
    limit = Math.min(root.radius, root.height / 2); curved = true;
    if (t >= limit - 1e-9) return { ...refuse(SENTENCE.thickBox(f, limit)), guard: 'G-THICK' };
    inner = clone({ radius: root.radius - t, height: root.height - 2 * t }); vInner = Math.PI * (root.radius - t) ** 2 * (root.height - 2 * t);
  } else if (root.kind === 'sphere') {
    limit = root.radius; curved = true;
    if (t >= limit - 1e-9) return { ...refuse(SENTENCE.thickBox(f, limit)), guard: 'G-THICK' };
    inner = clone({ radius: root.radius - t }); vInner = 4 / 3 * Math.PI * (root.radius - t) ** 3;
  } else {
    const n = Math.max(3, Math.min(12, Math.round(root.sides)));
    const ap = root.radius * Math.cos(Math.PI / n);
    limit = Math.min(root.height / 2, ap);
    if (t >= limit - 1e-9) return { ...refuse(SENTENCE.thickBox(f, limit)), guard: 'G-THICK' };
    const R2 = root.radius - t / Math.cos(Math.PI / n);
    inner = clone({ radius: R2, height: root.height - 2 * t }); vInner = n / 2 * R2 * R2 * Math.sin(2 * Math.PI / n) * (root.height - 2 * t);
  }
  const ip = planFeature(inner, st, ctx);
  if (ip.refusal) return refuse(SENTENCE.closedFail(f));
  const innerName = ip.produces[0];
  const cmds = [...ip.variants[0]];
  for (const h of chain) cmds.push({ command: 'solid.move', params: { bodies: [innerName], translate: h.offset } });
  cmds.push({ command: 'solid.combine', params: { target: bs[0], tools: [innerName], operation: 'cut' } });
  return {
    variants: [cmds], produces: bs, consumes: [f.target], voided: true, pickedFrom: 'none (outer solid minus an inner copy of the primitive)',
    plain: () => SENTENCE.closedFail(f),
    post: (after, before) => {
      if (!before) return null;
      const want = before.volume - vInner;
      const tol = curved || before.curved ? 5e-4 : 1e-9;
      if (Math.abs(after.volume - want) > tol * Math.max(before.volume, 1) || !(after.faces >= 2 * before.faces - (root.kind === 'sphere' ? 1 : 0)) || after.bodies.length !== 1) return { guard: 'G-CLOSED', refusal: SENTENCE.closedFail(f) };
      return null;
    },
  };
}

function planShell(f, st, ctx, G) {
  const dep = (id, role = 'target') => {
    id = G.headOf(id);
    if (st.refused[id]) return `${f.id} (hollow): it needs ${id}, which could not be built, so ${f.id} is shown without it.`;
    if (st.stale[id]) return `${f.id} (hollow): ${id} was already changed by ${st.stale[id]}, so ${f.id} is shown without it.`;
    return null;
  };
  const d = dep(f.target); if (d) return refuse(d);
  const bs = st.bodies[G.headOf(f.target)];
  if (!bs || bs.length !== 1) return refuse(`${f.id} (hollow): ${f.target} is not a single solid, so ${f.id} is shown without it.`);
  if (!f.open) return planClosedShell(f, st, ctx, G, bs);
  let cv = convexity(G.headOf(f.target), G.byId, ctx.arc, G.holeExt);
  // G-CONVEX over-refusal fix: a mirror or a join whose RESULT is measured to be a plain axis-aligned box (6 plane faces, volume = bounding-box volume) has no inside
  // edge at all, so the hollow is the hollow of that box. The open face is still picked from the root primitive (it stays where it is), and pickPoints
  // refuses unless that face lies on the box's bounding-box extreme, so a face that the mirror swallowed is never opened.
  let boxResult = false;
  if (!cv.convex && /^a (mirror|join)$/.test(cv.why)) {
    const m0 = st.measure[G.headOf(f.target)];
    const root0 = rootOf(f.open.feature, G.byId);
    if (m0 && root0?.kind === 'box' && isZero3(root0.rotate) && isPlainBox(m0) && onlyBoxJoins(G.headOf(f.target), G.byId)) { cv = { convex: true, boxResult: true }; boxResult = true; }
  }
  if (!cv.convex && /^it is already hollow/.test(cv.why)) return { ...refuse(SENTENCE.shellTwice(f)), guard: 'G-TWICE' };
  if (!cv.convex && /^a blind hole/.test(cv.why)) return { ...refuse(SENTENCE.blindHole(f)), guard: 'G-BLIND' };
  if (!cv.convex) return { ...refuse(SENTENCE.concave(f, cv.why)), guard: 'G-CONVEX' };
  const part = f.open.part;
  if (part === 'side') return refuse(SENTENCE.hollowSide(f));
  const root = rootOf(f.open.feature, G.byId);
  const tie = wordTie(root, part, G.byId, ctx.arc, ctx.mt);
  if (tie) return { ...refuse(SENTENCE.tie(f, WORD_OF[part], tie.kind, tie.n)), guard: 'G-TIE' };
  if (root && ['sphere', 'cylinder', 'cone'].includes(root.kind) && isZero3(root.rotate)) {
    const flat = root.kind === 'sphere' ? [] : root.kind === 'cone' ? ['-z'] : ['+z', '-z'];
    if (!flat.includes(part)) return { ...refuse(SENTENCE.noFlat(f, WORD_OF[part], root.kind)), guard: 'G-FLAT' };
  }
  const m = st.measure[G.headOf(f.target)] ?? st.measure[f.target];
  const rootR = rootOf(f.target, G.byId);
  // a cylinder drafted whole is a cone: truck's offset of a conical wall is not the normal offset (cylinder 24x30, draft 5 from the bottom, hollow open:top wall 2:
  // 4272.4782 against the exact 4281.1079, 2.0e-3, beyond the curved bar). A drafted prism or box offsets exactly (ha2 / ha3 cases), so only the curved root is refused.
  if (rootR && (rootR.kind === 'cylinder' || (rootR.kind === 'extrude' && G.byId[rootR.target]?.shape === 'circle'))) {
    const dh = (hops(rootR.id, f.target, G.byId) ?? []).find((h) => h.kind === 'draft');
    if (dh) return { ...refuse(SENTENCE.hollowCone(f)), guard: 'G-CONE' };
  }
  if (rootR?.round && rootR.kind === 'cylinder' && rootR.roundStyle === 'chamfer') return { ...refuse(SENTENCE.chamferCyl(f)), guard: 'G-CHAMFER' };
  if (rootR?.round && f.thickness <= rootR.round + 1e-9) return { ...refuse(SENTENCE.rim(f, rootR.round, f.thickness, rootR.roundStyle)), guard: 'G-ROUND' };
  // G-THICK pre-check for a plain box: cavity depth along the open axis and half the narrowest lateral width
  const rootT = rootOf(f.target, G.byId);
  const dirv = DIRV[part];
  if (dirv && rootT?.kind === 'box' && m && !(rootT.rotate && rootT.rotate.some((a) => a % 90 !== 0)) && !rootT.round) {
    const ax = dirv.findIndex((v) => v !== 0);
    const e = [0, 1, 2].map((i) => m.bbox[i + 3] - m.bbox[i]);
    const limit = Math.min(e[ax], ...[0, 1, 2].filter((i) => i !== ax).map((i) => e[i] / 2));
    if (f.thickness >= limit - 1e-9) return { ...refuse(SENTENCE.thickBox(f, limit)), guard: 'G-THICK' };
  }
  // G-HOLE: a through hole is only safe when its offset tube (radius r + wall) lies wholly inside the cavity, clear of the cavity walls and of every other tube.
  // Measured: hole d6 at [14,0] in a 40x40x20 box, wall 2, open top: tube reaches x = 19 > 18, truck 9509.3 vs closed form 9446.65 (dVol 6.6e-3), silent.
  if (cv.holes) {
    const holes = []; for (let cur = G.headOf(f.target), seen = new Set(); cur && !seen.has(cur); ) { seen.add(cur); const h = G.byId[cur]; if (!h) break; if (h.kind === 'hole') holes.push(h); cur = h.kind === 'combine' ? h.targets?.[0] : h.target; }
    const rt = rootOf(f.target, G.byId);
    const bad = (why) => ({ ...refuse(SENTENCE.holeNear(f, why)), guard: 'G-HOLE' });
    if (!rt || rt.kind !== 'box' || (rt.rotate && rt.rotate.some((a) => a % 90 !== 0))) return bad('the hole is in a part that is not a plain box');
    if (new Set(holes.map((h) => h.axis ?? 'z')).size > 1) return bad('the holes run in different directions');
    const O = dirv ? dirv.findIndex((v) => v !== 0) : -1; const openHi = dirv ? dirv[O] > 0 : true;
    const tubes = [];
    for (const h of holes) {
      const box = G.holeBox[h.id]; if (!box) return bad('the part was measured before the hole');
      const ax = AXI[h.axis ?? 'z']; const r = h.diameter / 2; const R = r + f.thickness;
      const bc = [0, 1, 2].map((i) => (box[i] + box[i + 3]) / 2);
      const c = [0, 1, 2].map((i) => bc[i] + h.center[i]);
      for (const i of [0, 1, 2].filter((k) => k !== ax)) {
        const openSide = i === O;
        const loLim = box[i] + (openSide && !openHi ? 0 : f.thickness); const hiLim = box[i + 3] - (openSide && openHi ? 0 : f.thickness);
        if (c[i] - R < loLim - 1e-9 || c[i] + R > hiLim + 1e-9) return bad(`the hole's wall allowance of ${fmt(R)} reaches the side wall`);
      }
      tubes.push({ c, ax, R });
    }
    for (let a = 0; a < tubes.length; a++) for (let b = a + 1; b < tubes.length; b++) {
      const d = Math.hypot(...[0, 1, 2].filter((k) => k !== tubes[a].ax).map((k) => tubes[a].c[k] - tubes[b].c[k]));
      if (d < tubes[a].R + tubes[b].R - 1e-9) return bad('two holes are closer than their wall allowances');
    }
  }
  // G-RIM: a ROUND on an edge of the OPEN face, as big as the wall, leaves a knife-edge rim (zero thickness); a bevel does not (its flat face is offset too, leaving a flat rim 2.83 wide for bevel 2 / wall 2). The engine refuses it for a
  // whole-shape round but builds the degenerate rim for a single edge (r 2, wall 2, top edge: 8637.641, equal to the closed form 8637.66 but with a zero-thickness rim)
  for (let cur = G.headOf(f.target), seen = new Set(); cur && !seen.has(cur); ) {
    seen.add(cur);
    const h = G.byId[cur]; if (!h) break;
    if (h.kind === 'fillet' && h.style !== 'chamfer' && h.edge?.of?.some((n) => n.feature === f.open.feature && n.part === f.open.part) && h.size >= f.thickness - 1e-9) {
      return { ...refuse(SENTENCE.rim(f, h.size, f.thickness, h.style)), guard: 'G-RIM' };
    }
    cur = h.kind === 'combine' ? h.targets?.[0] : h.target;
  }
  const gridOnHole = (cv.holes === true);
  const pk = pickPoints(f, f.open, st, ctx, G, { gridOnHole, boxResult });
  if (pk.err) return { ...refuse(pk.err), guard: 'G-PICK' };
  const variants = pk.pts.map((p) => [{ command: 'solid.shell', params: { faces: [p], thickness: f.thickness, body: bs[0] } }]);
  const drafted = (hops(f.open.feature, f.target, G.byId) ?? []).find((h) => h.kind === 'draft' && ((h.face?.feature === f.open.feature && h.face?.part === f.open.part) || (h.whole && DIRV[f.open.part] && DIRV[f.open.part][AXI[h.pull ?? 'z']] === 0)));
  return {
    variants, produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve + moves in the history',
    plain: (raw) => plainEngineText(raw, f, { drafted }),
    post: (after, before) => {
      if (!before) return null;
      // a hollow must lose volume and gain faces; the unhollowed block comes back with neither
      // planar: the volume must drop; curved volumes are tessellation-derived (about 1e-4), so only 'identical' counts as unhollowed
      const dropped = after.curved || before.curved ? Math.abs(after.volume - before.volume) > 1e-9 * before.volume && after.volume < before.volume * (1 + 5e-4) : after.volume < before.volume * (1 - 1e-9);
      if (!dropped || !(after.faces > before.faces)) return { guard: 'G-THICK', refusal: SENTENCE.thickGeneric(f) };
      return null;
    },
  };
}

/**
 * G-SWEEP. While the tilted face meets nothing, the volume is an exact QUADRATIC in t = tan(angle): V(t) = V0 + c1 t + c2 t^2 (the face moves a
 * wedge through the part; c2 is non-zero when the faces next to it are not square to it, as on a prism). The same draft is therefore run at three tiny
 * tilts t1, 2 t1, 3 t1 on the same part, V(t) is fitted from the first two, the third must fall on the fit (else the probes are not clean:
 * 'unverified'), and the full-angle result is accepted only if it lies on the fitted curve. A tilted face that runs into an inside wall leaves the curve
 * at once (L extrude, 45 degrees: 11750 returned against 10500 on the curve); a fitting draft sits on it to about 1e-12 of the volume.
 * Returns null (on the curve), 'off-curve' or 'unverified' (a probe could not be run, or the probes disagree).
 */
export const SWEEP_TOL = { planar: 1e-9, curved: 2e-5 };
function sweepCheck(f, after, before, env, bodies) {
  const ax = AXI[f.pull ?? 'z'];
  const tanA = Math.tan(Math.abs(f.angle) * Math.PI / 180);
  const ext = [0, 1, 2].map((i) => before.bbox[i + 3] - before.bbox[i]);
  const zspan = Math.max(Math.abs(before.bbox[ax] - f.neutral), Math.abs(before.bbox[ax + 3] - f.neutral), 1e-9);
  const minExt = Math.min(...ext.filter((v) => v > 1e-9));
  const t1 = Math.max(Math.tan(0.01 * Math.PI / 180), Math.min(Math.tan(Math.PI / 180), 0.01 * minExt / zspan));
  if (tanA <= 3.5 * t1) return null; // inside the probe range itself
  const sign = f.angle < 0 ? -1 : 1;
  const V = [before.volume];
  for (const k of [1, 2, 3]) {
    const a = sign * Math.atan(k * t1) * 180 / Math.PI;
    const probe = env.variant.map((c) => (c.command === 'solid.draft' ? { ...c, params: { ...c.params, angle: a } } : c));
    let res; try { res = env.runSC([...env.accepted, ...probe]); } catch { return 'unverified'; }
    if (!res?.ok) return 'unverified';
    const m = aggregateOf(res, bodies);
    if (!m) return 'unverified';
    V.push(m.volume);
  }
  const scale = Math.max(Math.abs(before.volume), 1);
  const baseTol = (after.curved || before.curved ? SWEEP_TOL.curved : SWEEP_TOL.planar) * scale;
  const c2t = (V[2] - 2 * V[1] + V[0]) / 2; const c1t = (V[1] - V[0]) - c2t; // c2 t1^2 and c1 t1
  const at = (t) => V[0] + c1t * (t / t1) + c2t * (t / t1) ** 2;
  if (Math.abs(at(3 * t1) - V[3]) > baseTol) return 'unverified';
  const pred = V[0] + c1t * (tanA / t1) + c2t * (tanA / t1) ** 2;
  return Math.abs(after.volume - pred) <= baseTol + 4e-15 * (tanA / t1) ** 2 * scale ? null : 'off-curve';
}

// ---- G-REACH: the plane coordinates a drafted face could run into --------------------------------------------------------------
/** SolidCraft's draft convention, measured (shell-draft-sections / runner sigma): out(z) = SIGMA tan(angle) (z - neutral), out < 0 = into the part. */
export const SC_SIGMA = -1;
const bboxCoords = (bb) => (bb ? [0, 1, 2].map((i) => [bb[i], bb[i + 3]]) : null);
const mergeC = (...cs) => (cs.some((c) => !c) ? null : [0, 1, 2].map((i) => cs.flatMap((c) => c[i])));
const shiftC = (c, v) => (c ? c.map((a, i) => a.map((x) => x + v[i])) : null);
/** All plane coordinates (per axis) the history of `id` could have put a wall or a vertex at; null = cannot enumerate (then G-REACH refuses). */
function critCoords(id, G, st, ctx, seen = new Set()) {
  if (seen.has(id)) return null;
  seen.add(id);
  const f = G.byId[id]; if (!f) return null;
  const own = bboxCoords(st.measure[id]?.bbox);
  const sketchC = (skId, heights) => {
    const sk = G.byId[skId]; if (!sk) return null;
    if (sk.shape === 'circle') return null;
    let o; try { o = ctx.arc.outlineOf(sk); } catch { return null; }
    if (!o.ok) return null;
    const fr = ctx.mt.sketchFrameOf(sk);
    const sw = sweepOf(fr);
    const to3 = (p, h) => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1] + sw[i] * h);
    const pts = o.points.flatMap((p) => heights.map((h) => to3(p, h)));
    return [0, 1, 2].map((i) => pts.map((q) => q[i]));
  };
  switch (f.kind) {
    case 'box': case 'cylinder': case 'sphere': case 'cone': case 'prism': case 'wedge': return own;
    case 'extrude': { const c = sketchC(f.target, [0, f.height]); return c && own ? mergeC(c, own) : null; }
    case 'move': return f.copy ? null : shiftC(critCoords(f.target, G, st, ctx, seen), f.offset);
    case 'draft': case 'shell': case 'fillet': { const c = critCoords(f.target, G, st, ctx, seen); return c && own ? mergeC(c, own) : c; }
    case 'combine': { const cs = f.targets.map((t) => critCoords(t, G, st, ctx, new Set(seen))); return mergeC(...cs, own ?? [[], [], []]); }
    case 'hole': {
      const c = critCoords(f.target, G, st, ctx, seen); const bb = G.holeBox[f.id]; if (!c || !bb) return null;
      const ax = AXI[f.axis ?? 'z']; const r = f.diameter / 2;
      const ctr = [0, 1, 2].map((i) => (bb[i] + bb[i + 3]) / 2 + f.center[i]);
      const h = [[], [], []];
      for (let i = 0; i < 3; i++) { if (i === ax) h[i].push(ctr[i] - f.depth / 2, ctr[i] + f.depth / 2, ctr[i] - f.depth, ctr[i] + f.depth); else h[i].push(ctr[i] - r, ctr[i] + r); }
      return mergeC(c, h);
    }
    case 'pocket': { const c = critCoords(f.into, G, st, ctx, seen); const k = sketchC(f.target, [0, f.depth, -f.depth, f.depth / 2, -f.depth / 2, f.length2 ?? 0, -(f.length2 ?? 0)]); return c && k ? mergeC(c, k, own ?? [[], [], []]) : null; }
    default: return null;
  }
}
const sweepIn = (angle, neutral, lo, hi) => Math.tan(Math.abs(angle) * Math.PI / 180) * (angle * SC_SIGMA < 0 ? Math.max(0, hi - neutral) : Math.max(0, neutral - lo));
/** null = fits; otherwise a reason. `c0` = the face's plane coordinate along its axis. */
function reachCheck(f, part, c0, st, ctx, G) {
  const dir = DIRV[part]; if (!dir) return 'unverified';
  const root = rootOf(f.face.feature, G.byId);
  if (root && !isZero3(root.rotate) && root.rotate.some((a) => a % 90 !== 0)) return 'unverified';
  const ax = dir.findIndex((v) => v !== 0); const side = dir[ax];
  const m = st.measure[G.headOf(f.target)] ?? st.measure[f.target]; if (!m) return 'unverified';
  const pa = AXI[f.pull ?? 'z'];
  const D = sweepIn(f.angle, f.neutral, m.bbox[pa], m.bbox[pa + 3]);
  if (D <= 0) return null;
  const coords = critCoords(G.headOf(f.target), G, st, ctx);
  if (!coords) return 'unverified';
  let dmin = Infinity;
  for (const c of coords[ax]) { const d = side * (c0 - c); if (d > 1e-9 * Math.max(1, Math.abs(c0))) dmin = Math.min(dmin, d); }
  if (D >= dmin * (1 - 2e-3)) return 'reach';
  // an opposite face drafted earlier also moves in
  for (const h of hops(f.face.feature, f.target, G.byId) ?? []) {
    if (h.kind !== 'draft' || !h.face || st.refused[h.id]) continue;
    const hd = DIRV[h.face.part]; if (!hd || hd[ax] === 0 || hd[ax] === side) continue;
    const before = st.measure[h.target]?.bbox; if (!before) return 'unverified';
    const cPrev = hd[ax] > 0 ? before[ax + 3] : before[ax];
    const Dp = sweepIn(h.angle, h.neutral, before[AXI[h.pull ?? 'z']], before[AXI[h.pull ?? 'z'] + 3]);
    if (D + Dp >= Math.abs(c0 - cPrev) * (1 - 2e-3)) return 'reach';
  }
  return null;
}


/** G-FROM: draft {from:word} without neutral: the script layer read the ROOT primitive's own extreme; it must still be the part's current extreme. */
function fromGuard(f, m, G) {
  const use = G.opts.fromUsage?.[G.draftIds.indexOf(f.id)];
  if (use?.from && !use.neutral && m) {
    const ax = AXI[f.pull];
    const lo = use.from === 'bottom' || use.from === 'front' || use.from === 'left';
    const want = lo ? m.bbox[ax] : m.bbox[ax + 3];
    if (Math.abs(want - f.neutral) > 1e-9 * Math.max(1, Math.abs(want))) return { ...refuse(SENTENCE.fromStale(f, use.from, f.neutral, want)), guard: 'G-FROM' };
  }
  return null;
}

/**
 * Whole-shape draft (Body Draft): every face whose normal is square to the pull axis is drafted in ONE solid.draft call (measured: a box, hex prism, wedge and
 * L extrude match closed forms to 1e-15, a cylinder to 1e-4 tessellation). Built only for a root primitive / extruded outline that has been nothing but moved.
 * The face points are computed from the primitive's own dimensions (no name resolution at all), so a stale pick is impossible.
 */
function wholeFaces(root, byId, ctx) {
  // -> { faces:[{n, pt}], kind, axisOnly?:vec } in the primitive's local frame, then world via rotate+center; or {err}
  const rot = (p) => rotPt(p, root.rotate);
  const c = root.center ?? [0, 0, 0];
  const world = (p) => rot(p).map((v, i) => v + c[i]);
  const planar = (n, pt) => ({ n: rot(n), pt: world(pt), planar: true });
  if (root.kind === 'box') {
    const [w, d, h] = root.size.map((v) => v / 2);
    return { kind: 'box', faces: [planar([1, 0, 0], [w, 0, 0]), planar([-1, 0, 0], [-w, 0, 0]), planar([0, 1, 0], [0, d, 0]), planar([0, -1, 0], [0, -d, 0]), planar([0, 0, 1], [0, 0, h]), planar([0, 0, -1], [0, 0, -h])] };
  }
  if (root.kind === 'cylinder') {
    const R = root.radius, h = root.height / 2;
    return { kind: 'cylinder', R, axis: rot([0, 0, 1]), faces: [{ curved: true, pt: world([R, 0, 0]) }, planar([0, 0, 1], [0, 0, h]), planar([0, 0, -1], [0, 0, -h])] };
  }
  if (root.kind === 'prism' || root.kind === 'wedge') {
    const poly = root.kind === 'prism'
      ? (() => { const n = Math.max(3, Math.min(12, Math.round(root.sides))); return Array.from({ length: n }, (_, i) => [root.radius * Math.cos(2 * Math.PI * i / n), root.radius * Math.sin(2 * Math.PI * i / n)]); })()
      : [[-root.width / 2, -root.depth / 2], [root.width / 2, -root.depth / 2], [-root.width / 2, root.depth / 2]];
    const faces = []; const h = root.height / 2;
    const sg = Math.sign(poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)) || 1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]; const e = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(...e);
      faces.push(planar([sg * e[1] / l, -sg * e[0] / l, 0], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]));
    }
    faces.push(planar([0, 0, 1], [0, 0, h]), planar([0, 0, -1], [0, 0, -h]));
    return { kind: root.kind, faces };
  }
  if (root.kind === 'extrude') {
    const sk = byId[root.target]; if (!sk) return { err: 'a sketch that is missing' };
    let o; try { o = ctx.arc.outlineOf(sk); } catch { o = { ok: false }; }
    if (!o.ok) return { err: 'a sketch outline that could not be read' };
    const fr = ctx.mt.sketchFrameOf(sk);
    const sw = sweepOf(fr);
    const to3 = (p, hh) => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1] + sw[i] * hh);
    const H = root.height;
    if (sk.shape === 'circle') {
      const [a, b] = o.points; const cc = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const R = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
      return { kind: 'cylinder', R, axis: sw, faces: [{ curved: true, pt: to3([cc[0] + R, cc[1]], H / 2) }, { n: sw, pt: to3(cc, H), planar: true }, { n: sw.map((v) => -v), pt: to3(cc, 0), planar: true }] };
    }
    if (o.bulges && Object.values(o.bulges).some(Boolean)) return { err: 'an outline with an arc' };
    const P = o.points; const sg = Math.sign(P.reduce((a, p, i) => a + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0)) || 1;
    const faces = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]; const e = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(...e);
      const n2 = [sg * e[1] / l, -sg * e[0] / l];
      faces.push({ n: [0, 1, 2].map((k) => fr.u[k] * n2[0] + fr.v[k] * n2[1]), pt: to3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], H / 2), planar: true });
    }
    const cc = polyCentroid(P);
    faces.push({ n: sw, pt: to3(cc, H), planar: true }, { n: sw.map((v) => -v), pt: to3(cc, 0), planar: true });
    return { kind: 'extrude', faces, polygon: P };
  }
  return { err: root.kind };
}


/** true when no two non-adjacent edges of the polygon touch or cross (collinear overlap included) */
function simplePolygon(P) {
  const n = P.length;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const on = (a, b, c) => Math.min(a[0], b[0]) - 1e-9 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9;
  const hit = (p1, p2, p3, p4) => {
    const d1 = cr(p3, p4, p1), d2 = cr(p3, p4, p2), d3 = cr(p1, p2, p3), d4 = cr(p1, p2, p4);
    if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return true;
    return (Math.abs(d1) <= 1e-9 && on(p3, p4, p1)) || (Math.abs(d2) <= 1e-9 && on(p3, p4, p2)) || (Math.abs(d3) <= 1e-9 && on(p1, p2, p3)) || (Math.abs(d4) <= 1e-9 && on(p1, p2, p4));
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
    if (hit(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
  }
  return true;
}

function planWholeDraft(f, st, ctx, G, bs) {
  if (Math.abs(f.angle) > 89) return { ...refuse(SENTENCE.angleRange(f, 89)), guard: 'G-ANGLE' };
  const root = rootOf(f.target, G.byId);
  if (!root) return refuse(SENTENCE.wholeChanged(f, 'a step this cannot follow'));
  if (root.kind === 'sphere') return { ...refuse(SENTENCE.wholeSphere(f)), guard: 'G-FLAT' };
  if (root.kind === 'cone') return { ...refuse(SENTENCE.wholeCone(f)), guard: 'G-FLAT' };
  const chain = hops(root.id, f.target, G.byId);
  if (!chain) return refuse(SENTENCE.wholeChanged(f, 'a step this cannot follow'));
  let shift = [0, 0, 0];
  for (const h of chain) {
    if (h.kind === 'move' && !h.copy) { shift = shift.map((v, i) => v + h.offset[i]); continue; }
    if (h.kind === 'shell') return { ...refuse(SENTENCE.wholeHollow(f)), guard: 'G-WHOLE-HOLLOW' };
    if (h.kind === 'draft') return { ...refuse(SENTENCE.wholeDrafted(f)), guard: 'G-TWICE' };
    return { ...refuse(SENTENCE.wholeChanged(f, HOP_NAME[h.kind] ?? `a ${h.kind}`)), guard: 'G-WHOLE-HISTORY' };
  }
  if (root.round) return { ...refuse(SENTENCE.wholeChanged(f, 'rounded or bevelled edges')), guard: 'G-WHOLE-HISTORY' };
  const wf = wholeFaces(root, G.byId, ctx);
  if (wf.err) return { ...refuse(SENTENCE.wholeShape(f, /^an? /.test(wf.err) ? wf.err : `a ${KIND_NAME[wf.err] ?? wf.err}`)), guard: 'G-WHOLE-SHAPE' };
  if (wf.polygon && !simplePolygon(wf.polygon)) return { ...refuse(SENTENCE.outlineCrosses(f)), guard: 'G-OUTLINE' };
  const pv = DIRV['+' + (f.pull ?? 'z')];
  const sides = [];
  for (const fc of wf.faces) {
    if (fc.curved) {
      if (Math.abs(dotv(wf.axis, pv)) < 1 - 1e-9) return { ...refuse(SENTENCE.wholeAxis(f, wf.kind, f.pull ?? 'z')), guard: 'G-WHOLE-AXIS' };
      sides.push(fc.pt); continue;
    }
    const a = Math.abs(dotv(fc.n, pv));
    if (a < 1e-9) sides.push(fc.pt);
    else if (a < 1 - 1e-9) return { ...refuse(SENTENCE.wholeAxis(f, wf.kind, f.pull ?? 'z')), guard: 'G-WHOLE-AXIS' };
  }
  if (!sides.length) return { ...refuse(SENTENCE.wholeAxis(f, wf.kind, f.pull ?? 'z')), guard: 'G-WHOLE-AXIS' };
  const pts = sides.map((p) => p.map((v, i) => v + shift[i]));
  const m = st.measure[G.headOf(f.target)] ?? st.measure[f.target];
  const fg = fromGuard(f, m, G); if (fg) return fg;
  const ax = DIRV['+' + (f.pull ?? 'z')];
  const variant = [{ command: 'solid.draft', params: { faces: pts, angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }];
  return {
    variants: [variant], produces: bs, consumes: [f.target], pickedFrom: 'the primitive\'s own dimensions (every side face, one call)',
    plain: (raw) => plainEngineText(raw, { ...f, face: null }),
    post: (after, before, env) => {
      if (before && after.faces !== before.faces) return { guard: 'G-VANISH', refusal: SENTENCE.vanish(f) };
      if (!(after.volume > 0) && !G.opts.off?.includes('G-SWEEP')) return { guard: 'G-SWEEP', refusal: SENTENCE.vanish(f) };
      if (wf.kind === 'cylinder' && before && !G.opts.off?.includes('G-SWEEP')) {
        // curved volumes are tessellation-derived, so the quadratic-in-tan fit below is not exact for them (the mesh density changes with the radius).
        // A cylinder drafted whole is a frustum: compare with the exact frustum volume instead, and refuse a cone tip inside the part.
        const pa = AXI[f.pull ?? 'z']; const lo = before.bbox[pa], hi = before.bbox[pa + 3];
        const k = SC_SIGMA * Math.tan(f.angle * Math.PI / 180);
        const r = (z) => wf.R + k * (z - f.neutral);
        if (Math.min(r(lo), r(hi)) <= 1e-9 * wf.R) return { guard: 'G-VANISH', refusal: SENTENCE.vanish(f) };
        const want = Math.abs(k) < 1e-12 ? Math.PI * wf.R * wf.R * (hi - lo) : Math.PI / (3 * k) * (r(hi) ** 3 - r(lo) ** 3);
        if (Math.abs(after.volume - want) > 3e-4 * want) return { guard: 'G-SWEEP', refusal: SENTENCE.vanish(f), expected: want };
        return null;
      }
      if (before && env && !G.opts.off?.includes('G-SWEEP')) {
        const bad = sweepCheck(f, after, before, env, bs);
        if (bad) return { guard: 'G-SWEEP', refusal: bad === 'unverified' ? SENTENCE.unverified(f) : SENTENCE.vanish(f), sweep: bad };
      }
      return null;
    },
  };
}
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function planDraft(f, st, ctx, G) {
  const dep = (id, role = 'target') => {
    id = G.headOf(id);
    if (st.refused[id]) return `${f.id} (draft): it needs ${id}, which could not be built, so ${f.id} is shown without it.`;
    if (st.stale[id]) return `${f.id} (draft): ${id} was already changed by ${st.stale[id]}, so ${f.id} is shown without it.`;
    return null;
  };
  const d = dep(f.target); if (d) return refuse(d);
  const bs = st.bodies[G.headOf(f.target)];
  if (!bs || bs.length !== 1) return refuse(`${f.id} (draft): ${f.target} is not a single solid, so ${f.id} is shown without it.`);
  if (f.whole || !f.face) return planWholeDraft(f, st, ctx, G, bs);
  const part = f.face.part;
  if (part === 'side') return refuse(SENTENCE.curvedFace(f, 'side'));
  if (Math.abs(f.angle) > 89) return { ...refuse(SENTENCE.angleRange(f, 89)), guard: 'G-ANGLE' };
  const dirv = DIRV[part];
  const rootFace = rootOf(f.face.feature, G.byId);
  if (rootFace?.kind === 'sphere') return { ...refuse(SENTENCE.sphereFace(f)), guard: 'G-FLAT' };
  const useEarly = G.opts.fromUsage?.[G.draftIds.indexOf(f.id)];
  if (dirv && dirv[AXI[f.pull ?? 'z']] !== 0) return { ...refuse(SENTENCE.cap(f, WORD_OF[part], { pull: f.pull ?? 'z', fromWord: useEarly?.from ?? null })), guard: 'G-CAP' };
  // same face drafted before in this history
  const prior = hops(f.face.feature, f.target, G.byId) ?? [];
  if (prior.some((h) => h.kind === 'draft' && h.face?.feature === f.face.feature && h.face?.part === part)) return { ...refuse(SENTENCE.twice(f)), guard: 'G-TWICE' };
  const root = rootOf(f.face.feature, G.byId);
  const tie = wordTie(root, part, G.byId, ctx.arc, ctx.mt);
  if (tie) return { ...refuse(SENTENCE.tie(f, WORD_OF[part], tie.kind, tie.n)), guard: 'G-TIE' };
  // G-FROM
  const m = st.measure[G.headOf(f.target)] ?? st.measure[f.target];
  const fg = fromGuard(f, m, G); if (fg) return fg;
  const cv = convexity(G.headOf(f.target), G.byId, ctx.arc, G.holeExt);
  const pk = pickPoints(f, f.face, st, ctx, G, { gridOnHole: cv.holes === true || !cv.convex, });
  if (pk.err) return { ...refuse(pk.err), guard: 'G-PICK' };
  if ((!cv.convex || cv.holes === true) && !G.opts.off?.includes('G-REACH')) {
    const dv = DIRV[part];
    const axi = dv ? dv.findIndex((v) => v !== 0) : -1;
    const c0 = axi >= 0 ? pk.pts[0][axi] : NaN;
    const why = Number.isFinite(c0) ? reachCheck(f, part, c0, st, ctx, G) : 'unverified';
    if (why) return { ...refuse(why === 'unverified' ? SENTENCE.unverified(f) : SENTENCE.vanish(f)), guard: 'G-REACH' };
  }
  const ax = DIRV['+' + (f.pull ?? 'z')];
  const variants = pk.pts.map((p) => [{ command: 'solid.draft', params: { faces: [p], angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }]);
  return {
    variants, produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve + moves in the history',
    plain: (raw) => (/square to the pull/i.test(String(raw)) && prior.some((h) => h.kind === 'draft') ? SENTENCE.tiltedNeighbour(f) : plainEngineText(raw, f)),
    post: (after, before, env) => {
      if (before && after.faces !== before.faces) return { guard: 'G-VANISH', refusal: SENTENCE.vanish(f) };
      if (!(after.volume > 0) && !G.opts.off?.includes('G-SWEEP')) return { guard: 'G-SWEEP', refusal: SENTENCE.vanish(f) };
      if (before && env && !G.opts.off?.includes('G-SWEEP')) {
        const bad = sweepCheck(f, after, before, env, bs);
        if (bad) return { guard: 'G-SWEEP', refusal: bad === 'unverified' ? SENTENCE.unverified(f) : SENTENCE.vanish(f), sweep: bad };
      }
      return null;
    },
  };
}
