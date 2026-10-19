// SPIKE, referee only (contract / primitives group, round 3). The ENFORCEMENT half of the primitives contract.
// Pure functions over a ModelDoc primitive feature: no kernel, no wasm. guardFeature(f) -> null | {code, sentence}.
// A feature the guard refuses never reaches the SolidCraft translator, so a student sees ONE plain sentence (in the words of the call they typed:
// box(width, depth, height), cylinder(across, tall), ring(across, tubeAcross) ...), never "box1", "solid.fillet" or "major > minor".
//
// Every constant below is the edge of an envelope that primitives-r3/*.mjs measured (see contract/primitives.json and primitives-r3/results):
// inside it truck matches the oracle (planar 1e-9, curved 3e-4 volume, face count equal, bbox/COM 1e-4 of the diagonal for curved), outside it
// either truck wrongs the part or the call is too slow/too big to be useful. The guard is deliberately a little narrower than the measured edge.
//
//   import { guardFeature, guardDoc } from './primitives.guard.mjs';
export const LIM = {
  // box corner: truck's rounded box is exact down to a gap of 1e-5 (relative) under half the shortest side, 18 faces instead of 26 at 1e-6
  // (E1: 3 scales x 3 axes, all identical). 1e-4 leaves a decade of margin (1e-4 itself was measured exact too).
  boxCornerGap: 1e-4,
  // cylinder corner / bevel (E2): bbox 1.6e-2 of the diagonal too wide from 99.5% of the radius up (99% is exact); 3 faces instead of 5 from a
  // gap of 1e-5 under half the height (1e-4 is exact)
  cylRadiusFrac: 0.99,
  cylHalfHeightGap: 1e-4,
  // ring (E4): across / tubeAcross. The thin side: 50 is exact (2.7e-4 at 40 and 400 across), 60 is 3.0e-4, 80 and up 3.7e-4 to 2.2e-3
  ringThinMax: 50,
  ringFatMin: 2.05,           // 2.05 .. 2.5 measured exact at 3 sizes (4, 40, 400); at 2.0 and below the tube touches itself and truck refuses
  // sizes (E5, E8, E9): one cap and one floor per class instead of one per shape
  curvedMax: 5e4,             // any typed dimension of a curved or rounded shape (cone is wrong from 2e5, empty sphere from 7e4)
  planarMax: 1e6,             // any typed dimension or coordinate of a planar shape (exact to 1e6, refused by truck from 1e7)
  curvedMin: 1,               // across of a sphere, cylinder, cone and the shortest side of a rounded box: 1 measured 1.1e-4 to 2.8e-4, 0.25 and below 5e-4 to 2e-3
  ringTubeMin: 0.5,           // tubeAcross of a ring: 0.5 measured 2.1e-4 to 2.2e-4, 0.25 and below 4.2e-4 to 8.6e-3
  tallMin: 0.01,              // tall of a cylinder or cone (a thin disc): measured exact-to-tessellation down to 0.01
  planarMin: 1e-3,            // every typed dimension of a planar shape (truck refuses a 1e-4 box with a kernel sentence)
  cylSlender: 30,             // tall / across of a cylinder: 1.7e-4 at 30, 2.5e-4 at 40, 4.5e-4 at 50
  coneSlender: 40,            // tall / across of a cone: 1.8e-4 at 40, 2.7e-4 at 50, 4.3e-4 at 60
  // placement (E6, E6b, E7): largest |at coordinate| as a multiple of the SMALLEST typed dimension
  curvedFarRatio: 400,        // cylinder, cone, rounded box x 4 sizes: exact to 500, first wrong at 1000
  planarFarRatio: 100,        // prism and any turned shape: exact to 100 (84 cases), first wrong at 200 (an unturned box or wedge is exact to the 1e6 cap)
};

const SHAPE = { box: 'box', cylinder: 'cylinder', sphere: 'sphere', cone: 'cone', torus: 'ring', prism: 'prism', wedge: 'wedge' };
/** a number for a sentence: no exponent for sizes people type, 4 significant digits */
export function num(v) {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e15) return String(+v.toPrecision(4));
  return v.toExponential(2).replace('e+', ' x 10^').replace('e-', ' x 10^-');
}
const down = (v, d = 3) => { const k = 10 ** d; return Math.floor(v * k) / k; };

const maxAbs = (c) => (c ? Math.max(...c.map(Math.abs)) : 0);
/** [{name, value}] of every typed dimension, in the student's words */
function dims(f) {
  switch (f.kind) {
    case 'box': return [['width', f.size[0]], ['depth', f.size[1]], ['height', f.size[2]]];
    case 'cylinder': return [['across', 2 * f.radius], ['tall', f.height]];
    case 'sphere': return [['across', 2 * f.radius]];
    case 'cone': return [['across', 2 * f.radius], ['tall', f.height]];
    case 'torus': return [['across', 2 * (f.ringRadius + f.tubeRadius)], ['tubeAcross', 2 * f.tubeRadius]];
    case 'prism': return [['across', 2 * f.radius], ['tall', f.height]];
    case 'wedge': return [['width', f.width], ['depth', f.depth], ['tall', f.height]];
    default: return [];
  }
}
const isCurved = (f) => f.kind === 'cylinder' || f.kind === 'sphere' || f.kind === 'cone' || f.kind === 'torus' || (f.kind === 'box' && !!f.round);
const refuse = (code, sentence) => ({ code, sentence });

/** @returns {null | {code:string, sentence:string}} */
export function guardFeature(f) {
  const kind = f.kind;
  if (!SHAPE[kind]) return null;
  const nm = SHAPE[kind];
  const D = dims(f);
  const curved = isCurved(f);
  const cx = f.center ?? [0, 0, 0];
  const smin = Math.min(...D.map(([, v]) => v));
  const turned = !!(f.rotate && f.rotate.some((v) => v));

  // ---- ring: the interpreter stores ringRadius = (across - tubeAcross) / 2, which is <= 0 when the tube is not thinner than half of across
  if (kind === 'torus') {
    const across = 2 * (f.ringRadius + f.tubeRadius); const tube = 2 * f.tubeRadius;
    if (!(f.ringRadius > 0) || tube >= across / LIM.ringFatMin) {
      const maxTube = down(across / LIM.ringFatMin, 3);
      return refuse('ring-tube-too-thick', `ring(${num(across)}, ${num(tube)}): the tube is too thick for a ring ${num(across)} across -- tubeAcross has to be ${num(maxTube)} or less, so the hole in the middle stays open.`);
    }
    if (across / tube > LIM.ringThinMax) {
      return refuse('ring-tube-too-thin', `ring(${num(across)}, ${num(tube)}): the tube is too thin for a ring ${num(across)} across -- tubeAcross has to be at least ${num(+(across / LIM.ringThinMax).toPrecision(3))}, one fiftieth of across.`);
    }
  }

  // ---- floors, caps (one pair per class)
  for (const [name, v] of D) {
    let floor = curved ? LIM.curvedMin : LIM.planarMin;
    if (kind === 'torus' && name === 'tubeAcross') floor = LIM.ringTubeMin;
    else if ((kind === 'cylinder' || kind === 'cone') && name === 'tall') floor = LIM.tallMin;
    if (v < floor) return refuse(curved ? 'too-small-curved' : 'too-small', `${nm}(): ${name} ${num(v)} is too small -- it has to be at least ${num(floor)}${curved ? ' for a curved or rounded shape' : ''}.`);
  }
  const cap = curved ? LIM.curvedMax : LIM.planarMax;
  for (const [name, v] of D) {
    if (v > cap) return refuse(curved ? 'too-big-curved' : 'too-big', `${nm}(): ${name} ${num(v)} is too big -- the biggest ${curved ? 'curved or rounded shape' : 'shape'} that can be built accurately is ${num(cap)} in any size.`);
  }

  // ---- rounding
  if (kind === 'box' && f.round) {
    if (f.roundStyle === 'chamfer') {
      return refuse('box-chamfer', 'box(): a chamfer on every edge of a box is not available -- use corner for a rounded box, or leave the edges square.');
    }
    const [w, d, h] = f.size; const m = Math.min(w, d, h); const lim = m / 2 * (1 - LIM.boxCornerGap);
    if (f.round > lim) {
      return refuse('box-corner-too-big', `box(${num(w)}, ${num(d)}, ${num(h)}, { corner: ${num(f.round)} }): the corner is too big -- it has to be ${num(down(lim))} or less, a little under half of the shortest side (${num(m)}).`);
    }
  }
  if (kind === 'cylinder' && f.round) {
    const across = 2 * f.radius; const rLim = f.radius * LIM.cylRadiusFrac; const hLim = f.height / 2 * (1 - LIM.cylHalfHeightGap);
    const what = f.roundStyle === 'chamfer' ? 'bevel' : 'corner';
    if (f.round > rLim) return refuse('cyl-corner-vs-radius', `cylinder(${num(across)}, ${num(f.height)}, { corner: ${num(f.round)} }): the ${what} is too big for the width -- it has to be ${num(down(rLim))} or less, ${num(LIM.cylRadiusFrac * 100)}% of the radius (${num(f.radius)}).`);
    if (f.round > hLim) return refuse('cyl-corner-vs-height', `cylinder(${num(across)}, ${num(f.height)}, { corner: ${num(f.round)} }): the ${what} is too big for the height -- it has to be ${num(down(hLim))} or less, a little under half of tall (${num(f.height)}).`);
  }

  // ---- slenderness
  if (kind === 'cylinder' && f.height / (2 * f.radius) > LIM.cylSlender) return refuse('cyl-too-slender', `cylinder(${num(2 * f.radius)}, ${num(f.height)}): too long for its width -- tall has to be at most ${LIM.cylSlender} times across.`);
  if (kind === 'cone' && f.height / (2 * f.radius) > LIM.coneSlender) return refuse('cone-too-slender', `cone(${num(2 * f.radius)}, ${num(f.height)}): too long for its width -- tall has to be at most ${LIM.coneSlender} times across.`);

  // ---- placement: absolute (all) and relative to the smallest size (curved; prism and turned shapes)
  const far = Math.max(...cx.map(Math.abs));
  if (far > LIM.planarMax) return refuse('too-far', `${nm}(): the at position ${num(far)} is too far from the origin -- keep every at coordinate within ${num(LIM.planarMax)}.`);
  const ratio = curved ? LIM.curvedFarRatio : (kind === 'prism' || turned) ? LIM.planarFarRatio : null;
  if (ratio !== null && far > ratio * smin) {
    return refuse(curved ? 'too-far-curved' : 'too-far-planar', `${nm}(): the at position ${num(far)} is too far from the origin for a shape whose smallest size is ${num(smin)} -- keep every at coordinate within ${num(ratio * smin)} (${ratio} times that size), or move the shape nearer.`);
  }
  return null;
}

/**
 * featureId -> verdict (null when fine) for every primitive in a ModelDoc. A primitive that the script turned or moved is not stored with
 * rotate / center any more: turn(prism(..)) and turn(wedge(..)) become a separate { kind: 'rotate', target } feature and move(x, [..]) a
 * { kind: 'move', target, offset } feature, so those are folded back in before the placement rules run.
 */
export function guardDoc(doc) {
  const eff = new Map();
  for (const f of doc.features) {
    if (SHAPE[f.kind]) eff.set(f.id, { ...f, center: [...(f.center ?? [0, 0, 0])] });
    else if (f.kind === 'rotate' && eff.has(f.target)) { const e = eff.get(f.target); e.rotate = (f.angles ?? [0, 0, 0]).map((v, i) => (e.rotate?.[i] ?? 0) + v); if (!e.rotate.some((v) => v)) e.rotate = [0, 0, 0]; }
    else if (f.kind === 'move' && eff.has(f.target) && !f.copy) { const e = eff.get(f.target); e.center = e.center.map((v, i) => v + (f.offset?.[i] ?? 0)); }
  }
  const out = new Map();
  for (const [id, e] of eff) out.set(id, guardFeature(e));
  return out;
}

/** first refusal of a whole document, or null */
export function guardFirst(doc) {
  for (const v of guardDoc(doc).values()) if (v) return v;
  return null;
}

/** Sentence lint: one sentence, starts with the call the student typed, no internal id or kernel word. Returns the list of problems. */
export function sentenceProblems(s) {
  const bad = [];
  if (!/^(box|cylinder|sphere|cone|ring|prism|wedge)\(/.test(s)) bad.push('does-not-start-with-the-call');
  if (/\b(box|cyl|ball|cone|ring|prism|wedge)\d+\b/.test(s)) bad.push('internal-id');
  if (/solid\.|solidcraft|truck|brep|occt|kernel|invalid input|major|minor|torus|fillet|body|feature/i.test(s)) bad.push('kernel-word');
  if (!/[.]$/.test(s) || /[.] [A-Z]/.test(s)) bad.push('not-one-sentence');
  if (s.length > 230) bad.push('too-long');
  return bad;
}
